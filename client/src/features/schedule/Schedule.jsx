import { useEffect, useState } from 'react';
import { Clock, Plus, Trash2, Power, Repeat, ShieldCheck, Moon, Flame, Gauge } from 'lucide-react';
import { useQuery, useMutation } from '../../hooks/useQuery.js';
import { useAccount } from '../../hooks/useAccount.jsx';
import { useToast } from '../../hooks/useToast.jsx';
import { api } from '../../lib/api.js';
import { Card, Button, Badge, Input, Field, Select, Empty, Banner, Checkbox, Meter } from '../../design/ui.jsx';
import './schedule.css';

export default function Schedule() {
  const { accountId, account, reload: reloadAccounts } = useAccount();
  const toast = useToast();
  const [novo, setNovo] = useState('12:00');
  const [ritmo, setRitmo] = useState({ valor: 60, unidade: 'min' });

  // "a cada 2 horas" é mais fácil de raciocinar do que "a cada 120 minutos".
  useEffect(() => {
    const m = account?.intervalMinutes ?? 60;
    setRitmo(m % 60 === 0 && m >= 60 ? { valor: m / 60, unidade: 'h' } : { valor: m, unidade: 'min' });
  }, [account?.id, account?.intervalMinutes]);

  const [limites, setLimites] = useState({
    dailyLimit: 0, quietStart: '', quietEnd: '', warmupDays: 14, warmupTarget: 6,
  });

  useEffect(() => {
    if (!account) return;
    setLimites({
      dailyLimit: account.dailyLimit ?? 0,
      quietStart: account.quietStart ?? '',
      quietEnd: account.quietEnd ?? '',
      warmupDays: account.warmupDays ?? 14,
      warmupTarget: account.warmupTarget ?? 6,
    });
  }, [account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const aquecendo = !!account?.warmupStartAt;

  // Dias civis, como o servidor conta: quem liga o aquecimento às 23h não
  // pode ver o dia 2 começar uma hora depois.
  const diaAquecimento = aquecendo
    ? Math.floor(
      (new Date().setHours(0, 0, 0, 0) - new Date(account.warmupStartAt).setHours(0, 0, 0, 0))
      / 86400000,
    ) + 1
    : 0;

  const tetoDeHoje = aquecendo
    ? Math.max(1, Math.ceil(
      (account.warmupTarget * Math.min(diaAquecimento, account.warmupDays)) / account.warmupDays,
    ))
    : null;

  async function salvarLimites(patch) {
    try {
      await api.patch(`/accounts/${accountId}`, patch);
      await reloadAccounts();
      toast.success('Limites atualizados. A grade foi refeita.');
    } catch (err) {
      toast.error(err.message);
    }
  }

  // Os dois campos do silêncio andam juntos: meia faixa não é uma regra.
  const salvarSilencio = () => {
    if (limites.quietStart && limites.quietEnd) {
      salvarLimites({ quietStart: limites.quietStart, quietEnd: limites.quietEnd });
    }
  };

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

  async function salvarRitmo(proximo) {
    const r = proximo ?? ritmo;
    const intervalMinutes = r.unidade === 'h' ? r.valor * 60 : r.valor;
    try {
      await api.patch(`/accounts/${accountId}`, { intervalMinutes });
      await reloadAccounts();
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
  const maximo = ritmo.unidade === 'h' ? 24 : 1440;

  return (
    <>
      <div className="page-head">
        <h2>Horários</h2>
        <p>Grade de publicação de <b>@{account?.username ?? '—'}</b>. Cada conta tem a sua.</p>
      </div>

      <Card title="Quando publicar" icon={Repeat}>
        {/* Os dois modos lado a lado, sempre visíveis. Escondê-los atrás de um
            seletor fazia o modo intervalo parecer inexistente. */}
        <div className="ritmo__modos">
          <button
            type="button"
            className={`ritmo__modo${!modoIntervalo ? ' is-on' : ''}`}
            onClick={() => trocarModo('TIMES')}
          >
            <b>Horários fixos</b>
            <span>Ex: todo dia às 08:00, 12:00 e 18:00. Cadastre abaixo.</span>
          </button>

          <button
            type="button"
            className={`ritmo__modo${modoIntervalo ? ' is-on' : ''}`}
            onClick={() => trocarModo('INTERVAL')}
          >
            <b>A cada X tempo</b>
            <span>Ex: a cada 20 minutos, ou a cada 2 horas, sem parar.</span>
          </button>
        </div>

        {modoIntervalo && (
          <>
            <div className="ritmo__valor mt">
              <span>Publicar a cada</span>
              <Input
                type="number" min={1} max={maximo} value={ritmo.valor}
                onChange={(e) => setRitmo((r) => ({
                  ...r, valor: Math.min(maximo, Math.max(1, Number(e.target.value) || 1)),
                }))}
                onBlur={salvarRitmo}
              />
              <Select
                value={ritmo.unidade}
                onChange={(e) => {
                  const unidade = e.target.value;
                  // Mantém o valor dentro do limite da nova unidade em vez de
                  // deixar "300 horas" virar um intervalo impossível.
                  const valor = Math.min(unidade === 'h' ? 24 : 1440, ritmo.valor);
                  setRitmo({ unidade, valor });
                  salvarRitmo({ unidade, valor });
                }}
              >
                <option value="min">minutos</option>
                <option value="h">horas</option>
              </Select>

              <div className="ritmo__atalhos">
                {[[10, 'min'], [20, 'min'], [30, 'min'], [1, 'h'], [2, 'h'], [6, 'h']].map(([v, u]) => (
                  <button
                    key={`${v}${u}`}
                    type="button"
                    className={`ritmo__atalho${ritmo.valor === v && ritmo.unidade === u ? ' is-on' : ''}`}
                    onClick={() => { setRitmo({ valor: v, unidade: u }); salvarRitmo({ valor: v, unidade: u }); }}
                  >
                    {v}{u === 'h' ? 'h' : 'min'}
                  </button>
                ))}
              </div>
            </div>

            <p className="faint mt">
              A fila inteira é distribuída a partir de agora, um vídeo a cada{' '}
              <b>{ritmo.valor} {ritmo.unidade === 'h' ? (ritmo.valor === 1 ? 'hora' : 'horas') : 'minutos'}</b>.
              Os horários fixos abaixo ficam salvos, mas não são usados neste modo.
            </p>
          </>
        )}
      </Card>

      {/* Limites de segurança: o que protege a conta de ser bloqueada e o
          conteúdo de ser desperdiçado. Aplicados na GERAÇÃO da grade, e não na
          hora de publicar — assim o calendário mostra o que vai acontecer de
          verdade, em vez de uma grade que seria ignorada depois. */}
      <Card title="Limites de segurança" icon={ShieldCheck} className="mt">
        <div className="lim">
          <div className="lim__bloco">
            <div className="lim__cab">
              <Gauge size={14} />
              <b>Teto diário</b>
            </div>
            <p className="faint">
              Máximo de publicações por dia nesta conta, independente de quantos horários existam.
            </p>
            <div className="row mt">
              <Input
                type="number" min={0} max={200} style={{ width: 92 }}
                value={limites.dailyLimit}
                onChange={(e) => setLimites((l) => ({ ...l, dailyLimit: Number(e.target.value) }))}
                onBlur={() => salvarLimites({ dailyLimit: limites.dailyLimit })}
              />
              <span className="faint">
                {limites.dailyLimit > 0 ? 'por dia' : 'sem teto — usa todos os horários'}
              </span>
            </div>
          </div>

          <div className="lim__bloco">
            <div className="lim__cab">
              <Moon size={14} />
              <b>Janela de silêncio</b>
            </div>
            <p className="faint">
              Faixa em que a conta não publica. Pode atravessar a meia-noite. Postar de madrugada
              não bloqueia nada, mas o vídeo nasce sem audiência.
            </p>
            <div className="row mt">
              <Input
                type="time" style={{ width: 118 }}
                value={limites.quietStart}
                onChange={(e) => setLimites((l) => ({ ...l, quietStart: e.target.value }))}
                onBlur={salvarSilencio}
              />
              <span className="faint">até</span>
              <Input
                type="time" style={{ width: 118 }}
                value={limites.quietEnd}
                onChange={(e) => setLimites((l) => ({ ...l, quietEnd: e.target.value }))}
                onBlur={salvarSilencio}
              />
              {(limites.quietStart || limites.quietEnd) && (
                <Button
                  size="sm" variant="ghost" icon={Trash2} title="Desligar o silêncio"
                  onClick={() => {
                    setLimites((l) => ({ ...l, quietStart: '', quietEnd: '' }));
                    salvarLimites({ quietStart: '', quietEnd: '' });
                  }}
                />
              )}
            </div>
          </div>
        </div>

        <div className="lim__bloco mt">
          <div className="lim__cab">
            <Flame size={14} />
            <b>Aquecimento da conta</b>
            {aquecendo && <Badge tone="brand">dia {diaAquecimento} de {account.warmupDays}</Badge>}
          </div>
          <Checkbox
            className="mt"
            label="Começar devagar e ir aumentando"
            hint="Perfil novo que publica 15 reels no primeiro dia é o caminho mais curto para o bloqueio. A rampa começa em 1 por dia e cresce até o alvo."
            checked={aquecendo}
            onChange={(e) => salvarLimites({ warmupEnabled: e.target.checked })}
          />

          {aquecendo && (
            <>
              <div className="row mt">
                <Field label="Dias até o ritmo normal">
                  <Input
                    type="number" min={1} max={90} style={{ width: 92 }}
                    value={limites.warmupDays}
                    onChange={(e) => setLimites((l) => ({ ...l, warmupDays: Number(e.target.value) }))}
                    onBlur={() => salvarLimites({ warmupDays: limites.warmupDays })}
                  />
                </Field>
                <Field label="Alvo (posts/dia no fim)">
                  <Input
                    type="number" min={1} max={50} style={{ width: 92 }}
                    value={limites.warmupTarget}
                    onChange={(e) => setLimites((l) => ({ ...l, warmupTarget: Number(e.target.value) }))}
                    onBlur={() => salvarLimites({ warmupTarget: limites.warmupTarget })}
                  />
                </Field>
              </div>

              <div className="mt">
                <Meter
                  value={Math.min(diaAquecimento, account.warmupDays)}
                  max={account.warmupDays} tone="brand" label="Progresso do aquecimento"
                />
                <p className="faint mt">
                  Hoje esta conta publica no máximo <b>{tetoDeHoje}</b> vídeo(s).
                  Ao fim do aquecimento, {account.warmupTarget} por dia.
                </p>
              </div>
            </>
          )}
        </div>
      </Card>

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
