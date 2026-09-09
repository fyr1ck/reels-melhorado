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
 * Reparte itens entre contas, em rodízio.
 *
 * Um lote de 4 vídeos em 2 contas vira 2 e 2. É o que "repartir o lote"
 * significa, e é o que a pessoa espera ao mandar 40 vídeos para 4 perfis.
 *
 * A ordem do rodízio começa pela conta com a MENOR fila, então quando as filas
 * estão desiguais o desempate favorece quem tem menos — sem deixar de dividir.
 *
 * Uma versão anterior equalizava as filas: cada item ia para quem tivesse menos
 * vídeos naquele instante. Matematicamente defensável e péssimo na prática —
 * com uma conta em 6 e outra em 0, um lote de 4 caía INTEIRO na conta vazia, e
 * quem mandou o lote via "distribuir entre contas" não distribuir nada.
 *
 * Função pura: recebe as cargas prontas, para poder ser testada sem banco.
 *
 * @param {Array} itens
 * @param {Array<{id: string, carga: number}>} contas
 * @returns {Array<{item: any, accountId: string}>}
 */
export function repartir(itens, contas) {
  if (!contas?.length) throw new Error('Nenhuma conta para distribuir.');

  // Cópia antes de ordenar: `sort` altera o array no lugar, e a função não
  // pode mexer no que recebeu. Empate mantém a ordem recebida, o que faz o
  // mesmo lote distribuir igual em duas execuções.
  const ordem = [...contas]
    .map((c, i) => ({ id: c.id, carga: c.carga ?? 0, posicao: i }))
    .sort((a, b) => (a.carga - b.carga) || (a.posicao - b.posicao));

  return itens.map((item, i) => ({ item, accountId: ordem[i % ordem.length].id }));
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
