import { prisma } from '../db/prisma.js';

/**
 * Avisos fora do painel.
 *
 * A automação foi feita para rodar sozinha, mas até aqui uma falha só existia
 * dentro do app: se a conta pausasse às 3h da manhã, o usuário descobria
 * quando abrisse o painel — com a fila parada desde então.
 *
 * Dois destinos, ambos opcionais:
 *
 * - TELEGRAM: o mais direto para quem opera do celular. Precisa do token de um
 *   bot (criado no @BotFather) e do id do chat.
 * - WEBHOOK: um POST com JSON, para quem já usa Discord, n8n ou Make.
 *
 * Falha de aviso NUNCA derruba o que estava acontecendo: o objetivo é contar
 * que algo deu errado, e um aviso que quebra a publicação seria pior do que
 * aviso nenhum.
 */

/** Eventos que valem uma notificação. Nem tudo merece acordar alguém. */
export const EVENTO = {
  CONTA_PAUSADA: 'CONTA_PAUSADA',
  INTERVENCAO: 'INTERVENCAO',
  FILA_ACABANDO: 'FILA_ACABANDO',
  PUBLICACAO_OK: 'PUBLICACAO_OK',
};

const EMOJI = {
  [EVENTO.CONTA_PAUSADA]: '🔴',
  [EVENTO.INTERVENCAO]: '🟡',
  [EVENTO.FILA_ACABANDO]: '📭',
  [EVENTO.PUBLICACAO_OK]: '✅',
};

const TIMEOUT_MS = 8000;

/**
 * Envia um aviso. Silencioso quando nada está configurado.
 *
 * @param {object} aviso
 * @param {string} aviso.evento  um valor de EVENTO
 * @param {string} aviso.titulo
 * @param {string} [aviso.mensagem]
 * @param {string} [aviso.conta]  @ da conta envolvida
 */
export async function avisar({ evento, titulo, mensagem = '', conta = null }) {
  const s = await prisma.settings.findUnique({ where: { id: 1 } }).catch(() => null);
  if (!s) return { enviado: false, motivo: 'sem configuração' };

  // Sucesso é opcional: quem publica 20 vezes por dia não quer 20 mensagens.
  if (evento === EVENTO.PUBLICACAO_OK && !s.notifyOnSuccess) {
    return { enviado: false, motivo: 'sucesso desligado' };
  }

  const texto = [
    `${EMOJI[evento] ?? '•'} ${titulo}`,
    conta ? `Conta: @${conta}` : null,
    mensagem || null,
  ].filter(Boolean).join('\n');

  const destinos = [];
  if (s.telegramBotToken && s.telegramChatId) {
    destinos.push(enviarTelegram(s, texto));
  }
  if (s.webhookUrl) {
    destinos.push(enviarWebhook(s.webhookUrl, { evento, titulo, mensagem, conta, texto }));
  }
  if (!destinos.length) return { enviado: false, motivo: 'nenhum destino' };

  const r = await Promise.allSettled(destinos);
  return {
    enviado: r.some((x) => x.status === 'fulfilled' && x.value === true),
    tentativas: r.length,
  };
}

async function enviarTelegram(s, texto) {
  const r = await postar(`https://api.telegram.org/bot${s.telegramBotToken}/sendMessage`, {
    chat_id: s.telegramChatId,
    text: texto,
    disable_web_page_preview: true,
  });
  return r;
}

async function enviarWebhook(url, corpo) {
  // `content` junto do payload próprio: é o campo que o Discord lê, e assim a
  // mesma URL serve para Discord e para um endpoint qualquer sem adaptador.
  return postar(url, { ...corpo, content: corpo.texto });
}

async function postar(url, corpo) {
  const abort = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: abort,
    });
    return r.ok;
  } catch {
    // Sem rede, URL errada, destino fora do ar: o aviso se perde e o app
    // segue. Estourar aqui pararia uma publicação por causa do recado sobre
    // ela.
    return false;
  }
}

/** Testa a configuração atual e diz o que aconteceu, para o botão do painel. */
export async function testar() {
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  const temTelegram = !!(s?.telegramBotToken && s?.telegramChatId);
  const temWebhook = !!s?.webhookUrl;

  if (!temTelegram && !temWebhook) {
    return { ok: false, mensagem: 'Nenhum destino configurado.' };
  }

  const r = await avisar({
    evento: EVENTO.PUBLICACAO_OK,
    titulo: 'Teste do Reels Manager',
    mensagem: 'Se você recebeu isto, os avisos estão funcionando.',
  });

  // O teste ignora a preferência de "avisar em sucesso": quem clicou no botão
  // quer ver a mensagem chegar, independente dessa escolha.
  if (!r.enviado && r.motivo === 'sucesso desligado') {
    const forcado = await forcar('Teste do Reels Manager', 'Se você recebeu isto, os avisos estão funcionando.');
    return forcado
      ? { ok: true, mensagem: 'Mensagem enviada. Confira o destino.' }
      : { ok: false, mensagem: 'O destino recusou a mensagem. Verifique o token, o chat id ou a URL.' };
  }

  return r.enviado
    ? { ok: true, mensagem: 'Mensagem enviada. Confira o destino.' }
    : { ok: false, mensagem: 'O destino recusou a mensagem. Verifique o token, o chat id ou a URL.' };
}

async function forcar(titulo, mensagem) {
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  const texto = `${EMOJI[EVENTO.PUBLICACAO_OK]} ${titulo}\n${mensagem}`;
  const destinos = [];
  if (s.telegramBotToken && s.telegramChatId) destinos.push(enviarTelegram(s, texto));
  if (s.webhookUrl) destinos.push(enviarWebhook(s.webhookUrl, { titulo, mensagem, texto }));
  const r = await Promise.allSettled(destinos);
  return r.some((x) => x.status === 'fulfilled' && x.value === true);
}
