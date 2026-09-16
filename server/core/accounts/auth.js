import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { prisma } from '../../db/prisma.js';
import { sessionDir, sessionFile } from './accounts.js';
import { closeContext } from '../../playwright/browser.js';
import { AppError } from '../../lib/errors.js';
import * as logger from '../log.js';

/**
 * Login manual no Instagram.
 *
 * O app NUNCA lê, pede ou guarda a senha. Ele abre uma janela real, espera o
 * usuário concluir o login por conta própria — incluindo 2FA e CAPTCHA — e
 * salva apenas os cookies de sessão resultantes.
 *
 * O app também não resolve, contorna nem esconde nada do CAPTCHA. Quem
 * resolve é a pessoa, na janela. O que cabe aqui é não atrapalhar: não fechar
 * a janela no meio, e não jogar fora o que o navegador já tinha acumulado.
 */

/**
 * Quanto tempo a janela fica esperando.
 *
 * Era 5 minutos, e esse era o laço que o usuário via: senha, reCAPTCHA de
 * imagens que pede outra rodada, código por e-mail — passa de 5 minutos fácil.
 * A janela fechava no meio da verificação, a pessoa clicava em conectar de
 * novo e recomeçava do zero. Os logs mostravam exatamente isso: LOGIN_INICIADO
 * a cada 3-5 minutos, sem nenhum LOGIN_CONCLUIDO.
 */
const PRAZO_MS = 15 * 60_000;

/** De quanto em quanto tempo o progresso da tentativa é guardado. */
const SALVAR_RASCUNHO_MS = 15_000;

/**
 * O progresso de uma tentativa que ainda não terminou.
 *
 * Arquivo SEPARADO da sessão de publicação de propósito: uma tentativa pela
 * metade não pode sobrescrever uma sessão que funciona.
 */
const rascunhoDe = (accountId) => path.join(sessionDir(accountId), 'login-rascunho.json');

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function connect(account) {
  fs.mkdirSync(sessionDir(account.id), { recursive: true });

  // Fecha só a janela DESTA conta.
  //
  // Antes era `closeAll()`, que derrubava o navegador de todas as contas —
  // conectar uma conta nova no meio da tarde matava a publicação que outra
  // conta estava fazendo naquele instante. Só a mesma conta disputa a mesma
  // sessão.
  await closeContext(account.id);

  // Retoma de onde a tentativa anterior parou.
  //
  // Cada tentativa abria um navegador vazio, sem nenhum cookie. Tudo o que o
  // Instagram tinha registrado na tentativa anterior — o dispositivo, a
  // verificação já feita — era descartado, e a pessoa recomeçava do zero toda
  // vez. Um navegador normal não apaga os cookies porque o login falhou; este
  // também não apaga mais.
  const rascunho = rascunhoDe(account.id);
  const retomando = fs.existsSync(rascunho);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext(retomando ? { storageState: rascunho } : {});
  const page = await context.newPage();

  // A janela fechada pelo usuário encerra a espera NA HORA. Sem isto o app
  // ficava esperando até o prazo acabar, e a espera terminava com um erro cru
  // do Playwright ("Target page closed") em vez de uma mensagem que explica.
  let fechada = false;
  page.on('close', () => { fechada = true; });
  browser.on('disconnected', () => { fechada = true; });

  await logger.info({
    action: 'LOGIN_INICIADO', accountId: account.id,
    message: retomando
      ? `Aguardando login manual em @${account.username} (continuando a tentativa anterior).`
      : `Aguardando login manual em @${account.username}.`,
  });

  const guardarRascunho = () => context.storageState({ path: rascunho }).catch(() => {});

  try {
    await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded' });

    // Espera o cookie `sessionid`, que é o único que realmente autentica.
    //
    // Só a URL sair de /accounts/login NÃO basta: quando o Instagram pede
    // checkpoint, ele redireciona para /challenge/ antes de o login terminar
    // — e o app antigo considerava isso "concluído", salvando uma sessão
    // incompleta que falhava depois, na hora de publicar.
    const deadline = Date.now() + PRAZO_MS;
    let authenticated = false;
    let ultimoRascunho = 0;

    while (Date.now() < deadline && !fechada) {
      const cookies = await context.cookies().catch(() => []);
      if (cookies.some((c) => c.name === 'sessionid')) {
        authenticated = true;
        break;
      }

      if (Date.now() - ultimoRascunho > SALVAR_RASCUNHO_MS) {
        await guardarRascunho();
        ultimoRascunho = Date.now();
      }

      // `setTimeout`, e não `page.waitForTimeout`: este lança se a página
      // foi fechada, e era essa exceção que escondia o motivo real.
      await esperar(1000);
    }

    if (!authenticated) {
      if (!fechada) await guardarRascunho();

      throw new AppError(
        fechada
          ? 'A janela de login foi fechada antes de terminar. O progresso ficou guardado: '
            + 'clique em conectar de novo e continue de onde parou.'
          : 'O login não terminou em 15 minutos. O progresso ficou guardado: clique em conectar '
            + 'de novo e continue. Se o reCAPTCHA continuar voltando sem aceitar, é o Instagram '
            + 'desconfiando da conta: entre nela pelo celular primeiro, use normalmente por um tempo '
            + 'e só então conecte aqui.',
        408,
        fechada ? 'LOGIN_FECHADO' : 'LOGIN_TIMEOUT',
      );
    }

    // Folga para o Instagram terminar de gravar cookies e localStorage.
    await esperar(3000);
    await context.storageState({ path: sessionFile(account.id) });

    // Login concluído: o rascunho cumpriu o papel e não pode ser retomado
    // numa próxima conexão — ela precisa partir da sessão boa, não dele.
    fs.rmSync(rascunho, { force: true });
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
