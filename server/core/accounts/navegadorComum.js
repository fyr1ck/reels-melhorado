import fs from 'fs';
import path from 'path';
import { spawn, execFileSync } from 'child_process';

/**
 * Um navegador COMUM, sem automação, para o login manual.
 *
 * Por que existe: a janela de login aberta pelo Playwright se anuncia como
 * controlada por automação — é assim que o Chromium funciona quando é
 * dirigido por uma ferramenta, e não é algo que este app tenta esconder. O
 * reCAPTCHA do Instagram foi feito para não aceitar esse navegador, mesmo
 * quando quem resolve é uma pessoa: o usuário resolvia, o Google emitia o
 * comprovante (`_GRECAPTCHA`), o Instagram recusava e pedia outro, sem fim.
 *
 * A saída honesta não é disfarçar a automação, e sim não usá-la no login: a
 * pessoa entra pelo Edge ou Chrome instalado, exatamente como entraria em
 * qualquer site, e o app só lê o resultado DEPOIS que a janela é fechada.
 * Nada controla essa janela enquanto ela está aberta.
 */

/**
 * Onde os navegadores costumam estar instalados no Windows.
 *
 * O Brave vem primeiro: é o navegador que o dono deste painel usa no dia a dia
 * e onde o login do Instagram passou sem reCAPTCHA em loop. Chrome e Edge
 * seguem como alternativa para outras máquinas.
 */
export function candidatos(env = process.env) {
  const local = env.LOCALAPPDATA || '';
  const pf = env.ProgramFiles || 'C:\\Program Files';
  const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  return [
    // Caminho definido à mão tem prioridade sobre qualquer suposição.
    env.NAVEGADOR_LOGIN,
    path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    path.join(pf86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    local && path.join(local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    local && path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean);
}

/** O primeiro navegador instalado, ou null. */
export function localizar({ existe = fs.existsSync, env = process.env } = {}) {
  if (process.platform !== 'win32' && !env.NAVEGADOR_LOGIN) return null;
  return candidatos(env).find((p) => existe(p)) ?? null;
}

/**
 * Só os cookies do Instagram.
 *
 * O perfil do navegador comum recebe cookies de tudo que ele toca ao abrir — o
 * Edge, por exemplo, grava `.MSA.Auth` da conta Microsoft e cookies do Bing. O
 * arquivo de sessão é lido pela automação a cada publicação; nada que não seja
 * do Instagram tem por que estar nele.
 */
export function cookiesDoInstagram(cookies) {
  return (cookies ?? []).filter((c) => {
    const dominio = String(c.domain ?? '').replace(/^\./, '').toLowerCase();
    return dominio === 'instagram.com' || dominio.endsWith('.instagram.com');
  });
}

/**
 * Quantos processos do navegador estão usando ESTE perfil.
 *
 * Não dá para acompanhar pelo PID do processo iniciado: o Edge relança a si
 * mesmo logo ao abrir e o processo original some em segundos. A pasta do
 * perfil, que vai na linha de comando de todos os processos daquela janela, é
 * o que identifica a sessão — e não confunde com o navegador que a pessoa já
 * usa no dia a dia, que tem outro perfil.
 */
export function processosDoPerfil(marca) {
  // Aspas simples no filtro do PowerShell: a marca é o id da conta (uuid),
  // sem caractere que precise de escape.
  const script = 'Get-CimInstance Win32_Process | '
    + `Where-Object { $_.CommandLine -like '*${marca}*' -and ($_.Name -in 'brave.exe','chrome.exe','msedge.exe') } | `
    + 'Measure-Object | Select-Object -ExpandProperty Count';

  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', script], {
      encoding: 'utf8', windowsHide: true, timeout: 20_000,
    });
    return Number.parseInt(out.trim(), 10) || 0;
  } catch {
    // -1 é "não sei", e quem chama decide o que isso significa em cada ponto:
    // na espera vale como "ainda aberto" (ler um perfil em uso perderia os
    // cookies mais recentes); na checagem inicial não pode valer como "já
    // aberto", senão uma falha do PowerShell trancaria o login para sempre.
    return -1;
  }
}

/**
 * Abre o navegador comum na tela de login.
 *
 * `--disable-background-mode` é o que faz fechar a janela encerrar o
 * navegador de verdade. Sem ele o Edge continua rodando escondido, o perfil
 * fica travado, e a leitura dos cookies falha com o código 21 do Chromium
 * ("perfil em uso por outro processo") — medido antes de escrever isto.
 */
export function abrir(executavel, perfil, url) {
  fs.mkdirSync(perfil, { recursive: true });

  const filho = spawn(executavel, [
    `--user-data-dir=${perfil}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-mode',
    url,
  ], { detached: true, stdio: 'ignore', windowsHide: false });

  filho.unref();
  return filho;
}
