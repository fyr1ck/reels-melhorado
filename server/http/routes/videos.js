import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../db/prisma.js';
import { config } from '../../config/env.js';
import { wrap } from '../middleware/errors.js';
import { uniqueName, nomeOriginal, ensureDirs, sizeOf } from '../../lib/files.js';
import { probe } from '../../lib/media.js';
import * as accounts from '../../core/accounts/accounts.js';
import { regenerate, comNavegador } from '../../core/scheduling/scheduler.js';
import * as logger from '../../core/log.js';
import { MEDIA, MEDIA_TYPES, VIDEO_STATUSES, VIDEO_STATUS } from '../../lib/enums.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import * as covers from '../../core/queue/covers.js';
import * as duplicates from '../../core/queue/duplicates.js';
import * as distribute from '../../core/queue/distribute.js';
import * as classify from '../../core/niches/classify.js';
import * as nicheGuard from '../../core/niches/guard.js';
import { fingerprint } from '../../lib/fingerprint.js';
import { publishReel } from '../../core/publishing/reel.js';
import * as accountsCore from '../../core/accounts/accounts.js';
import { moveTo } from '../../lib/files.js';
import { ConflictError } from '../../lib/errors.js';
import * as v from '../../lib/validate.js';

ensureDirs();
const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.paths.pending),
    filename: (req, file, cb) => cb(null, uniqueName(nomeOriginal(file.originalname))),
  }),
  fileFilter: (req, file, cb) => {
    // Aceita por mimetype OU por extensão. Confiar só no mimetype rejeitava
    // arquivos legítimos: .mkv e .mov chegam como application/octet-stream em
    // vários navegadores e sistemas, e o usuário via "formato não suportado"
    // para um vídeo perfeitamente válido.
    const porTipo = /^video\/(mp4|quicktime|x-matroska|webm|x-m4v)$/.test(file.mimetype);
    const porExtensao = /\.(mp4|mov|mkv|webm|m4v)$/i.test(nomeOriginal(file.originalname) || '');
    const ok = porTipo || porExtensao;
    cb(ok ? null : new ValidationError(
      `Formato não suportado (${file.mimetype}). Envie MP4, MOV, MKV, WebM ou M4V.`,
    ), ok);
  },
  limits: { fileSize: config.limits.uploadBytes },
});

router.get('/', wrap(async (req, res) => {
  const where = {};
  if (req.query.accountId) where.accountId = req.query.accountId;
  if (req.query.status && req.query.status !== 'ALL') {
    where.status = v.oneOf(req.query.status, VIDEO_STATUSES, { field: 'Status' });
  }
  if (req.query.mediaType && req.query.mediaType !== 'ALL') {
    where.mediaType = v.oneOf(req.query.mediaType, MEDIA_TYPES, { field: 'Tipo' });
  }

  // A classificação vem junto, quando existe.
  //
  // Campo NOVO e opcional na MESMA rota: a fila continua devolvendo tudo o que
  // devolvia, e a tela só desenha a etiqueta de nicho quando o vídeo tem uma.
  // Uma segunda rota só para isso obrigaria a fila a fazer duas chamadas e a
  // casá-las na tela.
  const videos = await prisma.video.findMany({
    where,
    orderBy: { sortOrder: 'asc' },
    include: {
      classification: {
        select: { status: true, score: true, niche: { select: { id: true, name: true } } },
      },
    },
  });

  res.json(videos);
}));

/**
 * POST / — envia vídeos para a fila.
 *
 * Dois modos:
 *
 * - UMA CONTA (`accountId`): tudo vai para a fila dela.
 * - DISTRIBUIR (`accountIds`, 2 ou mais): os arquivos são REPARTIDOS entre as
 *   contas, um vídeo por conta. É o modo certo para quem opera vários perfis
 *   do mesmo nicho: enviar o mesmo lote para cada conta faria as N publicarem
 *   exatamente a mesma coisa.
 *
 * Em ambos, um arquivo cujo conteúdo já está na fila de outra conta é
 * recusado (a menos que o bloqueio esteja desligado nas Configurações).
 */
// 500 e nao 100: a pasta de onde os videos vem costuma ter lotes maiores que
// isso, e o multer sinaliza o estouro com LIMIT_UNEXPECTED_FILE -- cuja
// mensagem crua, "Unexpected field", nao diz nem que o problema foi a
// quantidade. O middleware de erro traduz; o limite maior evita o encontro.
router.post('/', upload.array('videos', 500), wrap(async (req, res) => {
  const files = req.files || [];
  if (!files.length) throw new ValidationError('Nenhum vídeo enviado.');

  const mediaType = req.body.mediaType === MEDIA.STORY ? MEDIA.STORY : MEDIA.REEL;
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });

  // `accountIds` chega como campo repetido do FormData; com um valor só o
  // multer entrega string em vez de array.
  const pedidas = []
    .concat(req.body.accountIds ?? [])
    .filter(Boolean);

  // Modo "por nicho": a conta de cada vídeo sai da classificação, não do
  // seletor nem do rodízio. Fica ANTES dos outros dois porque não depende de
  // quantas contas foram marcadas — ele olha os vínculos conta<->nicho.
  const porNicho = req.body.modo === 'NICHO';

  let destinos;
  if (porNicho) {
    const todas = await prisma.account.findMany({
      where: { enabled: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, username: true },
    });
    if (!todas.length) throw new ValidationError('Nenhuma conta habilitada para receber os vídeos.');
    destinos = todas;
  } else if (pedidas.length > 1) {
    destinos = await distribute.contasValidas(pedidas);
    if (destinos.length < 2) {
      throw new ValidationError('Selecione ao menos duas contas para distribuir.');
    }
  } else {
    const account = await accounts.resolve(pedidas[0] ?? req.body.accountId);
    destinos = [{ id: account.id, username: account.username }];
  }

  const distribuindo = destinos.length > 1;

  // Reparte antes de gravar: assim a atribuição olha a fila como ela está
  // agora, sem contar os vídeos deste mesmo lote duas vezes.
  let plano;
  if (porNicho) {
    // A conta padrão é a do seletor: é para onde vai o que nenhum nicho
    // reconheceu, para o arquivo não se perder.
    const padrao = await accounts.resolve(req.body.accountId);
    plano = await classify.planejarPorNicho(files, {
      contaPadrao: padrao.id,
      nomeDe: (f) => nomeOriginal(f.originalname),
    });
  } else if (distribuindo) {
    plano = distribute.repartir(files, await distribute.cargas(destinos.map((d) => d.id)));
  } else {
    plano = files.map((file) => ({ item: file, accountId: destinos[0].id }));
  }

  const nomePorConta = new Map(destinos.map((d) => [d.id, d.username]));

  // Próxima posição na fila de cada conta, buscada uma vez só.
  const proxima = new Map();
  for (const d of destinos) {
    const last = await prisma.video.findFirst({
      where: { accountId: d.id },
      orderBy: { sortOrder: 'desc' },
    });
    proxima.set(d.id, last ? last.sortOrder + 1 : 0);
  }

  const created = [];
  const skipped = [];
  const tocadas = new Set();

  for (const { item: file, accountId, classificacao } of plano) {
    const contentHash = fingerprint(file.path);

    // O mesmo arquivo na fila de outra conta é o problema que a seção
    // "Conteúdo repetido" existe para evitar. Barrar na entrada é melhor do que
    // avisar depois: o vídeo nem chega a ocupar um horário.
    if (settings?.blockDuplicateContent !== false && contentHash) {
      const outras = await duplicates.outrasContasCom(contentHash, accountId);
      if (outras.length) {
        try { fs.unlinkSync(file.path); } catch { /* pode já não existir */ }
        skipped.push({
          filename: nomeOriginal(file.originalname),
          reason: 'DUPLICADO',
          accounts: outras.map((c) => c.username),
        });
        await logger.warn({
          action: 'UPLOAD_DUPLICADO_BLOQUEADO', accountId, videoName: nomeOriginal(file.originalname),
          message: `Mesmo conteúdo já está na fila de @${outras.map((c) => c.username).join(', @')}.`,
        });
        continue;
      }
    }

    const meta = await probe(file.path).catch(() => ({}));
    const video = await prisma.video.create({
      data: {
        accountId,
        filename: nomeOriginal(file.originalname),
        filepath: file.path,
        mediaType,
        sortOrder: proxima.get(accountId),
        contentHash,
        sizeBytes: sizeOf(file.path),
        durationSec: meta.durationSec ?? null,
        width: meta.width ?? null,
        height: meta.height ?? null,
        // A capa padrão NÃO é gravada aqui.
        //
        // Gravar no upload congelava a escolha: trocar a capa da conta depois
        // não mexia em nada do que já estava na fila, e o usuário via a capa
        // antiga continuar saindo sem entender por quê. Deixando vazio, quem
        // resolve é `covers.resolveFor` na hora de publicar — que já procura a
        // capa da conta e depois a geral. Só a capa escolhida PARA ESTE VÍDEO
        // preenche o campo, e é justamente ela que deve ter prioridade.

      },
    });
    // A classificação do modo por nicho já foi calculada; gravar aqui evita
    // classificar o mesmo arquivo duas vezes.
    if (classificacao) {
      await classify.gravarClassificacao(video.id, classificacao).catch(() => {
        /* classificação é acessório: nunca derruba o upload */
      });
    }

    proxima.set(accountId, proxima.get(accountId) + 1);
    tocadas.add(accountId);
    created.push({ ...video, accountUsername: nomePorConta.get(accountId) });

    await logger.info({
      action: 'VIDEO_ADICIONADO', accountId, videoName: video.filename,
      message: distribuindo ? `Distribuído para @${nomePorConta.get(accountId)}.` : undefined,
    });
  }

  for (const accountId of tocadas) await regenerate({ accountId });

  // Classifica DEPOIS de responder ao navegador, e sem esperar.
  //
  // Um lote de 300 vídeos com a IA ligada levaria minutos; segurar a resposta
  // do upload por isso transformaria uma melhoria em travamento. O vídeo entra
  // na fila do mesmo jeito e a classificação aparece quando ficar pronta.
  if (!porNicho) classify.classificarEmSegundoPlano(created.map((v) => v.id));

  // Quanto cada conta recebeu — é o que a tela mostra depois de distribuir.
  const porConta = destinos.map((d) => ({
    accountId: d.id,
    username: d.username,
    count: created.filter((v) => v.accountId === d.id).length,
  }));

  res.status(201).json({ created, skipped, distributed: distribuindo, porConta });
}));

/**
 * GET /duplicates — conteúdo repetido entre contas (e dentro de cada uma).
 *
 * NÃO recalcula impressões aqui: a tela faz polling a cada 30s, e o backfill
 * dá um `stat()` em cada vídeo sem hash — com a fila grande isso varria o
 * disco inteiro duas vezes por minuto, para sempre, já que arquivo ausente
 * nunca ganha hash e volta na varredura seguinte. As impressões são
 * calculadas onde o vídeo nasce (upload, pasta monitorada, editor) e uma vez
 * no boot; `?rescan=1` força, para o botão "Verificar de novo".
 */
router.get('/duplicates', wrap(async (req, res) => {
  if (req.query.rescan === '1') await duplicates.backfill();
  res.json(await duplicates.listar());
}));

/** POST /duplicates/resolve — mantém uma cópia e tira as outras da fila. */
router.post('/duplicates/resolve', wrap(async (req, res) => {
  const r = await duplicates.resolver({
    hash: req.body.hash,
    manterVideoId: req.body.keepVideoId,
  });
  for (const accountId of r.contas) await regenerate({ accountId });
  res.json(r);
}));

router.patch('/:id', wrap(async (req, res) => {
  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) throw new NotFoundError('Vídeo não encontrado.');

  const data = {};
  if (req.body.caption !== undefined) {
    data.caption = v.str(req.body.caption, { field: 'Legenda', min: 0, max: 2200 }) || null;
  }
  if (req.body.mediaType !== undefined) {
    data.mediaType = v.oneOf(req.body.mediaType, MEDIA_TYPES, { field: 'Tipo' });
  }

  res.json(await prisma.video.update({ where: { id: video.id }, data }));
}));

/** Reordena a fila de uma conta. Recebe os ids na ordem desejada. */
router.post('/reorder', wrap(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : null;
  if (!ids?.length) throw new ValidationError('Envie a lista de ids na nova ordem.');

  await prisma.$transaction(
    ids.map((id, index) => prisma.video.update({ where: { id }, data: { sortOrder: index } })),
  );

  const first = await prisma.video.findUnique({ where: { id: ids[0] } });
  if (first) await regenerate({ accountId: first.accountId });
  res.json({ ok: true, count: ids.length });
}));

/**
 * Remove da fila. Apaga também o arquivo, exceto se já foi publicado — nesse
 * caso o arquivo é o histórico do que foi ao ar.
 */
router.delete('/:id', wrap(async (req, res) => {
  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) throw new NotFoundError('Vídeo não encontrado.');

  if (video.status !== VIDEO_STATUS.PUBLISHED) {
    try { fs.unlinkSync(video.filepath); } catch { /* já pode não existir */ }
  }

  await prisma.video.delete({ where: { id: video.id } });
  // A capa é nomeada pelo hash e pode ser compartilhada com outros vídeos —
  // cleanupIfOrphan confere isso antes de apagar. Sem esta linha, remover um
  // vídeo pela lista deixava a imagem para trás, enquanto "remover
  // selecionados" limpava: mesma ação, resultados diferentes.
  if (video.coverPath) await covers.cleanupIfOrphan(video.coverPath);

  await regenerate({ accountId: video.accountId });
  await logger.info({ action: 'VIDEO_REMOVIDO', accountId: video.accountId, videoName: video.filename });
  res.json({ ok: true });
}));

/** Serve o arquivo para a prévia no painel. */
router.get('/:id/file', wrap(async (req, res) => {
  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) throw new NotFoundError('Vídeo não encontrado.');
  if (!fs.existsSync(video.filepath)) throw new NotFoundError('Arquivo não está mais no disco.');
  res.sendFile(path.resolve(video.filepath));
}));


// Capa em memória: o hash do conteúdo precisa ser calculado antes de gravar.
const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.limits.coverBytes },
});

/**
 * POST /:id/publish-now — publica IMEDIATAMENTE, fora do agendamento.
 *
 * UMA tentativa só, e devolve o resultado na hora: serve para o usuário
 * testar se a automação funciona sem esperar o próximo horário. O retry
 * automático do agendador mascararia um problema real de configuração.
 */
router.post('/:id/publish-now', wrap(async (req, res) => {
  const video = await prisma.video.findUnique({ where: { id: req.params.id }, include: { account: true } });
  if (!video) throw new NotFoundError('Vídeo não encontrado.');
  if (video.status === VIDEO_STATUS.PUBLISHED) throw new ConflictError('Esse vídeo já foi publicado.');
  if (video.mediaType === MEDIA.STORY) {
    throw new ConflictError('Stories não podem ser publicados pela web do Instagram.');
  }
  accountsCore.assertConnected(video.account);

  // A mesma validação de nicho do agendador. "Publicar agora" é um atalho
  // para o mesmo destino, não uma porta dos fundos: sem isto, o botão
  // contornaria a separação que o resto do sistema garante.
  //
  // `?ignorarNicho=1` existe para a tela de revisão, onde a PESSOA já olhou o
  // vídeo e decidiu publicar mesmo assim.
  if (req.query.ignorarNicho !== '1') {
    const veredito = await nicheGuard.validar({ video, account: video.account });
    if (!veredito.pode) {
      throw new ConflictError(
        `${veredito.motivo} Para publicar mesmo assim, use a tela Nichos > Revisão.`,
      );
    }
  }

  const iniciadaEm = new Date();

  await prisma.video.update({ where: { id: video.id }, data: { status: VIDEO_STATUS.PUBLISHING } });
  await logger.info({
    action: 'PUBLICACAO_MANUAL', accountId: video.accountId, videoName: video.filename,
    message: 'Disparada pelo painel, fora do agendamento.',
  });

  try {
    // Espera o agendador, se ele estiver publicando: duas publicações ao
    // mesmo tempo disputam a mesma janela do navegador.
    const result = await comNavegador(async () => publishReel({
      accountId: video.accountId,
      username: video.account.username,
      filepath: video.filepath,
      videoName: video.filename,
      caption: video.caption || video.account.fallbackCaption
        || (await prisma.settings.findUnique({ where: { id: 1 } }))?.defaultCaption || '',
      coverPath: await covers.resolveFor(video),
      aiLabel: video.account.aiLabel,
    }));

    const moved = moveTo(video.filepath, config.paths.published);
    const publishedAt = new Date();

    await prisma.video.update({
      where: { id: video.id },
      data: { status: VIDEO_STATUS.PUBLISHED, publishedAt, filepath: moved },
    });

    // Registra no histórico, como qualquer publicação.
    //
    // Sem isto o vídeo ficava PUBLISHED e a tabela de publicações vazia: o
    // painel dizia "0 publicados hoje" depois de publicar, o calendário não
    // mostrava nada e o `status` do WhatsApp contava zero. O registro só é
    // criado no SUCESSO — a falha manual devolve o vídeo à fila de propósito
    // (é um teste), e uma linha FAILED aqui sujaria a lista de falhas de
    // verdade.
    await prisma.publication.create({
      data: {
        accountId: video.accountId,
        videoId: video.id,
        scheduledAt: iniciadaEm,
        publishedAt,
        status: VIDEO_STATUS.PUBLISHED,
        attempts: 1,
        durationMs: result.durationMs,
      },
    });

    await logger.success({
      action: 'PUBLICACAO_MANUAL_OK', accountId: video.accountId,
      videoName: video.filename, durationMs: result.durationMs,
    });
    res.json({ ok: true, durationMs: result.durationMs });
  } catch (err) {
    // Volta para PENDING, não para FAILED: foi um teste manual, e marcar como
    // falha definitiva pausaria a conta por causa de uma tentativa avulsa.
    await prisma.video.update({ where: { id: video.id }, data: { status: VIDEO_STATUS.PENDING } });
    await logger.error({
      action: 'PUBLICACAO_MANUAL_FALHOU', accountId: video.accountId,
      videoName: video.filename, message: err.message,
    });
    throw err;
  }
}));

/** POST /bulk-delete — remove vários de uma vez. Publicados são preservados. */
router.post('/bulk-delete', wrap(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (!ids.length) throw new ValidationError('Envie a lista de ids.');

  const videos = await prisma.video.findMany({ where: { id: { in: ids } } });
  const removiveis = videos.filter((x) => x.status !== VIDEO_STATUS.PUBLISHED);

  for (const video of removiveis) {
    try { fs.unlinkSync(video.filepath); } catch { /* pode já não existir */ }
    if (video.coverPath) await covers.cleanupIfOrphan(video.coverPath);
  }
  await prisma.video.deleteMany({ where: { id: { in: removiveis.map((x) => x.id) } } });

  const contas = [...new Set(removiveis.map((x) => x.accountId))];
  for (const accountId of contas) await regenerate({ accountId });

  res.json({
    removed: removiveis.length,
    skipped: videos.length - removiveis.length,
  });
}));

/** POST /:id/cover — define a capa deste vídeo. */
router.post('/:id/cover', coverUpload.single('cover'), wrap(async (req, res) => {
  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) throw new NotFoundError('Vídeo não encontrado.');

  const filename = covers.save(req.file);
  const anterior = video.coverPath;

  const atualizado = await prisma.video.update({
    where: { id: video.id },
    data: { coverPath: filename },
  });

  if (anterior && anterior !== filename) await covers.cleanupIfOrphan(anterior);
  res.json(atualizado);
}));

router.delete('/:id/cover', wrap(async (req, res) => {
  const video = await prisma.video.findUnique({ where: { id: req.params.id } });
  if (!video) throw new NotFoundError('Vídeo não encontrado.');

  const atualizado = await prisma.video.update({ where: { id: video.id }, data: { coverPath: null } });
  if (video.coverPath) await covers.cleanupIfOrphan(video.coverPath);
  res.json(atualizado);
}));

export default router;
