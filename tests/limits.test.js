import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  minutosDe, emSilencio, tetoDoAquecimento, diaDoAquecimento,
  tetoDoDia, aplicarLimites, esperaDaTentativa,
} from '../server/core/scheduling/limits.js';

const em = (iso) => new Date(iso);

describe('janela de silêncio', () => {
  test('janela normal (01:00–06:00)', () => {
    const r = { quietStart: '01:00', quietEnd: '06:00' };
    assert.equal(emSilencio(em('2026-03-10T03:00:00'), r), true);
    assert.equal(emSilencio(em('2026-03-10T00:59:00'), r), false);
    assert.equal(emSilencio(em('2026-03-10T06:00:00'), r), false, 'o fim é aberto');
    assert.equal(emSilencio(em('2026-03-10T12:00:00'), r), false);
  });

  test('janela que atravessa a meia-noite (23:00–07:00)', () => {
    const r = { quietStart: '23:00', quietEnd: '07:00' };
    assert.equal(emSilencio(em('2026-03-10T23:30:00'), r), true);
    assert.equal(emSilencio(em('2026-03-10T02:00:00'), r), true);
    assert.equal(emSilencio(em('2026-03-10T06:59:00'), r), true);
    assert.equal(emSilencio(em('2026-03-10T07:00:00'), r), false);
    assert.equal(emSilencio(em('2026-03-10T15:00:00'), r), false);
  });

  test('sem janela configurada não silencia nada', () => {
    assert.equal(emSilencio(em('2026-03-10T03:00:00'), {}), false);
    assert.equal(emSilencio(em('2026-03-10T03:00:00'), { quietStart: 'lixo', quietEnd: '07:00' }), false);
  });

  test('início igual ao fim seria silêncio de 24h — tratado como desligado', () => {
    assert.equal(emSilencio(em('2026-03-10T12:00:00'), { quietStart: '08:00', quietEnd: '08:00' }), false);
  });

  test('minutosDe rejeita hora inválida', () => {
    assert.equal(minutosDe('24:00'), null);
    assert.equal(minutosDe('12:60'), null);
    assert.equal(minutosDe('7:05'), 425);
  });
});

describe('aquecimento', () => {
  test('rampa cresce do dia 1 até o alvo', () => {
    const r = { warmupDays: 10, warmupTarget: 10 };
    assert.equal(tetoDoAquecimento(1, r), 1);
    assert.equal(tetoDoAquecimento(5, r), 5);
    assert.equal(tetoDoAquecimento(10, r), 10);
  });

  test('nunca deixa a conta com teto zero', () => {
    // alvo 3 em 14 dias: no dia 1 o arredondamento honesto daria 0.21
    assert.equal(tetoDoAquecimento(1, { warmupDays: 14, warmupTarget: 3 }), 1);
  });

  test('depois do último dia o aquecimento sai de cena', () => {
    assert.equal(tetoDoAquecimento(15, { warmupDays: 14, warmupTarget: 6 }), null);
  });

  test('conta dias civis, não intervalos de 24h', () => {
    // ligado às 23h; uma hora depois já é o dia 2
    const inicio = em('2026-03-10T23:00:00');
    assert.equal(diaDoAquecimento(em('2026-03-10T23:30:00'), inicio), 1);
    assert.equal(diaDoAquecimento(em('2026-03-11T00:30:00'), inicio), 2);
  });
});

describe('teto do dia', () => {
  test('sem regras não há teto', () => {
    assert.equal(tetoDoDia(em('2026-03-10T12:00:00'), {}), null);
  });

  test('vale o menor entre teto fixo e aquecimento', () => {
    const regras = {
      dailyLimit: 8,
      warmupStartAt: em('2026-03-10T00:00:00'),
      warmupDays: 10,
      warmupTarget: 10,
    };
    // dia 2 do aquecimento => teto 2, menor que o limite fixo de 8
    assert.equal(tetoDoDia(em('2026-03-11T12:00:00'), regras), 2);
    // dia 20: aquecimento acabou, sobra o limite fixo
    assert.equal(tetoDoDia(em('2026-03-29T12:00:00'), regras), 8);
  });
});

describe('aplicarLimites', () => {
  const instantesDoDia = (dia, ...horas) => horas.map((h) => em(`2026-03-${dia}T${h}:00`));

  test('corta o que cai no silêncio', () => {
    const r = aplicarLimites(
      instantesDoDia('10', '03', '09', '15'),
      { quietStart: '00:00', quietEnd: '07:00' },
    );
    assert.equal(r.mantidos.length, 2);
    assert.equal(r.silencio, 1);
  });

  test('corta o que passa do teto diário', () => {
    const r = aplicarLimites(
      instantesDoDia('10', '09', '12', '15', '18'),
      { dailyLimit: 2 },
    );
    assert.equal(r.mantidos.length, 2);
    assert.equal(r.teto, 2);
  });

  test('o teto é por dia civil, não pelo total', () => {
    const r = aplicarLimites(
      [...instantesDoDia('10', '09', '12'), ...instantesDoDia('11', '09', '12')],
      { dailyLimit: 1 },
    );
    assert.equal(r.mantidos.length, 2, 'um em cada dia');
    assert.equal(r.teto, 2);
  });

  test('o que já foi publicado no dia consome o teto', () => {
    const r = aplicarLimites(
      instantesDoDia('10', '15', '18'),
      { dailyLimit: 2 },
      { jaNoDia: { '2026-03-10': 2 } },
    );
    assert.equal(r.mantidos.length, 0, 'o dia já estava cheio');
  });

  test('sem regras nenhuma, nada é cortado', () => {
    const instantes = instantesDoDia('10', '03', '09', '15', '23');
    const r = aplicarLimites(instantes, {});
    assert.deepEqual(r.mantidos, instantes);
    assert.equal(r.silencio + r.teto, 0);
  });

  test('não altera a lista recebida', () => {
    const instantes = instantesDoDia('10', '09', '12');
    aplicarLimites(instantes, { dailyLimit: 1 });
    assert.equal(instantes.length, 2);
  });

  test('silêncio e teto combinados: silêncio não consome o teto', () => {
    // 03h cai no silêncio; não pode "gastar" a única vaga do dia
    const r = aplicarLimites(
      instantesDoDia('10', '03', '15'),
      { dailyLimit: 1, quietStart: '00:00', quietEnd: '07:00' },
    );
    assert.equal(r.mantidos.length, 1);
    assert.equal(r.mantidos[0].getHours(), 15);
  });
});

describe('recuo entre tentativas', () => {
  test('cresce a cada tentativa', () => {
    assert.equal(esperaDaTentativa(1), 30_000);
    assert.equal(esperaDaTentativa(2), 120_000);
    assert.equal(esperaDaTentativa(3), 600_000);
  });

  test('além da última mantém o maior, não quebra', () => {
    assert.equal(esperaDaTentativa(9), 600_000);
  });
});
