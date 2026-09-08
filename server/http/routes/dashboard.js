import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { wrap } from '../middleware/errors.js';
import * as accounts from '../../core/accounts/accounts.js';
import { isInterventionPending, getInterventionMessage, resolveIntervention } from '../../core/publishing/intervention.js';
import { VIDEO_STATUS, ACCOUNT_STATUS, OPEN_STATUSES } from '../../lib/enums.js';

const router = Router();

/**
 * Panorama geral. O estado da automação é DERIVADO das contas — na versão
 * anterior existia uma flag global que ninguém mais lia, e o painel exibia
 * "Ativa" com nada publicando.
 */
router.get('/', wrap(async (req, res) => {
  const list = await prisma.account.findMany({ orderBy: { sortOrder: 'asc' } });
  const summaries = await accounts.summarizeAll(list);

  const active = summaries.filter((a) => a.enabled && a.status === ACCOUNT_STATUS.ACTIVE);
  const connected = list.filter((a) => accounts.hasSession(a.id));

  const [totals, next, recentErrors, todayDone] = await Promise.all([
    prisma.video.groupBy({ by: ['status'], _count: true }),
    prisma.publication.findFirst({
      where: { status: VIDEO_STATUS.SCHEDULED },
      orderBy: { scheduledAt: 'asc' },
      include: { video: { select: { filename: true } }, account: { select: { username: true } } },
    }),
    prisma.logEntry.findMany({ where: { level: 'ERROR' }, orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.publication.count({
      where: {
        status: VIDEO_STATUS.PUBLISHED,
        publishedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    }),
  ]);

  const count = (s) => totals.find((t) => t.status === s)?._count ?? 0;
  const queued = OPEN_STATUSES.reduce((sum, s) => sum + count(s), 0);

  // Cobertura da instalação: soma das filas dividida pela soma dos ritmos.
  const rate = summaries.reduce((sum, a) => sum + a.dailyRate, 0);
  const reels = summaries.reduce((sum, a) => sum + a.reels, 0);

  res.json({
    accounts: { total: list.length, active: active.length, connected: connected.length },
    videos: {
      queued,
      pending: count(VIDEO_STATUS.PENDING),
      scheduled: count(VIDEO_STATUS.SCHEDULED),
      published: count(VIDEO_STATUS.PUBLISHED),
      failed: count(VIDEO_STATUS.FAILED),
      noCaption: await prisma.video.count({
        where: { status: { in: OPEN_STATUSES }, OR: [{ caption: null }, { caption: '' }] },
      }),
    },
    coverageDays: rate > 0 ? Number((reels / rate).toFixed(1)) : null,
    dailyRate: Number(rate.toFixed(2)),
    todayDone,
    automation: {
      running: active.length > 0,
      activeAccounts: active.length,
      intervention: isInterventionPending(),
      interventionMessage: getInterventionMessage(),
    },
    next: next && {
      at: next.scheduledAt,
      filename: next.video?.filename,
      account: next.account?.username,
    },
    recentErrors,
    perAccount: summaries,
  });
}));

/** Confirma que a verificação de segurança foi resolvida na janela do navegador. */
router.post('/intervention/resolve', wrap((req, res) => {
  res.json({ ok: resolveIntervention() });
}));

export default router;
