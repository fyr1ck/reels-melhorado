import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { wrap } from '../middleware/errors.js';
import * as watch from '../../core/watch/watch.js';
import * as accounts from '../../core/accounts/accounts.js';
import { MEDIA_TYPES, IMPORT_MODES, MEDIA, IMPORT_MODE } from '../../lib/enums.js';
import { NotFoundError } from '../../lib/errors.js';
import * as v from '../../lib/validate.js';

const router = Router();

router.get('/', wrap(async (req, res) => {
  const where = req.query.accountId ? { accountId: req.query.accountId } : {};
  const folders = await prisma.watchFolder.findMany({ where, orderBy: { createdAt: 'asc' } });
  res.json(await Promise.all(folders.map(async (f) => ({ ...f, ...(await watch.folderStats(f)) }))));
}));

router.post('/', wrap(async (req, res) => {
  const account = await accounts.resolve(req.body.accountId);
  const folder = await prisma.watchFolder.create({
    data: {
      accountId: account.id,
      path: watch.validatePath(req.body.path),
      label: v.optional(req.body.label, v.str, { field: 'Apelido', min: 0, max: 60 }) || null,
      mode: req.body.mode ? v.oneOf(req.body.mode, IMPORT_MODES, { field: 'Modo' }) : IMPORT_MODE.COPY,
      mediaType: req.body.mediaType ? v.oneOf(req.body.mediaType, MEDIA_TYPES, { field: 'Tipo' }) : MEDIA.REEL,
      autoCaption: req.body.autoCaption === undefined ? false : v.bool(req.body.autoCaption, { field: 'Legenda automática' }),
    },
  });
  res.status(201).json(folder);
}));

router.patch('/:id', wrap(async (req, res) => {
  const data = {};
  if (req.body.enabled !== undefined) data.enabled = v.bool(req.body.enabled, { field: 'Ativa' });
  if (req.body.label !== undefined) data.label = v.str(req.body.label, { field: 'Apelido', min: 0, max: 60 }) || null;
  if (req.body.mode !== undefined) data.mode = v.oneOf(req.body.mode, IMPORT_MODES, { field: 'Modo' });
  if (req.body.autoCaption !== undefined) data.autoCaption = v.bool(req.body.autoCaption, { field: 'Legenda automática' });
  res.json(await prisma.watchFolder.update({ where: { id: req.params.id }, data }));
}));

/** Para de monitorar. Não apaga nada na origem nem os vídeos já importados. */
router.delete('/:id', wrap(async (req, res) => {
  await prisma.watchFolder.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

router.post('/scan', wrap(async (req, res) => res.json(await watch.scanAll())));

router.post('/:id/scan', wrap(async (req, res) => {
  const folder = await prisma.watchFolder.findUnique({ where: { id: req.params.id } });
  if (!folder) throw new NotFoundError('Pasta não encontrada.');
  res.json(await watch.scanFolder(folder));
}));

/**
 * Esquece o histórico de importação da pasta, para tudo entrar de novo.
 *
 * A deduplicação é permanente por desenho — senão a varredura seguinte
 * desfaria qualquer remoção que o usuário fizesse na fila. O efeito colateral
 * é que um arquivo removido fica ignorado para sempre; esta rota é a saída.
 */
router.post('/:id/reset', wrap(async (req, res) => {
  const folder = await prisma.watchFolder.findUnique({ where: { id: req.params.id } });
  if (!folder) throw new NotFoundError('Pasta não encontrada.');

  const { count } = await prisma.importedFile.deleteMany({ where: { watchFolderId: folder.id } });
  await prisma.watchFolder.update({ where: { id: folder.id }, data: { importedCount: 0 } });
  res.json({ ok: true, forgotten: count });
}));

export default router;
