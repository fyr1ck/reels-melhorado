/**
 * Constantes e cálculos de enquadramento do canvas.
 *
 * Espelham server/core/editor/layout.js de propósito: a prévia precisa usar
 * exatamente a mesma matemática do render, senão o usuário posiciona no
 * painel e o vídeo sai diferente. Se um lado mudar, o outro precisa mudar
 * junto — por isso os valores ficam isolados aqui, e não espalhados na tela.
 */
export const CANVAS_W = 1080;
export const CANVAS_H = 1920;

/** Cabe inteiro dentro da caixa, com sobras nas laterais. */
export function computeContain(vw, vh, bw, bh) {
  const escala = Math.min(bw / vw, bh / vh);
  const width = vw * escala;
  const height = vh * escala;
  return { width, height, offsetX: (bw - width) / 2, offsetY: (bh - height) / 2 };
}

/** Preenche a caixa inteira, cortando o excedente. */
export function computeCover(vw, vh, bw, bh) {
  const escala = Math.max(bw / vw, bh / vh);
  const width = vw * escala;
  const height = vh * escala;
  return { width, height, offsetX: (bw - width) / 2, offsetY: (bh - height) / 2 };
}

export function watermarkPosition(position, size, margin) {
  const direita = CANVAS_W - size - margin;
  const baixo = CANVAS_H - size - margin;
  switch (position) {
    case 'top-left': return { x: margin, y: margin };
    case 'top-right': return { x: direita, y: margin };
    case 'bottom-left': return { x: margin, y: baixo };
    default: return { x: direita, y: baixo };
  }
}

export function backgroundCss(bg) {
  if (!bg) return '#000';
  if (bg.type === 'gradient') {
    return `linear-gradient(${bg.gradientAngle ?? 180}deg, ${bg.gradientFrom}, ${bg.gradientTo})`;
  }
  return bg.color || '#000';
}

/** URL de um recurso do template. Aceita nome de arquivo, caminho ou URL. */
export function assetUrl(name) {
  if (!name) return null;
  if (name.startsWith('http') || name.startsWith('/')) return name;
  return `/api/editor/assets/${name}`;
}
