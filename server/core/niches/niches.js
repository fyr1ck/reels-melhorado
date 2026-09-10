import { prisma } from '../../db/prisma.js';
import { ValidationError, NotFoundError, ConflictError } from '../../lib/errors.js';
import * as v from '../../lib/validate.js';

/**
 * Nichos: cadastro e vínculo com as contas que já existem.
 *
 * Nada aqui cria conta, fila ou publicação. Um nicho é só uma DEFINIÇÃO —
 * palavras, temas e regras que o usuário escreveu — e um vínculo é só uma
 * linha dizendo que determinada conta publica aquele assunto.
 *
 * Não há nicho embutido no código. "Emagrecimento", "Religião" ou "Cortes de
 * Podcast" são linhas desta tabela; adicionar um nicho novo nunca exige
 * mexer no código.
 */

export const RIGORES = ['BAIXO', 'MEDIO', 'ALTO'];

/**
 * Quebra uma lista escrita à mão em itens.
 *
 * Aceita vírgula, ponto e vírgula e quebra de linha porque é assim que as
 * pessoas realmente digitam — exigir um separador só transformaria erro de
 * digitação em nicho que não casa com nada.
 */
export function listaDe(texto) {
  return String(texto ?? '')
    .split(/[\n,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Uma regra por linha. Vírgula NÃO separa: regra é frase e frase tem vírgula. */
export function regrasDe(texto) {
  return String(texto ?? '')
    .split(/\n+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

const CAMPOS_TEXTO = [
  'subniches', 'keywords', 'bannedKeywords',
  'allowedThemes', 'bannedThemes', 'customRules',
];

/** Valida e normaliza o corpo vindo do painel. */
function saneia(body, { parcial = false } = {}) {
  const data = {};

  if (body.name !== undefined || !parcial) {
    data.name = v.str(body.name, { field: 'Nome do nicho', min: 2, max: 60 });
  }
  if (body.description !== undefined) {
    data.description = v.optional(body.description, v.str, { field: 'Descrição', min: 0, max: 500 }) || null;
  }
  if (body.category !== undefined) {
    data.category = v.optional(body.category, v.str, { field: 'Categoria', min: 0, max: 60 }) || null;
  }
  if (body.audience !== undefined) {
    data.audience = v.optional(body.audience, v.str, { field: 'Público-alvo', min: 0, max: 200 }) || null;
  }
  if (body.tone !== undefined) {
    data.tone = v.optional(body.tone, v.str, { field: 'Tom de comunicação', min: 0, max: 200 }) || null;
  }

  for (const campo of CAMPOS_TEXTO) {
    if (body[campo] !== undefined) {
      data[campo] = String(body[campo] ?? '').slice(0, 4000);
    }
  }

  if (body.priority !== undefined) {
    data.priority = v.int(body.priority, { field: 'Prioridade', min: 0, max: 100 });
  }
  if (body.strictness !== undefined) {
    data.strictness = v.oneOf(body.strictness, RIGORES, { field: 'Nível de rigor' });
  }
  if (body.active !== undefined) data.active = !!body.active;

  return data;
}

export async function listar({ apenasAtivos = false } = {}) {
  return prisma.niche.findMany({
    where: apenasAtivos ? { active: true } : {},
    orderBy: [{ priority: 'desc' }, { name: 'asc' }],
    include: {
      accounts: { include: { account: { select: { id: true, username: true, label: true } } } },
      _count: { select: { classifications: true } },
    },
  });
}

export async function obter(id) {
  const niche = await prisma.niche.findUnique({
    where: { id },
    include: { accounts: { include: { account: { select: { id: true, username: true } } } } },
  });
  if (!niche) throw new NotFoundError('Nicho não encontrado.');
  return niche;
}

export async function criar(body) {
  const data = saneia(body);

  const existe = await prisma.niche.findUnique({ where: { name: data.name } });
  if (existe) throw new ConflictError(`Já existe um nicho chamado "${data.name}".`);

  return prisma.niche.create({ data });
}

export async function atualizar(id, body) {
  await obter(id);
  const data = saneia(body, { parcial: true });

  if (data.name) {
    const outro = await prisma.niche.findUnique({ where: { name: data.name } });
    if (outro && outro.id !== id) throw new ConflictError(`Já existe um nicho chamado "${data.name}".`);
  }

  return prisma.niche.update({ where: { id }, data });
}

/**
 * Duplica um nicho.
 *
 * Serve para variações do mesmo tema — "Emagrecimento" e "Emagrecimento
 * Masculino" compartilham quase tudo. O vínculo com contas NÃO é copiado: a
 * cópia nasce sem conta de propósito, senão duplicar um nicho começaria a
 * classificar conteúdo para contas que ninguém escolheu.
 */
export async function duplicar(id) {
  const origem = await obter(id);

  let nome = `${origem.name} (cópia)`;
  for (let i = 2; await prisma.niche.findUnique({ where: { name: nome } }); i++) {
    nome = `${origem.name} (cópia ${i})`;
  }

  const { id: _id, createdAt, updatedAt, accounts, ...resto } = origem;
  return prisma.niche.create({ data: { ...resto, name: nome, active: false } });
}

export async function remover(id) {
  await obter(id);
  // As classificações apontam para cá com onDelete: SetNull — elas sobrevivem
  // sem o nicho, viram SEM_CLASSIFICACAO na leitura, e nenhum vídeo some da
  // fila por causa disso.
  await prisma.niche.delete({ where: { id } });
}

// ------------------------------------------------------------------
// Vínculo com as contas EXISTENTES
// ------------------------------------------------------------------

/** Os nichos de uma conta, principal primeiro. */
export async function daConta(accountId) {
  return prisma.accountNiche.findMany({
    where: { accountId },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    include: { niche: true },
  });
}

/**
 * Define os nichos de uma conta de uma vez.
 *
 * Substituir o conjunto inteiro (em vez de adicionar/remover um a um) deixa a
 * tela simples: ela manda o que deve valer, e o servidor faz bater. O
 * principal é opcional — conta sem principal continua funcionando, só não
 * recebe recomendação automática.
 */
export async function definirDaConta(accountId, { primaryNicheId = null, secondaryNicheIds = [] } = {}) {
  const conta = await prisma.account.findUnique({ where: { id: accountId } });
  if (!conta) throw new NotFoundError('Conta não encontrada.');

  const ids = [...new Set([primaryNicheId, ...secondaryNicheIds].filter(Boolean))];

  if (ids.length) {
    const achados = await prisma.niche.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (achados.length !== ids.length) {
      throw new ValidationError('Um dos nichos escolhidos não existe mais. Recarregue a tela.');
    }
  }

  await prisma.accountNiche.deleteMany({ where: { accountId } });

  if (ids.length) {
    await prisma.accountNiche.createMany({
      data: ids.map((nicheId) => ({ accountId, nicheId, isPrimary: nicheId === primaryNicheId })),
    });
  }

  return daConta(accountId);
}

/** Contas que publicam determinado nicho, com o peso do vínculo. */
export async function contasDoNicho(nicheId) {
  return prisma.accountNiche.findMany({
    where: { nicheId },
    include: { account: true },
    orderBy: { isPrimary: 'desc' },
  });
}
