import { prisma } from '../../db/prisma.js';
import { VIDEO_STATUS } from '../../lib/enums.js';

/**
 * Distribuição de vídeos entre contas.
 *
 * O caso real: uma pessoa opera cinco perfis de meme e tem trinta vídeos para
 * a semana. Sem isto, ela envia os trinta para cada conta — e as cinco
 * publicam exatamente a mesma coisa, que é o pior resultado possível: o
 * conteúdo compete consigo mesmo e o padrão fica evidente.
 *
 * Com isto, os trinta são REPARTIDOS: cada vídeo vai para uma conta só, e
 * ninguém recebe o que outra já tem.
 */

/**
 * Reparte itens entre contas, equilibrando pelo tamanho atual da fila.
 *
 * Rodízio puro (1ª conta, 2ª, 3ª, repete) desequilibra quando as filas já
 * estão desiguais: a conta com 40 pendentes receberia tanto quanto a que tem
 * 2. Aqui cada item vai para quem tem a MENOR fila no momento, contando o que
 * já foi atribuído nesta mesma chamada — o resultado se aproxima de filas do
 * mesmo tamanho, e vira rodízio simples quando todas começam iguais.
 *
 * Função pura: recebe as cargas prontas, para poder ser testada sem banco.
 *
 * @param {Array} itens
 * @param {Array<{id: string, carga: number}>} contas
 * @returns {Array<{item: any, accountId: string}>}
 */
export function repartir(itens, contas) {
  if (!contas?.length) throw new Error('Nenhuma conta para distribuir.');

  // Cópia local: a função não pode alterar o que recebeu.
  const carga = contas.map((c) => ({ id: c.id, n: c.carga ?? 0 }));
  const saida = [];

  for (const item of itens) {
    // Empate resolvido pela ordem recebida, o que mantém o resultado
    // previsível — o mesmo lote distribui igual em duas execuções.
    let alvo = carga[0];
    for (const c of carga) if (c.n < alvo.n) alvo = c;

    saida.push({ item, accountId: alvo.id });
    alvo.n += 1;
  }

  return saida;
}

/**
 * Quantos vídeos ainda não publicados cada conta tem na fila.
 * É a "carga" que `repartir` usa para equilibrar.
 */
export async function cargas(accountIds) {
  const contagem = await prisma.video.groupBy({
    by: ['accountId'],
    where: {
      accountId: { in: accountIds },
      status: { in: [VIDEO_STATUS.PENDING, VIDEO_STATUS.SCHEDULED] },
    },
    _count: { _all: true },
  });

  const mapa = new Map(contagem.map((c) => [c.accountId, c._count._all]));
  // A ordem da lista recebida é preservada: quem chamou escolheu a prioridade
  // dos empates, e `groupBy` não devolve conta sem nenhum vídeo.
  return accountIds.map((id) => ({ id, carga: mapa.get(id) ?? 0 }));
}

/** Contas elegíveis para receber conteúdo: existentes, na ordem do painel. */
export async function contasValidas(ids) {
  const contas = await prisma.account.findMany({
    where: { id: { in: ids } },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, username: true },
  });
  return contas;
}
