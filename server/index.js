import { createApp } from './app.js';
import { config } from './config/env.js';
import { prisma } from './db/prisma.js';
import { ensureDirs } from './lib/files.js';
import * as accounts from './core/accounts/accounts.js';
import * as scheduler from './core/scheduling/scheduler.js';
import * as watch from './core/watch/watch.js';
import { closeAll } from './playwright/browser.js';
import { VIDEO_STATUS } from './lib/enums.js';

/**
 * Recupera estados que ficaram pela metade quando o processo caiu.
 *
 * Um vídeo fica PUBLISHING enquanto o navegador trabalha. Se o processo morre
 * no meio, o registro nunca sai desse estado: some dos pendentes, nunca é
 * publicado e ainda desencontra os números do painel. Na subida, o que estava
 * em voo volta para a fila.
 */
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
}

async function bootstrap() {
  ensureDirs();

  await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const account = await accounts.ensureDefault();
  await accounts.syncConnectionFlags();
  await recover();

  // O agendador sobe sempre: quem decide se algo é publicado é o estado de
  // cada conta, avaliado a cada tick. Uma flag global não responde por todas.
  scheduler.start();
  watch.start();

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`\n  Reels Manager — API em http://localhost:${config.port}`);
    console.log(`  Painel: http://localhost:3000`);
    console.log(`  Conta padrão: @${account.username}\n`);
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
  await closeAll();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
