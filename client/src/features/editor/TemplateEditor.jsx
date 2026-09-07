import { useEffect, useRef, useState } from 'react';
import {
  Save, Trash2, Plus, Copy, Image as ImageIcon, Type, User, Square, Droplet, Upload,
} from 'lucide-react';
import { useQuery, useMutation } from '../../hooks/useQuery.js';
import { useToast } from '../../hooks/useToast.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { api } from '../../lib/api.js';
import { Card, Button, Input, Textarea, Select, Field, Checkbox, Tabs, Empty, Skeleton } from '../../design/ui.jsx';
import { assetUrl } from '../../lib/canvas.js';
import Preview from './Preview.jsx';
import './template.css';

/**
 * Editor de template.
 *
 * O estado é o objeto de config inteiro, e cada controle escreve num caminho
 * ("profile.name", "title.fontSize"). Evita um useState por campo — são mais
 * de trinta — e mantém a prévia sempre em sincronia com o que será salvo.
 */
function setIn(obj, caminho, valor) {
  const [grupo, campo] = caminho.split('.');
  return { ...obj, [grupo]: { ...obj[grupo], [campo]: valor } };
}

const ABAS = [
  { value: 'perfil', label: 'Cabeçalho', icon: User },
  { value: 'titulo', label: 'Título', icon: Type },
  { value: 'video', label: 'Vídeo', icon: Square },
  { value: 'fundo', label: 'Fundo', icon: Droplet },
  { value: 'marca', label: 'Marca d’água', icon: ImageIcon },
];

export default function TemplateEditor({ onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();

  const { data: templates, reload } = useQuery('/editor/templates');
  const { data: padrao } = useQuery('/editor/templates/default');

  const [ativo, setAtivo] = useState(null);      // id do template em edição
  const [nome, setNome] = useState('');
  const [cfg, setCfg] = useState(null);
  const [aba, setAba] = useState('perfil');
  const [sujo, setSujo] = useState(false);
  const assetRef = useRef(null);
  const [assetAlvo, setAssetAlvo] = useState(null);

  // Carrega o primeiro template, ou monta um novo a partir do padrão.
  useEffect(() => {
    if (cfg || !padrao) return;
    if (templates?.length) abrir(templates[0]);
    else { setCfg(padrao); setNome('Meu template'); }
  }, [templates, padrao]); // eslint-disable-line react-hooks/exhaustive-deps

  function abrir(t) {
    setAtivo(t.id);
    setNome(t.name);
    setCfg(JSON.parse(t.config));
    setSujo(false);
  }

  function editar(caminho, valor) {
    setCfg((c) => setIn(c, caminho, valor));
    setSujo(true);
  }

  const salvar = useMutation(async () => {
    if (ativo) {
      await api.patch(`/editor/templates/${ativo}`, { name: nome, config: cfg });
    } else {
      const novo = await api.post('/editor/templates', { name: nome, config: cfg });
      setAtivo(novo.id);
    }
    setSujo(false);
    await reload({ quiet: true });
    onChanged?.();
    toast.success('Template salvo.');
  });

  async function novo() {
    if (sujo && !(await confirm({
      title: 'Descartar alterações?',
      description: 'O template atual tem mudanças não salvas.',
      confirmLabel: 'Descartar', danger: true,
    }))) return;

    setAtivo(null);
    setCfg(padrao);
    setNome('Novo template');
    setSujo(true);
  }

  async function duplicar() {
    const copia = await api.post('/editor/templates', { name: `${nome} (cópia)`, config: cfg });
    await reload({ quiet: true });
    abrir(copia);
    toast.success('Template duplicado.');
  }

  async function remover() {
    const ok = await confirm({
      title: `Remover "${nome}"`,
      description: 'Lotes que já usaram este template continuam com o resultado gerado. Não há desfazer.',
      confirmLabel: 'Remover', danger: true,
    });
    if (!ok) return;

    await api.del(`/editor/templates/${ativo}`);
    setCfg(padrao); setAtivo(null); setNome('Novo template');
    await reload({ quiet: true });
    onChanged?.();
    toast.success('Template removido.');
  }

  /** Envia uma imagem e grava só o NOME no template. */
  async function enviarAsset(file) {
    if (!assetAlvo) return;
    const fd = new FormData();
    fd.append('asset', file);
    try {
      const r = await api.post('/editor/assets', fd);
      editar(assetAlvo, r.filename);
      toast.success('Imagem enviada.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAssetAlvo(null);
    }
  }

  function BotaoImagem({ caminho, atual, label }) {
    return (
      <Field label={label}>
        <div className="tpl-img">
          {atual ? <img src={assetUrl(atual)} alt="" /> : <span className="tpl-img__vazio"><ImageIcon size={16} /></span>}
          <Button size="sm" icon={Upload} onClick={() => { setAssetAlvo(caminho); assetRef.current?.click(); }}>
            {atual ? 'Trocar' : 'Escolher'}
          </Button>
          {atual && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => editar(caminho, null)} />}
        </div>
      </Field>
    );
  }

  if (!cfg) return <Skeleton height={420} />;

  return (
    <div className="tpl">
      <input
        ref={assetRef} type="file" accept="image/jpeg,image/png,image/webp" hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) enviarAsset(f);
        }}
      />

      <div className="tpl__side">
        <Card title="Templates" icon={Copy} action={<Button size="sm" icon={Plus} onClick={novo}>Novo</Button>}>
          {!templates?.length ? (
            <Empty icon={Copy} title="Nenhum salvo ainda">Ajuste ao lado e clique em Salvar.</Empty>
          ) : (
            <div className="tpl-list">
              {templates.map((t) => (
                <button
                  key={t.id}
                  className={`tpl-list__item${ativo === t.id ? ' is-on' : ''}`}
                  onClick={() => abrir(t)}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card title="Prévia" className="mt">
          <Preview config={cfg} width={252} />
          <p className="faint mt">
            Mesmas medidas do render: 1080×1920, só reduzido. O que aparece aqui é o que sai
            no arquivo.
          </p>
        </Card>
      </div>

      <div className="tpl__main">
        <Card>
          <div className="tpl__head">
            <Field label="Nome do template" className="tpl__nome">
              <Input value={nome} onChange={(e) => { setNome(e.target.value); setSujo(true); }} />
            </Field>
            <div className="row">
              <Button variant="primary" icon={Save} loading={salvar.busy} disabled={!sujo && !!ativo}
                      onClick={() => salvar.run().catch((e) => toast.error(e.message))}>
                {sujo ? 'Salvar' : 'Salvo'}
              </Button>
              {ativo && <Button icon={Copy} onClick={duplicar}>Duplicar</Button>}
              {ativo && <Button variant="danger" icon={Trash2} onClick={remover} />}
            </div>
          </div>
        </Card>

        <Tabs value={aba} onChange={setAba} items={ABAS} />

        <Card>
          {aba === 'perfil' && (
            <div className="grid grid--2">
              <BotaoImagem caminho="profile.photoUrl" atual={cfg.profile.photoUrl} label="Foto de perfil" />
              <Field label="Tamanho da foto" hint="Em pixels do canvas (1080 de largura).">
                <Input type="number" min={40} max={300} value={cfg.profile.avatarSize}
                       onChange={(e) => editar('profile.avatarSize', Number(e.target.value))} />
              </Field>
              <Field label="Nome exibido">
                <Input value={cfg.profile.name} onChange={(e) => editar('profile.name', e.target.value)} />
              </Field>
              <Field label="@ da página">
                <Input value={cfg.profile.username} onChange={(e) => editar('profile.username', e.target.value)} />
              </Field>
              <Field label="Posição X"><Input type="number" value={cfg.profile.posX}
                     onChange={(e) => editar('profile.posX', Number(e.target.value))} /></Field>
              <Field label="Posição Y"><Input type="number" value={cfg.profile.posY}
                     onChange={(e) => editar('profile.posY', Number(e.target.value))} /></Field>
              <Field label="Tamanho do texto"><Input type="number" value={cfg.profile.fontSize}
                     onChange={(e) => editar('profile.fontSize', Number(e.target.value))} /></Field>
              <Checkbox label="Selo de verificado" checked={cfg.profile.verified}
                        onChange={(e) => editar('profile.verified', e.target.checked)} />
            </div>
          )}

          {aba === 'titulo' && (
            <>
              <Field label="Texto" hint="Quebra de linha é respeitada no render.">
                <Textarea rows={3} value={cfg.title.text} onChange={(e) => editar('title.text', e.target.value)} />
              </Field>
              <div className="grid grid--3 mt">
                <Field label="Tamanho"><Input type="number" value={cfg.title.fontSize}
                       onChange={(e) => editar('title.fontSize', Number(e.target.value))} /></Field>
                <Field label="Peso"><Select value={cfg.title.fontWeight}
                       onChange={(e) => editar('title.fontWeight', Number(e.target.value))}>
                  {[400, 600, 700, 800, 900].map((p) => <option key={p} value={p}>{p}</option>)}
                </Select></Field>
                <Field label="Alinhamento"><Select value={cfg.title.align}
                       onChange={(e) => editar('title.align', e.target.value)}>
                  <option value="left">Esquerda</option>
                  <option value="center">Centro</option>
                  <option value="right">Direita</option>
                </Select></Field>
                <Field label="Cor"><Input type="color" value={cfg.title.color}
                       onChange={(e) => editar('title.color', e.target.value)} /></Field>
                <Field label="Posição X"><Input type="number" value={cfg.title.posX}
                       onChange={(e) => editar('title.posX', Number(e.target.value))} /></Field>
                <Field label="Posição Y"><Input type="number" value={cfg.title.posY}
                       onChange={(e) => editar('title.posY', Number(e.target.value))} /></Field>
                <Field label="Largura do bloco"><Input type="number" value={cfg.title.width}
                       onChange={(e) => editar('title.width', Number(e.target.value))} /></Field>
                <Field label="Altura da linha"><Input type="number" step="0.05" value={cfg.title.lineHeight}
                       onChange={(e) => editar('title.lineHeight', Number(e.target.value))} /></Field>
              </div>
            </>
          )}

          {aba === 'video' && (
            <div className="grid grid--3">
              <Field label="Posição X"><Input type="number" value={cfg.videoContainer.x}
                     onChange={(e) => editar('videoContainer.x', Number(e.target.value))} /></Field>
              <Field label="Posição Y"><Input type="number" value={cfg.videoContainer.y}
                     onChange={(e) => editar('videoContainer.y', Number(e.target.value))} /></Field>
              <Field label="Largura"><Input type="number" value={cfg.videoContainer.width}
                     onChange={(e) => editar('videoContainer.width', Number(e.target.value))} /></Field>
              <Field label="Altura"><Input type="number" value={cfg.videoContainer.height}
                     onChange={(e) => editar('videoContainer.height', Number(e.target.value))} /></Field>
              <Field label="Cantos arredondados"><Input type="number" min={0} value={cfg.videoContainer.borderRadius}
                     onChange={(e) => editar('videoContainer.borderRadius', Number(e.target.value))} /></Field>
              <Field label="Enquadramento" hint="Cobrir corta o excedente; caber deixa sobra.">
                <Select value={cfg.videoContainer.fit} onChange={(e) => editar('videoContainer.fit', e.target.value)}>
                  <option value="cover">Cobrir</option>
                  <option value="contain">Caber inteiro</option>
                </Select>
              </Field>
              <Checkbox label="Sombra" checked={cfg.videoContainer.shadowEnabled}
                        onChange={(e) => editar('videoContainer.shadowEnabled', e.target.checked)} />
              {cfg.videoContainer.shadowEnabled && (
                <>
                  <Field label="Desfoque da sombra"><Input type="number" value={cfg.videoContainer.shadowBlur}
                         onChange={(e) => editar('videoContainer.shadowBlur', Number(e.target.value))} /></Field>
                  <Field label="Opacidade"><Input type="number" step="0.05" min={0} max={1}
                         value={cfg.videoContainer.shadowOpacity}
                         onChange={(e) => editar('videoContainer.shadowOpacity', Number(e.target.value))} /></Field>
                </>
              )}
            </div>
          )}

          {aba === 'fundo' && (
            <div className="grid grid--2">
              <Field label="Tipo">
                <Select value={cfg.background.type} onChange={(e) => editar('background.type', e.target.value)}>
                  <option value="color">Cor sólida</option>
                  <option value="gradient">Degradê</option>
                  <option value="image">Imagem</option>
                  <option value="blurred">Vídeo desfocado</option>
                </Select>
              </Field>
              {cfg.background.type === 'color' && (
                <Field label="Cor"><Input type="color" value={cfg.background.color}
                       onChange={(e) => editar('background.color', e.target.value)} /></Field>
              )}
              {cfg.background.type === 'gradient' && (
                <>
                  <Field label="Cor inicial"><Input type="color" value={cfg.background.gradientFrom}
                         onChange={(e) => editar('background.gradientFrom', e.target.value)} /></Field>
                  <Field label="Cor final"><Input type="color" value={cfg.background.gradientTo}
                         onChange={(e) => editar('background.gradientTo', e.target.value)} /></Field>
                  <Field label="Ângulo"><Input type="number" value={cfg.background.gradientAngle}
                         onChange={(e) => editar('background.gradientAngle', Number(e.target.value))} /></Field>
                </>
              )}
              {cfg.background.type === 'image' && (
                <BotaoImagem caminho="background.imageUrl" atual={cfg.background.imageUrl} label="Imagem de fundo" />
              )}
              {cfg.background.type === 'blurred' && (
                <p className="faint">
                  O próprio vídeo é ampliado e desfocado ao fundo. Não há o que configurar.
                </p>
              )}
            </div>
          )}

          {aba === 'marca' && (
            <div className="grid grid--2">
              <Checkbox label="Aplicar marca d’água" checked={cfg.watermark.enabled}
                        onChange={(e) => editar('watermark.enabled', e.target.checked)} />
              <span />
              {cfg.watermark.enabled && (
                <>
                  <BotaoImagem caminho="watermark.logoUrl" atual={cfg.watermark.logoUrl} label="Logo" />
                  <Field label="Posição">
                    <Select value={cfg.watermark.position} onChange={(e) => editar('watermark.position', e.target.value)}>
                      <option value="top-left">Superior esquerdo</option>
                      <option value="top-right">Superior direito</option>
                      <option value="bottom-left">Inferior esquerdo</option>
                      <option value="bottom-right">Inferior direito</option>
                    </Select>
                  </Field>
                  <Field label="Tamanho"><Input type="number" value={cfg.watermark.size}
                         onChange={(e) => editar('watermark.size', Number(e.target.value))} /></Field>
                  <Field label="Opacidade"><Input type="number" step="0.05" min={0} max={1}
                         value={cfg.watermark.opacity}
                         onChange={(e) => editar('watermark.opacity', Number(e.target.value))} /></Field>
                  <Field label="Margem"><Input type="number" value={cfg.watermark.margin}
                         onChange={(e) => editar('watermark.margin', Number(e.target.value))} /></Field>
                </>
              )}
            </div>
          )}
        </Card>

        <Card title="Exportação" className="mt">
          <div className="grid grid--2">
            <Field label="Qualidade">
              <Select value={cfg.export.quality} onChange={(e) => editar('export.quality', e.target.value)}>
                <option value="low">Rápida (arquivo menor)</option>
                <option value="medium">Equilibrada</option>
                <option value="high">Alta (mais lenta)</option>
              </Select>
            </Field>
            <Field label="Padrão do nome do arquivo"
                   hint="{nome} vira o nome do original, {template} o nome do template.">
              <Input value={cfg.export.filenamePattern}
                     onChange={(e) => editar('export.filenamePattern', e.target.value)} />
            </Field>
          </div>
        </Card>
      </div>
    </div>
  );
}
