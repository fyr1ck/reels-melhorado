import ffmpeg from 'fluent-ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

ffmpeg.setFfprobePath(ffprobeInstaller.path);
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

/**
 * Metadados de um vídeo. Rejeita se o arquivo não for legível — o que também
 * serve de teste de integridade: um arquivo ainda sendo baixado por um
 * sincronizador de nuvem falha aqui em vez de entrar truncado na fila.
 */
export function probe(filepath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filepath, (err, data) => {
      if (err) return reject(new Error(`Vídeo ilegível: ${err.message}`));

      const stream = data.streams?.find((s) => s.codec_type === 'video');
      resolve({
        durationSec: data.format?.duration ? Number(data.format.duration) : null,
        sizeBytes: data.format?.size ? Number(data.format.size) : null,
        width: stream?.width ?? null,
        height: stream?.height ?? null,
      });
    });
  });
}
