import { contextFor } from '../../playwright/browser.js';
import { SELECTORS } from '../../playwright/selectors.js';
import * as logger from '../log.js';
import { requestIntervention } from './intervention.js';

/**
 * Publicação de Reel via automação de navegador.
 *
 * O corpo destas funções foi validado contra a interface real do Instagram —
 * o seletor de "Criar" que funciona, a técnica de filechooser para o upload
 * (o input[type=file] só existe DEPOIS do clique) e a digitação simulada da
 * legenda (editores rich-text ignoram .fill()). Mexer aqui sem testar com uma
 * conta conectada quebra a publicação em silêncio.
 */

// Ponte para o formato de log antigo, mantendo o corpo das funções intacto.
const logEvent = ({ video, action, status, message, attempt, durationMs }) =>
  logger.log({
    level: status === 'WARNING' ? 'WARN' : status === 'SUCCESS' ? 'SUCCESS' : status === 'ERROR' ? 'ERROR' : 'INFO',
    action, message, videoName: video, attempt, durationMs,
  });

async function clickFirstMatch(page, selectors, options = {}) {
  for (const sel of selectors) {
    try {
      const locator = page.locator(sel).first();
      if ((await locator.count()) > 0) {
        await locator.click(options);
        return true;
      }
    } catch (e) {
      /* seletor pode não existir nesta versão da UI, tenta o próximo */
    }
  }
  return false;
}

/**
 * Confere se QUALQUER UM dos seletores está visível na página agora.
 * Mesma lógica de tentar-cada-um-por-vez do clickFirstMatch — nunca junta
 * os seletores num único texto (page.locator não entende ", " como "ou"
 * quando os seletores usam engines diferentes como "text=").
 */
async function isAnyVisible(page, selectors) {
  for (const sel of selectors) {
    try {
      if (await page.locator(sel).first().isVisible()) return true;
    } catch (e) {
      /* seletor pode não existir nesta versão da UI, tenta o próximo */
    }
  }
  return false;
}

/**
 * Soma quantos elementos casam com qualquer um dos seletores (mesmo motivo
 * do isAnyVisible: nunca juntar seletores "text=" com vírgula em uma só
 * string — cada um precisa ser consultado separadamente).
 */
async function countAnyMatch(page, selectors) {
  let total = 0;
  for (const sel of selectors) {
    try {
      total += await page.locator(sel).count();
    } catch (e) {
      /* seletor pode não existir nesta versão da UI, tenta o próximo */
    }
  }
  return total;
}

/**
 * Envia o arquivo de vídeo para a tela de upload do Instagram.
 *
 * Prioriza clicar em "Selecionar do computador" e interceptar o evento
 * nativo de escolha de arquivo (filechooser) — método confiável independente
 * de como o Instagram implementa o <input type="file"> internamente (ele só
 * costuma existir/ficar utilizável DEPOIS desse clique, o que fazia o método
 * antigo de setInputFiles direto travar em timeout).
 *
 * Se por algum motivo o filechooser não disparar, cai no fallback de
 * localizar um <input type="file"> já presente no DOM.
 */
async function uploadFile(page, filepath) {
  try {
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
      clickFirstMatch(page, SELECTORS.selectFromComputerButton),
    ]);
    await fileChooser.setFiles(filepath);
    return;
  } catch (e) {
    const fileInput = page.locator(SELECTORS.fileInput).first();
    if ((await fileInput.count()) > 0) {
      await fileInput.setInputFiles(filepath);
      return;
    }
    throw new Error('Não foi possível localizar o seletor de arquivo (nem via clique em "Selecionar do computador" nem via input direto). Verifique server/playwright/selectors.js.');
  }
}

/**
 * Na tela "Foto da capa" (aparece logo após o upload do vídeo), clica em
 * "Selecionar do computador" e envia a imagem de capa personalizada via
 * filechooser nativo — mesma técnica usada para o próprio vídeo.
 *
 * Só age quando a tela de capa está realmente visível (evita disparar
 * waitForEvent('filechooser') em telas erradas, o que travaria por nada).
 * Retorna true assim que TENTA (sucesso ou falha) — o chamador usa isso
 * para não tentar de novo nas iterações seguintes do loop de "Avançar".
 */
async function selectCustomCover(page, videoName, coverAbsolutePath) {
  const headingVisible = await isAnyVisible(page, SELECTORS.coverHeading);
  if (!headingVisible) return false;


  try {
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 8000 }),
      clickFirstMatch(page, SELECTORS.selectFromComputerButton),
    ]);
    await fileChooser.setFiles(coverAbsolutePath);
    await page.waitForTimeout(1500); // dá tempo da prévia da capa atualizar antes de avançar
    await logEvent({ video: videoName, action: 'CAPA_APLICADA_NA_PUBLICACAO', status: 'INFO' });
  } catch (e) {
    await logEvent({
      video: videoName,
      action: 'CAPA_FALHOU_NA_PUBLICACAO',
      status: 'WARNING',
      message: `Não foi possível aplicar a capa personalizada durante a publicação: ${e.message}. A publicação segue com a capa sugerida pelo Instagram.`,
    });
  }
  return true;
}

async function detectCheckpoint(page) {
  const url = page.url();
  if (SELECTORS.checkpoint.urlPatterns.some((p) => url.includes(p))) return true;

  for (const text of SELECTORS.checkpoint.textIndicators) {
    try {
      if ((await page.locator(`text=${text}`).count()) > 0) return true;
    } catch (e) {
      /* ignore */
    }
  }
  return false;
}

/**
 * Se detectar uma tela de verificação de segurança (CAPTCHA, 2FA,
 * checkpoint), PAUSA a automação e aguarda o usuário resolver manualmente
 * na janela do navegador visível, confirmando pelo painel. Nunca tenta
 * burlar ou automatizar essa etapa.
 */
async function handleCheckpointIfNeeded(page, videoName) {
  if (await detectCheckpoint(page)) {
    const message = 'Verificação de segurança detectada no Instagram (CAPTCHA, 2FA ou checkpoint). Resolva manualmente na janela do navegador aberta e clique em "Continuar" no painel.';
    await logEvent({ video: videoName, action: 'INTERVENCAO_NECESSARIA', status: 'WARNING', message });
    await requestIntervention(message);
    await logEvent({ video: videoName, action: 'INTERVENCAO_RESOLVIDA', status: 'INFO' });
  }
}

/**
 * Localiza a caixa de legenda. Primeiro tenta os seletores específicos
 * (aria-label conhecido). Se nenhum existir ou nenhum estiver visível, cai
 * num fallback genérico: qualquer div contenteditable visível na tela
 * (o editor de legenda do Instagram é sempre um contenteditable).
 */
async function locateCaptionBox(page) {
  const specific = page.locator(SELECTORS.captionTextbox.join(', ')).first();
  if ((await specific.count()) > 0 && (await specific.isVisible().catch(() => false))) {
    return specific;
  }

  const generic = page.locator('div[contenteditable="true"]').filter({ hasNotText: 'Pesquisar' });
  const count = await generic.count();
  for (let i = 0; i < count; i++) {
    const candidate = generic.nth(i);
    if (await candidate.isVisible().catch(() => false)) {
      return candidate;
    }
  }

  return specific; // devolve mesmo que não visível, deixa o chamador decidir
}

/**
 * Garante que o campo de legenda está de fato focado antes de digitar.
 * Clica, confere via document.activeElement, e tenta de novo se necessário.
 */
async function ensureFocused(page, captionBox) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await captionBox.scrollIntoViewIfNeeded().catch(() => {});
    await captionBox.click({ delay: 50 }).catch(() => {});
    await page.waitForTimeout(200);

    const isFocused = await page.evaluate((el) => document.activeElement === el, await captionBox.elementHandle()).catch(() => false);
    if (isFocused) return true;
  }
  return false;
}

/**
 * Como `clickFirstMatch`, mas SÓ dentro da janela de criação.
 *
 * `text=Avançar` e `text=Postar` valem para a página inteira, e o feed fica
 * visível atrás do modal. Um clique que caia lá fora não avança nada: fecha a
 * janela. O sintoma era a publicação parar entre o upload e a legenda, com o
 * feed na tela e "Compartilhar não encontrado" no fim — sem nada indicando que
 * o clique tinha errado o alvo.
 *
 * Quando a janela não é encontrada, cai no clique global: é melhor tentar do
 * que travar caso o Instagram mude a marcação do modal.
 */
async function clickNaJanela(page, selectors, options = {}) {
  const janelas = page.locator(SELECTORS.createDialog.join(', '));
  const total = await janelas.count().catch(() => 0);

  // De trás para frente: quando há mais de um modal aberto (o de confirmar
  // descarte, por exemplo), o de cima é o último do DOM — e é nele que o
  // clique precisa cair.
  for (let i = total - 1; i >= 0; i--) {
    const janela = janelas.nth(i);
    if (!await janela.isVisible().catch(() => false)) continue;

    for (const sel of selectors) {
      try {
        const alvo = janela.locator(sel).first();
        if ((await alvo.count()) > 0 && await alvo.isVisible()) {
          await alvo.click(options);
          return true;
        }
      } catch { /* seletor inválido para esta versão da página */ }
    }
  }

  // Nenhum modal na tela: tenta o clique global. É melhor tentar do que travar
  // caso o Instagram mude a marcação da janela.
  if (total === 0) return clickFirstMatch(page, selectors, options);

  return false;
}

/**
 * Escolhe o recorte "Original" na tela de corte.
 *
 * O Instagram abre todo vídeo já em 1:1 — quadrado. Um reel vertical ia ao ar
 * com as bordas cortadas, e nada no painel denunciava: o corte é decisão do
 * Instagram, não do arquivo.
 *
 * Vale para toda conta, sem opção de desligar. Mandar o vídeo inteiro é o que
 * se espera de uma automação de reels.
 *
 * Nunca lança. Recorte errado é ruim; publicação travada por causa de um menu
 * que mudou de nome é pior.
 */
async function escolherRecorteOriginal(page, videoName, timeoutMs = 120_000) {
  const limite = Date.now() + timeoutMs;

  // Espera a tela de corte existir: logo depois de escolher o arquivo o vídeo
  // ainda está subindo e nada dela está na tela.
  while (Date.now() < limite) {
    if (await clickNaJanela(page, SELECTORS.cropButton)) break;

    // Passou direto para a legenda: não há tela de corte neste fluxo.
    if (await naTelaDaLegenda(page)) {
      await logEvent({
        video: videoName, action: 'RECORTE_NAO_ENCONTRADO', status: 'WARNING',
        message: 'A tela de corte não apareceu; o vídeo vai com o recorte que o Instagram escolher.',
      });
      return;
    }
    await page.waitForTimeout(1000);
  }

  await page.waitForTimeout(600);

  // O menu de recorte é um popover, e o Instagram monta popover FORA do
  // div[role="dialog"] — solto no corpo da página. Um clique escopado à janela
  // não alcança: o menu abria e "Original" nunca era clicado. Daí a segunda
  // tentativa na página inteira.
  const escolheu = await clickNaJanela(page, SELECTORS.cropOriginal)
    || await clickFirstMatch(page, SELECTORS.cropOriginal);

  if (escolheu) {
    await logEvent({
      video: videoName, action: 'RECORTE_ORIGINAL', status: 'INFO',
      message: 'Recorte "Original": o vídeo vai inteiro, sem corte quadrado.',
    });
  } else {
    // Diz o que o menu tinha de verdade. Sem isso, "não encontrei" não
    // distingue nome trocado de menu que nem abriu.
    const opcoes = await page.evaluate(() => {
      const vistos = [];
      for (const el of document.querySelectorAll('[role="button"], button, [role="menuitem"], div[tabindex="0"]')) {
        const t = (el.innerText || '').trim();
        if (t && t.length <= 24 && !vistos.includes(t)) vistos.push(t);
      }
      return vistos.slice(0, 25);
    }).catch(() => []);

    await logEvent({
      video: videoName, action: 'RECORTE_NAO_ENCONTRADO', status: 'WARNING',
      message: `"Original" não foi clicado. Na tela havia: ${opcoes.join(' | ') || '(nada legível)'}`,
    });

    // Fecha o menu, senão ele fica por cima do "Avançar".
    await page.keyboard.press('Escape').catch(() => {});
  }

  await page.waitForTimeout(400);
}

/**
 * Espera o botão APARECER e clica.
 *
 * Olhar uma vez e desistir não serve aqui: logo depois de escolher o arquivo o
 * vídeo ainda está subindo, e o "Avançar" só existe quando o Instagram termina
 * de processar. O sintoma de olhar cedo demais era a publicação parar no passo
 * 1 com a janela aberta e nenhum botão dentro dela.
 *
 * `parar` é a condição de fim de fila — quando ela é verdadeira, não há mais o
 * que avançar e esperar o prazo inteiro seria só travar.
 */
async function esperarEClicar(page, selectors, timeoutMs, parar) {
  const limite = Date.now() + timeoutMs;

  while (Date.now() < limite) {
    if (await clickNaJanela(page, selectors)) return true;
    if (parar && await parar()) return false;
    await page.waitForTimeout(1000);
  }
  return false;
}

/**
 * Já chegamos na tela da legenda?
 *
 * A busca é DENTRO do modal de propósito. O feed atrás dele tem um
 * "Compartilhar" em cada publicação, e procurar na página inteira daria tela da
 * legenda encontrada antes mesmo de o vídeo subir.
 */
async function naTelaDaLegenda(page) {
  const janelas = page.locator(SELECTORS.createDialog.join(', '));
  const total = await janelas.count().catch(() => 0);

  for (let i = total - 1; i >= 0; i--) {
    const janela = janelas.nth(i);
    if (!await janela.isVisible().catch(() => false)) continue;

    for (const sel of [...SELECTORS.captionTextbox, ...SELECTORS.shareButton]) {
      try {
        if (await janela.locator(sel).first().isVisible()) return true;
      } catch { /* seletor inválido para esta versão da página */ }
    }
  }
  return false;
}

/**
 * Quantos modais estão visíveis agora.
 *
 * Conta só o que está VISÍVEL: o Instagram deixa `div[role="dialog"]` vazios e
 * escondidos no DOM, e contá-los faria a janela parecer aberta para sempre.
 */
async function janelasAbertas(page) {
  const janelas = page.locator(SELECTORS.createDialog.join(', '));
  const total = await janelas.count().catch(() => 0);

  let visiveis = 0;
  for (let i = 0; i < total; i++) {
    if (await janelas.nth(i).isVisible().catch(() => false)) visiveis++;
  }
  return visiveis;
}

/**
 * Link do post mais recente do perfil.
 *
 * É a única prova de verdade de que um reel foi ao ar. Tudo o que acontece
 * dentro da janela de criação — texto de sucesso, a janela fechar — diz que o
 * Instagram ACEITOU o envio, não que ele publicou: a janela também fecha
 * quando ele recusa. Foi assim que o painel marcou como publicado um reel que
 * não estava no perfil.
 *
 * Devolve null quando o perfil não tem post nenhum, o que também é uma
 * resposta útil: qualquer link que apareça depois é novo.
 */
async function primeiroPostDoPerfil(page, username) {
  await page.goto(`https://www.instagram.com/${username}/`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  }).catch(() => {});

  // A grade é montada por JavaScript; sem esta espera lê-se uma página vazia
  // e conclui-se que o perfil não tem nada.
  await page.waitForSelector('main a[href*="/reel/"], main a[href*="/p/"]', { timeout: 20_000 })
    .catch(() => null);

  return page.locator('main a[href*="/reel/"], main a[href*="/p/"]').first()
    .getAttribute('href').catch(() => null);
}

/**
 * Confere no perfil que o reel foi mesmo ao ar.
 *
 * Olha se o post mais recente é POSTERIOR ao início desta publicação, em vez
 * de comparar com um link capturado antes de subir o vídeo. Isso muda duas
 * coisas que importavam:
 *
 * - não custa uma navegação ao perfil antes do upload, no caminho crítico;
 * - não exige uma segunda aba aberta durante a publicação inteira.
 *
 * O corte é o instante de início, não uma idade máxima. Uma janela frouxa de
 * "15 minutos" aceitava o post ANTERIOR da mesma conta — a automação publica
 * de 10 em 10 minutos, então o post de 11 minutos atrás ainda cabia nela, e a
 * conferência dava por publicado um reel que não tinha ido ao ar.
 *
 * A margem de 60s existe porque o relógio do Instagram não é o desta máquina.
 *
 * A aba é aberta aqui e fechada antes de retornar — nunca sobra uma segunda
 * janela no Chrome.
 */
async function conferirNoPerfil(context, username, videoName, desde, timeoutMs = 120_000) {
  const aba = await context.newPage();
  const limite = Date.now() + timeoutMs;
  const corte = desde - 60_000;

  try {
    while (Date.now() < limite) {
      const link = await primeiroPostDoPerfil(aba, username);

      if (link) {
        await aba.goto(new URL(link, 'https://www.instagram.com').href, {
          waitUntil: 'domcontentloaded', timeout: 60_000,
        }).catch(() => {});

        const quando = await aba.locator('time[datetime]').first()
          .getAttribute('datetime').catch(() => null);
        const publicadoEm = quando ? Date.parse(quando) : NaN;

        if (Number.isFinite(publicadoEm) && publicadoEm >= corte) {
          await logEvent({
            video: videoName, action: 'CONFIRMADO_NO_PERFIL', status: 'INFO',
            message: `O post mais recente de @${username} é de ${new Date(publicadoEm).toLocaleTimeString('pt-BR')}, `
              + 'depois do início deste envio.',
          });
          return true;
        }
      }

      await aba.waitForTimeout(10_000);
    }
    return false;
  } finally {
    await aba.close().catch(() => {});
  }
}

/**
 * Confirma que a publicação saiu.
 *
 * Duas provas independentes, porque nenhuma sozinha é confiável:
 *
 * 1. O texto de sucesso ("Reels compartilhados" e variantes). Depende do
 *    idioma e da redação do Instagram, que muda sem aviso.
 * 2. A JANELA DE CRIAÇÃO SUMIR. Ela fica aberta durante todo o processo e só
 *    fecha quando o reel é aceito — é estrutural e não depende de idioma.
 *
 * A segunda existe porque a primeira já falhou: uma publicação que foi ao ar
 * voltou como "não confirmada", o vídeo permaneceu na fila e seria republicado.
 */
async function confirmarPublicacao(page, videoName, timeoutMs) {
  const limite = Date.now() + timeoutMs;

  while (Date.now() < limite) {
    for (const t of SELECTORS.successIndicators.textPatterns) {
      const achou = await page.locator(`text=${t}`).count().catch(() => 0);
      if (achou > 0) {
        await logEvent({ video: videoName, action: 'CONFIRMADO_POR_TEXTO', status: 'INFO', message: t });
        return 'TEXTO';
      }
    }

    // A janela de criação fechou: o Instagram aceitou o reel.
    const aberta = await janelasAbertas(page);
    if (aberta === 0) {
      await logEvent({
        video: videoName, action: 'CONFIRMADO_POR_JANELA', status: 'INFO',
        message: 'A janela de criação fechou — o Instagram aceitou o reel.',
      });
      return 'JANELA';
    }

    await page.waitForTimeout(1000);
  }

  return null;
}

/**
 * Liga o "Adicionar rótulo de IA" na tela da legenda.
 *
 * O Instagram exige esse rótulo em foto e vídeo realistas gerados por IA. O
 * interruptor fica logo abaixo do campo de legenda, e é um `div` com classes
 * geradas — o texto ao lado dele é o único ponto de apoio estável, então a
 * busca começa por ele e sobe até a linha que contém o controle.
 *
 * NÃO derruba a publicação quando não encontra: fica um aviso em Atividade e o
 * vídeo vai ao ar. Falhar aqui esgotaria as tentativas e pausaria a conta por
 * causa de um interruptor — mas o aviso importa, porque quem ligou a opção
 * precisa saber que o rótulo não foi aplicado naquele post.
 */
async function toggleAiLabel(page, videoName) {
  for (const texto of SELECTORS.aiLabelText) {
    const rotulo = page.getByText(texto, { exact: false }).first();
    if ((await rotulo.count()) === 0) continue;

    await rotulo.scrollIntoViewIfNeeded().catch(() => {});

    // Sobe até o primeiro ancestral que contenha um controle, e pega o
    // controle de dentro dele. Procurar na página inteira acertaria o
    // interruptor de outra opção.
    const linha = rotulo.locator(
      'xpath=ancestor::div[.//input[@type="checkbox"] or .//*[@role="switch"]][1]',
    ).first();
    if ((await linha.count()) === 0) continue;

    const controle = linha.locator(SELECTORS.aiLabelSwitch.join(', ')).first();
    if ((await controle.count()) === 0) continue;

    // Já ligado? Clicar de novo desligaria.
    const marcado = await controle.isChecked().catch(async () => {
      const aria = await controle.getAttribute('aria-checked').catch(() => null);
      return aria === 'true';
    });

    if (marcado) {
      await logEvent({ video: videoName, action: 'ROTULO_IA_JA_LIGADO', status: 'INFO' });
      return true;
    }

    await controle.click({ timeout: 5000 }).catch(async () => {
      // Alguns interruptores só respondem ao clique no rótulo.
      await rotulo.click({ timeout: 5000 }).catch(() => {});
    });
    await page.waitForTimeout(600);

    const agora = await controle.isChecked().catch(async () => {
      const aria = await controle.getAttribute('aria-checked').catch(() => null);
      return aria === 'true';
    });

    if (agora) {
      await logEvent({ video: videoName, action: 'ROTULO_IA_LIGADO', status: 'INFO' });
      return true;
    }

    await logEvent({
      video: videoName, action: 'ROTULO_IA_NAO_CONFIRMADO', status: 'WARNING',
      message: 'Achei o interruptor de rótulo de IA mas não consegui confirmar que ligou. O vídeo foi publicado SEM o rótulo.',
    });
    return false;
  }

  await logEvent({
    video: videoName, action: 'ROTULO_IA_NAO_ENCONTRADO', status: 'WARNING',
    message: 'A opção "Adicionar rótulo de IA" não apareceu nesta tela. O vídeo foi publicado SEM o rótulo — confira server/playwright/selectors.js se o Instagram mudou o texto.',
  });
  return false;
}

/**
 * Digita a legenda de forma confiável num editor rich-text (Draft.js/Lexical),
 * confirmando o resultado antes de seguir. .fill() não serve aqui porque não
 * dispara os eventos de teclado que esse tipo de editor espera; por isso
 * usamos digitação simulada de verdade e conferimos o texto depois.
 *
 * Faz até 2 tentativas completas (clicar + digitar + conferir) antes de
 * desistir e seguir sem legenda.
 */
/**
 * Espera o campo de legenda aparecer VISÍVEL.
 *
 * A procura antiga era uma olhada só, logo depois do "Avançar" — e a tela da
 * legenda leva cerca de 1 s para montar. Em 21/09 ela rodou 180 a 270 ms depois
 * do clique, quatro vezes, não achou nada e registrou "publicação seguirá sem
 * legenda". Nas quatro a postagem falhou mais adiante por acaso; se o botão de
 * compartilhar já estivesse pronto, o reel teria ido ao ar sem texto.
 */
async function esperarCampoDeLegenda(page, timeoutMs = 15_000) {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    const campo = await locateCaptionBox(page);
    if ((await campo.count()) > 0 && await campo.isVisible().catch(() => false)) return campo;
    await page.waitForTimeout(300);
  }
  return null;
}

async function typeCaption(page, videoName, caption) {
  // Normaliza SÓ o que é representação, nunca o conteúdo.
  //
  // Ignorar todo espaço em branco — o que esta comparação fazia antes — cega
  // justamente para o defeito mais comum: um espaço a mais que ninguém digitou.
  // A legenda podia sair com "#TVアニメ 「ONEPIECE」" no lugar de
  // "#TVアニメ「ONEPIECE」" e a conferência ainda dizia "88 caracteres conferidos".
  //
  // O que segue normalizado é só representação: fim de linha (o campo devolve
  // CR+LF), espaço inquebrável (o editor troca espaço comum por U+00A0 ao redor
  // de hashtag) e espaço sobrando no fim das linhas.
  const normalizar = (t) => (t || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .trim();
  const esperado = normalizar(caption);

  await logEvent({
    video: videoName, action: 'LEGENDA_ENVIADA', status: 'INFO',
    message: `${caption.length} caracteres, começa com: "${caption.slice(0, 40)}"`,
  });

  let noCampo = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const captionBox = await esperarCampoDeLegenda(page);

    // Interrompe em vez de seguir. Post sem legenda não tem conserto — não
    // dá para editar o texto de um reel pelo app depois —, enquanto a
    // publicação que falha volta para a fila e sai certa na próxima.
    if (!captionBox) {
      await logEvent({ video: videoName, action: 'LEGENDA_NAO_ENCONTRADA', status: 'WARNING', message: 'Campo de legenda não apareceu em 15 s; publicação interrompida para não ir ao ar sem legenda.' });
      throw new Error('O campo de legenda não apareceu. A publicação foi interrompida para não ir ao ar sem legenda — o vídeo volta para a fila.');
    }

    const focused = await ensureFocused(page, captionBox);
    if (!focused) {
      await logEvent({ video: videoName, action: 'LEGENDA_FOCO_FALHOU', status: 'WARNING', message: `Tentativa ${attempt}: não foi possível focar o campo de legenda.` });
      continue;
    }

    // Limpa o que a tentativa anterior deixou, senão o texto entra duplicado.
    if (attempt > 1) {
      await page.keyboard.press('Control+A').catch(() => {});
      await page.keyboard.press('Delete').catch(() => {});
    }

    if (attempt === 1) {
      // `insertText` entrega o texto inteiro de uma vez, pelo mesmo caminho de
      // um "colar". `pressSequentially` simula tecla por tecla — e teclado não
      // é como se escreve japonês: caractere que não existe numa tecla depende
      // do IME, e é aí que a legenda tem chance de chegar truncada ou trocada.
      await page.keyboard.insertText(caption);
    } else {
      await captionBox.pressSequentially(caption, { delay: 20 });
    }

    // Espera o texto assentar e confere se é MESMO o que foi mandado. A
    // checagem antiga só exigia "campo não vazio", então uma legenda errada ou
    // pela metade passava como preenchida.
    noCampo = '';
    for (let i = 0; i < 10; i++) {
      noCampo = normalizar(await captionBox.innerText().catch(() => ''));
      if (noCampo === esperado) break;
      await page.waitForTimeout(500);
    }

    if (noCampo === esperado) {
      await logEvent({ video: videoName, action: 'LEGENDA_PREENCHIDA', status: 'INFO', message: `${caption.length} caracteres conferidos no campo.` });
      return;
    }

    // Aponta a PRIMEIRA posição diferente, com os arredores dos dois lados.
    // "não bateu" com dois textos japoneses lado a lado é ilegível; o trecho
    // exato onde divergiu diz na hora se sobrou um espaço, se faltou um
    // caractere ou se o texto inteiro é outro.
    let i = 0;
    while (i < noCampo.length && i < esperado.length && noCampo[i] === esperado[i]) i++;
    const trecho = (t) => JSON.stringify(t.slice(Math.max(0, i - 8), i + 8));

    await logEvent({
      video: videoName, action: 'LEGENDA_DIVERGENTE', status: 'WARNING',
      message: `Tentativa ${attempt}: divergiu no caractere ${i + 1}. `
        + `No campo (${noCampo.length} caracteres): ${trecho(noCampo)} — `
        + `esperado (${esperado.length}): ${trecho(esperado)}`,
    });
  }

  await logEvent({ video: videoName, action: 'LEGENDA_FALHOU', status: 'WARNING', message: 'A legenda no campo não bateu com a enviada, nas duas tentativas.' });

  // Divergência pequena (um espaço trocado) ainda publica, com o aviso acima.
  // Campo VAZIO não: seria o mesmo post sem legenda do caso sem campo.
  if (!noCampo) {
    throw new Error('A legenda não entrou no campo nas duas tentativas. A publicação foi interrompida para não ir ao ar sem legenda — o vídeo volta para a fila.');
  }
}

/**
 * Espera até que QUALQUER UM dos textos da lista apareça na página, testando
 * cada um individualmente em loop (poll a cada 500ms).
 *
 * IMPORTANTE: não combinar múltiplos "text=..." numa única string separada
 * por vírgula — o engine "text=" do Playwright não trata vírgula como
 * separador "ou"; ele consome a vírgula como parte literal do texto
 * procurado. Isso fazia a confirmação de sucesso nunca ser detectada, mesmo
 * com os textos corretos na lista, porque a busca virava um texto gigante
 * que não existe na tela.
 */
async function waitForAnyText(page, textPatterns, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const t of textPatterns) {
      const count = await page.locator(`text=${t}`).count().catch(() => 0);
      if (count > 0) return true;
    }
    await page.waitForTimeout(500);
  }
  return false;
}

/**
 * Executa o fluxo completo de publicação de um Reel:
 * acessa o Instagram -> abre criação de publicação -> seleciona o vídeo ->
 * avança pelas telas de edição (aplicando a capa personalizada, se houver) ->
 * preenche a legenda -> compartilha -> AGUARDA confirmação observável de
 * sucesso antes de considerar concluído.
 *
 * `coverPath`, quando informado, deve ser o caminho ABSOLUTO da imagem de
 * capa no disco (ver server/services/coverManager.js#resolveEffectiveCoverPath).
 * Se null/undefined, a etapa de capa é ignorada e o Instagram usa a própria
 * sugestão automática.
 *
 * Lança erro em qualquer etapa que falhar ou que não puder ser confirmada —
 * a responsabilidade de decidir sobre novas tentativas é do schedulerService.
 */
export async function publishReel({
  filepath, caption, videoName, coverPath, accountId, username, aiLabel = false,
}) {
  const start = Date.now();
  const context = await contextFor(accountId);
  const page = await context.newPage();

  // A publicação usa UMA aba só.
  //
  // A conferência no perfil já morou aqui, numa segunda aba aberta do começo ao
  // fim — e o resultado era o Chrome com duas abas durante a publicação
  // inteira. Hoje ela só abre se fizer falta, no fim, e fecha em seguida.
  try {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
    await handleCheckpointIfNeeded(page, videoName);

    // ESPERA a barra lateral existir antes de procurar o botão.
    //
    // `domcontentloaded` dispara quando o HTML chegou, e o Instagram é uma
    // aplicação de página única: o menu só é desenhado depois que o JavaScript
    // roda. Procurar nesse instante encontrava uma tela vazia e concluía que a
    // interface tinha mudado — com a conta conectada e o botão a caminho.
    await page.waitForSelector(SELECTORS.createButton.join(', '), {
      state: 'visible',
      timeout: 30_000,
    }).catch(() => null);

    let opened = await clickFirstMatch(page, SELECTORS.createButton);

    // Segunda chance com recarga.
    //
    // Numa janela recém-aberta o Instagram às vezes serve uma tela incompleta
    // — a barra lateral nunca termina de montar. Recarregar resolve, e é bem
    // mais barato que falhar a publicação e gastar uma tentativa.
    if (!opened) {
      await logEvent({
        video: videoName, action: 'RECARREGANDO_FEED', status: 'WARNING',
        message: 'Botão de criar não apareceu na primeira carga; recarregando a página.',
      });
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      await page.waitForSelector(SELECTORS.createButton.join(', '), {
        state: 'visible',
        timeout: 30_000,
      }).catch(() => null);
      opened = await clickFirstMatch(page, SELECTORS.createButton);
    }

    if (!opened) {
      throw new Error(
        'Botão de criar publicação não encontrado. Rode GET /api/accounts/<id>/diagnostico: '
        + 'ele lista os rótulos que estão na tela agora, e o nome novo do botão sai de lá '
        + '(ajuste server/playwright/selectors.js).',
      );
    }
    await page.waitForTimeout(1000);

    // Em algumas versões da UI, depois de clicar em "Criar" abre um menu com
    // "Postar" / "Vídeo ao vivo" / "Anúncio" — precisa escolher "Postar"
    // para chegar na tela de upload. Em outras versões, já abre direto.
    await clickNaJanela(page, SELECTORS.postOption).catch(() => {});
    await page.waitForTimeout(800);

    // Confirma que realmente chegamos na tela de upload antes de seguir —
    // evita continuar com o menu de criação ainda aberto (isso deixava a
    // página do Instagram num estado quebrado e gerava "Ocorreu um erro").
    const selectBtnCount = await countAnyMatch(page, SELECTORS.selectFromComputerButton);
    const fileInputCount = await page.locator(SELECTORS.fileInput).count();
    if (selectBtnCount === 0 && fileInputCount === 0) {
      throw new Error('Não chegou na tela de upload após clicar em "Criar"/"Postar". O menu pode ter ficado aberto ou a interface mudou — verifique server/playwright/selectors.js.');
    }

    await uploadFile(page, filepath);
    await logEvent({ video: videoName, action: 'ARQUIVO_SELECIONADO', status: 'INFO' });

    await handleCheckpointIfNeeded(page, videoName);

    // Avança pelas telas de "Cortar" (recorte), "Editar" (onde fica a "Foto
    // da capa" + "Encurtar") e filtro — normalmente 2-3 passos, por isso o
    // loop com folga. Se houver uma capa personalizada, ela é aplicada assim
    // que a tela com "Foto da capa" aparecer (não necessariamente a
    // primeira), antes de seguir clicando em "Avançar".
    // O recorte vem antes de tudo: a tela de corte é a primeira depois do
    // upload, e é nela que o Instagram já deixa o vídeo quadrado.
    await escolherRecorteOriginal(page, videoName);

    let coverAttempted = !coverPath;
    for (let passo = 1; passo <= 4; passo++) {
      if (await naTelaDaLegenda(page)) break;

      if (!coverAttempted) {
        coverAttempted = await selectCustomCover(page, videoName, coverPath);
      }

      const advanced = await esperarEClicar(
        page, SELECTORS.nextButton, 120_000, () => naTelaDaLegenda(page),
      );

      // Registra cada volta: sem isto, "parou entre o upload e a legenda" não
      // diz em qual etapa parou nem se a janela ainda estava lá — e foi
      // exatamente essa cegueira que fez a causa ser confundida com limite de
      // publicação do Instagram.
      await logEvent({
        video: videoName,
        action: 'AVANCANDO',
        status: 'INFO',
        message: `passo ${passo}: ${advanced ? 'avançou' : 'fim das telas de edição'}`
          + `, janelas visíveis: ${await janelasAbertas(page)}`,
      });

      if (!advanced) break;
    }

    await handleCheckpointIfNeeded(page, videoName);

    // A janela de criação ainda está aberta?
    //
    // Se ela SUMIU depois de o arquivo ter sido enviado, o Instagram
    // interrompeu o envio — e a tela por baixo é o feed. É o sinal típico de
    // limite de publicação atingido: acontece depois de muitos envios em pouco
    // tempo, e contando as tentativas que falharam.
    //
    // Distinguir isso importa porque a reação certa é OPOSTA à de uma falha
    // comum: repetir piora, e o agendador tentaria três vezes por vídeo.
    const janelaAberta = await janelasAbertas(page);

    if (janelaAberta === 0) {
      const telaAtual = await page.evaluate(
        () => (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
      ).catch(() => '');

      await logEvent({
        video: videoName, action: 'ENVIO_INTERROMPIDO', status: 'ERROR',
        message: `O Instagram fechou a janela de criação depois do upload. Tela: "${telaAtual}"`,
      });

      const err = new Error(
        'O Instagram interrompeu o envio e fechou a janela de criação. Isso costuma ser limite de '
        + 'publicação: acontece depois de muitos envios em pouco tempo, contando as tentativas que '
        + 'falharam. Pare a automação desta conta por algumas horas e volte com um intervalo maior. '
        + 'Insistir agora piora.',
      );
      // Marca para o agendador não gastar as três tentativas nem pausar a
      // conta como se fosse defeito dela.
      err.semRetentativa = true;
      throw err;
    }

    if (caption) {
      await typeCaption(page, videoName, caption);
    }

    // Depois da legenda e antes de compartilhar: é onde o interruptor está na
    // tela, e ligá-lo antes da legenda arriscaria o campo perder o foco.
    if (aiLabel) {
      await toggleAiLabel(page, videoName);
    }

    const shared = await clickNaJanela(page, SELECTORS.shareButton);
    if (!shared) {
      throw new Error('Botão "Compartilhar" não encontrado. Verifique server/playwright/selectors.js.');
    }

    await logEvent({ video: videoName, action: 'AGUARDANDO_CONFIRMACAO', status: 'INFO', message: 'Aguardando confirmação observável de sucesso.' });

    // Duas confirmações diferentes, e a diferença decide se vale abrir o perfil.
    const comoConfirmou = await confirmarPublicacao(page, videoName, 90_000);

    // "Seu post foi compartilhado" é o próprio Instagram dizendo que publicou.
    // Não há o que conferir depois disso, e conferir custaria uma segunda aba.
    if (comoConfirmou === 'TEXTO') {
      return { ok: true, durationMs: Date.now() - start };
    }

    // Só a janela ter fechado não prova nada: ela também fecha quando o envio é
    // recusado. Foi assim que o painel marcou como publicado um reel que não
    // estava no perfil. Aqui — e só aqui — vale a ida ao perfil.
    if (comoConfirmou === 'JANELA' && username) {
      if (await conferirNoPerfil(context, username, videoName, start)) {
        return { ok: true, durationMs: Date.now() - start };
      }

      throw new Error(
        `O Instagram aceitou o envio mas o reel não apareceu no perfil de @${username} em 2 minutos. `
        + 'Ele pode estar em processamento — confira o perfil antes de tentar de novo.',
      );
    }

    if (comoConfirmou === 'JANELA') {
      await logEvent({
        video: videoName, action: 'CONFIRMACAO_FRACA', status: 'WARNING',
        message: 'Sem o @ da conta, não deu para conferir no perfil. Confirmado só pelo fechamento da janela.',
      });
      return { ok: true, durationMs: Date.now() - start };
    }

    // Nada confirmou dentro do prazo. O "Compartilhar" JÁ FOI CLICADO aqui, e
    // é a situação mais perigosa que existe neste arquivo: dar isso como falha
    // agenda uma nova tentativa, e se o reel tiver ido ao ar o perfil termina
    // com o vídeo publicado duas vezes.
    //
    // Por isso a última palavra é do perfil, não do relógio. O Instagram às
    // vezes leva mais que 90s para processar um vídeo grande, e o preço de
    // esperar mais é uma publicação lenta — contra um post duplicado.
    if (username && await conferirNoPerfil(context, username, videoName, start)) {
      await logEvent({
        video: videoName, action: 'CONFIRMADO_TARDE', status: 'WARNING',
        message: 'O sinal de sucesso não apareceu em 90s, mas o reel está no perfil. '
          + 'Publicado — e sem nova tentativa, que duplicaria o post.',
      });
      return { ok: true, durationMs: Date.now() - start };
    }

    // Diz o que ESTAVA na tela quando desistiu. Sem isso, "não confirmei" não
    // distingue "falhou" de "deu certo e eu não soube reconhecer".
    const naTela = await page.evaluate(
      () => (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
    ).catch(() => '(não foi possível ler)');

    throw new Error(
      'Não consegui confirmar a publicação em 90s e o reel não apareceu no perfil. '
      + `A tela mostrava: "${naTela}"`,
    );
  } finally {
    // Fecha a aba, não o contexto: a sessão segue viva para a próxima
    // publicação da mesma conta. Quem encerra o navegador é o ciclo de
    // parar/pausar a automação.
    await page.close().catch(() => {});
  }
}
