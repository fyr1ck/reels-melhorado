import crypto from 'crypto';
import fs from 'fs';

/**
 * Impressão digital de um arquivo de vídeo.
 *
 * `tamanho-sha1(primeiro MB)`, e não o hash do arquivo inteiro. Ler 500 MB por
 * arquivo travaria o upload e a varredura de pastas; o primeiro megabyte já
 * contém cabeçalho, metadados e o início do stream, e a igualdade de tamanho
 * exato entra como segundo fator. Dois vídeos diferentes coincidirem nos dois
 * campos ao mesmo tempo não acontece na prática.
 *
 * O que isso NÃO faz: reconhecer o mesmo conteúdo reencodado ou cortado. Para
 * isso seria preciso comparar quadros, e não é o problema aqui — o caso real é
 * o mesmo arquivo indo parar na fila de duas contas.
 */

const AMOSTRA = 1024 * 1024;

/** @returns {string|null} null quando o arquivo sumiu ou não pôde ser lido. */
export function fingerprint(filepath) {
  let fd;
  try {
    const { size } = fs.statSync(filepath);
    fd = fs.openSync(filepath, 'r');
    const buf = Buffer.alloc(Math.min(AMOSTRA, size));
    if (buf.length) fs.readSync(fd, buf, 0, buf.length, 0);
    return `${size}-${crypto.createHash('sha1').update(buf).digest('hex')}`;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* já fechado */ }
    }
  }
}
