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
/**
 * Conserta o nome do arquivo que chega num upload.
 *
 * O multipart/form-data entrega o nome como bytes crus, e o multer os lê como
 * latin1. Um nome em japonês, árabe ou com acento chega embaralhado — "アニメ"
 * vira "ã¢ãã¡" — e era esse nome quebrado que aparecia no painel e virava
 * legenda quando alguém copiava de lá.
 *
 * A reinterpretação só acontece quando é segura:
 *
 * - nome só com ASCII não tem o que reinterpretar;
 * - se os bytes NÃO formam UTF-8 válido, a decodificação produz U+FFFD e o
 *   nome original é mantido. É o caso de um nome latin1 de verdade ("café"),
 *   que já chegou certo e seria destruído pela conversão.
 */
export function nomeOriginal(nome) {
  if (!nome || !/[-ÿ]/.test(nome)) return nome;

  const reinterpretado = Buffer.from(nome, 'latin1').toString('utf8');
  return reinterpretado.includes('�') ? nome : reinterpretado;
}

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
