import { Fingerprint, Copy, ShieldCheck, CheckCircle2, Users, RotateCw } from 'lucide-react';
import { useQuery, useMutation } from '../../hooks/useQuery.js';
import { useToast } from '../../hooks/useToast.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { api } from '../../lib/api.js';
import { Card, Button, Badge, Metric, Empty, Skeleton, Checkbox, Banner } from '../../design/ui.jsx';
import { bytes, dateTime } from '../../lib/format.js';
import './duplicates.css';

/**
 * Conteúdo repetido entre contas.
 *
 * Duas contas publicando o mesmo vídeo é o padrão mais visível de rede
 * automatizada — e, na prática, joga fora o alcance da segunda: o conteúdo
 * compete consigo mesmo. Esta tela mostra onde isso está acontecendo e resolve
 * mantendo uma cópia só.
 */

const TOM = { PENDING: 'muted', SCHEDULED: 'brand', PUBLISHING: 'warn', PUBLISHED: 'ok', FAILED: 'danger' };

export default function Duplicates() {
  const toast = useToast();
  const confirm = useConfirm();

  // O polling só lê o que já está calculado. Recalcular as impressões é caro
  // (um stat por arquivo) e fica no botão, onde o usuário pede na hora que quer.
  const { data, loading, reload } = useQuery('/videos/duplicates', { refetchMs: 30000 });
  const revarrer = useMutation(async () => {
    await api.get('/videos/duplicates', { rescan: 1 });
    await reload({ quiet: true });
    toast.success('Arquivos verificados.');
  });
  const { data: settings, reload: reloadSettings } = useQuery('/settings');

  const bloqueio = useMutation(async (valor) => {
    await api.patch('/settings', { blockDuplicateContent: valor });
    await reloadSettings({ quiet: true });
    toast.success(valor ? 'Bloqueio ligado.' : 'Bloqueio desligado.');
  });

  async function manter(grupo, video) {
    const outras = grupo.videos.filter((v) => v.id !== video.id);
    const publicados = outras.filter((v) => v.status === 'PUBLISHED').length;
    const removiveis = outras.length - publicados;

    const ok = await confirm({
      title: `Manter em @${video.account.username}?`,
      description:
        `${removiveis} cópia(s) saem da fila e o arquivo delas é apagado do disco.`
        + (publicados ? ` ${publicados} já foram publicadas e ficam no histórico.` : '')
        + ' Não há desfazer.',
      confirmLabel: 'Manter esta e remover as outras',
      danger: true,
    });
    if (!ok) return;

    const r = await api.post('/videos/duplicates/resolve', { hash: grupo.hash, keepVideoId: video.id });
    await reload({ quiet: true });
    toast.success(`${r.removidos} cópia(s) removida(s).`);
  }

  if (loading && !data) return <Skeleton height={360} />;

  const grupos = data?.grupos ?? [];
  const cruzados = grupos.filter((g) => g.tipo === 'CRUZADO');
  const repetidos = grupos.filter((g) => g.tipo === 'REPETIDO');

  return (
    <>
      <div className="page-head page-head--row">
        <div>
          <h2>Conteúdo repetido</h2>
          <p>
            Nenhuma conta deve publicar o que a outra já publicou. Aqui aparece todo vídeo cujo
            conteúdo está na fila de mais de uma conta — ou duas vezes na mesma.
          </p>
        </div>
        <Button
          icon={RotateCw} loading={revarrer.busy}
          onClick={() => revarrer.run().catch((e) => toast.error(e.message))}
        >
          Verificar de novo
        </Button>
      </div>

      <div className="grid grid--3">
        <Metric
          icon={Users} label="Entre contas" value={data?.cruzados ?? 0}
          hint="mesmo conteúdo em contas diferentes"
          tone={data?.cruzados ? 'danger' : 'ok'}
        />
        <Metric
          icon={Copy} label="Dentro de uma conta" value={data?.repetidos ?? 0}
          hint="o mesmo vídeo iria ao ar duas vezes"
          tone={data?.repetidos ? 'warn' : undefined}
        />
        <Metric
          icon={Fingerprint} label="Sem impressão" value={data?.semImpressao ?? 0}
          hint="arquivo fora do disco; não dá para comparar"
        />
      </div>

      <Card className="mt" title="Prevenção na entrada" icon={ShieldCheck}>
        <Checkbox
          label="Recusar vídeo que já está na fila de outra conta"
          hint="Vale para o upload e para as pastas monitoradas. Barrar na entrada é melhor que descobrir depois: o vídeo nem chega a ocupar um horário. Duas contas apontadas para a mesma pasta do Drive é o jeito mais comum de isso acontecer sem querer."
          checked={settings?.blockDuplicateContent ?? true}
          onChange={(e) => bloqueio.run(e.target.checked).catch((err) => toast.error(err.message))}
        />
        <p className="faint mt">
          A comparação é do <b>arquivo</b> (tamanho + assinatura do início). O que sai do Editor em
          Massa é comparado pelo vídeo de <b>origem</b>: três cópias com variação de corte são
          arquivos diferentes, mas continuam sendo o mesmo conteúdo.
        </p>
      </Card>

      {!grupos.length ? (
        <Card className="mt">
          <Empty icon={CheckCircle2} title="Nenhum conteúdo repetido">
            Cada conta está com material próprio. Esta tela se preenche sozinha se o mesmo vídeo
            entrar em duas filas.
          </Empty>
        </Card>
      ) : (
        <>
          {cruzados.length > 0 && (
            <div className="mt">
              <Banner tone="danger" icon={Users}>
                <b>{cruzados.length} conteúdo(s) na fila de mais de uma conta.</b> Escolha em qual
                conta cada um deve ficar — as outras cópias saem da fila.
              </Banner>
            </div>
          )}

          <div className="stack mt">
            {[...cruzados, ...repetidos].map((g) => {
              const primeiro = g.videos[0];
              return (
                <Card
                  key={g.hash}
                  tone={g.tipo === 'CRUZADO' ? 'danger' : undefined}
                  title={primeiro.filename}
                  icon={g.tipo === 'CRUZADO' ? Users : Copy}
                  action={
                    <Badge tone={g.tipo === 'CRUZADO' ? 'danger' : 'warn'}>
                      {g.tipo === 'CRUZADO'
                        ? `${g.contas.length} contas`
                        : `${g.videos.length}x na mesma conta`}
                    </Badge>
                  }
                >
                  <p className="faint">
                    {bytes(primeiro.sizeBytes)} · impressão{' '}
                    <code className="dup__hash">{g.hash.slice(0, 20)}…</code>
                  </p>

                  <div className="dup__lista mt">
                    {g.videos.map((v) => (
                      <div key={v.id} className="dup__copia">
                        <div className="dup__quem">
                          <b>@{v.account.username}</b>
                          {v.account.label && <em>{v.account.label}</em>}
                        </div>
                        <span className="dup__arquivo" title={v.filename}>{v.filename}</span>
                        <span className="faint">{dateTime(v.createdAt)}</span>
                        <Badge tone={TOM[v.status]}>{v.status.toLowerCase()}</Badge>
                        <Button
                          size="sm"
                          variant={v.status === 'PUBLISHED' ? 'primary' : 'default'}
                          icon={CheckCircle2}
                          onClick={() => manter(g, v)}
                          title={
                            v.status === 'PUBLISHED'
                              ? 'Este já foi ao ar — normalmente é o que deve ficar.'
                              : 'Mantém esta cópia e remove as demais da fila.'
                          }
                        >
                          Manter esta
                        </Button>
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
