import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { elegiveis } from '../server/core/queue/recycle.js';

const DIA = 86_400_000;
const AGORA = new Date('2026-06-01T12:00:00').getTime();
const diasAtras = (n) => new Date(AGORA - n * DIA);

const video = (id, extras = {}) => ({
  id,
  filename: `${id}.mp4`,
  publishedAt: diasAtras(60),
  recycleCount: 0,
  lastRecycledAt: null,
  ...extras,
});

describe('elegiveis', () => {
  const regras = { recycleAfterDays: 30, recycleMaxTimes: 0 };

  test('publicado há mais que a carência volta', () => {
    const r = elegiveis([video('a')], regras, AGORA);
    assert.equal(r.length, 1);
  });

  test('publicado há menos que a carência não volta', () => {
    const r = elegiveis([video('a', { publishedAt: diasAtras(10) })], regras, AGORA);
    assert.equal(r.length, 0);
  });

  test('exatamente na carência já conta', () => {
    const r = elegiveis([video('a', { publishedAt: diasAtras(30) })], regras, AGORA);
    assert.equal(r.length, 1);
  });

  test('a carência conta da ÚLTIMA reciclagem, não da primeira publicação', () => {
    // Publicado há 60 dias, mas reciclado ontem: não pode voltar de novo hoje.
    const v = video('a', { publishedAt: diasAtras(60), lastRecycledAt: diasAtras(1), recycleCount: 1 });
    assert.equal(elegiveis([v], regras, AGORA).length, 0);

    // Reciclado há 40 dias: já cumpriu a carência de novo.
    const w = video('b', { publishedAt: diasAtras(90), lastRecycledAt: diasAtras(40), recycleCount: 1 });
    assert.equal(elegiveis([w], regras, AGORA).length, 1);
  });

  test('respeita o teto de reciclagens', () => {
    const com2 = video('a', { recycleCount: 2, lastRecycledAt: diasAtras(60) });
    assert.equal(elegiveis([com2], { recycleAfterDays: 30, recycleMaxTimes: 2 }, AGORA).length, 0);
    assert.equal(elegiveis([com2], { recycleAfterDays: 30, recycleMaxTimes: 3 }, AGORA).length, 1);
  });

  test('teto 0 significa sem limite', () => {
    const muito = video('a', { recycleCount: 99, lastRecycledAt: diasAtras(60) });
    assert.equal(elegiveis([muito], { recycleAfterDays: 30, recycleMaxTimes: 0 }, AGORA).length, 1);
  });

  test('vídeo sem data de publicação nunca é elegível', () => {
    const r = elegiveis([video('a', { publishedAt: null })], regras, AGORA);
    assert.equal(r.length, 0);
  });

  test('não altera a lista recebida', () => {
    const lista = [video('a'), video('b', { publishedAt: diasAtras(1) })];
    elegiveis(lista, regras, AGORA);
    assert.equal(lista.length, 2);
  });

  test('carência inválida cai no mínimo de 1 dia, não em divisão por zero', () => {
    const v = video('a', { publishedAt: diasAtras(2) });
    assert.equal(elegiveis([v], { recycleAfterDays: 0 }, AGORA).length, 1);
  });
});
