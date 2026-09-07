import { AppError } from '../../lib/errors.js';
import * as logger from '../../core/log.js';

/**
 * Envolve um handler async para que rejeições virem `next(err)`.
 * Sem isso, um `await` que falha dentro de rota async derruba a requisição
 * em timeout silencioso em vez de virar resposta — foi assim que o projeto
 * anterior acabou com um try/catch copiado em toda rota.
 */
export const wrap = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

export function notFound(req, res) {
  res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.path}` });
}

/** Converte erro em resposta. Erros tipados trazem o status; o resto é 500. */
export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }

  // Violação de unicidade do Prisma vira 409 com o campo em conflito.
  if (err?.code === 'P2002') {
    const alvo = Array.isArray(err.meta?.target) ? err.meta.target.join(', ') : 'registro';
    return res.status(409).json({ error: `Já existe um registro com esse ${alvo}.`, code: 'DUPLICADO' });
  }
  if (err?.code === 'P2025') {
    return res.status(404).json({ error: 'Registro não encontrado.', code: 'NAO_ENCONTRADO' });
  }

  logger.error({ action: 'ERRO_NAO_TRATADO', message: `${req.method} ${req.path}: ${err.message}` });
  console.error(err);
  res.status(500).json({ error: 'Erro interno. Veja os logs do servidor.', code: 'INTERNO' });
}
