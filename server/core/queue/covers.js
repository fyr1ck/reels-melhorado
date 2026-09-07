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
 * Capa que o vídeo vai usar de fato: a própria, ou a padrão da instalação.
 * Devolve caminho absoluto — é o que o publicador precisa — ou null.
 */
export async function resolveFor(video) {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const nome = video.coverPath || (settings?.useDefaultCover ? settings.defaultCoverPath : null);
  if (!nome) return null;

  const full = path.join(config.paths.covers, nome);
  return fs.existsSync(full) ? full : null;
}

/**
 * Apaga a imagem apenas se mais ninguém a usa.
 *
 * Como o nome é o hash do conteúdo, vídeos diferentes com a mesma imagem
 * compartilham o arquivo. Apagar sem conferir deixaria os outros sem capa.
 */
export async function cleanupIfOrphan(filename) {
  if (!filename) return false;

  const [emUso, comoPadrao] = await Promise.all([
    prisma.video.count({ where: { coverPath: filename } }),
    prisma.settings.count({ where: { id: 1, defaultCoverPath: filename } }),
  ]);
  if (emUso > 0 || comoPadrao > 0) return false;

  try {
    fs.unlinkSync(path.join(config.paths.covers, filename));
    return true;
  } catch {
    return false;
  }
}
