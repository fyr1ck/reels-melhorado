import fs from 'fs';
import path from 'path';
import { config } from '../config/env.js';

/** Cria todas as pastas de trabalho. Idempotente. */
export function ensureDirs() {
  for (const dir of Object.values(config.paths)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Nome único preservando a extensão, para dois uploads não se sobrescreverem. */
export function uniqueName(original) {
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  return `${stamp}${path.extname(original || '')}`;
}

/**
 * Move um arquivo entre as pastas do fluxo. Nunca exclui: se já existir algo
 * com o mesmo nome no destino, acrescenta um sufixo em vez de sobrescrever.
 */
export function moveTo(currentPath, targetDir) {
  ensureDirs();
  if (!fs.existsSync(currentPath)) {
    throw new Error(`Arquivo não encontrado: ${currentPath}`);
  }

  const name = path.basename(currentPath);
  let target = path.join(targetDir, name);

  if (fs.existsSync(target)) {
    const ext = path.extname(name);
    target = path.join(targetDir, `${path.basename(name, ext)}-${Date.now()}${ext}`);
  }

  fs.renameSync(currentPath, target);
  return target;
}

/** Tamanho em bytes, ou null se o arquivo sumiu. */
export function sizeOf(filepath) {
  try {
    return fs.statSync(filepath).size;
  } catch {
    return null;
  }
}

export function dirSize(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) total += dirSize(full);
    else total += sizeOf(full) || 0;
  }
  return total;
}
