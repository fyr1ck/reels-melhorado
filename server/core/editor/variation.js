/**
 * Variação entre cópias de um mesmo template.
 *
 * Sem isso, processar N vídeos com o mesmo template produz saídas com o
 * enquadramento idêntico ao pixel. A variação desloca e redimensiona o
 * container do vídeo dentro de uma margem pequena o bastante para não
 * estragar a composição.
 *
 * O que ela NÃO faz: nada aqui mascara origem, remove marca d'água nem tenta
 * enganar detecção de conteúdo duplicado. É variação estética — do tipo que um
 * editor humano produziria ao montar o mesmo formato várias vezes.
 *
 * IMPORTANTE: só mexe em `videoContainer`, porque é o que o pipeline de
 * ffmpeg realmente lê (ver buildFfmpegArgs). Uma versão anterior escrevia em
 * `config.video.zoom` e `config.export.speed` — campos que não existem no
 * template. O log dizia "zoom +3%" e o arquivo saía idêntico.
 */

/** Limites estreitos de propósito: passar disso vira erro de composição. */
export const LIMITES = {
  escalaPct: 3,   // até 3% no tamanho do container
  deslocPx: 14,   // até 14px de deslocamento em cada eixo
};

function entre(random, min, max) {
  return min + random() * (max - min);
}

export function sortearVariacao(random = Math.random) {
  return {
    escala: 1 + entre(random, -LIMITES.escalaPct, LIMITES.escalaPct) / 100,
    deslocX: Math.round(entre(random, -LIMITES.deslocPx, LIMITES.deslocPx)),
    deslocY: Math.round(entre(random, -LIMITES.deslocPx, LIMITES.deslocPx)),
  };
}

/** Variação neutra: usada quando `varyOutputs` está desligado. */
export const SEM_VARIACAO = { escala: 1, deslocX: 0, deslocY: 0 };

/** Dimensão par — o encoder H.264 rejeita largura ou altura ímpar. */
const par = (n) => Math.max(2, Math.round(n / 2) * 2);

/**
 * Aplica a variação sobre a config, devolvendo uma cópia.
 *
 * Nunca muta a original: o mesmo template serve todos os itens do lote, e
 * mutar faria a variação de um item vazar para o seguinte.
 */
export function aplicarVariacao(config, variacao) {
  if (!variacao || variacao === SEM_VARIACAO) return config;

  const vc = config.videoContainer ?? {};
  const largura = par((vc.width ?? 1080) * variacao.escala);
  const altura = par((vc.height ?? 1350) * variacao.escala);

  return {
    ...config,
    videoContainer: {
      ...vc,
      width: largura,
      height: altura,
      // Compensa metade do crescimento para o container não escapar do canvas
      // ao ampliar: sem isso, escala positiva empurraria tudo para a direita.
      x: Math.round((vc.x ?? 0) - (largura - (vc.width ?? 1080)) / 2 + variacao.deslocX),
      y: Math.round((vc.y ?? 0) - (altura - (vc.height ?? 1350)) / 2 + variacao.deslocY),
    },
  };
}

/** Descreve a variação para o painel e o log. */
export function descrever(variacao) {
  if (!variacao || variacao === SEM_VARIACAO) return 'sem variação';
  const partes = [];
  if (variacao.escala !== 1) {
    partes.push(`escala ${variacao.escala > 1 ? '+' : ''}${((variacao.escala - 1) * 100).toFixed(1)}%`);
  }
  if (variacao.deslocX || variacao.deslocY) partes.push(`desloc ${variacao.deslocX},${variacao.deslocY}px`);
  return partes.join(' · ') || 'sem variação';
}
