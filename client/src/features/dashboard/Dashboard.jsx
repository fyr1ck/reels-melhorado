import { Link } from 'react-router-dom';
import {
  Gauge, Film, CheckCircle2, AlertTriangle, Clock, Play, Pause,
  Users, FileText, ArrowRight,
} from 'lucide-react';
import { useQuery, useMutation } from '../../hooks/useQuery.js';
import { useToast } from '../../hooks/useToast.jsx';
import { api } from '../../lib/api.js';
import { Card, Metric, Button, Badge, Banner, Meter, Empty, Skeleton } from '../../design/ui.jsx';
import { days, dateTime, relative } from '../../lib/format.js';
import './dashboard.css';

const META_DIAS = 14;

function saudacao() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function nivelCobertura(d) {
  if (d == null) return 'muted';
  if (d < 3) return 'danger';
  if (d < 7) return 'warn';
  return 'ok';
}

export default function Dashboard() {
  const { data, loading, reload } = useQuery('/dashboard', { refetchMs: 10000 });
  const toast = useToast();

  const automacao = useMutation(async (acao) => {
    const r = await api.post(`/accounts/automation/${acao}`);
    await reload({ quiet: true });
    toast.success(acao === 'start'
      ? `Automação ligada em ${r.affected} conta(s).`
      : 'Automação pausada em todas as contas.');
  });

  const intervencao = useMutation(async () => {
    await api.post('/dashboard/intervention/resolve');
    await reload({ quiet: true });
    toast.success('Intervenção confirmada.');
  });

  if (loading && !data) {
    return (
      <>
        <div className="page-head"><h2>{saudacao()}</h2></div>
        <Skeleton height={104} className="mt" />
        <div className="grid grid--4 mt">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={104} />)}
        </div>
      </>
    );
  }
  if (!data) return <Card><Empty icon={AlertTriangle} title="Não foi possível carregar o painel." /></Card>;

  const { videos, automation, accounts, next, coverageDays, dailyRate, todayDone, recentErrors } = data;

  return (
    <>
      <div className="page-head page-head--row">
        <div>
          <h2>{saudacao()}</h2>
          <p>Situação da fila, do ritmo e das contas.</p>
        </div>
        <div className="row">
          {automation.running ? (
            <Button icon={Pause} loading={automacao.busy} onClick={() => automacao.run('pause')}>
              Pausar todas
            </Button>
          ) : (
            <Button
              variant="ok"
              icon={Play}
              loading={automacao.busy}
              disabled={accounts.connected === 0}
              onClick={() => automacao.run('start').catch((e) => toast.error(e.message))}
            >
              Iniciar todas
            </Button>
          )}
        </div>
      </div>

      {automation.intervention && (
        <Banner
          tone="warn"
          icon={AlertTriangle}
          action={<Button size="sm" variant="primary" loading={intervencao.busy} onClick={() => intervencao.run()}>Já resolvi</Button>}
        >
          <b>Verificação de segurança no Instagram.</b>{' '}
          {automation.interventionMessage || 'Resolva na janela do navegador aberta e confirme aqui.'}
        </Banner>
      )}

      {accounts.connected === 0 && (
        <Banner tone="danger" icon={Users} action={<Link to="/contas"><Button size="sm">Ir para Contas</Button></Link>}>
          Nenhuma conta conectada ao Instagram. Sem sessão, nada é publicado.
        </Banner>
      )}

      {videos.failed > 0 && (
        <Banner tone="danger" icon={AlertTriangle} action={<Link to="/fila"><Button size="sm">Ver falhados</Button></Link>}>
          {videos.failed} vídeo(s) falharam definitivamente. A automação da conta afetada foi pausada.
        </Banner>
      )}

      {/* Cobertura é a pergunta que o operador realmente faz: "por quantos
          dias eu tenho conteúdo?". Fica em destaque, acima das contagens. */}
      <Card tone="brand" className="cov">
        <div className="cov__main">
          <span className="cov__label"><Gauge size={13} /> Cobertura da fila</span>
          <span className="cov__value metric-value">{days(coverageDays)}</span>
          <span className="dim">
            {dailyRate === 0
              ? 'Nenhum horário configurado — sem ritmo definido, não dá para estimar.'
              : videos.queued === 0
                ? 'A fila está vazia. Adicione vídeos para a automação ter o que publicar.'
                : `${videos.queued} vídeo(s) na fila publicando ${dailyRate} por dia.`}
          </span>
        </div>
        <div className="cov__side">
          <Badge tone={automation.running ? 'ok' : 'muted'}>
            {automation.running ? `${automation.activeAccounts} ATIVA(S)` : 'PAUSADA'}
          </Badge>
          <Meter value={coverageDays ?? 0} max={META_DIAS} tone={nivelCobertura(coverageDays)} label="Cobertura" />
          <span className="faint">meta: {META_DIAS} dias</span>
        </div>
      </Card>

      <div className="grid grid--4 mt">
        <Metric icon={Film} label="Na fila" value={videos.queued}
                hint={`${videos.pending} pendentes · ${videos.scheduled} agendados`} />
        <Metric icon={CheckCircle2} label="Publicados" value={videos.published}
                hint={`${todayDone} hoje`} tone={videos.published > 0 ? 'ok' : undefined} />
        <Metric icon={Users} label="Contas" value={`${accounts.connected}/${accounts.total}`}
                hint="conectadas ao Instagram"
                tone={accounts.connected === 0 ? 'danger' : undefined} />
        <Metric icon={FileText} label="Sem legenda" value={videos.noCaption}
                hint="na fila, aguardando texto"
                tone={videos.noCaption > 0 ? 'warn' : undefined} />
      </div>

      <div className="grid grid--2 mt">
        <Card title="Próxima publicação" icon={Clock}>
          {next ? (
            <div className="next">
              <div className="next__when">
                <b>{dateTime(next.at)}</b>
                <span className="faint">{relative(next.at)}</span>
              </div>
              <div className="next__what">
                <span>{next.filename}</span>
                <Badge tone="brand">@{next.account}</Badge>
              </div>
            </div>
          ) : (
            <Empty icon={Clock} title="Nada agendado">
              Adicione vídeos à fila e cadastre horários para a automação começar.
            </Empty>
          )}
        </Card>

        <Card
          title="Erros recentes"
          icon={AlertTriangle}
          action={<Link to="/atividade" className="faint row">ver tudo <ArrowRight size={12} /></Link>}
        >
          {recentErrors.length === 0 ? (
            <Empty icon={CheckCircle2} title="Nenhum erro registrado" />
          ) : (
            <ul className="errs">
              {recentErrors.map((e) => (
                <li key={e.id}>
                  <div className="errs__head">
                    <b>{e.action}</b>
                    <span className="faint">{relative(e.createdAt)}</span>
                  </div>
                  {e.message && <p className="faint">{e.message}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Por conta" icon={Users} className="mt"
            action={<Link to="/contas" className="faint row">gerenciar <ArrowRight size={12} /></Link>}>
        <div className="grid grid--auto">
          {data.perAccount.map((a) => (
            <div key={a.id} className="acct">
              <div className="acct__top">
                <span className="acct__av">{a.username.slice(0, 2).toUpperCase()}</span>
                <div className="acct__id">
                  <b>@{a.username}</b>
                  <span className="faint">{a.label || 'sem apelido'}</span>
                </div>
                <Badge tone={a.health.level}>{a.health.label}</Badge>
              </div>
              <div className="acct__nums">
                <span><b>{a.reels}</b> reels</span>
                <span><b>{days(a.coverageDays)}</b> cobertura</span>
                <span className="faint">{a.slots} horário(s)/dia</span>
              </div>
              <Meter value={a.coverageDays ?? 0} max={META_DIAS} tone={nivelCobertura(a.coverageDays)} />
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
