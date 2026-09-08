import { prisma } from '../../db/prisma.js';
import { ValidationError } from '../../lib/errors.js';

/**
 * Conversa com a API do Claude.
 *
 * Sem SDK: a API de mensagens é um POST com JSON, e uma dependência a mais
 * para isso significaria mais uma coisa para atualizar e auditar.
 */

const URL = 'https://api.anthropic.com/v1/messages';
const VERSAO_API = '2023-06-01';
const TIMEOUT_MS = 120_000;

export const MODELOS = [
  { id: 'claude-sonnet-5', nome: 'Sonnet 5', hint: 'Equilíbrio entre custo e capacidade. Recomendado.' },
  { id: 'claude-opus-5', nome: 'Opus 5', hint: 'O mais capaz. Use quando o Sonnet não resolver.' },
  { id: 'claude-haiku-4-5-20251001', nome: 'Haiku 4.5', hint: 'O mais barato e rápido, para erros simples.' },
];

const INSTRUCOES = `Você é um assistente de manutenção de um painel local de automação de Instagram Reels.
Stack: Node.js + Express + Prisma/SQLite no servidor, React 18 + Vite no cliente. ES modules em todo lugar.

Você recebe UM erro que aconteceu de verdade na máquina do usuário, com o stack trace e o
código dos arquivos citados. Sua tarefa é achar a CAUSA e propor a correção mínima.

Regras:

1. Só proponha mudança em arquivo que veio no contexto. Se a causa estiver num arquivo que
   você não recebeu, diga qual arquivo falta em vez de adivinhar o conteúdo dele.
2. A correção deve ser a MENOR possível para resolver a causa. Não reescreva funções inteiras,
   não reorganize código, não mude estilo, não "melhore de passagem".
3. Se o erro NÃO for um defeito de código — falha de rede, o Instagram mudou o HTML, disco
   cheio, arquivo que o usuário apagou —, diga isso claramente e não invente um patch.
4. Comentários e mensagens ao usuário em português do Brasil, no mesmo tom do código existente:
   explique POR QUE, não o que a linha faz.
5. O campo trechoAntigo precisa ser uma cópia EXATA e ÚNICA do arquivo atual, incluindo indentação.
   Ele será usado para localizar onde substituir; se não bater exatamente, a correção é recusada.

Responda SÓ com JSON válido, sem cercas de markdown, neste formato:

{
  "causa": "uma frase dizendo o que de fato causou o erro",
  "ehBugDeCodigo": true,
  "confianca": "alta" | "media" | "baixa",
  "explicacao": "2 a 4 frases: por que acontece e por que a correção resolve",
  "correcoes": [
    { "arquivo": "server/x.js", "trechoAntigo": "...", "trechoNovo": "...", "porque": "..." }
  ],
  "seNaoForCodigo": "o que o usuário deve fazer, quando ehBugDeCodigo for false"
}`;

/** A chave: variável de ambiente tem prioridade sobre a salva no painel. */
export async function chave() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  return s?.assistantApiKey || null;
}

export async function configurado() {
  return !!(await chave());
}

/**
 * Manda o erro e devolve a análise já em objeto.
 *
 * @param {object} args
 * @param {string} args.prompt   o erro montado por index.js
 * @param {string} [args.modelo]
 */
export async function analisar({ prompt, modelo = 'claude-sonnet-5' }) {
  const apiKey = await chave();
  if (!apiKey) {
    throw new ValidationError(
      'Nenhuma chave da API configurada. Coloque em Configurações, ou em ANTHROPIC_API_KEY no arquivo .env.',
    );
  }

  let resposta;
  try {
    resposta = await fetch(URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': VERSAO_API,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: modelo,
        max_tokens: 4096,
        system: INSTRUCOES,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // Sem rede, DNS, timeout: vira mensagem acionável em vez de stack cru.
    throw new ValidationError(
      err.name === 'TimeoutError'
        ? 'A API do Claude não respondeu a tempo. Tente de novo.'
        : `Não foi possível falar com a API do Claude: ${err.message}`,
    );
  }

  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => '');
    let detalhe = corpo.slice(0, 300);
    try { detalhe = JSON.parse(corpo)?.error?.message ?? detalhe; } catch { /* texto puro */ }

    // Os três erros que o usuário realmente encontra, com o que fazer.
    if (resposta.status === 401) throw new ValidationError('Chave da API inválida ou revogada.');
    if (resposta.status === 429) throw new ValidationError('Limite de uso atingido na API. Espere um pouco e tente de novo.');
    if (resposta.status === 400 && /credit|balance/i.test(detalhe)) {
      throw new ValidationError('Sua conta da API está sem créditos.');
    }
    throw new ValidationError(`A API respondeu ${resposta.status}: ${detalhe}`);
  }

  const dados = await resposta.json();
  const texto = (dados.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  return {
    analise: extrairJson(texto),
    uso: dados.usage ?? null,
    modelo: dados.model ?? modelo,
  };
}

/**
 * Tira o JSON da resposta.
 *
 * Pedir "só JSON" quase sempre funciona, mas às vezes vem embrulhado em cerca
 * de markdown ou com uma frase antes. Recusar a resposta inteira por isso
 * desperdiçaria uma chamada paga que já trouxe a informação certa.
 */
export function extrairJson(texto) {
  const semCerca = texto.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  try {
    return JSON.parse(semCerca);
  } catch { /* tenta achar o objeto no meio do texto */ }

  const inicio = semCerca.indexOf('{');
  const fim = semCerca.lastIndexOf('}');
  if (inicio >= 0 && fim > inicio) {
    try {
      return JSON.parse(semCerca.slice(inicio, fim + 1));
    } catch { /* desiste abaixo */ }
  }

  throw new ValidationError('O Claude respondeu num formato inesperado. Tente analisar de novo.');
}
