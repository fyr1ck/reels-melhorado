import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { decidir, montarPrompt, PEDIDO } from '../server/core/publishing/legenda.js';

/**
 * Testes da legenda rotativa.
 *
 * Só as duas partes puras: quando o lote vira e o que é pedido ao assistente.
 * A gravação e a chamada da API ficam de fora — uma precisa de banco, a outra
 * custa dinheiro por execução.
 */

const conta = (extra) => ({ captionRotateEvery: 20, captionRotateCount: 0, ...extra });

describe('quando o lote vira', () => {
  test('desligada (0) não conta nem troca', () => {
    const r = decidir(conta({ captionRotateEvery: 0, captionRotateCount: 7 }));
    assert.equal(r.trocar, false);
    assert.equal(r.contagem, 7, 'a contagem parada fica como está');
  });

  test('conta sem trocar antes do fim do lote', () => {
    const r = decidir(conta({ captionRotateCount: 18 }));
    assert.deepEqual(r, { contagem: 19, trocar: false });
  });

  test('troca exatamente na vigésima', () => {
    const r = decidir(conta({ captionRotateCount: 19 }));
    assert.deepEqual(r, { contagem: 20, trocar: true });
  });

  test('contagem acima do alvo troca na publicação seguinte', () => {
    // Acontece quando a troca anterior falhou: a contagem fica no topo de
    // propósito, para tentar de novo em vez de esperar outro lote inteiro.
    const r = decidir(conta({ captionRotateCount: 25 }));
    assert.equal(r.trocar, true);
  });

  test('conta sem os campos não quebra', () => {
    assert.deepEqual(decidir(undefined), { contagem: 0, trocar: false });
    assert.deepEqual(decidir({}), { contagem: 0, trocar: false });
  });
});

describe('o que é pedido ao assistente', () => {
  const base = 'linha um\nlinha dois\n◆ ponto:';

  test('leva o modelo inteiro e o pedido do usuário, palavra por palavra', () => {
    const p = montarPrompt({ base, atual: base });
    assert.ok(p.includes(base), 'o modelo vai inteiro, com as quebras de linha');
    assert.ok(p.includes(PEDIDO));
  });

  test('manda evitar o assunto da legenda em uso', () => {
    const atual = 'outro texto\nem uso agora';
    const p = montarPrompt({ base, atual });
    assert.ok(p.includes(atual));
    assert.match(p, /DIFERENTE/);
  });

  test('não repete o bloco quando a legenda em uso ainda é o modelo', () => {
    const p = montarPrompt({ base, atual: `  ${base}  ` });
    assert.equal(p.split(base).length - 1, 1);
  });
});
