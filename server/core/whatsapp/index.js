import { prisma } from '../../db/prisma.js';
import { ACCOUNT_STATUS, VIDEO_STATUS, OPEN_STATUSES } from '../../lib/enums.js';
import * as accounts from '../accounts/accounts.js';
import * as logger from '../log.js';
import * as client from './client.js';
import { interpretar, textoDoMenu, mesmoNumero } from './commands.js';

export { client };
export * from './commands.js';

/**
 * Controle remoto por WhatsApp.
 *
 * Junta o cliente do navegador com o interpretador de comandos, e escuta a
 * conversa do número autorizado.
 *
 * A autorização é por NÚMERO e não tem exceção: só a conversa configurada é
 * lida, e o que chegar de qualquer outra é ignorado sem resposta. Como o app
 * abre a conversa por URL (`send?phone=`), mensagem de terceiro nem chega a
 * ser lida — a trava é estrutural, não uma checagem que dá para esquecer.
 */

const INTERVALO_MS = 8000;

let timer = null;
let ocupado = false;
const jaRespondidas = new Set();

/** Formata data/hora no fuso local, curto — é para ler no celular. */
const hora = (d) => new Date(d).toLocaleString('pt-BR', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

// ============================================================
// RESPOSTAS
// ============================================================

async function respostaStatus() {
  const list = await prisma.account.findMany({ orderBy: { sortOrder: 'asc' } });
  const resumos = await accounts.summarizeAll(list);

  const ativas = resumos.filter((a) => a.enabled && a.status === ACCOUNT_STATUS.ACTIVE);
  const fila = resumos.reduce((s, a) => s + a.reels, 0);

  const hojeInicio = new Date();
  hojeInicio.setHours(0, 0, 0, 0);
  const publicadosHoje = await prisma.publication.count({
    where: { status: VIDEO_STATUS.PUBLISHED, publishedAt: { gte: hojeInicio } },
  });

  const proxima = await prisma.publication.findFirst({
    where: { status: VIDEO_STATUS.SCHEDULED },
    orderBy: { scheduledAt: 'asc' },
    include: { account: { select: { username: true } }, video: { select: { filename: true } } },
  });

  return [
    `*Status* — ${hora(new Date())}`,
    '',
    `${ativas.length ? '🟢' : '🔴'} ${ativas.length} de ${resumos.length} conta(s) publicando`,
    `📼 ${fila} vídeo(s) na fila`,
    `✅ ${publicadosHoje} publicado(s) hoje`,
    proxima
      ? `⏰ próxima: ${hora(proxima.scheduledAt)} em @${proxima.account.username}`
      : '⏰ nada agendado',
  ].join('\n');
}

async function respostaFila() {
  const list = await prisma.account.findMany({ orderBy: { sortOrder: 'asc' } });
  if (!list.length) return 'Nenhuma conta cadastrada.';

  const linhas = await Promise.all(list.map(async (a) => {
    const n = await prisma.video.count({
      where: { accountId: a.id, status: { in: OPEN_STATUSES } },
    });
    return `• @${a.username}: ${n} vídeo(s)`;
  }));

  return ['*Fila por conta*', '', ...linhas].join('\n');
}

async function respostaProximo() {
  const proximas = await prisma.publication.findMany({
    where: { status: VIDEO_STATUS.SCHEDULED },
    orderBy: { scheduledAt: 'asc' },
    take: 5,
    include: { account: { select: { username: true } }, video: { select: { filename: true } } },
  });

  if (!proximas.length) return 'Nada agendado. Cadastre horários e ponha vídeos na fila.';

  return ['*Próximas publicações*', '', ...proximas.map(
    (p) => `• ${hora(p.scheduledAt)} — @${p.account.username}\n  _${p.video.filename}_`,
  )].join('\n');
}

async function respostaContas() {
  const list = await prisma.account.findMany({ orderBy: { sortOrder: 'asc' } });
  if (!list.length) return 'Nenhuma conta cadastrada.';

  const resumos = await accounts.summarizeAll(list);
  return ['*Contas*', '', ...resumos.map((a) => {
    const sinal = a.health.level === 'ok' ? '🟢' : a.health.level === 'danger' ? '🔴' : '🟡';
    return `${sinal} @${a.username} — ${a.health.label.toLowerCase()}, ${a.reels} na fila`;
  })].join('\n');
}

async function respostaErros() {
  const erros = await prisma.logEntry.findMany({
    where: { level: 'ERROR' },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  if (!erros.length) return '✅ Nenhuma falha registrada.';

  return ['*Últimas falhas*', '', ...erros.map(
    (e) => `• ${hora(e.createdAt)} — ${e.action}\n  _${(e.message ?? '').slice(0, 120)}_`,
  )].join('\n');
}

/**
 * Pausa ou ativa. Sem conta informada, vale para todas.
 *
 * Ativar exige sessão conectada: ligar uma conta sem cookie só geraria falha
 * em loop e a pausaria de novo — e pelo WhatsApp o usuário não veria por quê.
 */
async function mudarEstado(novoEstado, nomeConta) {
  const where = nomeConta ? { username: nomeConta } : {};
  const list = await prisma.account.findMany({ where });

  if (!list.length) {
    return nomeConta
      ? `Não achei a conta @${nomeConta}. Mande *contas* para ver os nomes.`
      : 'Nenhuma conta cadastrada.';
  }

  const feitas = [];
  const recusadas = [];

  for (const a of list) {
    if (novoEstado === ACCOUNT_STATUS.ACTIVE && !accounts.hasSession(a.id)) {
      recusadas.push(`@${a.username} (sem sessão — conecte no painel)`);
      continue;
    }
    await prisma.account.update({ where: { id: a.id }, data: { status: novoEstado } });
    feitas.push(`@${a.username}`);
  }

  await logger.warn({
    action: novoEstado === ACCOUNT_STATUS.ACTIVE ? 'ATIVADA_POR_WHATSAPP' : 'PAUSADA_POR_WHATSAPP',
    message: feitas.join(', ') || 'nenhuma',
  });

  const verbo = novoEstado === ACCOUNT_STATUS.ACTIVE ? 'ativada(s)' : 'pausada(s)';
  return [
    feitas.length ? `✅ ${verbo}: ${feitas.join(', ')}` : null,
    recusadas.length ? `⚠️ não deu para ativar: ${recusadas.join(', ')}` : null,
  ].filter(Boolean).join('\n');
}

/** Roteia um comando já interpretado para a resposta. */
export async function responder({ comando, conta }) {
  switch (comando) {
    case 'menu': return textoDoMenu();
    case 'status': return respostaStatus();
    case 'fila': return respostaFila();
    case 'proximo': return respostaProximo();
    case 'contas': return respostaContas();
    case 'erros': return respostaErros();
    case 'pausar': return mudarEstado(ACCOUNT_STATUS.PAUSED, conta);
    case 'ativar': return mudarEstado(ACCOUNT_STATUS.ACTIVE, conta);
    default: return textoDoMenu();
  }
}

// ============================================================
// ESCUTA
// ============================================================

async function numeroAutorizado() {
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  return s?.whatsappEnabled ? (s.whatsappNumber || null) : null;
}

/**
 * Lê a conversa e responde o que for comando.
 *
 * As mensagens já respondidas ficam num Set: sem isso, cada volta do laço
 * responderia a última mensagem de novo, para sempre.
 */
async function verificar() {
  if (ocupado) return;
  const numero = await numeroAutorizado();
  if (!numero || !client.conectado()) return;

  ocupado = true;
  try {
    const recebidas = await client.lerRecebidas(numero);

    // Na primeira volta, marca tudo como visto sem responder: senão, conectar
    // dispararia resposta para a conversa inteira que já estava lá.
    if (!jaRespondidas.size && recebidas.length) {
      for (const m of recebidas) jaRespondidas.add(m.id);
      return;
    }

    for (const m of recebidas) {
      if (jaRespondidas.has(m.id)) continue;
      jaRespondidas.add(m.id);

      const cmd = interpretar(m.texto);
      if (!cmd) {
        await client.enviar(numero, 'Não entendi. Mande *menu* para ver o que dá para fazer.');
        continue;
      }

      await logger.info({ action: 'COMANDO_WHATSAPP', message: `${cmd.comando}${cmd.conta ? ` @${cmd.conta}` : ''}` });
      await client.enviar(numero, await responder(cmd));
    }

    // O Set não pode crescer para sempre num processo que fica dias no ar.
    if (jaRespondidas.size > 300) {
      const manter = [...jaRespondidas].slice(-100);
      jaRespondidas.clear();
      for (const id of manter) jaRespondidas.add(id);
    }
  } catch (err) {
    await logger.warn({ action: 'WHATSAPP_LEITURA_FALHOU', message: err.message });
  } finally {
    ocupado = false;
  }
}

export function iniciarEscuta() {
  if (timer) return;
  timer = setInterval(() => verificar().catch(() => {}), INTERVALO_MS);
}

export function pararEscuta() {
  if (timer) clearInterval(timer);
  timer = null;
  jaRespondidas.clear();
}

// ============================================================
// SAÍDA: avisos
// ============================================================

/**
 * Manda um aviso, se o WhatsApp estiver ligado e conectado.
 *
 * Nunca lança: é chamado de dentro do agendador, e um aviso que quebra a
 * publicação sobre a qual ele avisaria seria pior que aviso nenhum.
 */
export async function avisar(texto) {
  try {
    const numero = await numeroAutorizado();
    if (!numero || !client.conectado()) return false;
    await client.enviar(numero, texto);
    return true;
  } catch (err) {
    await logger.warn({ action: 'WHATSAPP_AVISO_FALHOU', message: err.message });
    return false;
  }
}

/** Conecta e já começa a escutar. É o que a tela chama. */
export async function conectar({ mostrarJanela } = {}) {
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  // A preferência salva manda; o parâmetro só existe para o botão de
  // diagnóstico forçar a janela numa conexão específica.
  const visivel = mostrarJanela ?? (s?.whatsappHeadless === false);

  const r = await client.conectar({ mostrarJanela: visivel });
  if (client.conectado()) {
    iniciarEscuta();
    const numero = await numeroAutorizado();
    if (numero) {
      await client.enviar(numero, [
        '✅ *Reels Manager conectado*',
        '',
        'A partir de agora você recebe os avisos aqui e pode dar comandos.',
        '',
        'Mande *menu* para ver a lista.',
      ].join('\n')).catch(() => { /* a conexão vale mesmo sem a saudação */ });
    }
  }
  return r;
}

export async function desconectar(opcoes) {
  pararEscuta();
  return client.desconectar(opcoes);
}

/** Reabre a sessão salva na subida do servidor, sem pedir QR de novo. */
export async function retomarNoBoot() {
  const numero = await numeroAutorizado();
  if (!numero) return false;

  try {
    // `apenasSessaoSalva` desiste assim que aparece um QR: na subida do
    // servidor não há ninguém olhando para escanear, e insistir deixaria uma
    // janela do Chromium aberta por três minutos sem motivo.
    const s = await prisma.settings.findUnique({ where: { id: 1 } });
    await client.conectar({
      apenasSessaoSalva: true,
      timeoutMs: 45_000,
      mostrarJanela: s?.whatsappHeadless === false,
    });
    if (client.conectado()) {
      iniciarEscuta();
      return true;
    }
  } catch {
    // Sessão expirada ou navegador indisponível: o painel mostra o estado e
    // oferece o QR quando o usuário pedir. Não vale derrubar a subida por isso.
  }
  return false;
}

export { mesmoNumero };
