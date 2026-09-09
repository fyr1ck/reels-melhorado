import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { repartir } from '../server/core/queue/distribute.js';

const contas = (...cargas) => cargas.map((n, i) => ({ id: `c${i + 1}`, carga: n }));
const conta = (plano, id) => plano.filter((p) => p.accountId === id).length;

describe('repartir', () => {
  test('filas vazias: reparte igualmente', () => {
    const plano = repartir([1, 2, 3, 4, 5, 6], contas(0, 0, 0));
    assert.equal(plano.length, 6);
    assert.equal(conta(plano, 'c1'), 2);
    assert.equal(conta(plano, 'c2'), 2);
    assert.equal(conta(plano, 'c3'), 2);
  });

  test('cada vídeo vai para UMA conta só — é o ponto de distribuir', () => {
    const itens = ['a', 'b', 'c', 'd'];
    const plano = repartir(itens, contas(0, 0));

    for (const item of itens) {
      const destinos = plano.filter((p) => p.item === item);
      assert.equal(destinos.length, 1, `"${item}" foi para mais de uma conta`);
    }
  });

  test('divide o LOTE, mesmo com filas desiguais', () => {
    // c1 já tem 5; c2 e c3 estão vazias. O lote continua sendo repartido entre
    // as três — jogar tudo nas vazias seria "distribuir" sem distribuir, que
    // foi exatamente a reclamação que originou esta regra.
    const plano = repartir([1, 2, 3, 4, 5, 6], contas(5, 0, 0));
    assert.equal(conta(plano, 'c1'), 2);
    assert.equal(conta(plano, 'c2'), 2);
    assert.equal(conta(plano, 'c3'), 2);
  });

  test('a conta com a fila menor recebe primeiro', () => {
    // Lote de 2 em 3 contas: as duas mais vazias levam.
    const plano = repartir(['a', 'b'], contas(9, 0, 3));
    assert.equal(conta(plano, 'c2'), 1, 'a mais vazia');
    assert.equal(conta(plano, 'c3'), 1, 'a segunda mais vazia');
    assert.equal(conta(plano, 'c1'), 0, 'a mais cheia fica de fora deste lote');
  });

  test('sobra vai para as primeiras da ordem', () => {
    // 5 itens em 2 contas: 3 e 2, não 5 e 0.
    const plano = repartir([1, 2, 3, 4, 5], contas(0, 0));
    assert.equal(conta(plano, 'c1'), 3);
    assert.equal(conta(plano, 'c2'), 2);
  });

  test('não altera as cargas recebidas', () => {
    const entrada = contas(0, 0);
    repartir([1, 2, 3], entrada);
    assert.deepEqual(entrada, [{ id: 'c1', carga: 0 }, { id: 'c2', carga: 0 }]);
  });

  test('o mesmo lote distribui igual em duas execuções', () => {
    const a = repartir(['x', 'y', 'z'], contas(0, 0));
    const b = repartir(['x', 'y', 'z'], contas(0, 0));
    assert.deepEqual(a, b);
  });

  test('uma conta só: recebe tudo', () => {
    const plano = repartir([1, 2, 3], contas(9));
    assert.equal(conta(plano, 'c1'), 3);
  });

  test('lote vazio não quebra', () => {
    assert.deepEqual(repartir([], contas(0, 0)), []);
  });

  test('sem contas é erro, não silêncio', () => {
    assert.throws(() => repartir([1], []), /Nenhuma conta/);
  });
});
