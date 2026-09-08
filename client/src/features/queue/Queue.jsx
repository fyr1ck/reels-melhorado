import { useMemo, useRef, useState } from 'react';
import {
  Upload, Trash2, Pencil, Film, Check, X, Zap, Image, CheckSquare, Square, Split, Users, Search,
  RefreshCcw, GripVertical,
} from 'lucide-react';
import { assetUrl } from '../../lib/canvas.js';
import { useQuery, useMutation } from '../../hooks/useQuery.js';
import { useAccount } from '../../hooks/useAccount.jsx';
import { useToast } from '../../hooks/useToast.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { api } from '../../lib/api.js';
import { Card, Button, Badge, Tabs, Empty, Textarea, Skeleton, Checkbox, Input, Field } from '../../design/ui.jsx';
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
  const { accountId, account, accounts, reload: reloadAccounts } = useAccount();
  const toast = useToast();
  const confirm = useConfirm();

  const [aba, setAba] = useState('PENDING');
  const [editando, setEditando] = useState(null);
  const [rascunho, setRascunho] = useState('');
  const [selecao, setSelecao] = useState(new Set());
  const [publicando, setPublicando] = useState(null);
  const inputRef = useRef(null);
  const capaRef = useRef(null);
  const [capaAlvo, setCapaAlvo] = useState(null);

  // Distribuição: em vez de mandar o lote inteiro para uma conta, reparte
  // entre as escolhidas — um vídeo por conta, sem repetir conteúdo.
  const [distribuir, setDistribuir] = useState(false);
  const [contasSel, setContasSel] = useState(new Set());

  const [busca, setBusca] = useState('');
  // Índice do cartão sendo arrastado. Guardar o índice (e não o id) deixa a
  // troca de posição ser uma operação de array, sem procurar nada.
  const [arrastando, setArrastando] = useState(null);
  const [ordem, setOrdem] = useState(null);
  // Quantos itens a lista desenha. Uma fila de 300 vídeos gerava 300 cartões
  // de uma vez, e a tela travava a cada digitada na legenda.
  const [limite, setLimite] = useState(60);

  const { data: settings, reload: reloadSettings } = useQuery('/settings');
  const padraoRef = useRef(null);

  const { data: videos, loading, reload } = useQuery('/videos', {
    params: { accountId, status: aba },
    enabled: !!accountId,
    refetchMs: 15000,
  });

  // Contas que vão receber. Sem seleção explícita, distribui entre todas.
  const alvos = distribuir
    ? (contasSel.size ? accounts.filter((a) => contasSel.has(a.id)) : accounts)
    : [];

  const { data: reciclo, reload: reloadReciclo } = useQuery(
    `/accounts/${accountId}/recycle`,
    { enabled: !!accountId && !!account?.recycleEnabled },
  );

  const salvarReciclo = useMutation(async (patch) => {
    await api.patch(`/accounts/${accountId}`, patch);
    await reloadAccounts();
    await reload({ quiet: true });
    await reloadReciclo({ quiet: true });
  });

  const reciclarAgora = useMutation(async () => {
    const r = await api.post(`/accounts/${accountId}/recycle`);
    await reload({ quiet: true });
    await reloadReciclo({ quiet: true });
    toast.success(r.reciclados
      ? `${r.reciclados} vídeo(s) voltaram para a fila.`
      : 'Nenhum vídeo cumpriu a carência ainda.');
  });

  const enviar = useMutation(async (files) => {
    if (distribuir && alvos.length < 2) {
      throw new Error('Escolha ao menos duas contas para distribuir.');
    }

    const fd = new FormData();
    for (const f of files) fd.append('videos', f);
    if (distribuir) for (const a of alvos) fd.append('accountIds', a.id);
    else fd.append('accountId', accountId);

    const r = await api.post('/videos', fd);
    await reload({ quiet: true });

    if (r.distributed) {
      const resumo = r.porConta
        .filter((c) => c.count)
        .map((c) => `@${c.username}: ${c.count}`)
        .join(' · ');
      toast.success(`${r.created.length} vídeo(s) distribuído(s). ${resumo}`);
    } else {
      toast.success(`${r.created.length} vídeo(s) na fila de @${account?.username}.`);
    }

    // Recusas não são erro: o upload seguiu com o resto. Mas precisam
    // aparecer, senão o usuário conta os arquivos e acha que sumiram.
    if (r.skipped?.length) {
      toast.error(
        `${r.skipped.length} recusado(s) por já estar(em) em outra conta: `
        + r.skipped.slice(0, 3).map((x) => x.filename).join(', ')
        + (r.skipped.length > 3 ? '…' : ''),
      );
    }
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

  /**
   * Publica um vídeo AGORA, fora do agendamento. Uma tentativa só: serve para
   * verificar se a automação funciona, e o retry do agendador mascararia um
   * problema real de configuração.
   */
  async function publicarAgora(video) {
    const ok = await confirm({
      title: `Publicar "${video.filename}" agora?`,
      description:
        `Vai ao ar em @${account?.username} IMEDIATAMENTE, fora do agendamento, e a janela do ` +
        'navegador abre em tempo real. Uma única tentativa — sem repetição automática.',
      confirmLabel: 'Publicar agora',
      danger: true,
    });
    if (!ok) return;

    setPublicando(video.id);
    try {
      const r = await api.post(`/videos/${video.id}/publish-now`);
      await reload({ quiet: true });
      toast.success(`Publicado em ${(r.durationMs / 1000).toFixed(0)}s.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPublicando(null);
    }
  }

  async function removerSelecionados() {
    const ok = await confirm({
      title: `Remover ${selecao.size} vídeo(s)`,
      description: 'Os arquivos são apagados do disco. Vídeos já publicados são preservados. Não há desfazer.',
      confirmLabel: 'Remover',
      danger: true,
    });
    if (!ok) return;

    const r = await api.post('/videos/bulk-delete', { ids: [...selecao] });
    setSelecao(new Set());
    await reload({ quiet: true });
    toast.success(`${r.removed} removido(s)${r.skipped ? `, ${r.skipped} preservado(s)` : ''}.`);
  }

  async function enviarCapa(file) {
    if (!capaAlvo) return;
    const fd = new FormData();
    fd.append('cover', file);
    try {
      await api.post(`/videos/${capaAlvo}/cover`, fd);
      await reload({ quiet: true });
      toast.success('Capa definida.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCapaAlvo(null);
    }
  }

  /** Capa padrão: aplicada a todo vídeo novo que não trouxer a própria. */
  async function enviarCapaPadrao(file) {
    const fd = new FormData();
    fd.append('cover', file);
    try {
      await api.post('/settings/default-cover', fd);
      await reloadSettings({ quiet: true });
      toast.success('Capa padrão definida. Vale para os próximos vídeos.');
    } catch (err) {
      toast.error(err.message);
    }
  }

  // Filtro e recorte no cliente: a fila de uma conta cabe numa resposta só, e
  // buscar no servidor a cada tecla digitada seria pior para quem opera local.
  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return videos ?? [];
    return (videos ?? []).filter((v) => (
      v.filename.toLowerCase().includes(termo)
      || (v.caption ?? '').toLowerCase().includes(termo)
    ));
  }, [videos, busca]);

  const visiveis = useMemo(() => filtrados.slice(0, limite), [filtrados, limite]);

  /**
   * Reordenar arrastando.
   *
   * A rota de reordenar já existia desde o começo, mas nada na interface a
   * chamava: a posição na fila só mudava apagando e reenviando na ordem certa.
   *
   * A lista muda na tela ANTES da resposta do servidor (`ordem`) — arrastar e
   * esperar meio segundo para o item pular para o lugar parece travado.
   */
  const lista = ordem ?? visiveis;

  // Arrastar só faz sentido na fila de espera: a ordem de quem já publicou não
  // muda nada, e com busca ativa a posição vista não é a posição real.
  const podeArrastar = aba === 'PENDING' && !busca && !account?.randomOrder;

  function aoSoltar(destino) {
    if (arrastando === null || arrastando === destino) { setArrastando(null); return; }

    const nova = [...lista];
    const [movido] = nova.splice(arrastando, 1);
    nova.splice(destino, 0, movido);
    setOrdem(nova);
    setArrastando(null);

    // Envia a fila INTEIRA na nova ordem, não só o trecho visível: o servidor
    // reescreve sortOrder por posição, e mandar 60 de 300 zeraria o resto.
    const restantes = filtrados.slice(visiveis.length).map((v) => v.id);
    api.post('/videos/reorder', { ids: [...nova.map((v) => v.id), ...restantes] })
      .then(() => reload({ quiet: true }))
      .then(() => setOrdem(null))
      .catch((err) => {
        toast.error(err.message);
        setOrdem(null); // desfaz o otimismo: volta ao que o servidor tem
      });
  }

  const alternar = (id) => setSelecao((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

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
          Fila de <b>@{account?.username ?? '—'}</b>. Troque a conta no seletor do menu, ou
          distribua um lote entre várias no painel abaixo.
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

      <input
        ref={capaRef} type="file" accept="image/jpeg,image/png,image/webp" hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) enviarCapa(f);
        }}
      />

      <Card
        className="dist"
        title="Para onde vão os vídeos"
        icon={Split}
        action={
          <Badge tone={distribuir ? 'brand' : 'muted'}>
            {distribuir ? `${alvos.length} contas` : `@${account?.username ?? '—'}`}
          </Badge>
        }
      >
        <div className="dist__modos">
          <button
            type="button"
            className={`dist__modo${!distribuir ? ' is-active' : ''}`}
            onClick={() => setDistribuir(false)}
          >
            <b>Uma conta só</b>
            <span>Tudo entra na fila de @{account?.username ?? '—'}, a conta do seletor.</span>
          </button>

          <button
            type="button"
            className={`dist__modo${distribuir ? ' is-active' : ''}`}
            onClick={() => setDistribuir(true)}
            disabled={accounts.length < 2}
            title={accounts.length < 2 ? 'Adicione uma segunda conta para poder distribuir.' : undefined}
          >
            <b>Distribuir entre contas</b>
            <span>
              Reparte o lote: cada vídeo vai para UMA conta. Nenhuma recebe o que a outra já tem.
            </span>
          </button>
        </div>

        {distribuir && (
          <>
            <p className="faint mt">
              Quem participa. Cada arquivo vai para a conta com a menor fila no momento, então as
              filas terminam do mesmo tamanho.
            </p>
            <div className="dist__contas">
              {accounts.map((a) => {
                const marcada = contasSel.size === 0 || contasSel.has(a.id);
                return (
                  <button
                    type="button"
                    key={a.id}
                    className={`dist__conta${marcada ? ' is-on' : ''}`}
                    onClick={() => setContasSel((prev) => {
                      // A primeira desmarcação materializa "todas" numa
                      // seleção concreta; sem isso o clique não teria efeito.
                      const base = prev.size ? new Set(prev) : new Set(accounts.map((x) => x.id));
                      base.has(a.id) ? base.delete(a.id) : base.add(a.id);
                      return base;
                    })}
                  >
                    <Users size={12} />
                    <b>@{a.username}</b>
                    <em>{a.reels} na fila</em>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </Card>

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

      <input
        ref={padraoRef} type="file" accept="image/jpeg,image/png,image/webp" hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) enviarCapaPadrao(f);
        }}
      />

      {settings && (
        <Card className="cover-bar">
          <div className="cover-bar__thumb">
            {settings.defaultCoverPath
              ? <img src={`/api/covers/${settings.defaultCoverPath}`} alt="Capa padrão" />
              : <Image size={16} />}
          </div>
          <div className="cover-bar__text">
            <b>Capa padrão geral</b>
            <span className="faint">
              {settings.defaultCoverPath
                ? 'Vale para todas as contas que não têm capa própria. Cada conta pode ter a sua em Contas.'
                : 'Nenhuma definida — os vídeos entram sem capa e o Instagram escolhe um quadro. Cada conta também pode ter a sua, em Contas.'}
            </span>
          </div>
          <Checkbox
            label="Usar"
            checked={settings.useDefaultCover}
            disabled={!settings.defaultCoverPath}
            onChange={async (e) => {
              await api.patch('/settings', { useDefaultCover: e.target.checked });
              reloadSettings({ quiet: true });
            }}
          />
          <div className="row">
            <Button size="sm" icon={Image} onClick={() => padraoRef.current?.click()}>
              {settings.defaultCoverPath ? 'Trocar' : 'Escolher'}
            </Button>
            {settings.defaultCoverPath && (
              <Button size="sm" variant="danger" icon={Trash2}
                      onClick={async () => {
                        await api.del('/settings/default-cover');
                        reloadSettings({ quiet: true });
                        toast.success('Capa padrão removida.');
                      }} />
            )}
          </div>
        </Card>
      )}

      {/* Reciclagem: página de meme não vive de material inédito, e sem isto a
          fila precisa ser abastecida à mão para sempre. */}
      <Card
        className="mt reciclo"
        title="Reaproveitar o que já foi publicado"
        icon={RefreshCcw}
        action={account?.recycleEnabled && (
          <Button
            size="sm" icon={RefreshCcw} loading={reciclarAgora.busy}
            onClick={() => reciclarAgora.run().catch((e) => toast.error(e.message))}
          >
            Rodar agora
          </Button>
        )}
      >
        <Checkbox
          label="Devolver vídeos antigos para a fila automaticamente"
          hint="Quase ninguém que segue hoje viu o post de dois meses atrás. O vídeo volta como o MESMO item — não vira cópia, então não aparece como conteúdo duplicado."
          checked={account?.recycleEnabled ?? false}
          onChange={(e) => salvarReciclo.run({ recycleEnabled: e.target.checked })
            .then(() => toast.success(e.target.checked ? 'Reciclagem ligada.' : 'Reciclagem desligada.'))
            .catch((err) => toast.error(err.message))}
        />

        {account?.recycleEnabled && (
          <>
            <div className="row mt">
              <Field label="Só depois de">
                <Input
                  type="number" min={1} max={365} style={{ width: 90 }}
                  defaultValue={account.recycleAfterDays}
                  onBlur={(e) => salvarReciclo.run({ recycleAfterDays: Number(e.target.value) })
                    .then(() => toast.success('Carência atualizada.'))
                    .catch((err) => toast.error(err.message))}
                />
              </Field>
              <span className="faint" style={{ paddingTop: 18 }}>dias da última vez que foi ao ar</span>

              <Field label="No máximo">
                <Input
                  type="number" min={0} max={50} style={{ width: 90 }}
                  defaultValue={account.recycleMaxTimes}
                  onBlur={(e) => salvarReciclo.run({ recycleMaxTimes: Number(e.target.value) })
                    .then(() => toast.success('Limite atualizado.'))
                    .catch((err) => toast.error(err.message))}
                />
              </Field>
              <span className="faint" style={{ paddingTop: 18 }}>
                {account.recycleMaxTimes > 0 ? 'vezes por vídeo' : 'vezes — 0 é sem limite'}
              </span>
            </div>

            <p className="faint mt">
              {reciclo?.prontos > 0
                ? <><b>{reciclo.prontos}</b> de {reciclo.publicados} publicados já podem voltar.</>
                : <>Nenhum dos {reciclo?.publicados ?? 0} publicados cumpriu a carência.</>}
              {reciclo?.proximoEm && <> Próximo em {dateTime(reciclo.proximoEm)}.</>}
            </p>
          </>
        )}
      </Card>

      <Tabs value={aba} onChange={(v) => { setAba(v); setLimite(60); }} items={ABAS} />

      {videos?.length > 6 && (
        <div className="qbusca">
          <Search size={14} />
          <Input
            value={busca}
            placeholder={`Buscar entre ${videos.length} vídeo(s) por nome ou legenda…`}
            onChange={(e) => { setBusca(e.target.value); setLimite(60); }}
          />
          {busca && (
            <Button size="sm" variant="ghost" icon={X} onClick={() => setBusca('')} title="Limpar busca" />
          )}
        </div>
      )}

      {filtrados.length > 0 && aba !== 'PUBLISHED' && (
        <div className="qbar">
          <Button
            size="sm" variant="ghost"
            icon={selecao.size === filtrados.length ? CheckSquare : Square}
            onClick={() => setSelecao(new Set(
              selecao.size === filtrados.length ? [] : filtrados.map((x) => x.id),
            ))}
          >
            {/* "Selecionar todos" com busca ativa seleciona o que está à
                vista, não a fila inteira — senão o botão apagaria vídeos que
                o usuário nem viu. */}
            {selecao.size === filtrados.length ? 'Limpar seleção' : `Selecionar ${busca ? 'os encontrados' : 'todos'}`}
          </Button>
          <span className="faint">{selecao.size} selecionado(s)</span>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="danger" icon={Trash2} disabled={!selecao.size} onClick={removerSelecionados}>
            Remover selecionados
          </Button>
        </div>
      )}

      {loading && !videos ? (
        <div className="stack">{[0, 1, 2].map((i) => <Skeleton key={i} height={78} />)}</div>
      ) : !filtrados.length ? (
        <Card>
          <Empty
            icon={busca ? Search : Film}
            title={busca
              ? `Nada encontrado para "${busca}"`
              : `Nenhum vídeo ${ABAS.find((t) => t.value === aba).label.toLowerCase()}`}
          >
            {busca
              ? 'A busca olha o nome do arquivo e a legenda desta aba.'
              : aba === 'PENDING' && 'Envie vídeos acima ou configure uma pasta monitorada para a fila encher sozinha.'}
          </Empty>
        </Card>
      ) : (
        <div className="stack">
          {lista.map((v, i) => (
            <Card
              key={v.id}
              className={`vid${arrastando === i ? ' is-arrastando' : ''}`}
              // Só arrasta o que ainda não foi publicado e sem busca ativa:
              // reordenar um subconjunto filtrado produziria uma ordem que não
              // corresponde ao que está na tela.
              draggable={podeArrastar}
              onDragStart={() => setArrastando(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => aoSoltar(i)}
              onDragEnd={() => setArrastando(null)}
            >
              {podeArrastar && (
                <span className="vid__grip" title="Arraste para mudar a posição na fila">
                  <GripVertical size={14} />
                </span>
              )}
              {aba !== 'PUBLISHED' && (
                <input
                  type="checkbox"
                  className="vid__check"
                  checked={selecao.has(v.id)}
                  onChange={() => alternar(v.id)}
                  aria-label={`Selecionar ${v.filename}`}
                />
              )}
              <span className="vid__pos">{i + 1}</span>

              <div className="vid__main">
                <div className="vid__head">
                  <b className="vid__name">{v.filename}</b>
                  <Badge tone={v.mediaType === 'STORY' ? 'warn' : 'muted'}>
                    {v.mediaType === 'STORY' ? 'story' : 'reel'}
                  </Badge>
                  <Badge tone={TOM[v.status]}>{v.status.toLowerCase()}</Badge>
                  {v.coverPath && <Badge tone="brand">capa</Badge>}
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
                {v.status === 'PENDING' && (
                  <Button
                    size="sm" variant="ghost" icon={Zap} title="Publicar agora, fora do agendamento"
                    loading={publicando === v.id}
                    onClick={() => publicarAgora(v)}
                  />
                )}
                {editando !== v.id && (
                  <Button
                    size="sm" variant="ghost" icon={Image}
                    title={v.coverPath ? 'Trocar capa' : 'Definir capa'}
                    onClick={() => { setCapaAlvo(v.id); capaRef.current?.click(); }}
                  />
                )}
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

          {filtrados.length > lista.length && (
            <Button
              className="qmais"
              onClick={() => setLimite((n) => n + 100)}
            >
              Mostrar mais ({filtrados.length - visiveis.length} restantes)
            </Button>
          )}
        </div>
      )}
    </>
  );
}
