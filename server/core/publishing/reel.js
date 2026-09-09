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
async function typeCaption(page, videoName, caption) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const captionBox = await locateCaptionBox(page);

    if ((await captionBox.count()) === 0) {
      await logEvent({ video: videoName, action: 'LEGENDA_NAO_ENCONTRADA', status: 'WARNING', message: 'Campo de legenda não localizado; publicação seguirá sem legenda.' });
      return;
    }

    const focused = await ensureFocused(page, captionBox);
    if (!focused) {
      await logEvent({ video: videoName, action: 'LEGENDA_FOCO_FALHOU', status: 'WARNING', message: `Tentativa ${attempt}: não foi possível focar o campo de legenda.` });
      continue;
    }

    await captionBox.pressSequentially(caption, { delay: 20 });

    // Confere em loop (até 5s) se o texto realmente entrou no campo
    let confirmed = false;
    for (let i = 0; i < 10; i++) {
      const typedText = await captionBox.innerText().catch(() => '');
      if (typedText && typedText.trim().length > 0) {
        confirmed = true;
        break;
      }
      await page.waitForTimeout(500);
    }

    if (confirmed) {
      await logEvent({ video: videoName, action: 'LEGENDA_PREENCHIDA', status: 'INFO' });
      return;
    }

    await logEvent({ video: videoName, action: 'LEGENDA_NAO_CONFIRMADA', status: 'WARNING', message: `Tentativa ${attempt}: texto não apareceu no campo após digitação.` });
  }

  await logEvent({ video: videoName, action: 'LEGENDA_FALHOU', status: 'WARNING', message: 'Não foi possível confirmar a legenda após 2 tentativas; publicação seguirá sem legenda.' });
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
export async function publishReel({ filepath, caption, videoName, coverPath, accountId, aiLabel = false }) {
  const start = Date.now();
  const context = await contextFor(accountId);
  const page = await context.newPage();

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

    const opened = await clickFirstMatch(page, SELECTORS.createButton);
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
    await clickFirstMatch(page, SELECTORS.postOption).catch(() => {});
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
    let coverAttempted = !coverPath;
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(1500);

      if (!coverAttempted) {
        coverAttempted = await selectCustomCover(page, videoName, coverPath);
      }

      const advanced = await clickFirstMatch(page, SELECTORS.nextButton);
      if (!advanced) break;
    }

    await handleCheckpointIfNeeded(page, videoName);

    if (caption) {
      await typeCaption(page, videoName, caption);
    }

    // Depois da legenda e antes de compartilhar: é onde o interruptor está na
    // tela, e ligá-lo antes da legenda arriscaria o campo perder o foco.
    if (aiLabel) {
      await toggleAiLabel(page, videoName);
    }

    const shared = await clickFirstMatch(page, SELECTORS.shareButton);
    if (!shared) {
      throw new Error('Botão "Compartilhar" não encontrado. Verifique server/playwright/selectors.js.');
    }

    await logEvent({ video: videoName, action: 'AGUARDANDO_CONFIRMACAO', status: 'INFO', message: 'Aguardando confirmação observável de sucesso.' });

    const confirmed = await waitForAnyText(page, SELECTORS.successIndicators.textPatterns, 90000);

    if (!confirmed) {
      throw new Error('Não foi possível confirmar a publicação: nenhum indicador de sucesso apareceu em 90s.');
    }

    return { ok: true, durationMs: Date.now() - start };
  } finally {
    // Fecha a aba, não o contexto: a sessão segue viva para a próxima
    // publicação da mesma conta. Quem encerra o navegador é o ciclo de
    // parar/pausar a automação.
    await page.close().catch(() => {});
  }
}
