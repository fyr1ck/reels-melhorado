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
  // Balões de mensagem RECEBIDA. `div[data-testid="msg-container"]` esteve
  // nesta lista e era um erro grave: ele casa com mensagem enviada TAMBÉM.
  // O bot lia as próprias respostas, não as reconhecia como comando, respondia
  // "não entendi", lia essa resposta, e repetia — um loop de auto-resposta que
  // enche a conversa do usuário a cada volta do laço.
  recebidas: ['div.message-in'],
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

  // O texto da tela junto: quando NENHUM seletor casa, saber que a página
  // mostra "Reconecte seu telefone" ou uma tela em branco é a diferença entre
  // adivinhar e ver o problema.
  const texto = await pagina.evaluate(
    () => (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 400),
  ).catch(() => '(não foi possível ler)');

  return {
    aberto: true,
    url: pagina.url(),
    titulo: await pagina.title().catch(() => null),
    texto,
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

/**
 * A conexão ainda vale?
 *
 * `estado` era definido uma vez em `aguardarLogin` e nunca mais revisto. Quando
 * o WhatsApp desconecta o dispositivo — por expirar, ou porque o usuário ligou
 * outro telefone — o painel continuava anunciando CONECTADO e todo envio
 * quebrava com "Erro interno", sem dizer o que fazer.
 *
 * Três falhas seguidas para declarar queda: uma checagem isolada pode pegar a
 * página no meio de uma navegação, e derrubar a conexão por causa disso seria
 * pior que o problema.
 */
const STRIKES_ATE_CAIR = 3;
let strikes = 0;

export async function verificarSaude() {
  if (!contexto || !pagina || pagina.isClosed()) {
    if (estado === 'CONECTADO') {
      estado = 'DESLIGADO';
      ultimoErro = 'A janela do WhatsApp foi fechada.';
    }
    return false;
  }
  if (estado !== 'CONECTADO') return false;

  // Lista de conversas visível: está tudo certo, zera o contador.
  if (await primeiro(pagina, SELETORES.logado, { visivel: true })) {
    strikes = 0;
    return true;
  }

  // QR de volta na tela é prova direta de que a sessão caiu — não precisa
  // esperar os três strikes.
  if (await primeiro(pagina, SELETORES.qr, { visivel: true })) {
    estado = 'AGUARDANDO_QR';
    ultimoErro = 'A sessão do WhatsApp expirou. Leia o QR de novo.';
    strikes = 0;
    return false;
  }

  strikes += 1;
  if (strikes >= STRIKES_ATE_CAIR) {
    estado = 'DESLIGADO';
    ultimoErro = 'Perdi a conexão com o WhatsApp Web. Conecte de novo.';
    strikes = 0;
    return false;
  }
  return true; // ainda em dúvida: pode ser carregamento
}

/**
 * Fila de operações sobre a página.
 *
 * Há dois donos do navegador ao mesmo tempo: o laço que lê a conversa a cada 8
 * segundos e qualquer envio disparado pelo painel. Os dois chamam
 * `abrirConversa`, que navega — e duas navegações simultâneas na mesma aba
 * fazem uma abortar a outra. O sintoma era intermitente e enganoso: "não
 * consegui abrir a conversa" numa operação que estava perfeitamente correta.
 *
 * Encadear as operações numa promessa só resolve sem `setInterval` de espera
 * nem sinalização manual.
 */
let fila = Promise.resolve();

function emFila(fn) {
  const proxima = fila.then(fn, fn);
  // A fila não pode morrer numa rejeição: o erro vai para quem chamou, e a
  // corrente segue viva para a próxima operação.
  fila = proxima.catch(() => {});
  return proxima;
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
  strikes = 0;
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
    // SESSAO_EXPIRADA é um sinal interno da retomada automática, não uma
    // mensagem para ninguém ler. Traduzido aqui, porque é o que aparece na
    // tela quando o app sobe e a sessão não vale mais.
    const expirou = err.message === 'SESSAO_EXPIRADA';
    estado = expirou ? 'DESLIGADO' : 'ERRO';
    ultimoErro = expirou
      ? 'A sessão salva não vale mais. Clique em Conectar com QR e leia o código.'
      : err.message;
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
    try {
      await pagina.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    } catch (err) {
      // O WhatsApp Web é uma SPA: ela às vezes cancela a navegação e trata a
      // URL por conta própria, e aí o ERR_ABORTED é inofensivo. Só vira erro
      // se a conversa realmente não abrir — o laço abaixo decide isso.
      if (!/ERR_ABORTED/.test(err.message)) throw err;
      await pagina.waitForTimeout(1500);
    }
  }

  // Se a sessão caiu, o problema não é a conversa — é o login. Dizer isso aqui
  // evita o usuário ficar tentando enviar de novo contra uma sessão morta.
  if (!(await primeiro(pagina, SELETORES.logado, { visivel: true }))
      && await primeiro(pagina, SELETORES.qr, { visivel: true })) {
    estado = 'AGUARDANDO_QR';
    ultimoErro = 'A sessão do WhatsApp expirou. Leia o QR de novo.';
    throw new ConflictError('A sessão do WhatsApp expirou. Abra a tela do WhatsApp e leia o QR de novo.');
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

  // Chegou aqui sem QR e sem lista de conversas: a página está num estado que
  // não é nenhum dos dois. Marcar como caído é mais honesto do que continuar
  // anunciando CONECTADO enquanto todo envio falha.
  if (!(await primeiro(pagina, SELETORES.logado, { visivel: true }))) {
    estado = 'DESLIGADO';
    ultimoErro = 'A página do WhatsApp não está nem logada nem no QR.';
    throw new ConflictError(
      'Perdi a conexão com o WhatsApp Web. Conecte de novo pela tela do WhatsApp.',
    );
  }

  throw new ConflictError(
    'Não consegui abrir a conversa. O número pode não ter WhatsApp, ou a interface do WhatsApp Web mudou '
    + '— veja GET /api/whatsapp/diagnostico.',
  );
}

/** Manda uma mensagem. Quebra de linha vira Shift+Enter, não envio. */
export async function enviar(numero, texto) {
  if (!conectado()) throw new ConflictError('WhatsApp não está conectado.');
  return emFila(() => enviarAgora(numero, texto));
}

async function enviarAgora(numero, texto) {
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
 * Lê a conversa e devolve as linhas com a DIREÇÃO de cada uma.
 *
 * Descobrir a direção foi o ponto do bug de flood. Esta versão do WhatsApp Web
 * não tem `.message-in` / `.message-out`, e o `data-id` das linhas vem sem o
 * prefixo `true_`/`false_` — os dois sinais que a implementação anterior
 * usava. Ela caía no seletor que pegava TUDO, o bot lia as próprias respostas,
 * não as reconhecia como comando, respondia "não entendi", lia essa resposta,
 * e repetia a cada 8 segundos.
 *
 * O que existe de verdade, e é o que se usa aqui:
 *
 * 1. `data-pre-plain-text` = "[hora, data] Nome: " — o nome de quem enviou.
 * 2. Os ícones `tail-out` / `tail-in`, a cauda do balão. Só aparecem na
 *    PRIMEIRA mensagem de uma sequência do mesmo remetente.
 *
 * A combinação se autocalibra: a cauda `tail-out` revela qual nome é o da
 * própria conta, e daí em diante o nome basta. Sem nome nem cauda (avisos do
 * sistema, banners), a linha fica sem direção e é descartada — nunca tratada
 * como comando.
 */
function extrairLinhas(pagina) {
  return pagina.evaluate(() => {
    const linhas = [...document.querySelectorAll('div[role="row"]')];

    const nomeDe = (linha) => {
      const pre = linha.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text');
      if (!pre) return null;
      const m = /\]\s*([^:]+):\s*$/.exec(pre);
      return m ? m[1].trim() : null;
    };
    const temIcone = (linha, nome) => !!linha.querySelector(`[data-icon="${nome}"]`);

    // Qual nome é o da própria conta: o da primeira linha com cauda de saída.
    let meuNome = null;
    for (const l of linhas) {
      if (temIcone(l, 'tail-out')) {
        meuNome = nomeDe(l);
        if (meuNome) break;
      }
    }

    // A cauda marca o início de cada bloco; as linhas seguintes herdam a
    // direção dele até a próxima cauda.
    let blocoAtual = null;

    return linhas.map((linha) => {
      if (temIcone(linha, 'tail-out')) blocoAtual = 'ENVIADA';
      else if (temIcone(linha, 'tail-in')) blocoAtual = 'RECEBIDA';

      const nome = nomeDe(linha);
      const direcao = (meuNome && nome)
        ? (nome === meuNome ? 'ENVIADA' : 'RECEBIDA')
        : blocoAtual;

      const texto = linha.querySelector('span.selectable-text, div.selectable-text')?.innerText
        ?? '';
      const id = linha.querySelector('[data-id]')?.getAttribute('data-id')
        ?? linha.getAttribute('data-id')
        ?? null;

      return {
        id: id ?? `${nome ?? '?'}|${texto.trim().slice(0, 60)}`,
        direcao,
        remetente: nome,
        texto: texto.trim(),
      };
    }).filter((m) => m.texto);
  });
}

/**
 * Últimas mensagens RECEBIDAS na conversa do número.
 *
 * Devolve só o texto; quem decide o que é comando é `commands.js`.
 */
export async function lerRecebidas(numero, { quantas = 8 } = {}) {
  if (!conectado()) return [];

  return emFila(async () => {
    await abrirConversa(numero);
    const linhas = await extrairLinhas(pagina);

    return linhas
      .filter((m) => m.direcao === 'RECEBIDA')
      .slice(-quantas)
      .map(({ id, texto }) => ({ id, texto }));
  });
}

/**
 * O que há na conversa agora, com a direção de cada linha.
 *
 * Usa o MESMO leitor de `lerRecebidas` de propósito: um diagnóstico com lógica
 * própria mostraria uma realidade que o bot não vê, e foi exatamente essa
 * diferença que escondeu o loop de auto-resposta.
 */
export async function espiarConversa(numero, { quantas = 14 } = {}) {
  if (!conectado()) return { erro: 'WhatsApp não está conectado.' };

  const linhas = await emFila(async () => {
    await abrirConversa(numero);
    return extrairLinhas(pagina);
  });

  return linhas.slice(-quantas).map((m) => ({
    direcao: m.direcao ?? '(sem direção — ignorada)',
    remetente: m.remetente,
    texto: m.texto.replace(/\s+/g, ' ').slice(0, 60),
  }));
}
