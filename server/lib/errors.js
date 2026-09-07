/**
 * Erros com significado de HTTP, para o núcleo não precisar conhecer Express.
 *
 * Na versão anterior cada rota decidia o status com um try/catch próprio, e o
 * mesmo tipo de falha saía como 400 num lugar e 500 em outro — validação
 * virando "erro interno" escondia o motivo real do usuário.
 */
export class AppError extends Error {
  constructor(message, status = 500, code = 'ERRO') {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

/** Dado inválido enviado pelo cliente. */
export class ValidationError extends AppError {
  constructor(message) {
    super(message, 400, 'VALIDACAO');
  }
}

/** Recurso inexistente. */
export class NotFoundError extends AppError {
  constructor(message = 'Recurso não encontrado.') {
    super(message, 404, 'NAO_ENCONTRADO');
  }
}

/** Pedido válido, mas impossível no estado atual (ex: ativar conta sem sessão). */
export class ConflictError extends AppError {
  constructor(message) {
    super(message, 409, 'CONFLITO');
  }
}

/** Limitação da plataforma, sem conserto do nosso lado. */
export class UnsupportedError extends AppError {
  constructor(message) {
    super(message, 501, 'NAO_SUPORTADO');
  }
}
