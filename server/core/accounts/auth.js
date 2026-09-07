import fs from 'fs';
import { chromium } from 'playwright';
import { prisma } from '../../db/prisma.js';
import { config } from '../../config/env.js';
import { sessionDir, sessionFile } from './accounts.js';
import { closeAll } from '../../playwright/browser.js';
import { AppError } from '../../lib/errors.js';
import * as logger from '../log.js';

/**
 * Login manual no Instagram.
 *
 * O app NUNCA lê, pede ou guarda a senha. Ele abre uma janela real, espera o
 * usuário concluir o login por conta própria — incluindo 2FA e CAPTCHA — e
 * salva apenas os cookies de sessão resultantes.
 */
export async function connect(account) {
  fs.mkdirSync(sessionDir(account.id), { recursive: true });

  // Evita duas janelas disputando a mesma sessão.
  await closeAll();

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await logger.info({
    action: 'LOGIN_INICIADO', accountId: account.id,
    message: `Aguardando login manual em @${account.username}.`,
  });

  try {
    await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded' });

    // Espera o cookie `sessionid`, que é o único que realmente autentica.
    //
    // Só a URL sair de /accounts/login NÃO basta: quando o Instagram pede
    // checkpoint, ele redireciona para /challenge/ antes de o login terminar
    // — e o app antigo considerava isso "concluído", salvando uma sessão
    // incompleta que falhava depois, na hora de publicar.
    const deadline = Date.now() + 5 * 60_000;
    let authenticated = false;

    while (Date.now() < deadline) {
      const cookies = await context.cookies();
      if (cookies.some((c) => c.name === 'sessionid')) {
        authenticated = true;
        break;
      }
      await page.waitForTimeout(1000);
    }

    if (!authenticated) {
      throw new AppError(
        'Não foi possível confirmar o login. Conclua TODAS as etapas (senha, CAPTCHA, código) ' +
        'até ver seu feed normal do Instagram, e tente conectar de novo.',
        408, 'LOGIN_TIMEOUT',
      );
    }

    // Folga para o Instagram terminar de gravar cookies e localStorage.
    await page.waitForTimeout(3000);
    await context.storageState({ path: sessionFile(account.id) });
  } finally {
    await browser.close().catch(() => {});
  }

  const updated = await prisma.account.update({
    where: { id: account.id },
    data: { connected: true, lastConnectedAt: new Date() },
  });

  await logger.success({
    action: 'LOGIN_CONCLUIDO', accountId: account.id,
    message: `Sessão de @${account.username} salva.`,
  });

  return updated;
}
