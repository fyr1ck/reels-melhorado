import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { config } from '../server/config/env.js';
import { permitido, arquivosDoStack, trecho } from '../server/core/assistant/context.js';
import { extrairJson } from '../server/core/assistant/claude.js';
import { assinatura } from '../server/core/assistant/capture.js';
import * as patch from '../server/core/assistant/patch.js';

describe('alcance do assistente', () => {
  test('aceita código do projeto', () => {
    assert.equal(permitido('server/core/log.js'), true);
    assert.equal(permitido('client/src/app/App.jsx'), true);
    assert.equal(permitido('client/src/design/ui.css'), true);
    assert.equal(permitido('prisma/schema.prisma'), true);
  });

  test('recusa o que guarda segredo ou estado', () => {
    assert.equal(permitido('.env'), false, 'a chave da API mora aqui');
    assert.equal(permitido('prisma/data/app.db'), false, 'é o banco');
    assert.equal(permitido('playwright/session/abc/state.json'), false, 'são os cookies do Instagram');
    assert.equal(permitido('node_modules/express/index.js'), false);
    assert.equal(permitido('.git/config'), false);
  });

  test('recusa sair da raiz do projeto', () => {
    // O ".." resolvido é o que impede ler o disco inteiro; comparar por
    // prefixo textual deixaria isto passar.
    assert.equal(permitido('../../.ssh/id_rsa'), false);
    assert.equal(permitido('server/../../segredo.js'), false);
    assert.equal(permitido('C:/Windows/System32/drivers/etc/hosts'), false);
  });

  test('recusa extensão que não é código', () => {
    assert.equal(permitido('videos/pending/reel.mp4'), false);
    assert.equal(permitido('server/core/log.txt'), false);
  });
});

describe('arquivosDoStack', () => {
  test('acha os arquivos do projeto e ignora o resto', () => {
    const raiz = config.raiz.replace(/\\/g, '/');
    const stack = [
      'TypeError: x is not a function',
      `    at algo (${raiz}/server/core/log.js:12:5)`,
      '    at node:internal/process/task_queues:95:5',
      `    at outro (${raiz}/node_modules/express/lib/router.js:47:3)`,
      `    at mais (${raiz}/server/app.js:30:1)`,
    ].join('\n');

    const r = arquivosDoStack(stack);
    assert.deepEqual(r.map((x) => x.arquivo), ['server/core/log.js', 'server/app.js']);
    assert.equal(r[0].linha, 12);
  });

  test('entende o formato file:// do ESM', () => {
    const raiz = config.raiz.replace(/\\/g, '/');
    const stack = `    at file:///${raiz}/server/core/log.js:8:20`;
    assert.equal(arquivosDoStack(stack)[0]?.arquivo, 'server/core/log.js');
  });

  test('não repete o mesmo arquivo', () => {
    const raiz = config.raiz.replace(/\\/g, '/');
    const stack = [
      `    at a (${raiz}/server/app.js:10:1)`,
      `    at b (${raiz}/server/app.js:20:1)`,
    ].join('\n');
    assert.equal(arquivosDoStack(stack).length, 1);
  });

  test('stack vazio não quebra', () => {
    assert.deepEqual(arquivosDoStack(''), []);
    assert.deepEqual(arquivosDoStack(undefined), []);
  });
});

describe('trecho', () => {
  test('numera as linhas com o número real do arquivo', () => {
    const conteudo = Array.from({ length: 100 }, (_, i) => `linha ${i + 1}`).join('\n');
    const t = trecho(conteudo, 50, 2);
    // margem 2 = 2 linhas antes + a linha do erro + 2 depois
    assert.equal(t.split('\n').length, 5);
    assert.match(t, /48\| linha 48/);
    assert.match(t, /50\| linha 50/);
    assert.match(t, /52\| linha 52/);
    assert.doesNotMatch(t, /47\| linha 47/);
  });
});

describe('assinatura de erro', () => {
  test('o mesmo erro com ids diferentes tem a mesma assinatura', () => {
    // Sem isto, um bug em loop viraria centenas de entradas — e centenas de
    // chamadas pagas à API.
    const a = assinatura('Vídeo 3f2b1a9c-1111-2222-3333-444455556666 não encontrado', '');
    const b = assinatura('Vídeo 9a8b7c6d-9999-8888-7777-666655554444 não encontrado', '');
    assert.equal(a, b);
  });

  test('erros diferentes têm assinaturas diferentes', () => {
    assert.notEqual(assinatura('falta arquivo', ''), assinatura('conta desconectada', ''));
  });
});

describe('extrairJson', () => {
  test('JSON puro', () => {
    assert.deepEqual(extrairJson('{"causa":"x"}'), { causa: 'x' });
  });

  test('embrulhado em cerca de markdown', () => {
    assert.deepEqual(extrairJson('```json\n{"causa":"x"}\n```'), { causa: 'x' });
  });

  test('com texto antes e depois', () => {
    assert.deepEqual(extrairJson('Claro! Aqui vai:\n{"causa":"x"}\nEspero ter ajudado.'), { causa: 'x' });
  });

  test('sem JSON nenhum vira erro claro', () => {
    assert.throws(() => extrairJson('não consegui'), /formato inesperado/);
  });
});

describe('aplicar correção', () => {
  const alvo = 'server/__teste_assistente__.js';
  const absoluto = path.join(config.raiz, alvo);
  const ORIGINAL = 'export const a = 1;\nexport const b = 2;\nexport const c = 1;\n';

  // O histórico do assistente é um arquivo de verdade, que a tela do painel
  // lê. Sem guardar e devolver, rodar os testes encheria a interface do
  // usuário com entradas de arquivos que nunca existiram.
  const historicoPath = path.join(config.paths.data, 'assistente-historico.json');
  let historicoAntes = null;

  beforeEach(() => {
    try { historicoAntes = fs.readFileSync(historicoPath, 'utf8'); } catch { historicoAntes = null; }
    fs.writeFileSync(absoluto, ORIGINAL);
  });

  afterEach(() => {
    try { fs.unlinkSync(absoluto); } catch { /* já removido */ }

    if (historicoAntes === null) {
      try { fs.unlinkSync(historicoPath); } catch { /* nunca existiu */ }
    } else {
      fs.writeFileSync(historicoPath, historicoAntes);
    }

    // Os backups gerados no teste também: são cópias de um arquivo de mentira.
    const dirBackups = path.join(config.paths.data, 'assistente-backups');
    try {
      for (const f of fs.readdirSync(dirBackups)) {
        if (f.startsWith('server____teste_assistente__')) fs.unlinkSync(path.join(dirBackups, f));
      }
    } catch { /* pasta ainda não existe */ }
  });

  test('aplica e desfaz, voltando ao conteúdo original', () => {
    const entrada = patch.aplicar({
      arquivo: alvo,
      trechoAntigo: 'export const b = 2;',
      trechoNovo: 'export const b = 42;',
      porque: 'teste',
    });

    assert.match(fs.readFileSync(absoluto, 'utf8'), /b = 42/);
    patch.desfazer(entrada.id);
    assert.equal(fs.readFileSync(absoluto, 'utf8'), ORIGINAL);
  });

  test('recusa trecho que aparece mais de uma vez', () => {
    // "= 1;" está em duas linhas: aplicar acertaria a errada.
    const r = patch.verificar({ arquivo: alvo, trechoAntigo: '= 1;', trechoNovo: '= 9;' });
    assert.equal(r.ok, false);
    assert.match(r.motivo, /2 vezes/);
  });

  test('recusa trecho que não existe mais', () => {
    const r = patch.verificar({ arquivo: alvo, trechoAntigo: 'const z = 0;', trechoNovo: 'x' });
    assert.equal(r.ok, false);
    assert.match(r.motivo, /não existe mais/);
  });

  test('recusa arquivo fora do alcance', () => {
    assert.equal(patch.verificar({ arquivo: '.env', trechoAntigo: 'a', trechoNovo: 'b' }).ok, false);
    assert.equal(patch.verificar({ arquivo: '../fora.js', trechoAntigo: 'a', trechoNovo: 'b' }).ok, false);
  });

  test('recusa correção que não muda nada', () => {
    const r = patch.verificar({ arquivo: alvo, trechoAntigo: 'const b = 2;', trechoNovo: 'const b = 2;' });
    assert.equal(r.ok, false);
    assert.match(r.motivo, /igual ao antigo/);
  });

  test('não desfaz duas vezes', () => {
    const e = patch.aplicar({ arquivo: alvo, trechoAntigo: 'const b = 2;', trechoNovo: 'const b = 3;' });
    patch.desfazer(e.id);
    assert.throws(() => patch.desfazer(e.id), /já foi desfeita/);
  });
});
