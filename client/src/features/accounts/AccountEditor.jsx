import { useEffect, useState } from 'react';
import { Save, AtSign, FileText, Timer, Shuffle } from 'lucide-react';
import { useMutation } from '../../hooks/useQuery.js';
import { useToast } from '../../hooks/useToast.jsx';
import { api } from '../../lib/api.js';
import { Card, Button, Input, Textarea, Select, Field, Checkbox } from '../../design/ui.jsx';

/**
 * Edição de uma conta.
 *
 * Tudo que é POR CONTA mora aqui: o @, a legenda de último recurso, o ritmo de
 * publicação e a ordem da fila. Antes só dava para trocar o apelido — a conta
 * padrão nascia como "conta-principal" e ficava assim para sempre, sem relação
 * com o perfil real do Instagram.
 */

/**
 * Converte minutos numa unidade legível e vice-versa: "a cada 2 horas" é mais
 * fácil de raciocinar do que "a cada 120 minutos".
 */
function decompor(minutos) {
  if (minutos % 60 === 0 && minutos >= 60) return { valor: minutos / 60, unidade: 'h' };
  return { valor: minutos, unidade: 'min' };
}

export default function AccountEditor({ account, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [ritmo, setRitmo] = useState({ valor: 60, unidade: 'min' });

  useEffect(() => {
    if (!account) return;
    setForm({
      username: account.username,
      label: account.label ?? '',
      fallbackCaption: account.fallbackCaption ?? '',
      scheduleMode: account.scheduleMode,
      randomOrder: account.randomOrder,
    });
    setRitmo(decompor(account.intervalMinutes ?? 60));
  }, [account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const salvar = useMutation(async () => {
    const intervalMinutes = ritmo.unidade === 'h' ? ritmo.valor * 60 : ritmo.valor;
    await api.patch(`/accounts/${account.id}`, { ...form, intervalMinutes });
    await onSaved?.();
    toast.success('Conta atualizada.');
  });

  if (!form) return null;

  const set = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));
  const maximo = ritmo.unidade === 'h' ? 24 : 1440;

  return (
    <Card
      title={`Editar @${account.username}`}
      icon={AtSign}
      action={
        <Button
          variant="primary" icon={Save} loading={salvar.busy}
          onClick={() => salvar.run().catch((e) => toast.error(e.message))}
        >
          Salvar
        </Button>
      }
    >
      <div className="grid grid--2">
        <Field label="@ do Instagram" hint="O nome real do perfil. Trocar aqui não desconecta a sessão.">
          <Input value={form.username} onChange={(e) => set('username', e.target.value)} />
        </Field>
        <Field label="Apelido (opcional)" hint="Só para você reconhecer na lista.">
          <Input value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="Ex: perfil de motos" />
        </Field>
      </div>

      <Field
        className="mt"
        label={<><FileText size={12} /> Legenda padrão desta conta</>}
        hint="Último recurso: usada só quando o vídeo não tem legenda própria nem recebeu uma da biblioteca. Repetir a mesma legenda em todo post é o padrão mais fácil de identificar."
      >
        <Textarea
          rows={3}
          value={form.fallbackCaption}
          onChange={(e) => set('fallbackCaption', e.target.value)}
          placeholder="Deixe vazio para publicar sem legenda quando não houver outra."
        />
      </Field>

      <div className="grid grid--3 mt">
        <Field label={<><Timer size={12} /> Ritmo de publicação</>}>
          <Select value={form.scheduleMode} onChange={(e) => set('scheduleMode', e.target.value)}>
            <option value="TIMES">Horários fixos</option>
            <option value="INTERVAL">A cada X tempo</option>
          </Select>
        </Field>

        {form.scheduleMode === 'INTERVAL' && (
          <>
            <Field label="Publicar a cada">
              <Input
                type="number" min={1} max={maximo} value={ritmo.valor}
                onChange={(e) => setRitmo((r) => ({ ...r, valor: Math.min(maximo, Math.max(1, Number(e.target.value) || 1)) }))}
              />
            </Field>
            <Field label="Unidade">
              <Select
                value={ritmo.unidade}
                onChange={(e) => {
                  const unidade = e.target.value;
                  // Ao trocar de unidade, mantém o valor dentro do novo limite
                  // em vez de deixar "300 horas" virar um intervalo impossível.
                  setRitmo((r) => ({ unidade, valor: Math.min(unidade === 'h' ? 24 : 1440, r.valor) }));
                }}
              >
                <option value="min">minutos</option>
                <option value="h">horas</option>
              </Select>
            </Field>
          </>
        )}
      </div>

      {form.scheduleMode === 'INTERVAL' && (
        <p className="faint mt">
          A fila inteira é distribuída a partir de agora, um vídeo a cada{' '}
          <b>{ritmo.valor} {ritmo.unidade === 'h' ? (ritmo.valor === 1 ? 'hora' : 'horas') : 'minutos'}</b>.
          Nesse modo os horários fixos ficam salvos mas não são usados.
        </p>
      )}

      <Checkbox
        className="mt"
        label={<><Shuffle size={12} /> Ordem aleatória</>}
        hint="Sorteia o próximo vídeo em vez de seguir a ordem da fila."
        checked={form.randomOrder}
        onChange={(e) => set('randomOrder', e.target.checked)}
      />
    </Card>
  );
}
