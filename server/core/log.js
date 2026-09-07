import { prisma } from '../db/prisma.js';
import { LOG_LEVEL } from '../lib/enums.js';

/**
 * Auditoria. Nunca lança: uma falha ao gravar log não pode derrubar a
 * publicação que o log estava tentando registrar.
 */
export async function log({ level = LOG_LEVEL.INFO, action, message, accountId, videoName, attempt, durationMs }) {
  try {
    await prisma.logEntry.create({
      data: { level, action, message: message ?? null, accountId: accountId ?? null,
              videoName: videoName ?? null, attempt: attempt ?? null, durationMs: durationMs ?? null },
    });
  } catch (err) {
    console.error('falha ao gravar log:', err.message);
  }

  const icone = { INFO: 'ℹ', SUCCESS: '✓', WARN: '⚠', ERROR: '✗' }[level] || '·';
  console.log(`${icone} ${action}${videoName ? ` — ${videoName}` : ''}${message ? `: ${message}` : ''}`);
}

export const info = (a) => log({ ...a, level: LOG_LEVEL.INFO });
export const success = (a) => log({ ...a, level: LOG_LEVEL.SUCCESS });
export const warn = (a) => log({ ...a, level: LOG_LEVEL.WARN });
export const error = (a) => log({ ...a, level: LOG_LEVEL.ERROR });
