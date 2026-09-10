import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { wrap } from '../middleware/errors.js';
import { ValidationError, NotFoundError } from '../../lib/errors.js';
import * as niches from '../../core/niches/niches.js';
import * as classify from '../../core/niches/classify.js';
import { contextoDe, ranquear } from '../../core/niches/classifier.js';
import * as logger from '../../core/log.js';
import * as v from '../../lib/validate.js';

/**
 * A API da separação por nichos.
 *
 * Router NOVO, montado em /api/niches. Nenhuma rota existente muda de
 * comportamento: o que já respondia continua respondendo igual.
 */

const router = Router();

// ------------------------------------------------------------------ nichos

router.get('/', wrap(async (req, res) => {
  res.json(await niches.listar({ apenasAtivos: req.query.ativos === '1' }));
}));

router.get('/config', wrap(async (req, res) => {
  res.json(await classify.config());
}));

router.post('/', wrap(async (req, res) => {
  const niche = await niches.criar(req.body);
  await logger.info({ action: 'NICHO_CRIADO', message: niche.name });
  res.status(201).json(niche);
}));

router.patch('/:id', wrap(async (req, res) => {
  res.json(await niches.atualizar(req.params.id, req.body));
}));

router.post('/:id/duplicate', wrap(async (req, res) => {
  const copia = await niches.duplicar(req.params.id);
  await logger.info({ action: 'NICHO_DUPLICADO', message: copia.name });
  res.status(201).json(copia);
}));

router.delete('/:id', wrap(async (req, res) => {
  const niche = await niches.obter(req.params.id);
  await niches.remover(req.params.id);
  await logger.warn({
    action: 'NICHO_REMOVIDO',
    message: `"${niche.name}" foi excluído. Os vídeos já classificados continuam na fila, sem nicho.`,
  });
  res.status(204).end();
}));

/**
 * POST /:id/testar — experimenta um texto contra os nichos, sem gravar nada.
 *
 * Existe para o usuário calibrar o cadastro ANTES de deixar o sistema decidir
 * por ele: dá para colar o nome de um arquivo real e ver a nota e os motivos
 * na hora, em vez de descobrir pela fila bloqueada.
 */
router.post('/testar', wrap(async (req, res) => {
  const texto = v.str(req.body.texto, { field: 'Texto', min: 1, max: 2000 });
  const lista = await prisma.niche.findMany({ where: { active: true } });

  const ctx = contextoDe({
    filename: texto,
    caption: req.body.caption ?? '',
    folderPath: req.body.folderPath ?? '',
  });

  const cfg = await classify.config();
  res.json({ ranking: ranquear(ctx, lista), limiares: { approve: cfg.approve, review: cfg.review } });
}));

// ------------------------------------------- vínculo com as contas EXISTENTES

router.get('/accounts/:accountId', wrap(async (req, res) => {
  res.json(await niches.daConta(req.params.accountId));
}));

router.put('/accounts/:accountId', wrap(async (req, res) => {
  const out = await niches.definirDaConta(req.params.accountId, {
    primaryNicheId: req.body.primaryNicheId ?? null,
    secondaryNicheIds: Array.isArray(req.body.secondaryNicheIds) ? req.body.secondaryNicheIds : [],
  });
  res.json(out);
}));

// ------------------------------------------------------------ classificação

/** POST /classify — (re)classifica vídeos. Sem corpo, pega o que falta. */
router.post('/classify', wrap(async (req, res) => {
  let ids = Array.isArray(req.body?.videoIds) ? req.body.videoIds : null;

  if (!ids) {
    const pendentes = await prisma.video.findMany({
      where: {
        status: { in: ['PENDING', 'SCHEDULED'] },
        ...(req.body?.somenteNaoClassificados === false ? {} : { classification: { is: null } }),
      },
      select: { id: true },
      take: 500,
    });
    ids = pendentes.map((x) => x.id);
  }

  if (!ids.length) return res.json({ ok: 0, falhas: 0, message: 'Nada para classificar.' });

  const r = await classify.classificarVarios(ids, { forcarIa: req.body?.usarIa ?? null });
  await logger.info({
    action: 'NICHO_CLASSIFICACAO',
    message: `${r.ok} vídeo(s) classificados, ${r.falhas} falha(s).`,
  });
  res.json(r);
}));

/** GET /queue — a fila com a classificação junto, para a tela de revisão. */
router.get('/queue', wrap(async (req, res) => {
  const status = req.query.status;
  const where = { status: { in: ['PENDING', 'SCHEDULED', 'FAILED'] } };

  if (status && status !== 'ALL') {
    where.classification = status === 'SEM_CLASSIFICACAO'
      // "Sem classificação" inclui quem nunca foi classificado: para quem olha
      // a tela, vídeo sem nicho e vídeo sem análise são o mesmo problema.
      ? { is: { status: 'SEM_CLASSIFICACAO' } }
      : { is: { status } };
  }

  const videos = await prisma.video.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 300,
    include: {
      account: { select: { id: true, username: true, label: true } },
      classification: { include: { niche: { select: { id: true, name: true } } } },
    },
  });

  res.json(videos.map((video) => ({
    ...video,
    classification: video.classification && {
      ...video.classification,
      scores: parse(video.classification.scores),
      reasons: parse(video.classification.reasons),
    },
  })));
}));

/**
 * POST /decide/:videoId — a decisão humana da tela de revisão.
 *
 * Aceita trocar o nicho, trocar a conta, ou só liberar. Move o vídeo entre
 * contas usando o campo que a fila JÁ usa (`accountId`): não há segunda fila
 * nem estado paralelo.
 */
router.post('/decide/:videoId', wrap(async (req, res) => {
  const video = await prisma.video.findUnique({ where: { id: req.params.videoId } });
  if (!video) throw new NotFoundError('Vídeo não encontrado.');

  const acao = v.oneOf(req.body.acao, ['APROVAR', 'BLOQUEAR', 'RECLASSIFICAR'], { field: 'Ação' });

  if (acao === 'RECLASSIFICAR') {
    const cls = await classify.classificar(video.id, { forcarIa: req.body.usarIa ?? null });
    return res.json({ acao, classification: cls });
  }

  // Trocar de conta é opcional e usa o caminho normal da fila.
  if (req.body.accountId && req.body.accountId !== video.accountId) {
    const destino = await prisma.account.findUnique({ where: { id: req.body.accountId } });
    if (!destino) throw new ValidationError('Conta de destino não existe.');

    await prisma.video.update({ where: { id: video.id }, data: { accountId: destino.id } });
    await logger.info({
      action: 'NICHO_VIDEO_MOVIDO', accountId: destino.id, videoName: video.filename,
      message: `Movido para @${destino.username} pela tela de revisão.`,
    });
  }

  const dados = {
    status: acao === 'APROVAR' ? 'APROVADO' : 'BLOQUEADO',
    reviewedAt: new Date(),
    reviewNote: req.body.nota ? String(req.body.nota).slice(0, 500) : null,
  };
  if (req.body.nicheId) dados.nicheId = req.body.nicheId;

  const cls = await prisma.contentClassification.upsert({
    where: { videoId: video.id },
    create: { videoId: video.id, score: acao === 'APROVAR' ? 100 : 0, source: 'REGRAS', ...dados },
    update: dados,
  });

  // Aprovar um vídeo que a validação tinha reprovado precisa devolvê-lo à
  // fila: senão a decisão da pessoa não teria efeito nenhum.
  if (acao === 'APROVAR' && video.status === 'FAILED') {
    await prisma.video.update({
      where: { id: video.id },
      data: { status: 'PENDING', failedAt: null },
    });
  }

  await logger.info({
    action: acao === 'APROVAR' ? 'NICHO_APROVADO_MANUAL' : 'NICHO_BLOQUEADO_MANUAL',
    videoName: video.filename,
  });

  res.json({ acao, classification: cls });
}));

/** GET /stats — os números que o Dashboard mostra. */
router.get('/stats', wrap(async (req, res) => {
  const porStatus = await prisma.contentClassification.groupBy({
    by: ['status'],
    _count: { _all: true },
  });

  const porNicho = await prisma.contentClassification.groupBy({
    by: ['nicheId'],
    _count: { _all: true },
    where: { nicheId: { not: null } },
  });

  const nomes = new Map(
    (await prisma.niche.findMany({ select: { id: true, name: true } })).map((n) => [n.id, n.name]),
  );

  const semAnalise = await prisma.video.count({
    where: { status: { in: ['PENDING', 'SCHEDULED'] }, classification: { is: null } },
  });

  res.json({
    status: Object.fromEntries(porStatus.map((s) => [s.status, s._count._all])),
    porNicho: porNicho
      .map((n) => ({ nicheId: n.nicheId, name: nomes.get(n.nicheId) ?? '(removido)', total: n._count._all }))
      .sort((a, b) => b.total - a.total),
    semAnalise,
    config: await classify.config(),
  });
}));

/**
 * GET /:id — POR ÚLTIMO, de propósito.
 *
 * O Express casa as rotas na ordem em que foram registradas, e `/:id` casa com
 * qualquer coisa. Declarado antes, ele engolia `/stats`, `/queue` e `/config`:
 * a tela pedia as estatísticas e recebia "Nicho não encontrado", com um 404
 * que não dizia nada sobre a causa.
 */
router.get('/:id', wrap(async (req, res) => {
  res.json(await niches.obter(req.params.id));
}));

function parse(texto) {
  try {
    return JSON.parse(texto ?? '[]');
  } catch {
    return [];
  }
}

export default router;
