/**
 * Limites de publicação: teto diário, janela de silêncio e aquecimento.
 *
 * Um perfil novo que publica 15 reels no primeiro dia é o caso mais comum de
 * bloqueio — o padrão não parece o de alguém usando o app, parece o de um
 * robô. E publicar às 4h da manhã não queima a conta, mas desperdiça o vídeo:
 * ele nasce sem audiência e o alcance não se recupera depois.
 *
 * Este módulo é PURO: recebe uma lista de instantes já calculada pelo
 * agendador e devolve quais sobrevivem. Não sabe o que é banco, conta ou
 * vídeo, e por isso dá para testar cada regra isoladamente.
 */

/** Minutos desde a meia-noite de uma string "HH:mm". Null se inválida. */
export function minutosDe(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * O instante cai na janela de silêncio?
 *
 * A janela pode cruzar a meia-noite — "23:00 às 07:00" é o caso normal, e é
 * justamente o que uma comparação ingênua `inicio <= x < fim` erraria.
 */
export function emSilencio(data, { quietStart, quietEnd } = {}) {
  const inicio = minutosDe(quietStart);
  const fim = minutosDe(quietEnd);
  if (inicio === null || fim === null || inicio === fim) return false;

  const x = data.getHours() * 60 + data.getMinutes();
  return inicio < fim
    ? x >= inicio && x < fim      // 01:00–06:00
    : x >= inicio || x < fim;     // 23:00–07:00, atravessa a meia-noite
}

/**
 * Teto de publicações no dia `diaDoAquecimento` (1 = primeiro dia).
 *
 * Cresce linearmente até `alvo`, nunca abaixo de 1: uma rampa que começa em
 * zero deixaria a conta parada sem explicação. Depois do último dia o
 * aquecimento sai de cena e devolve `null` (sem teto próprio).
 */
export function tetoDoAquecimento(diaDoAquecimento, { warmupDays = 14, warmupTarget = 6 } = {}) {
  if (diaDoAquecimento > warmupDays) return null;
  const dia = Math.max(1, diaDoAquecimento);
  return Math.max(1, Math.ceil((warmupTarget * dia) / Math.max(1, warmupDays)));
}

/** Em que dia do aquecimento cai `data`, contando de 1. */
export function diaDoAquecimento(data, warmupStartAt) {
  if (!warmupStartAt) return null;
  const inicio = new Date(warmupStartAt);
  // Compara DIAS civis, não intervalos de 24h: quem liga o aquecimento às 23h
  // não deve ver o dia 2 começar uma hora depois.
  const a = Date.UTC(inicio.getFullYear(), inicio.getMonth(), inicio.getDate());
  const b = Date.UTC(data.getFullYear(), data.getMonth(), data.getDate());
  return Math.floor((b - a) / 86_400_000) + 1;
}

/** Chave do dia civil local. `toISOString` jogaria o post das 22h no dia seguinte. */
export function chaveDoDia(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Teto efetivo de um dia: o MENOR entre o teto fixo e o do aquecimento.
 * `null` = sem teto.
 */
export function tetoDoDia(data, regras = {}) {
  const tetos = [];

  if (regras.dailyLimit > 0) tetos.push(regras.dailyLimit);

  if (regras.warmupStartAt) {
    const dia = diaDoAquecimento(data, regras.warmupStartAt);
    // Instante anterior ao início do aquecimento: nada a limitar por ele.
    if (dia !== null && dia >= 1) {
      const teto = tetoDoAquecimento(dia, regras);
      if (teto !== null) tetos.push(teto);
    }
  }

  return tetos.length ? Math.min(...tetos) : null;
}

/**
 * Aplica as regras a uma lista de instantes já ordenada.
 *
 * @param {Date[]} instantes
 * @param {object} regras  dailyLimit, quietStart, quietEnd, warmupStartAt, warmupDays, warmupTarget
 * @param {object} [ctx]
 * @param {Record<string, number>} [ctx.jaNoDia] publicações que já existem em
 *   cada dia (as que já foram ao ar) e portanto consomem o teto.
 * @returns {{ mantidos: Date[], silencio: number, teto: number }}
 */
export function aplicarLimites(instantes, regras = {}, { jaNoDia = {} } = {}) {
  const usados = { ...jaNoDia };
  const mantidos = [];
  let silencio = 0;
  let teto = 0;

  for (const at of instantes) {
    if (emSilencio(at, regras)) { silencio += 1; continue; }

    const chave = chaveDoDia(at);
    const limite = tetoDoDia(at, regras);
    const jaUsado = usados[chave] ?? 0;

    if (limite !== null && jaUsado >= limite) { teto += 1; continue; }

    usados[chave] = jaUsado + 1;
    mantidos.push(at);
  }

  return { mantidos, silencio, teto };
}

/**
 * Espera antes da próxima tentativa, em milissegundos.
 *
 * Antes as 3 tentativas eram imediatas: uma instabilidade de 10 segundos
 * consumia todas, mandava o vídeo para /failed e pausava a conta inteira. Com
 * recuo, a maioria das falhas passageiras se resolve sozinha.
 */
export function esperaDaTentativa(tentativa) {
  const escala = [30_000, 120_000, 600_000]; // 30s, 2min, 10min
  return escala[Math.min(tentativa, escala.length) - 1] ?? escala.at(-1);
}
