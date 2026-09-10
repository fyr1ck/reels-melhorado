import { prisma } from '../../db/prisma.js';
import { compatibilidadeDaConta } from './classifier.js';
import { config, STATUS } from './classify.js';

/**
 * A validação que roda ANTES de publicar.
 *
 * É a última linha: mesmo que o vídeo tenha ido parar na fila da conta errada
 * — por distribuição, por arrasto na tela, por um vídeo reciclado antigo — é
 * aqui que ele é barrado.
 *
 * Duas escolhas deliberadas sobre o que este arquivo NÃO faz:
 *
 * - não publica nem cancela nada. Devolve um veredito; quem decide o que fazer
 *   é o agendador, que já sabe lidar com falha, retentativa e pausa de conta.
 * - não bloqueia por dúvida. Sem nichos cadastrados, com o recurso desligado,
 *   ou com uma conta que ninguém vinculou a nicho nenhum, a resposta é
 *   "pode publicar". Um recurso novo não pode parar a operação de quem ainda
 *   não o configurou.
 */

/**
 * @returns {Promise<{pode: boolean, motivo: string|null, detalhe: object|null}>}
 */
export async function validar({ video, account }) {
  const cfg = await config();

  // Desligado, ou ligado só para observar: nada é impedido.
  if (!cfg.ligado || !cfg.bloquear) return liberado();

  const vinculos = await prisma.accountNiche.findMany({ where: { accountId: account.id } });

  // Conta sem nicho definido não participa da separação. Quem tem uma conta só
  // de memes e nunca abriu a tela de nichos continua publicando igual.
  if (!vinculos.length) return liberado();

  const cls = await prisma.contentClassification.findUnique({
    where: { videoId: video.id },
    include: { niche: true },
  });

  // Vídeo que nunca foi classificado — entrou antes do recurso existir, ou a
  // classificação falhou. Não é motivo para barrar: seria transformar uma
  // lacuna de dado em fila parada.
  if (!cls) return liberado();

  if (cls.status === STATUS.BLOQUEADO) {
    return barrado(
      'A classificação marcou este vídeo como BLOQUEADO.',
      { status: cls.status, score: cls.score, nicho: cls.niche?.name ?? null, motivos: motivosDe(cls) },
    );
  }

  if (cls.status === STATUS.REVISAO) {
    return barrado(
      'Este vídeo está aguardando revisão — a compatibilidade ficou na faixa de dúvida.',
      { status: cls.status, score: cls.score, nicho: cls.niche?.name ?? null, motivos: motivosDe(cls) },
    );
  }

  if (cls.status === STATUS.SEM_CLASSIFICACAO || !cls.nicheId) {
    return barrado(
      'Nenhum nicho reconheceu este vídeo, e esta conta publica nichos específicos.',
      { status: cls.status, score: cls.score, nicho: null, motivos: motivosDe(cls) },
    );
  }

  // O teste que dá nome à funcionalidade: o nicho do vídeo é um dos que ESTA
  // conta publica?
  const compat = compatibilidadeDaConta(cls.nicheId, vinculos);
  if (compat === 0) {
    const nomes = await nomesDosNichos(vinculos.map((v) => v.nicheId));
    return barrado(
      `Conteúdo de "${cls.niche?.name ?? 'outro nicho'}" não pertence a @${account.username}, `
      + `que publica ${nomes.length ? nomes.join(', ') : 'outros nichos'}.`,
      { status: cls.status, score: cls.score, nicho: cls.niche?.name ?? null, compatibilidadeDaConta: 0 },
    );
  }

  return liberado({ status: cls.status, score: cls.score, nicho: cls.niche?.name ?? null, compatibilidadeDaConta: compat });
}

function liberado(detalhe = null) {
  return { pode: true, motivo: null, detalhe };
}

function barrado(motivo, detalhe) {
  return { pode: false, motivo, detalhe };
}

function motivosDe(cls) {
  try {
    return JSON.parse(cls.reasons ?? '[]');
  } catch {
    return [];
  }
}

async function nomesDosNichos(ids) {
  if (!ids.length) return [];
  const achados = await prisma.niche.findMany({ where: { id: { in: ids } }, select: { name: true } });
  return achados.map((n) => n.name);
}
