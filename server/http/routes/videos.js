import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../db/prisma.js';
import { config } from '../../config/env.js';
import { wrap } from '../middleware/errors.js';
import { uniqueName, ensureDirs, sizeOf } from '../../lib/files.js';
import { probe } from '../../lib/media.js';
import * as accounts from '../../core/accounts/accounts.js';
import { regenerate } from '../../core/scheduling/scheduler.js';
import * as logger from '../../core/log.js';
import { MEDIA, MEDIA_TYPES, VIDEO_STATUSES, VIDEO_STATUS } from '../../lib/enums.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import * as covers from '../../core/queue/covers.js';
import { publishReel } from '../../core/publishing/reel.js';
import * as accountsCore from '../../core/accounts/accounts.js';
import { moveTo } from '../../lib/files.js';
import { ConflictError } from '../../lib/errors.js';
import * as v from '../../lib/validate.js';

ensureDirs();
const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.paths.pending),
    filename: (req, file, cb) => cb(null, uniqueName(file.originalname)),
  }),
  fileFilter: (req, file, cb) => {
    // Aceita por mimetype OU por extensão. Confiar só no mimetype rejeitava
    // arquivos legítimos: .mkv e .mov chegam como application/octet-stream em
    // vários navegadores e sistemas, e o usuário via "formato não suportado"
    // para um vídeo perfeitamente válido.
    const porTipo = /^video\/(mp4|quicktime|x-matroska|webm|x-m4v)$/.test(file.mimetype);
    const porExtensao = /\.(mp4|mov|mkv|webm|m4v)$/i.test(file.originalname || '');
    const ok = porTipo || porExtensao;
    cb(ok ? null : new ValidationError(
      `Formato não suportado (${file.mimetype}). Envie MP4, MOV, MKV, WebM ou M4V.`,
    ), ok);
  },
  limits: { fileSize: config.limits.uploadBytes },
});

router.get('/', wrap(async (req, res) => {
  const where = {};
  if (req.query.accountId) where.accountId = req.query.accountId;
  if (req.query.status && req.query.status !== 'ALL') {
    where.status = v.oneOf(req.query.status, VIDEO_STATUSES, { field: 'Status' });
  }
  if (req.query.mediaType && req.query.mediaType !== 'ALL') {
    where.mediaType = v.oneOf(req.query.mediaType, MEDIA_TYPES, { field: 'Tipo' });
  }

  res.json(await prisma.video.findMany({ where, orderBy: { sortOrder: 'asc' } }));
}));

router.post('/', upload.array('videos', 100), wrap(async (req, res) => {
  const files = req.files || [];
  if (!files.length) throw new ValidationError('Nenhum vídeo enviado.');

  const account = await accounts.resolve(req.body.accountId);
  const mediaType = req.body.mediaType === MEDIA.STORY ? MEDIA.STORY : MEDIA.REEL;

  const last = await prisma.video.findFirst({
    where: { accountId: account.id },
    orderBy: { sortOrder: 'desc' },
  });
  let sortOrder = last ? last.sortOrder + 1 : 0;

  const created = [];
  for (const file of files) {
    const meta = await probe(file.path).catch(() => ({}));
    const video = await prisma.video.create({
      data: {
        accountId: account.id,
        filename: file.originalname,
        filepath: file.path,
        mediaType,
        sortOrder: sortOrder++,
        sizeBytes: sizeOf(file.path),
        durationSec: meta.durationSec ?? null,
        width: meta.width ?? null,
        height: meta.height ?? null,
      },
    });
    created.push(video);
    await logger.info({ action: 'VIDEO_ADICIONADO', accountId: account.id, videoName: video.filename });
  }

  await regenerate({ accountId: account.id });
  res.status(201).json(created);
}));

router.patch('/:id', wrap(async (req, res) => {
  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) throw new NotFoundError('Vídeo não encontrado.');

  const data = {};
  if (req.body.caption !== undefined) {
    data.caption = v.str(req.body.caption, { field: 'Legenda', min: 0, max: 2200 }) || null;
  }
  if (req.body.mediaType !== undefined) {
    data.mediaType = v.oneOf(req.body.mediaType, MEDIA_TYPES, { field: 'Tipo' });
  }

  res.json(await prisma.video.update({ where: { id: video.id }, data }));
}));

/** Reordena a fila de uma conta. Recebe os ids na ordem desejada. */
router.post('/reorder', wrap(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : null;
  if (!ids?.length) throw new ValidationError('Envie a lista de ids na nova ordem.');

  await prisma.$transaction(
    ids.map((id, index) => prisma.video.update({ where: { id }, data: { sortOrder: index } })),
  );

  const first = await prisma.video.findUnique({ where: { id: ids[0] } });
  if (first) await regenerate({ accountId: first.accountId });
  res.json({ ok: true, count: ids.length });
}));

/**
 * Remove da fila. Apaga também o arquivo, exceto se já foi publicado — nesse
 * caso o arquivo é o histórico do que foi ao ar.
 */
router.delete('/:id', wrap(async (req, res) => {
  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) throw new NotFoundError('Vídeo não encontrado.');

  if (video.status !== VIDEO_STATUS.PUBLISHED) {
    try { fs.unlinkSync(video.filepath); } catch { /* já pode não existir */ }
  }

  await prisma.video.delete({ where: { id: video.id } });
  // A capa é nomeada pelo hash e pode ser compartilhada com outros vídeos —
  // cleanupIfOrphan confere isso antes de apagar. Sem esta linha, remover um
  // vídeo pela lista deixava a imagem para trás, enquanto "remover
  // selecionados" limpava: mesma ação, resultados diferentes.
  if (video.coverPath) await covers.cleanupIfOrphan(video.coverPath);

  await regenerate({ accountId: video.accountId });
  await logger.info({ action: 'VIDEO_REMOVIDO', accountId: video.accountId, videoName: video.filename });
  res.json({ ok: true });
}));

/** Serve o arquivo para a prévia no painel. */
router.get('/:id/file', wrap(async (req, res) => {
  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) throw new NotFoundError('Vídeo não encontrado.');
  if (!fs.existsSync(video.filepath)) throw new NotFoundError('Arquivo não está mais no disco.');
  res.sendFile(path.resolve(video.filepath));
}));


// Capa em memória: o hash do conteúdo precisa ser calculado antes de gravar.
const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.limits.coverBytes },
});

/**
 * POST /:id/publish-now — publica IMEDIATAMENTE, fora do agendamento.
 *
 * UMA tentativa só, e devolve o resultado na hora: serve para o usuário
 * testar se a automação funciona sem esperar o próximo horário. O retry
 * automático do agendador mascararia um problema real de configuração.
 */
router.post('/:id/publish-now', wrap(async (req, res) => {
  const video = await prisma.video.findUnique({ where: { id: req.params.id }, include: { account: true } });
  if (!video) throw new NotFoundError('Vídeo não encontrado.');
  if (video.status === VIDEO_STATUS.PUBLISHED) throw new ConflictError('Esse vídeo já foi publicado.');
  if (video.mediaType === MEDIA.STORY) {
    throw new ConflictError('Stories não podem ser publicados pela web do Instagram.');
  }
  accountsCore.assertConnected(video.account);

  await prisma.video.update({ where: { id: video.id }, data: { status: VIDEO_STATUS.PUBLISHING } });
  await logger.info({
    action: 'PUBLICACAO_MANUAL', accountId: video.accountId, videoName: video.filename,
    message: 'Disparada pelo painel, fora do agendamento.',
  });

  try {
    const result = await publishReel({
      accountId: video.accountId,
      filepath: video.filepath,
      videoName: video.filename,
      caption: video.caption || video.account.fallbackCaption || '',
      coverPath: await covers.resolveFor(video),
    });

    const moved = moveTo(video.filepath, config.paths.published);
    await prisma.video.update({
      where: { id: video.id },
      data: { status: VIDEO_STATUS.PUBLISHED, publishedAt: new Date(), filepath: moved },
    });
    await logger.success({
      action: 'PUBLICACAO_MANUAL_OK', accountId: video.accountId,
      videoName: video.filename, durationMs: result.durationMs,
    });
    res.json({ ok: true, durationMs: result.durationMs });
  } catch (err) {
    // Volta para PENDING, não para FAILED: foi um teste manual, e marcar como
    // falha definitiva pausaria a conta por causa de uma tentativa avulsa.
    await prisma.video.update({ where: { id: video.id }, data: { status: VIDEO_STATUS.PENDING } });
    await logger.error({
      action: 'PUBLICACAO_MANUAL_FALHOU', accountId: video.accountId,
      videoName: video.filename, message: err.message,
    });
    throw err;
  }
}));

/** POST /bulk-delete — remove vários de uma vez. Publicados são preservados. */
router.post('/bulk-delete', wrap(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (!ids.length) throw new ValidationError('Envie a lista de ids.');

  const videos = await prisma.video.findMany({ where: { id: { in: ids } } });
  const removiveis = videos.filter((x) => x.status !== VIDEO_STATUS.PUBLISHED);

  for (const video of removiveis) {
    try { fs.unlinkSync(video.filepath); } catch { /* pode já não existir */ }
    if (video.coverPath) await covers.cleanupIfOrphan(video.coverPath);
  }
  await prisma.video.deleteMany({ where: { id: { in: removiveis.map((x) => x.id) } } });

  const contas = [...new Set(removiveis.map((x) => x.accountId))];
  for (const accountId of contas) await regenerate({ accountId });

  res.json({
    removed: removiveis.length,
    skipped: videos.length - removiveis.length,
  });
}));

/** POST /:id/cover — define a capa deste vídeo. */
router.post('/:id/cover', coverUpload.single('cover'), wrap(async (req, res) => {
  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) throw new NotFoundError('Vídeo não encontrado.');

  const filename = covers.save(req.file);
  const anterior = video.coverPath;

  const atualizado = await prisma.video.update({
    where: { id: video.id },
    data: { coverPath: filename },
  });

  if (anterior && anterior !== filename) await covers.cleanupIfOrphan(anterior);
  res.json(atualizado);
}));

router.delete('/:id/cover', wrap(async (req, res) => {
  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) throw new NotFoundError('Vídeo não encontrado.');

  const atualizado = await prisma.video.update({ where: { id: video.id }, data: { coverPath: null } });
  if (video.coverPath) await covers.cleanupIfOrphan(video.coverPath);
  res.json(atualizado);
}));

export default router;
