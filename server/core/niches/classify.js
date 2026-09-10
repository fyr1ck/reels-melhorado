import path from 'path';
import { prisma } from '../../db/prisma.js';
import * as logger from '../log.js';
import * as claude from '../assistant/claude.js';
import {
  contextoDe, ranquear, decidir, compatibilidadeDaConta,
} from './classifier.js';

/**
 * A ponte entre o classificador puro e o resto do app.
 *
 * Só isto conhece banco, IA e configuração. `classifier.js` continua sem saber
 * que qualquer um deles existe — é o que permite testá-lo sem subir nada.
 *
 * NADA aqui publica, agenda ou move arquivo. A classificação grava seu
 * resultado numa tabela própria e vai embora; quem publica continua sendo o
 * agendador que já existia.
 */

export const STATUS = {
  APROVADO: 'APROVADO',
  REVISAO: 'REVISAO',
  BLOQUEADO: 'BLOQUEADO',
  SEM_CLASSIFICACAO: 'SEM_CLASSIFICACAO',
};

/** Nota abaixo da qual nem vale falar em nicho: é "não sei", não "não pode". */
const PISO_PARA_TER_NICHO = 20;

export async function config() {
  const s = await prisma.settings.findUnique({ where: { id: 1 } });
  return {
    ligado: !!s?.nicheEnabled,
    bloquear: s?.nicheBlockPublish !== false,
    usarIa: !!s?.nicheUseAi,
    approve: s?.nicheApproveScore ?? 90,
    review: s?.nicheReviewScore ?? 70,
    modelo: s?.assistantModel || 'claude-sonnet-5',
  };
}

/**
 * De onde veio o vídeo, para a pasta poder virar pista.
 *
 * Procura a pasta monitorada de origem; se o vídeo não veio de uma, usa a
 * pasta do próprio arquivo. Nunca falha: pista que não dá para levantar só
 * significa uma evidência a menos.
 */
async function pastaDe(video) {
  const importado = await prisma.importedFile
    .findUnique({ where: { videoId: video.id }, include: { watchFolder: true } })
    .catch(() => null);

  if (importado?.watchFolder?.path) return importado.watchFolder.path;
  return video.filepath ? path.dirname(video.filepath) : '';
}

/**
 * Pergunta ao Claude quando as regras não bastam.
 *
 * Só é chamada com a classificação por regras JÁ PRONTA, e o resultado dela é
 * uma correção, não uma substituição: se a API falhar, cair ou responder
 * torto, o que já foi calculado continua valendo. Uma fila que para porque a
 * API de IA ficou fora do ar seria pior do que não ter IA nenhuma.
 */
async function refinarComIa({ contexto, niches, ranking, modelo, videoName }) {
  const resumo = niches.map((n) => ({
    id: n.id,
    nome: n.name,
    descricao: n.description || '',
    subnichos: n.subniches,
    palavrasChave: n.keywords,
    palavrasProibidas: n.bannedKeywords,
    temasPermitidos: n.allowedThemes,
    temasProibidos: n.bannedThemes,
    regras: n.customRules,
    publico: n.audience || '',
    tom: n.tone || '',
    rigor: n.strictness,
  }));

  const system = `Você classifica vídeos curtos em nichos definidos por um usuário.

Recebe o que se sabe do vídeo (nome do arquivo, legenda, pasta de origem) e a lista de nichos
cadastrados, com as regras que o usuário escreveu. Devolve a compatibilidade de 0 a 100 com CADA
nicho, e o motivo.

Regras:

1. Julgue pelo CONTEÚDO. A pasta é pista fraca: um vídeo na pasta errada continua sendo do
   assunto que ele é.
2. As "regras" de cada nicho são do usuário e valem mais que sua opinião. Se o vídeo viola uma
   regra, diga qual e derrube a nota.
3. Nota alta exige evidência. Nome de arquivo genérico ("video_2847.mp4"), sem legenda, não dá
   para classificar: devolva notas baixas em vez de chutar.
4. Motivos em português do Brasil, curtos, concretos, um por linha do array. Nada de "o conteúdo
   parece relacionado": diga QUAL palavra ou tema levou à conclusão.

Responda SÓ com JSON válido, sem cercas de markdown:

{
  "nichos": [{ "id": "...", "score": 0, "motivos": ["...", "..."] }],
  "observacao": "uma frase, ou string vazia"
}`;

  const prompt = [
    '## Vídeo',
    `nome do arquivo: ${contexto.nomeOriginal}`,
    `legenda: ${contexto.legendaOriginal || '(sem legenda)'}`,
    `pasta de origem: ${contexto.pastaOriginal || '(desconhecida)'}`,
    '',
    '## Nichos cadastrados',
    JSON.stringify(resumo, null, 2),
    '',
    '## Classificação por regras (para você conferir, não para copiar)',
    JSON.stringify(ranking.map((r) => ({ id: r.nicheId, nome: r.name, score: r.score })), null, 2),
  ].join('\n');

  const { texto } = await claude.conversar({ system, prompt, modelo, maxTokens: 2000 });
  const json = claude.extrairJson(texto);

  if (!Array.isArray(json?.nichos)) throw new Error('resposta sem a lista de nichos');

  const porId = new Map(json.nichos.map((n) => [n.id, n]));

  return ranking.map((r) => {
    const daIa = porId.get(r.nicheId);
    if (!daIa || !Number.isFinite(Number(daIa.score))) return r;

    return {
      ...r,
      score: Math.max(0, Math.min(100, Math.round(Number(daIa.score)))),
      motivos: Array.isArray(daIa.motivos) && daIa.motivos.length
        ? daIa.motivos.map(String)
        : r.motivos,
    };
  }).sort((a, b) => (b.score - a.score) || (b.priority - a.priority));
}

/**
 * Classifica UM vídeo e grava o resultado.
 *
 * Devolve a classificação. Nunca lança por causa da IA: erro de API vira aviso
 * no log e a nota das regras prevalece.
 */
export async function classificar(videoOuId, { forcarIa = null } = {}) {
  const video = typeof videoOuId === 'string'
    ? await prisma.video.findUnique({ where: { id: videoOuId } })
    : videoOuId;

  if (!video) return null;

  const cfg = await config();
  const niches = await prisma.niche.findMany({ where: { active: true } });

  // Sem nicho cadastrado não há o que classificar — e isso NÃO é bloqueio.
  // Quem ainda não cadastrou nicho nenhum tem de continuar publicando.
  if (!niches.length) {
    return gravar(video.id, {
      nicheId: null, score: 0, status: STATUS.SEM_CLASSIFICACAO,
      scores: [], reasons: ['Nenhum nicho cadastrado ainda.'],
      recommendedAccountId: null, source: 'REGRAS',
    });
  }

  const folderPath = await pastaDe(video);
  const contexto = contextoDe({
    filename: video.filename,
    caption: video.caption || '',
    folderPath,
  });
  // Guarda os originais para o prompt: a IA lê melhor o texto como ele é do
  // que a versão sem acento que as regras usam.
  contexto.nomeOriginal = video.filename;
  contexto.legendaOriginal = video.caption || '';
  contexto.pastaOriginal = folderPath;

  let ranking = ranquear(contexto, niches);
  let source = 'REGRAS';

  const querIa = forcarIa ?? cfg.usarIa;
  if (querIa && await claude.configurado()) {
    try {
      ranking = await refinarComIa({ contexto, niches, ranking, modelo: cfg.modelo, videoName: video.filename });
      source = 'IA';
    } catch (err) {
      await logger.warn({
        action: 'NICHO_IA_FALHOU', videoName: video.filename,
        message: `A classificação seguiu só com as regras: ${err.message}`,
      });
    }
  }

  const topo = ranking[0];
  const temNicho = topo && topo.score >= PISO_PARA_TER_NICHO;

  const status = temNicho
    ? decidir(topo.score, { approve: cfg.approve, review: cfg.review })
    : STATUS.SEM_CLASSIFICACAO;

  const recommendedAccountId = temNicho ? await melhorConta(topo.nicheId) : null;

  return gravar(video.id, {
    nicheId: temNicho ? topo.nicheId : null,
    score: topo?.score ?? 0,
    status,
    scores: ranking.map((r) => ({ nicheId: r.nicheId, name: r.name, score: r.score, motivos: r.motivos })),
    reasons: temNicho ? topo.motivos : ['Nenhum nicho cadastrado teve compatibilidade suficiente.'],
    recommendedAccountId,
    source,
  });
}

/** A conta mais compatível com um nicho: principal na frente da secundária. */
export async function melhorConta(nicheId) {
  const vinculos = await prisma.accountNiche.findMany({
    where: { nicheId },
    include: { account: { select: { id: true, enabled: true } } },
  });

  const elegiveis = vinculos.filter((v) => v.account?.enabled);
  if (!elegiveis.length) return null;

  elegiveis.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  return elegiveis[0].accountId;
}

async function gravar(videoId, dados) {
  const payload = {
    nicheId: dados.nicheId,
    score: dados.score,
    status: dados.status,
    scores: JSON.stringify(dados.scores ?? []),
    reasons: JSON.stringify(dados.reasons ?? []),
    recommendedAccountId: dados.recommendedAccountId,
    source: dados.source,
  };

  return prisma.contentClassification.upsert({
    where: { videoId },
    create: { videoId, ...payload },
    update: payload,
  });
}

/**
 * Classifica em lote, sem derrubar o lote por causa de um vídeo.
 *
 * Um vídeo que falha vira aviso e o laço segue: classificar 300 vídeos e
 * perder tudo no de número 47 seria inaceitável.
 */
export async function classificarVarios(videoIds, opcoes = {}) {
  const out = { ok: 0, falhas: 0 };

  for (const id of videoIds) {
    try {
      await classificar(id, opcoes);
      out.ok++;
    } catch (err) {
      out.falhas++;
      await logger.warn({ action: 'NICHO_CLASSIFICACAO_FALHOU', message: `${id}: ${err.message}` });
    }
  }
  return out;
}

/**
 * Classifica sem interromper quem chamou.
 *
 * Usada nos pontos de ENTRADA do vídeo (upload, pasta monitorada, editor). O
 * upload não pode ficar mais lento — nem falhar — porque a classificação
 * demorou ou porque a API de IA caiu. Por isso roda solta e engole o erro:
 * vídeo sem classificação é um caso previsto, e a tela de nichos deixa
 * reclassificar depois.
 */
export function classificarEmSegundoPlano(videoIds) {
  if (!videoIds?.length) return;

  Promise.resolve()
    .then(async () => {
      const cfg = await config();
      if (!cfg.ligado) return;
      await classificarVarios(videoIds);
    })
    .catch(() => { /* já registrado por classificarVarios */ });
}
