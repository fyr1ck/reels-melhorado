import { PrismaClient } from '@prisma/client';

/**
 * Cliente único. Em desenvolvimento o `node --watch` reinicia o módulo a cada
 * salvamento, e um cliente novo por reinício esgota as conexões do SQLite —
 * por isso a instância fica pendurada no globalThis.
 */
const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === 'true' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.__prisma = prisma;
