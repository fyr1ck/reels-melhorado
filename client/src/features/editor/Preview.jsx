import { useEffect, useRef, useState } from 'react';
import { BadgeCheck } from 'lucide-react';
import {
  CANVAS_W, CANVAS_H, computeContain, computeCover, watermarkPosition, backgroundCss, assetUrl,
} from '../../lib/canvas.js';

/**
 * Prévia do template em escala.
 *
 * Tudo é posicionado em coordenadas do canvas (1080×1920) e a folha inteira é
 * reduzida por `transform: scale`. Recalcular cada medida na escala da tela
 * acumularia arredondamento e a prévia sairia diferente do render — aqui a
 * matemática é idêntica à do servidor, só o zoom muda.
 */
export default function Preview({ config, videoSrc, width = 300 }) {
  const escala = width / CANVAS_W;
  const videoRef = useRef(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  useEffect(() => { setDims({ w: 0, h: 0 }); }, [videoSrc]);

  const { profile = {}, title = {}, videoContainer = {}, background = {}, watermark = {} } = config;

  const cw = videoContainer.width ?? 960;
  const ch = videoContainer.height ?? 1200;

  // Sem as dimensões reais do vídeo ainda, mostra a caixa inteira: melhor que
  // piscar um enquadramento errado até o metadata carregar.
  const box = dims.w && dims.h
    ? (videoContainer.fit === 'cover' ? computeCover : computeContain)(dims.w, dims.h, cw, ch)
    : { width: cw, height: ch, offsetX: 0, offsetY: 0 };

  const wm = watermark.enabled ? watermarkPosition(watermark.position, watermark.size, watermark.margin) : null;
  const logo = assetUrl(watermark.logoUrl);
  const foto = assetUrl(profile.photoUrl);

  return (
    <div className="pv" style={{ width, height: CANVAS_H * escala }}>
      <div
        className="pv__canvas"
        style={{
          width: CANVAS_W,
          height: CANVAS_H,
          transform: `scale(${escala})`,
          background: backgroundCss(background),
        }}
      >
        {background.type === 'image' && background.imageUrl && (
          <img className="pv__bg" src={assetUrl(background.imageUrl)} alt="" />
        )}

        {/* Cabeçalho: foto, nome e @ — o bloco que identifica a página */}
        <div className="pv__profile" style={{ left: profile.posX ?? 60, top: profile.posY ?? 70 }}>
          {foto ? (
            <img src={foto} alt="" style={{ width: profile.avatarSize ?? 110, height: profile.avatarSize ?? 110 }} />
          ) : (
            <span className="pv__avatar" style={{ width: profile.avatarSize ?? 110, height: profile.avatarSize ?? 110 }} />
          )}
          <div className="pv__names" style={{ fontSize: profile.fontSize ?? 38 }}>
            <b>
              {profile.name || 'Nome da página'}
              {profile.verified && <BadgeCheck size={(profile.fontSize ?? 38) * 0.9} />}
            </b>
            <span>@{profile.username || 'usuario'}</span>
          </div>
        </div>

        <div
          className="pv__title"
          style={{
            left: title.posX ?? 60,
            top: title.posY ?? 220,
            width: title.width ?? 960,
            fontSize: title.fontSize ?? 62,
            fontWeight: title.fontWeight ?? 800,
            textAlign: title.align ?? 'left',
            color: title.color ?? '#111',
            lineHeight: title.lineHeight ?? 1.15,
          }}
        >
          {title.text || 'Título da publicação'}
        </div>

        <div
          className="pv__box"
          style={{
            left: videoContainer.x ?? 60,
            top: videoContainer.y ?? 470,
            width: cw,
            height: ch,
            borderRadius: videoContainer.borderRadius ?? 28,
            boxShadow: videoContainer.shadowEnabled
              ? `0 ${(videoContainer.shadowBlur ?? 40) / 2}px ${videoContainer.shadowBlur ?? 40}px rgba(0,0,0,${videoContainer.shadowOpacity ?? 0.35})`
              : 'none',
          }}
        >
          {videoSrc ? (
            <video
              ref={videoRef}
              src={videoSrc}
              muted
              loop
              autoPlay
              playsInline
              onLoadedMetadata={(e) => setDims({ w: e.target.videoWidth, h: e.target.videoHeight })}
              style={{
                width: box.width, height: box.height,
                marginLeft: box.offsetX, marginTop: box.offsetY,
              }}
            />
          ) : (
            <span className="pv__placeholder">vídeo</span>
          )}
        </div>

        {wm && logo && (
          <img
            className="pv__wm"
            src={logo}
            alt=""
            style={{ left: wm.x, top: wm.y, width: watermark.size, opacity: watermark.opacity ?? 0.85 }}
          />
        )}
      </div>
    </div>
  );
}
