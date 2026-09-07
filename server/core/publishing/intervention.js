/**
 * Gerencia pausas para intervenção humana (CAPTCHA, 2FA, checkpoints de
 * segurança do Instagram). Quando a automação detecta que precisa de ajuda
 * humana, ela chama requestIntervention() e fica bloqueada até que o usuário
 * resolva manualmente no navegador e confirme pelo painel (resolveIntervention()).
 */
let pendingResolve = null;
let currentMessage = null;

export function isInterventionPending() {
  return pendingResolve !== null;
}

export function getInterventionMessage() {
  return currentMessage;
}

export function requestIntervention(message) {
  currentMessage = message;
  return new Promise((resolve) => {
    pendingResolve = resolve;
  });
}

export function resolveIntervention() {
  if (pendingResolve) {
    const resolve = pendingResolve;
    pendingResolve = null;
    currentMessage = null;
    resolve();
    return true;
  }
  return false;
}
