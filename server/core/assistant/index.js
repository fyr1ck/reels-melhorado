import { prisma } from '../../db/prisma.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import * as capture from './capture.js';
import * as context from './context.js';
import * as claude from './claude.js';
import * as patch from './patch.js';
import * as logger from '../log.js';

export { capture, context, claude, patch };

/**
 * O assistente.
 *
 * Junta as peças: pega um erro capturado, monta o contexto de código, manda
 * para o Claude e guarda a resposta. Aplicar a correção é passo separado e
 * explícito — ver `patch.js` para o porquê.
 */

/** Ligado? Sem chave configurada, tudo aqui fica desligado por definição. */
export async function estado() {
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  const temChave = await claude.configurado();

  return {
    habilitado: !!s?.assistantEnabled && temChave,
    // Distingue "desligado por escolha" de "desligado por falta de chave":
    // sem isso o usuário liga o botão e nada acontece, sem explicação.
    ligadoNoPainel: !!s?.assistantEnabled,
    temChave,
    // A chave nunca volta para o cliente; só se ela existe e de onde vem.
    chaveDoAmbiente: !!process.env.ANTHROPIC_API_KEY,
    modelo: s?.assistantModel || 'claude-sonnet-5',
    aplicarAutomatico: !!s?.assistantAutoApply,
    modelos: claude.MODELOS,
  };
}

/**
 * Registra um erro — só quando o assistente está ligado.
 *
 * A checagem mora aqui, e não em cada ponto de captura, para desligar o
 * assistente realmente parar de guardar coisa: um app desligado que continua
 * acumulando stack traces em disco não está desligado.
 */
export async function registrarSeLigado(erro) {
  try {
    const s = await prisma.settings.findUnique({ where: { id: 1 } });
    if (!s?.assistantEnabled) return null;

    const entrada = capture.registrar(erro);

    // Aplicar sozinho é opção do usuário, e vem desligada. Roda em segundo
    // plano: o erro que disparou isto não pode esperar uma chamada de API.
    if (s.assistantAutoApply && entrada.estado === 'ABERTO' && entrada.vezes === 1) {
      analisarEAplicar(entrada.id).catch((err) => {
        logger.warn({
          action: 'ASSISTENTE_AUTO_FALHOU',
          message: `Não consegui corrigir sozinho: ${err.message}`,
        });
      });
    }
    return entrada;
  } catch {
    // Nada aqui pode derrubar o que estava acontecendo. O assistente é um
    // acessório; a publicação em curso não é.
    return null;
  }
}

/** Monta o texto que vai para o Claude. */
export function montarPrompt(erro) {
  const arquivos = context.montar(erro.stack);

  const partes = [
    `## Erro (${erro.origem})`,
    '',
    `Aconteceu ${erro.vezes}x. Primeira vez: ${erro.primeiraEm}. Última: ${erro.ultimaEm}.`,
    '',
    '```',
    erro.mensagem,
    '```',
    '',
    '## Stack trace',
    '```',
    erro.stack || '(sem stack)',
    '```',
  ];

  if (erro.contexto) {
    partes.push('', '## Contexto adicional', '```json', JSON.stringify(erro.contexto, null, 2), '```');
  }

  if (arquivos.length) {
    partes.push('', '## Código dos arquivos citados no stack');
    for (const a of arquivos) {
      partes.push(
        '',
        `### ${a.arquivo} (linha ${a.linha} de ${a.linhasTotais}${a.completo ? ', arquivo completo' : ', trecho'})`,
        '```',
        a.corpo,
        '```',
      );
    }
  } else {
    partes.push(
      '',
      '## Código',
      'Nenhum arquivo do projeto foi identificado no stack trace. Diga qual arquivo você precisaria ver.',
    );
  }

  return partes.join('\n');
}

/** Analisa um erro e guarda o resultado na entrada. */
export async function analisar(errorId) {
  const erro = capture.buscar(errorId);
  if (!erro) throw new NotFoundError('Erro não encontrado.');

  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  const { analise, uso, modelo } = await claude.analisar({
    prompt: montarPrompt(erro),
    modelo: s?.assistantModel || 'claude-sonnet-5',
  });

  // Cada correção já vem com o veredito de aplicabilidade: a tela precisa
  // saber, antes do clique, se o trecho ainda bate com o arquivo atual.
  const correcoes = (analise.correcoes ?? []).map((c) => {
    const check = patch.verificar(c);
    return { ...c, aplicavel: check.ok, motivo: check.ok ? null : check.motivo };
  });

  const atualizado = capture.atualizar(errorId, {
    estado: 'ANALISADO',
    analise: { ...analise, correcoes, modelo, uso, analisadoEm: new Date().toISOString() },
  });

  await logger.info({
    action: 'ASSISTENTE_ANALISOU',
    message: `${analise.causa ?? 'sem causa identificada'} (${correcoes.length} correção(ões))`,
  });

  return atualizado;
}

/**
 * Aplica as correções de um erro já analisado.
 *
 * Verifica TODAS antes de escrever a primeira: aplicar metade de uma correção
 * de dois arquivos deixaria o código num estado que nenhum dos dois lados
 * previu.
 */
export function aplicar(errorId, { indices = null } = {}) {
  const erro = capture.buscar(errorId);
  if (!erro) throw new NotFoundError('Erro não encontrado.');
  if (!erro.analise?.correcoes?.length) {
    throw new ValidationError('Esse erro não tem correção proposta. Analise primeiro.');
  }

  const escolhidas = indices
    ? erro.analise.correcoes.filter((_, i) => indices.includes(i))
    : erro.analise.correcoes;

  if (!escolhidas.length) throw new ValidationError('Nenhuma correção selecionada.');

  for (const c of escolhidas) {
    const check = patch.verificar(c);
    if (!check.ok) throw new ValidationError(`${c.arquivo}: ${check.motivo}`);
  }

  const aplicadas = escolhidas.map((c) =>
    patch.aplicar(c, { errorId, causa: erro.analise.causa }));

  capture.atualizar(errorId, { estado: 'RESOLVIDO' });
  return { aplicadas, arquivos: [...new Set(aplicadas.map((a) => a.arquivo))] };
}

/** Analisa e aplica numa tacada. É o caminho do modo automático. */
export async function analisarEAplicar(errorId) {
  const erro = await analisar(errorId);
  const a = erro.analise;

  // Três recusas deliberadas: não é bug de código, o modelo não confia na
  // própria resposta, ou o trecho já não bate. Em qualquer uma delas a
  // proposta fica registrada para o usuário decidir.
  if (!a?.ehBugDeCodigo) {
    logger.info({ action: 'ASSISTENTE_AUTO_PULOU', message: 'Não é defeito de código.' });
    return { aplicado: false, motivo: 'NAO_E_CODIGO', erro };
  }
  if (a.confianca === 'baixa') {
    logger.info({ action: 'ASSISTENTE_AUTO_PULOU', message: 'Confiança baixa; deixei para revisão.' });
    return { aplicado: false, motivo: 'CONFIANCA_BAIXA', erro };
  }
  if (!a.correcoes?.length || a.correcoes.some((c) => !c.aplicavel)) {
    return { aplicado: false, motivo: 'NAO_APLICAVEL', erro };
  }

  const r = aplicar(errorId);
  logger.warn({
    action: 'ASSISTENTE_AUTO_APLICOU',
    message: `${r.arquivos.join(', ')} — ${a.causa}`,
  });
  return { aplicado: true, ...r, erro: capture.buscar(errorId) };
}
