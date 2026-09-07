import { prisma } from '../../db/prisma.js';
import { config } from '../../config/env.js';
import { MEDIA, VIDEO_STATUS, ACCOUNT_STATUS, SCHEDULE_MODE } from '../../lib/enums.js';
import { applyJitter, slotOccurrences, slotWindow } from './slots.js';
import * as accounts from '../accounts/accounts.js';
import * as logger from '../log.js';
import { publishReel } from '../publishing/reel.js';
import { STORY_UNSUPPORTED_REASON } from '../publishing/story.js';
import { moveTo } from '../../lib/files.js';

let timer = null;
let busy = false;

export function start() {
  if (timer) return;
  timer = setInterval(() => tick().catch(() => {}), config.schedulerTickMs);
  tick().catch(() => {});
}

export function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * Reconstrói os agendamentos FUTUROS de uma conta (ou de todas).
 *
 * Sempre apaga e regera o que está SCHEDULED, nunca o que já foi publicado ou
 * falhou. Isso evita sobras quando o usuário troca o modo de agendamento ou
 * mexe nos horários — um agendamento do modo antigo continuaria valendo.
 */
export async function regenerate({ accountId = null, days = config.scheduleDaysAhead } = {}) {
  const list = accountId
    ? [await prisma.account.findUnique({ where: { id: accountId } })].filter(Boolean)
    : await prisma.account.findMany({ orderBy: { sortOrder: 'asc' } });

  for (const account of list) {
    await regenerateFor(account, days);
  }
}

async function regenerateFor(account, days) {
  // Devolve à fila os vídeos que estavam presos em agendamentos futuros.
  const pending = await prisma.publication.findMany({
    where: { accountId: account.id, status: VIDEO_STATUS.SCHEDULED },
    select: { videoId: true },
  });

  if (pending.length) {
    await prisma.publication.deleteMany({
      where: { accountId: account.id, status: VIDEO_STATUS.SCHEDULED },
    });
    await prisma.video.updateMany({
      where: { id: { in: pending.map((p) => p.videoId) }, status: VIDEO_STATUS.SCHEDULED },
      data: { status: VIDEO_STATUS.PENDING },
    });
  }

  if (account.scheduleMode === SCHEDULE_MODE.INTERVAL) {
    return byInterval(account);
  }
  return bySlots(account, days);
}

/**
 * Próximo vídeo da fila. Com `randomOrder` sorteia entre os pendentes em vez
 * de seguir a posição — útil para acervo grande, que ficaria sempre na mesma
 * sequência.
 */
async function nextVideo(account, mediaType) {
  const where = { accountId: account.id, status: VIDEO_STATUS.PENDING, mediaType };

  if (!account.randomOrder) {
    return prisma.video.findFirst({ where, orderBy: { sortOrder: 'asc' } });
  }

  const total = await prisma.video.count({ where });
  if (!total) return null;

  const [video] = await prisma.video.findMany({
    where,
    skip: Math.floor(Math.random() * total),
    take: 1,
  });
  return video;
}

async function link(account, video, at) {
  await prisma.publication.create({
    data: { accountId: account.id, videoId: video.id, scheduledAt: at, status: VIDEO_STATUS.SCHEDULED },
  });
  await prisma.video.update({ where: { id: video.id }, data: { status: VIDEO_STATUS.SCHEDULED } });
}

/** Modo "a cada N minutos": distribui a fila inteira a partir de agora. */
async function byInterval(account) {
  const videos = await prisma.video.findMany({
    where: { accountId: account.id, status: VIDEO_STATUS.PENDING, mediaType: MEDIA.REEL },
    orderBy: { sortOrder: 'asc' },
  });
  if (!videos.length) return;

  const step = Math.max(1, account.intervalMinutes || 60) * 60_000;
  let at = new Date();

  for (const video of videos) {
    await link(account, video, at);
    at = new Date(at.getTime() + step);
  }
}

/**
 * Modo "horários fixos": para cada slot habilitado, garante uma publicação.
 *
 * Stories ficam de fora de propósito: a web do Instagram não permite
 * publicá-los (ver core/publishing/story.js). Agendar levaria o vídeo a
 * esgotar as tentativas, ser movido para /failed e pausar a conta —
 * destruindo a fila por uma limitação da plataforma.
 */
async function bySlots(account, days) {
  const slots = await prisma.slot.findMany({
    where: { accountId: account.id, enabled: true, mediaType: MEDIA.REEL },
    orderBy: { time: 'asc' },
  });
  if (!slots.length) return;

  const now = Date.now();

  // Ordena por instante para a fila ser consumida em ordem cronológica —
  // percorrer slot a slot preencheria todos os dias do primeiro horário antes
  // de tocar no segundo.
  const candidates = slots
    .flatMap((slot) => slotOccurrences(slot.time, days, { now }).map((at) => ({ slot, at })))
    .sort((a, b) => a.at - b.at);

  for (const { slot, at } of candidates) {
    // Dedupe por JANELA, não por instante: com jitter o horário sorteado muda
    // a cada regeração, e comparar por igualdade duplicaria o slot.
    const exists = await prisma.publication.findFirst({
      where: {
        accountId: account.id,
        scheduledAt: slotWindow(at, slot.jitterMinutes),
        video: { mediaType: MEDIA.REEL },
      },
    });
    if (exists) continue;

    const video = await nextVideo(account, MEDIA.REEL);
    if (!video) return; // fila acabou

    await link(account, video, applyJitter(at, slot.jitterMinutes, { now }));
  }
}

/**
 * Um tick publica no máximo UMA publicação, de UMA conta.
 *
 * Serializar é proposital: o publicador dirige uma janela real de navegador, e
 * duas publicações ao mesmo tempo disputariam a mesma janela. As contas se
 * revezam entre ticks conforme o vencimento.
 */
async function tick() {
  if (busy) return;

  const list = await accounts.runnable();
  if (!list.length) return;

  const due = await prisma.publication.findFirst({
    where: {
      status: VIDEO_STATUS.SCHEDULED,
      scheduledAt: { lte: new Date() },
      accountId: { in: list.map((a) => a.id) },
    },
    orderBy: { scheduledAt: 'asc' },
    include: { video: true, account: true },
  });
  if (!due) return;

  busy = true;
  try {
    await run(due);
  } catch (err) {
    await logger.error({ action: 'ERRO_AGENDADOR', message: err.message });
  } finally {
    busy = false;
  }
}

/**
 * Executa uma publicação com retentativas.
 *
 * Nunca avança em silêncio: esgotadas as tentativas, o vídeo vai para /failed
 * e a automação DA CONTA é pausada — um problema numa conta não derruba a
 * operação das outras.
 */
async function run(publication) {
  const { video, account } = publication;

  if (video.mediaType === MEDIA.STORY) {
    // Defesa em profundidade: bySlots já não agenda stories, mas um registro
    // antigo não pode consumir 3 tentativas e destruir o arquivo.
    await prisma.publication.update({
      where: { id: publication.id },
      data: { status: VIDEO_STATUS.FAILED, errorMessage: STORY_UNSUPPORTED_REASON },
    });
    await logger.warn({
      action: 'STORY_IGNORADO', accountId: account.id, videoName: video.filename,
      message: STORY_UNSUPPORTED_REASON,
    });
    return;
  }

  await prisma.publication.update({ where: { id: publication.id }, data: { status: VIDEO_STATUS.PUBLISHING } });
  await prisma.video.update({ where: { id: video.id }, data: { status: VIDEO_STATUS.PUBLISHING } });

  let attempt = publication.attempts;

  while (attempt < config.maxAttempts) {
    attempt += 1;
    const started = Date.now();

    await prisma.publication.update({ where: { id: publication.id }, data: { attempts: attempt } });
    await logger.info({
      action: 'PUBLICACAO_INICIADA', accountId: account.id,
      videoName: video.filename, attempt,
    });

    try {
      const settings = await prisma.settings.findUnique({ where: { id: 1 } });
      const caption = video.caption || account.fallbackCaption || '';
      const coverPath = video.coverPath
        || (settings?.useDefaultCover ? settings.defaultCoverPath : null);

      const result = await publishReel({
        accountId: account.id,
        filepath: video.filepath,
        videoName: video.filename,
        caption,
        coverPath,
      });

      if (result.ok) {
        const moved = moveTo(video.filepath, config.paths.published);
        const durationMs = Date.now() - started;

        await prisma.video.update({
          where: { id: video.id },
          data: { status: VIDEO_STATUS.PUBLISHED, publishedAt: new Date(), filepath: moved },
        });
        await prisma.publication.update({
          where: { id: publication.id },
          data: { status: VIDEO_STATUS.PUBLISHED, publishedAt: new Date(), errorMessage: null, durationMs },
        });
        await logger.success({
          action: 'PUBLICACAO_CONCLUIDA', accountId: account.id,
          videoName: video.filename, attempt, durationMs,
        });
        return;
      }
    } catch (err) {
      await logger.error({
        action: 'PUBLICACAO_FALHOU', accountId: account.id,
        videoName: video.filename, attempt, message: err.message,
        durationMs: Date.now() - started,
      });
      await prisma.publication.update({
        where: { id: publication.id },
        data: { errorMessage: err.message },
      });
    }
  }

  // Tentativas esgotadas.
  try {
    const moved = moveTo(video.filepath, config.paths.failed);
    await prisma.video.update({
      where: { id: video.id },
      data: { status: VIDEO_STATUS.FAILED, failedAt: new Date(), filepath: moved },
    });
  } catch (err) {
    await logger.error({
      action: 'ERRO_AO_MOVER', videoName: video.filename, message: err.message,
    });
  }

  await prisma.publication.update({ where: { id: publication.id }, data: { status: VIDEO_STATUS.FAILED } });
  await prisma.account.update({ where: { id: account.id }, data: { status: ACCOUNT_STATUS.PAUSED } });

  await logger.error({
    action: 'PUBLICACAO_FALHOU_DEFINITIVAMENTE', accountId: account.id, videoName: video.filename,
    message: `Falhou após ${config.maxAttempts} tentativas. Automação de @${account.username} pausada — revise em Fila > Falhados.`,
  });
}
