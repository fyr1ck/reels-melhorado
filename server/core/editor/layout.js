// Formato de exportação do Editor em Massa. Fixo em 1080x1920 (9:16),
// o formato padrão de Reels do Instagram.
export const CANVAS_W = 1080;
export const CANVAS_H = 1920;

/**
 * Configuração padrão de um novo template. Espelha exatamente a estrutura
 * usada pelo cliente (editor visual) e pelo processador FFmpeg — qualquer
 * campo novo deve ser adicionado aqui e nos dois consumidores.
 */
export function defaultTemplateConfig() {
  return {
    profile: {
      photoUrl: null,
      name: 'Meu Perfil',
      username: '@meuusuario',
      verified: true,
      avatarSize: 64,
      fontSize: 30,
      posX: 40,
      posY: 50,
    },
    title: {
      text: 'Digite o título ou chamada do post aqui.',
      fontSize: 34,
      fontWeight: 700,
      align: 'left',
      color: '#0b0d12',
      posX: 40,
      posY: 190,
      width: 1000,
      lineHeight: 1.25,
    },
    videoContainer: {
      x: 0,
      y: 340,
      width: 1080,
      height: 1460,
      borderRadius: 24,
      // contain (padrão, nunca corta) | cover (preencher cortando) | blurred (fundo desfocado do próprio vídeo)
      fit: 'contain',
      shadowEnabled: false,
      shadowBlur: 30,
      shadowOpacity: 0.35,
    },
    background: {
      // color | gradient | image | blurred (fundo = vídeo desfocado ocupando a tela toda)
      type: 'color',
      color: '#ffffff',
      gradientFrom: '#141821',
      gradientTo: '#3a2f66',
      gradientAngle: 180,
      imageUrl: null,
    },
    watermark: {
      enabled: false,
      logoUrl: null,
      position: 'bottom-right', // top-left | top-right | bottom-left | bottom-right
      opacity: 0.9,
      size: 90,
      margin: 24,
    },
    audio: {
      preserveOriginal: true,
    },
    export: {
      quality: 'balanced', // high | balanced | small
      filenamePattern: '{name}_editado',
    },
  };
}

/** Faz merge raso+profundo simples do config salvo com os defaults, para
 * tolerar templates antigos criados antes de um novo campo existir. */
export function mergeTemplateConfig(partial) {
  const base = defaultTemplateConfig();
  if (!partial || typeof partial !== 'object') return base;
  const out = {};
  for (const key of Object.keys(base)) {
    out[key] = { ...base[key], ...(partial[key] && typeof partial[key] === 'object' ? partial[key] : {}) };
  }
  return out;
}

/**
 * Calcula escala/posição para encaixar (object-fit: contain) um vídeo de
 * vidW x vidH dentro de uma caixa boxW x boxH, SEM cortar e SEM distorcer.
 * Sempre par (largura/altura pares), exigência do codec H.264 (yuv420p).
 */
export function computeContain(vidW, vidH, boxW, boxH) {
  const scale = Math.min(boxW / vidW, boxH / vidH);
  let width = Math.round((vidW * scale) / 2) * 2;
  let height = Math.round((vidH * scale) / 2) * 2;
  width = Math.max(2, Math.min(width, boxW));
  height = Math.max(2, Math.min(height, boxH));
  const offsetX = Math.round((boxW - width) / 2);
  const offsetY = Math.round((boxH - height) / 2);
  return { width, height, offsetX, offsetY };
}

/**
 * Calcula escala/posição para preencher (object-fit: cover) uma caixa
 * boxW x boxH a partir de um vídeo vidW x vidH, cortando o excedente.
 * Só é usado quando o usuário escolhe explicitamente "Preencher cortando".
 */
export function computeCover(vidW, vidH, boxW, boxH) {
  const scale = Math.max(boxW / vidW, boxH / vidH);
  let width = Math.round((vidW * scale) / 2) * 2;
  let height = Math.round((vidH * scale) / 2) * 2;
  const cropX = Math.round(Math.max(0, (width - boxW) / 2));
  const cropY = Math.round(Math.max(0, (height - boxH) / 2));
  return { width, height, cropX, cropY };
}

/** Retorna a posição (x, y) do canto superior-esquerdo da marca d'água,
 * dado o canto escolhido, seu tamanho e a margem. */
export function computeWatermarkPosition(position, size, margin, canvasW = CANVAS_W, canvasH = CANVAS_H) {
  switch (position) {
    case 'top-left':
      return { x: margin, y: margin };
    case 'top-right':
      return { x: canvasW - size - margin, y: margin };
    case 'bottom-left':
      return { x: margin, y: canvasH - size - margin };
    case 'bottom-right':
    default:
      return { x: canvasW - size - margin, y: canvasH - size - margin };
  }
}

export const QUALITY_PRESETS = {
  high: { crf: 18, audioBitrate: '192k' },
  balanced: { crf: 23, audioBitrate: '128k' },
  small: { crf: 28, audioBitrate: '96k' },
};

/** Aplica o padrão de nome de arquivo configurado no template ao resultado. */
export function applyFilenamePattern(pattern, originalBaseName, templateName) {
  const safeTemplate = (templateName || 'template').replace(/[^a-zA-Z0-9-_]+/g, '-').toLowerCase();
  const p = pattern && pattern.includes('{name}') ? pattern : '{name}_editado';
  return p.replace('{name}', originalBaseName).replace('{template}', safeTemplate);
}
