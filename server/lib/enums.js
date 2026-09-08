/**
 * Valores aceitos nos campos de estado. O SQLite não tem enum, então a
 * garantia vem daqui — um lugar só, usado tanto pela validação de entrada
 * quanto pelo código que compara estados.
 */
export const MEDIA = { REEL: 'REEL', STORY: 'STORY' };
export const MEDIA_TYPES = Object.values(MEDIA);

export const VIDEO_STATUS = {
  PENDING: 'PENDING',
  SCHEDULED: 'SCHEDULED',
  PUBLISHING: 'PUBLISHING',
  PUBLISHED: 'PUBLISHED',
  FAILED: 'FAILED',
};
export const VIDEO_STATUSES = Object.values(VIDEO_STATUS);

/** Estados em que o vídeo ainda pode ir ao ar. */
export const OPEN_STATUSES = [VIDEO_STATUS.PENDING, VIDEO_STATUS.SCHEDULED];

export const ACCOUNT_STATUS = {
  PAUSED: 'PAUSED',
  ACTIVE: 'ACTIVE',
  INTERVENTION: 'INTERVENTION',
};
export const ACCOUNT_STATUSES = Object.values(ACCOUNT_STATUS);

export const SCHEDULE_MODE = { TIMES: 'TIMES', INTERVAL: 'INTERVAL', WINDOW: 'WINDOW' };
export const SCHEDULE_MODES = Object.values(SCHEDULE_MODE);

export const IMPORT_MODE = { COPY: 'COPY', MOVE: 'MOVE' };
export const IMPORT_MODES = Object.values(IMPORT_MODE);

export const BATCH_STATUS = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  DONE: 'DONE',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
};

export const LOG_LEVEL = { INFO: 'INFO', SUCCESS: 'SUCCESS', WARN: 'WARN', ERROR: 'ERROR' };
