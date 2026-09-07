import { CalendarDays } from 'lucide-react';
import { useQuery } from '../../hooks/useQuery.js';
import { useAccount } from '../../hooks/useAccount.jsx';
import { Card, Badge, Empty, Skeleton } from '../../design/ui.jsx';
import { date, time, relative } from '../../lib/format.js';
import '../activity/activity.css';

const TOM = { SCHEDULED: 'brand', PUBLISHING: 'warn', PUBLISHED: 'ok', FAILED: 'danger' };

export default function Calendar() {
  const { accountId, account } = useAccount();
  const { data, loading } = useQuery('/publications', {
    params: { accountId, order: 'asc', status: 'SCHEDULED' },
    enabled: !!accountId,
    refetchMs: 30000,
  });

  // Agrupa por dia no cliente: a API devolve ordenado, então basta quebrar
  // quando a data muda.
  const dias = {};
  for (const p of data ?? []) {
    const k = date(p.scheduledAt);
    (dias[k] ||= []).push(p);
  }

  return (
    <>
      <div className="page-head">
        <h2>Calendário</h2>
        <p>Próximas publicações de <b>@{account?.username ?? '—'}</b>, por dia.</p>
      </div>

      {loading && !data ? (
        <Skeleton height={220} />
      ) : !data?.length ? (
        <Card>
          <Empty icon={CalendarDays} title="Nada agendado">
            Adicione vídeos à fila e cadastre horários para a agenda se preencher.
          </Empty>
        </Card>
      ) : (
        <Card>
          {Object.entries(dias).map(([dia, itens]) => (
            <div key={dia} className="cal-day">
              <div className="cal-day__label">{dia} · {itens.length} publicação(ões)</div>
              {itens.map((p) => (
                <div key={p.id} className="cal-item">
                  <span className="cal-item__time">{time(p.scheduledAt)}</span>
                  <span className="cal-item__name">{p.video?.filename}</span>
                  <span className="faint">{relative(p.scheduledAt)}</span>
                  <Badge tone={TOM[p.status]}>{p.status.toLowerCase()}</Badge>
                </div>
              ))}
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
