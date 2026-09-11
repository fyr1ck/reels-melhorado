import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Raiz do projeto, deduzida da localização deste arquivo.
 *
 * `process.cwd()` mudaria conforme de onde o app foi iniciado, e o
 * assistente precisa de um limite CONFIÁVEL para decidir o que pode ler e
 * escrever — uma raiz errada abriria o disco inteiro.
 */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * O .env vem da RAIZ, não do diretório de onde o comando foi chamado.
 *
 * `import 'dotenv/config'` procura em `process.cwd()`. Iniciar o servidor de
 * dentro de outra pasta fazia o arquivo não ser encontrado — e o efeito era
 * invisível: nenhum erro, só os padrões silenciosamente no lugar da
 * configuração. O sintoma real foi a API subir numa porta diferente da que o
 * proxy do front procura, com o painel abrindo e nenhuma chamada respondendo.
 */
dotenv.config({ path: path.join(RAIZ, '.env') });

/**
 * Configuração num lugar só, lida uma vez na subida.
 *
 * Antes cada módulo fazia seu próprio `parseInt(process.env.X || '...')`, o
 * que espalhava valores padrão divergentes pelo código e tornava impossível
 * saber a configuração efetiva sem caçar em sete arquivos.
 */
function num(name, fallback, { min = 1 } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) {
    console.warn(`⚠ ${name}="${raw}" é inválido; usando ${fallback}.`);
    return fallback;
  }
  return Math.round(n);
}

/**
 * Caminho relativo conta a partir da RAIZ, não do cwd.
 *
 * Mesmo motivo do .env: `path.resolve('./videos')` dava uma pasta diferente
 * conforme de onde o processo tivesse sido iniciado, e o app passaria a
 * procurar os vídeos num lugar onde eles não estão. Caminho absoluto no .env
 * continua valendo como está.
 */
const VIDEOS_DIR = path.resolve(RAIZ, process.env.VIDEOS_DIR || './videos');

export const config = {
  raiz: RAIZ,
  port: num('PORT', 3001),
  env: process.env.NODE_ENV || 'development',

  /** Navegador invisível. Padrão false: é preciso ver a janela para resolver CAPTCHA. */
  headless: process.env.HEADLESS === 'true',

  /** De quanto em quanto tempo o agendador procura publicação vencida. */
  schedulerTickMs: num('SCHEDULER_TICK_MS', 15_000, { min: 1000 }),
  /** Tentativas por vídeo antes de mover para /failed e pausar a conta. */
  maxAttempts: num('MAX_ATTEMPTS', 3),
  /** Quantos dias de agendamento gerar à frente. */
  scheduleDaysAhead: num('SCHEDULE_DAYS_AHEAD', 14),

  /** Intervalo entre varreduras das pastas monitoradas. */
  watchScanMs: num('WATCH_SCAN_MS', 120_000, { min: 5000 }),
  /**
   * Quanto tempo um arquivo precisa ficar parado antes de ser importado.
   * Sincronizadores de nuvem criam o arquivo com o tamanho final antes de
   * terminar de baixá-lo; importar nesse instante geraria um vídeo truncado.
   */
  watchSettleMs: num('WATCH_SETTLE_MS', 15_000, { min: 1000 }),

  paths: {
    videos: VIDEOS_DIR,
    pending: path.join(VIDEOS_DIR, 'pending'),
    published: path.join(VIDEOS_DIR, 'published'),
    failed: path.join(VIDEOS_DIR, 'failed'),
    covers: path.join(VIDEOS_DIR, 'covers'),
    editorSource: path.join(VIDEOS_DIR, 'editor-source'),
    editorOutput: path.join(VIDEOS_DIR, 'editor-output'),
    editorAssets: path.join(VIDEOS_DIR, 'editor-assets'),
    editorTmp: path.join(VIDEOS_DIR, 'editor-tmp'),
    sessions: path.resolve(process.env.SESSION_DIR || './playwright/session'),
    /** Onde o banco e os arquivos de estado do app moram. */
    data: path.join(RAIZ, 'prisma', 'data'),
  },

  limits: {
    uploadBytes: num('MAX_UPLOAD_MB', 500) * 1024 * 1024,
    coverBytes: 8 * 1024 * 1024,
    hashtags: 30, // limite do próprio Instagram
  },
};
