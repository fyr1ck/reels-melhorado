import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { wrap } from '../middleware/errors.js';

const router = Router();

/** Agenda e histórico. Sem `accountId` devolve tudo. */
router.get('/', wrap(async (req, res) => {
  const where = {};
  if (req.query.accountId) where.accountId = req.query.accountId;
  if (req.query.status && req.query.status !== 'ALL') where.status = req.query.status;

  const take = Math.min(500, Number(req.query.limit) || 200);
  res.json(await prisma.publication.findMany({
    where,
    orderBy: { scheduledAt: req.query.order === 'asc' ? 'asc' : 'desc' },
    take,
    include: {
      video: { select: { filename: true, mediaType: true, caption: true } },
      account: { select: { username: true } },
    },
  }));
}));

export default router;
