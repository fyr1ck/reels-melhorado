import path from 'path';
import { listaDe, regrasDe } from './niches.js';

/**
 * O cálculo de compatibilidade entre um conteúdo e os nichos cadastrados.
 *
 * Este arquivo é DELIBERADAMENTE puro: entra texto e uma lista de nichos, sai
 * pontuação. Nada de banco, rede ou disco. Três razões:
 *
 * 1. dá para testar sem subir servidor nem gastar chamada de API;
 * 2. funciona sem chave de IA nenhuma — a classificação por regras é o piso,
 *    e o painel continua útil para quem nunca configurar a API;
 * 3. quando a IA entra, ela REFINA um resultado que já existe, em vez de ser
 *    o único caminho. Se a API cair, a fila não para.
 *
 * A pontuação é sempre 0 a 100, e sempre acompanhada dos motivos — "98%" sem
 * explicação não permite ao usuário corrigir o cadastro do nicho.
 */

/** Quanto uma palavra proibida derruba a nota, por nível de rigor. */
const PESO_PROIBIDO = { BAIXO: 15, MEDIO: 35, ALTO: 100 };

/**
 * Quanto CADA acerto vale. A nota é a soma, limitada a 100.
 *
 * Pontuar por acerto, e não pela fração de acertos, é deliberado. A primeira
 * versão dividia acertos pelo total cadastrado, e o efeito era perverso: um
 * vídeo que batia 3 das 5 palavras-chave tirava 46 — nota de BLOQUEADO para
 * conteúdo obviamente do nicho — e cadastrar MAIS palavras-chave baixava a
 * nota de todo mundo, punindo justamente quem descrevia melhor o nicho.
 *
 * Três acertos de palavra-chave já fecham os 100 sozinhos, que é o que a
 * intuição espera: "emagrecer", "dieta" e "calorias" no mesmo vídeo não
 * deixam dúvida sobre o assunto.
 */
const PONTOS = {
  palavraChave: 30,
  subnicho: 20,
  tema: 20,
  nome: 15,
  pasta: 10,
};

/**
 * A partir de quantas letras um termo passa a casar por radical.
 *
 * Abaixo disso a comparação é por palavra inteira: "fé" casando por prefixo
 * pegaria "feriado", "fevereiro" e "federal".
 */
const MINIMO_RADICAL = 6;

/**
 * Normaliza para comparar: sem acento, minúsculo, sem pontuação.
 *
 * Sem isto, "sertões" não casa com "sertoes" e "Emagrecimento!" não casa com
 * "emagrecimento" — e o usuário conclui que o sistema não funciona quando o
 * problema é só um acento.
 */
export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s#]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const escapar = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Um termo está presente no texto?
 *
 * Três comportamentos, e cada um existe por um motivo:
 *
 * - EXPRESSÃO ("perda de peso") casa como trecho;
 * - PALAVRA CURTA ("fé", "deus") casa inteira — "fé" não pode casar dentro de
 *   "café";
 * - PALAVRA LONGA ("emagrecer") casa pelo RADICAL. Português flexiona demais
 *   para exigir a forma exata: o nicho "Emagrecimento" precisa reconhecer
 *   "emagrecer", e "alimentação" precisa reconhecer "alimentos". Sem isso o
 *   usuário teria de cadastrar todas as conjugações à mão, e concluiria que o
 *   sistema não funciona quando o problema é gramática.
 */
export function contem(textoNormalizado, termo) {
  const alvo = normalizar(termo);
  if (!alvo) return false;

  if (alvo.includes(' ')) return textoNormalizado.includes(alvo);

  if (alvo.length >= MINIMO_RADICAL) {
    const raiz = escapar(alvo.slice(0, MINIMO_RADICAL));
    return new RegExp(`(^|\\s)${raiz}`).test(textoNormalizado);
  }

  return new RegExp(`(^|\\s)${escapar(alvo)}(\\s|$)`).test(textoNormalizado);
}

/**
 * Junta tudo que se sabe sobre um vídeo num texto só.
 *
 * A pasta entra com peso próprio e MENOR que o conteúdo: uma pasta chamada
 * "emagrecimento" é uma pista boa, mas um vídeo colocado na pasta errada
 * ainda precisa ser identificado pelo que ele é. Por isso ela nunca decide
 * sozinha — no máximo desempata.
 */
export function contextoDe({ filename = '', caption = '', folderPath = '', extra = '' } = {}) {
  const pasta = folderPath ? path.basename(folderPath) : '';
  return {
    nome: normalizar(filename),
    legenda: normalizar(caption),
    pasta: normalizar(pasta),
    extra: normalizar(extra),
    tudo: normalizar([filename, caption, pasta, extra].filter(Boolean).join(' ')),
  };
}

/**
 * Os termos da lista que aparecem no texto, e quanto isso vale.
 *
 * Expressão de duas ou mais palavras vale DOBRADO. "gordura abdominal" não
 * aparece por acaso num vídeo que não seja do assunto; já "dieta" sozinha
 * aparece em qualquer lugar. Tratar os dois como evidência do mesmo tamanho
 * subestimava justamente o sinal mais confiável.
 */
function acertos(textoNormalizado, termos, porAcerto) {
  const achados = termos.filter((t) => contem(textoNormalizado, t));
  const pontos = achados.reduce(
    (soma, termo) => soma + porAcerto * (termo.trim().includes(' ') ? 2 : 1),
    0,
  );
  return { pontos, achados };
}

/**
 * Compatibilidade de UM conteúdo com UM nicho.
 *
 * Devolve nota e motivos. Os motivos são texto em português pronto para a
 * tela: eles são a resposta a "por que 98%?".
 */
export function pontuar(contexto, niche) {
  const motivos = [];
  let pontos = 0;

  const chaves = listaDe(niche.keywords);
  const sub = listaDe(niche.subniches);
  const temas = listaDe(niche.allowedThemes);
  const proibidas = listaDe(niche.bannedKeywords);
  const temasProibidos = listaDe(niche.bannedThemes);

  const k = acertos(contexto.tudo, chaves, PONTOS.palavraChave);
  if (k.pontos) {
    pontos += k.pontos;
    motivos.push(`palavras-chave encontradas: ${k.achados.slice(0, 6).join(', ')}`);
  }

  const s = acertos(contexto.tudo, sub, PONTOS.subnicho);
  if (s.pontos) {
    pontos += s.pontos;
    motivos.push(`subnicho reconhecido: ${s.achados.slice(0, 4).join(', ')}`);
  }

  const t = acertos(contexto.tudo, temas, PONTOS.tema);
  if (t.pontos) {
    pontos += t.pontos;
    motivos.push(`tema permitido: ${t.achados.slice(0, 4).join(', ')}`);
  }

  // O nome do nicho e a categoria valem como sinal por si sós: quem chama o
  // nicho de "Emagrecimento" espera que um arquivo com "emagrecer" no nome
  // case, mesmo sem ter cadastrado palavra-chave nenhuma ainda.
  const proprios = [niche.name, niche.category].filter(Boolean);
  const n = acertos(contexto.tudo, proprios, PONTOS.nome);
  if (n.pontos) {
    pontos += n.pontos;
    motivos.push('o nome do nicho aparece no conteúdo');
  }

  // A pasta soma UMA vez só, e pouco. Ela é pista, não veredito: um vídeo
  // colocado na pasta errada precisa continuar sendo reconhecido pelo que é.
  if (contexto.pasta) {
    const naPasta = [...chaves, ...sub, ...proprios].filter((termo) => contem(contexto.pasta, termo));
    if (naPasta.length) {
      pontos += PONTOS.pasta;
      motivos.push(`a pasta de origem indica o nicho ("${naPasta[0]}")`);
    }
  }

  // --- o que DERRUBA -------------------------------------------------------
  const bloqueios = [];

  const p = proibidas.filter((termo) => contem(contexto.tudo, termo));
  if (p.length) bloqueios.push(`palavra proibida: ${p.slice(0, 4).join(', ')}`);

  const tp = temasProibidos.filter((termo) => contem(contexto.tudo, termo));
  if (tp.length) bloqueios.push(`tema proibido: ${tp.slice(0, 4).join(', ')}`);

  if (!bloqueios.length && (proibidas.length || temasProibidos.length)) {
    motivos.push('nenhuma regra proibida encontrada');
  }

  // Rigor ALTO é VETO, não desconto.
  //
  // Subtrair um valor grande não zera quando a nota bruta já passou de 100:
  // um vídeo que batia todas as palavras-chave e ainda violava um tema
  // proibido sobrava com nota positiva. Quem escreve "publicar somente
  // conteúdo cristão" não quer um desconto — quer que não vá ao ar.
  if (bloqueios.length && niche.strictness === 'ALTO') {
    return {
      nicheId: niche.id,
      name: niche.name,
      score: 0,
      priority: niche.priority ?? 0,
      motivos: [...motivos, ...bloqueios],
      bloqueado: true,
      regras: regrasDe(niche.customRules),
    };
  }

  const peso = PESO_PROIBIDO[niche.strictness] ?? PESO_PROIBIDO.MEDIO;
  pontos -= peso * (p.length + tp.length);

  const score = Math.max(0, Math.min(100, pontos));

  return {
    nicheId: niche.id,
    name: niche.name,
    score,
    priority: niche.priority ?? 0,
    motivos: bloqueios.length ? [...motivos, ...bloqueios] : motivos,
    bloqueado: bloqueios.length > 0,
    regras: regrasDe(niche.customRules),
  };
}

/**
 * Ranqueia o conteúdo contra todos os nichos.
 *
 * Empate desempata pela prioridade que o usuário definiu, e depois pelo nome —
 * ordem estável importa: sem ela, dois nichos empatados trocariam de lugar a
 * cada classificação e o mesmo vídeo iria para contas diferentes.
 */
export function ranquear(contexto, niches) {
  return niches
    .map((n) => pontuar(contexto, n))
    .sort((a, b) => (b.score - a.score) || (b.priority - a.priority) || a.name.localeCompare(b.name));
}

/**
 * Traduz a nota em decisão, usando os limiares configurados.
 *
 * Sem nicho nenhum acima do piso, o resultado é SEM_CLASSIFICACAO — e isso
 * NÃO é o mesmo que bloqueado: significa "não sei", e quem decide é a pessoa.
 */
export function decidir(score, { approve = 90, review = 70 } = {}) {
  if (score >= approve) return 'APROVADO';
  if (score >= review) return 'REVISAO';
  return 'BLOQUEADO';
}

/**
 * Compatibilidade entre um nicho e uma conta.
 *
 * A conta herda a nota do vínculo: nicho principal vale cheio, secundário vale
 * menos. Uma conta sem aquele nicho fica em zero — é o que impede o conteúdo
 * religioso de cair na conta de fitness.
 */
export function compatibilidadeDaConta(nicheId, vinculos) {
  const v = vinculos.find((x) => x.nicheId === nicheId);
  if (!v) return 0;
  return v.isPrimary ? 100 : 75;
}
