import { chromium } from 'playwright';
import { config } from '../config/env.js';
import { sessionFile, hasSession } from '../core/accounts/accounts.js';
import { ConflictError } from '../lib/errors.js';

/**
 * Navegador compartilhado, com um contexto por conta.
 *
 * Contextos separados nunca compartilham cookies, então o agendador pode
 * alternar entre contas na mesma execução sem misturá-las. O navegador em si
 * é único porque cada instância do Chromium custa centenas de MB.
 */

let browser = null;
const contexts = new Map(); // accountId -> BrowserContext

async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({ headless: config.headless });
    // Fechado por fora (usuário matou a janela): descarta as referências para
    // a próxima chamada abrir um navegador novo em vez de usar um morto.
    browser.on('disconnected', () => {
      browser = null;
      contexts.clear();
    });
  }
  return browser;
}

export async function contextFor(accountId) {
  if (!hasSession(accountId)) {
    throw new ConflictError('Conta sem sessão. Conecte-a ao Instagram antes de publicar.');
  }

  const cached = contexts.get(accountId);
  if (cached) return cached;

  const b = await getBrowser();
  const context = await b.newContext({ storageState: sessionFile(accountId) });
  contexts.set(accountId, context);
  return context;
}

/**
 * Deixa aberta só a janela desta conta, fechando as das outras.
 *
 * Cada conta tem seu contexto, e contexto aberto é uma janela do Chromium na
 * tela: com duas contas ficavam duas janelas, com dez ficariam dez. Chamado
 * ANTES de publicar, isto garante uma de cada vez.
 *
 * Por que não fechar depois de cada publicação: o contexto recém-criado chega
 * "frio" — a interface do Instagram demora mais para montar, e o botão de
 * criar publicação chegava a não ser encontrado a tempo. Mantendo o da conta
 * ativa vivo, publicações seguidas da mesma conta reaproveitam a janela quente.
 */
export async function keepOnly(accountId) {
  for (const id of [...contexts.keys()]) {
    if (id !== accountId) await closeContext(id);
  }
}

/** Persiste a sessão da conta e fecha só o contexto dela. */
export async function closeContext(accountId) {
  const context = contexts.get(accountId);
  if (!context) return;

  try {
    await context.storageState({ path: sessionFile(accountId) });
  } catch {
    /* sessão pode já estar inválida */
  }
  await context.close().catch(() => {});
  contexts.delete(accountId);
}

export async function closeAll() {
  for (const id of [...contexts.keys()]) await closeContext(id);
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}
