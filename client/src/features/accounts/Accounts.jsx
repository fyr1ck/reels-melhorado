import { useState } from 'react';
import {
  UserPlus, Plug, Unplug, Play, Pause, Power, Star, Trash2, Shuffle, Info, Pencil,
} from 'lucide-react';
import { useAccount } from '../../hooks/useAccount.jsx';
import { useToast } from '../../hooks/useToast.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { useMutation } from '../../hooks/useQuery.js';
import { api } from '../../lib/api.js';
import { Card, Button, Badge, Input, Field, Checkbox, Meter, Banner, Empty } from '../../design/ui.jsx';
import AccountEditor from './AccountEditor.jsx';
import { days, dateTime } from '../../lib/format.js';
import './accounts.css';

export default function Accounts() {
  const { accounts, loading, reload, select } = useAccount();
  const toast = useToast();
  const confirm = useConfirm();

  const [form, setForm] = useState({ username: '', label: '' });
  const [busyId, setBusyId] = useState(null);
  const [editando, setEditando] = useState(null);

  const criar = useMutation(async () => {
    const conta = await api.post('/accounts', form);
    setForm({ username: '', label: '' });
    await reload();
    select(conta.id);
    toast.success(`@${conta.username} cadastrada. Agora conecte ao Instagram.`);
  });

  async function patch(conta, data, msg) {
    setBusyId(conta.id);
    try {
      await api.patch(`/accounts/${conta.id}`, data);
      await reload();
      if (msg) toast.success(msg);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function conectar(conta) {
    const ok = await confirm({
      title: `Conectar @${conta.username}`,
      description:
        'Uma janela real do Chromium vai abrir. Faça o login você mesmo, incluindo 2FA ou ' +
        'verificação, até ver o feed normal. O app nunca vê nem guarda sua senha — só os ' +
        'cookies da sessão.',
      confirmLabel: 'Abrir navegador',
    });
    if (!ok) return;

    setBusyId(conta.id);
    toast.info('Navegador abrindo. Conclua o login na janela.');
    try {
      await api.post(`/accounts/${conta.id}/connect`);
      await reload();
      toast.success(`@${conta.username} conectada.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function desconectar(conta) {
    const ok = await confirm({
      title: `Desconectar @${conta.username}`,
      description: 'A sessão salva é apagada e a automação dessa conta é pausada. Os vídeos da fila continuam onde estão.',
      confirmLabel: 'Desconectar',
      danger: true,
    });
    if (!ok) return;
    await api.post(`/accounts/${conta.id}/disconnect`);
    await reload();
    toast.success('Conta desconectada.');
  }

  async function remover(conta) {
    const ok = await confirm({
      title: `Remover @${conta.username}`,
      description:
        'A conta, a sessão e os vídeos dela saem do banco. Os ARQUIVOS de vídeo permanecem ' +
        'no disco, em videos/. Não há desfazer.',
      confirmLabel: 'Remover',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/accounts/${conta.id}`);
      await reload();
      toast.success('Conta removida.');
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (loading) return <Card><Empty title="Carregando contas…" /></Card>;

  return (
    <>
      <div className="page-head">
        <h2>Contas do Instagram</h2>
        <p>
          Cada conta tem sessão, fila e horários próprios. O isolamento é só de sessão —
          o app não mascara fingerprint nem usa navegador anti-detecção.
        </p>
      </div>

      <Card title="Nova conta" icon={UserPlus}>
        <form
          className="acc-form"
          onSubmit={(e) => { e.preventDefault(); criar.run().catch(() => {}); }}
        >
          <Field label="@ da conta">
            <Input
              placeholder="usuario"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </Field>
          <Field label="Apelido (opcional)">
            <Input
              placeholder="Ex: perfil de futebol"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
          </Field>
          <Button variant="primary" icon={UserPlus} type="submit" loading={criar.busy}>
            Cadastrar
          </Button>
        </form>
        {criar.error && <Banner tone="danger" className="mt">{criar.error.message}</Banner>}
      </Card>

      <div className="grid grid--auto mt">
        {accounts.map((a) => (
          <Card key={a.id} className={`acc${a.enabled ? '' : ' is-off'}`}>
            <div className="acc__head">
              <span className="acc__av">{a.username.slice(0, 2).toUpperCase()}</span>
              <div className="acc__id">
                <b>@{a.username}</b>
                <span className="faint">{a.label || 'sem apelido'}</span>
              </div>
              <Badge tone={a.health.level}>{a.health.label}</Badge>
            </div>

            <div className="acc__stats">
              <div><b>{a.reels}</b><span>reels</span></div>
              <div><b>{days(a.coverageDays)}</b><span>cobertura</span></div>
              <div><b>{a.slots}</b><span>horários/dia</span></div>
              <div><b>{a.published}</b><span>publicados</span></div>
            </div>

            <Meter value={a.coverageDays ?? 0} max={14}
                   tone={a.coverageDays == null ? 'muted' : a.coverageDays < 3 ? 'danger' : a.coverageDays < 7 ? 'warn' : 'ok'} />

            <p className="acc__next faint">
              {a.nextAt ? `Próxima: ${dateTime(a.nextAt)} · ${a.nextName}` : 'Nenhuma publicação agendada.'}
              {a.connected && a.lastConnectedAt && <><br />Conectada em {dateTime(a.lastConnectedAt)}</>}
            </p>

            <div className="acc__flags">
              {a.randomOrder && <Badge tone="muted"><Shuffle size={11} /> ordem aleatória</Badge>}
              <Badge tone="muted">
                {a.scheduleMode === 'INTERVAL' ? `a cada ${a.intervalMinutes} min` : `${a.slots} horário(s)`}
              </Badge>
              {a.fallbackCaption && <Badge tone="muted">legenda padrão</Badge>}
            </div>

            <div className="acc__actions">
              {a.connected ? (
                <Button size="sm" icon={Unplug} onClick={() => desconectar(a)} disabled={busyId === a.id}>
                  Desconectar
                </Button>
              ) : (
                <Button size="sm" variant="primary" icon={Plug} loading={busyId === a.id} onClick={() => conectar(a)}>
                  Conectar
                </Button>
              )}

              {a.status === 'ACTIVE' ? (
                <Button size="sm" icon={Pause} disabled={busyId === a.id}
                        onClick={() => patch(a, { status: 'PAUSED' }, 'Automação pausada.')}>
                  Pausar
                </Button>
              ) : (
                <Button size="sm" variant="ok" icon={Play} disabled={busyId === a.id}
                        onClick={() => patch(a, { status: 'ACTIVE' }, 'Automação ativada.')}>
                  Ativar
                </Button>
              )}

              <Button size="sm" icon={Power} disabled={busyId === a.id}
                      onClick={() => patch(a, { enabled: !a.enabled })}>
                {a.enabled ? 'Ligada' : 'Desligada'}
              </Button>

              <Button
                size="sm" icon={Pencil} title="Editar @, apelido, legenda e capa padrão desta conta"
                onClick={() => setEditando(editando === a.id ? null : a.id)}
              >
                Editar
              </Button>

              {!a.isDefault && (
                <Button size="sm" icon={Star} title="Tornar conta padrão"
                        onClick={async () => { await api.post(`/accounts/${a.id}/default`); await reload(); }} />
              )}

              {/* O botão fica SEMPRE visível, desabilitado com o motivo quando
                  não dá para excluir. Escondê-lo fazia parecer que a função não
                  existia — e a mais comum de querer excluir é justamente a
                  conta padrão, criada automaticamente. */}
              <Button
                size="sm" variant="danger" icon={Trash2}
                disabled={accounts.length === 1}
                title={accounts.length === 1
                  ? 'O app precisa de ao menos uma conta. Cadastre outra para poder excluir esta.'
                  : `Excluir @${a.username}`}
                onClick={() => remover(a)}
              >
                Excluir
              </Button>

              {a.isDefault && <Badge tone="brand">padrão</Badge>}
            </div>
          </Card>
        ))}
      </div>

      {editando && (
        <div className="mt">
          <AccountEditor
            account={accounts.find((a) => a.id === editando)}
            onSaved={async () => { await reload(); setEditando(null); }}
          />
        </div>
      )}

      <Card title="Como funciona" icon={Info} className="mt">
        <ul className="acc-help">
          <li><Plug size={13} /> <b>Conectar</b> abre o Chromium para você logar. A senha nunca passa pelo app.</li>
          <li><Play size={13} /> <b>Ativar</b> só é aceito depois de conectar — ativar sem sessão geraria falha em loop.</li>
          <li><Shuffle size={13} /> <b>Ordem aleatória</b> sorteia o próximo vídeo em vez de seguir a fila.</li>
          <li><Power size={13} /> <b>Desligada</b> tira a conta do agendador sem apagar sessão nem fila.</li>
        </ul>
      </Card>
    </>
  );
}
