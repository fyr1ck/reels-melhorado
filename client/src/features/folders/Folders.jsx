import { useState } from 'react';
import { FolderPlus, RefreshCw, Trash2, Power, AlertTriangle, FolderSync, RotateCcw } from 'lucide-react';
import { useQuery, useMutation } from '../../hooks/useQuery.js';
import { useAccount } from '../../hooks/useAccount.jsx';
import { useToast } from '../../hooks/useToast.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { api } from '../../lib/api.js';
import { Card, Button, Badge, Input, Field, Select, Checkbox, Empty, Banner } from '../../design/ui.jsx';
import { dateTime } from '../../lib/format.js';
import './folders.css';

export default function Folders() {
  const { accountId, account } = useAccount();
  const toast = useToast();
  const confirm = useConfirm();

  const { data: folders, reload } = useQuery('/watch-folders', { refetchMs: 20000 });
  const [form, setForm] = useState({ path: '', label: '', mode: 'COPY', autoCaption: false });

  const criar = useMutation(async () => {
    await api.post('/watch-folders', { ...form, accountId });
    setForm({ path: '', label: '', mode: 'COPY', autoCaption: false });
    await reload({ quiet: true });
    toast.success('Pasta cadastrada. A varredura roda a cada 2 minutos.');
  });

  const varrer = useMutation(async (folder) => {
    const r = await api.post(folder ? `/watch-folders/${folder.id}/scan` : '/watch-folders/scan');
    await reload({ quiet: true });
    const n = r.imported ?? 0;
    n > 0 ? toast.success(`${n} vídeo(s) importado(s).`) : toast.info('Nenhum vídeo novo.');
  });

  async function reimportar(folder) {
    const ok = await confirm({
      title: 'Reimportar tudo',
      description:
        'O app esquece o que já importou desta pasta, então tudo entra na fila de novo na ' +
        'próxima varredura — inclusive o que você removeu antes. Os arquivos na pasta não mudam.',
      confirmLabel: 'Reimportar',
    });
    if (!ok) return;
    const r = await api.post(`/watch-folders/${folder.id}/reset`);
    await varrer.run(folder);
    toast.success(`${r.forgotten} registro(s) esquecido(s).`);
  }

  return (
    <>
      <div className="page-head page-head--row">
        <div>
          <h2>Pastas monitoradas</h2>
          <p>
            Todo vídeo novo que aparecer nessas pastas entra na fila sozinho. É uma pasta
            <b> do seu computador</b>, não um link. Se você usa Google Drive, OneDrive ou Dropbox
            com o app de desktop instalado, aponte para a pasta que eles sincronizam.
          </p>
        </div>
        <Button icon={RefreshCw} loading={varrer.busy} onClick={() => varrer.run(null)}>Varrer agora</Button>
      </div>

      <Card title="Nova pasta" icon={FolderPlus}>
        <form onSubmit={(e) => { e.preventDefault(); criar.run().catch(() => {}); }}>
          <Field label="Caminho no computador" hint="Ex: C:\Users\voce\Videos\Reels">
            <Input value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })}
                   placeholder="C:\Users\voce\Videos\Reels" />
          </Field>
          <div className="grid grid--3 mt">
            <Field label="Apelido (opcional)">
              <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </Field>
            <Field label="Ao importar">
              <Select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                <option value="COPY">Copiar (mantém o original)</option>
                <option value="MOVE">Mover (remove da origem)</option>
              </Select>
            </Field>
            <Field label="&nbsp;">
              <Button variant="primary" icon={FolderPlus} type="submit" loading={criar.busy}>Adicionar</Button>
            </Field>
          </div>
          <Checkbox
            className="mt"
            label="Já aplicar uma legenda da biblioteca na importação"
            checked={form.autoCaption}
            onChange={(e) => setForm({ ...form, autoCaption: e.target.checked })}
          />
        </form>
        {criar.error && <Banner tone="danger" icon={AlertTriangle} className="mt">{criar.error.message}</Banner>}
      </Card>

      <Card title={`Monitorando (${folders?.filter((f) => f.enabled).length ?? 0} ativas)`} icon={FolderSync} className="mt">
        {!folders?.length ? (
          <Empty icon={FolderSync} title="Nenhuma pasta ainda">
            Cadastre uma acima para a fila encher sozinha.
          </Empty>
        ) : (
          <div className="stack">
            {folders.map((f) => (
              <div key={f.id} className={`wf${f.enabled ? '' : ' is-off'}`}>
                <div className="wf__main">
                  <div className="wf__head">
                    <FolderSync size={15} />
                    <b>{f.label || f.path.split(/[\/]/).pop()}</b>
                    <Badge tone={f.mode === 'MOVE' ? 'warn' : 'muted'}>{f.mode === 'MOVE' ? 'move' : 'copia'}</Badge>
                    {f.autoCaption && <Badge tone="brand">legenda auto</Badge>}
                    {!f.reachable && <Badge tone="danger">inacessível</Badge>}
                  </div>
                  <code className="wf__path">{f.path}</code>
                  <div className="wf__stats">
                    <span><b>{f.newFiles}</b> novo(s) aguardando</span>
                    <span className="faint">{f.filesInFolder} na pasta</span>
                    <span className="faint">{f.importedCount} já importado(s)</span>
                    <span className="faint">varredura: {f.lastScanAt ? dateTime(f.lastScanAt) : 'nunca'}</span>
                  </div>
                  {(f.lastError || f.error) && (
                    <div className="wf__err"><AlertTriangle size={13} /> {f.lastError || f.error}</div>
                  )}
                </div>
                <div className="wf__actions">
                  <Button size="sm" icon={RefreshCw} onClick={() => varrer.run(f)} disabled={varrer.busy}>Varrer</Button>
                  <Button size="sm" icon={RotateCcw} onClick={() => reimportar(f)}>Reimportar</Button>
                  <Button size="sm" icon={Power}
                          onClick={async () => { await api.patch(`/watch-folders/${f.id}`, { enabled: !f.enabled }); reload({ quiet: true }); }}>
                    {f.enabled ? 'Ativa' : 'Inativa'}
                  </Button>
                  <Button size="sm" variant="danger" icon={Trash2}
                          onClick={async () => {
                            const ok = await confirm({
                              title: 'Parar de monitorar',
                              description: 'Nada é apagado: nem os arquivos na origem, nem os vídeos já na fila.',
                              confirmLabel: 'Parar', danger: true,
                            });
                            if (ok) { await api.del(`/watch-folders/${f.id}`); reload({ quiet: true }); }
                          }} />
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="faint mt">
          Arquivos gravados há menos de 15 segundos são ignorados. É o tempo que o sincronizador
          da nuvem leva para terminar de baixar — sem isso, um vídeo pela metade entraria na fila.
        </p>
      </Card>
    </>
  );
}
