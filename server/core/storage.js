import fs from 'fs';
import path from 'path';
import { prisma } from '../db/prisma.js';
import { config } from '../config/env.js';
import { dirSize } from '../lib/files.js';
import { VIDEO_STATUS, OPEN_STATUSES } from '../lib/enums.js';
import { ValidationError, ConflictError } from '../lib/errors.js';
import * as logger from './log.js';

/**
 * Limpeza de arquivos por pasta.
 *
 * Cada entrada declara o que se perde, e as que mexem no banco trazem um
 * `sync` para o registro não ficar apontando para arquivo inexistente — apagar
 * só o arquivo deixaria a fila cheia de vídeos fantasmas.
 */
export const PASTAS = {
  pending: {
    dir: () => config.paths.pending,
    label: 'Vídeos pendentes',
    aviso: 'Apaga TODOS os vídeos ainda não publicados e seus agendamentos.',
    sync: async () => {
      const alvo = await prisma.video.findMany({ where: { status: { in: OPEN_STATUSES } }, select: { id: true } });
      await prisma.video.deleteMany({ where: { id: { in: alvo.map((v) => v.id) } } });
    },
  },
  failed: {
    dir: () => config.paths.failed,
    label: 'Vídeos falhados',
    aviso: 'Apaga os vídeos que falharam definitivamente.',
    sync: () => prisma.video.deleteMany({ where: { status: VIDEO_STATUS.FAILED } }),
  },
  published: {
    dir: () => config.paths.published,
    label: 'Vídeos publicados (arquivos)',
    aviso: 'Libera espaço apagando os arquivos já publicados. O histórico continua no banco.',
    // Só o arquivo sai: o registro é o histórico do que foi ao ar.
    sync: () => prisma.video.updateMany({ where: { status: VIDEO_STATUS.PUBLISHED }, data: { filepath: '' } }),
  },
  covers: {
    dir: () => config.paths.covers,
    label: 'Capas',
    aviso: 'Remove todas as capas, individuais e a padrão.',
    sync: async () => {
      await prisma.video.updateMany({ where: { coverPath: { not: null } }, data: { coverPath: null } });
      await prisma.settings.update({ where: { id: 1 }, data: { defaultCoverPath: null, useDefaultCover: false } });
    },
  },
  editorSource: {
    dir: () => config.paths.editorSource,
    label: 'Editor — vídeos de origem',
    aviso: 'Apaga os vídeos enviados ao editor que ainda não foram processados.',
    sync: () => prisma.sourceVideo.deleteMany(),
  },
  editorOutput: {
    dir: () => config.paths.editorOutput,
    label: 'Editor — vídeos processados',
    aviso: 'Apaga os resultados do editor que ainda não foram para a fila.',
    sync: () => prisma.batchItem.updateMany({ data: { outputPath: null, outputName: null } }),
  },
  editorAssets: {
    dir: () => config.paths.editorAssets,
    label: 'Editor — recursos (fotos, logos, fundos)',
    aviso: 'Apaga as imagens usadas nos templates. Os templates continuam, sem as imagens.',
  },
  editorTmp: {
    dir: () => config.paths.editorTmp,
    label: 'Cache temporário',
    aviso: 'Arquivos intermediários do processamento. Seguro limpar a qualquer momento.',
  },
};

export function usage() {
  const folders = Object.fromEntries(
    Object.entries(PASTAS).map(([key, p]) => [key, dirSize(p.dir())]),
  );
  return { folders, total: Object.values(folders).reduce((a, b) => a + b, 0) };
}

function wipe(dir) {
  let removidos = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (e.name === '.gitkeep') continue;
    const full = path.join(dir, e.name);
    try {
      e.isDirectory() ? fs.rmSync(full, { recursive: true, force: true }) : fs.unlinkSync(full);
      removidos += 1;
    } catch { /* arquivo em uso — segue para o próximo */ }
  }
  return removidos;
}

export async function clearFolder(key) {
  const pasta = PASTAS[key];
  if (!pasta) throw new ValidationError(`Pasta desconhecida: ${key}`);

  // Apagar a origem de um lote em andamento quebraria o processamento no meio.
  if (key === 'editorSource' || key === 'editorTmp') {
    const rodando = await prisma.batch.count({ where: { status: 'RUNNING' } });
    if (rodando > 0) {
      throw new ConflictError('Há lote em processamento. Aguarde ou cancele antes de limpar esta pasta.');
    }
  }

  const removidos = wipe(pasta.dir());
  if (pasta.sync) await pasta.sync();

  await logger.warn({ action: 'PASTA_LIMPA', message: `${pasta.label}: ${removidos} item(ns).` });
  return { removidos, label: pasta.label };
}

export async function clearAll() {
  const resultados = {};
  for (const key of Object.keys(PASTAS)) {
    try {
      resultados[key] = await clearFolder(key);
    } catch (err) {
      resultados[key] = { erro: err.message };
    }
  }
  return resultados;
}

/**
 * Limpeza automática do cache. Diferente do agendador, aqui não há urgência:
 * checa de hora em hora se já passou o intervalo configurado.
 */
let timer = null;

export function startAutoClean() {
  if (timer) return;
  timer = setInterval(() => tick().catch(() => {}), 60 * 60 * 1000);
  tick().catch(() => {});
}

export function stopAutoClean() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function tick() {
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!s?.autoCleanCache) return;

  const desde = s.lastCacheCleanAt ? Date.now() - new Date(s.lastCacheCleanAt).getTime() : Infinity;
  if (desde < s.autoCleanEveryHours * 3600_000) return;

  const removidos = wipe(config.paths.editorTmp);
  await prisma.settings.update({ where: { id: 1 }, data: { lastCacheCleanAt: new Date() } });
  if (removidos) await logger.info({ action: 'CACHE_LIMPO_AUTO', message: `${removidos} item(ns).` });
}
