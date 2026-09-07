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
 * Publicações por dia que a configuração produz.
 * Serve para estimar por quantos dias a fila aguenta.
 */
export function dailyRate({ scheduleMode, intervalMinutes, enabledSlots }) {
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
