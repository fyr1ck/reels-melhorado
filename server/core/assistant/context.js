import fs from 'fs';
import path from 'path';
import { config } from '../../config/env.js';

/**
 * Descobre QUAIS arquivos do projeto o erro tocou, e lê o trecho relevante.
 *
 * Sem isto, o assistente receberia só a mensagem de erro e teria que adivinhar
 * o código. Com o trecho certo, ele lê a linha que quebrou e as vizinhas.
 */

/** Extensões que o assistente pode ler e propor mudança. */
const EDITAVEIS = new Set(['.js', '.jsx', '.css', '.json', '.prisma']);

/**
 * Pastas que ficam fora do alcance, sempre.
 *
 * `.env` guarda a chave da API e as credenciais; `prisma/data` é o banco;
 * `playwright/session` são os cookies das contas do Instagram. Nada disso é
 * código, e nenhum deles deveria sair da máquina dentro de um prompt.
 */
const PROIBIDOS = [
  'node_modules', '.git', 'prisma/data', 'prisma\\data',
  'playwright/session', 'playwright\\session', 'videos', 'dist', '.env',
];

/**
 * O caminho está dentro do projeto e é seguro tocar?
 *
 * Resolve antes de comparar: sem isso, "server/../../.ssh/id_rsa" passaria na
 * checagem de prefixo por ser textualmente um caminho relativo ao projeto.
 */
export function permitido(caminho) {
  if (!caminho) return false;

  const absoluto = path.resolve(config.raiz, caminho);
  const relativo = path.relative(config.raiz, absoluto);

  // `..` no começo significa que saiu da raiz; caminho absoluto de outro
  // volume também aparece aqui.
  if (relativo.startsWith('..') || path.isAbsolute(relativo)) return false;

  const normalizado = relativo.replace(/\\/g, '/');
  if (PROIBIDOS.some((p) => normalizado === p.replace(/\\/g, '/')
    || normalizado.startsWith(`${p.replace(/\\/g, '/')}/`))) return false;

  return EDITAVEIS.has(path.extname(absoluto));
}

/**
 * Caminhos de arquivo citados num stack trace, na ordem em que aparecem.
 *
 * O stack do Node mistura o código do projeto com o do próprio Node e o das
 * dependências; só o primeiro grupo interessa, e é o que `permitido` filtra.
 */
export function arquivosDoStack(stack = '') {
  const encontrados = [];

  // Casa tanto "file:///C:/proj/server/x.js:12:5" quanto "C:\proj\server\x.js:12:5"
  const regex = /(?:file:\/\/\/)?([A-Za-z]:[\\/][^\s():]+|\/[^\s():]+)[:(](\d+)[:)]/g;
  let m;
  while ((m = regex.exec(stack))) {
    let bruto = m[1];
    try { bruto = decodeURIComponent(bruto); } catch { /* já está decodificado */ }

    const abs = path.resolve(bruto);
    const rel = path.relative(config.raiz, abs).replace(/\\/g, '/');
    if (!permitido(rel)) continue;
    if (encontrados.some((e) => e.arquivo === rel)) continue;

    encontrados.push({ arquivo: rel, linha: Number(m[2]) });
  }
  return encontrados;
}

/** Lê um arquivo do projeto. Devolve null se não for permitido ou não existir. */
export function ler(relativo) {
  if (!permitido(relativo)) return null;
  try {
    return fs.readFileSync(path.resolve(config.raiz, relativo), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Trecho ao redor de uma linha, numerado.
 *
 * As linhas vão numeradas porque o assistente precisa devolver a mudança
 * apontando exatamente onde — e contar linhas de cabeça, num trecho solto,
 * é onde esse tipo de sugestão erra.
 */
export function trecho(conteudo, linha, margem = 25) {
  const linhas = conteudo.split('\n');
  const inicio = Math.max(0, linha - margem - 1);
  const fim = Math.min(linhas.length, linha + margem);

  return linhas
    .slice(inicio, fim)
    .map((t, i) => `${String(inicio + i + 1).padStart(4)}| ${t}`)
    .join('\n');
}

/**
 * Monta o material que vai junto do erro: os arquivos citados no stack, com o
 * trecho ao redor da linha que quebrou.
 *
 * `maxArquivos` existe para o prompt não crescer sem limite — um stack fundo
 * cita dezenas de arquivos, e os primeiros são os que importam.
 */
export function montar(stack, { maxArquivos = 3, margem = 25 } = {}) {
  const alvos = arquivosDoStack(stack).slice(0, maxArquivos);

  return alvos
    .map(({ arquivo, linha }) => {
      const conteudo = ler(arquivo);
      if (!conteudo) return null;

      const linhasTotais = conteudo.split('\n').length;
      // Arquivo pequeno vai inteiro: o contexto completo é melhor que um
      // recorte, e não custa quase nada.
      const corpo = linhasTotais <= 2 * margem + 20
        ? conteudo.split('\n').map((t, i) => `${String(i + 1).padStart(4)}| ${t}`).join('\n')
        : trecho(conteudo, linha, margem);

      return { arquivo, linha, linhasTotais, corpo, completo: linhasTotais <= 2 * margem + 20 };
    })
    .filter(Boolean);
}
