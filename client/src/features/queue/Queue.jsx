import { useRef, useState } from 'react';
import { Upload, Trash2, Pencil, Film, Check, X, Clapperboard } from 'lucide-react';
import { useQuery, useMutation } from '../../hooks/useQuery.js';
import { useAccount } from '../../hooks/useAccount.jsx';
import { useToast } from '../../hooks/useToast.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { api } from '../../lib/api.js';
import { Card, Button, Badge, Tabs, Empty, Textarea, Skeleton } from '../../design/ui.jsx';
import { bytes, duration, dateTime } from '../../lib/format.js';
import './queue.css';

const ABAS = [
  { value: 'PENDING', label: 'Pendentes' },
  { value: 'SCHEDULED', label: 'Agendados' },
  { value: 'PUBLISHED', label: 'Publicados' },
  { value: 'FAILED', label: 'Falhados' },
];

const TOM = { PENDING: 'muted', SCHEDULED: 'brand', PUBLISHING: 'warn', PUBLISHED: 'ok', FAILED: 'danger' };

export default function Queue() {
  const { accountId, account } = useAccount();
  const toast = useToast();
  const confirm = useConfirm();

  const [aba, setAba] = useState('PENDING');
  const [editando, setEditando] = useState(null);
  const [rascunho, setRascunho] = useState('');
  const inputRef = useRef(null);

  const { data: videos, loading, reload } = useQuery('/videos', {
    params: { accountId, status: aba },
    enabled: !!accountId,
    refetchMs: 15000,
  });

  const enviar = useMutation(async (files) => {
    const fd = new FormData();
    for (const f of files) fd.append('videos', f);
    fd.append('accountId', accountId);
    const criados = await api.post('/videos', fd);
    await reload({ quiet: true });
    toast.success(`${criados.length} vídeo(s) na fila de @${account?.username}.`);
  });

  async function remover(video) {
    const ok = await confirm({
      title: 'Remover da fila',
      description: video.status === 'PUBLISHED'
        ? 'O registro sai do histórico. O arquivo publicado permanece no disco.'
        : 'O vídeo sai da fila e o ARQUIVO é apagado do disco. Não há desfazer.',
      confirmLabel: 'Remover',
      danger: true,
    });
    if (!ok) return;
    await api.del(`/videos/${video.id}`);
    await reload({ quiet: true });
    toast.success('Removido.');
  }

  async function salvarLegenda(video) {
    await api.patch(`/videos/${video.id}`, { caption: rascunho });
    setEditando(null);
    await reload({ quiet: true });
    toast.success('Legenda salva.');
  }

  const onDrop = (e) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('video/'));
    if (files.length) enviar.run(files).catch((err) => toast.error(err.message));
  };

  return (
    <>
      <div className="page-head">
        <h2>Fila de vídeos</h2>
        <p>
          Fila de <b>@{account?.username ?? '—'}</b>. Novos vídeos entram nesta conta —
          troque no seletor do menu.
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...e.target.files];
          e.target.value = '';
          if (files.length) enviar.run(files).catch((err) => toast.error(err.message));
        }}
      />

      <div
        className={`drop${enviar.busy ? ' is-busy' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
      >
        <Upload size={18} />
        <span>{enviar.busy ? 'Enviando…' : 'Arraste vídeos aqui ou clique para escolher'}</span>
        <em className="faint">MP4, MOV, MKV ou WebM</em>
      </div>

      <Tabs value={aba} onChange={setAba} items={ABAS} />

      {loading && !videos ? (
        <div className="stack">{[0, 1, 2].map((i) => <Skeleton key={i} height={78} />)}</div>
      ) : !videos?.length ? (
        <Card>
          <Empty icon={Film} title={`Nenhum vídeo ${ABAS.find((t) => t.value === aba).label.toLowerCase()}`}>
            {aba === 'PENDING' && 'Envie vídeos acima ou configure uma pasta monitorada para a fila encher sozinha.'}
          </Empty>
        </Card>
      ) : (
        <div className="stack">
          {videos.map((v, i) => (
            <Card key={v.id} className="vid">
              <span className="vid__pos">{i + 1}</span>

              <div className="vid__main">
                <div className="vid__head">
                  <b className="vid__name">{v.filename}</b>
                  <Badge tone={v.mediaType === 'STORY' ? 'warn' : 'muted'}>
                    {v.mediaType === 'STORY' ? 'story' : 'reel'}
                  </Badge>
                  <Badge tone={TOM[v.status]}>{v.status.toLowerCase()}</Badge>
                </div>

                <div className="vid__meta faint">
                  {duration(v.durationSec)} · {bytes(v.sizeBytes)}
                  {v.width && ` · ${v.width}×${v.height}`}
                  {v.publishedAt && ` · publicado ${dateTime(v.publishedAt)}`}
                </div>

                {editando === v.id ? (
                  <div className="vid__edit">
                    <Textarea
                      rows={3}
                      value={rascunho}
                      onChange={(e) => setRascunho(e.target.value)}
                      placeholder="Legenda do vídeo…"
                      autoFocus
                    />
                    <div className="row">
                      <Button size="sm" variant="primary" icon={Check} onClick={() => salvarLegenda(v)}>Salvar</Button>
                      <Button size="sm" icon={X} onClick={() => setEditando(null)}>Cancelar</Button>
                    </div>
                  </div>
                ) : (
                  <p className={`vid__cap${v.caption ? '' : ' is-empty'}`}>
                    {v.caption || 'Sem legenda — vai usar a legenda padrão da conta, se houver.'}
                  </p>
                )}
              </div>

              <div className="vid__actions">
                {editando !== v.id && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Pencil}
                    title="Editar legenda"
                    onClick={() => { setEditando(v.id); setRascunho(v.caption || ''); }}
                  />
                )}
                <Button size="sm" variant="ghost" icon={Trash2} title="Remover" onClick={() => remover(v)} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
