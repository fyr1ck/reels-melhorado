import { prisma } from '../../db/prisma.js';
import * as logger from '../log.js';
import { conversar, configurado } from '../assistant/claude.js';

/**
 * Legenda rotativa: a cada N publicações da conta, o assistente escreve uma
 * legenda nova.
 *
 * A legenda viva é a `fallbackCaption` da conta — a mesma que o publicador já
 * usa quando o vídeo não tem a sua. Nada precisa ser gravado em cada vídeo da
 * fila: os 20 seguintes herdam a legenda nova na hora em que forem ao ar.
 *
 * O texto novo sai SEMPRE da `captionSeed`, nunca da última gerada. Gerar a
 * partir da anterior é telefone sem fio: em alguns lotes o formato, o idioma e
 * o tamanho já não são os do original.
 */

const MAX_CARACTERES = 2200;

const INSTRUCOES = `Você escreve legendas para Reels do Instagram.

Recebe uma legenda MODELO e devolve UMA legenda nova que imita o modelo.

Regras:

1. Mesmo idioma do modelo. Se o modelo está em japonês, a resposta é em japonês.
2. Mesma estrutura: mesma quantidade de linhas, as quebras de linha nos mesmos
   lugares, os mesmos emojis e a mesma pontuação decorativa (!!, ◆, 💧).
3. Mesmo comprimento aproximado.
4. Troque APENAS o assunto. O modelo fala de um tema; a nova fala de outro,
   escolhido por você, que faça sentido para um Reel.
5. O assunto novo não pode ser o mesmo da legenda em uso, que também vem junto.
6. Responda SÓ com a legenda. Sem aspas, sem markdown, sem comentário, sem
   explicação, sem título.`;

/** O pedido do usuário, palavra por palavra — é o que define o formato. */
export const PEDIDO = 'transcreva essa legenda, mantenha a quebra de linha, o idioma e o formato porem troque o assunto';

export function montarPrompt({ base, atual }) {
  const partes = [`LEGENDA MODELO:\n\n${base}\n\n${PEDIDO}`];
  if (atual && atual.trim() && atual.trim() !== base.trim()) {
    partes.push(`A legenda em uso agora é esta — escolha um assunto DIFERENTE do dela:\n\n${atual}`);
  }
  return partes.join('\n\n---\n\n');
}

/**
 * Decide o que fazer com mais uma publicação. Puro de propósito: é a regra que
 * diz quando o lote virou, e dá para conferir sem banco nem rede.
 *
 * @returns {{contagem: number, trocar: boolean}}
 */
export function decidir(account) {
  const cada = account?.captionRotateEvery ?? 0;
  if (cada <= 0) return { contagem: account?.captionRotateCount ?? 0, trocar: false };

  const contagem = (account.captionRotateCount ?? 0) + 1;
  return { contagem, trocar: contagem >= cada };
}

/** Pede a legenda nova ao Claude. Separada para o teste poder substituí-la. */
export async function gerar({ base, atual }) {
  if (!(await configurado())) {
    throw new Error('Assistente sem chave da API. Configure em Assistente para a legenda trocar sozinha.');
  }
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const { texto } = await conversar({
    system: INSTRUCOES,
    prompt: montarPrompt({ base, atual }),
    modelo: settings?.assistantModel || 'claude-sonnet-5',
    maxTokens: 2048,
  });

  const limpa = String(texto || '').trim();
  if (!limpa) throw new Error('O assistente devolveu uma legenda vazia.');
  // O Instagram corta o que passa disso, e a legenda cortada no meio de uma
  // linha fica pior do que a legenda anterior inteira.
  return limpa.slice(0, MAX_CARACTERES);
}

/**
 * Conta mais uma publicação e, quando o lote fecha, troca a legenda da conta.
 *
 * Chamada depois do SUCESSO, dos dois caminhos que publicam (o agendador e o
 * "Postar agora"). Nunca lança: uma falha aqui não pode desfazer um reel que
 * já está no ar.
 */
export async function registrarPublicacao(accountId, gerarFn = gerar) {
  try {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    const { contagem, trocar } = decidir(account);
    if (!trocar) {
      if (account?.captionRotateEvery > 0) {
        await prisma.account.update({ where: { id: accountId }, data: { captionRotateCount: contagem } });
      }
      return null;
    }

    const base = (account.captionSeed || account.fallbackCaption || '').trim();
    if (!base) {
      await prisma.account.update({ where: { id: accountId }, data: { captionRotateCount: contagem } });
      await logger.warn({
        action: 'LEGENDA_ROTATIVA_SEM_MODELO', accountId,
        message: 'O lote fechou, mas a conta não tem legenda padrão para servir de modelo.',
      });
      return null;
    }

    try {
      const nova = await gerarFn({ base, atual: account.fallbackCaption });
      await prisma.account.update({
        where: { id: accountId },
        // A base é gravada na primeira troca: a partir daí o formato vem
        // sempre do original, mesmo depois de dez legendas geradas.
        data: { fallbackCaption: nova, captionSeed: base, captionRotateCount: 0 },
      });
      await logger.success({
        action: 'LEGENDA_ROTATIVA_TROCADA', accountId,
        message: `Depois de ${account.captionRotateEvery} publicações: ${nova.split('\n')[0].slice(0, 80)}…`,
      });
      return nova;
    } catch (err) {
      // A contagem fica no topo, não zera: assim a próxima publicação tenta de
      // novo, em vez de deixar o lote inteiro sair com a legenda velha por
      // causa de um timeout na API.
      await prisma.account.update({ where: { id: accountId }, data: { captionRotateCount: contagem } });
      await logger.warn({
        action: 'LEGENDA_ROTATIVA_FALHOU', accountId,
        message: `${err.message} A legenda anterior continua valendo.`,
      });
      return null;
    }
  } catch (err) {
    await logger.warn({
      action: 'LEGENDA_ROTATIVA_FALHOU', accountId, message: err.message,
    }).catch(() => {});
    return null;
  }
}
