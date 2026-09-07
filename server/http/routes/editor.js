import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../db/prisma.js';
import { config } from '../../config/env.js';
import { wrap } from '../middleware/errors.js';
import { uniqueName, sizeOf, ensureDirs } from '../../lib/files.js';
import { probe } from '../../lib/media.js';
import * as batch from '../../core/editor/batch.js';
import { defaultTemplateConfig, mergeTemplateConfig } from '../../core/editor/layout.js';
import * as accounts from '../../core/accounts/accounts.js';
import { MEDIA, MEDIA_TYPES } from '../../lib/enums.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import * as v from '../../lib/validate.js';
import { ConflictError } from '../../lib/errors.js';

ensureDirs();
const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.paths.editorSource),
    filename: (req, file, cb) => cb(null, uniqueName(file.originalname)),
  }),
  limits: { fileSize: config.limits.uploadBytes },
});

// ---------- vídeos de origem ----------

router.get('/sources', wrap(async (req, res) => {
  res.json(await prisma.sourceVideo.findMany({ orderBy: { createdAt: 'desc' } }));
}));

router.post('/sources', upload.array('videos', 200), wrap(async (req, res) => {
  const files = req.files || [];
  if (!files.length) throw new ValidationError('Nenhum vídeo enviado.');

  const criados = [];
  for (const f of files) {
    const meta = await probe(f.path).catch(() => ({}));
    criados.push(await prisma.sourceVideo.create({
      data: {
        filename: f.originalname, filepath: f.path,
        sizeBytes: sizeOf(f.path), durationSec: meta.durationSec ?? null,
        width: meta.width ?? null, height: meta.height ?? null,
      },
    }));
  }
  res.status(201).json(criados);
}));

router.delete('/sources/:id', wrap(async (req, res) => {
  const s = await prisma.sourceVideo.findUnique({ where: { id: req.params.id } });
  if (!s) throw new NotFoundError('Vídeo não encontrado.');
  try { fs.unlinkSync(s.filepath); } catch { /* pode já não existir */ }
  await prisma.sourceVideo.delete({ where: { id: s.id } });
  res.json({ ok: true });
}));

// ---------- recursos do template (foto, logo, fundo) ----------

const assetUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.paths.editorAssets),
    filename: (req, file, cb) => cb(null, uniqueName(file.originalname)),
  }),
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|webp)$/.test(file.mimetype);
    cb(ok ? null : new ValidationError('Use uma imagem JPG, PNG ou WebP.'), ok);
  },
  limits: { fileSize: config.limits.coverBytes },
});

/** O template guarda só o NOME do arquivo; o caminho é resolvido na hora de
    renderizar, para o template continuar válido se a pasta mudar de lugar. */
router.post('/assets', assetUpload.single('asset'), wrap((req, res) => {
  if (!req.file) throw new ValidationError('Nenhuma imagem enviada.');
  res.status(201).json({ filename: path.basename(req.file.path), url: `/api/editor/assets/${path.basename(req.file.path)}` });
}));

router.get('/assets/:filename', wrap((req, res) => {
  // basename impede que "../.." saia da pasta de recursos.
  const full = path.join(config.paths.editorAssets, path.basename(req.params.filename));
  if (!fs.existsSync(full)) throw new NotFoundError('Recurso não encontrado.');
  res.sendFile(full);
}));

// ---------- templates ----------

router.get('/templates', wrap(async (req, res) => {
  res.json(await prisma.template.findMany({ orderBy: { updatedAt: 'desc' } }));
}));

router.get('/templates/default', wrap((req, res) => res.json(defaultTemplateConfig())));

router.post('/templates', wrap(async (req, res) => {
  const t = await prisma.template.create({
    data: {
      name: v.str(req.body.name, { field: 'Nome', max: 60 }),
      config: JSON.stringify(mergeTemplateConfig(req.body.config || {})),
    },
  });
  res.status(201).json(t);
}));

router.patch('/templates/:id', wrap(async (req, res) => {
  const data = {};
  if (req.body.name !== undefined) data.name = v.str(req.body.name, { field: 'Nome', max: 60 });
  if (req.body.config !== undefined) data.config = JSON.stringify(mergeTemplateConfig(req.body.config));
  res.json(await prisma.template.update({ where: { id: req.params.id }, data }));
}));

router.delete('/templates/:id', wrap(async (req, res) => {
  await prisma.template.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

// ---------- lotes ----------

router.get('/batches', wrap(async (req, res) => {
  const lotes = await prisma.batch.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: {
      template: { select: { name: true } },
      account: { select: { username: true } },
      _count: { select: { items: true } },
    },
  });
  // Anexa o progresso vivo de quem está rodando: o banco só guarda marcos.
  res.json(lotes.map((l) => ({ ...l, live: batch.progressOf(l.id) })));
}));

router.get('/batches/:id', wrap(async (req, res) => {
  const lote = await prisma.batch.findUnique({
    where: { id: req.params.id },
    include: {
      template: { select: { name: true } },
      account: { select: { username: true } },
      items: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!lote) throw new NotFoundError('Lote não encontrado.');
  res.json({ ...lote, live: batch.progressOf(lote.id) });
}));

router.post('/batches', wrap(async (req, res) => {
  const account = await accounts.resolve(req.body.accountId);
  const templateId = v.id(req.body.templateId, { field: 'Template' });
  const sourceIds = Array.isArray(req.body.sourceIds) ? req.body.sourceIds : [];
  if (!sourceIds.length) throw new ValidationError('Selecione ao menos um vídeo.');

  const template = await prisma.template.findUnique({ where: { id: templateId } });
  if (!template) throw new NotFoundError('Template não encontrado.');

  const sources = await prisma.sourceVideo.findMany({ where: { id: { in: sourceIds } } });
  if (!sources.length) throw new ValidationError('Nenhum dos vídeos selecionados existe.');

  const lote = await prisma.batch.create({
    data: {
      templateId, accountId: account.id,
      mediaType: req.body.mediaType ? v.oneOf(req.body.mediaType, MEDIA_TYPES, { field: 'Tipo' }) : MEDIA.REEL,
      total: sources.length,
      concurrency: req.body.concurrency ? v.int(req.body.concurrency, { field: 'Paralelismo', min: 1, max: 4 }) : 2,
      autoQueue: req.body.autoQueue === undefined ? true : v.bool(req.body.autoQueue, { field: 'Enviar à fila' }),
      autoSchedule: req.body.autoSchedule === undefined ? false : v.bool(req.body.autoSchedule, { field: 'Agendar' }),
      varyOutputs: req.body.varyOutputs === undefined ? false : v.bool(req.body.varyOutputs, { field: 'Variar cópias' }),
      items: {
        create: sources.map((s) => ({
          templateId, sourceName: s.filename, sourcePath: s.filepath,
        })),
      },
    },
    include: { items: true },
  });

  res.status(201).json({ ...lote, ...(await batch.start(lote.id)) });
}));

router.post('/batches/:id/cancel', wrap((req, res) => {
  batch.cancel(req.params.id);
  res.json({ ok: true });
}));

/**
 * Reprocessa um item que falhou, sem refazer o lote inteiro.
 * Falha costuma ser de UM vídeo (corrompido, codec estranho); reprocessar
 * dezenas por causa de um seria desperdício.
 */
router.post('/items/:id/retry', wrap(async (req, res) => {
  const item = await prisma.batchItem.findUnique({ where: { id: req.params.id }, include: { batch: true } });
  if (!item) throw new NotFoundError('Item não encontrado.');
  if (batch.isRunning(item.batchId)) throw new ConflictError('O lote está em execução. Aguarde terminar.');

  await prisma.batchItem.update({
    where: { id: item.id },
    data: { status: 'PENDING', progress: 0, errorMessage: null, outputPath: null, outputName: null },
  });
  res.json(await batch.start(item.batchId));
}));

router.post('/batches/:id/queue', wrap(async (req, res) => {
  res.json(await batch.addToQueue(req.params.id, { autoSchedule: !!req.body.autoSchedule }));
}));

export default router;
