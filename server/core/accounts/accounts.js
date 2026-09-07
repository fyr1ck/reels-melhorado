import fs from 'fs';
import path from 'path';
import { prisma } from '../../db/prisma.js';
import { config } from '../../config/env.js';
import { ACCOUNT_STATUS, OPEN_STATUSES, MEDIA } from '../../lib/enums.js';
import { NotFoundError, ConflictError } from '../../lib/errors.js';
import { dailyRate } from '../scheduling/slots.js';

/**
 * Contas e suas sessões de navegador.
 *
 * Cada conta guarda o storageState do Playwright numa pasta própria. Contextos
 * separados nunca compartilham cookies, então o app não mistura contas — mas
 * isso é só isolamento de sessão: não há mascaramento de fingerprint.
 */

export function sessionDir(accountId) {
  return path.join(config.paths.sessions, accountId);
}

export function sessionFile(accountId) {
  return path.join(sessionDir(accountId), 'storageState.json');
}

export function hasSession(accountId) {
  return fs.existsSync(sessionFile(accountId));
}

export function dropSession(accountId) {
  const file = sessionFile(accountId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

/** Garante que sempre exista uma conta padrão — o app não funciona sem uma. */
export async function ensureDefault() {
  const current = await prisma.account.findFirst({ where: { isDefault: true } });
  if (current) return current;

  const any = await prisma.account.findFirst({ orderBy: { sortOrder: 'asc' } });
  if (any) return prisma.account.update({ where: { id: any.id }, data: { isDefault: true } });

  return prisma.account.create({
    data: { username: 'conta-principal', label: 'Conta principal', isDefault: true },
  });
}

/**
 * Resolve a conta de uma requisição. Sem id explícito cai na padrão, então
 * nenhuma rota quebra por falta do parâmetro.
 */
export async function resolve(accountId) {
  if (accountId) {
    const found = await prisma.account.findUnique({ where: { id: accountId } });
    if (found) return found;
  }
  return ensureDefault();
}

export async function requireAccount(accountId) {
  const found = await prisma.account.findUnique({ where: { id: accountId } });
  if (!found) throw new NotFoundError('Conta não encontrada.');
  return found;
}

/**
 * Sincroniza a flag `connected` com o que existe em disco.
 * Sem isso, apagar a pasta de sessão por fora deixaria o painel mentindo.
 */
export async function syncConnectionFlags() {
  const accounts = await prisma.account.findMany();
  for (const account of accounts) {
    const onDisk = hasSession(account.id);
    if (onDisk !== account.connected) {
      await prisma.account.update({ where: { id: account.id }, data: { connected: onDisk } });
    }
  }
}

/**
 * Contas que o agendador deve processar: habilitadas, com automação ligada e
 * com sessão em disco. Publicar sem sessão só geraria falha e pausaria a conta.
 */
export async function runnable() {
  const accounts = await prisma.account.findMany({
    where: { enabled: true, status: ACCOUNT_STATUS.ACTIVE },
    orderBy: { sortOrder: 'asc' },
  });
  return accounts.filter((a) => hasSession(a.id));
}

/** Estado do painel para uma conta: fila, ritmo, cobertura e próxima saída. */
export async function summarize(account) {
  const [grouped, slots, next] = await Promise.all([
    prisma.video.groupBy({
      by: ['status', 'mediaType'],
      where: { accountId: account.id },
      _count: true,
    }),
    prisma.slot.count({ where: { accountId: account.id, enabled: true } }),
    prisma.publication.findFirst({
      where: { accountId: account.id, status: 'SCHEDULED' },
      orderBy: { scheduledAt: 'asc' },
      include: { video: { select: { filename: true } } },
    }),
  ]);

  const open = (mediaType) =>
    grouped
      .filter((g) => g.mediaType === mediaType && OPEN_STATUSES.includes(g.status))
      .reduce((sum, g) => sum + g._count, 0);

  const reels = open(MEDIA.REEL);
  const stories = open(MEDIA.STORY);
  const published = grouped.filter((g) => g.status === 'PUBLISHED').reduce((s, g) => s + g._count, 0);
  const failed = grouped.filter((g) => g.status === 'FAILED').reduce((s, g) => s + g._count, 0);

  const rate = dailyRate({
    scheduleMode: account.scheduleMode,
    intervalMinutes: account.intervalMinutes,
    enabledSlots: slots,
  });

  // Só reels contam para a cobertura: stories não são publicáveis pela web
  // (ver core/publishing/story.js), então incluí-los inflaria a estimativa.
  const coverageDays = rate > 0 ? Number((reels / rate).toFixed(1)) : null;

  return {
    ...account,
    reels,
    stories,
    published,
    failed,
    slots,
    dailyRate: Number(rate.toFixed(2)),
    coverageDays,
    nextAt: next?.scheduledAt ?? null,
    nextName: next?.video?.filename ?? null,
    health: health({ account, reels, failed, rate }),
  };
}

function health({ account, reels, failed, rate }) {
  if (!account.connected) return { level: 'danger', label: 'DESCONECTADA' };
  if (!account.enabled) return { level: 'muted', label: 'DESLIGADA' };
  if (failed > 0) return { level: 'danger', label: 'COM FALHAS' };
  if (reels === 0) return { level: 'warn', label: 'SEM FILA' };
  if (rate === 0) return { level: 'warn', label: 'SEM HORÁRIOS' };
  if (account.status !== ACCOUNT_STATUS.ACTIVE) return { level: 'muted', label: 'PAUSADA' };
  return { level: 'ok', label: 'ATIVA' };
}

/** Ativar sem sessão só produziria falha em loop — recusa com o motivo. */
export function assertConnected(account) {
  if (!hasSession(account.id)) {
    throw new ConflictError(
      `@${account.username} não está conectada ao Instagram. Conecte antes de ativar a automação.`,
    );
  }
}
