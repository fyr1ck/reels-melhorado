import fs from 'fs';
import path from 'path';
import { prisma } from '../../db/prisma.js';
import { config } from '../../config/env.js';
import { uniqueName, ensureDirs, sizeOf } from '../../lib/files.js';
import { probe } from '../../lib/media.js';
import { pickOne } from '../library/library.js';
import { regenerate } from '../scheduling/scheduler.js';
import { ValidationError } from '../../lib/errors.js';
import { fingerprint } from '../../lib/fingerprint.js';
import * as covers from '../queue/covers.js';
import * as duplicates from '../queue/duplicates.js';
import * as logger from '../log.js';

const VIDEO_EXT = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v']);

let timer = null;
let scanning = false;

export function start() {
  if (timer) return;
  timer = setInterval(() => scanAll().catch(() => {}), config.watchScanMs);
  scanAll().catch(() => {});
}

export function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * Valida um caminho antes de cadastrar.
 *
 * O erro mais comum é colar um LINK em vez de um caminho. `path.resolve` de
 * uma URL produz um caminho local sem sentido, e o "pasta não encontrada"
 * resultante não ajudava ninguém — por isso a URL é detectada antes.
 */
export function validatePath(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new ValidationError('Informe o caminho da pasta.');

  if (/^[a-z]+:\/\//i.test(raw)) {
    if (/drive\.google\.com|docs\.google\.com|dropbox\.com|onedrive/i.test(raw)) {
      throw new ValidationError(
        'Isso é um link da nuvem, não uma pasta do computador. Instale o app de desktop do ' +
        'serviço (Google Drive, OneDrive, Dropbox), que cria uma pasta sincronizada local, e ' +
        'aponte para ela. Marque a pasta como disponível offline: em modo "somente online" o ' +
        'arquivo aparece na listagem mas não está no disco.',
      );
    }
    throw new ValidationError('Informe o caminho de uma pasta do computador, não um endereço da web.');
  }

  const resolved = path.resolve(raw);

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new ValidationError(`Pasta não encontrada: ${resolved}`);
  }
  if (!stat.isDirectory()) throw new ValidationError(`O caminho não é uma pasta: ${resolved}`);

  try {
    fs.accessSync(resolved, fs.constants.R_OK);
  } catch {
    throw new ValidationError(`Sem permissão de leitura em: ${resolved}`);
  }

  // Monitorar a própria pasta de trabalho criaria um laço: o arquivo copiado
  // para /pending seria detectado como novo na varredura seguinte.
  if (resolved === config.paths.videos || resolved.startsWith(config.paths.videos + path.sep)) {
    throw new ValidationError('Essa pasta pertence ao próprio app. Escolha uma pasta de origem externa.');
  }

  return resolved;
}

/**
 * Lista os vídeos elegíveis. Sem recursão — subpasta fica de fora para o
 * comportamento ser previsível.
 */
function candidates(folderPath) {
  const now = Date.now();
  const out = [];

  for (const entry of fs.readdirSync(folderPath, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!VIDEO_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    if (entry.name.startsWith('.') || entry.name.startsWith('~')) continue;

    const full = path.join(folderPath, entry.name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue; // sumiu entre o readdir e o stat
    }

    if (stat.size === 0) continue;
    if (now - stat.mtimeMs < config.watchSettleMs) continue; // ainda sendo gravado

    // Trunca para milissegundo inteiro: guardado como REAL, a fração se perde
    // no round-trip do SQLite e a comparação da chave de dedup falha.
    out.push({ name: entry.name, path: full, sizeBytes: stat.size, mtimeMs: Math.floor(stat.mtimeMs) });
  }

  return out.sort((a, b) => a.mtimeMs - b.mtimeMs);
}

/** Varre todas as pastas. Erro numa não impede as outras. */
export async function scanAll() {
  if (scanning) return { skipped: true };
  scanning = true;

  try {
    const folders = await prisma.watchFolder.findMany({ where: { enabled: true } });
    const touched = new Set();
    let imported = 0;
    let ignored = 0;

    for (const folder of folders) {
      const r = await scanFolder(folder);
      imported += r.imported;
      ignored += r.ignored ?? 0;
      if (r.imported) touched.add(folder.accountId);
    }

    for (const accountId of touched) await regenerate({ accountId });

    return { imported, ignored, folders: folders.length };
  } finally {
    scanning = false;
  }
}

export async function scanFolder(folder) {
  ensureDirs();
  let imported = 0;
  let ignored = 0;

  try {
    for (const file of candidates(folder.path)) {
      const already = await prisma.importedFile.findUnique({
        where: {
          watchFolderId_sourcePath_sizeBytes_mtimeMs: {
            watchFolderId: folder.id,
            sourcePath: file.path,
            sizeBytes: file.sizeBytes,
            mtimeMs: file.mtimeMs,
          },
        },
      });
      if (already) continue;

      try {
        const r = await importOne(folder, file);
        if (!r?.skipped) imported += 1;
        else ignored += 1;
      } catch (err) {
        await logger.error({
          action: 'IMPORTACAO_FALHOU', accountId: folder.accountId,
          videoName: file.name, message: err.message,
        });
      }
    }

    await prisma.watchFolder.update({
      where: { id: folder.id },
      data: { lastScanAt: new Date(), lastError: null, importedCount: { increment: imported } },
    });
  } catch (err) {
    await prisma.watchFolder.update({
      where: { id: folder.id },
      data: { lastScanAt: new Date(), lastError: err.message },
    });
    await logger.error({ action: 'VARREDURA_FALHOU', message: `${folder.path}: ${err.message}` });
  }

  return { imported, ignored };
}

async function importOne(folder, file) {
  const target = path.join(config.paths.pending, uniqueName(file.name));

  // Copia primeiro e só então remove a origem (modo MOVE): se algo falhar no
  // meio, o arquivo original continua intacto.
  fs.copyFileSync(file.path, target);

  let meta;
  try {
    meta = await probe(target);
  } catch (err) {
    fs.unlinkSync(target); // não deixa lixo em /pending
    throw err;
  }

  const [settings, last] = await Promise.all([
    prisma.settings.findUnique({ where: { id: 1 } }),
    prisma.video.findFirst({ where: { accountId: folder.accountId }, orderBy: { sortOrder: 'desc' } }),
  ]);

  // Mesma regra do upload: o arquivo que já está na fila de outra conta não
  // entra. A pasta monitorada é justamente onde isso acontece sem querer —
  // duas contas apontadas para a mesma pasta do Drive importariam tudo em
  // duplicidade, e a varredura repetiria isso a cada ciclo.
  const contentHash = fingerprint(target);
  if (settings?.blockDuplicateContent !== false && contentHash) {
    const outras = await duplicates.outrasContasCom(contentHash, folder.accountId);
    if (outras.length) {
      fs.unlinkSync(target);
      // Registra mesmo sem vídeo: sem isto a próxima varredura copiaria o
      // arquivo de novo, só para descartá-lo de novo.
      await prisma.importedFile.create({
        data: {
          watchFolderId: folder.id,
          sourcePath: file.path,
          sizeBytes: file.sizeBytes,
          mtimeMs: file.mtimeMs,
          videoId: null,
        },
      });
      await logger.warn({
        action: 'IMPORTACAO_DUPLICADA_IGNORADA', accountId: folder.accountId, videoName: file.name,
        message: `Mesmo conteúdo já está na fila de @${outras.map((c) => c.username).join(', @')}.`,
      });
      return { skipped: true };
    }
  }

  const caption = folder.autoCaption ? await pickOne() : null;

  const video = await prisma.video.create({
    data: {
      accountId: folder.accountId,
      filename: file.name,
      filepath: target,
      mediaType: folder.mediaType,
      caption,
      contentHash,
      sortOrder: last ? last.sortOrder + 1 : 0,
      sizeBytes: sizeOf(target),
      durationSec: meta.durationSec,
      width: meta.width,
      height: meta.height,
      coverPath: await covers.padraoDaConta(folder.accountId, settings),
    },
  });

  await prisma.importedFile.create({
    data: {
      watchFolderId: folder.id,
      sourcePath: file.path,
      sizeBytes: file.sizeBytes,
      mtimeMs: file.mtimeMs,
      videoId: video.id,
    },
  });

  if (folder.mode === 'MOVE') {
    try {
      fs.unlinkSync(file.path);
    } catch (err) {
      // A fila já tem o vídeo; o registro impede reimportação. Só avisa.
      await logger.warn({
        action: 'ORIGEM_NAO_REMOVIDA', videoName: file.name,
        message: `Importado, mas não foi possível remover ${file.path}: ${err.message}`,
      });
    }
  }

  await logger.success({
    action: 'VIDEO_IMPORTADO', accountId: folder.accountId, videoName: file.name,
    message: `De ${folder.path}${caption ? ' com legenda da biblioteca' : ''}.`,
  });

  return { skipped: false };
}

/** Quantos vídeos existem na pasta e quantos ainda não foram importados. */
export async function folderStats(folder) {
  try {
    const list = candidates(folder.path);
    const known = await prisma.importedFile.findMany({
      where: { watchFolderId: folder.id },
      select: { sourcePath: true, sizeBytes: true, mtimeMs: true },
    });
    const seen = new Set(known.map((k) => `${k.sourcePath}|${k.sizeBytes}|${k.mtimeMs}`));

    return {
      reachable: true,
      filesInFolder: list.length,
      newFiles: list.filter((c) => !seen.has(`${c.path}|${c.sizeBytes}|${c.mtimeMs}`)).length,
    };
  } catch (err) {
    return { reachable: false, filesInFolder: 0, newFiles: 0, error: err.message };
  }
}
