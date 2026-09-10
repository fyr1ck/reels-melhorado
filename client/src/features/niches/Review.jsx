import { useState } from 'react';
import {
  ShieldCheck, ShieldAlert, ShieldX, HelpCircle, RefreshCw, Check, Ban, Send,
} from 'lucide-react';
import { useQuery, useMutation } from '../../hooks/useQuery.js';
import { useToast } from '../../hooks/useToast.jsx';
import { api } from '../../lib/api.js';
import {
  Card, Button, Badge, Select, Empty, Banner, Skeleton, Meter,
} from '../../design/ui.jsx';

/**
 * A camada de decisão humana.
 *
 * Só o que a classificação não conseguiu resolver sozinha aparece aqui. O
 * vídeo continua na fila que sempre existiu — esta tela não guarda vídeo
 * nenhum, ela só mostra a fila filtrada pelo status da classificação.
 */

const FILTROS = [
  { v: 'REVISAO', t: 'Em revisão', icon: ShieldAlert, tone: 'warn' },
  { v: 'BLOQUEADO', t: 'Bloqueados', icon: ShieldX, tone: 'danger' },
  { v: 'SEM_CLASSIFICACAO', t: 'Sem nicho', icon: HelpCircle, tone: 'muted' },
  { v: 'APROVADO', t: 'Aprovados', icon: ShieldCheck, tone: 'ok' },
  { v: 'ALL', t: 'Todos', icon: null, tone: 'muted' },
];

export default function Review() {
  const toast = useToast();
  const [filtro, setFiltro] = useState('REVISAO');

  const { data: stats, reload: recarregarStats } = useQuery('/niches/stats');
  const { data: fila, loading, reload } = useQuery('/niches/queue', { params: { status: filtro } });
  const { data: contas } = useQuery('/accounts');

  const classificar = useMutation(async () => {
    const r = await api.post('/niches/classify', {});
    await Promise.all([reload({ quiet: true }), recarregarStats({ quiet: true })]);
    toast.success(r.ok ? `${r.ok} vídeo(s) classificados.` : (r.message ?? 'Nada para classificar.'));
  });

  const decidir = useMutation(async ({ videoId, acao, accountId, usarIa }) => {
    await api.post(`/niches/decide/${videoId}`, { acao, accountId, usarIa });
    await Promise.all([reload({ quiet: true }), recarregarStats({ quiet: true })]);
    toast.success({
      APROVAR: 'Vídeo liberado e devolvido à fila.',
      BLOQUEAR: 'Vídeo bloqueado.',
      RECLASSIFICAR: 'Classificado de novo.',
    }[acao]);
  });

  const publicarAgora = useMutation(async (video) => {
    await api.post(`/videos/${video.id}/publish-now?ignorarNicho=1`);
    await reload({ quiet: true });
    toast.success('Publicado.');
  });

  const ligado = stats?.config?.ligado;

  return (
    <>
      {ligado === false && (
        <Banner tone="warn">
          A separação por nichos está <strong>desligada</strong>. A classificação abaixo é
          informativa e nenhuma publicação é impedida. Para ligar, vá em Configurações.
        </Banner>
      )}

      <div className="review-filtros">
        {FILTROS.map((f) => {
          const n = f.v === 'ALL' ? null : (stats?.status?.[f.v] ?? 0);
          return (
            <button
              key={f.v}
              className={`review-filtro${filtro === f.v ? ' is-on' : ''}`}
              onClick={() => setFiltro(f.v)}
              type="button"
            >
              {f.icon && <f.icon size={14} />}
              {f.t}
              {n !== null && <Badge tone={f.tone}>{n}</Badge>}
            </button>
          );
        })}

        <Button
          size="sm"
          variant="ghost"
          icon={RefreshCw}
          onClick={() => classificar.run()}
          loading={classificar.loading}
        >
          Classificar não analisados{stats?.semAnalise ? ` (${stats.semAnalise})` : ''}
        </Button>
      </div>

      {loading && <Skeleton height={220} />}

      {!loading && !fila?.length && (
        <Empty icon={ShieldCheck} title="Nada aqui">
          Nenhum vídeo com este status.
        </Empty>
      )}

      <div className="review-lista">
        {(fila ?? []).map((video) => (
          <Card key={video.id} className="review-item">
            <div className="review-topo">
              <div className="review-nome" title={video.filename}>{video.filename}</div>
              <StatusBadge status={video.classification?.status} />
            </div>

            <div className="review-info">
              <Badge tone="muted">@{video.account.username}</Badge>
              {video.classification?.niche && <Badge tone="brand">{video.classification.niche.name}</Badge>}
              {video.status === 'FAILED' && <Badge tone="danger">fora da fila</Badge>}
            </div>

            {video.classification && (
              <>
                <Meter
                  value={video.classification.score}
                  label={`${Math.round(video.classification.score)}% de compatibilidade`}
                  tone={tomDaNota(video.classification.status)}
                />

                {!!video.classification.reasons?.length && (
                  <ul className="review-motivos">
                    {video.classification.reasons.map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                )}

                {video.classification.scores?.length > 1 && (
                  <details className="review-ranking">
                    <summary>Ver a nota de todos os nichos</summary>
                    {video.classification.scores.map((s) => (
                      <div key={s.nicheId} className="review-ranking-linha">
                        <strong>{s.score}%</strong> <span>{s.name}</span>
                      </div>
                    ))}
                  </details>
                )}
              </>
            )}

            {!video.classification && (
              <p className="muted">Este vídeo ainda não foi analisado.</p>
            )}

            <div className="review-acoes">
              <Select
                defaultValue={video.accountId}
                onChange={(e) => decidir.run({ videoId: video.id, acao: 'APROVAR', accountId: e.target.value })}
                title="Mover para outra conta e liberar"
              >
                {(contas ?? []).map((c) => (
                  <option key={c.id} value={c.id}>@{c.username}</option>
                ))}
              </Select>

              <Button size="sm" icon={Check} onClick={() => decidir.run({ videoId: video.id, acao: 'APROVAR' })}>
                Liberar
              </Button>
              <Button size="sm" variant="ghost" icon={Ban} onClick={() => decidir.run({ videoId: video.id, acao: 'BLOQUEAR' })}>
                Bloquear
              </Button>
              <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => decidir.run({ videoId: video.id, acao: 'RECLASSIFICAR' })}>
                Classificar de novo
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={Send}
                onClick={() => publicarAgora.run(video)}
                loading={publicarAgora.loading}
                title="Publica agora mesmo, ignorando a validação de nicho"
              >
                Postar agora
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {!!stats?.porNicho?.length && (
        <Card title="Distribuição por nicho">
          {stats.porNicho.map((n) => (
            <div key={n.nicheId} className="review-dist">
              <span>{n.name}</span>
              <strong>{n.total}</strong>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

function StatusBadge({ status }) {
  const mapa = {
    APROVADO: ['ok', 'aprovado'],
    REVISAO: ['warn', 'revisão'],
    BLOQUEADO: ['danger', 'bloqueado'],
    SEM_CLASSIFICACAO: ['muted', 'sem nicho'],
  };
  const [tone, texto] = mapa[status] ?? ['muted', 'não analisado'];
  return <Badge tone={tone}>{texto}</Badge>;
}

const tomDaNota = (status) => ({
  APROVADO: 'ok', REVISAO: 'warn', BLOQUEADO: 'danger',
}[status] ?? 'muted');
