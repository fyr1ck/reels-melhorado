import { prisma } from '../../db/prisma.js';
import { normalizeHashtags, composeCaption, rotate, MAX_HASHTAGS } from './text.js';
import { OPEN_STATUSES } from '../../lib/enums.js';
import { ValidationError } from '../../lib/errors.js';
import * as logger from '../log.js';

/**
 * Biblioteca de legendas e hashtags.
 *
 * O rodízio é sempre alimentado pelos itens MENOS usados primeiro
 * (`orderBy: usedCount`), então a distribuição se mantém equilibrada entre
 * execuções — não só dentro de uma.
 */

async function activeCaptions() {
  return prisma.caption.findMany({ where: { enabled: true }, orderBy: { usedCount: 'asc' } });
}

async function activeSets(setId) {
  if (setId) return prisma.hashtagSet.findMany({ where: { id: setId } });
  return prisma.hashtagSet.findMany({ where: { enabled: true }, orderBy: { usedCount: 'asc' } });
}

/** Uma legenda pronta, para o vídeo que acaba de entrar na fila. */
export async function pickOne() {
  const [captions, sets] = await Promise.all([activeCaptions(), activeSets()]);
  if (!captions.length && !sets.length) return null;

  const [caption] = rotate(captions, 1);
  const [set] = rotate(sets, 1);

  if (caption) {
    await prisma.caption.update({ where: { id: caption.id }, data: { usedCount: { increment: 1 } } });
  }
  if (set) {
    await prisma.hashtagSet.update({ where: { id: set.id }, data: { usedCount: { increment: 1 } } });
  }

  return composeCaption(caption?.text || '', set ? normalizeHashtags(set.raw) : []);
}

/**
 * Aplica em lote na fila de uma conta.
 *
 * Só grava em `Video.caption`. Agendamento, ordem, arquivos e vídeos já
 * publicados ficam intocados — nenhuma outra coluna é escrita aqui.
 */
export async function applyToQueue({
  accountId,
  overwrite = false,
  useCaptions = true,
  useHashtags = true,
  hashtagSetId = null,
  dryRun = false,
}) {
  if (!useCaptions && !useHashtags) {
    throw new ValidationError('Selecione legendas, hashtags, ou ambos.');
  }

  const videos = await prisma.video.findMany({
    where: { accountId, status: { in: OPEN_STATUSES } },
    orderBy: { sortOrder: 'asc' },
  });

  const targets = overwrite ? videos : videos.filter((x) => !x.caption?.trim());
  if (!targets.length) {
    return { updated: 0, skipped: videos.length, preview: [], captionsUsed: 0, setsUsed: 0 };
  }

  const captions = useCaptions ? await activeCaptions() : [];
  const sets = useHashtags ? await activeSets(hashtagSetId) : [];

  if (useCaptions && !captions.length) throw new ValidationError('Nenhuma legenda ativa na biblioteca.');
  if (useHashtags && !sets.length) throw new ValidationError('Nenhum grupo de hashtags ativo na biblioteca.');

  const pickedCaptions = rotate(captions, targets.length);
  const pickedSets = rotate(sets, targets.length);

  const preview = [];
  const captionHits = new Map();
  const setHits = new Map();

  for (let i = 0; i < targets.length; i++) {
    const video = targets[i];
    const caption = pickedCaptions[i];
    const set = pickedSets[i];

    const text = caption ? caption.text : (overwrite ? '' : video.caption || '');
    const tags = set ? normalizeHashtags(set.raw) : [];
    const final = composeCaption(text, tags);

    if (caption) captionHits.set(caption.id, (captionHits.get(caption.id) || 0) + 1);
    if (set) setHits.set(set.id, (setHits.get(set.id) || 0) + 1);

    if (!dryRun) {
      await prisma.video.update({ where: { id: video.id }, data: { caption: final } });
    }
    if (preview.length < 5) preview.push({ filename: video.filename, caption: final });
  }

  if (!dryRun) {
    for (const [id, hits] of captionHits) {
      await prisma.caption.update({ where: { id }, data: { usedCount: { increment: hits } } });
    }
    for (const [id, hits] of setHits) {
      await prisma.hashtagSet.update({ where: { id }, data: { usedCount: { increment: hits } } });
    }
    await logger.success({
      action: 'BIBLIOTECA_APLICADA', accountId,
      message: `${targets.length} vídeo(s) atualizados.`,
    });
  }

  return {
    updated: targets.length,
    skipped: videos.length - targets.length,
    captionsUsed: captionHits.size,
    setsUsed: setHits.size,
    preview,
  };
}

/** Decora um grupo com a versão normalizada, para a UI mostrar o que sai. */
export function decorateSet(set) {
  const parsed = normalizeHashtags(set.raw);
  return { ...set, parsed, count: parsed.length, overLimit: parsed.length > MAX_HASHTAGS };
}
