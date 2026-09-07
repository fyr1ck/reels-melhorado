import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import './toast.css';

const Ctx = createContext(null);
let seq = 0;

const ICON = { success: CheckCircle2, warn: AlertTriangle, error: XCircle, info: Info };

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    setItems((list) => list.filter((t) => t.id !== id));
    clearTimeout(timers.current[id]);
    delete timers.current[id];
  }, []);

  const push = useCallback((tone, message, ms) => {
    const id = ++seq;
    setItems((list) => [...list, { id, tone, message }]);
    // Erro fica mais tempo: costuma trazer texto que precisa ser lido.
    timers.current[id] = setTimeout(() => dismiss(id), ms ?? (tone === 'error' ? 7000 : 4000));
  }, [dismiss]);

  const toast = useMemo(() => ({
    success: (m, ms) => push('success', m, ms),
    error: (m, ms) => push('error', m, ms),
    warn: (m, ms) => push('warn', m, ms),
    info: (m, ms) => push('info', m, ms),
  }), [push]);

  return (
    <Ctx.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => {
          const Icon = ICON[t.tone];
          return (
            <div key={t.id} className={`toast toast--${t.tone}`}>
              <Icon size={16} />
              <span>{t.message}</span>
              <button onClick={() => dismiss(t.id)} aria-label="Fechar"><X size={14} /></button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast precisa estar dentro de <ToastProvider>.');
  return ctx;
}
