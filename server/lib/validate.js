import { ValidationError } from './errors.js';

/**
 * Validadores de entrada.
 *
 * Todos seguem a mesma regra: `undefined` passa direto e devolve `undefined`.
 * Isso faz um PATCH parcial nunca sobrescrever o que não veio no corpo — na
 * versão anterior, enviar `{ enabled: true }` zerava silenciosamente os
 * outros campos, porque a rota montava o objeto inteiro a cada chamada.
 *
 * Quem falha lança ValidationError, que o middleware de erro converte em 400
 * com a mensagem original. Nada de "erro interno" para dado mal preenchido.
 */

export function optional(value, validator, ...args) {
  if (value === undefined) return undefined;
  return validator(value, ...args);
}

export function str(value, { field, min = 1, max = 5000, trim = true } = {}) {
  if (typeof value !== 'string') throw new ValidationError(`${field} deve ser texto.`);
  const out = trim ? value.trim() : value;
  if (out.length < min) throw new ValidationError(`${field} não pode ficar vazio.`);
  if (out.length > max) throw new ValidationError(`${field} passa de ${max} caracteres.`);
  return out;
}

export function bool(value, { field } = {}) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new ValidationError(`${field} deve ser verdadeiro ou falso.`);
}

export function int(value, { field, min = -Infinity, max = Infinity } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ValidationError(`${field} deve ser um número.`);
  const r = Math.round(n);
  if (r < min || r > max) {
    throw new ValidationError(`${field} deve ficar entre ${min} e ${max}.`);
  }
  return r;
}

export function oneOf(value, allowed, { field } = {}) {
  if (!allowed.includes(value)) {
    throw new ValidationError(`${field} inválido. Aceito: ${allowed.join(', ')}.`);
  }
  return value;
}

/** "HH:mm" com hora e minuto reais — "99:99" casa no regex mas não existe. */
export function time(value, { field = 'Horário' } = {}) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) {
    throw new ValidationError(`${field} inválido. Use HH:mm.`);
  }
  const [h, m] = value.split(':').map(Number);
  if (h > 23 || m > 59) throw new ValidationError(`${field} não existe: ${value}.`);
  return value;
}

/**
 * @ do Instagram. Aceita com ou sem arroba, em qualquer caixa, e devolve
 * sempre a forma canônica — assim "@Fulano" e "fulano" não viram duas contas.
 */
export function username(value, { field = 'Usuário' } = {}) {
  const raw = str(value, { field, max: 40 }).replace(/^@+/, '').toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(raw)) {
    throw new ValidationError('O @ aceita apenas letras, números, ponto e underline.');
  }
  return raw;
}

export function id(value, { field = 'Identificador' } = {}) {
  return str(value, { field, max: 64 });
}
