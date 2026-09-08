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
      const loc = page.locator(sel).first();
      const n = await loc.count();
      achados.push({ seletor: sel, existe: n > 0, visivel: n > 0 && await loc.isVisible() });
    } catch {
      achados.push({ seletor: sel, existe: false, visivel: false, invalido: true });
    }
  }
  return achados;
}

export async function inspecionar(accountId) {
  const context = await contextFor(accountId);
  const page = await context.newPage();

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
