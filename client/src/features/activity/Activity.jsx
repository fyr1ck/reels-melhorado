import { useState } from 'react';
import { Activity as ActIcon, Trash2, History } from 'lucide-react';
import { useQuery } from '../../hooks/useQuery.js';
import { useToast } from '../../hooks/useToast.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { api } from '../../lib/api.js';
import { Card, Button, Badge, Tabs, Empty, Skeleton } from '../../design/ui.jsx';
import { dateTime, relative, time } from '../../lib/format.js';
import './activity.css';

const NIVEIS = [
  { value: 'ALL', label: 'Tudo' },
  { value: 'ERROR', label: 'Erros' },
  { value: 'WARN', label: 'Avisos' },
  { value: 'SUCCESS', label: 'Sucessos' },
];

const TOM = { SCHEDULED: 'brand', PUBLISHING: 'warn', PUBLISHED: 'ok', FAILED: 'danger' };

export default function Activity() {
  const [aba, setAba] = useState('logs');
  const [nivel, setNivel] = useState('ALL');
  const toast = useToast();
  const confirm = useConfirm();

  const { data: logs, loading, reload } = useQuery('/logs', {
    params: { level: nivel, limit: 200 },
    refetchMs: 15000,
  });
  const { data: historico } = useQuery('/publications', { params: { limit: 100 } });

  async function limpar() {
    const ok = await confirm({
      title: 'Apagar histórico de logs',
      description: 'Todos os registros de auditoria são apagados. Vídeos, fila e configurações não são afetados.',
      confirmLabel: 'Apagar', danger: true,
    });
    if (!ok) return;
    const r = await api.del('/logs');
    await reload({ quiet: true });
    toast.success(`${r.deleted} registro(s) apagados.`);
  }

  return (
    <>
      <div className="page-head page-head--row">
        <div>
          <h2>Atividade</h2>
          <p>Tudo que a automação tentou, concluiu ou falhou.</p>
        </div>
        {aba === 'logs' && <Button variant="danger" icon={Trash2} onClick={limpar}>Apagar logs</Button>}
      </div>

      <Tabs value={aba} onChange={setAba} items={[
        { value: 'logs', label: 'Logs' },
        { value: 'historico', label: 'Histórico de publicações' },
      ]} />

      {aba === 'logs' && (
        <>
          <Tabs value={nivel} onChange={setNivel} items={NIVEIS} />
          <Card>
            {loading && !logs ? (
              <Skeleton height={200} />
            ) : !logs?.length ? (
              <Empty icon={ActIcon} title="Nenhum registro" />
            ) : (
              logs.map((l) => (
                <div key={l.id} className={`log log--${l.level}`}>
                  <span className="log__when" title={dateTime(l.createdAt)}>{time(l.createdAt)}</span>
                  <div className="log__body">
                    <div className="log__action">{l.action}</div>
                    {l.videoName && <div className="faint">{l.videoName}</div>}
                    {l.message && <div className="log__msg">{l.message}</div>}
                  </div>
                  <span className="faint">{relative(l.createdAt)}</span>
                </div>
              ))
            )}
          </Card>
        </>
      )}

      {aba === 'historico' && (
        <Card>
          {!historico?.length ? (
            <Empty icon={History} title="Nenhuma publicação registrada" />
          ) : (
            historico.map((p) => (
              <div key={p.id} className="cal-item">
                <span className="cal-item__time">{time(p.scheduledAt)}</span>
                <span className="cal-item__name">{p.video?.filename}</span>
                <Badge tone="muted">@{p.account?.username}</Badge>
                <span className="faint">{dateTime(p.publishedAt || p.scheduledAt)}</span>
                <Badge tone={TOM[p.status]}>{p.status.toLowerCase()}</Badge>
              </div>
            ))
          )}
        </Card>
      )}
    </>
  );
}
