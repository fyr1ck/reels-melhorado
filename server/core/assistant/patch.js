import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../../config/env.js';
import { ValidationError } from '../../lib/errors.js';
import { permitido, ler } from './context.js';
import * as logger from '../log.js';

/**
 * Aplica correções no código-fonte — e desfaz.
 *
 * Escrever num arquivo que o app está executando é a operação mais perigosa
 * deste projeto: uma correção errada pode deixar o painel sem subir, e aí não
 * há interface para consertar a interface. Três garantias, portanto:
 *
 * 1. O trecho antigo precisa bater EXATAMENTE e aparecer UMA vez só. Se o
 *    arquivo mudou desde a análise, ou se o trecho é ambíguo, a correção é
 *    recusada em vez de aplicada no lugar errado.
 * 2. O arquivo original é copiado antes de qualquer escrita.
 * 3. Toda aplicação vira uma entrada no histórico, com botão de desfazer.
 */

const BACKUPS = () => path.join(config.paths.data, 'assistente-backups');
const HISTORICO = () => path.join(config.paths.data, 'assistente-historico.json');

function lerHistorico() {
  try {
    const h = JSON.parse(fs.readFileSync(HISTORICO(), 'utf8'));
    return Array.isArray(h) ? h : [];
  } catch {
    return [];
  }
}

function gravarHistorico(lista) {
  fs.mkdirSync(path.dirname(HISTORICO()), { recursive: true });
  fs.writeFileSync(HISTORICO(), JSON.stringify(lista.slice(0, 100), null, 2));
}

export function historico() {
  return lerHistorico();
}

/**
 * Confere se uma correção pode ser aplicada, sem aplicar.
 *
 * Separado de `aplicar` para a interface poder mostrar "esta não bate mais"
 * ANTES de o usuário clicar — e para a aplicação em lote poder verificar
 * todas antes de escrever a primeira.
 */
export function verificar(correcao) {
  const { arquivo, trechoAntigo, trechoNovo } = correcao ?? {};

  if (!arquivo || typeof trechoAntigo !== 'string' || typeof trechoNovo !== 'string') {
    return { ok: false, motivo: 'Correção incompleta: falta arquivo, trecho antigo ou novo.' };
  }
  if (!permitido(arquivo)) {
    return { ok: false, motivo: `Fora do alcance do assistente: ${arquivo}` };
  }

  const conteudo = ler(arquivo);
  if (conteudo === null) {
    return { ok: false, motivo: `Não foi possível ler ${arquivo}.` };
  }
  if (trechoAntigo === trechoNovo) {
    return { ok: false, motivo: 'O trecho novo é igual ao antigo — nada a fazer.' };
  }

  const ocorrencias = conteudo.split(trechoAntigo).length - 1;
  if (ocorrencias === 0) {
    return {
      ok: false,
      motivo: 'O trecho a substituir não existe mais no arquivo. Ele pode ter sido editado depois da análise — peça uma análise nova.',
    };
  }
  if (ocorrencias > 1) {
    return {
      ok: false,
      motivo: `O trecho aparece ${ocorrencias} vezes no arquivo. Aplicar acertaria o lugar errado.`,
    };
  }

  return { ok: true, conteudo };
}

/**
 * Aplica UMA correção. Devolve o id da entrada no histórico, para desfazer.
 */
export function aplicar(correcao, { errorId = null, causa = null } = {}) {
  const check = verificar(correcao);
  if (!check.ok) throw new ValidationError(check.motivo);

  const { arquivo, trechoAntigo, trechoNovo } = correcao;
  const absoluto = path.resolve(config.raiz, arquivo);

  // Backup ANTES de escrever. O nome carrega data e um sufixo aleatório para
  // duas correções no mesmo arquivo no mesmo segundo não se sobrescreverem.
  fs.mkdirSync(BACKUPS(), { recursive: true });
  const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
  const nomeBackup = `${arquivo.replace(/[\\/]/g, '__')}.${carimbo}.${crypto.randomBytes(3).toString('hex')}.bak`;
  fs.writeFileSync(path.join(BACKUPS(), nomeBackup), check.conteudo);

  fs.writeFileSync(absoluto, check.conteudo.replace(trechoAntigo, trechoNovo));

  const entrada = {
    id: crypto.randomUUID(),
    arquivo,
    backup: nomeBackup,
    errorId,
    causa,
    porque: correcao.porque ?? null,
    linhasAntes: trechoAntigo.split('\n').length,
    linhasDepois: trechoNovo.split('\n').length,
    aplicadoEm: new Date().toISOString(),
    desfeitoEm: null,
  };

  const lista = lerHistorico();
  lista.unshift(entrada);
  gravarHistorico(lista);

  logger.warn({
    action: 'ASSISTENTE_APLICOU',
    message: `${arquivo}: ${correcao.porque ?? causa ?? 'correção do assistente'}`,
  });

  return entrada;
}

/**
 * Desfaz uma aplicação, restaurando o arquivo como estava.
 *
 * Restaura o conteúdo INTEIRO do backup, não só o trecho: se houve edição
 * depois, ela se perde — mas o objetivo aqui é voltar a um estado que
 * funcionava, e um desfazer parcial poderia deixar o arquivo num meio-termo
 * que não roda.
 */
export function desfazer(id) {
  const lista = lerHistorico();
  const entrada = lista.find((e) => e.id === id);

  if (!entrada) throw new ValidationError('Essa aplicação não está no histórico.');
  if (entrada.desfeitoEm) throw new ValidationError('Essa correção já foi desfeita.');

  const backup = path.join(BACKUPS(), entrada.backup);
  if (!fs.existsSync(backup)) {
    throw new ValidationError('O arquivo de backup sumiu — não dá para desfazer com segurança.');
  }
  if (!permitido(entrada.arquivo)) {
    throw new ValidationError(`Fora do alcance do assistente: ${entrada.arquivo}`);
  }

  fs.writeFileSync(path.resolve(config.raiz, entrada.arquivo), fs.readFileSync(backup, 'utf8'));
  entrada.desfeitoEm = new Date().toISOString();
  gravarHistorico(lista);

  logger.warn({
    action: 'ASSISTENTE_DESFEZ',
    message: `${entrada.arquivo} voltou ao estado anterior à correção.`,
  });

  return entrada;
}
