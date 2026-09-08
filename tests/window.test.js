import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  windowOccurrences, describeWindow, minutosDoDia, dailyRate,
} from '../server/core/scheduling/slots.js';

// Meia-noite fixa: assim nenhum horário do dia é descartado por "já passou".
const AGORA = new Date('2026-06-01T00:00:00').getTime();
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

describe('minutosDoDia', () => {
  test('converte', () => {
    assert.equal(minutosDoDia('00:00'), 0);
    assert.equal(minutosDoDia('07:30'), 450);
    assert.equal(minutosDoDia('23:59'), 1439);
  });

  test('recusa inválido', () => {
    assert.equal(minutosDoDia('24:00'), null);
    assert.equal(minutosDoDia('12:60'), null);
    assert.equal(minutosDoDia('abc'), null);
    assert.equal(minutosDoDia(''), null);
  });
});

describe('windowOccurrences', () => {
  const base = { postsPerDay: 50, windowStart: '07:00', windowEnd: '23:00' };

  test('gera exatamente N por dia', () => {
    const r = windowOccurrences(base, 3, { now: AGORA });
    assert.equal(r.length, 150);
  });

  test('o primeiro sai no início da janela', () => {
    const r = windowOccurrences(base, 1, { now: AGORA });
    assert.equal(hhmm(r[0]), '07:00');
  });

  test('o último cai um intervalo ANTES do fim', () => {
    // Espaçamento uniforme também na virada do dia: se o último fosse às
    // 23:00 em ponto, a distância até o primeiro de amanhã seria de 8 horas
    // enquanto os outros ficam a 19 minutos.
    const r = windowOccurrences(base, 1, { now: AGORA });
    const ultimo = r.at(-1);
    assert.ok(ultimo.getHours() < 23, `último às ${hhmm(ultimo)} deveria ser antes das 23h`);

    const passo = 960 / 50; // 16h em minutos / 50 posts
    const esperado = 7 * 60 + 49 * passo;
    assert.equal(ultimo.getHours() * 60 + ultimo.getMinutes(), Math.floor(esperado));
  });

  test('espaçamento uniforme entre todos', () => {
    const r = windowOccurrences({ postsPerDay: 8, windowStart: '08:00', windowEnd: '16:00' }, 1, { now: AGORA });
    const gaps = r.slice(1).map((d, i) => (d - r[i]) / 60_000);
    for (const g of gaps) assert.equal(g, 60, 'oito posts em oito horas = um por hora');
  });

  test('nada cai fora da janela', () => {
    const r = windowOccurrences({ postsPerDay: 70, windowStart: '07:00', windowEnd: '23:00' }, 5, { now: AGORA });
    for (const d of r) {
      const min = d.getHours() * 60 + d.getMinutes();
      assert.ok(min >= 420 && min < 1380, `${hhmm(d)} está fora de 07:00–23:00`);
    }
  });

  test('janela que atravessa a meia-noite', () => {
    // 22:00 às 02:00 = 4 horas. Sem tratar a virada, a duração daria negativa
    // e nenhum horário sairia.
    const r = windowOccurrences({ postsPerDay: 4, windowStart: '22:00', windowEnd: '02:00' }, 1, { now: AGORA });
    assert.equal(r.length, 4);
    assert.deepEqual(r.map(hhmm), ['22:00', '23:00', '00:00', '01:00']);
  });

  test('pula o que já passou hoje', () => {
    const meioDia = new Date('2026-06-01T12:00:00').getTime();
    const r = windowOccurrences(base, 1, { now: meioDia });
    assert.ok(r.length < 50, 'a manhã já passou');
    assert.ok(r.every((d) => d.getTime() >= meioDia));
  });

  test('um post por dia não quebra', () => {
    const r = windowOccurrences({ postsPerDay: 1, windowStart: '07:00', windowEnd: '23:00' }, 2, { now: AGORA });
    assert.equal(r.length, 2);
    assert.equal(hhmm(r[0]), '07:00');
  });

  test('vem ordenado', () => {
    const r = windowOccurrences(base, 3, { now: AGORA });
    for (let i = 1; i < r.length; i++) {
      assert.ok(r[i] >= r[i - 1], 'fora de ordem');
    }
  });

  test('horário inválido devolve lista vazia em vez de datas quebradas', () => {
    assert.deepEqual(windowOccurrences({ postsPerDay: 5, windowStart: 'xx', windowEnd: '23:00' }, 1, { now: AGORA }), []);
  });

  test('postsPerDay zero ou ausente cai no mínimo de 1', () => {
    assert.equal(windowOccurrences({ postsPerDay: 0, windowStart: '07:00', windowEnd: '23:00' }, 1, { now: AGORA }).length, 1);
  });
});

describe('describeWindow', () => {
  test('mostra o intervalo em minutos', () => {
    assert.equal(
      describeWindow({ postsPerDay: 50, windowStart: '07:00', windowEnd: '23:00' }),
      '50 por dia entre 07:00 e 23:00 — um a cada 19 min',
    );
  });

  test('vira horas quando o intervalo é grande', () => {
    assert.match(describeWindow({ postsPerDay: 4, windowStart: '08:00', windowEnd: '20:00' }), /a cada 3 h$/);
  });

  test('janela inválida é dita, não escondida', () => {
    assert.equal(describeWindow({ postsPerDay: 5, windowStart: 'x', windowEnd: '23:00' }), 'janela inválida');
  });
});

describe('dailyRate no modo janela', () => {
  test('é o próprio postsPerDay', () => {
    assert.equal(dailyRate({ scheduleMode: 'WINDOW', postsPerDay: 70 }), 70);
  });

  test('os outros modos continuam como eram', () => {
    assert.equal(dailyRate({ scheduleMode: 'INTERVAL', intervalMinutes: 60 }), 24);
    assert.equal(dailyRate({ scheduleMode: 'TIMES', enabledSlots: 3 }), 3);
  });
});
