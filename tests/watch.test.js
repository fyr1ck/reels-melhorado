import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { estaParado } from '../server/core/watch/watch.js';

/**
 * A espera antes de importar um arquivo da pasta monitorada.
 *
 * É a regra que decidiu, silenciosamente, que 150 vídeos não existiam: com
 * mtime no futuro a conta dava negativo e todo arquivo parecia estar sendo
 * gravado naquele instante.
 */

const ESPERA = 15_000;
const AGORA = 1_700_000_000_000;

describe('estaParado', () => {
  test('recém-gravado ainda não entra', () => {
    assert.equal(estaParado(AGORA - 3_000, AGORA, ESPERA), false);
  });

  test('parado além da espera entra', () => {
    assert.equal(estaParado(AGORA - 20_000, AGORA, ESPERA), true);
  });

  test('exatamente no limite entra', () => {
    assert.equal(estaParado(AGORA - ESPERA, AGORA, ESPERA), true);
  });

  test('mtime no futuro entra — é relógio errado, não download em andamento', () => {
    // 3 horas à frente: carimbo em UTC lido como hora local.
    assert.equal(estaParado(AGORA + 3 * 3_600_000, AGORA, ESPERA), true);
  });
});
