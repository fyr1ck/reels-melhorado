import { prisma } from '../db/prisma.js';
import { ValidationError } from '../lib/errors.js';
import * as logger from './log.js';

/**
 * Exportar e restaurar a configuração.
 *
 * Fila, horários, legendas, hashtags, templates e pastas moram num único
 * arquivo SQLite. Corrompeu ou formatou, perdeu tudo — inclusive o trabalho de
 * montar a grade de cada conta. Um JSON resolve isso sem depender de nenhuma
 * biblioteca nova.
 *
 * O que este backup NÃO carrega, e por quê:
 *
 * - As SESSÕES do navegador. São arquivos de cookie por conta em
 *   playwright/session/, e copiá-los para outra máquina é justamente o que o
 *   Instagram trata como sessão roubada. Restaurar exige reconectar cada
 *   conta, com 2FA — o que também é a proteção de quem perder o backup.
 * - Os VÍDEOS. São gigabytes; o backup guarda o registro (nome, legenda, capa,
 *   posição na fila) e o caminho de cada um. Se os arquivos continuarem no
 *   lugar, a fila volta inteira.
 */

export const VERSAO = 1;

/** Monta o objeto de backup. Só dados que fazem sentido restaurar. */
export async function exportar() {
  const [accounts, videos, slots, captions, hashtagSets, templates, watchFolders, settings] =
    await Promise.all([
      prisma.account.findMany({ orderBy: { sortOrder: 'asc' } }),
      prisma.video.findMany({ orderBy: [{ accountId: 'asc' }, { sortOrder: 'asc' }] }),
      prisma.slot.findMany(),
      prisma.caption.findMany(),
      prisma.hashtagSet.findMany(),
      prisma.template.findMany(),
      prisma.watchFolder.findMany(),
      prisma.settings.findUnique({ where: { id: 1 } }),
    ]);

  // Os tokens de aviso ficam de fora: um backup costuma ir para a nuvem ou
  // para o WhatsApp, e um token de bot vazado dá controle sobre o canal.
  const { telegramBotToken, telegramChatId, webhookUrl, ...settingsSeguro } = settings ?? {};

  return {
    versao: VERSAO,
    geradoEm: new Date().toISOString(),
    aviso: 'Sessões do navegador e arquivos de vídeo NÃO estão aqui. Depois de restaurar, reconecte cada conta.',
    conteudo: {
      accounts, videos, slots, captions, hashtagSets, templates, watchFolders,
      settings: settingsSeguro,
    },
    resumo: {
      contas: accounts.length,
      videos: videos.length,
      horarios: slots.length,
      legendas: captions.length,
      hashtags: hashtagSets.length,
      templates: templates.length,
      pastas: watchFolders.length,
    },
  };
}

/**
 * Restaura um backup.
 *
 * `modo: 'merge'` (padrão) só ACRESCENTA o que não existe, casando pelo campo
 * natural de cada tabela — restaurar duas vezes não duplica nada. `modo:
 * 'replace'` apaga tudo antes; é destrutivo e por isso precisa ser pedido
 * explicitamente.
 */
export async function restaurar(backup, { modo = 'merge' } = {}) {
  if (!backup || typeof backup !== 'object') {
    throw new ValidationError('Arquivo de backup inválido.');
  }
  if (backup.versao !== VERSAO) {
    throw new ValidationError(
      `Backup na versão ${backup.versao ?? '?'}; este app lê a versão ${VERSAO}.`,
    );
  }
  const c = backup.conteudo;
  if (!c?.accounts) throw new ValidationError('O backup não tem contas — arquivo incompleto.');

  const feito = { contas: 0, videos: 0, horarios: 0, legendas: 0, hashtags: 0, templates: 0, pastas: 0 };

  if (modo === 'replace') {
    // Ordem importa: o que depende de conta sai antes dela. `onDelete:
    // Cascade` cobriria parte disso, mas depender do cascade para uma operação
    // destrutiva esconde o que está sendo apagado.
    await prisma.publication.deleteMany({});
    await prisma.video.deleteMany({});
    await prisma.slot.deleteMany({});
    await prisma.watchFolder.deleteMany({});
    await prisma.account.deleteMany({});
    await prisma.caption.deleteMany({});
    await prisma.hashtagSet.deleteMany({});
  }

  // --- contas (chave natural: username) ---
  const mapaConta = new Map(); // id do backup -> id atual
  for (const a of c.accounts) {
    const { id, createdAt, updatedAt, ...dados } = a;
    const existente = await prisma.account.findUnique({ where: { username: a.username } });
    if (existente) {
      mapaConta.set(id, existente.id);
      continue;
    }
    // `connected` volta como false: a sessão não veio no backup, e marcar
    // conectada uma conta sem cookie geraria falha em loop no agendador.
    const criada = await prisma.account.create({
      data: { ...dados, connected: false, status: 'PAUSED' },
    });
    mapaConta.set(id, criada.id);
    feito.contas += 1;
  }

  // --- vídeos (chave natural: conta + caminho do arquivo) ---
  for (const v of c.videos ?? []) {
    const accountId = mapaConta.get(v.accountId);
    if (!accountId) continue; // conta não restaurada; o vídeo ficaria órfão

    const jaTem = await prisma.video.findFirst({ where: { accountId, filepath: v.filepath } });
    if (jaTem) continue;

    const { id, accountId: _a, ...dados } = v;
    await prisma.video.create({ data: { ...dados, accountId } });
    feito.videos += 1;
  }

  // --- horários ---
  for (const sl of c.slots ?? []) {
    const accountId = mapaConta.get(sl.accountId);
    if (!accountId) continue;
    const { id, accountId: _a, createdAt, ...dados } = sl;
    const jaTem = await prisma.slot.findFirst({
      where: { accountId, time: sl.time, mediaType: sl.mediaType },
    });
    if (jaTem) continue;
    await prisma.slot.create({ data: { ...dados, accountId } });
    feito.horarios += 1;
  }

  // --- biblioteca ---
  for (const l of c.captions ?? []) {
    if (await prisma.caption.findFirst({ where: { text: l.text } })) continue;
    const { id, createdAt, updatedAt, ...dados } = l;
    await prisma.caption.create({ data: dados });
    feito.legendas += 1;
  }
  for (const h of c.hashtagSets ?? []) {
    if (await prisma.hashtagSet.findFirst({ where: { name: h.name } })) continue;
    const { id, createdAt, updatedAt, ...dados } = h;
    await prisma.hashtagSet.create({ data: dados });
    feito.hashtags += 1;
  }
  for (const t of c.templates ?? []) {
    if (await prisma.template.findFirst({ where: { name: t.name } })) continue;
    const { id, createdAt, updatedAt, ...dados } = t;
    await prisma.template.create({ data: dados });
    feito.templates += 1;
  }

  // --- pastas monitoradas ---
  for (const f of c.watchFolders ?? []) {
    const accountId = mapaConta.get(f.accountId);
    if (!accountId) continue;
    if (await prisma.watchFolder.findUnique({ where: { path: f.path } })) continue;
    const { id, accountId: _a, createdAt, updatedAt, ...dados } = f;
    await prisma.watchFolder.create({ data: { ...dados, accountId } });
    feito.pastas += 1;
  }

  // --- preferências ---
  if (c.settings) {
    const { id, updatedAt, ...dados } = c.settings;
    await prisma.settings.update({ where: { id: 1 }, data: dados });
  }

  await logger.warn({
    action: 'BACKUP_RESTAURADO',
    message: `Modo ${modo}. ${feito.contas} conta(s), ${feito.videos} vídeo(s), ${feito.horarios} horário(s).`,
  });

  return {
    ...feito,
    modo,
    aviso: 'Reconecte cada conta em Contas: as sessões do navegador não vêm no backup.',
  };
}
