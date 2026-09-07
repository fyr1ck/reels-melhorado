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
import * as v from '../../lib/validate.js';

ensureDirs();
const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.paths.pending),
    filename: (req, file, cb) => cb(null, uniqueName(file.originalname)),
  }),
  fileFilter: (req, file, cb) => {
    const ok = /video\/(mp4|quicktime|x-matroska|webm)/.test(file.mimetype);
    cb(ok ? null : new ValidationError(`Formato não suportado: ${file.mimetype}`), ok);
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

export default router;
