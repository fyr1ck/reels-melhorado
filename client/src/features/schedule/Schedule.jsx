import { useState } from 'react';
import { Clock, Plus, Trash2, Power, Repeat } from 'lucide-react';
import { useQuery, useMutation } from '../../hooks/useQuery.js';
import { useAccount } from '../../hooks/useAccount.jsx';
import { useToast } from '../../hooks/useToast.jsx';
import { api } from '../../lib/api.js';
import { Card, Button, Badge, Input, Field, Select, Empty, Banner } from '../../design/ui.jsx';
import './schedule.css';

export default function Schedule() {
  const { accountId, account, reload: reloadAccounts } = useAccount();
  const toast = useToast();
  const [novo, setNovo] = useState('12:00');

  const { data: slots, reload } = useQuery('/slots', {
    params: { accountId, mediaType: 'REEL' },
    enabled: !!accountId,
  });

  const criar = useMutation(async () => {
    await api.post('/slots', { accountId, time: novo, mediaType: 'REEL' });
    await reload({ quiet: true });
    toast.success(`Horário ${novo} cadastrado.`);
  });

  async function patch(slot, data) {
    try {
      await api.patch(`/slots/${slot.id}`, data);
      await reload({ quiet: true });
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function trocarModo(mode) {
    await api.patch(`/accounts/${accountId}`, { scheduleMode: mode });
    await reloadAccounts();
    toast.success(mode === 'TIMES' ? 'Modo horários fixos.' : 'Modo intervalo.');
  }

  const ativos = slots?.filter((s) => s.enabled).length ?? 0;
  const modoIntervalo = account?.scheduleMode === 'INTERVAL';

  return (
    <>
      <div className="page-head">
        <h2>Horários</h2>
        <p>Grade de publicação de <b>@{account?.username ?? '—'}</b>. Cada conta tem a sua.</p>
      </div>

      <Card title="Modo de agendamento" icon={Repeat}>
        <div className="grid grid--2">
          <Field label="Como publicar">
            <Select value={account?.scheduleMode ?? 'TIMES'} onChange={(e) => trocarModo(e.target.value)}>
              <option value="TIMES">Horários fixos (ex: 08:00, 12:00, 18:00)</option>
              <option value="INTERVAL">A cada N minutos</option>
            </Select>
          </Field>
          {modoIntervalo && (
            <Field label="Intervalo em minutos" hint="Entre 1 e 1440 (24 h).">
              <Input
                type="number" min={1} max={1440}
                defaultValue={account?.intervalMinutes ?? 60}
                onBlur={async (e) => {
                  try {
                    await api.patch(`/accounts/${accountId}`, { intervalMinutes: Number(e.target.value) });
                    await reloadAccounts();
                    toast.success('Intervalo salvo.');
                  } catch (err) { toast.error(err.message); }
                }}
              />
            </Field>
          )}
        </div>
      </Card>

      {modoIntervalo ? (
        <Banner tone="brand" icon={Clock} className="mt">
          No modo intervalo a fila inteira é distribuída a cada {account?.intervalMinutes} minutos
          a partir de agora. Os horários fixos abaixo ficam salvos, mas não são usados.
        </Banner>
      ) : null}

      <Card title={`Horários cadastrados (${ativos} ativos)`} icon={Clock} className="mt">
        <form className="slot-add" onSubmit={(e) => { e.preventDefault(); criar.run().catch((err) => toast.error(err.message)); }}>
          <Field label="Novo horário">
            <Input type="time" value={novo} onChange={(e) => setNovo(e.target.value)} />
          </Field>
          <div />
          <Button variant="primary" icon={Plus} type="submit" loading={criar.busy}>Adicionar</Button>
        </form>

        <div className="mt">
          {!slots?.length ? (
            <Empty icon={Clock} title="Nenhum horário cadastrado">
              Sem horário, a automação não tem quando publicar.
            </Empty>
          ) : (
            slots.map((s) => (
              <div key={s.id} className="slot">
                <span className="slot__time">{s.time}</span>

                <div className="slot__jit">
                  <Input
                    type="number" min={0} max={120}
                    defaultValue={s.jitterMinutes}
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      if (n !== s.jitterMinutes) patch(s, { jitterMinutes: n });
                    }}
                    title="Variação aleatória em minutos"
                  />
                  <span className="faint">min</span>
                </div>

                <span className="slot__win">{s.window}</span>
                <span className="slot__sp" />

                <Badge tone={s.enabled ? 'ok' : 'muted'}>{s.enabled ? 'ativo' : 'inativo'}</Badge>
                <Button size="sm" variant="ghost" icon={Power} title={s.enabled ? 'Desativar' : 'Ativar'}
                        onClick={() => patch(s, { enabled: !s.enabled })} />
                <Button size="sm" variant="ghost" icon={Trash2} title="Remover"
                        onClick={async () => { await api.del(`/slots/${s.id}`); await reload({ quiet: true }); }} />
              </div>
            ))
          )}
        </div>

        <p className="faint mt">
          A <b>variação</b> sorteia o minuto exato dentro da janela. Publicar sempre no minuto
          cravado é um padrão facilmente reconhecível; com 10 min o post sai em algum ponto
          entre 10 antes e 10 depois.
        </p>
      </Card>
    </>
  );
}
