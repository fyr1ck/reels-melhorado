import { useEffect, useRef, useState } from 'react';
import { Save, AtSign, FileText, Shuffle, Image, Trash2, Sparkles } from 'lucide-react';
import { useMutation } from '../../hooks/useQuery.js';
import { useToast } from '../../hooks/useToast.jsx';
import { api } from '../../lib/api.js';
import { Card, Button, Input, Textarea, Field, Checkbox } from '../../design/ui.jsx';

/**
 * Edição de uma conta.
 *
 * Tudo que é POR CONTA mora aqui: o @, a legenda de último recurso, a capa
 * padrão do perfil e a ordem da fila. Antes só dava para trocar o apelido — a
 * conta padrão nascia como "conta-principal" e ficava assim para sempre, sem
 * relação com o perfil real do Instagram.
 */

export default function AccountEditor({ account, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const capaRef = useRef(null);

  useEffect(() => {
    if (!account) return;
    setForm({
      username: account.username,
      label: account.label ?? '',
      fallbackCaption: account.fallbackCaption ?? '',
      randomOrder: account.randomOrder,
      aiLabel: account.aiLabel ?? false,
    });
  }, [account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const salvar = useMutation(async () => {
    await api.patch(`/accounts/${account.id}`, form);
    await onSaved?.();
    toast.success('Conta atualizada.');
  });

  async function enviarCapa(file) {
    const fd = new FormData();
    fd.append('cover', file);
    try {
      await api.post(`/accounts/${account.id}/cover`, fd);
      await onSaved?.();
      toast.success(`Capa padrão de @${account.username} definida.`);
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (!form) return null;

  const set = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));

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
        hint="Usada quando o vídeo não tem legenda própria nem recebeu uma da biblioteca. Vazio aqui cai na legenda geral, em Configurações."
      >
        <Textarea
          rows={3}
          value={form.fallbackCaption}
          onChange={(e) => set('fallbackCaption', e.target.value)}
          placeholder="Deixe vazio para usar a legenda geral da instalação."
        />
      </Field>

      {/* Logo abaixo da legenda porque é a ordem em que o Instagram mostra:
          na tela de publicação, o interruptor fica embaixo do campo de texto. */}
      <Checkbox
        className="mt"
        label={<><Sparkles size={12} /> Marcar como conteúdo feito com IA</>}
        hint="Liga o “Adicionar rótulo de IA” do Instagram em tudo que esta conta publicar. O Instagram exige o rótulo em foto e vídeo realistas gerados por IA, e quem vê o post enxerga a marcação."
        checked={form.aiLabel}
        onChange={(e) => set('aiLabel', e.target.checked)}
      />

      {/* Capa por conta: cada perfil costuma ter identidade visual própria, e
          uma capa única para a instalação inteira só serve com uma conta. */}
      <input
        ref={capaRef} type="file" accept="image/jpeg,image/png,image/webp" hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) enviarCapa(f);
        }}
      />

      <div className="acc-cover mt">
        <div className="acc-cover__thumb">
          {account.defaultCoverPath
            ? <img src={`/api/covers/${account.defaultCoverPath}`} alt={`Capa de @${account.username}`} />
            : <Image size={16} />}
        </div>
        <div className="acc-cover__text">
          <b>Capa padrão de @{account.username}</b>
          <span className="faint">
            {account.defaultCoverPath
              ? 'Entra em todo vídeo novo desta conta que não trouxer capa própria. Perde só para a capa individual do vídeo.'
              : 'Nenhuma definida — esta conta cai na capa geral da instalação, se houver.'}
          </span>
        </div>
        <Checkbox
          label="Usar"
          checked={account.useDefaultCover}
          disabled={!account.defaultCoverPath}
          title={!account.defaultCoverPath ? 'Escolha uma imagem primeiro.' : undefined}
          onChange={async (e) => {
            await api.patch(`/accounts/${account.id}`, { useDefaultCover: e.target.checked });
            await onSaved?.();
          }}
        />
        <div className="row">
          <Button size="sm" icon={Image} onClick={() => capaRef.current?.click()}>
            {account.defaultCoverPath ? 'Trocar' : 'Escolher'}
          </Button>
          {account.defaultCoverPath && (
            <Button
              size="sm" variant="danger" icon={Trash2}
              title="Remover a capa desta conta"
              onClick={async () => {
                await api.del(`/accounts/${account.id}/cover`);
                await onSaved?.();
                toast.success('Capa da conta removida.');
              }}
            />
          )}
        </div>
      </div>

      <p className="faint mt">
        O <b>ritmo de publicação</b> (horários fixos ou a cada X tempo) fica em{' '}
        <b>Horários</b> — a tela onde a grade desta conta é montada.
      </p>

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
