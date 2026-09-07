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

const router = Router();

/** Lista com as métricas de operação de cada conta (os cards do painel). */
router.get('/', wrap(async (req, res) => {
  await accounts.syncConnectionFlags();
  const list = await prisma.account.findMany({ orderBy: { sortOrder: 'asc' } });
  res.json(await Promise.all(list.map((a) => accounts.summarize(a))));
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
  if (b.scheduleMode !== undefined) {
    data.scheduleMode = v.oneOf(b.scheduleMode, SCHEDULE_MODES, { field: 'Modo de agendamento' });
  }
  if (b.intervalMinutes !== undefined) {
    data.intervalMinutes = v.int(b.intervalMinutes, { field: 'Intervalo', min: 1, max: 1440 });
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
