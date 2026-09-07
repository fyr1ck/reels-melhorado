import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { wrap } from '../middleware/errors.js';
import * as lib from '../../core/library/library.js';
import { normalizeHashtags, composeCaption, MAX_HASHTAGS } from '../../core/library/text.js';
import * as accounts from '../../core/accounts/accounts.js';
import { ValidationError } from '../../lib/errors.js';
import * as v from '../../lib/validate.js';

const router = Router();

// ---------- legendas ----------

router.get('/captions', wrap(async (req, res) => {
  res.json(await prisma.caption.findMany({ orderBy: { createdAt: 'desc' } }));
}));

router.post('/captions', wrap(async (req, res) => {
  const caption = await prisma.caption.create({
    data: {
      text: v.str(req.body.text, { field: 'Legenda', max: 2200 }),
      label: v.optional(req.body.label, v.str, { field: 'Apelido', min: 0, max: 40 }) || null,
      weight: req.body.weight === undefined ? 1 : v.int(req.body.weight, { field: 'Peso', min: 1, max: 10 }),
    },
  });
  res.status(201).json(caption);
}));

router.patch('/captions/:id', wrap(async (req, res) => {
  const data = {};
  if (req.body.text !== undefined) data.text = v.str(req.body.text, { field: 'Legenda', max: 2200 });
  if (req.body.label !== undefined) data.label = v.str(req.body.label, { field: 'Apelido', min: 0, max: 40 }) || null;
  if (req.body.weight !== undefined) data.weight = v.int(req.body.weight, { field: 'Peso', min: 1, max: 10 });
  if (req.body.enabled !== undefined) data.enabled = v.bool(req.body.enabled, { field: 'Ativa' });
  res.json(await prisma.caption.update({ where: { id: req.params.id }, data }));
}));

router.delete('/captions/:id', wrap(async (req, res) => {
  await prisma.caption.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

// ---------- hashtags ----------

router.get('/hashtags', wrap(async (req, res) => {
  const sets = await prisma.hashtagSet.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(sets.map(lib.decorateSet));
}));

router.post('/hashtags', wrap(async (req, res) => {
  const name = v.str(req.body.name, { field: 'Nome', max: 40 });
  const raw = v.str(req.body.raw, { field: 'Hashtags', max: 2000 });
  if (!normalizeHashtags(raw).length) throw new ValidationError('Informe ao menos uma hashtag válida.');

  res.status(201).json(lib.decorateSet(await prisma.hashtagSet.create({ data: { name, raw } })));
}));

router.patch('/hashtags/:id', wrap(async (req, res) => {
  const data = {};
  if (req.body.name !== undefined) data.name = v.str(req.body.name, { field: 'Nome', max: 40 });
  if (req.body.raw !== undefined) {
    data.raw = v.str(req.body.raw, { field: 'Hashtags', max: 2000 });
    if (!normalizeHashtags(data.raw).length) throw new ValidationError('Informe ao menos uma hashtag válida.');
  }
  if (req.body.enabled !== undefined) data.enabled = v.bool(req.body.enabled, { field: 'Ativo' });

  res.json(lib.decorateSet(await prisma.hashtagSet.update({ where: { id: req.params.id }, data })));
}));

router.delete('/hashtags/:id', wrap(async (req, res) => {
  await prisma.hashtagSet.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

// ---------- aplicação em lote ----------

async function applyHandler(req, res, dryRun) {
  const account = await accounts.resolve(req.body.accountId);
  res.json(await lib.applyToQueue({ ...req.body, accountId: account.id, dryRun }));
}

router.post('/preview', wrap((req, res) => applyHandler(req, res, true)));
router.post('/apply', wrap((req, res) => applyHandler(req, res, false)));

/** Prévia ao vivo enquanto o usuário digita, sem gravar nada. */
router.get('/compose', wrap((req, res) => {
  const tags = normalizeHashtags(req.query.hashtags);
  res.json({
    caption: composeCaption(req.query.text, tags),
    hashtags: tags,
    count: tags.length,
    max: MAX_HASHTAGS,
  });
}));

export default router;
