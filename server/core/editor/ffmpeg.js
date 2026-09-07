import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { CANVAS_W, CANVAS_H, computeContain, computeCover, QUALITY_PRESETS } from './layout.js';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

/** Lê largura/altura/duração/fps do vídeo de origem via ffprobe. */
export function probeVideo(filepath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filepath, (err, data) => {
      if (err) return reject(err);
      const stream = data.streams.find((s) => s.codec_type === 'video');
      if (!stream) return reject(new Error('Nenhuma faixa de vídeo encontrada no arquivo.'));
      const [num, den] = (stream.r_frame_rate || '30/1').split('/').map(Number);
      const fps = den ? num / den : 30;
      const hasAudio = data.streams.some((s) => s.codec_type === 'audio');
      resolve({
        width: stream.width,
        height: stream.height,
        duration: Number(data.format?.duration) || null,
        fps: Number.isFinite(fps) && fps > 0 ? fps : 30,
        hasAudio,
      });
    });
  });
}

/**
 * Monta os argumentos completos de linha de comando do FFmpeg para aplicar
 * um template a UM vídeo. Todas as camadas estáticas (background, shadow,
 * mask, overlay) já foram renderizadas uma única vez por job (reelRenderer.js)
 * e são reaproveitadas aqui como imagens de entrada.
 */
export function buildFfmpegArgs({ sourcePath, outputPath, videoMeta, config, layers }) {
  const { videoContainer, background, audio, export: exportCfg } = config;
  const cw = Math.round(videoContainer.width / 2) * 2;
  const ch = Math.round(videoContainer.height / 2) * 2;
  const cx = Math.round(videoContainer.x);
  const cy = Math.round(videoContainer.y);
  const radius = Math.max(0, Math.round(videoContainer.borderRadius || 0));
  const fit = videoContainer.fit || 'contain';

  const inputs = ['-i', sourcePath];
  let nextIdx = 1;
  const idx = {};

  if (layers.backgroundPath) {
    inputs.push('-loop', '1', '-i', layers.backgroundPath);
    idx.background = nextIdx++;
  }
  if (layers.shadowPath) {
    inputs.push('-loop', '1', '-i', layers.shadowPath);
    idx.shadow = nextIdx++;
  }
  if (layers.maskPath) {
    inputs.push('-loop', '1', '-i', layers.maskPath);
    idx.mask = nextIdx++;
  }
  inputs.push('-loop', '1', '-i', layers.overlayPath);
  idx.overlay = nextIdx++;

  // Quantos ramos precisamos derivar do vídeo original (0:v): o vídeo
  // "nítido" principal sempre, mais um ramo desfocado extra para cada
  // modo de fundo desfocado ativo (canvas inteiro e/ou dentro do container).
  const needCanvasBlur = background.type === 'blurred';
  const needContainerBlur = fit === 'blurred';
  const branchCount = 1 + (needCanvasBlur ? 1 : 0) + (needContainerBlur ? 1 : 0);

  const chains = [];
  let mainLabel;
  let canvasBlurLabel;
  let containerBlurLabel;

  if (branchCount > 1) {
    const outLabels = ['vmain'];
    if (needCanvasBlur) outLabels.push('vcanvasblur');
    if (needContainerBlur) outLabels.push('vcontainerblur');
    chains.push(`[0:v]split=${branchCount}${outLabels.map((l) => `[${l}]`).join('')}`);
    mainLabel = 'vmain';
    canvasBlurLabel = needCanvasBlur ? 'vcanvasblur' : null;
    containerBlurLabel = needContainerBlur ? 'vcontainerblur' : null;
  } else {
    mainLabel = '0:v';
  }

  // ---- 1) Fundo de tela cheia (1080x1920) ----
  let bgLabel;
  if (background.type === 'blurred') {
    chains.push(
      `[${canvasBlurLabel}]scale=${CANVAS_W}:${CANVAS_H}:force_original_aspect_ratio=increase,crop=${CANVAS_W}:${CANVAS_H},gblur=sigma=30,eq=brightness=-0.15,format=rgba[bgbase]`
    );
    bgLabel = 'bgbase';
  } else if (layers.backgroundPath) {
    chains.push(`[${idx.background}:v]format=rgba[bgbase]`);
    bgLabel = 'bgbase';
  } else {
    chains.push(`color=c=black@1.0:s=${CANVAS_W}x${CANVAS_H}:d=1,format=rgba[bgbase]`);
    bgLabel = 'bgbase';
  }

  // ---- 2) Conteúdo do container (vídeo original, nunca cortado no modo padrão) ----
  let containerLabel;
  if (fit === 'cover') {
    const cover = computeCover(videoMeta.width, videoMeta.height, cw, ch);
    chains.push(`[${mainLabel}]scale=${cover.width}:${cover.height},crop=${cw}:${ch}:${cover.cropX}:${cover.cropY},format=rgba[cfilled]`);
    containerLabel = 'cfilled';
  } else {
    const contain = computeContain(videoMeta.width, videoMeta.height, cw, ch);
    chains.push(`[${mainLabel}]scale=${contain.width}:${contain.height}[fgscaled]`);

    let baseLabel;
    if (fit === 'blurred') {
      chains.push(
        `[${containerBlurLabel}]scale=${cw}:${ch}:force_original_aspect_ratio=increase,crop=${cw}:${ch},gblur=sigma=24,eq=brightness=-0.12,format=rgba[cbase]`
      );
      baseLabel = 'cbase';
    } else {
      chains.push(`color=c=black@0.0:s=${cw}x${ch}:d=1,format=rgba[cbase]`);
      baseLabel = 'cbase';
    }
    chains.push(`[${baseLabel}][fgscaled]overlay=${contain.offsetX}:${contain.offsetY}:format=auto[cfilled]`);
    containerLabel = 'cfilled';
  }

  // ---- 3) Cantos arredondados do container (se houver raio configurado) ----
  if (idx.mask !== undefined) {
    chains.push(`[${containerLabel}]format=rgba[cfilled_rgba]`);
    chains.push(`[cfilled_rgba][${idx.mask}:v]alphamerge[crounded]`);
    containerLabel = 'crounded';
  }

  // ---- 4) Compõe: fundo -> sombra -> container -> header/título/marca d'água ----
  let compositeLabel = bgLabel;
  let stepCounter = 0;
  if (idx.shadow !== undefined) {
    chains.push(`[${compositeLabel}][${idx.shadow}:v]overlay=0:0[cstep${stepCounter}]`);
    compositeLabel = `cstep${stepCounter++}`;
  }
  chains.push(`[${compositeLabel}][${containerLabel}]overlay=${cx}:${cy}[cstep${stepCounter}]`);
  compositeLabel = `cstep${stepCounter++}`;
  chains.push(`[${compositeLabel}][${idx.overlay}:v]overlay=0:0:format=auto[vout]`);

  const filterComplex = chains.join(';');

  const preset = QUALITY_PRESETS[exportCfg?.quality] || QUALITY_PRESETS.balanced;
  const outFps = videoMeta.fps && videoMeta.fps <= 60 ? Math.round(videoMeta.fps) : 30;

  const args = [
    '-y',
    ...inputs,
    '-filter_complex', filterComplex,
    '-map', '[vout]',
  ];

  if (audio?.preserveOriginal !== false && videoMeta.hasAudio) {
    args.push('-map', '0:a?', '-c:a', 'aac', '-b:a', preset.audioBitrate);
  } else {
    args.push('-an');
  }

  args.push(
    '-r', String(outFps),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', String(preset.crf),
    '-preset', 'veryfast',
    '-movflags', '+faststart',
    '-shortest',
  );

  // As imagens de fundo/sombra/máscara/overlay são fontes "infinitas"
  // (-loop 1 ou color source), então o -shortest sozinho pode deixar
  // alguns frames extras vazarem por causa do buffer do filtro. Travar a
  // duração exata do vídeo original garante que a saída não fique mais
  // longa (nem mais curta) do que o original.
  if (videoMeta.duration) {
    args.push('-t', videoMeta.duration.toFixed(3));
  }

  args.push(outputPath);

  return args;
}

/**
 * Executa o FFmpeg para um único vídeo. `onProgress(percent)` é chamado
 * periodicamente. Retorna um objeto com `cancel()` para abortar o processo
 * sem corromper arquivos (o output parcial é removido).
 */
export function runFfmpegJob({ sourcePath, outputPath, videoMeta, config, layers, onProgress }) {
  const args = buildFfmpegArgs({ sourcePath, outputPath, videoMeta, config, layers });
  const totalMs = (videoMeta.duration || 0) * 1000;

  let proc;
  let cancelled = false;

  const promise = new Promise((resolve, reject) => {
    proc = spawn(ffmpegInstaller.path, ['-progress', 'pipe:1', '-nostats', ...args]);

    let stderrTail = '';
    proc.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-4000);
    });

    let buffer = '';
    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const m = line.match(/^out_time_ms=(\d+)/);
        if (m && totalMs > 0 && onProgress) {
          const pct = Math.min(99, Math.max(0, Math.round((Number(m[1]) / 1000 / totalMs) * 100)));
          onProgress(pct);
        }
      }
    });

    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (cancelled) {
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch { /* ignore */ }
        return reject(new Error('CANCELLED'));
      }
      if (code === 0) return resolve({ ok: true });
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch { /* ignore */ }
      reject(new Error(stderrTail.trim().split('\n').slice(-4).join(' | ') || `FFmpeg saiu com código ${code}`));
    });
  });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      proc?.kill('SIGKILL');
    },
  };
}

export function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

export function ensureEvenDims(w, h) {
  return { width: Math.round(w / 2) * 2, height: Math.round(h / 2) * 2 };
}

export { CANVAS_W, CANVAS_H };
