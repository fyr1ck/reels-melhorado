import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { config } from '../../config/env.js';
import { ConflictError } from '../../lib/errors.js';
import { soDigitos } from './commands.js';

/**
 * WhatsApp Web dirigido por navegador.
 *
 * Por que Playwright e não uma biblioteca de WhatsApp: o projeto já dirige o
 * Instagram assim, com sessão persistida em disco. Uma dependência nova traria
 * outro protocolo para manter, e nenhuma delas é oficial — a fragilidade é a
 * mesma, com um vocabulário a mais para aprender.
 *
 * DIFERENÇA IMPORTANTE em relação às contas do Instagram: aqui é
 * `launchPersistentContext`, não `storageState`. O WhatsApp Web guarda as
 * chaves da sessão no IndexedDB, e `storageState` só captura cookies e
 * localStorage — salvar assim faria a sessão morrer a cada reinício e o QR
 * voltar toda vez.
 *
 * Isto depende do HTML do WhatsApp Web, exatamente como a publicação depende
 * do HTML do Instagram. Quando eles mudarem a interface, os seletores abaixo
 * precisam mudar junto.
 */

const PASTA = () => path.join(config.paths.sessions, '..', 'whatsapp');
const URL_BASE = 'https://web.whatsapp.com';

const SELETORES = {
  // Tela do QR: o canvas some assim que a sessão é aceita.
  qr: ['canvas[aria-label*="scan" i]', 'div[data-ref] canvas', 'canvas'],
  // Sinais de que JÁ ESTÁ LOGADO — a lista de conversas só existe depois do
  // login. Precisam ser específicos: um seletor genérico casa com o esqueleto
  // que a página desenha enquanto carrega, e o app anunciaria "conectado"
  // sem sessão nenhuma. As mensagens sumiriam em silêncio a partir daí.
  logado: [
    '#pane-side',
    'div[aria-label="Lista de conversas"]',
    'div[aria-label="Chat list"]',
    'div[data-testid="chat-list"]',
  ],
  // Caixa de texto da conversa aberta.
  campoMensagem: [
    'div[contenteditable="true"][data-tab="10"]',
    'div[contenteditable="true"][data-tab="6"]',
    'footer div[contenteditable="true"]',
  ],
  // Balões de mensagem recebida.
  recebidas: ['div.message-in', 'div[data-testid="msg-container"]'],
  // Caixas de diálogo que o WhatsApp abre por cima da conversa.
  dialogo: ['div[role="dialog"][aria-modal="true"]', 'div[data-animate-modal-body="true"]'],
};

let contexto = null;
let pagina = null;
let ultimoQr = null;      // dataURL do QR, para a tela mostrar
let estado = 'DESLIGADO'; // DESLIGADO | ABRINDO | AGUARDANDO_QR | CONECTADO | ERRO
let ultimoErro = null;

/**
 * Quais seletores casam na página agora.
 *
 * Existe para quando o WhatsApp mudar o HTML: sem isto, o sintoma seria "não
 * conecta" e a investigação começaria do zero. Com isto, dá para ver se o
 * problema é o QR, a lista de conversas ou a caixa de mensagem.
 */
export async function diagnostico() {
  if (!pagina || pagina.isClosed()) return { aberto: false };

  const conferir = async (lista) => {
    const achados = [];
    for (const sel of lista) {
      try {
        const loc = pagina.locator(sel).first();
        const n = await loc.count();
        achados.push({ seletor: sel, existe: n > 0, visivel: n > 0 && await loc.isVisible() });
      } catch {
        achados.push({ seletor: sel, existe: false, visivel: false, invalido: true });
      }
    }
    return achados;
  };

  return {
    aberto: true,
    url: pagina.url(),
    estado,
    qr: await conferir(SELETORES.qr),
    logado: await conferir(SELETORES.logado),
    campoMensagem: await conferir(SELETORES.campoMensagem),
  };
}

export function situacao() {
  return { estado, temQr: !!ultimoQr, ultimoErro, pasta: PASTA() };
}

export function qrAtual() {
  return ultimoQr;
}

export function conectado() {
  return estado === 'CONECTADO';
}

/** O primeiro seletor da lista que existir na página. */
async function primeiro(page, lista, { visivel = false } = {}) {
  for (const sel of lista) {
    try {
      const loc = page.locator(sel).first();
      if ((await loc.count()) > 0 && (!visivel || await loc.isVisible())) return loc;
    } catch { /* seletor inválido para esta versão da página */ }
  }
  return null;
}

/**
 * Abre o WhatsApp Web. Se já houver sessão salva, entra direto; senão, captura
 * o QR para a tela mostrar.
 *
 * SEM JANELA por padrão. O QR não precisa de tela visível: ele é um canvas na
 * página, e a captura é um screenshot desse elemento — que funciona igual em
 * modo invisível. Uma aba do Chromium aberta o dia inteiro só atrapalharia
 * quem está usando a máquina.
 *
 * `mostrarJanela` existe para diagnóstico: quando o WhatsApp mudar o HTML e o
 * app parar de conectar, ver a página de verdade é o caminho mais curto.
 */
export async function conectar({
  apenasSessaoSalva = false,
  timeoutMs = 180_000,
  mostrarJanela = false,
} = {}) {
  if (contexto) return situacao();

  estado = 'ABRINDO';
  ultimoErro = null;
  fs.mkdirSync(PASTA(), { recursive: true });

  try {
    contexto = await chromium.launchPersistentContext(PASTA(), {
      headless: !mostrarJanela,
      viewport: { width: 1100, height: 760 },
      // O WhatsApp Web recusa navegador que não reconhece. Sem um user agent
      // de Chrome real, o modo invisível cai numa tela de "atualize seu
      // navegador" em vez do QR.
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        + ' (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'pt-BR',
      args: ['--disable-blink-features=AutomationControlled'],
    });

    // Janela fechada por fora: descarta tudo, para a próxima chamada abrir
    // uma nova em vez de falar com um navegador morto.
    contexto.on('close', () => {
      contexto = null;
      pagina = null;
      if (estado !== 'ERRO') estado = 'DESLIGADO';
    });

    pagina = contexto.pages()[0] ?? await contexto.newPage();
    await pagina.goto(URL_BASE, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    await aguardarLogin({ timeoutMs, apenasSessaoSalva });
    return situacao();
  } catch (err) {
    estado = 'ERRO';
    ultimoErro = err.message;
    await desconectar({ apagarSessao: false }).catch(() => {});
    throw err;
  }
}

/**
 * Espera o login, capturando o QR enquanto ele estiver na tela.
 *
 * O QR do WhatsApp expira em ~20s e a página gera outro sozinha; por isso a
 * captura roda em laço, e não uma vez só — um QR tirado no início estaria
 * vencido quando o usuário pegasse o celular.
 */
async function aguardarLogin({ timeoutMs, apenasSessaoSalva = false }) {
  const limite = Date.now() + timeoutMs;

  while (Date.now() < limite) {
    if (!pagina || pagina.isClosed()) throw new Error('A janela do WhatsApp foi fechada.');

    // O QR vem PRIMEIRO na checagem: se ele está na tela, não há sessão, ponto
    // final. Perguntar "está logado?" antes disso deixava um esqueleto de
    // carregamento passar por lista de conversas, e o app anunciava conexão
    // sem ninguém ter escaneado nada.
    const canvas = await primeiro(pagina, SELETORES.qr, { visivel: true });
    if (canvas) {
      // Na retomada automática do boot, ver o QR significa que a sessão
      // expirou — e não que alguém está esperando para escanear. Fechar aqui
      // evita uma janela do Chromium abrindo sozinha a cada reinício do
      // servidor, com um código que ninguém pediu.
      if (apenasSessaoSalva) {
        estado = 'DESLIGADO';
        throw new Error('SESSAO_EXPIRADA');
      }

      estado = 'AGUARDANDO_QR';
      try {
        const buf = await canvas.screenshot({ timeout: 5000 });
        ultimoQr = `data:image/png;base64,${buf.toString('base64')}`;
      } catch { /* o QR trocou no meio da captura; a próxima volta pega */ }
      await pagina.waitForTimeout(2000);
      continue;
    }

    // Sem QR na tela E com a lista de conversas VISÍVEL: aí sim está dentro.
    if (await primeiro(pagina, SELETORES.logado, { visivel: true })) {
      estado = 'CONECTADO';
      ultimoQr = null;
      return true;
    }

    await pagina.waitForTimeout(2000);
  }

  throw new Error(apenasSessaoSalva
    ? 'SESSAO_EXPIRADA'
    : 'Tempo esgotado esperando a leitura do QR. Tente conectar de novo.');
}

/** Fecha o navegador. `apagarSessao` força um QR novo na próxima conexão. */
export async function desconectar({ apagarSessao = false } = {}) {
  if (contexto) {
    await contexto.close().catch(() => {});
  }
  contexto = null;
  pagina = null;
  ultimoQr = null;
  estado = 'DESLIGADO';

  if (apagarSessao) {
    try {
      fs.rmSync(PASTA(), { recursive: true, force: true });
    } catch { /* pasta em uso; a próxima conexão sobrescreve */ }
  }
}

/**
 * Abre a conversa de um número.
 *
 * Usa a URL `send?phone=`, que não depende de o contato estar na agenda nem de
 * caçar a conversa na lista lateral — a busca por nome erraria com dois
 * contatos parecidos.
 */
/**
 * Fecha a caixa de diálogo que o WhatsApp às vezes abre por cima da conversa.
 *
 * Ao entrar por `send?phone=`, o WhatsApp pode mostrar um modal — confirmação,
 * aviso, promoção do app. Ele fica POR CIMA do campo de mensagem e engole o
 * clique: o sintoma é "Element is not attached to the DOM" ou "intercepts
 * pointer events", que não diz nada sobre o motivo real.
 */
async function fecharDialogo() {
  const dialogo = await primeiro(pagina, SELETORES.dialogo, { visivel: true });
  if (!dialogo) return false;

  // Preferência pelo botão do próprio diálogo: Escape fecha alguns, mas em
  // outros cancela a ação e a conversa não abre.
  const botao = dialogo.locator('button, div[role="button"]').last();
  if (await botao.count()) {
    await botao.click({ timeout: 5000 }).catch(() => {});
  } else {
    await pagina.keyboard.press('Escape').catch(() => {});
  }

  await pagina.waitForTimeout(700);
  return true;
}

/**
 * Abre a conversa de um número e devolve o LOCATOR do campo de mensagem.
 *
 * Locator, e não ElementHandle: o WhatsApp Web redesenha a conversa enquanto
 * carrega, e um handle capturado antes disso aponta para um nó que já saiu do
 * DOM. O locator resolve o elemento no momento do clique.
 */
async function abrirConversa(numero) {
  const alvo = soDigitos(numero);
  if (!alvo) throw new ConflictError('Número de destino não configurado.');

  const url = `${URL_BASE}/send?phone=${alvo}`;
  if (!pagina.url().startsWith(url)) {
    await pagina.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }

  const campo = pagina.locator(SELETORES.campoMensagem.join(', ')).first();

  // Duas voltas: a primeira costuma esbarrar no modal, e fechá-lo redesenha a
  // conversa — daí a segunda espera pelo campo já sem nada por cima.
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    await fecharDialogo();

    const apareceu = await campo.waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);

    if (apareceu && !(await primeiro(pagina, SELETORES.dialogo, { visivel: true }))) {
      return campo;
    }
  }

  throw new ConflictError(
    'Não consegui abrir a conversa. O número pode não ter WhatsApp, ou a interface do WhatsApp Web mudou '
    + '— veja GET /api/whatsapp/diagnostico.',
  );
}

/** Manda uma mensagem. Quebra de linha vira Shift+Enter, não envio. */
export async function enviar(numero, texto) {
  if (!conectado()) throw new ConflictError('WhatsApp não está conectado.');

  const campo = await abrirConversa(numero);
  await campo.click({ timeout: 15_000 });

  const linhas = String(texto).split('\n');
  for (const [i, linha] of linhas.entries()) {
    if (i > 0) await pagina.keyboard.press('Shift+Enter');
    await pagina.keyboard.type(linha, { delay: 8 });
  }
  await pagina.keyboard.press('Enter');
  await pagina.waitForTimeout(600);
  return true;
}

/**
 * Últimas mensagens RECEBIDAS na conversa do número.
 *
 * Devolve só o texto; quem decide o que é comando é `commands.js`. Lê as
 * últimas para o laço de leitura poder descartar as que já respondeu.
 */
export async function lerRecebidas(numero, { quantas = 8 } = {}) {
  if (!conectado()) return [];

  await abrirConversa(numero);

  const seletor = SELETORES.recebidas.join(', ');
  return pagina.evaluate(({ sel, n }) => {
    const baloes = [...document.querySelectorAll(sel)].slice(-n);
    return baloes.map((b) => {
      const texto = b.querySelector('span.selectable-text, div.selectable-text')?.innerText
        ?? b.innerText ?? '';
      // O id do balão é estável dentro da sessão e serve para não responder
      // duas vezes a mesma mensagem.
      const id = b.getAttribute('data-id')
        ?? b.closest('[data-id]')?.getAttribute('data-id')
        ?? texto;
      return { id, texto: texto.trim() };
    }).filter((m) => m.texto);
  }, { sel: seletor, n: quantas });
}
