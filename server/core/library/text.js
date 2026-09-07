/**
 * Manipulação de legendas e hashtags — funções puras, sem banco.
 *
 * Ficam separadas do resto da biblioteca justamente por serem puras: são as
 * regras mais fáceis de errar (rodízio desequilibrado, hashtag duplicada) e
 * as mais fáceis de testar quando não dependem de I/O. Ver tests/text.test.js.
 */

/** Limite de hashtags por publicação imposto pelo Instagram. */
export const MAX_HASHTAGS = 30;

/**
 * Normaliza texto livre de hashtags para uma lista publicável.
 *
 * Aceita o que o usuário digitar — "#futebol, gols  #Copa", uma por linha,
 * com ou sem # — e devolve sem duplicatas, sem pontuação solta e sempre
 * prefixado. A deduplicação é case-insensitive porque #Copa e #copa são a
 * mesma hashtag para o Instagram, mas preserva a caixa da primeira ocorrência,
 * que costuma ser a forma que o usuário quis.
 */
export function normalizeHashtags(raw) {
  const seen = new Set();
  const out = [];

  for (const token of String(raw || '').split(/[\s,;\n\r]+/)) {
    const clean = token.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
    if (!clean) continue;

    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`#${clean}`);
  }

  return out;
}

/**
 * Junta texto e hashtags na legenda final.
 * As hashtags vão em bloco separado por linha em branco — formato que o
 * Instagram renderiza melhor do que hashtags coladas no fim do parágrafo.
 */
export function composeCaption(text, hashtags = []) {
  const body = String(text || '').trim();
  const tags = hashtags.slice(0, MAX_HASHTAGS).join(' ');

  if (body && tags) return `${body}\n\n${tags}`;
  return body || tags;
}

/** Expande itens repetindo cada um conforme seu peso. */
function weightedPool(items) {
  const pool = [];
  for (const item of items) {
    const times = Math.max(1, Math.min(10, item.weight ?? 1));
    for (let i = 0; i < times; i++) pool.push(item);
  }
  return pool;
}

function shuffled(list, random) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Sorteia `count` itens em rodízio equilibrado: percorre o pool inteiro
 * (embaralhado) antes de repetir qualquer item.
 *
 * Um sorteio puramente aleatório produz sequências como A-A-A-B em 4 posts,
 * enquanto uma terceira legenda nunca aparece. Ciclar o pool garante que,
 * a cada volta, todo item saiu o número de vezes correspondente ao seu peso.
 *
 * `random` é injetável para o teste ser determinístico.
 */
export function rotate(items, count, random = Math.random) {
  if (!items.length || count <= 0) return [];

  const pool = weightedPool(items);
  const picked = [];
  let cycle = shuffled(pool, random);

  for (let i = 0; i < count; i++) {
    if (!cycle.length) cycle = shuffled(pool, random);
    picked.push(cycle.pop());
  }

  return picked;
}
