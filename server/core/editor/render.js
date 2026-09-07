import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { CANVAS_W, CANVAS_H } from './layout.js';

let browserPromise = null;

/**
 * Navegador Chromium headless dedicado à renderização de camadas (PNG) do
 * Editor em Massa. É separado do browserManager.js (que controla a sessão
 * autenticada do Instagram) porque tem uma responsabilidade totalmente
 * diferente — gerar imagens offline — e não deve depender de sessão do
 * Instagram nem competir com uma publicação em andamento.
 */
async function getRenderBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
  }
  return browserPromise;
}

export async function closeRenderBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close().catch(() => {});
    browserPromise = null;
  }
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fileToDataUrl(filepath) {
  if (!filepath || !fs.existsSync(filepath)) return null;
  const ext = path.extname(filepath).toLowerCase().replace('.', '');
  const mime = ext === 'jpg' ? 'jpeg' : ext || 'png';
  const data = fs.readFileSync(filepath).toString('base64');
  return `data:image/${mime};base64,${data}`;
}

async function screenshotHtml(browser, { width, height, html, omitBackground }) {
  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.setContent(html, { waitUntil: 'load' });
    // dá um instante para fontes/imagens embutidas (data URL) terminarem de decodificar
    await page.waitForTimeout(60);
    return await page.screenshot({ omitBackground: !!omitBackground });
  } finally {
    await page.close().catch(() => {});
  }
}

function backgroundCss(background) {
  if (background.type === 'gradient') {
    return `linear-gradient(${background.gradientAngle ?? 180}deg, ${background.gradientFrom}, ${background.gradientTo})`;
  }
  if (background.type === 'image' && background.imageUrl) {
    return `#000`;
  }
  return background.color || '#000000';
}

/**
 * Renderiza o fundo estático de tela cheia (cor sólida, gradiente ou
 * imagem enviada). Não é chamado quando background.type === 'blurred',
 * pois nesse modo o fundo vem do próprio vídeo (gerado pelo FFmpeg).
 */
async function renderBackground(browser, background, assetResolver) {
  const bgImageData = background.type === 'image' ? fileToDataUrl(assetResolver(background.imageUrl)) : null;
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;width:${CANVAS_W}px;height:${CANVAS_H}px;overflow:hidden;}
    .bg{position:absolute;inset:0;width:${CANVAS_W}px;height:${CANVAS_H}px;background:${backgroundCss(background)};}
    .bg img{width:100%;height:100%;object-fit:cover;display:block;}
  </style></head><body>
    <div class="bg">${bgImageData ? `<img src="${bgImageData}" />` : ''}</div>
  </body></html>`;
  return screenshotHtml(browser, { width: CANVAS_W, height: CANVAS_H, html, omitBackground: false });
}

/** Máscara branca (opaca) em cantos arredondados sobre fundo preto —
 * usada com `alphamerge` no FFmpeg para arredondar o container de vídeo. */
async function renderMask(browser, width, height, borderRadius) {
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;width:${width}px;height:${height}px;background:#000;overflow:hidden;}
    .m{position:absolute;inset:0;width:${width}px;height:${height}px;background:#fff;border-radius:${borderRadius}px;}
  </style></head><body><div class="m"></div></body></html>`;
  return screenshotHtml(browser, { width, height, html, omitBackground: false });
}

/** Sombra suave (CSS box-shadow) do container, em PNG transparente,
 * posicionada nas mesmas coordenadas do container dentro do canvas cheio. */
async function renderShadow(browser, videoContainer) {
  const { x, y, width, height, borderRadius, shadowBlur, shadowOpacity } = videoContainer;
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;width:${CANVAS_W}px;height:${CANVAS_H}px;overflow:hidden;background:transparent;}
    .s{position:absolute;left:${x}px;top:${y}px;width:${width}px;height:${height}px;border-radius:${borderRadius}px;
       box-shadow:0 ${Math.round(shadowBlur / 2)}px ${shadowBlur}px rgba(0,0,0,${shadowOpacity});background:rgba(0,0,0,0.001);}
  </style></head><body><div class="s"></div></body></html>`;
  return screenshotHtml(browser, { width: CANVAS_W, height: CANVAS_H, html, omitBackground: true });
}

/** Camada superior: header (foto de perfil, nome, selo, username), título
 * do post e marca d'água — tudo sobre fundo 100% transparente. */
async function renderOverlay(browser, config, assetResolver) {
  const { profile, title, watermark } = config;
  const avatarData = fileToDataUrl(assetResolver(profile.photoUrl));
  const logoData = watermark.enabled ? fileToDataUrl(assetResolver(watermark.logoUrl)) : null;

  const avatarHtml = avatarData
    ? `<img src="${avatarData}" style="width:${profile.avatarSize}px;height:${profile.avatarSize}px;border-radius:50%;object-fit:cover;display:block;flex-shrink:0;" />`
    : `<div style="width:${profile.avatarSize}px;height:${profile.avatarSize}px;border-radius:50%;background:#d9d9de;flex-shrink:0;"></div>`;

  const verifiedBadge = profile.verified
    ? `<svg width="${Math.round(profile.fontSize * 0.72)}" height="${Math.round(profile.fontSize * 0.72)}" viewBox="0 0 24 24" style="flex-shrink:0;">
         <circle cx="12" cy="12" r="11" fill="#3897f0"/>
         <path d="M7 12.5l3 3 7-7" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
       </svg>`
    : '';

  const headerHtml = `
    <div style="position:absolute;left:${profile.posX}px;top:${profile.posY}px;display:flex;align-items:center;gap:14px;font-family:'Inter',Arial,sans-serif;">
      ${avatarHtml}
      <div style="display:flex;flex-direction:column;gap:2px;">
        <div style="display:flex;align-items:center;gap:7px;font-size:${profile.fontSize}px;font-weight:750;color:#0b0d12;line-height:1.15;">
          <span>${escapeHtml(profile.name)}</span>${verifiedBadge}
        </div>
        <div style="font-size:${Math.round(profile.fontSize * 0.6)}px;color:#6b6f76;font-weight:500;">${escapeHtml(profile.username)}</div>
      </div>
    </div>`;

  const titleHtml = `
    <div style="position:absolute;left:${title.posX}px;top:${title.posY}px;width:${title.width}px;
      font-family:'Inter',Arial,sans-serif;font-size:${title.fontSize}px;font-weight:${title.fontWeight};
      color:${title.color};text-align:${title.align};line-height:${title.lineHeight};white-space:pre-wrap;word-wrap:break-word;">
      ${escapeHtml(title.text)}
    </div>`;

  let watermarkHtml = '';
  if (watermark.enabled && logoData) {
    const { computeWatermarkPosition } = await import('./reelLayout.js');
    const pos = computeWatermarkPosition(watermark.position, watermark.size, watermark.margin);
    watermarkHtml = `<img src="${logoData}" style="position:absolute;left:${pos.x}px;top:${pos.y}px;width:${watermark.size}px;height:${watermark.size}px;object-fit:contain;opacity:${watermark.opacity};" />`;
  }

  const html = `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;width:${CANVAS_W}px;height:${CANVAS_H}px;overflow:hidden;background:transparent;}
    @font-face{font-family:'Inter';src:local('Inter');}
  </style></head><body>
    ${headerHtml}
    ${titleHtml}
    ${watermarkHtml}
  </body></html>`;

  return screenshotHtml(browser, { width: CANVAS_W, height: CANVAS_H, html, omitBackground: true });
}

/**
 * Renderiza todas as camadas estáticas (PNG) de um template UMA VEZ por
 * job — reaproveitadas em todos os vídeos do lote, já que header, título,
 * fundo estático, sombra e máscara não dependem do vídeo em si.
 *
 * @param {object} config - config mesclado do template (ver reelLayout.js)
 * @param {string} outDir - pasta temporária do job onde os PNGs são salvos
 * @param {(relativeOrAbsolutePath:string)=>string} assetResolver - resolve
 *        um caminho de asset (foto/logo/imagem de fundo) salvo no template
 *        para um caminho absoluto em disco.
 */
export async function renderTemplateLayers(config, outDir, assetResolver) {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await getRenderBrowser();

  const layers = {};

  if (config.background.type !== 'blurred') {
    const bg = await renderBackground(browser, config.background, assetResolver);
    layers.backgroundPath = path.join(outDir, 'background.png');
    fs.writeFileSync(layers.backgroundPath, bg);
  } else {
    layers.backgroundPath = null;
  }

  if (config.videoContainer.shadowEnabled) {
    const shadow = await renderShadow(browser, config.videoContainer);
    layers.shadowPath = path.join(outDir, 'shadow.png');
    fs.writeFileSync(layers.shadowPath, shadow);
  } else {
    layers.shadowPath = null;
  }

  if (config.videoContainer.borderRadius > 0) {
    const mask = await renderMask(browser, config.videoContainer.width, config.videoContainer.height, config.videoContainer.borderRadius);
    layers.maskPath = path.join(outDir, 'mask.png');
    fs.writeFileSync(layers.maskPath, mask);
  } else {
    layers.maskPath = null;
  }

  const overlay = await renderOverlay(browser, config, assetResolver);
  layers.overlayPath = path.join(outDir, 'overlay.png');
  fs.writeFileSync(layers.overlayPath, overlay);

  return layers;
}
