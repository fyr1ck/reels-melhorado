import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';

const Ctx = createContext(null);
const KEY = 'rm.account';

/**
 * Conta selecionada, compartilhada por todas as telas.
 *
 * A escolha sobrevive ao reload via localStorage, mas só vale se a conta ainda
 * existir na lista do servidor — uma conta removida em outra aba não pode
 * deixar a interface presa numa seleção inválida.
 */
export function AccountProvider({ children }) {
  const [accounts, setAccounts] = useState([]);
  const [selectedId, setSelectedId] = useState(() => localStorage.getItem(KEY));
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const list = await api.get('/accounts');
      setAccounts(list);
      setSelectedId((current) => {
        if (current && list.some((a) => a.id === current)) return current;
        return (list.find((a) => a.isDefault) || list[0])?.id ?? null;
      });
    } catch {
      /* a tela de Contas mostra o erro; aqui o silêncio evita ruído global */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const timer = setInterval(reload, 20000);
    return () => clearInterval(timer);
  }, [reload]);

  useEffect(() => {
    if (selectedId) localStorage.setItem(KEY, selectedId);
  }, [selectedId]);

  const value = useMemo(() => ({
    accounts,
    loading,
    accountId: selectedId,
    account: accounts.find((a) => a.id === selectedId) ?? null,
    select: setSelectedId,
    reload,
  }), [accounts, loading, selectedId, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAccount() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAccount precisa estar dentro de <AccountProvider>.');
  return ctx;
}
