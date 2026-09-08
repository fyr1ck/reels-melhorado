import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { wrap } from '../middleware/errors.js';
import * as whatsapp from '../../core/whatsapp/index.js';
import { soDigitos } from '../../core/whatsapp/commands.js';
import { ValidationError } from '../../lib/errors.js';
import * as v from '../../lib/validate.js';

const router = Router();

/** Estado atual: ligado, número, conexão e se há QR esperando leitura. */
router.get('/', wrap(async (req, res) => {
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  res.json({
    habilitado: !!s?.whatsappEnabled,
    numero: s?.whatsappNumber ?? null,
    semJanela: s?.whatsappHeadless !== false,
    ...whatsapp.client.situacao(),
    comandos: whatsapp.COMANDOS.map((c) => ({ nome: c.nome, descricao: c.descricao })),
  });
}));

router.patch('/', wrap(async (req, res) => {
  const data = {};

  if (req.body.enabled !== undefined) {
    data.whatsappEnabled = v.bool(req.body.enabled, { field: 'WhatsApp' });
  }
  if (req.body.headless !== undefined) {
    data.whatsappHeadless = v.bool(req.body.headless, { field: 'Sem janela' });
  }

  if (req.body.numero !== undefined) {
    const bruto = soDigitos(req.body.numero);
    if (bruto) {
      // O número PRECISA trazer o código do país. Sem ele, o WhatsApp abre uma
      // conversa que não existe e as mensagens somem em silêncio — a falha só
      // apareceria no primeiro aviso que não chegasse, dias depois.
      //
      // Brasil com país e DDD dá 12 ou 13 dígitos (com ou sem o nono dígito),
      // então exigir 12 resolve. Cheguei a abrir exceção para os 11 dígitos da
      // América do Norte, e ela criava um buraco pior: os DDDs 11 a 19 são de
      // São Paulo, e "16994441788" — o número deste usuário sem o 55 — passaria
      // como se fosse +1. Proteger contra o erro real vale mais do que aceitar
      // um formato que ninguém aqui usa.
      if (bruto.length < 12 || bruto.length > 15) {
        throw new ValidationError(
          `"${req.body.numero}" não parece um número com código do país. `
          + 'No Brasil fica assim: 55 + DDD + número, por exemplo 5516994441788.',
        );
      }
      data.whatsappNumber = bruto;
    } else {
      data.whatsappNumber = null;
    }
  }

  await prisma.settings.update({ where: { id: 1 }, data });

  // Desligar não pode deixar o navegador escutando em segundo plano.
  if (data.whatsappEnabled === false) await whatsapp.desconectar();

  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  res.json({ habilitado: s.whatsappEnabled, numero: s.whatsappNumber, ...whatsapp.client.situacao() });
}));

/**
 * POST /connect — abre o WhatsApp Web.
 *
 * Responde na hora, sem esperar o QR ser lido: a leitura pode levar um minuto,
 * e segurar a requisição faria o navegador do painel desistir por timeout. A
 * tela acompanha por /qr.
 */
router.post('/connect', wrap(async (req, res) => {
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!s?.whatsappEnabled) throw new ValidationError('Ligue o WhatsApp antes de conectar.');
  if (!s.whatsappNumber) throw new ValidationError('Configure o número antes de conectar.');

  // `mostrarJanela` no corpo força a janela só desta vez, sem mudar a
  // preferência salva: é o caminho de diagnóstico quando algo não conecta.
  whatsapp.conectar({ mostrarJanela: req.body?.mostrarJanela === true ? true : undefined })
    .catch(() => { /* o estado fica em situacao() */ });
  res.json({ iniciando: true, ...whatsapp.client.situacao() });
}));

/** QR atual, em data URL. A tela consulta em laço enquanto espera a leitura. */
router.get('/qr', wrap((req, res) => {
  res.json({ qr: whatsapp.client.qrAtual(), ...whatsapp.client.situacao() });
}));

router.post('/disconnect', wrap(async (req, res) => {
  // `esquecer` apaga a sessão salva: é o caminho para trocar de telefone.
  await whatsapp.desconectar({ apagarSessao: req.body?.esquecer === true });
  res.json(whatsapp.client.situacao());
}));

/** Quais seletores casam agora. Para quando o WhatsApp mudar a interface. */
router.get('/diagnostico', wrap(async (req, res) => {
  res.json(await whatsapp.client.diagnostico());
}));

/**
 * GET /conversa — os últimos balões, com a direção de cada um.
 *
 * É o que mostra, de fora, se o bot está lendo as próprias mensagens.
 */
router.get('/conversa', wrap(async (req, res) => {
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!s?.whatsappNumber) throw new ValidationError('Nenhum número configurado.');
  res.json(await whatsapp.client.espiarConversa(s.whatsappNumber));
}));

/** Manda uma mensagem de teste para o número configurado. */
router.post('/test', wrap(async (req, res) => {
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!s?.whatsappNumber) throw new ValidationError('Nenhum número configurado.');
  if (!whatsapp.client.conectado()) throw new ValidationError('WhatsApp não está conectado.');

  await whatsapp.client.enviar(s.whatsappNumber, [
    '🧪 *Teste do Reels Manager*',
    '',
    'Se você recebeu isto, os avisos e os comandos funcionam.',
    'Mande *menu* para ver o que dá para fazer.',
  ].join('\n'));

  res.json({ ok: true });
}));

/**
 * POST /simulate — roda um comando SEM WhatsApp, e devolve a resposta.
 *
 * Serve para conferir o que cada comando responde antes de conectar, e para
 * diagnosticar quando a resposta que chega no celular não é a esperada.
 */
router.post('/simulate', wrap(async (req, res) => {
  const texto = String(req.body.texto ?? '');
  const cmd = whatsapp.interpretar(texto);

  res.json({
    reconhecido: !!cmd,
    comando: cmd,
    resposta: cmd
      ? await whatsapp.responder(cmd)
      : 'Não entendi. Mande *menu* para ver o que dá para fazer.',
  });
}));

export default router;
