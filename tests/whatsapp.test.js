import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizar, soDigitos, mesmoNumero, interpretar, textoDoMenu, COMANDOS,
} from '../server/core/whatsapp/commands.js';

describe('normalizar', () => {
  test('tira acento, caixa e espaço sobrando', () => {
    assert.equal(normalizar('  PRÓXIMO  '), 'proximo');
    assert.equal(normalizar('Situação'), 'situacao');
    assert.equal(normalizar('pausar    @memes'), 'pausar @memes');
  });

  test('entrada vazia ou nula não quebra', () => {
    assert.equal(normalizar(''), '');
    assert.equal(normalizar(undefined), '');
    assert.equal(normalizar(null), 'null');
  });
});

describe('mesmoNumero', () => {
  const meu = '5516994441788';

  test('igual é igual', () => {
    assert.equal(mesmoNumero(meu, meu), true);
  });

  test('ignora símbolos e espaços de formatação', () => {
    assert.equal(mesmoNumero(meu, '+55 16 99444-1788'), true);
    assert.equal(mesmoNumero(meu, '(16) 99444-1788'), false, 'sem o país não dá para afirmar');
  });

  test('aceita o mesmo número sem o nono dígito', () => {
    // O WhatsApp ora inclui, ora não. Exigir igualdade exata faria o painel
    // ignorar o próprio dono metade das vezes.
    assert.equal(mesmoNumero(meu, '551694441788'), true);
  });

  test('recusa DDD diferente com final igual', () => {
    assert.equal(mesmoNumero(meu, '5511994441788'), false);
  });

  test('recusa outro número', () => {
    assert.equal(mesmoNumero(meu, '5511987654321'), false);
  });

  test('vazio nunca casa', () => {
    assert.equal(mesmoNumero(meu, ''), false);
    assert.equal(mesmoNumero('', meu), false);
    assert.equal(mesmoNumero('', ''), false);
  });

  test('soDigitos', () => {
    assert.equal(soDigitos('+55 (16) 99444-1788'), '5516994441788');
    assert.equal(soDigitos('abc'), '');
  });
});

describe('interpretar', () => {
  test('comandos simples', () => {
    assert.deepEqual(interpretar('menu'), { comando: 'menu', conta: null });
    assert.deepEqual(interpretar('STATUS'), { comando: 'status', conta: null });
    assert.deepEqual(interpretar('próximo'), { comando: 'proximo', conta: null });
    assert.deepEqual(interpretar('  fila  '), { comando: 'fila', conta: null });
  });

  test('apelidos que a pessoa escreve com pressa', () => {
    assert.equal(interpretar('para')?.comando, 'pausar');
    assert.equal(interpretar('stop')?.comando, 'pausar');
    assert.equal(interpretar('retomar')?.comando, 'ativar');
    assert.equal(interpretar('?')?.comando, 'menu');
  });

  test('verbo com conta', () => {
    assert.deepEqual(interpretar('pausar @memes'), { comando: 'pausar', conta: 'memes' });
    assert.deepEqual(interpretar('ativar memes_br'), { comando: 'ativar', conta: 'memes_br' });
  });

  test('conversa normal NÃO vira comando', () => {
    // O caso que importa: "oi" abre o menu, mas "oi, tudo bem?" é conversa.
    // Casar a primeira palavra de qualquer frase faria um bom dia pausar a
    // operação inteira.
    assert.equal(interpretar('oi')?.comando, 'menu', 'oi sozinho abre o menu');
    assert.equal(interpretar('oi tudo bem como foi seu dia'), null);
    assert.equal(interpretar('vou ali comprar pão'), null);
    assert.equal(interpretar('para de chover ai?'), null, 'para + resto não é comando');
  });

  test('mensagem vazia é ignorada', () => {
    assert.equal(interpretar(''), null);
    assert.equal(interpretar('   '), null);
    assert.equal(interpretar(undefined), null);
  });

  test('comandos sem argumento não capturam o resto da frase', () => {
    // "fila" aceita só a palavra; "fila de banco" não é pedido de fila.
    assert.equal(interpretar('fila de banco'), null);
  });
});

describe('menu', () => {
  test('lista todos os comandos menos o próprio menu', () => {
    const texto = textoDoMenu();
    for (const c of COMANDOS) {
      if (c.nome === 'menu') continue;
      assert.ok(texto.includes(c.nome), `faltou "${c.nome}" no menu`);
    }
  });

  test('deixa claro que só um número é atendido', () => {
    assert.match(textoDoMenu(), /Só este número é atendido/);
  });

  test('nenhum comando destrutivo é oferecido', () => {
    // Trava de projeto: apagar não é reversível, e uma mensagem de WhatsApp é
    // fácil demais de mandar por engano.
    const proibidos = ['apagar', 'excluir', 'remover', 'deletar', 'limpar'];
    for (const c of COMANDOS) {
      for (const p of proibidos) {
        assert.ok(!c.nome.includes(p), `comando destrutivo exposto: ${c.nome}`);
        assert.ok(!c.aliases.some((a) => a.includes(p)), `alias destrutivo em ${c.nome}`);
      }
    }
  });
});
