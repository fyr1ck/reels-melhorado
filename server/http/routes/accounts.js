import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { wrap } from '../middleware/errors.js';
import * as accounts from '../../core/accounts/accounts.js';
import * as auth from '../../core/accounts/auth.js';
import { regenerate } from '../../core/scheduling/scheduler.js';
import { closeContext } from '../../playwright/browser.js';
import * as logger from '../../core/log.js';
import { ACCOUNT_STATUSES, SCHEDULE_MODES } from '../../lib/enums.js';
import { ConflictError, ValidationError } from '../../lib/errors.js';
import * as v from '../../lib/validate.js';
import multer from 'multer';
import { config } from '../../config/env.js';
import * as covers from '../../core/queue/covers.js';
import * as recycle from '../../core/queue/recycle.js';
import * as publishDiag from '../../core/publishing/diagnostico.js';

const router = Router();

// Capa em memória: o nome do arquivo é o hash do conteúdo, calculado antes de
// gravar, então o multer não pode escrever direto no disco.
const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.limits.coverBytes },
});

/** Lista com as métricas de operação de cada conta (os cards do painel). */
router.get('/', wrap(async (req, res) => {
  await accounts.syncConnectionFlags();
  const list = await prisma.account.findMany({ orderBy: { sortOrder: 'asc' } });
  res.json(await accounts.summarizeAll(list));
}));

router.post('/', wrap(async (req, res) => {
  const username = v.username(req.body.username);
  const label = v.optional(req.body.label, v.str, { field: 'Apelido', min: 0, max: 60 });

  const last = await prisma.account.findFirst({ orderBy: { sortOrder: 'desc' } });
  const account = await prisma.account.create({
    data: { username, label: label || null, sortOrder: last ? last.sortOrder + 1 : 0 },
  });

  await logger.info({ action: 'CONTA_ADICIONADA', accountId: account.id, message: `@${username}` });
  res.status(201).json(account);
}));

router.patch('/:id', wrap(async (req, res) => {
  const account = await accounts.requireAccount(req.params.id);
  const b = req.body;

  // Só entra no patch o que veio no corpo — um PATCH parcial nunca zera
  // silenciosamente o que o cliente não mandou.
  const data = {};

  // Renomear é essencial: a conta padrão nasce como "conta-principal" e
  // precisa virar o @ real do Instagram. A sessão do navegador é guardada por
  // ID, não por nome, então trocar o @ não desconecta nada.
  if (b.username !== undefined) data.username = v.username(b.username);

  if (b.label !== undefined) data.label = v.str(b.label, { field: 'Apelido', min: 0, max: 60 }) || null;
  if (b.enabled !== undefined) data.enabled = v.bool(b.enabled, { field: 'Habilitada' });
  if (b.randomOrder !== undefined) data.randomOrder = v.bool(b.randomOrder, { field: 'Ordem aleatória' });
  if (b.fallbackCaption !== undefined) {
    data.fallbackCaption = v.str(b.fallbackCaption, { field: 'Legenda', min: 0, max: 2200 }) || null;
  }
  if (b.useDefaultCover !== undefined) {
    data.useDefaultCover = v.bool(b.useDefaultCover, { field: 'Usar capa da conta' });
  }
  if (b.scheduleMode !== undefined) {
    data.scheduleMode = v.oneOf(b.scheduleMode, SCHEDULE_MODES, { field: 'Modo de agendamento' });
  }
  if (b.intervalMinutes !== undefined) {
    data.intervalMinutes = v.int(b.intervalMinutes, { field: 'Intervalo', min: 1, max: 1440 });
  }
  if (b.postsPerDay !== undefined) {
    data.postsPerDay = v.int(b.postsPerDay, { field: 'Vídeos por dia', min: 1, max: 200 });
  }
  if (b.windowStart !== undefined) data.windowStart = v.time(b.windowStart, { field: 'Início da janela' });
  if (b.windowEnd !== undefined) data.windowEnd = v.time(b.windowEnd, { field: 'Fim da janela' });

  // Janela de duração zero não produz horário nenhum, e a fila ficaria parada
  // sem explicação. Vale a pena recusar na entrada.
  const inicioFinal = data.windowStart ?? account.windowStart;
  const fimFinal = data.windowEnd ?? account.windowEnd;
  if ((data.windowStart || data.windowEnd) && inicioFinal === fimFinal) {
    throw new ValidationError('O início e o fim da janela não podem ser iguais.');
  }
  // --- reciclagem ---
  if (b.recycleEnabled !== undefined) {
    data.recycleEnabled = v.bool(b.recycleEnabled, { field: 'Reciclagem' });
  }
  if (b.recycleAfterDays !== undefined) {
    data.recycleAfterDays = v.int(b.recycleAfterDays, { field: 'Carência da reciclagem', min: 1, max: 365 });
  }
  if (b.recycleMaxTimes !== undefined) {
    data.recycleMaxTimes = v.int(b.recycleMaxTimes, { field: 'Máximo de reciclagens', min: 0, max: 50 });
  }

  // --- limites de segurança ---
  if (b.dailyLimit !== undefined) {
    data.dailyLimit = v.int(b.dailyLimit, { field: 'Teto diário', min: 0, max: 200 });
  }
  // Silêncio: os dois campos andam juntos. String vazia desliga a janela, e
  // desligar só metade dela deixaria uma regra impossível de interpretar.
  if (b.quietStart !== undefined || b.quietEnd !== undefined) {
    const inicio = b.quietStart || null;
    const fim = b.quietEnd || null;
    if (!inicio || !fim) {
      data.quietStart = null;
      data.quietEnd = null;
    } else {
      data.quietStart = v.time(inicio, { field: 'Início do silêncio' });
      data.quietEnd = v.time(fim, { field: 'Fim do silêncio' });
      if (data.quietStart === data.quietEnd) {
        throw new ValidationError('O início e o fim do silêncio não podem ser iguais — isso silenciaria as 24 horas.');
      }
    }
  }
  if (b.warmupDays !== undefined) {
    data.warmupDays = v.int(b.warmupDays, { field: 'Dias de aquecimento', min: 1, max: 90 });
  }
  if (b.warmupTarget !== undefined) {
    data.warmupTarget = v.int(b.warmupTarget, { field: 'Alvo do aquecimento', min: 1, max: 50 });
  }
  if (b.warmupEnabled !== undefined) {
    // Ligar marca o início AGORA; religar sem querer não pode reiniciar a
    // rampa de quem já está no dia 12.
    const ligar = v.bool(b.warmupEnabled, { field: 'Aquecimento' });
    if (!ligar) data.warmupStartAt = null;
    else if (!account.warmupStartAt) data.warmupStartAt = new Date();
  }

  if (b.status !== undefined) {
    data.status = v.oneOf(b.status, ACCOUNT_STATUSES, { field: 'Estado' });
    // Ativar sem sessão só geraria falha em loop e pausaria de novo.
    if (data.status === 'ACTIVE') accounts.assertConnected(account);
  }

  const updated = await prisma.account.update({ where: { id: account.id }, data });
  await regenerate({ accountId: account.id });
  res.json(updated);
}));

/**
 * POST /:id/cover — capa padrão DESTA conta.
 *
 * Cada perfil costuma ter identidade visual própria. A capa da conta entra em
 * todo vídeo novo que não traz a sua, e perde só para a capa individual.
 */
router.post('/:id/cover', coverUpload.single('cover'), wrap(async (req, res) => {
  const account = await accounts.requireAccount(req.params.id);
  const filename = covers.save(req.file);
  const anterior = account.defaultCoverPath;

  const updated = await prisma.account.update({
    where: { id: account.id },
    data: { defaultCoverPath: filename, useDefaultCover: true },
  });

  // A imagem é nomeada pelo hash e pode ser compartilhada com vídeos e com
  // outras contas — cleanupIfOrphan confere isso antes de apagar.
  if (anterior && anterior !== filename) await covers.cleanupIfOrphan(anterior);

  await logger.info({
    action: 'CAPA_DA_CONTA_DEFINIDA', accountId: account.id,
    message: `Capa padrão de @${account.username}.`,
  });
  res.json(updated);
}));

router.delete('/:id/cover', wrap(async (req, res) => {
  const account = await accounts.requireAccount(req.params.id);
  const updated = await prisma.account.update({
    where: { id: account.id },
    data: { defaultCoverPath: null, useDefaultCover: false },
  });
  if (account.defaultCoverPath) await covers.cleanupIfOrphan(account.defaultCoverPath);
  res.json(updated);
}));

/** GET /:id/recycle — quantos vídeos já cumpriram a carência, sem mexer em nada. */
router.get('/:id/recycle', wrap(async (req, res) => {
  const account = await accounts.requireAccount(req.params.id);
  res.json(await recycle.previa(account));
}));

/**
 * POST /:id/recycle — devolve à fila agora, sem esperar o agendador.
 *
 * Existe para quem quer ver o efeito na hora, em vez de descobrir amanhã se
 * a configuração estava certa.
 */
router.post('/:id/recycle', wrap(async (req, res) => {
  const account = await accounts.requireAccount(req.params.id);
  if (!account.recycleEnabled) {
    throw new ValidationError('Ligue a reciclagem desta conta antes de rodar.');
  }
  const r = await recycle.reciclar(account, { limite: 50 });
  await regenerate({ accountId: account.id });
  res.json(r);
}));

/**
 * GET /:id/diagnostico — o que a página do Instagram mostra agora.
 *
 * Para quando a publicação falhar com "botão não encontrado": diz se a sessão
 * caiu, quais seletores casam, e todos os rótulos clicáveis da tela — que é de
 * onde sai o seletor novo quando o Instagram renomeia um botão.
 */
router.get('/:id/diagnostico', wrap(async (req, res) => {
  const account = await accounts.requireAccount(req.params.id);
  accounts.assertConnected(account);
  res.json(await publishDiag.inspecionar(account.id));
}));

/** Define a conta usada pelas telas quando nenhuma está selecionada. */
router.post('/:id/default', wrap(async (req, res) => {
  const account = await accounts.requireAccount(req.params.id);
  await prisma.account.updateMany({ data: { isDefault: false } });
  res.json(await prisma.account.update({ where: { id: account.id }, data: { isDefault: true } }));
}));

/**
 * Abre o navegador para login manual. A senha nunca passa pelo app: quem
 * digita é o usuário, na janela real, incluindo 2FA e CAPTCHA.
 */
router.post('/:id/connect', wrap(async (req, res) => {
  const account = await accounts.requireAccount(req.params.id);
  res.json(await auth.connect(account));
}));

router.post('/:id/disconnect', wrap(async (req, res) => {
  const account = await accounts.requireAccount(req.params.id);
  await closeContext(account.id);
  accounts.dropSession(account.id);
  // Sem sessão a automação não roda; pausar evita falha em loop.
  res.json(await prisma.account.update({
    where: { id: account.id },
    data: { connected: false, status: 'PAUSED' },
  }));
}));

/**
 * Remove a conta. Os vídeos vão junto (cascade) porque um vídeo sem conta não
 * teria como ser publicado — mas os ARQUIVOS em disco permanecem.
 */
router.delete('/:id', wrap(async (req, res) => {
  const account = await accounts.requireAccount(req.params.id);

  if (await prisma.account.count() === 1) {
    throw new ConflictError('Essa é a única conta. O app precisa de ao menos uma.');
  }

  await closeContext(account.id);
  accounts.dropSession(account.id);
  await prisma.account.delete({ where: { id: account.id } });

  if (account.isDefault) await accounts.ensureDefault();

  await logger.info({ action: 'CONTA_REMOVIDA', message: `@${account.username}` });
  res.json({ ok: true });
}));

/** Chave-mestra: liga/pausa a automação de todas as contas conectadas. */
router.post('/automation/:action', wrap(async (req, res) => {
  const action = v.oneOf(req.params.action, ['start', 'pause'], { field: 'Ação' });

  if (action === 'pause') {
    await prisma.account.updateMany({ data: { status: 'PAUSED' } });
    await logger.info({ action: 'AUTOMACAO_PAUSADA' });
    return res.json({ ok: true, affected: await prisma.account.count() });
  }

  const enabled = await prisma.account.findMany({ where: { enabled: true } });
  const ready = enabled.filter((a) => accounts.hasSession(a.id));

  if (!ready.length) {
    throw new ValidationError(
      enabled.length === 0
        ? 'Nenhuma conta habilitada. Adicione uma em Contas.'
        : 'Nenhuma conta conectada ao Instagram. Conecte ao menos uma antes de iniciar.',
    );
  }

  await regenerate();
  await prisma.account.updateMany({
    where: { id: { in: ready.map((a) => a.id) } },
    data: { status: 'ACTIVE' },
  });
  await logger.info({ action: 'AUTOMACAO_INICIADA', message: `${ready.length} conta(s).` });
  res.json({ ok: true, affected: ready.length });
}));

export default router;
