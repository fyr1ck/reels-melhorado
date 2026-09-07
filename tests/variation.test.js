import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sortearVariacao, aplicarVariacao, descrever, SEM_VARIACAO, LIMITES,
} from '../server/core/editor/variation.js';

/**
 * O template real (ver layout.defaultTemplateConfig) só tem `videoContainer`
 * para o pipeline de ffmpeg. Estes testes usam essa forma de propósito: uma
 * versão anterior da variação escrevia em campos inventados, o log dizia
 * "zoom +3%" e o arquivo saía idêntico.
 */
const CONFIG = {
  videoContainer: { x: 60, y: 300, width: 960, height: 1200, borderRadius: 24, fit: 'cover' },
  background: { type: 'color', color: '#000' },
};

test('sortearVariacao fica dentro dos limites', () => {
  for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
    const v = sortearVariacao(() => r);
    assert.ok(Math.abs(v.escala - 1) <= LIMITES.escalaPct / 100 + 1e-9, `escala ${v.escala}`);
    assert.ok(Math.abs(v.deslocX) <= LIMITES.deslocPx);
    assert.ok(Math.abs(v.deslocY) <= LIMITES.deslocPx);
  }
});

test('aplicarVariacao muda os campos que o ffmpeg realmente lê', () => {
  const out = aplicarVariacao(CONFIG, { escala: 1.02, deslocX: 5, deslocY: -3 });

  assert.notEqual(out.videoContainer.width, CONFIG.videoContainer.width);
  assert.notEqual(out.videoContainer.height, CONFIG.videoContainer.height);
  assert.notEqual(out.videoContainer.x, CONFIG.videoContainer.x);
  assert.notEqual(out.videoContainer.y, CONFIG.videoContainer.y);
});

test('dimensões saem sempre pares — H.264 rejeita ímpar', () => {
  for (const r of [0, 0.13, 0.37, 0.62, 0.88, 0.999]) {
    const out = aplicarVariacao(CONFIG, sortearVariacao(() => r));
    assert.equal(out.videoContainer.width % 2, 0, `largura ímpar: ${out.videoContainer.width}`);
    assert.equal(out.videoContainer.height % 2, 0, `altura ímpar: ${out.videoContainer.height}`);
  }
});

test('ampliar compensa a posição para o container não escapar do canvas', () => {
  const out = aplicarVariacao(CONFIG, { escala: 1.03, deslocX: 0, deslocY: 0 });
  // cresceu, então x e y recuam metade do crescimento
  assert.ok(out.videoContainer.x < CONFIG.videoContainer.x);
  assert.ok(out.videoContainer.y < CONFIG.videoContainer.y);
});

test('aplicarVariacao nunca muta a config original', () => {
  const antes = JSON.stringify(CONFIG);
  aplicarVariacao(CONFIG, sortearVariacao(() => 0.7));
  assert.equal(JSON.stringify(CONFIG), antes, 'a config do template foi alterada');
});

test('aplicarVariacao preserva o resto do template', () => {
  const out = aplicarVariacao(CONFIG, sortearVariacao(() => 0.5));
  assert.deepEqual(out.background, CONFIG.background);
  assert.equal(out.videoContainer.borderRadius, 24);
  assert.equal(out.videoContainer.fit, 'cover');
});

test('SEM_VARIACAO devolve a config intocada', () => {
  assert.equal(aplicarVariacao(CONFIG, SEM_VARIACAO), CONFIG);
  assert.equal(aplicarVariacao(CONFIG, null), CONFIG);
});

test('aplicarVariacao funciona com template sem videoContainer', () => {
  const out = aplicarVariacao({}, { escala: 1.02, deslocX: 4, deslocY: 0 });
  assert.equal(out.videoContainer.width % 2, 0);
  assert.ok(Number.isFinite(out.videoContainer.x));
});

test('duas variações sorteadas produzem containers diferentes', () => {
  const a = aplicarVariacao(CONFIG, sortearVariacao(() => 0.2));
  const b = aplicarVariacao(CONFIG, sortearVariacao(() => 0.8));
  assert.notDeepEqual(a.videoContainer, b.videoContainer);
});

test('descrever resume a variação em texto', () => {
  assert.equal(descrever(SEM_VARIACAO), 'sem variação');
  assert.match(descrever({ escala: 1.02, deslocX: 5, deslocY: 0 }), /escala \+2\.0%/);
});
