import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { wrap } from '../middleware/errors.js';
import * as accounts from '../../core/accounts/accounts.js';
import { regenerate } from '../../core/scheduling/scheduler.js';
import { describeSlot } from '../../core/scheduling/slots.js';
import { MEDIA_TYPES, MEDIA } from '../../lib/enums.js';
import { NotFoundError } from '../../lib/errors.js';
import * as v from '../../lib/validate.js';

const router = Router();

router.get('/', wrap(async (req, res) => {
  const account = await accounts.resolve(req.query.accountId);
  const where = { accountId: account.id };
  if (req.query.mediaType) where.mediaType = v.oneOf(req.query.mediaType, MEDIA_TYPES, { field: 'Tipo' });

  const slots = await prisma.slot.findMany({ where, orderBy: { time: 'asc' } });
  // A descrição da janela vem pronta do servidor: a regra de jitter mora num
  // lugar só, e o front não precisa reimplementá-la para exibir.
  res.json(slots.map((s) => ({ ...s, window: describeSlot(s.time, s.jitterMinutes) })));
}));

router.post('/', wrap(async (req, res) => {
  const account = await accounts.resolve(req.body.accountId);
  const time = v.time(req.body.time);
  const mediaType = req.body.mediaType
    ? v.oneOf(req.body.mediaType, MEDIA_TYPES, { field: 'Tipo' })
    : MEDIA.REEL;

  const slot = await prisma.slot.create({ data: { accountId: account.id, time, mediaType } });
  await regenerate({ accountId: account.id });
  res.status(201).json(slot);
}));

router.patch('/:id', wrap(async (req, res) => {
  const slot = await prisma.slot.findUnique({ where: { id: req.params.id } });
  if (!slot) throw new NotFoundError('Horário não encontrado.');

  const data = {};
  if (req.body.enabled !== undefined) data.enabled = v.bool(req.body.enabled, { field: 'Ativo' });
  if (req.body.jitterMinutes !== undefined) {
    data.jitterMinutes = v.int(req.body.jitterMinutes, { field: 'Variação', min: 0, max: 120 });
  }
  if (req.body.time !== undefined) data.time = v.time(req.body.time);

  const updated = await prisma.slot.update({ where: { id: slot.id }, data });
  await regenerate({ accountId: slot.accountId });
  res.json({ ...updated, window: describeSlot(updated.time, updated.jitterMinutes) });
}));

router.delete('/:id', wrap(async (req, res) => {
  const slot = await prisma.slot.findUnique({ where: { id: req.params.id } });
  if (!slot) throw new NotFoundError('Horário não encontrado.');

  await prisma.slot.delete({ where: { id: slot.id } });
  await regenerate({ accountId: slot.accountId });
  res.json({ ok: true });
}));

export default router;
