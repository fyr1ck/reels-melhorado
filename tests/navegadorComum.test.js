import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { candidatos, localizar, cookiesDoInstagram } from '../server/core/accounts/navegadorComum.js';

/**
 * O login pelo navegador comum.
 *
 * Só as partes puras: abrir e fechar um navegador de verdade depende da
 * máquina. O que interessa garantir aqui é o que decide O QUE entra no
 * arquivo de sessão e QUAL navegador é aberto.
 */

describe('cookiesDoInstagram', () => {
  const cookies = [
    { domain: '.instagram.com', name: 'sessionid' },
    { domain: 'www.instagram.com', name: 'csrftoken' },
    { domain: 'instagram.com', name: 'mid' },
    { domain: '.login.live.com', name: '.MSA.Auth' },
    { domain: '.bing.com', name: 'MUID' },
    { domain: 'www.google.com', name: '_GRECAPTCHA' },
    { domain: '.facebook.com', name: 'datr' },
  ];

  test('guarda só o que é do Instagram', () => {
    assert.deepEqual(
      cookiesDoInstagram(cookies).map((c) => c.name),
      ['sessionid', 'csrftoken', 'mid'],
    );
  });

  test('conta Microsoft e busca não entram no arquivo de sessão', () => {
    const nomes = cookiesDoInstagram(cookies).map((c) => c.name);
    assert.ok(!nomes.includes('.MSA.Auth'));
    assert.ok(!nomes.includes('MUID'));
  });

  test('domínio que só TERMINA parecido não passa', () => {
    // "fakeinstagram.com" termina em "instagram.com" como texto, mas é outro
    // site. O filtro exige o ponto antes.
    const r = cookiesDoInstagram([{ domain: 'fakeinstagram.com', name: 'x' }]);
    assert.deepEqual(r, []);
  });

  test('lista vazia ou ausente não quebra', () => {
    assert.deepEqual(cookiesDoInstagram(undefined), []);
    assert.deepEqual(cookiesDoInstagram([]), []);
  });
});

describe('localizar', () => {
  const env = {
    LOCALAPPDATA: 'C:\\Users\\X\\AppData\\Local',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  };

  test('prefere o Brave quando ele está instalado', { skip: process.platform !== 'win32' }, () => {
    const achado = localizar({ env, existe: (p) => /brave\.exe$/i.test(p) || /msedge\.exe$/i.test(p) });
    assert.match(achado, /brave\.exe$/i);
  });

  test('cai no Edge quando não há Brave nem Chrome', { skip: process.platform !== 'win32' }, () => {
    const achado = localizar({ env, existe: (p) => /msedge\.exe$/i.test(p) });
    assert.match(achado, /msedge\.exe$/i);
  });

  test('sem navegador nenhum devolve null, e o login usa a janela automatizada', () => {
    assert.equal(localizar({ env, existe: () => false }), null);
  });

  test('NAVEGADOR_LOGIN no .env vence qualquer suposição', () => {
    const lista = candidatos({ ...env, NAVEGADOR_LOGIN: 'D:\\Portable\\chrome.exe' });
    assert.equal(lista[0], 'D:\\Portable\\chrome.exe');
  });
});
