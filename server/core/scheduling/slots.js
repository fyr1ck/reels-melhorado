/**
 * Cálculo de horários — funções puras, sem banco e sem relógio global.
 *
 * O `now` é sempre um parâmetro em vez de `Date.now()` interno: assim o teste
 * consegue fixar o instante e verificar as bordas (slot que acabou de passar,
 * jitter que cairia no passado) sem depender de quando roda.
 */

/**
 * Aplica variação aleatória ao redor de um horário fixo.
 *
 * Publicar sempre às 14:00:00 cravadas é um padrão óbvio. Com jitter de 10min
 * o post sai em algum ponto entre 13:50 e 14:10.
 *
 * Duas garantias: com `jitterMinutes = 0` devolve o horário intacto, e o
 * resultado nunca cai antes de `floorMs` após `now` — o sorteio pode jogar um
 * slot próximo para trás, e um agendamento no passado seria publicado
 * imediatamente pelo tick seguinte, furando a grade.
 */
export function applyJitter(base, jitterMinutes, { now = Date.now(), floorMs = 60_000, random = Math.random } = {}) {
  const minutes = Math.max(0, jitterMinutes || 0);
  if (minutes === 0) return base;

  const span = minutes * 60_000;
  const offset = Math.round((random() * 2 - 1) * span);
  const candidate = new Date(base.getTime() + offset);

  const floor = now + floorMs;
  return candidate.getTime() < floor ? new Date(floor) : candidate;
}

/**
 * Gera os instantes de um slot ao longo dos próximos `days` dias.
 * Pula o horário de hoje que já passou — agendar no passado publicaria na hora.
 */
export function slotOccurrences(time, days, { now = Date.now() } = {}) {
  const [h, m] = time.split(':').map(Number);
  const out = [];

  for (let d = 0; d < days; d++) {
    const at = new Date(now);
    at.setDate(at.getDate() + d);
    at.setHours(h, m, 0, 0);

    if (at.getTime() < now) continue;
    out.push(at);
  }

  return out;
}

/**
 * Janela em que um slot pode cair, dado o jitter.
 *
 * A deduplicação precisa comparar por JANELA, não por instante: com jitter
 * ligado o horário sorteado muda a cada regeração, e comparar por igualdade
 * criaria uma publicação duplicada no mesmo slot a cada execução.
 */
export function slotWindow(at, jitterMinutes) {
  const span = Math.max(0, jitterMinutes || 0) * 60_000;
  if (span === 0) return { gte: at, lte: at };
  return { gte: new Date(at.getTime() - span), lte: new Date(at.getTime() + span) };
}


/**
 * Modo JANELA: N publicações por dia, espalhadas entre dois horários.
 *
 * É como se pensa o volume de verdade — "70 vídeos por dia, das 7h às 23h" —
 * em vez de cadastrar 70 horários à mão ou calcular de cabeça que isso dá um
 * post a cada 13,7 minutos.
 *
 * O espaçamento é uniforme: janela dividida por N. O primeiro sai no início da
 * janela e o último cai um intervalo ANTES do fim — assim o espaço entre o
 * último de hoje e o primeiro de amanhã continua sendo o mesmo intervalo, e
 * não uma pausa longa seguida de dois posts colados na virada.
 *
 * A janela pode atravessar a meia-noite ("22:00" a "02:00"): quando o fim é
 * menor ou igual ao início, ela termina no dia seguinte.
 *
 * @param {object} cfg
 * @param {number} cfg.postsPerDay
 * @param {string} cfg.windowStart  "HH:mm"
 * @param {string} cfg.windowEnd    "HH:mm"
 * @param {number} days             quantos dias gerar
 * @returns {Date[]} ordenados, sem os que já passaram
 */
export function windowOccurrences({ postsPerDay, windowStart, windowEnd }, days, { now = Date.now() } = {}) {
  const n = Math.max(1, Math.floor(postsPerDay || 0));
  const inicio = minutosDoDia(windowStart);
  const fim = minutosDoDia(windowEnd);
  if (inicio === null || fim === null) return [];

  // Janela que atravessa a meia-noite dura o que falta do dia mais o começo do
  // seguinte. Sem isto, "22:00 às 02:00" daria duração negativa e nenhum post.
  const duracao = fim > inicio ? fim - inicio : 1440 - inicio + fim;
  const passo = duracao / n;

  const out = [];
  for (let d = 0; d < days; d++) {
    const base = new Date(now);
    base.setDate(base.getDate() + d);
    base.setHours(0, 0, 0, 0);

    for (let i = 0; i < n; i++) {
      const at = new Date(base.getTime() + (inicio + i * passo) * 60_000);
      // Segundos zerados: a grade fica legível no calendário, e o agendador
      // compara por minuto.
      at.setSeconds(0, 0);
      if (at.getTime() >= now) out.push(at);
    }
  }

  return out.sort((a, b) => a - b);
}

/** Minutos desde a meia-noite de "HH:mm". Null se inválido. */
export function minutosDoDia(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Texto do ritmo da janela, para o usuário conferir antes de salvar.
 * "70 por dia, um a cada 13 min".
 */
export function describeWindow({ postsPerDay, windowStart, windowEnd }) {
  const n = Math.max(1, Math.floor(postsPerDay || 0));
  const inicio = minutosDoDia(windowStart);
  const fim = minutosDoDia(windowEnd);
  if (inicio === null || fim === null) return 'janela inválida';

  const duracao = fim > inicio ? fim - inicio : 1440 - inicio + fim;
  const passo = duracao / n;

  const intervalo = passo >= 60
    ? `${(passo / 60).toFixed(passo % 60 === 0 ? 0 : 1)} h`
    : `${Math.round(passo)} min`;

  return `${n} por dia entre ${windowStart} e ${windowEnd} — um a cada ${intervalo}`;
}

/**
 * Publicações por dia que a configuração produz.
 * Serve para estimar por quantos dias a fila aguenta.
 */
export function dailyRate({ scheduleMode, intervalMinutes, enabledSlots, postsPerDay }) {
  if (scheduleMode === 'WINDOW') {
    return Math.max(1, Math.floor(postsPerDay || 0));
  }
  if (scheduleMode === 'INTERVAL') {
    return 1440 / Math.max(1, intervalMinutes || 60);
  }
  return enabledSlots;
}

/**
 * Descreve a janela de um slot para o usuário conferir de relance.
 * "14:00 exato" ou "entre 13:50 e 14:10".
 */
export function describeSlot(time, jitterMinutes) {
  const minutes = Math.max(0, jitterMinutes || 0);
  if (minutes === 0) return `${time} exato`;

  const [h, m] = time.split(':').map(Number);
  const base = h * 60 + m;
  const fmt = (total) => {
    const norm = ((total % 1440) + 1440) % 1440;
    return `${String(Math.floor(norm / 60)).padStart(2, '0')}:${String(norm % 60).padStart(2, '0')}`;
  };
  return `entre ${fmt(base - minutes)} e ${fmt(base + minutes)}`;
}
