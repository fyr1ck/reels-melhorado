import { useState } from 'react';
import { Plus, Trash2, Power, Wand2, Eye, FileText, Hash } from 'lucide-react';
import { useQuery, useMutation } from '../../hooks/useQuery.js';
import { useAccount } from '../../hooks/useAccount.jsx';
import { useToast } from '../../hooks/useToast.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { api } from '../../lib/api.js';
import {
  Card, Button, Badge, Tabs, Input, Textarea, Field, Select, Checkbox, Empty, Metric, Banner,
} from '../../design/ui.jsx';
import './library.css';

const MAX = 30;

export default function Library() {
  const { accountId, account } = useAccount();
  const toast = useToast();
  const confirm = useConfirm();

  const [aba, setAba] = useState('legendas');
  const { data: captions, reload: reloadCaptions } = useQuery('/library/captions');
  const { data: sets, reload: reloadSets } = useQuery('/library/hashtags');

  const [novaLegenda, setNovaLegenda] = useState({ text: '', label: '', weight: 1 });
  const [novoGrupo, setNovoGrupo] = useState({ name: '', raw: '' });
  const [opcoes, setOpcoes] = useState({ useCaptions: true, useHashtags: true, hashtagSetId: '', overwrite: false });
  const [resultado, setResultado] = useState(null);

  const addLegenda = useMutation(async () => {
    await api.post('/library/captions', novaLegenda);
    setNovaLegenda({ text: '', label: '', weight: 1 });
    await reloadCaptions({ quiet: true });
    toast.success('Legenda adicionada.');
  });

  const addGrupo = useMutation(async () => {
    await api.post('/library/hashtags', novoGrupo);
    setNovoGrupo({ name: '', raw: '' });
    await reloadSets({ quiet: true });
    toast.success('Grupo criado.');
  });

  const aplicar = useMutation(async (dryRun) => {
    const r = await api.post(dryRun ? '/library/preview' : '/library/apply', { ...opcoes, accountId });
    setResultado(r);
    if (!dryRun) toast.success(`${r.updated} vídeo(s) atualizados.`);
    else if (r.updated === 0) toast.info('Nenhum vídeo da fila se encaixa nos critérios.');
  });

  async function remover(tipo, item, nome) {
    const ok = await confirm({
      title: `Remover ${nome}`,
      description: 'Sai da biblioteca. Vídeos que já receberam o texto não são alterados.',
      confirmLabel: 'Remover',
      danger: true,
    });
    if (!ok) return;
    await api.del(`/library/${tipo}/${item.id}`);
    tipo === 'captions' ? await reloadCaptions({ quiet: true }) : await reloadSets({ quiet: true });
  }

  const ativas = captions?.filter((c) => c.enabled).length ?? 0;
  const gruposAtivos = sets?.filter((s) => s.enabled).length ?? 0;

  return (
    <>
      <div className="page-head">
        <h2>Legendas &amp; Hashtags</h2>
        <p>
          Cadastre uma vez e aplique em lote. O rodízio percorre a biblioteca inteira antes de
          repetir — em vez de sortear e deixar a mesma legenda sair três vezes seguidas.
        </p>
      </div>

      <Tabs
        value={aba}
        onChange={setAba}
        items={[
          { value: 'legendas', label: 'Legendas', count: ativas },
          { value: 'hashtags', label: 'Hashtags', count: gruposAtivos },
          { value: 'aplicar', label: 'Aplicar na fila' },
        ]}
      />

      {aba === 'legendas' && (
        <div className="stack">
          <Card title="Nova legenda" icon={FileText}>
            <form onSubmit={(e) => { e.preventDefault(); addLegenda.run().catch((err) => toast.error(err.message)); }}>
              <Field>
                <Textarea
                  rows={3}
                  placeholder="Ex: Mais um lance absurdo dessa temporada 🔥"
                  value={novaLegenda.text}
                  onChange={(e) => setNovaLegenda({ ...novaLegenda, text: e.target.value })}
                />
              </Field>
              <div className="grid grid--3 mt">
                <Field label="Apelido (opcional)">
                  <Input value={novaLegenda.label} onChange={(e) => setNovaLegenda({ ...novaLegenda, label: e.target.value })} />
                </Field>
                <Field label="Peso" hint="Quanto maior, mais vezes essa legenda é sorteada.">
                  <Input type="number" min={1} max={10} value={novaLegenda.weight}
                         onChange={(e) => setNovaLegenda({ ...novaLegenda, weight: Number(e.target.value) })} />
                </Field>
                <Field label="&nbsp;">
                  <Button variant="primary" icon={Plus} type="submit" loading={addLegenda.busy}>Adicionar</Button>
                </Field>
              </div>
            </form>
          </Card>

          <Card title={`Cadastradas (${captions?.length ?? 0})`} icon={FileText}>
            {!captions?.length ? (
              <Empty icon={FileText} title="Nenhuma legenda ainda">
                Cadastre algumas para o rodízio ter de onde escolher.
              </Empty>
            ) : (
              <div className="stack">
                {captions.map((c) => (
                  <div key={c.id} className={`lib-item${c.enabled ? '' : ' is-off'}`}>
                    <div className="lib-item__main">
                      <div className="lib-item__head">
                        {c.label && <Badge tone="muted">{c.label}</Badge>}
                        <Badge tone="brand">peso {c.weight}</Badge>
                        <span className="faint">usada {c.usedCount}x</span>
                      </div>
                      <p className="lib-item__text">{c.text}</p>
                    </div>
                    <div className="row">
                      <Button size="sm" variant="ghost" icon={Power}
                              onClick={async () => { await api.patch(`/library/captions/${c.id}`, { enabled: !c.enabled }); reloadCaptions({ quiet: true }); }} />
                      <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remover('captions', c, 'legenda')} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {aba === 'hashtags' && (
        <div className="stack">
          <Card title="Novo grupo" icon={Hash}>
            <form onSubmit={(e) => { e.preventDefault(); addGrupo.run().catch((err) => toast.error(err.message)); }}>
              <div className="grid grid--2">
                <Field label="Nome do grupo">
                  <Input placeholder="Ex: futebol" value={novoGrupo.name}
                         onChange={(e) => setNovoGrupo({ ...novoGrupo, name: e.target.value })} />
                </Field>
                <Field label="&nbsp;">
                  <Button variant="primary" icon={Plus} type="submit" loading={addGrupo.busy}>Criar grupo</Button>
                </Field>
              </div>
              <Field
                className="mt"
                label="Hashtags"
                hint={`Com ou sem #, separadas por espaço, vírgula ou linha. O # entra sozinho e as repetidas são descartadas. Limite do Instagram: ${MAX}.`}
              >
                <Textarea rows={3} placeholder="futebol gols copa viral" value={novoGrupo.raw}
                          onChange={(e) => setNovoGrupo({ ...novoGrupo, raw: e.target.value })} />
              </Field>
            </form>
          </Card>

          <Card title={`Grupos (${sets?.length ?? 0})`} icon={Hash}>
            {!sets?.length ? (
              <Empty icon={Hash} title="Nenhum grupo ainda" />
            ) : (
              <div className="stack">
                {sets.map((g) => (
                  <div key={g.id} className={`lib-item${g.enabled ? '' : ' is-off'}`}>
                    <div className="lib-item__main">
                      <div className="lib-item__head">
                        <b>{g.name}</b>
                        <Badge tone={g.overLimit ? 'warn' : 'muted'}>{g.count} hashtags</Badge>
                        <span className="faint">usado {g.usedCount}x</span>
                      </div>
                      <div className="tags">
                        {g.parsed.map((t, i) => (
                          <span key={t} className={`tag${i >= MAX ? ' is-over' : ''}`}>{t}</span>
                        ))}
                      </div>
                      {g.overLimit && (
                        <p className="faint mt">As excedentes (riscadas) são cortadas na publicação.</p>
                      )}
                    </div>
                    <div className="row">
                      <Button size="sm" variant="ghost" icon={Power}
                              onClick={async () => { await api.patch(`/library/hashtags/${g.id}`, { enabled: !g.enabled }); reloadSets({ quiet: true }); }} />
                      <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remover('hashtags', g, 'grupo')} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {aba === 'aplicar' && (
        <div className="stack">
          <Card title={`Aplicar na fila de @${account?.username ?? '—'}`} icon={Wand2}>
            <div className="stack">
              <Checkbox
                label={`Usar legendas da biblioteca (${ativas} ativas)`}
                checked={opcoes.useCaptions}
                onChange={(e) => setOpcoes({ ...opcoes, useCaptions: e.target.checked })}
              />
              <Checkbox
                label="Anexar hashtags"
                checked={opcoes.useHashtags}
                onChange={(e) => setOpcoes({ ...opcoes, useHashtags: e.target.checked })}
              />
              {opcoes.useHashtags && (
                <Field className="mt">
                  <Select value={opcoes.hashtagSetId} onChange={(e) => setOpcoes({ ...opcoes, hashtagSetId: e.target.value })}>
                    <option value="">Rodízio entre todos os grupos ativos</option>
                    {sets?.filter((s) => s.enabled).map((s) => (
                      <option key={s.id} value={s.id}>Sempre o grupo "{s.name}"</option>
                    ))}
                  </Select>
                </Field>
              )}
              <Checkbox
                label="Sobrescrever legendas já preenchidas"
                hint="Desmarcado, só os vídeos sem legenda são tocados — é o modo seguro."
                checked={opcoes.overwrite}
                onChange={(e) => setOpcoes({ ...opcoes, overwrite: e.target.checked })}
              />
            </div>

            <div className="row mt">
              <Button icon={Eye} loading={aplicar.busy} onClick={() => aplicar.run(true).catch((e) => toast.error(e.message))}>
                Simular
              </Button>
              <Button variant="primary" icon={Wand2} loading={aplicar.busy}
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'Aplicar na fila',
                          description: opcoes.overwrite
                            ? 'As legendas atuais dos vídeos pendentes e agendados serão SOBRESCRITAS. Não há desfazer.'
                            : 'Os vídeos sem legenda recebem um texto da biblioteca. Os que já têm ficam intocados.',
                          confirmLabel: 'Aplicar',
                          danger: opcoes.overwrite,
                        });
                        if (ok) aplicar.run(false).catch((e) => toast.error(e.message));
                      }}>
                Aplicar
              </Button>
            </div>

            <p className="faint mt">
              Só o texto da legenda muda. Agendamento, ordem da fila e arquivos não são tocados,
              e vídeos já publicados ficam de fora.
            </p>
          </Card>

          {resultado && (
            <Card title="Resultado" icon={Eye}>
              <div className="grid grid--3">
                <Metric label="Atingidos" value={resultado.updated} />
                <Metric label="Preservados" value={resultado.skipped} />
                <Metric label="Legendas distintas" value={resultado.captionsUsed} />
              </div>
              {resultado.preview.length > 0 && (
                <div className="preview">
                  {resultado.preview.map((p) => (
                    <div key={p.filename} className="preview__item">
                      <span className="faint">{p.filename}</span>
                      <pre>{p.caption}</pre>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </>
  );
}
