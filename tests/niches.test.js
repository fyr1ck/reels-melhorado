import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizar, contem, contextoDe, pontuar, ranquear, decidir, compatibilidadeDaConta,
} from '../server/core/niches/classifier.js';
import { listaDe, regrasDe } from '../server/core/niches/niches.js';

/**
 * Testes da camada de nichos.
 *
 * Só o classificador puro é exercitado aqui: ele não toca banco, rede nem
 * disco, e é onde mora a decisão que pode mandar conteúdo para a conta errada.
 */

const emagrecimento = {
  id: 'n1',
  name: 'Emagrecimento',
  category: 'Saúde',
  subniches: 'dieta, jejum intermitente',
  keywords: 'emagrecer, perder peso, gordura abdominal, dieta, calorias',
  bannedKeywords: 'remédio milagroso, emagreça em 3 dias',
  allowedThemes: 'alimentação, exercício',
  bannedThemes: '',
  customRules: 'Não aceitar promessas de perda de peso rápida.',
  strictness: 'MEDIO',
  priority: 10,
};

const religiao = {
  id: 'n2',
  name: 'Religião',
  category: 'Fé',
  subniches: 'mensagens religiosas',
  keywords: 'oração, fé, deus, versículo, salmo',
  bannedKeywords: '',
  allowedThemes: 'espiritualidade',
  bannedThemes: 'palavrão, nudez',
  customRules: 'Publicar somente conteúdos relacionados à fé cristã.',
  strictness: 'ALTO',
  priority: 5,
};

describe('normalizar', () => {
  test('tira acento, pontuação e caixa', () => {
    assert.equal(normalizar('Emagreça JÁ!'), 'emagreca ja');
    assert.equal(normalizar('sertões'), 'sertoes');
  });

  test('underscore e hífen viram espaço — nome de arquivo é a fonte mais comum', () => {
    assert.equal(normalizar('perder_peso-rapido.mp4'), 'perder peso rapido mp4');
  });

  test('não quebra com vazio nem com null', () => {
    assert.equal(normalizar(null), '');
    assert.equal(normalizar(undefined), '');
  });
});

describe('contem', () => {
  test('palavra solta casa por palavra inteira, não por pedaço', () => {
    assert.equal(contem(normalizar('tomei um café'), 'fé'), false);
    assert.equal(contem(normalizar('tenha fé'), 'fé'), true);
  });

  test('expressão casa como trecho', () => {
    assert.equal(contem(normalizar('dicas de perda de peso'), 'perda de peso'), true);
  });

  test('termo vazio nunca casa', () => {
    assert.equal(contem('qualquer coisa', ''), false);
  });
});

describe('listas escritas à mão', () => {
  test('aceita vírgula, ponto e vírgula e quebra de linha', () => {
    assert.deepEqual(listaDe('a, b; c\nd'), ['a', 'b', 'c', 'd']);
  });

  test('ignora separador sobrando e espaço', () => {
    assert.deepEqual(listaDe('  a ,, b  ,'), ['a', 'b']);
  });

  test('regra é por linha: vírgula faz parte da frase', () => {
    assert.deepEqual(
      regrasDe('Não prometer resultado rápido, nem citar remédio.\nSó conteúdo próprio.'),
      ['Não prometer resultado rápido, nem citar remédio.', 'Só conteúdo próprio.'],
    );
  });
});

describe('pontuar', () => {
  test('conteúdo do nicho pontua alto e explica por quê', () => {
    const ctx = contextoDe({ filename: '5 alimentos que ajudam a emagrecer.mp4', caption: 'dieta e calorias' });
    const r = pontuar(ctx, emagrecimento);

    assert.ok(r.score >= 70, `esperava nota alta, veio ${r.score}`);
    assert.ok(r.motivos.some((m) => m.includes('palavras-chave')), 'faltou explicar as palavras-chave');
    assert.equal(r.bloqueado, false);
  });

  test('conteúdo de outro assunto fica perto de zero', () => {
    const ctx = contextoDe({ filename: 'oração da noite salmo 23.mp4' });
    assert.ok(pontuar(ctx, emagrecimento).score <= 10);
  });

  test('palavra proibida derruba a nota e aparece no motivo', () => {
    const ctx = contextoDe({ filename: 'emagreça em 3 dias com esse remédio milagroso.mp4' });
    const r = pontuar(ctx, emagrecimento);

    assert.equal(r.bloqueado, true);
    assert.ok(r.motivos.some((m) => m.includes('proibida')));
  });

  test('rigor ALTO zera com uma única violação; BAIXO só arranha', () => {
    const ctx = contextoDe({ filename: 'oração com palavrão.mp4', caption: 'fé e deus' });

    const alto = pontuar(ctx, religiao);
    const baixo = pontuar(ctx, { ...religiao, strictness: 'BAIXO' });

    assert.equal(alto.score, 0);
    assert.ok(baixo.score > alto.score, 'rigor BAIXO deveria punir menos');
  });

  test('sem regra proibida violada, isso é dito explicitamente', () => {
    const ctx = contextoDe({ filename: 'como perder peso com dieta.mp4' });
    assert.ok(pontuar(ctx, emagrecimento).motivos.includes('nenhuma regra proibida encontrada'));
  });

  test('a pasta ajuda, mas não decide sozinha', () => {
    const soPasta = contextoDe({ filename: 'video_final_2.mp4', folderPath: 'C:/videos/emagrecimento' });
    const r = pontuar(soPasta, emagrecimento);

    assert.ok(r.score > 0, 'a pasta deveria somar alguma coisa');
    assert.ok(r.score < 70, `pasta sozinha não pode aprovar; veio ${r.score}`);
  });

  test('vídeo na pasta errada ainda é reconhecido pelo conteúdo', () => {
    const ctx = contextoDe({
      filename: 'oração da noite com salmo.mp4',
      folderPath: 'C:/videos/emagrecimento',
    });
    const ranking = ranquear(ctx, [emagrecimento, religiao]);

    assert.equal(ranking[0].name, 'Religião', 'o conteúdo tem de vencer a pasta');
  });
});

describe('ranquear', () => {
  test('devolve todos os nichos, do mais para o menos compatível', () => {
    const ctx = contextoDe({ filename: '5 alimentos que ajudam a emagrecer.mp4' });
    const r = ranquear(ctx, [religiao, emagrecimento]);

    assert.equal(r.length, 2);
    assert.equal(r[0].name, 'Emagrecimento');
    assert.ok(r[0].score > r[1].score);
  });

  test('empate desempata pela prioridade do usuário', () => {
    const ctx = contextoDe({ filename: 'assunto que ninguém cadastrou.mp4' });
    const r = ranquear(ctx, [{ ...religiao, priority: 1 }, { ...emagrecimento, priority: 99 }]);

    assert.equal(r[0].name, 'Emagrecimento');
  });

  test('ordem é estável entre chamadas — senão o mesmo vídeo iria para contas diferentes', () => {
    const ctx = contextoDe({ filename: 'nada a ver.mp4' });
    const a = ranquear(ctx, [emagrecimento, religiao]).map((x) => x.name);
    const b = ranquear(ctx, [religiao, emagrecimento]).map((x) => x.name);

    assert.deepEqual(a, b);
  });

  test('sem nicho cadastrado, devolve lista vazia em vez de quebrar', () => {
    assert.deepEqual(ranquear(contextoDe({ filename: 'x.mp4' }), []), []);
  });
});

describe('decidir', () => {
  test('usa os limiares configurados', () => {
    assert.equal(decidir(95), 'APROVADO');
    assert.equal(decidir(75), 'REVISAO');
    assert.equal(decidir(40), 'BLOQUEADO');
  });

  test('limiares personalizados mudam a decisão', () => {
    assert.equal(decidir(75, { approve: 70, review: 50 }), 'APROVADO');
    assert.equal(decidir(75, { approve: 99, review: 90 }), 'BLOQUEADO');
  });

  test('a borda pertence à faixa de cima', () => {
    assert.equal(decidir(90), 'APROVADO');
    assert.equal(decidir(70), 'REVISAO');
  });
});

describe('compatibilidadeDaConta', () => {
  const vinculos = [
    { nicheId: 'n1', isPrimary: true },
    { nicheId: 'n3', isPrimary: false },
  ];

  test('nicho principal vale cheio', () => {
    assert.equal(compatibilidadeDaConta('n1', vinculos), 100);
  });

  test('secundário vale menos, mas passa', () => {
    assert.equal(compatibilidadeDaConta('n3', vinculos), 75);
  });

  test('conta sem o nicho fica em zero — é o que barra o conteúdo errado', () => {
    assert.equal(compatibilidadeDaConta('n2', vinculos), 0);
  });
});
