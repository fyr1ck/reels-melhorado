import fs from 'fs';
import path from 'path';
import { prisma } from '../../db/prisma.js';
import { config } from '../../config/env.js';
import { BATCH_STATUS, MEDIA } from '../../lib/enums.js';
import { NotFoundError, ConflictError } from '../../lib/errors.js';
import { uniqueName, sizeOf, ensureDirs } from '../../lib/files.js';
import { mergeTemplateConfig, applyFilenamePattern } from './layout.js';
import { renderTemplateLayers } from './render.js';
import { probeVideo, runFfmpegJob, cleanupDir } from './ffmpeg.js';
import { sortearVariacao, aplicarVariacao, SEM_VARIACAO, descrever } from './variation.js';
import { regenerate } from '../scheduling/scheduler.js';
import * as logger from '../log.js';

/**
 * Execução de lotes do editor em massa.
 *
 * Estado em memória por lote: o progresso muda várias vezes por segundo e
 * gravar cada tique no banco só geraria escrita à toa. O banco guarda os
 * marcos (item começou, terminou, falhou); a tela lê o progresso fino daqui.
 */
const running = new Map(); // batchId -> { cancelled, progress: Map<itemId, number>, startedAt }

export function isRunning(batchId) {
  return running.has(batchId);
}

export function progressOf(batchId) {
  const entry = running.get(batchId);
  if (!entry) return null;
  return {
    elapsedMs: Date.now() - entry.startedAt,
    items: Object.fromEntries(entry.progress),
  };
}

export function cancel(batchId) {
  const entry = running.get(batchId);
  if (!entry) throw new ConflictError('Esse lote não está em execução.');

  entry.cancelled = true;
  // Mata o ffmpeg dos itens em andamento. Sem isso o cancelamento só evitaria
  // que os PRÓXIMOS começassem, e o usuário esperaria os atuais terminarem.
  for (const job of entry.jobs.values()) job.cancel();
  return true;
}

/**
 * Dispara o lote em segundo plano.
 *
 * Devolve na hora: processar vídeo leva minutos, e segurar a requisição HTTP
 * até o fim daria timeout no navegador. A tela acompanha por polling.
 */
export async function start(batchId) {
  if (running.has(batchId)) throw new ConflictError('Esse lote já está em execução.');

  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: { template: true, items: { where: { status: 'PENDING' } } },
  });
  if (!batch) throw new NotFoundError('Lote não encontrado.');
  if (!batch.items.length) throw new ConflictError('Nenhum item pendente neste lote.');

  running.set(batchId, { cancelled: false, progress: new Map(), jobs: new Map(), startedAt: Date.now() });
  await prisma.batch.update({ where: { id: batchId }, data: { status: BATCH_STATUS.RUNNING } });

  // Sem await: o chamador HTTP responde imediatamente.
  run(batch).catch(async (err) => {
    await logger.error({ action: 'LOTE_FALHOU', message: err.message });
    await prisma.batch.update({ where: { id: batchId }, data: { status: BATCH_STATUS.FAILED } });
    running.delete(batchId);
  });

  return { started: batch.items.length };
}

async function run(batch) {
  ensureDirs();
  const entry = running.get(batch.id);
  const templateConfig = mergeTemplateConfig(JSON.parse(batch.template.config || '{}'));

  // Fila com N trabalhadores em paralelo. Cada um puxa o próximo item livre —
  // dividir a lista em blocos fixos deixaria um trabalhador ocioso enquanto
  // outro pega todos os vídeos longos.
  const fila = [...batch.items];
  const concorrencia = Math.max(1, Math.min(4, batch.concurrency));

  const trabalhador = async () => {
    while (fila.length && !entry.cancelled) {
      const item = fila.shift();
      await processItem(batch, item, templateConfig, entry);
    }
  };

  await Promise.all(Array.from({ length: concorrencia }, trabalhador));

  const totals = await prisma.batchItem.groupBy({
    by: ['status'],
    where: { batchId: batch.id },
    _count: true,
  });
  const count = (s) => totals.find((t) => t.status === s)?._count ?? 0;

  await prisma.batch.update({
    where: { id: batch.id },
    data: {
      status: entry.cancelled ? BATCH_STATUS.CANCELLED : BATCH_STATUS.DONE,
      done: count('DONE'),
      failed: count('FAILED'),
      cancelled: count('CANCELLED'),
      finishedAt: new Date(),
    },
  });

  running.delete(batch.id);

  if (batch.autoQueue && count('DONE') > 0) {
    await addToQueue(batch.id, { autoSchedule: batch.autoSchedule });
  }

  await logger.success({
    action: 'LOTE_CONCLUIDO',
    accountId: batch.accountId,
    message: `${count('DONE')} concluído(s), ${count('FAILED')} falhou(aram) em ${((Date.now() - entry.startedAt) / 1000).toFixed(0)}s.`,
  });
}

async function processItem(batch, item, templateConfig, entry) {
  const tmpDir = path.join(config.paths.editorTmp, item.id);

  try {
    await prisma.batchItem.update({ where: { id: item.id }, data: { status: 'RUNNING', progress: 0 } });
    entry.progress.set(item.id, 0);

    // A variação é sorteada POR ITEM, e sobre uma cópia da config: mutar a
    // config do template faria a variação de um item vazar para o seguinte.
    const variacao = batch.varyOutputs ? sortearVariacao() : SEM_VARIACAO;
    const itemConfig = aplicarVariacao(templateConfig, variacao);

    const meta = await probeVideo(item.sourcePath);
    fs.mkdirSync(tmpDir, { recursive: true });

    // O resolvedor é chamado para foto de perfil, logo e fundo. Um template
    // sem esses elementos passa null, e path.join(dir, null) lança
    // 'The "path" argument must be of type string' — que não diz nada sobre
    // o que faltou. Ausência de asset é o caso normal, não erro.
    const layers = await renderTemplateLayers(itemConfig, tmpDir, (asset) => {
      if (!asset) return null;
      return path.isAbsolute(asset) ? asset : path.join(config.paths.editorAssets, asset);
    });

    // O ffmpeg falha com "No such file or directory" citando o PNG, sem dizer
    // que o problema foi na etapa anterior. Conferir aqui transforma isso numa
    // mensagem que aponta o passo certo.
    for (const [nome, caminho] of Object.entries(layers)) {
      if (caminho && !fs.existsSync(caminho)) {
        throw new Error(`A camada ${nome} não foi gerada em ${caminho}. Renderização interrompida?`);
      }
    }

    const outputName = applyFilenamePattern(
      itemConfig.export?.filenamePattern,
      path.basename(item.sourceName, path.extname(item.sourceName)),
      batch.template.name,
    ) + '.mp4';
    const outputPath = path.join(config.paths.editorOutput, uniqueName(outputName));

    // runFfmpegJob devolve { promise, cancel } — não uma promise. Dar await
    // no objeto resolve na hora e marca o item como concluído ANTES de o
    // ffmpeg sequer começar: o lote "terminava" em segundos sem gerar arquivo.
    const job = runFfmpegJob({
      sourcePath: item.sourcePath,
      outputPath,
      videoMeta: meta,
      config: itemConfig,
      layers,
      onProgress: (pct) => {
        entry.progress.set(item.id, pct);
        // Sem gravar no banco: o polling lê o progresso da memória.
      },
    });

    // Cancelar o lote precisa matar o ffmpeg em andamento, não só parar de
    // enfileirar os próximos.
    entry.jobs.set(item.id, job);
    try {
      await job.promise;
    } finally {
      entry.jobs.delete(item.id);
    }

    // Confirmação observável: código de saída 0 não garante arquivo utilizável.
    if (!fs.existsSync(outputPath) || sizeOf(outputPath) === 0) {
      throw new Error('O ffmpeg terminou sem erro, mas não gerou arquivo de saída.');
    }

    if (entry.cancelled) {
      try { fs.unlinkSync(outputPath); } catch { /* pode não existir */ }
      await prisma.batchItem.update({ where: { id: item.id }, data: { status: 'CANCELLED' } });
      return;
    }

    await prisma.batchItem.update({
      where: { id: item.id },
      data: { status: 'DONE', progress: 100, outputName, outputPath, finishedAt: new Date() },
    });
    entry.progress.set(item.id, 100);

    await logger.info({
      action: 'ITEM_PROCESSADO', accountId: batch.accountId, videoName: item.sourceName,
      message: batch.varyOutputs ? descrever(variacao) : undefined,
    });
  } catch (err) {
    await prisma.batchItem.update({
      where: { id: item.id },
      data: { status: 'FAILED', errorMessage: err.message, finishedAt: new Date() },
    });
    await logger.error({
      action: 'ITEM_FALHOU', accountId: batch.accountId,
      videoName: item.sourceName, message: err.message,
    });
  } finally {
    cleanupDir(tmpDir);
  }
}

/**
 * Manda os resultados concluídos para a fila de publicação.
 *
 * A conta vem do LOTE. Sem isso o vídeo nasceria sem dono, e o agendador —
 * que filtra por conta — nunca o encontraria: entraria na fila e ficaria lá
 * para sempre. Foi exatamente o que acontecia na versão anterior.
 */
export async function addToQueue(batchId, { autoSchedule = false } = {}) {
  const batch = await prisma.batch.findUnique({ where: { id: batchId } });
  if (!batch) throw new NotFoundError('Lote não encontrado.');

  const items = await prisma.batchItem.findMany({
    where: { batchId, status: 'DONE', queuedVideoId: null },
  });
  if (!items.length) return { added: 0 };

  const last = await prisma.video.findFirst({
    where: { accountId: batch.accountId },
    orderBy: { sortOrder: 'desc' },
  });
  let sortOrder = last ? last.sortOrder + 1 : 0;

  for (const item of items) {
    const meta = await probeVideo(item.outputPath).catch(() => ({}));
    const video = await prisma.video.create({
      data: {
        accountId: batch.accountId,
        filename: item.outputName,
        filepath: item.outputPath,
        mediaType: batch.mediaType === MEDIA.STORY ? MEDIA.STORY : MEDIA.REEL,
        sortOrder: sortOrder++,
        sizeBytes: sizeOf(item.outputPath),
        durationSec: meta.duration ?? null,
        width: meta.width ?? null,
        height: meta.height ?? null,
      },
    });
    await prisma.batchItem.update({ where: { id: item.id }, data: { queuedVideoId: video.id } });
  }

  if (autoSchedule) await regenerate({ accountId: batch.accountId });

  await logger.success({
    action: 'LOTE_ENVIADO_A_FILA', accountId: batch.accountId,
    message: `${items.length} vídeo(s) na fila.`,
  });

  return { added: items.length };
}
