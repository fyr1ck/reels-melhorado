import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { wrap } from '../middleware/errors.js';
import * as assistant from '../../core/assistant/index.js';
import { ValidationError } from '../../lib/errors.js';
import * as v from '../../lib/validate.js';

const router = Router();

/** Estado do assistente. A chave nunca sai daqui — só se existe. */
router.get('/', wrap(async (req, res) => {
  res.json(await assistant.estado());
}));

router.patch('/', wrap(async (req, res) => {
  const data = {};

  if (req.body.enabled !== undefined) {
    data.assistantEnabled = v.bool(req.body.enabled, { field: 'Assistente' });
  }
  if (req.body.autoApply !== undefined) {
    data.assistantAutoApply = v.bool(req.body.autoApply, { field: 'Aplicar automaticamente' });
  }
  if (req.body.model !== undefined) {
    data.assistantModel = v.oneOf(
      req.body.model,
      assistant.claude.MODELOS.map((m) => m.id),
      { field: 'Modelo' },
    );
  }
  if (req.body.apiKey !== undefined) {
    const k = v.str(req.body.apiKey, { field: 'Chave da API', min: 0, max: 200 });
    // Formato conferido na entrada: uma chave colada pela metade só daria erro
    // 401 na primeira análise, longe de onde foi digitada.
    if (k && !/^sk-ant-/.test(k)) {
      throw new ValidationError('A chave da Anthropic começa com "sk-ant-". Confira o que foi colado.');
    }
    data.assistantApiKey = k || null;
  }

  await prisma.settings.update({ where: { id: 1 }, data });
  res.json(await assistant.estado());
}));

/** Erros capturados, do mais recente para o mais antigo. */
router.get('/errors', wrap(async (req, res) => {
  res.json(assistant.capture.listar());
}));

router.delete('/errors', wrap(async (req, res) => {
  res.json(assistant.capture.limpar({ apenasResolvidos: req.query.apenasResolvidos === '1' }));
}));

/** Marca como ignorado, para sair da lista sem virar correção. */
router.post('/errors/:id/ignore', wrap(async (req, res) => {
  const e = assistant.capture.atualizar(req.params.id, { estado: 'IGNORADO' });
  if (!e) throw new ValidationError('Erro não encontrado.');
  res.json(e);
}));

/** Manda o erro para o Claude e guarda a análise. */
router.post('/errors/:id/analyze', wrap(async (req, res) => {
  res.json(await assistant.analisar(req.params.id));
}));

/** Aplica as correções propostas. `indices` escolhe quais. */
router.post('/errors/:id/apply', wrap(async (req, res) => {
  const indices = Array.isArray(req.body.indices) ? req.body.indices : null;
  res.json(assistant.aplicar(req.params.id, { indices }));
}));

/**
 * Prévia do que seria enviado.
 *
 * Existe para o usuário poder VER o que sai da máquina dele antes de a
 * primeira chamada acontecer — inclusive para conferir que nenhum arquivo
 * sensível entrou no pacote.
 */
router.get('/errors/:id/prompt', wrap(async (req, res) => {
  const erro = assistant.capture.buscar(req.params.id);
  if (!erro) throw new ValidationError('Erro não encontrado.');
  res.json({ prompt: assistant.montarPrompt(erro) });
}));

/** Histórico de correções aplicadas, com o que foi mexido. */
router.get('/history', wrap((req, res) => {
  res.json(assistant.patch.historico());
}));

router.post('/history/:id/undo', wrap((req, res) => {
  res.json(assistant.patch.desfazer(req.params.id));
}));

/**
 * POST /client-error — o painel manda o que quebrou no navegador.
 *
 * O stack do cliente aponta para arquivos de `client/src`, que também fazem
 * parte do projeto: um erro de React é tão corrigível quanto um do servidor.
 */
router.post('/client-error', wrap(async (req, res) => {
  const registrado = await assistant.registrarSeLigado({
    origem: 'PAINEL',
    mensagem: String(req.body.message ?? 'erro no painel').slice(0, 2000),
    stack: String(req.body.stack ?? '').slice(0, 6000),
    contexto: { rota: String(req.body.route ?? '').slice(0, 200) },
  });
  res.json({ registrado: !!registrado });
}));

export default router;
