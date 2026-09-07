import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { wrap } from '../middleware/errors.js';
import * as v from '../../lib/validate.js';

const router = Router();

router.get('/', wrap(async (req, res) => {
  const take = req.query.limit ? v.int(req.query.limit, { field: 'Limite', min: 1, max: 1000 }) : 200;
  const where = {};
  if (req.query.level && req.query.level !== 'ALL') where.level = req.query.level;
  if (req.query.accountId) where.accountId = req.query.accountId;

  res.json(await prisma.logEntry.findMany({ where, orderBy: { createdAt: 'desc' }, take }));
}));

router.delete('/', wrap(async (req, res) => {
  const { count } = await prisma.logEntry.deleteMany();
  res.json({ ok: true, deleted: count });
}));

export default router;
