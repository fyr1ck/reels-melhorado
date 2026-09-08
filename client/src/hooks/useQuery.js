import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * Busca dados com estado de carregamento, erro e recarga.
 *
 * No projeto anterior cada tela repetia o mesmo useEffect com try/catch, e
 * quase nenhuma tratava erro — a tela simplesmente ficava em "Carregando…"
 * para sempre quando a API falhava. Centralizar resolve isso de uma vez.
 *
 * `refetchMs` faz polling. O intervalo é limpo no unmount e a resposta de uma
 * requisição obsoleta é descartada (`alive`), senão trocar de tela rápido
 * gravaria dados da tela anterior.
 */
export function useQuery(path, { params, refetchMs, enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const alive = useRef(true);

  // Serializa para o efeito não redisparar a cada render por identidade nova.
  const key = JSON.stringify(params ?? null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!enabled) return;
    if (!quiet) setLoading(true);
    try {
      const result = await api.get(path, JSON.parse(key));
      if (alive.current) { setData(result); setError(null); }
    } catch (err) {
      if (alive.current) setError(err);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [path, key, enabled]);

  useEffect(() => {
    alive.current = true;
    load();

    if (!refetchMs) return () => { alive.current = false; };

    // O polling recarrega em silêncio: piscar o esqueleto a cada 10s seria
    // pior que o dado ficar um instante desatualizado.
    //
    // E ele PARA quando a aba sai de vista. Antes não parava: uma aba
    // esquecida aberta a noite inteira fazia dezenas de milhares de
    // requisições para uma tela que ninguém estava olhando — o Editor sozinho
    // consultava a cada 2 segundos. Ao voltar, recarrega na hora, então o
    // usuário nunca vê dado velho.
    let timer = null;

    const parar = () => { if (timer) { clearInterval(timer); timer = null; } };
    const comecar = () => {
      parar();
      timer = setInterval(() => load({ quiet: true }), refetchMs);
    };

    const aoTrocarVisibilidade = () => {
      if (document.hidden) parar();
      else { load({ quiet: true }); comecar(); }
    };

    if (!document.hidden) comecar();
    document.addEventListener('visibilitychange', aoTrocarVisibilidade);

    return () => {
      alive.current = false;
      parar();
      document.removeEventListener('visibilitychange', aoTrocarVisibilidade);
    };
  }, [load, refetchMs]);

  return { data, error, loading, reload: load };
}

/** Mutação com estado de envio e erro, para os formulários. */
export function useMutation(fn) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = useCallback(async (...args) => {
    setBusy(true);
    setError(null);
    try {
      return await fn(...args);
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setBusy(false);
    }
  }, [fn]);

  return { run, busy, error, clearError: () => setError(null) };
}
