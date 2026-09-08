import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { agrupar, TIPO } from '../server/core/queue/duplicates.js';
import { fingerprint } from '../server/lib/fingerprint.js';

const v = (id, accountId, contentHash) => ({ id, accountId, contentHash });

describe('agrupar', () => {
  test('mesmo conteúdo em contas diferentes é CRUZADO', () => {
    const [g] = agrupar([v('1', 'A', 'h'), v('2', 'B', 'h')]);
    assert.equal(g.tipo, TIPO.CRUZADO);
    assert.deepEqual(g.contas.sort(), ['A', 'B']);
  });

  test('mesmo conteúdo na mesma conta é REPETIDO', () => {
    const [g] = agrupar([v('1', 'A', 'h'), v('2', 'A', 'h')]);
    assert.equal(g.tipo, TIPO.REPETIDO);
    assert.deepEqual(g.contas, ['A']);
  });

  test('conteúdo único não vira grupo', () => {
    assert.deepEqual(agrupar([v('1', 'A', 'h1'), v('2', 'B', 'h2')]), []);
  });

  test('sem impressão digital não afirma nada', () => {
    // Dois arquivos sem hash não podem ser declarados iguais: seria acusar
    // duplicidade por ausência de informação.
    assert.deepEqual(agrupar([v('1', 'A', null), v('2', 'B', null)]), []);
  });

  test('cruzados vêm antes de repetidos — são o problema de verdade', () => {
    const grupos = agrupar([
      v('1', 'A', 'rep'), v('2', 'A', 'rep'),
      v('3', 'A', 'cruz'), v('4', 'B', 'cruz'),
    ]);
    assert.equal(grupos[0].tipo, TIPO.CRUZADO);
    assert.equal(grupos[1].tipo, TIPO.REPETIDO);
  });

  test('três contas com o mesmo vídeo formam um grupo só', () => {
    const grupos = agrupar([v('1', 'A', 'h'), v('2', 'B', 'h'), v('3', 'C', 'h')]);
    assert.equal(grupos.length, 1);
    assert.equal(grupos[0].videos.length, 3);
    assert.equal(grupos[0].contas.length, 3);
  });
});

describe('fingerprint', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-fp-'));
  const escrever = (nome, conteudo) => {
    const p = path.join(tmp, nome);
    fs.writeFileSync(p, conteudo);
    return p;
  };

  test('mesmo conteúdo, nomes diferentes: mesma impressão', () => {
    const a = escrever('a.mp4', 'conteudo identico');
    const b = escrever('b.mp4', 'conteudo identico');
    assert.equal(fingerprint(a), fingerprint(b));
  });

  test('conteúdo diferente: impressão diferente', () => {
    const a = escrever('c.mp4', 'video AAA');
    const b = escrever('d.mp4', 'video BBB');  // mesmo tamanho, bytes diferentes
    assert.equal(fs.statSync(a).size, fs.statSync(b).size);
    assert.notEqual(fingerprint(a), fingerprint(b));
  });

  test('o tamanho entra na impressão', () => {
    const a = escrever('e.mp4', 'abc');
    const b = escrever('f.mp4', 'abcdef');
    assert.notEqual(fingerprint(a), fingerprint(b));
  });

  test('arquivo inexistente devolve null, não lança', () => {
    assert.equal(fingerprint(path.join(tmp, 'nao-existe.mp4')), null);
  });

  test('arquivo vazio tem impressão válida', () => {
    const p = escrever('vazio.mp4', '');
    assert.match(fingerprint(p), /^0-[0-9a-f]{40}$/);
  });
});
