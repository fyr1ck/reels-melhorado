import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { prisma } from '../../db/prisma.js';
import { sessionDir, sessionFile } from './accounts.js';
import { closeContext } from '../../playwright/browser.js';
import { AppError } from '../../lib/errors.js';
import * as logger from '../log.js';
import * as comum from './navegadorComum.js';

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

async function connectAutomatizado(account) {
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

/**
 * Prazo para a pessoa terminar o login no navegador comum.
 *
 * Maior que o da janela automatizada: aqui não há como saber o que está
 * acontecendo dentro da janela, só quando ela fecha. Verificação por código de
 * e-mail pode levar tempo, e fechar a espera cedo demais descartaria um login
 * que estava para terminar.
 */
const PRAZO_COMUM_MS = 30 * 60_000;

/**
 * Login pelo navegador comum, sem automação.
 *
 * Três etapas, e só a terceira envolve o Playwright:
 *
 * 1. abre o Edge/Chrome instalado, num perfil só desta conta;
 * 2. espera a pessoa FECHAR a janela — é o sinal de "terminei";
 * 3. com o navegador já encerrado, abre o mesmo perfil sem janela e copia os
 *    cookies do Instagram para o arquivo de sessão que a publicação usa.
 *
 * O perfil fica guardado. Numa reconexão, o Instagram reconhece o mesmo
 * dispositivo, e a chance de pedir verificação de novo cai.
 */
async function connectPeloNavegador(account, executavel) {
  const perfil = path.join(sessionDir(account.id), 'navegador');

  if (comum.processosDoPerfil(account.id) > 0) {
    throw new AppError(
      `A janela de login de @${account.username} já está aberta. Termine nela e feche-a.`,
      409, 'LOGIN_JA_ABERTO',
    );
  }

  await logger.info({
    action: 'LOGIN_INICIADO', accountId: account.id,
    message: `Aguardando login de @${account.username} no navegador comum (${path.basename(executavel)}).`,
  });

  comum.abrir(executavel, perfil, 'https://www.instagram.com/accounts/login/');

  // Primeiro confirma que a janela ABRIU.
  //
  // Sem isto, um navegador que não sobe seria lido como "a pessoa fechou a
  // janela", e a mensagem diria para ela esperar o feed antes de fechar — uma
  // janela que ela nunca viu.
  let abriu = false;
  for (let i = 0; i < 15 && !abriu; i++) {
    await esperar(2000);
    abriu = comum.processosDoPerfil(account.id) > 0;
  }
  if (!abriu) {
    throw new AppError(
      `Não consegui abrir o navegador (${path.basename(executavel)}). Se ele estiver em outro lugar, `
      + 'coloque o caminho em NAVEGADOR_LOGIN no arquivo .env.',
      500, 'NAVEGADOR_NAO_ABRIU',
    );
  }

  // Depois espera FECHAR. `!== 0` e não `> 0`: -1 é "não sei", e na dúvida
  // continua esperando em vez de ler um perfil que pode estar em uso.
  const deadline = Date.now() + PRAZO_COMUM_MS;
  while (Date.now() < deadline && comum.processosDoPerfil(account.id) !== 0) {
    await esperar(2000);
  }

  if (comum.processosDoPerfil(account.id) !== 0) {
    throw new AppError(
      'A janela de login ficou aberta por 30 minutos. Termine o login, feche a janela e conecte de novo.',
      408, 'LOGIN_TIMEOUT',
    );
  }

  // Folga para o sistema liberar os arquivos do perfil depois que o último
  // processo sai. Ler cedo demais esbarrava no perfil ainda travado.
  await esperar(2000);

  const leitor = await chromium.launchPersistentContext(perfil, {
    executablePath: executavel,
    headless: true,
  });

  let cookies;
  try {
    cookies = comum.cookiesDoInstagram(await leitor.cookies());
  } finally {
    await leitor.close().catch(() => {});
  }

  if (!cookies.some((c) => c.name === 'sessionid')) {
    throw new AppError(
      'A janela foi fechada antes de o login terminar. Conecte de novo e só feche a janela '
      + 'depois de ver o seu feed do Instagram.',
      400, 'LOGIN_INCOMPLETO',
    );
  }

  // Mesmo formato que a publicação sempre leu. Só cookies: o localStorage de
  // uma janela que já não existe não há como recuperar, e a autenticação do
  // Instagram mora nos cookies.
  fs.writeFileSync(sessionFile(account.id), JSON.stringify({ cookies, origins: [] }, null, 2));
  fs.rmSync(rascunhoDe(account.id), { force: true });

  const updated = await prisma.account.update({
    where: { id: account.id },
    data: { connected: true, lastConnectedAt: new Date() },
  });

  await logger.success({
    action: 'LOGIN_CONCLUIDO', accountId: account.id,
    message: `Sessão de @${account.username} salva pelo navegador comum.`,
  });

  return updated;
}

/**
 * Conecta uma conta.
 *
 * Por padrão usa o navegador comum, quando há um instalado: é o único jeito de
 * o reCAPTCHA do Instagram aceitar o login. A janela automatizada fica como
 * alternativa (`modo: 'AUTOMATIZADO'`) e como caminho para máquinas sem Edge
 * nem Chrome.
 */
export async function connect(account, { modo } = {}) {
  const executavel = modo === 'AUTOMATIZADO' ? null : comum.localizar();
  if (executavel) return connectPeloNavegador(account, executavel);
  return connectAutomatizado(account);
}
