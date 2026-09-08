import { prisma } from '../../db/prisma.js';
import { VIDEO_STATUS, MEDIA } from '../../lib/enums.js';
import * as logger from '../log.js';

/**
 * Reciclagem de conteúdo já publicado.
 *
 * Página de meme não vive de material inédito: um vídeo que foi bem há dois
 * meses vai bem de novo, porque quase ninguém que segue hoje viu o post de
 * antes. Sem isto, a fila precisa ser abastecida à mão para sempre e a conta
 * para quando o acervo acaba.
 *
 * O vídeo RECICLADO é o mesmo registro, não uma cópia: uma cópia teria a mesma
 * impressão digital e apareceria como conteúdo duplicado na tela que existe
 * justamente para caçar duplicidade. O histórico de cada ida ao ar continua
 * preservado em Publication, uma linha por publicação.
 */

const DIA = 86_400_000;

/**
 * Quais vídeos publicados podem voltar à fila. Função pura.
 *
 * @param {Array} videos publicados da conta
 * @param {{recycleAfterDays:number, recycleMaxTimes:number}} regras
 * @param {number} agora
 */
export function elegiveis(videos, regras, agora = Date.now()) {
  const dias = Math.max(1, regras.recycleAfterDays ?? 30);
  const maximo = regras.recycleMaxTimes ?? 0; // 0 = sem limite

  return videos.filter((v) => {
    if (maximo > 0 && (v.recycleCount ?? 0) >= maximo) return false;

    // Conta a partir da ÚLTIMA ida ao ar, não da primeira: senão um vídeo
    // reciclado ontem voltaria de novo hoje, já que a data original continua
    // velha o suficiente para sempre.
    const referencia = v.lastRecycledAt ?? v.publishedAt;
    if (!referencia) return false;

    return agora - new Date(referencia).getTime() >= dias * DIA;
  });
}

/**
 * Devolve à fila os publicados que já cumpriram a carência.
 *
 * `limite` existe para não despejar 300 vídeos de uma vez quando a reciclagem
 * é ligada num acervo antigo — a fila viraria um bloco só de repetição.
 */
export async function reciclar(account, { limite = 10, agora = Date.now() } = {}) {
  if (!account.recycleEnabled) return { reciclados: 0 };

  const publicados = await prisma.video.findMany({
    where: {
      accountId: account.id,
      status: VIDEO_STATUS.PUBLISHED,
      mediaType: MEDIA.REEL,
    },
    orderBy: { publishedAt: 'asc' }, // os mais antigos voltam primeiro
  });

  const alvos = elegiveis(publicados, account, agora).slice(0, limite);
  if (!alvos.length) return { reciclados: 0 };

  const ultimo = await prisma.video.findFirst({
    where: { accountId: account.id },
    orderBy: { sortOrder: 'desc' },
  });
  let sortOrder = ultimo ? ultimo.sortOrder + 1 : 0;

  for (const v of alvos) {
    await prisma.video.update({
      where: { id: v.id },
      data: {
        status: VIDEO_STATUS.PENDING,
        sortOrder: sortOrder++,
        recycleCount: (v.recycleCount ?? 0) + 1,
        lastRecycledAt: new Date(agora),
        // publishedAt fica como está: é a data da primeira vez, e serve de
        // referência histórica. A carência passa a olhar lastRecycledAt.
      },
    });
  }

  await logger.info({
    action: 'CONTEUDO_RECICLADO', accountId: account.id,
    message: `${alvos.length} vídeo(s) publicados há mais de ${account.recycleAfterDays} dias voltaram à fila.`,
  });

  return { reciclados: alvos.length, nomes: alvos.map((v) => v.filename) };
}

/** Quantos vídeos estão prontos para reciclar agora, sem mexer em nada. */
export async function previa(account, { agora = Date.now() } = {}) {
  const publicados = await prisma.video.findMany({
    where: { accountId: account.id, status: VIDEO_STATUS.PUBLISHED, mediaType: MEDIA.REEL },
    select: { id: true, publishedAt: true, recycleCount: true, lastRecycledAt: true, filename: true },
    orderBy: { publishedAt: 'asc' },
  });

  const prontos = elegiveis(publicados, account, agora);

  // Quando o próximo fica pronto — responde "e depois?" sem o usuário
  // precisar abrir o calendário e contar dias na mão.
  const dias = Math.max(1, account.recycleAfterDays ?? 30);
  const restantes = publicados
    .filter((v) => !prontos.includes(v))
    .map((v) => new Date(v.lastRecycledAt ?? v.publishedAt).getTime() + dias * DIA)
    .filter((t) => t > agora)
    .sort((a, b) => a - b);

  return {
    publicados: publicados.length,
    prontos: prontos.length,
    proximoEm: restantes.length ? new Date(restantes[0]) : null,
  };
}
