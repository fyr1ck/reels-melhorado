import { useRef, useState } from 'react';
import {
  Wand2, Upload, Play, X, Trash2, CheckCircle2, XCircle, Loader2, Clock,
  Layers, Shuffle, Send,
} from 'lucide-react';
import { useQuery, useMutation } from '../../hooks/useQuery.js';
import { useAccount } from '../../hooks/useAccount.jsx';
import { useToast } from '../../hooks/useToast.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { api } from '../../lib/api.js';
import {
  Card, Button, Badge, Tabs, Empty, Select, Field, Checkbox, Input, Metric, Skeleton, Meter,
} from '../../design/ui.jsx';
import { bytes, duration } from '../../lib/format.js';
import TemplateEditor from './TemplateEditor.jsx';
import './editor.css';

const ICONE = {
  PENDING: Clock, RUNNING: Loader2, DONE: CheckCircle2, FAILED: XCircle, CANCELLED: X,
};
const TOM = {
  PENDING: 'muted', RUNNING: 'warn', DONE: 'ok', FAILED: 'danger', CANCELLED: 'muted',
};

export default function Editor() {
  const { accountId, account } = useAccount();
  const toast = useToast();
  const confirm = useConfirm();

  const [aba, setAba] = useState('novo');
  const [selecionados, setSelecionados] = useState(new Set());
  const [opcoes, setOpcoes] = useState({
    templateId: '', concurrency: 2, autoQueue: true, autoSchedule: false, varyOutputs: false,
  });
  const inputRef = useRef(null);

  const { data: sources, reload: reloadSources } = useQuery('/editor/sources');
  const { data: templates, reload: reloadTemplates } = useQuery('/editor/templates');
  // Polling curto enquanto há lote rodando: o progresso muda a cada segundo.
  const { data: batches, reload: reloadBatches } = useQuery('/editor/batches', { refetchMs: 2000 });

  const enviar = useMutation(async (files) => {
    const fd = new FormData();
    for (const f of files) fd.append('videos', f);
    const criados = await api.post('/editor/sources', fd);
    await reloadSources({ quiet: true });
    toast.success(`${criados.length} vídeo(s) prontos para processar.`);
  });

  const processar = useMutation(async () => {
    const lote = await api.post('/editor/batches', {
      ...opcoes, accountId, sourceIds: [...selecionados],
    });
    setSelecionados(new Set());
    setAba('lotes');
    await reloadBatches({ quiet: true });
    toast.success(`Lote iniciado: ${lote.started} vídeo(s).`);
  });

  const rodando = batches?.find((b) => b.status === 'RUNNING');

  function alternar(id) {
    setSelecionados((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  return (
    <>
      <div className="page-head">
        <h2>Editor em Massa</h2>
        <p>
          Aplique um template a vários vídeos de uma vez. O resultado vai para a fila de{' '}
          <b>@{account?.username ?? '—'}</b>.
        </p>
      </div>

      <Tabs
        value={aba}
        onChange={setAba}
        items={[
          { value: 'novo', label: 'Novo lote', count: selecionados.size || undefined },
          { value: 'template', label: 'Templates', count: templates?.length },
          { value: 'lotes', label: 'Lotes', count: batches?.length },
        ]}
      />

      {aba === 'novo' && (
        <div className="stack">
          <input
            ref={inputRef} type="file" accept="video/*" multiple hidden
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
            onDrop={(e) => {
              e.preventDefault();
              const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('video/'));
              if (files.length) enviar.run(files).catch((err) => toast.error(err.message));
            }}
            role="button" tabIndex={0}
          >
            <Upload size={18} />
            <span>{enviar.busy ? 'Enviando…' : 'Arraste os vídeos de origem aqui'}</span>
            <em className="faint">Eles ficam aqui até você processar</em>
          </div>

          <Card
            title={`Vídeos de origem (${sources?.length ?? 0})`}
            icon={Layers}
            action={sources?.length > 0 && (
              <Button size="sm" variant="ghost"
                      onClick={() => setSelecionados(new Set(selecionados.size === sources.length ? [] : sources.map((s) => s.id)))}>
                {selecionados.size === sources.length ? 'Limpar seleção' : 'Selecionar todos'}
              </Button>
            )}
          >
            {!sources?.length ? (
              <Empty icon={Layers} title="Nenhum vídeo de origem">
                Envie vídeos acima para montar um lote.
              </Empty>
            ) : (
              <div className="src-grid">
                {sources.map((s) => (
                  <button
                    key={s.id}
                    className={`src${selecionados.has(s.id) ? ' is-on' : ''}`}
                    onClick={() => alternar(s.id)}
                    aria-pressed={selecionados.has(s.id)}
                  >
                    <span className="src__check">{selecionados.has(s.id) && <CheckCircle2 size={14} />}</span>
                    <span className="src__name">{s.filename}</span>
                    <span className="faint">{duration(s.durationSec)} · {bytes(s.sizeBytes)}</span>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card title="Configuração do lote" icon={Wand2}>
            <div className="grid grid--3">
              <Field
                label="Template"
                hint={!templates?.length ? 'Nenhum criado ainda — vá na aba Templates.' : undefined}
              >
                <Select value={opcoes.templateId} onChange={(e) => setOpcoes({ ...opcoes, templateId: e.target.value })}>
                  <option value="">Selecione…</option>
                  {templates?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </Field>
              <Field label="Vídeos em paralelo" hint="Mais que 2 costuma travar em máquina comum.">
                <Input type="number" min={1} max={4} value={opcoes.concurrency}
                       onChange={(e) => setOpcoes({ ...opcoes, concurrency: Number(e.target.value) })} />
              </Field>
              <Field label="&nbsp;">
                <Button
                  variant="primary" icon={Play} loading={processar.busy}
                  disabled={!selecionados.size || !opcoes.templateId}
                  onClick={() => processar.run().catch((e) => toast.error(e.message))}
                >
                  Processar {selecionados.size || ''}
                </Button>
              </Field>
            </div>

            <div className="stack mt">
              <Checkbox
                label={`Enviar o resultado para a fila de @${account?.username ?? '—'}`}
                checked={opcoes.autoQueue}
                onChange={(e) => setOpcoes({ ...opcoes, autoQueue: e.target.checked })}
              />
              <Checkbox
                label="Agendar automaticamente depois de enviar"
                checked={opcoes.autoSchedule}
                disabled={!opcoes.autoQueue}
                onChange={(e) => setOpcoes({ ...opcoes, autoSchedule: e.target.checked })}
              />
              <Checkbox
                label="Variar as cópias"
                hint="Pequenas diferenças de zoom, deslocamento, velocidade e corte entre as saídas — dentro de margens que não estragam a composição."
                checked={opcoes.varyOutputs}
                onChange={(e) => setOpcoes({ ...opcoes, varyOutputs: e.target.checked })}
              />
            </div>
          </Card>
        </div>
      )}

      {aba === 'template' && <TemplateEditor onChanged={reloadTemplates} />}

      {aba === 'lotes' && (
        <div className="stack">
          {rodando && <BatchGrid batch={rodando} onChange={reloadBatches} />}

          {!batches?.length ? (
            <Card><Empty icon={Wand2} title="Nenhum lote ainda">
              Monte um lote na aba ao lado.
            </Empty></Card>
          ) : (
            batches.filter((b) => b.id !== rodando?.id).map((b) => (
              <BatchGrid key={b.id} batch={b} onChange={reloadBatches} compact />
            ))
          )}
        </div>
      )}
    </>
  );
}

/**
 * Grade de lote — o padrão dos vídeos 3 e 4 da referência: N itens visíveis ao
 * mesmo tempo, cada um com seu estado e progresso, mais o tempo total.
 */
function BatchGrid({ batch, onChange, compact }) {
  const toast = useToast();
  const { data: full } = useQuery(`/editor/batches/${batch.id}`, {
    refetchMs: batch.status === 'RUNNING' ? 1500 : undefined,
  });

  const dados = full ?? batch;
  const itens = dados.items ?? [];
  const live = dados.live;

  const cancelar = useMutation(async () => {
    await api.post(`/editor/batches/${batch.id}/cancel`);
    await onChange({ quiet: true });
    toast.warn('Cancelamento pedido. Os itens em andamento terminam o passo atual.');
  });

  const enviarFila = useMutation(async () => {
    const r = await api.post(`/editor/batches/${batch.id}/queue`);
    await onChange({ quiet: true });
    toast.success(`${r.added} vídeo(s) enviados para a fila.`);
  });

  const feitos = itens.filter((i) => i.status === 'DONE').length;
  const naFila = itens.filter((i) => i.queuedVideoId).length;
  const segundos = live ? Math.round(live.elapsedMs / 1000) : null;
  // Ritmo só faz sentido depois que algo terminou: dividir por poucos segundos
  // no começo daria número absurdo.
  const ritmo = segundos > 3 && feitos > 0 ? ((feitos / segundos) * 60).toFixed(1) : null;

  return (
    <Card
      title={`${dados.template?.name ?? 'Lote'} · @${dados.account?.username ?? '—'}`}
      icon={Wand2}
      action={
        <div className="row">
          {dados.varyOutputs && <Badge tone="brand"><Shuffle size={11} /> variação</Badge>}
          <Badge tone={TOM[dados.status] ?? 'muted'}>{dados.status.toLowerCase()}</Badge>
          {dados.status === 'RUNNING' && (
            <Button size="sm" variant="danger" icon={X} loading={cancelar.busy} onClick={() => cancelar.run()}>
              Cancelar
            </Button>
          )}
          {dados.status === 'DONE' && feitos > naFila && (
            <Button size="sm" icon={Send} loading={enviarFila.busy} onClick={() => enviarFila.run()}>
              Enviar {feitos - naFila} à fila
            </Button>
          )}
        </div>
      }
    >
      <div className="grid grid--4">
        <Metric label="Total" value={dados.total} />
        <Metric label="Concluídos" value={feitos} tone={feitos ? 'ok' : undefined} />
        <Metric label="Falhados" value={itens.filter((i) => i.status === 'FAILED').length}
                tone={dados.failed ? 'danger' : undefined} />
        <Metric
          label="Tempo"
          value={segundos != null ? `${segundos}s` : '—'}
          hint={ritmo ? `${ritmo} vídeos/min` : dados.status === 'RUNNING' ? 'em andamento' : 'total do lote'}
        />
      </div>

      {!compact && (
        <div className="batch-grid mt">
          {itens.map((item) => {
            const Icon = ICONE[item.status];
            const pct = live?.items?.[item.id] ?? item.progress;
            return (
              <div key={item.id} className={`bi bi--${item.status}`}>
                <div className="bi__head">
                  <Icon size={13} className={item.status === 'RUNNING' ? 'spin' : undefined} />
                  <span className="bi__name">{item.sourceName}</span>
                </div>
                {item.status === 'RUNNING' && <Meter value={pct} tone="warn" />}
                {item.status === 'DONE' && <span className="faint">{item.outputName}</span>}
                {item.status === 'FAILED' && <span className="bi__err">{item.errorMessage}</span>}
              </div>
            );
          })}
        </div>
      )}

      {compact && itens.length > 0 && (
        <Meter value={feitos} max={dados.total} tone={dados.failed ? 'warn' : 'ok'} />
      )}
    </Card>
  );
}
