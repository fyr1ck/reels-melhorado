import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHashtags, composeCaption, rotate, MAX_HASHTAGS } from '../server/core/library/text.js';

test('normalizeHashtags adiciona # e remove pontuação solta', () => {
  assert.deepEqual(normalizeHashtags('futebol, gols'), ['#futebol', '#gols']);
  assert.deepEqual(normalizeHashtags('#já #ação'), ['#já', '#ação']);
});

test('normalizeHashtags deduplica ignorando caixa, preservando a primeira forma', () => {
  assert.deepEqual(
    normalizeHashtags('#Copa copa COPA #futebol #futebol'),
    ['#Copa', '#futebol'],
  );
});

test('normalizeHashtags aceita separadores variados e ignora vazios', () => {
  assert.deepEqual(normalizeHashtags('  a,,b;;c\n\nd  '), ['#a', '#b', '#c', '#d']);
  assert.deepEqual(normalizeHashtags(''), []);
  assert.deepEqual(normalizeHashtags(null), []);
  assert.deepEqual(normalizeHashtags('### !!! ,,,'), []);
});

test('composeCaption separa hashtags do texto por linha em branco', () => {
  assert.equal(composeCaption('Olha isso', ['#a', '#b']), 'Olha isso\n\n#a #b');
});

test('composeCaption lida com só texto, só hashtags e nada', () => {
  assert.equal(composeCaption('Só texto', []), 'Só texto');
  assert.equal(composeCaption('', ['#a']), '#a');
  assert.equal(composeCaption('', []), '');
  assert.equal(composeCaption('   ', []), '');
});

test('composeCaption corta no limite do Instagram', () => {
  const muitas = Array.from({ length: 45 }, (_, i) => `#t${i}`);
  const saida = composeCaption('x', muitas);
  assert.equal(saida.split(' ').length - 1 + 1, MAX_HASHTAGS);
});

test('rotate percorre o pool inteiro antes de repetir', () => {
  const itens = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const saida = rotate(itens, 3, () => 0.5).map((i) => i.id);
  assert.deepEqual([...saida].sort(), ['a', 'b', 'c']);
});

test('rotate respeita o peso na proporção', () => {
  const itens = [{ id: 'pesado', weight: 3 }, { id: 'leve', weight: 1 }];
  const saida = rotate(itens, 40, () => 0.5);
  const pesado = saida.filter((i) => i.id === 'pesado').length;
  const leve = saida.filter((i) => i.id === 'leve').length;
  // 3:1 dentro de cada ciclo de 4; 40 sorteios = 10 ciclos exatos
  assert.equal(pesado, 30);
  assert.equal(leve, 10);
});

test('rotate devolve vazio sem itens ou sem contagem', () => {
  assert.deepEqual(rotate([], 5), []);
  assert.deepEqual(rotate([{ id: 'a' }], 0), []);
});

test('rotate limita o peso para um item não dominar o sorteio', () => {
  const itens = [{ id: 'a', weight: 9999 }, { id: 'b', weight: 1 }];
  const saida = rotate(itens, 11, () => 0.5);
  // peso trava em 10: ciclo de 11 tem 10 "a" e 1 "b"
  assert.equal(saida.filter((i) => i.id === 'b').length, 1);
});
