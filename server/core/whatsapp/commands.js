/**
 * Comandos que chegam pelo WhatsApp.
 *
 * O interpretador é PURO e vive separado da execução: é ele que decide se uma
 * mensagem é um comando, e testar isso não pode exigir banco nem navegador.
 *
 * A lista de comandos é fechada, por decisão de segurança. Nada aqui apaga
 * vídeo, remove conta ou mexe em arquivo — mesmo vindo do número autorizado.
 * Uma mensagem de WhatsApp é fácil demais de mandar por engano, e o telefone
 * pode ser desbloqueado por outra pessoa. Pausar e retomar são reversíveis;
 * apagar não é.
 */

/** Sem acento, minúsculo, sem espaço sobrando. */
export function normalizar(texto = '') {
  return String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Só dígitos, para comparar telefones.
 *
 * O WhatsApp devolve o número em formatos diferentes conforme a tela
 * (+55 16 99444-1788, 5516994441788, com e sem espaço), e comparar string
 * crua faria o número autorizado não bater consigo mesmo.
 */
export const soDigitos = (n = '') => String(n).replace(/\D/g, '');

/**
 * Dois números são a mesma pessoa?
 *
 * No Brasil, celulares ganharam um nono dígito, e o WhatsApp ora inclui, ora
 * não: 5516994441788 e 551694441788 são o mesmo telefone. Comparar só por
 * igualdade exata rejeitaria o dono do número na metade das vezes — e o
 * resultado seria o painel ignorando o próprio usuário sem explicação.
 */
export function mesmoNumero(a, b) {
  const x = soDigitos(a);
  const y = soDigitos(b);
  if (!x || !y) return false;
  if (x === y) return true;

  // Compara pelos últimos 8 dígitos (o número local sem o 9 extra), exigindo
  // que o começo — país e DDD — também bata.
  const finalA = x.slice(-8);
  const finalB = y.slice(-8);
  const inicioA = x.slice(0, 4); // 55 + DDD
  const inicioB = y.slice(0, 4);

  return finalA === finalB && inicioA === inicioB;
}

/**
 * Comandos aceitos.
 *
 * `aliases` casa com a mensagem INTEIRA. `verbos` casa com a primeira palavra,
 * e existe só para os comandos que recebem um nome de conta depois.
 *
 * A separação importa: "oi" precisa abrir o menu, mas "oi, tudo bem?" é
 * conversa, não comando. Casar a primeira palavra de tudo faria uma frase
 * qualquer disparar uma ação.
 */
export const COMANDOS = [
  {
    nome: 'menu',
    aliases: ['menu', 'ajuda', 'comandos', 'help', '?', 'oi', 'ola', 'bom dia', 'boa noite'],
    descricao: 'mostra esta lista',
  },
  {
    nome: 'status',
    aliases: ['status', 'como esta', 'situacao', 'resumo'],
    descricao: 'como está a operação agora',
  },
  {
    nome: 'fila',
    aliases: ['fila', 'videos', 'pendentes'],
    descricao: 'quantos vídeos faltam em cada conta',
  },
  {
    nome: 'proximo',
    aliases: ['proximo', 'proxima', 'agenda', 'quando'],
    descricao: 'qual é a próxima publicação',
  },
  {
    nome: 'pausar',
    aliases: ['pausar', 'pausa', 'parar', 'para', 'stop', 'desligar'],
    verbos: ['pausar', 'pausa', 'parar', 'desligar'],
    descricao: 'para a automação — aceita "pausar @conta"',
  },
  {
    nome: 'ativar',
    aliases: ['ativar', 'ativa', 'retomar', 'voltar', 'ligar', 'start'],
    verbos: ['ativar', 'ativa', 'retomar', 'ligar'],
    descricao: 'religa a automação — aceita "ativar @conta"',
  },
  {
    nome: 'contas',
    aliases: ['contas', 'perfis'],
    descricao: 'estado de cada conta',
  },
  {
    nome: 'erros',
    aliases: ['erros', 'erro', 'falhas', 'problemas'],
    descricao: 'últimas falhas registradas',
  },
];

/**
 * Interpreta uma mensagem.
 *
 * @returns {{comando: string, conta: string|null}|null} null quando não é
 *   comando. Nesse caso nenhuma ação acontece — no máximo uma dica de volta.
 */
export function interpretar(texto) {
  const limpo = normalizar(texto);
  if (!limpo) return null;

  // 1) A mensagem inteira é um comando conhecido?
  for (const c of COMANDOS) {
    if (c.aliases.includes(limpo)) return { comando: c.nome, conta: null };
  }

  // 2) É um verbo seguido de conta? ("pausar @memes")
  const [primeira, ...resto] = limpo.split(' ');
  const argumento = resto.join(' ').replace(/^@/, '').trim();
  if (!argumento) return null;

  for (const c of COMANDOS) {
    if (c.verbos?.includes(primeira)) return { comando: c.nome, conta: argumento };
  }

  return null;
}

/** O texto do menu. Montado da lista, para não sair de sincronia com ela. */
export function textoDoMenu() {
  const linhas = COMANDOS
    .filter((c) => c.nome !== 'menu')
    .map((c) => `• *${c.nome}* — ${c.descricao}`);

  return [
    '*Reels Manager*',
    '',
    'O que dá para fazer daqui:',
    '',
    ...linhas,
    '',
    '_Só este número é atendido. Nada aqui apaga vídeo ou conta — para isso, o painel._',
  ].join('\n');
}
