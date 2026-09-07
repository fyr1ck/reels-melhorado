import express from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import { notFound, errorHandler } from './http/middleware/errors.js';

import accounts from './http/routes/accounts.js';
import videos from './http/routes/videos.js';
import slots from './http/routes/slots.js';
import library from './http/routes/library.js';
import watch from './http/routes/watch.js';
import dashboard from './http/routes/dashboard.js';
import publications from './http/routes/publications.js';
import logs from './http/routes/logs.js';
import settings from './http/routes/settings.js';
import editor from './http/routes/editor.js';

/**
 * Monta o app Express. Separado do bootstrap (index.js) de propósito: assim
 * um teste pode montar as rotas sem abrir porta, iniciar agendador nem
 * navegador.
 */
export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (req, res) => res.json({ ok: true, env: config.env }));

  app.use('/api/accounts', accounts);
  app.use('/api/videos', videos);
  app.use('/api/slots', slots);
  app.use('/api/library', library);
  app.use('/api/watch-folders', watch);
  app.use('/api/dashboard', dashboard);
  app.use('/api/publications', publications);
  app.use('/api/logs', logs);
  app.use('/api/settings', settings);
  app.use('/api/editor', editor);

  app.use('/api/covers', express.static(config.paths.covers));

  app.use('/api', notFound);
  app.use(errorHandler);

  return app;
}
