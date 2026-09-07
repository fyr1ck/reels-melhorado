/**
 * Cliente HTTP.
 *
 * Sem axios: `fetch` já resolve tudo que o app precisa, e a única coisa que
 * faltava era transformar a resposta de erro do servidor numa Error com a
 * mensagem certa — que é justamente o que `ApiError` faz. Assim toda tela
 * mostra o texto que o backend escreveu, em vez de "Request failed with 400".
 */

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request(method, path, body, opts = {}) {
  const init = { method, headers: {} };

  if (body instanceof FormData) {
    init.body = body; // o browser define o boundary do multipart
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const res = await fetch(`/api${path}`, init);

  if (res.status === 204) return null;

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }

  if (!res.ok) {
    throw new ApiError(data?.error || `Erro ${res.status}`, res.status, data?.code);
  }
  return data;
}

const qs = (params) => {
  const clean = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return clean.length ? `?${new URLSearchParams(clean)}` : '';
};

export const api = {
  get: (path, params) => request('GET', `${path}${qs(params)}`),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
};
