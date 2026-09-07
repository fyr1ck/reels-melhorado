import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Film } from 'lucide-react';
import { useQuery } from '../../hooks/useQuery.js';
import { useAccount } from '../../hooks/useAccount.jsx';
import { Card, Badge, Empty, Skeleton, Metric, Meter } from '../../design/ui.jsx';
import { time, dateTime } from '../../lib/format.js';
import './calendar.css';

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const TOM = { SCHEDULED: 'brand', PUBLISHING: 'warn', PUBLISHED: 'ok', FAILED: 'danger' };

/**
 * Chave local YYYY-MM-DD.
 *
 * `toISOString` converte para UTC, e no fuso do Brasil isso joga uma
 * publicação da noite para o dia seguinte na grade — o post das 22h de
 * segunda apareceria na terça.
 */
function chave(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Semanas completas do mês, incluindo os dias vizinhos que fecham a grade. */
function semanasDoMes(ano, mes) {
  const inicio = new Date(ano, mes, 1);
  inicio.setDate(inicio.getDate() - inicio.getDay());

  const ultimoDia = new Date(ano, mes + 1, 0);
  const semanas = [];
  const cursor = new Date(inicio);

  for (let s = 0; s < 6; s++) {
    const semana = [];
    for (let d = 0; d < 7; d++) {
      semana.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    semanas.push(semana);
    if (cursor > ultimoDia) break; // não gera semana inteira fora do mês
  }
  return semanas;
}

export default function Calendar() {
  const { accountId, account } = useAccount();
  const hoje = new Date();
  const [ref, setRef] = useState({ ano: hoje.getFullYear(), mes: hoje.getMonth() });
  const [diaAberto, setDiaAberto] = useState(chave(hoje));

  const { data: pubs, loading } = useQuery('/publications', {
    params: { accountId, order: 'asc', limit: 500 },
    enabled: !!accountId,
    refetchMs: 30000,
  });

  const porDia = useMemo(() => {
    const mapa = {};
    for (const p of pubs ?? []) (mapa[chave(new Date(p.scheduledAt))] ||= []).push(p);
    return mapa;
  }, [pubs]);

  const semanas = useMemo(() => semanasDoMes(ref.ano, ref.mes), [ref]);

  const doMes = (pubs ?? []).filter((p) => {
    const d = new Date(p.scheduledAt);
    return d.getFullYear() === ref.ano && d.getMonth() === ref.mes;
  });
  const publicados = doMes.filter((p) => p.status === 'PUBLISHED').length;
  const agendados = doMes.filter((p) => p.status === 'SCHEDULED').length;

  const nomeMes = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' })
    .format(new Date(ref.ano, ref.mes, 1));

  const mover = (delta) => setRef(({ ano, mes }) => {
    const d = new Date(ano, mes + delta, 1);
    return { ano: d.getFullYear(), mes: d.getMonth() };
  });

  const itensDoDia = porDia[diaAberto] ?? [];

  if (loading && !pubs) return <Skeleton height={420} />;

  return (
    <>
      <div className="page-head">
        <h2>Calendário</h2>
        <p>Agenda de <b>@{account?.username ?? '—'}</b>, mês a mês.</p>
      </div>

      <div className="grid grid--3">
        <Metric icon={CalendarDays} label="No mês" value={doMes.length} hint="publicações no total" />
        <Metric label="Agendadas" value={agendados} hint="ainda vão ao ar" />
        <Metric
          label="Publicadas" value={publicados}
          hint={doMes.length ? `${Math.round((publicados / doMes.length) * 100)}% do mês` : '—'}
          tone={publicados ? 'ok' : undefined}
        />
      </div>

      {doMes.length > 0 && (
        <div className="mt">
          <Meter value={publicados} max={doMes.length} tone="ok" label="Progresso do mês" />
        </div>
      )}

      <Card
        className="mt"
        title={nomeMes[0].toUpperCase() + nomeMes.slice(1)}
        icon={CalendarDays}
        action={
          <div className="cal__nav">
            <button onClick={() => mover(-1)} aria-label="Mês anterior"><ChevronLeft size={16} /></button>
            <button onClick={() => setRef({ ano: hoje.getFullYear(), mes: hoje.getMonth() })}>Hoje</button>
            <button onClick={() => mover(1)} aria-label="Próximo mês"><ChevronRight size={16} /></button>
          </div>
        }
      >
        <div className="cal">
          {SEMANA.map((d) => <span key={d} className="cal__dow">{d}</span>)}

          {semanas.flat().map((dia) => {
            const k = chave(dia);
            const itens = porDia[k] ?? [];
            const foraDoMes = dia.getMonth() !== ref.mes;

            return (
              <button
                key={k}
                className={[
                  'cal__dia',
                  foraDoMes && 'is-fora',
                  k === chave(hoje) && 'is-hoje',
                  diaAberto === k && 'is-aberto',
                ].filter(Boolean).join(' ')}
                onClick={() => setDiaAberto(k)}
              >
                <span className="cal__num">{dia.getDate()}</span>
                {itens.length > 0 && (
                  <span className="cal__pontos">
                    {/* Até 3 pontos, o resto vira "+N": uma coluna de 12
                        bolinhas não diz mais do que "muitas". */}
                    {itens.slice(0, 3).map((p) => (
                      <i key={p.id} className={`cal__ponto cal__ponto--${p.status}`} />
                    ))}
                    {itens.length > 3 && <em>+{itens.length - 3}</em>}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="mt" title={`Dia ${diaAberto.split('-').reverse().join('/')}`} icon={Film}>
        {!itensDoDia.length ? (
          <Empty icon={CalendarDays} title="Nada agendado neste dia">
            Adicione vídeos à fila e cadastre horários.
          </Empty>
        ) : (
          itensDoDia.map((p) => (
            <div key={p.id} className="cal-item">
              <span className="cal-item__time">{time(p.scheduledAt)}</span>
              <span className="cal-item__name">{p.video?.filename}</span>
              <span className="faint">{p.publishedAt ? dateTime(p.publishedAt) : ''}</span>
              <Badge tone={TOM[p.status]}>{p.status.toLowerCase()}</Badge>
            </div>
          ))
        )}
      </Card>
    </>
  );
}
