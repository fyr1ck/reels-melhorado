import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { wrap } from '../middleware/errors.js';
import { config } from '../../config/env.js';
import { dirSize } from '../../lib/files.js';
import * as v from '../../lib/validate.js';

const router = Router();

router.get('/', wrap(async (req, res) => {
  res.json(await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }));
}));

router.patch('/', wrap(async (req, res) => {
  const data = {};
  if (req.body.keepBrowserOpen !== undefined) {
    data.keepBrowserOpen = v.bool(req.body.keepBrowserOpen, { field: 'Manter navegador aberto' });
  }
  if (req.body.useDefaultCover !== undefined) {
    data.useDefaultCover = v.bool(req.body.useDefaultCover, { field: 'Usar capa padrão' });
  }
  if (req.body.autoCleanCache !== undefined) {
    data.autoCleanCache = v.bool(req.body.autoCleanCache, { field: 'Limpeza automática' });
  }
  if (req.body.autoCleanEveryHours !== undefined) {
    data.autoCleanEveryHours = v.int(req.body.autoCleanEveryHours, { field: 'Intervalo de limpeza', min: 1, max: 720 });
  }

  res.json(await prisma.settings.update({ where: { id: 1 }, data }));
}));

/** Uso de disco por pasta. */
router.get('/storage', wrap((req, res) => {
  const p = config.paths;
  const folders = {
    pending: dirSize(p.pending),
    published: dirSize(p.published),
    failed: dirSize(p.failed),
    covers: dirSize(p.covers),
    editorSource: dirSize(p.editorSource),
    editorOutput: dirSize(p.editorOutput),
    editorAssets: dirSize(p.editorAssets),
    editorTmp: dirSize(p.editorTmp),
  };
  res.json({ folders, total: Object.values(folders).reduce((a, b) => a + b, 0) });
}));

export default router;
