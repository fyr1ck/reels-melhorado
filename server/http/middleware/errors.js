import { AppError } from '../../lib/errors.js';
import * as logger from '../../core/log.js';
import * as assistant from '../../core/assistant/index.js';

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

  // Erros do multer chegam aqui em inglês e sem contexto nenhum. O pior é
  // LIMIT_UNEXPECTED_FILE: ele é o que o multer devolve quando passa do número
  // máximo de arquivos, e a mensagem crua — "Unexpected field" — não diz nem
  // que o problema foi a quantidade. Quem enviou 150 vídeos de uma vez ficava
  // sem pista nenhuma do que fazer.
  const upload = {
    LIMIT_UNEXPECTED_FILE: 'Arquivos demais de uma vez, ou um campo de arquivo inesperado. '
      + 'Envie em lotes menores.',
    LIMIT_FILE_SIZE: 'Arquivo grande demais para o limite configurado.',
    LIMIT_FILE_COUNT: 'Arquivos demais de uma vez. Envie em lotes menores.',
    LIMIT_PART_COUNT: 'Partes demais no envio. Envie em lotes menores.',
  };
  if (upload[err?.code]) {
    return res.status(400).json({ error: upload[err.code], code: err.code });
  }

  logger.error({ action: 'ERRO_NAO_TRATADO', message: `${req.method} ${req.path}: ${err.message}` });
  console.error(err);

  // Só o que chegou aqui é candidato a defeito de código: erros tipados
  // (validação, não encontrado) são o app funcionando como deveria.
  assistant.registrarSeLigado({
    origem: 'ROTA',
    mensagem: err.message,
    stack: err.stack ?? '',
    contexto: { metodo: req.method, rota: req.path },
  });
  res.status(500).json({ error: 'Erro interno. Veja os logs do servidor.', code: 'INTERNO' });
}
