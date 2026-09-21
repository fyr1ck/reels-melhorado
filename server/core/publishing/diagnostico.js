import { contextFor } from '../../playwright/browser.js';
import { SELECTORS } from '../../playwright/selectors.js';

/**
 * O que a página do Instagram mostra agora.
 *
 * A publicação depende de reconhecer botões pelo `aria-label`, e quando o
 * Instagram muda a interface o sintoma é sempre o mesmo: "Botão de 'Nova
 * publicação' não encontrado". Essa mensagem diz o QUE falhou e nada sobre o
 * porquê — se a sessão caiu, se o rótulo mudou de nome, se a página nem
 * carregou.
 *
 * Este módulo abre a mesma página com a mesma sessão e devolve o que está lá:
 * quais seletores casam, e — quando nenhum casa — todos os `aria-label`
 * clicáveis que existem. É a lista de onde sai o seletor novo.
 */

/** Testa uma lista de seletores na página. */
async function conferir(page, lista) {
  const achados = [];
  for (const sel of lista ?? []) {
    try {
      // Cada elemento, não só o primeiro. O Instagram mantém cópias
      // escondidas do mesmo botão (menu recolhido, barra do celular), e o
      // primeiro do DOM costuma ser uma delas: olhando só ele, o diagnóstico
      // dizia "existe, invisível" enquanto a pessoa via o botão na tela — e
      // quem clica, que também pega o primeiro, batia no escondido.
      const loc = page.locator(sel);
      const n = await loc.count();
      const visiveis = [];
      for (let i = 0; i < n; i += 1) {
        if (await loc.nth(i).isVisible().catch(() => false)) visiveis.push(i);
      }
      achados.push({
        seletor: sel, existe: n > 0, total: n,
        visivel: visiveis.length > 0, indicesVisiveis: visiveis,
      });
    } catch {
      achados.push({ seletor: sel, existe: false, visivel: false, invalido: true });
    }
  }
  return achados;
}

export async function inspecionar(accountId) {
  const context = await contextFor(accountId);
  const page = await context.newPage();

  // Por que a rede entra no diagnostico: "botao nao encontrado" tambem e o
  // sintoma de a pagina NUNCA ter montado. Em 20/09 o Instagram ficou parado
  // no splash porque todo JS e CSS de static.cdninstagram.com voltava sem
  // 'Access-Control-Allow-Origin' e com 'Cross-Origin-Resource-Policy:
  // same-origin' -- o navegador bloqueava tudo. Sem estas tres listas, o
  // diagnostico dizia "existe, invisivel" e a causa (a saida de rede) ficava
  // invisivel junto.
  const erros = [];
  const falhas = [];
  const respostas = [];
  page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => erros.push('pageerror: ' + String(e.message).slice(0, 200)));
  page.on('requestfailed', (r) => falhas.push(r.url().slice(0, 120) + ' :: ' + (r.failure()?.errorText || '')));
  page.on('response', (r) => { if (r.status() >= 400) respostas.push(r.status() + ' ' + r.url().slice(0, 120)); });

  try {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // A interface monta em etapas; sem esta pausa o diagnóstico fotografa um
    // esqueleto e conclui que nada existe.
    await page.waitForTimeout(4000);

    const url = page.url();

    // Sessão viva? A página de login redireciona ou mostra o formulário.
    const logado = !/\/accounts\/login/.test(url)
      && (await page.locator('svg[aria-label="Início"], svg[aria-label="Home"], a[href="/"]').count()) > 0;

    // Todo rótulo clicável da tela: é aqui que se lê o nome novo do botão
    // quando o Instagram renomeia alguma coisa.
    const rotulos = await page.evaluate(() => {
      const alvos = [...document.querySelectorAll('[aria-label]')];
      const vistos = new Set();
      const out = [];
      for (const el of alvos) {
        const rotulo = el.getAttribute('aria-label')?.trim();
        if (!rotulo || vistos.has(rotulo)) continue;
        vistos.add(rotulo);

        const r = el.getBoundingClientRect();
        out.push({
          rotulo: rotulo.slice(0, 60),
          tag: el.tagName.toLowerCase(),
          visivel: r.width > 0 && r.height > 0,
        });
      }
      return out.slice(0, 80);
    });

    return {
      url,
      erros: erros.slice(0, 12),
      falhas: falhas.slice(0, 12),
      respostasRuins: respostas.slice(0, 12),
      titulo: await page.title().catch(() => null),
      logado,
      seletores: {
        createButton: await conferir(page, SELECTORS.createButton),
        postOption: await conferir(page, SELECTORS.postOption),
      },
      rotulosNaTela: rotulos,
      texto: await page.evaluate(
        () => (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
      ).catch(() => null),
    };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Abre a tela de corte de verdade e diz o que há no menu de recorte.
 *
 * Sobe um vídeo real, com a sessão real, e para na tela de corte — NUNCA
 * chega perto do "Compartilhar". É a única forma honesta de descobrir por que
 * "Original" não estava sendo selecionado: o menu é montado por JavaScript e
 * não dá para adivinhar a marcação dele lendo o código.
 *
 * Devolve, para cada opção do menu, o texto e o peso da fonte — é o peso que
 * denuncia qual está escolhida, já que o Instagram não marca a seleção com
 * nenhum atributo de acessibilidade.
 */
export async function inspecionarRecorte(accountId, filepath) {
  const context = await contextFor(accountId);
  const page = await context.newPage();

  // Fotografa o menu: texto, peso da fonte e atributos de cada linha.
  const lerMenu = () => page.evaluate(() => {
    const alvos = [...document.querySelectorAll('[role="button"], button, [role="menuitem"], div[tabindex="0"]')];
    const out = [];
    for (const el of alvos) {
      const texto = (el.innerText || '').trim();
      if (!/^(Original|1:1|9:16|16:9)$/.test(texto)) continue;

      const estilo = getComputedStyle(el);
      out.push({
        texto,
        peso: estilo.fontWeight,
        cor: estilo.color,
        desabilitado: el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('disabled'),
        dentroDoDialogo: !!el.closest('div[role="dialog"]'),
        tag: el.tagName.toLowerCase(),
        papel: el.getAttribute('role') || null,
      });
    }
    return out;
  }).catch(() => []);

  try {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector(SELECTORS.createButton.join(', '), { timeout: 30_000 });
    await page.locator(SELECTORS.createButton.join(', ')).first().click();
    await page.waitForTimeout(1200);

    for (const sel of SELECTORS.postOption) {
      const alvo = page.locator(sel).first();
      if ((await alvo.count()) > 0 && await alvo.isVisible().catch(() => false)) {
        await alvo.click().catch(() => {});
        break;
      }
    }
    await page.waitForTimeout(800);

    const entrada = page.locator(SELECTORS.fileInput).first();
    if ((await entrada.count()) === 0) {
      return { ok: false, erro: 'Não cheguei na tela de upload.' };
    }
    await entrada.setInputFiles(filepath);

    // Espera a tela de corte. O vídeo ainda está subindo quando o upload
    // retorna, e o botão do recorte só existe depois do processamento.
    const limite = Date.now() + 120_000;
    let botao = null;
    while (Date.now() < limite) {
      for (const sel of SELECTORS.cropButton) {
        const alvo = page.locator(sel).first();
        if ((await alvo.count().catch(() => 0)) > 0 && await alvo.isVisible().catch(() => false)) {
          botao = { seletor: sel, alvo };
          break;
        }
      }
      if (botao) break;
      await page.waitForTimeout(1000);
    }

    if (!botao) {
      const rotulos = await page.evaluate(
        () => [...new Set([...document.querySelectorAll('[aria-label]')]
          .map((e) => e.getAttribute('aria-label')?.trim()).filter(Boolean))].slice(0, 40),
      ).catch(() => []);
      return { ok: false, erro: 'O botão de recorte não apareceu.', rotulosNaTela: rotulos };
    }

    // A proporção do vídeo na tela é a única prova objetiva de que o recorte
    // mudou. O peso da fonte não serve: o Instagram devolve 400 para todas as
    // opções, escolhida ou não.
    const lerVideo = () => page.evaluate(() => {
      const v = document.querySelector('div[role="dialog"] video');
      if (!v) return null;
      const r = v.getBoundingClientRect();
      return {
        largura: Math.round(r.width),
        altura: Math.round(r.height),
        proporcao: r.height ? +(r.width / r.height).toFixed(3) : null,
      };
    }).catch(() => null);

    const videoAntes = await lerVideo();

    await botao.alvo.click();
    await page.waitForTimeout(800);

    const antes = await lerMenu();

    // Tenta dentro da janela e depois na página inteira — o popover costuma
    // ser montado fora do div[role="dialog"].
    let comoClicou = null;
    for (const sel of SELECTORS.cropOriginal) {
      const naJanela = page.locator('div[role="dialog"]').last().locator(sel).first();
      if ((await naJanela.count().catch(() => 0)) > 0 && await naJanela.isVisible().catch(() => false)) {
        await naJanela.click().catch(() => {});
        comoClicou = `dentro da janela, com ${sel}`;
        break;
      }
      const solto = page.locator(sel).first();
      if ((await solto.count().catch(() => 0)) > 0 && await solto.isVisible().catch(() => false)) {
        await solto.click().catch(() => {});
        comoClicou = `na página inteira, com ${sel}`;
        break;
      }
    }

    await page.waitForTimeout(1500);

    const videoDepois = await lerVideo();

    // Reabre o menu procurando o botão de novo: o locator antigo pode ter
    // ficado para trás quando o Instagram remontou a barra.
    await page.locator(SELECTORS.cropButton.join(', ')).first().click().catch(() => {});
    await page.waitForTimeout(800);
    const depois = await lerMenu();

    return {
      ok: true,
      botaoDeRecorte: botao.seletor,
      comoClicou: comoClicou || 'NENHUM seletor de "Original" casou',
      videoAntes,
      videoDepois,
      mudouARelacao: !!(videoAntes && videoDepois && videoAntes.proporcao !== videoDepois.proporcao),
      menuAntes: antes,
      menuDepois: depois,
    };
  } finally {
    // Fecha sem publicar. O rascunho fica descartado pelo próprio Instagram.
    await page.close().catch(() => {});
  }
}
