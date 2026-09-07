import { createContext, useCallback, useContext, useState } from 'react';
import { Button } from '../design/ui.jsx';
import './confirm.css';

const Ctx = createContext(null);

/**
 * Diálogo de confirmação como promise.
 *
 * O `confirm()` nativo trava a aba inteira e não permite explicar direito o
 * que vai acontecer. Toda ação destrutiva aqui diz exatamente o que se perde —
 * foi assim que um "Resetar dashboard" apagou vídeos do disco no projeto
 * anterior, porque o rótulo prometia menos do que a ação fazia.
 */
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);

  const confirm = useCallback((options) => new Promise((resolve) => {
    setState({
      title: options?.title ?? 'Confirmar',
      description: options?.description ?? '',
      confirmLabel: options?.confirmLabel ?? 'Confirmar',
      cancelLabel: options?.cancelLabel ?? 'Cancelar',
      danger: !!options?.danger,
      resolve,
    });
  }), []);

  const close = (result) => {
    state?.resolve(result);
    setState(null);
  };

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {state && (
        <div className="cf-overlay" role="alertdialog" aria-modal="true" onClick={() => close(false)}>
          <div className="cf-box" onClick={(e) => e.stopPropagation()}>
            <h3>{state.title}</h3>
            {state.description && <p>{state.description}</p>}
            <div className="cf-actions">
              <Button onClick={() => close(false)}>{state.cancelLabel}</Button>
              <Button variant={state.danger ? 'danger' : 'primary'} autoFocus onClick={() => close(true)}>
                {state.confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useConfirm precisa estar dentro de <ConfirmProvider>.');
  return ctx;
}
