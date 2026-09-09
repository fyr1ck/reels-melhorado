import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '../../db/prisma.js';
import { config } from '../../config/env.js';
import { ValidationError } from '../../lib/errors.js';

/**
 * Capas personalizadas dos vídeos.
 *
 * O arquivo é nomeado pelo HASH do conteúdo. Duas consequências úteis: enviar
 * a mesma imagem duas vezes não duplica nada em disco, e apagar uma capa exige
 * conferir se nenhum outro vídeo a usa — daí o `cleanupIfOrphan`.
 */

const TIPOS = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function validate(file) {
  if (!file) throw new ValidationError('Nenhuma imagem enviada.');
  if (!TIPOS[file.mimetype]) {
    throw new ValidationError('Formato não suportado. Use JPG, PNG ou WebP.');
  }
  if (file.size > config.limits.coverBytes) {
    throw new ValidationError(`A imagem passa de ${Math.round(config.limits.coverBytes / 1048576)} MB.`);
  }
}

/** Grava a capa e devolve o nome do arquivo. Idempotente por conteúdo. */
export function save(file) {
  validate(file);
  fs.mkdirSync(config.paths.covers, { recursive: true });

  const hash = crypto.createHash('sha1').update(file.buffer).digest('hex').slice(0, 16);
  const filename = `${hash}.${TIPOS[file.mimetype]}`;
  const full = path.join(config.paths.covers, filename);

  if (!fs.existsSync(full)) fs.writeFileSync(full, file.buffer);
  return filename;
}

/**
 * Capa padrão aplicável a um vídeo novo daquela conta, na ordem:
 * capa da CONTA > capa geral da instalação. Devolve o nome do arquivo (o que
 * vai em `Video.coverPath`) ou null.
 *
 * A capa por conta existe porque cada perfil costuma ter identidade visual
 * própria; uma capa única para a instalação inteira só serve com uma conta.
 */
export async function padraoDaConta(accountId, settings) {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { useDefaultCover: true, defaultCoverPath: true },
  });
  if (account?.useDefaultCover && account.defaultCoverPath) return account.defaultCoverPath;

  const s = settings ?? (await prisma.settings.findUnique({ where: { id: 1 } }));
  return s?.useDefaultCover ? s.defaultCoverPath : null;
}

/**
 * Capa que o vídeo vai usar de fato, na ordem: a própria > a da conta > a
 * geral. Devolve caminho absoluto — é o que o publicador precisa — ou null.
 *
 * Cada candidata é conferida NO DISCO antes de ser escolhida, e a lista segue
 * quando uma falta. A versão anterior pegava a primeira e desistia se o arquivo
 * não estivesse lá: um vídeo com capa própria cujo arquivo tinha sido apagado
 * publicava SEM capa nenhuma — mesmo com a conta tendo uma padrão perfeitamente
 * válida. O sintoma era "troquei a capa e não foi", sem nada no log.
 */
export async function resolveFor(video) {
  const candidatas = [video.coverPath, await padraoDaConta(video.accountId)].filter(Boolean);

  for (const nome of candidatas) {
    const full = path.join(config.paths.covers, nome);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

/**
 * Solta os vídeos que apontam para uma capa que não existe mais.
 *
 * Sem isto o painel mente: a etiqueta diz "capa própria" num vídeo cuja imagem
 * sumiu, e o usuário não tem como saber que ele vai herdar a da conta.
 * Idempotente — roda no boot e não faz nada quando está tudo certo.
 */
export async function repararCapasQuebradas() {
  const comCapa = await prisma.video.findMany({
    where: { coverPath: { not: null }, status: { in: ['PENDING', 'SCHEDULED'] } },
    select: { id: true, coverPath: true },
  });

  const quebrados = comCapa
    .filter((v) => !fs.existsSync(path.join(config.paths.covers, v.coverPath)))
    .map((v) => v.id);

  if (!quebrados.length) return { soltos: 0 };

  await prisma.video.updateMany({
    where: { id: { in: quebrados } },
    data: { coverPath: null },
  });
  return { soltos: quebrados.length };
}

/**
 * Apaga a imagem apenas se mais ninguém a usa.
 *
 * Como o nome é o hash do conteúdo, vídeos diferentes com a mesma imagem
 * compartilham o arquivo. Apagar sem conferir deixaria os outros sem capa.
 */
export async function cleanupIfOrphan(filename) {
  if (!filename) return false;

  const [emUso, comoPadrao, comoPadraoDeConta] = await Promise.all([
    prisma.video.count({ where: { coverPath: filename } }),
    prisma.settings.count({ where: { id: 1, defaultCoverPath: filename } }),
    prisma.account.count({ where: { defaultCoverPath: filename } }),
  ]);
  if (emUso > 0 || comoPadrao > 0 || comoPadraoDeConta > 0) return false;

  try {
    fs.unlinkSync(path.join(config.paths.covers, filename));
    return true;
  } catch {
    return false;
  }
}
