import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../../config/env.js';

/**
 * Coleta de erros para o assistente.
 *
 * O log de auditoria (core/log.js) guarda o que aconteceu para uma pessoa ler:
 * ação, conta, mensagem. Não guarda STACK TRACE, que é justamente a única
 * coisa que permite apontar o arquivo e a linha. Este módulo guarda o resto.
 *
 * Fica em arquivo, e não só em memória, porque o erro mais importante é
 * exatamente aquele que derrubou o processo — e esse desapareceria junto.
 */

const LIMITE = 50;
const ARQUIVO = () => path.join(config.paths.data ?? 'prisma/data', 'erros.json');

let cache = null;

function carregar() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(ARQUIVO(), 'utf8'));
    if (!Array.isArray(cache)) cache = [];
  } catch {
    cache = []; // primeira execução, ou arquivo corrompido: começa limpo
  }
  return cache;
}

function gravar() {
  try {
    fs.mkdirSync(path.dirname(ARQUIVO()), { recursive: true });
    fs.writeFileSync(ARQUIVO(), JSON.stringify(cache, null, 2));
  } catch {
    // Sem disco, o assistente perde histórico — mas nada mais pode quebrar
    // por causa disso.
  }
}

/**
 * Assinatura estável de um erro.
 *
 * Junta a mensagem SEM números (ids, caminhos, timestamps mudam a cada
 * ocorrência) com a primeira linha própria do stack. Sem isso, o mesmo bug
 * repetido em loop viraria 500 entradas diferentes — e 500 chamadas pagas à
 * API.
 */
export function assinatura(mensagem = '', stack = '') {
  const limpa = String(mensagem)
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<id>')   // uuid
    .replace(/\d+/g, '<n>')
    .slice(0, 200);

  const linha = (stack.split('\n').find((l) => l.includes(config.raiz ?? 'server')) ?? '').trim();
  return crypto.createHash('sha1').update(`${limpa}|${linha}`).digest('hex').slice(0, 12);
}

/**
 * Registra um erro. Repetição não cria entrada nova: incrementa a contagem e
 * atualiza a data — o que interessa é "isto está acontecendo N vezes".
 */
export function registrar({ origem, mensagem, stack = '', contexto = null }) {
  const lista = carregar();
  const sig = assinatura(mensagem, stack);
  const agora = new Date().toISOString();

  const existente = lista.find((e) => e.assinatura === sig);
  if (existente) {
    existente.vezes += 1;
    existente.ultimaEm = agora;
    // Um erro que voltou a acontecer deixa de estar resolvido.
    if (existente.estado === 'RESOLVIDO') existente.estado = 'ABERTO';
    gravar();
    return existente;
  }

  const entrada = {
    id: crypto.randomUUID(),
    assinatura: sig,
    origem,                    // SERVIDOR | ROTA | PAINEL | PUBLICACAO | EDITOR
    mensagem: String(mensagem ?? '').slice(0, 2000),
    stack: String(stack ?? '').slice(0, 6000),
    contexto,
    vezes: 1,
    primeiraEm: agora,
    ultimaEm: agora,
    estado: 'ABERTO',          // ABERTO | ANALISADO | RESOLVIDO | IGNORADO
    analise: null,
  };

  lista.unshift(entrada);
  if (lista.length > LIMITE) lista.length = LIMITE;
  gravar();
  return entrada;
}

export function listar() {
  return carregar();
}

export function buscar(id) {
  return carregar().find((e) => e.id === id) ?? null;
}

export function atualizar(id, campos) {
  const e = buscar(id);
  if (!e) return null;
  Object.assign(e, campos);
  gravar();
  return e;
}

export function limpar({ apenasResolvidos = false } = {}) {
  const antes = carregar().length;
  cache = apenasResolvidos
    ? cache.filter((e) => e.estado !== 'RESOLVIDO')
    : [];
  gravar();
  return { removidos: antes - cache.length };
}
