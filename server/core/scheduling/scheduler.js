import fs from 'fs';
import { prisma } from '../../db/prisma.js';
import { config } from '../../config/env.js';
import { MEDIA, VIDEO_STATUS, ACCOUNT_STATUS, SCHEDULE_MODE } from '../../lib/enums.js';
import { applyJitter, slotOccurrences, slotWindow, windowOccurrences } from './slots.js';
import { aplicarLimites, chaveDoDia, esperaDaTentativa, tetoDoDia } from './limits.js';
import * as accounts from '../accounts/accounts.js';
import * as logger from '../log.js';
import { publishReel } from '../publishing/reel.js';
import { keepOnly, closeAll } from '../../playwright/browser.js';
import { STORY_UNSUPPORTED_REASON } from '../publishing/story.js';
import { moveTo } from '../../lib/files.js';
import * as covers from '../queue/covers.js';
import * as recycle from '../queue/recycle.js';
import * as notify from '../notify.js';

let timer = null;
let busy = false;

/**
 * Fila das operações que dirigem o navegador.
 *
 * O agendador se serializava sozinho com `busy`, mas "Publicar agora" e o
 * diagnóstico do Instagram entravam por fora e abriam página no mesmo
 * contexto. Duas navegações na mesma aba fazem uma abortar a outra, e o erro
 * que aparece — "Target page, context or browser has been closed" — não diz
 * nada sobre a causa.
 *
 * Tudo que mexe no navegador passa por aqui.
 */
let filaNavegador = Promise.resolve();

export function comNavegador(fn) {
  const proxima = filaNavegador.then(fn, fn);
  // A corrente não pode morrer numa rejeição: o erro vai para quem chamou.
  filaNavegador = proxima.catch(() => {});
  return proxima;
}

export function start() {
  if (timer) return;
  timer = setInterval(() => tick().catch(() => {}), config.schedulerTickMs);
  tick().catch(() => {});
}

export function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  // Parar a automação fecha as janelas: deixá-las abertas consumindo memória
  // depois de o usuário mandar parar seria o oposto do que ele pediu.
  closeAll().catch(() => {});
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
  // Recicla ANTES de montar a grade: um vídeo que acabou de voltar precisa
  // estar na fila para conseguir um horário nesta mesma passagem.
  await recycle.reciclar(account).catch(() => { /* nunca impede o agendamento */ });

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

  if (account.scheduleMode === SCHEDULE_MODE.WINDOW) {
    return byWindow(account, days);
  }
  if (account.scheduleMode === SCHEDULE_MODE.INTERVAL) {
    return byInterval(account);
  }
  return bySlots(account, days);
}

/**
 * Publicações que JÁ existem em cada dia e portanto consomem o teto diário.
 *
 * Conta as que foram ao ar (ou estão indo): as SCHEDULED foram apagadas no
 * começo da regeração, então incluí-las contaria duas vezes o mesmo horário.
 */
async function publicadasPorDia(accountId) {
  const feitas = await prisma.publication.findMany({
    where: {
      accountId,
      status: { in: [VIDEO_STATUS.PUBLISHED, VIDEO_STATUS.PUBLISHING] },
      scheduledAt: { gte: new Date(Date.now() - 2 * 86_400_000) },
    },
    select: { scheduledAt: true },
  });

  const porDia = {};
  for (const p of feitas) {
    const k = chaveDoDia(new Date(p.scheduledAt));
    porDia[k] = (porDia[k] ?? 0) + 1;
  }
  return porDia;
}

/** As regras de limite de uma conta, no formato que limits.js espera. */
const regrasDe = (account) => ({
  dailyLimit: account.dailyLimit,
  quietStart: account.quietStart,
  quietEnd: account.quietEnd,
  warmupStartAt: account.warmupStartAt,
  warmupDays: account.warmupDays,
  warmupTarget: account.warmupTarget,
});

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

/**
 * Modo "a cada N minutos": espalha a fila inteira, um vídeo por intervalo,
 * contando a partir da última publicação da conta.
 */
async function byInterval(account) {
  const videos = await prisma.video.findMany({
    where: { accountId: account.id, status: VIDEO_STATUS.PENDING, mediaType: MEDIA.REEL },
    orderBy: { sortOrder: 'asc' },
  });
  if (!videos.length) return;

  const step = Math.max(1, account.intervalMinutes || 60) * 60_000;

  // O intervalo conta a partir da ÚLTIMA publicação, não de agora.
  //
  // Este era o bug do "posta tudo em sequência": a grade é refeita a cada
  // upload, exclusão, reordenação ou ajuste da conta, e começando em
  // `Date.now()` o primeiro vídeo da fila nascia VENCIDO — publicava no tick
  // seguinte, o que disparava outra regeração, que vencia o próximo, e assim
  // por diante. O intervalo de 10 minutos existia na configuração e nunca no
  // resultado.
  //
  // Se a última publicação foi há mais tempo que o intervalo, começa agora:
  // agendar no passado publicaria tudo de uma vez, que é o mesmo problema.
  const ultima = await prisma.publication.findFirst({
    where: { accountId: account.id, status: VIDEO_STATUS.PUBLISHED, publishedAt: { not: null } },
    orderBy: { publishedAt: 'desc' },
    select: { publishedAt: true },
  });

  const inicio = Math.max(
    ultima?.publishedAt ? ultima.publishedAt.getTime() + step : 0,
    Date.now(),
  );

  // Gera os instantes primeiro e só então aplica os limites: um horário
  // recusado pelo silêncio ou pelo teto não pode consumir um vídeo da fila.
  // Sobram mais instantes que vídeos de propósito — os cortes precisam de
  // folga para o último vídeo ainda achar lugar.
  const brutos = [];
  for (let i = 0; i < videos.length * 4; i++) brutos.push(new Date(inicio + i * step));

  const { mantidos, silencio, teto } = aplicarLimites(
    brutos, regrasDe(account), { jaNoDia: await publicadasPorDia(account.id) },
  );

  for (const [i, video] of videos.entries()) {
    const at = mantidos[i];
    if (!at) break; // os limites consumiram a janela inteira
    await link(account, video, at);
  }

  await avisarCortes(account, silencio, teto, mantidos.length < videos.length);
}

/**
 * Registra no log quando os limites seguraram publicações.
 *
 * Sem isso o usuário veria a fila parada sem motivo aparente — o mesmo tipo de
 * silêncio que já causou confusão em outras telas deste app.
 */
async function avisarCortes(account, silencio, teto, faltou) {
  if (!silencio && !teto) return;
  const partes = [];
  if (silencio) partes.push(`${silencio} na janela de silêncio (${account.quietStart}–${account.quietEnd})`);
  if (teto) partes.push(`${teto} acima do teto diário`);

  await logger.info({
    action: 'LIMITES_APLICADOS', accountId: account.id,
    message: `Horários descartados: ${partes.join(' e ')}.${faltou ? ' Parte da fila ficou sem horário.' : ''}`,
  });
}

/**
 * Modo JANELA: N publicações por dia espalhadas entre dois horários.
 *
 * Diferente do modo INTERVAL, que despeja a fila inteira a partir de agora e
 * atravessa a madrugada: aqui o volume é POR DIA e sempre dentro da faixa. Com
 * 70 vídeos por dia das 7h às 23h, sai um a cada 13 minutos — e nada de
 * madrugada.
 *
 * Os limites de segurança (teto diário, silêncio, aquecimento) continuam
 * valendo por cima: um teto de 30 corta uma janela pedida de 70, e é o teto
 * que ganha. O log diz quantos foram descartados, para a diferença entre o
 * pedido e o agendado não virar mistério.
 */
async function byWindow(account, days) {
  const videos = await prisma.video.findMany({
    where: { accountId: account.id, status: VIDEO_STATUS.PENDING, mediaType: MEDIA.REEL },
    orderBy: { sortOrder: 'asc' },
  });
  if (!videos.length) return;

  const now = Date.now();
  const regras = regrasDe(account);

  // O teto do dia entra no CÁLCULO, não como corte depois.
  //
  // Cortar depois pegava os primeiros N horários e largava o resto do dia
  // vazio: com teto 30 numa janela de 07h às 23h, os 30 posts saíam todos
  // até as 13h37 e a tarde inteira ficava sem nada. Gerando já com o número
  // certo, os 30 se espalham pelas 16 horas — que é o ponto de ter uma janela.
  const brutos = [];
  for (let d = 0; d < days; d++) {
    const dia = new Date(now);
    dia.setDate(dia.getDate() + d);

    const limite = tetoDoDia(dia, regras);
    const quantos = limite === null
      ? account.postsPerDay
      : Math.min(account.postsPerDay, limite);
    if (quantos < 1) continue;

    brutos.push(...windowOccurrences(
      { ...account, postsPerDay: quantos },
      1,
      // `now` do dia: para os dias futuros o corte do passado não se aplica,
      // e passar o agora real descartaria a manhã inteira de amanhã.
      { now: d === 0 ? now : dia.setHours(0, 0, 0, 0) },
    ));
  }

  // Ainda passa pelos limites: a janela de silêncio pode cortar horários que
  // caiam dentro dela, e o que já foi publicado hoje consome o teto.
  const { mantidos, silencio, teto } = aplicarLimites(
    brutos, regras, { jaNoDia: await publicadasPorDia(account.id) },
  );
  await avisarCortes(account, silencio, teto, mantidos.length < videos.length);

  // A fila manda: sobrando horário, os últimos ficam sem uso; sobrando vídeo,
  // os últimos esperam a regeração de amanhã.
  for (const [i, video] of videos.entries()) {
    const at = mantidos[i];
    if (!at) break;
    await link(account, video, at);
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

  // Teto diário, janela de silêncio e aquecimento. Filtrar aqui, e não na hora
  // de publicar, faz o calendário mostrar a verdade: o usuário vê a grade que
  // vai acontecer, não uma que será silenciosamente ignorada depois.
  const { mantidos, silencio, teto } = aplicarLimites(
    candidates.map((c) => c.at), regrasDe(account), { jaNoDia: await publicadasPorDia(account.id) },
  );
  const permitidos = new Set(mantidos.map((d) => d.getTime()));
  await avisarCortes(account, silencio, teto, false);

  for (const { slot, at } of candidates) {
    if (!permitidos.has(at.getTime())) continue;

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
      // Uma publicação em recuo volta a ser elegível só depois da espera.
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    orderBy: { scheduledAt: 'asc' },
    include: { video: true, account: true },
  });
  if (!due) return;

  busy = true;
  try {
    await comNavegador(async () => {
    // Uma janela por vez: fecha a das OUTRAS contas antes de começar.
    //
    // Fechar depois de cada publicação (o que eu tentei antes) obrigava a
    // próxima a abrir um contexto frio, e a interface do Instagram nem sempre
    // terminava de montar a tempo — o botão de criar publicação passou a não
    // ser encontrado. Assim a janela da conta que está publicando continua
    // quente entre publicações seguidas dela.
      await keepOnly(due.accountId).catch(() => {});

      await run(due);
    });
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

  // O arquivo ainda está no disco?
  //
  // Apagar os vídeos pela pasta (sem passar pelo painel) deixa o registro na
  // fila apontando para o nada. Sem esta checagem, o agendador tentava
  // publicar, tomava ENOENT, gastava as três tentativas e PAUSAVA A CONTA —
  // por um arquivo que o usuário mesmo removeu. Falhar aqui é imediato,
  // explica o motivo e não mexe no estado da conta: não é problema dela.
  if (!fs.existsSync(video.filepath)) {
    await prisma.video.update({
      where: { id: video.id },
      data: { status: VIDEO_STATUS.FAILED, failedAt: new Date() },
    });
    await prisma.publication.update({
      where: { id: publication.id },
      data: {
        status: VIDEO_STATUS.FAILED,
        errorMessage: 'O arquivo não está mais no disco.',
      },
    });
    await logger.error({
      action: 'ARQUIVO_SUMIU', accountId: account.id, videoName: video.filename,
      message: `${video.filepath} não existe mais. O registro foi marcado como falhado — remova-o em Fila > Falhados.`,
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
      // Ordem da legenda: a do vídeo > a da conta > a padrão da instalação.
      // A última existe para quem quer uma assinatura em tudo que sai.
      const settings = await prisma.settings.findUnique({ where: { id: 1 } });
      const caption = video.caption || account.fallbackCaption || settings?.defaultCaption || '';
      // resolveFor devolve caminho absoluto e já cai na capa padrão quando o
      // vídeo não tem a própria — o publicador não precisa saber dessa regra.
      const coverPath = await covers.resolveFor(video);

      const result = await publishReel({
        accountId: account.id,
        filepath: video.filepath,
        videoName: video.filename,
        caption,
        coverPath,
        aiLabel: account.aiLabel,
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
          data: {
            status: VIDEO_STATUS.PUBLISHED, publishedAt: new Date(),
            errorMessage: null, durationMs, nextAttemptAt: null,
          },
        });
        await logger.success({
          action: 'PUBLICACAO_CONCLUIDA', accountId: account.id,
          videoName: video.filename, attempt, durationMs,
        });
        await notify.avisar({
          evento: notify.EVENTO.PUBLICACAO_OK,
          titulo: 'Publicado',
          conta: account.username,
          mensagem: video.filename,
        });
        return;
      }
    } catch (err) {
      await logger.error({
        action: 'PUBLICACAO_FALHOU', accountId: account.id,
        videoName: video.filename, attempt, message: err.message,
        durationMs: Date.now() - started,
      });
      // Recuo antes da próxima tentativa. Sem ele as 3 tentativas queimavam
      // em segundos: uma queda de rede de 10s bastava para mandar o vídeo a
      // /failed e pausar a conta inteira.
      //
      // O recuo é AGENDADO, não dormido: esperar aqui dentro seguraria o
      // `busy` do agendador e impediria as outras contas de publicarem.
      if (attempt < config.maxAttempts) {
        const espera = esperaDaTentativa(attempt);
        await prisma.publication.update({
          where: { id: publication.id },
          data: {
            errorMessage: err.message,
            status: VIDEO_STATUS.SCHEDULED,
            nextAttemptAt: new Date(Date.now() + espera),
          },
        });
        await prisma.video.update({
          where: { id: video.id },
          data: { status: VIDEO_STATUS.SCHEDULED },
        });
        await logger.info({
          action: 'NOVA_TENTATIVA_AGENDADA', accountId: account.id, videoName: video.filename,
          message: `Tentativa ${attempt + 1} em ${Math.round(espera / 60_000) || '<1'} min.`,
        });
        return;
      }

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

  // Este é o momento em que a operação para. Sem aviso externo, a conta ficava
  // parada até alguém abrir o painel por acaso.
  await notify.avisar({
    evento: notify.EVENTO.CONTA_PAUSADA,
    titulo: 'Automação pausada',
    conta: account.username,
    mensagem: `"${video.filename}" falhou ${config.maxAttempts} vezes e a conta foi pausada. Reative em Contas depois de resolver.`,
  });
}
