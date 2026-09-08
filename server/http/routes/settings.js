import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { wrap } from '../middleware/errors.js';
import multer from 'multer';
import { config } from '../../config/env.js';
import * as storage from '../../core/storage.js';
import * as covers from '../../core/queue/covers.js';
import { ValidationError } from '../../lib/errors.js';
import * as v from '../../lib/validate.js';
import * as notify from '../../core/notify.js';
import * as backup from '../../core/backup.js';

const router = Router();
const coverUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.limits.coverBytes } });

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
  if (req.body.blockDuplicateContent !== undefined) {
    data.blockDuplicateContent = v.bool(req.body.blockDuplicateContent, { field: 'Bloquear conteúdo repetido' });
  }
  if (req.body.defaultCaption !== undefined) {
    data.defaultCaption = v.str(req.body.defaultCaption, { field: 'Legenda padrão', min: 0, max: 2200 }) || null;
  }
  // --- avisos ---
  // String vazia = desligar. Sem isso não haveria como remover um token.
  for (const campo of ['telegramBotToken', 'telegramChatId', 'webhookUrl']) {
    if (req.body[campo] !== undefined) {
      data[campo] = v.str(req.body[campo], { field: campo, min: 0, max: 500 }) || null;
    }
  }
  if (data.webhookUrl && !/^https?:\/\//i.test(data.webhookUrl)) {
    throw new ValidationError('A URL do webhook precisa começar com http:// ou https://');
  }
  if (req.body.notifyOnSuccess !== undefined) {
    data.notifyOnSuccess = v.bool(req.body.notifyOnSuccess, { field: 'Avisar em sucesso' });
  }

  if (req.body.autoCleanCache !== undefined) {
    data.autoCleanCache = v.bool(req.body.autoCleanCache, { field: 'Limpeza automática' });
  }
  if (req.body.autoCleanEveryHours !== undefined) {
    data.autoCleanEveryHours = v.int(req.body.autoCleanEveryHours, { field: 'Intervalo de limpeza', min: 1, max: 720 });
  }

  res.json(await prisma.settings.update({ where: { id: 1 }, data }));
}));

/**
 * GET /backup — baixa a configuração inteira como JSON.
 *
 * Content-Disposition faz o navegador salvar em vez de exibir: um JSON de
 * várias centenas de KB aberto numa aba não serve de backup para ninguém.
 */
router.get('/backup', wrap(async (req, res) => {
  const dados = await backup.exportar();
  const nome = `reels-manager-${new Date().toISOString().slice(0, 10)}.json`;

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  res.send(JSON.stringify(dados, null, 2));
}));

/** POST /backup/restore — restaura. `modo: "replace"` apaga tudo antes. */
router.post('/backup/restore', wrap(async (req, res) => {
  const modo = req.body.modo === 'replace' ? 'replace' : 'merge';
  res.json(await backup.restaurar(req.body.backup, { modo }));
}));

/** POST /notify/test — manda uma mensagem de verdade para o destino salvo. */
router.post('/notify/test', wrap(async (req, res) => {
  res.json(await notify.testar());
}));

/** Uso de disco por pasta, com o rótulo e o aviso de cada uma. */
router.get('/storage', wrap((req, res) => {
  res.json({
    ...storage.usage(),
    meta: Object.fromEntries(
      Object.entries(storage.PASTAS).map(([k, p]) => [k, { label: p.label, aviso: p.aviso }]),
    ),
  });
}));

router.post('/storage/clear/:folder', wrap(async (req, res) => {
  const r = await storage.clearFolder(req.params.folder);
  res.json({ ...r, storage: storage.usage() });
}));

router.post('/storage/clear-all', wrap(async (req, res) => {
  const results = await storage.clearAll();
  res.json({ results, storage: storage.usage() });
}));

// ---------- capa padrão ----------

router.post('/default-cover', coverUpload.single('cover'), wrap(async (req, res) => {
  const atual = await prisma.settings.findUnique({ where: { id: 1 } });
  const filename = covers.save(req.file);

  const settings = await prisma.settings.update({
    where: { id: 1 },
    data: { defaultCoverPath: filename, useDefaultCover: true },
  });

  if (atual?.defaultCoverPath && atual.defaultCoverPath !== filename) {
    await covers.cleanupIfOrphan(atual.defaultCoverPath);
  }
  res.json(settings);
}));

router.delete('/default-cover', wrap(async (req, res) => {
  const atual = await prisma.settings.findUnique({ where: { id: 1 } });
  const settings = await prisma.settings.update({
    where: { id: 1 },
    data: { defaultCoverPath: null, useDefaultCover: false },
  });
  if (atual?.defaultCoverPath) await covers.cleanupIfOrphan(atual.defaultCoverPath);
  res.json(settings);
}));

export default router;
