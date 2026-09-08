import fs from 'fs';
import { prisma } from '../../db/prisma.js';
import { fingerprint } from '../../lib/fingerprint.js';
import { VIDEO_STATUS } from '../../lib/enums.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import * as covers from './covers.js';
import * as logger from '../log.js';

/**
 * Conteúdo repetido entre contas.
 *
 * Operar várias contas só faz sentido se cada uma tiver conteúdo próprio. Duas
 * contas publicando o mesmo arquivo é o padrão mais óbvio de rede automatizada
 * — e, do lado prático, joga fora o alcance da segunda: o mesmo vídeo compete
 * consigo mesmo.
 *
 * A identidade usada aqui é a do ARQUIVO (ver lib/fingerprint.js). Para vídeos
 * gerados pelo editor em massa, guarda-se a impressão do vídeo de ORIGEM: três
 * cópias com variação de corte são arquivos diferentes byte a byte, mas são o
 * mesmo conteúdo, e é justamente esse caso que o usuário precisa enxergar.
 */

export const TIPO = {
  /** Mesmo conteúdo na fila de contas diferentes. */
  CRUZADO: 'CRUZADO',
  /** Mesmo conteúdo repetido dentro de UMA conta. */
  REPETIDO: 'REPETIDO',
};

/**
 * Agrupa vídeos por impressão digital. Função pura — recebe a lista pronta,
 * para poder ser testada sem banco.
 *
 * @param {Array<{id:string, accountId:string, contentHash:string|null}>} videos
 * @returns grupos com 2+ vídeos, cruzados primeiro (são o problema de verdade)
 */
export function agrupar(videos) {
  const porHash = new Map();
  for (const v of videos) {
    if (!v.contentHash) continue; // sem impressão não dá para afirmar nada
    if (!porHash.has(v.contentHash)) porHash.set(v.contentHash, []);
    porHash.get(v.contentHash).push(v);
  }

  const grupos = [];
  for (const [hash, itens] of porHash) {
    if (itens.length < 2) continue;
    const contas = [...new Set(itens.map((x) => x.accountId))];
    grupos.push({
      hash,
      tipo: contas.length > 1 ? TIPO.CRUZADO : TIPO.REPETIDO,
      contas,
      videos: itens,
    });
  }

  return grupos.sort((a, b) => {
    if (a.tipo !== b.tipo) return a.tipo === TIPO.CRUZADO ? -1 : 1;
    return b.videos.length - a.videos.length;
  });
}

/**
 * Calcula a impressão dos vídeos que ainda não têm uma.
 *
 * Existe porque o campo nasceu depois dos vídeos: sem isto, a tela ficaria
 * vazia para quem já usava o app e a checagem no upload não teria com o que
 * comparar. É idempotente e barata o suficiente para rodar no boot.
 */
export async function backfill() {
  const pendentes = await prisma.video.findMany({
    where: { contentHash: null },
    select: { id: true, filepath: true },
  });

  // Agrupa por hash antes de gravar: um UPDATE por vídeo fazia N idas ao
  // banco, e vídeos com o mesmo conteúdo (o caso que este módulo procura)
  // cabem no mesmo updateMany.
  const porHash = new Map();
  for (const v of pendentes) {
    const hash = fingerprint(v.filepath);
    if (!hash) continue; // arquivo sumiu; tenta de novo na próxima vez
    if (!porHash.has(hash)) porHash.set(hash, []);
    porHash.get(hash).push(v.id);
  }

  let calculados = 0;
  for (const [contentHash, ids] of porHash) {
    await prisma.video.updateMany({ where: { id: { in: ids } }, data: { contentHash } });
    calculados += ids.length;
  }

  return { verificados: pendentes.length, calculados };
}

/**
 * Contas (além da informada) que já têm este conteúdo na fila.
 * É o que o upload consulta antes de aceitar um arquivo.
 */
export async function outrasContasCom(hash, accountId) {
  if (!hash) return [];
  const iguais = await prisma.video.findMany({
    where: { contentHash: hash, accountId: { not: accountId } },
    select: { accountId: true, account: { select: { username: true } } },
  });
  const vistos = new Map();
  for (const v of iguais) vistos.set(v.accountId, v.account.username);
  return [...vistos].map(([id, username]) => ({ id, username }));
}

/** Grupos de conteúdo repetido, com conta e status de cada cópia. */
export async function listar() {
  const videos = await prisma.video.findMany({
    where: { contentHash: { not: null } },
    select: {
      id: true, accountId: true, contentHash: true, filename: true,
      status: true, sizeBytes: true, createdAt: true,
      account: { select: { username: true, label: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const grupos = agrupar(videos);
  return {
    grupos,
    cruzados: grupos.filter((g) => g.tipo === TIPO.CRUZADO).length,
    repetidos: grupos.filter((g) => g.tipo === TIPO.REPETIDO).length,
    semImpressao: await prisma.video.count({ where: { contentHash: null } }),
  };
}

/**
 * Resolve um grupo: mantém uma cópia e remove as outras da fila.
 *
 * Publicados nunca são removidos — o registro é o histórico do que já foi ao
 * ar, e apagá-lo não desfaz a publicação. Se a cópia escolhida para ficar for
 * a publicada, as pendentes das outras contas somem, que é exatamente o que se
 * quer: o conteúdo já saiu numa conta.
 */
export async function resolver({ hash, manterVideoId }) {
  if (!hash) throw new ValidationError('Informe o conteúdo a resolver.');

  const copias = await prisma.video.findMany({ where: { contentHash: hash } });
  if (copias.length < 2) throw new NotFoundError('Esse conteúdo não está mais repetido.');

  const manter = manterVideoId
    ? copias.find((c) => c.id === manterVideoId)
    // Sem escolha explícita, fica a mais antiga: é a fila que já estava de pé.
    : copias.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
  if (!manter) throw new NotFoundError('O vídeo a manter não faz parte deste grupo.');

  const remover = copias.filter(
    (c) => c.id !== manter.id && c.status !== VIDEO_STATUS.PUBLISHED,
  );

  for (const v of remover) {
    try { fs.unlinkSync(v.filepath); } catch { /* pode já não existir */ }
    if (v.coverPath) await covers.cleanupIfOrphan(v.coverPath);
  }
  await prisma.video.deleteMany({ where: { id: { in: remover.map((v) => v.id) } } });

  await logger.warn({
    action: 'CONTEUDO_DUPLICADO_RESOLVIDO',
    videoName: manter.filename,
    message: `${remover.length} cópia(s) removida(s); mantida a da conta ${manter.accountId}.`,
  });

  return {
    removidos: remover.length,
    mantido: manter.id,
    preservados: copias.length - remover.length - 1, // publicados intocados
    contas: [...new Set(remover.map((v) => v.accountId))],
  };
}
