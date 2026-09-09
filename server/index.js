import { createApp } from './app.js';
import { config } from './config/env.js';
import { prisma } from './db/prisma.js';
import { ensureDirs } from './lib/files.js';
import * as duplicates from './core/queue/duplicates.js';
import * as covers from './core/queue/covers.js';
import * as assistant from './core/assistant/index.js';
import * as whatsapp from './core/whatsapp/index.js';
import * as accounts from './core/accounts/accounts.js';
import * as scheduler from './core/scheduling/scheduler.js';
import * as watch from './core/watch/watch.js';
import * as storage from './core/storage.js';
import { closeAll } from './playwright/browser.js';
import { VIDEO_STATUS, BATCH_STATUS } from './lib/enums.js';

/**
 * Recupera estados que ficaram pela metade quando o processo caiu.
 *
 * Um vídeo fica PUBLISHING enquanto o navegador trabalha. Se o processo morre
 * no meio, o registro nunca sai desse estado: some dos pendentes, nunca é
 * publicado e ainda desencontra os números do painel. Na subida, o que estava
 * em voo volta para a fila.
 */
/**
 * Cria o registro de publicação que faltou em vídeos já publicados.
 *
 * A publicação manual ("Publicar agora") atualizava o vídeo mas não gravava
 * nada em Publication. O efeito era um painel que mentia depois de funcionar:
 * o vídeo ia ao ar, e mesmo assim o Dashboard dizia "0 publicados hoje", o
 * calendário ficava vazio e o `status` do WhatsApp contava zero.
 *
 * O caminho novo já grava. Isto conserta o que ficou para trás, e é
 * idempotente: rodar de novo não cria nada.
 */
async function repararHistorico() {
  const orfaos = await prisma.video.findMany({
    where: {
      status: VIDEO_STATUS.PUBLISHED,
      publishedAt: { not: null },
      publications: { none: {} },
    },
    select: { id: true, accountId: true, publishedAt: true },
  });
  if (!orfaos.length) return;

  await prisma.publication.createMany({
    data: orfaos.map((v) => ({
      accountId: v.accountId,
      videoId: v.id,
      scheduledAt: v.publishedAt,
      publishedAt: v.publishedAt,
      status: VIDEO_STATUS.PUBLISHED,
      attempts: 1,
    })),
  });

  console.log(`↻ ${orfaos.length} publicação(ões) sem registro foram recuperadas para o histórico.`);
}

async function recover() {
  const videos = await prisma.video.updateMany({
    where: { status: VIDEO_STATUS.PUBLISHING },
    data: { status: VIDEO_STATUS.PENDING },
  });
  await prisma.publication.updateMany({
    where: { status: VIDEO_STATUS.PUBLISHING },
    data: { status: VIDEO_STATUS.SCHEDULED },
  });

  if (videos.count) {
    console.log(`↻ ${videos.count} vídeo(s) interrompidos voltaram para a fila.`);
  }

  await repararHistorico();

  // Vídeos apontando para uma capa que sumiu do disco voltam a herdar a da
  // conta. Sem isto eles publicariam sem capa, e o painel ainda diria que
  // tinham uma.
  const capas = await covers.repararCapasQuebradas();
  if (capas.soltos) {
    console.log(`↻ ${capas.soltos} vídeo(s) tinham capa inexistente e voltaram a herdar a da conta.`);
  }

  // Mesma situação nos lotes do editor: o progresso vive em memória, então um
  // lote marcado RUNNING depois de um reinício é órfão — não há trabalhador
  // algum cuidando dele, e ficaria travado para sempre no painel. Volta para
  // PENDING, junto dos itens que estavam em processamento, e pode ser
  // disparado de novo.
  const items = await prisma.batchItem.updateMany({
    where: { status: 'RUNNING' },
    data: { status: 'PENDING', progress: 0 },
  });
  const batches = await prisma.batch.updateMany({
    where: { status: BATCH_STATUS.RUNNING },
    data: { status: BATCH_STATUS.PENDING },
  });

  if (batches.count) {
    console.log(`↻ ${batches.count} lote(s) interrompidos (${items.count} item(ns)) voltaram para pendente.`);
  }
}

async function bootstrap() {
  ensureDirs();

  await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const account = await accounts.ensureDefault();
  await accounts.syncConnectionFlags();
  await recover();

  // Calcula a impressão digital dos vídeos que ainda não têm uma. O campo
  // nasceu depois deles: sem isto, a checagem de conteúdo repetido não teria
  // com o que comparar e a tela abriria vazia para quem já usava o app.
  const hashes = await duplicates.backfill();
  if (hashes.calculados) {
    console.log(`  Impressão digital calculada para ${hashes.calculados} vídeo(s).`);
  }

  // O agendador sobe sempre: quem decide se algo é publicado é o estado de
  // cada conta, avaliado a cada tick. Uma flag global não responde por todas.
  scheduler.start();
  watch.start();

  // Reabre a sessão salva do WhatsApp sem pedir QR de novo. Em segundo plano:
  // abrir um navegador leva segundos, e a API não pode esperar por isso para
  // começar a atender.
  whatsapp.retomarNoBoot()
    .then((ok) => ok && console.log('  WhatsApp reconectado.'))
    .catch(() => { /* o painel mostra o estado e oferece o QR */ });
  storage.startAutoClean();

  const app = createApp();

  // Porta ocupada sobe como evento 'error' não tratado, e o Node derruba o
  // processo com um stack trace de rede que não diz o que fazer. Aqui vira
  // uma mensagem acionável.
  const server = app.listen(config.port, () => {
    console.log(`\n  Reels Manager — API em http://localhost:${config.port}`);
    console.log(`  Painel: http://localhost:3000`);
    console.log(`  Conta padrão: @${account.username}\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `\n  A porta ${config.port} já está em uso — provavelmente outra instância do app ` +
        `ainda está rodando.\n  Feche-a, ou defina outra porta em PORT no arquivo .env.\n`,
      );
      process.exit(1);
    }
    throw err;
  });
}

bootstrap().catch((err) => {
  console.error('Falha ao iniciar:', err);
  process.exit(1);
});

async function shutdown() {
  console.log('\nEncerrando…');
  scheduler.stop();
  watch.stop();
  storage.stopAutoClean();
  await closeAll();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

/**
 * Rede de segurança para trabalho em segundo plano.
 *
 * O agendador, a varredura de pastas e o processamento de lotes rodam fora do
 * ciclo de requisição. Uma rejeição não tratada em qualquer um deles derruba o
 * processo inteiro por padrão no Node — e derrubar a API porque UM vídeo de um
 * lote falhou é desproporcional: as outras contas param de publicar e o painel
 * fica fora do ar.
 *
 * Aqui o erro é registrado e o servidor continua. O que falhou já marcou seu
 * próprio estado como FAILED no banco.
 */
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error('⚠ Promessa rejeitada sem tratamento (o servidor continua):', msg);
  assistant.registrarSeLigado({
    origem: 'SERVIDOR',
    mensagem: msg,
    stack: reason instanceof Error ? (reason.stack ?? '') : '',
  });
});

process.on('uncaughtException', (err) => {
  console.error('⚠ Exceção não capturada (o servidor continua):', err.message);
  assistant.registrarSeLigado({
    origem: 'SERVIDOR',
    mensagem: err.message,
    stack: err.stack ?? '',
  });
});
