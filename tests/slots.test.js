import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyJitter, slotOccurrences, slotWindow, dailyRate, describeSlot,
} from '../server/core/scheduling/slots.js';

const AS_14H = new Date('2026-09-10T14:00:00');

test('applyJitter com 0 devolve o horário intacto', () => {
  const saida = applyJitter(AS_14H, 0, { now: Date.now() });
  assert.equal(saida.getTime(), AS_14H.getTime());
});

test('applyJitter mantém o resultado dentro da janela', () => {
  const now = new Date('2026-09-10T10:00:00').getTime();
  for (const r of [0, 0.25, 0.5, 0.75, 1]) {
    const saida = applyJitter(AS_14H, 10, { now, random: () => r });
    const desvio = Math.abs(saida.getTime() - AS_14H.getTime());
    assert.ok(desvio <= 10 * 60_000, `desvio ${desvio}ms passou de 10min`);
  }
});

test('applyJitter nunca agenda no passado', () => {
  // slot daqui a 3min com jitter de 10min: o sorteio mínimo cairia atrás de agora
  const now = new Date('2026-09-10T13:57:00').getTime();
  const saida = applyJitter(AS_14H, 10, { now, random: () => 0 });
  assert.ok(saida.getTime() >= now + 60_000, 'agendou antes do piso');
});

test('slotOccurrences pula o horário de hoje que já passou', () => {
  const now = new Date('2026-09-10T15:00:00').getTime();
  const occ = slotOccurrences('14:00', 3, { now });
  assert.equal(occ.length, 2); // hoje já passou; sobram amanhã e depois
  assert.equal(occ[0].getDate(), 11);
});

test('slotOccurrences inclui o horário de hoje que ainda vem', () => {
  const now = new Date('2026-09-10T09:00:00').getTime();
  const occ = slotOccurrences('14:00', 2, { now });
  assert.equal(occ.length, 2);
  assert.equal(occ[0].getDate(), 10);
});

test('slotWindow sem jitter compara por instante exato', () => {
  const w = slotWindow(AS_14H, 0);
  assert.equal(w.gte.getTime(), AS_14H.getTime());
  assert.equal(w.lte.getTime(), AS_14H.getTime());
});

test('slotWindow com jitter abre a janela nos dois lados', () => {
  const w = slotWindow(AS_14H, 10);
  assert.equal(AS_14H.getTime() - w.gte.getTime(), 10 * 60_000);
  assert.equal(w.lte.getTime() - AS_14H.getTime(), 10 * 60_000);
});

test('dailyRate conta os slots no modo TIMES', () => {
  assert.equal(dailyRate({ scheduleMode: 'TIMES', enabledSlots: 3 }), 3);
});

test('dailyRate divide o dia no modo INTERVAL', () => {
  assert.equal(dailyRate({ scheduleMode: 'INTERVAL', intervalMinutes: 60 }), 24);
  assert.equal(dailyRate({ scheduleMode: 'INTERVAL', intervalMinutes: 30 }), 48);
});

test('dailyRate não divide por zero com intervalo ausente', () => {
  assert.equal(dailyRate({ scheduleMode: 'INTERVAL', intervalMinutes: 0 }), 24);
});

test('describeSlot explica a janela em texto', () => {
  assert.equal(describeSlot('14:00', 0), '14:00 exato');
  assert.equal(describeSlot('14:00', 10), 'entre 13:50 e 14:10');
});

test('describeSlot dá a volta na meia-noite', () => {
  assert.equal(describeSlot('00:05', 10), 'entre 23:55 e 00:15');
});
