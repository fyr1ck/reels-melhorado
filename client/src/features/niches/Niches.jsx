import { useState } from 'react';
import {
  Plus, Copy, Trash2, Power, Target, FlaskConical, Pencil, X, Users,
} from 'lucide-react';
import { useQuery, useMutation } from '../../hooks/useQuery.js';
import { useToast } from '../../hooks/useToast.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { api } from '../../lib/api.js';
import {
  Card, Button, Badge, Input, Textarea, Field, Select, Checkbox, Empty, Banner, Tabs, Skeleton,
} from '../../design/ui.jsx';
import Review from './Review.jsx';
import './niches.css';

/**
 * Cadastro de nichos e vínculo com as contas que já existem.
 *
 * Tela NOVA. Não substitui nem altera Contas, Fila ou Configurações — o
 * vínculo conta↔nicho é editado aqui porque é aqui que os nichos existem, e
 * uma conta sem nicho continua funcionando como sempre funcionou.
 */

const VAZIO = {
  name: '', description: '', category: '',
  subniches: '', keywords: '', bannedKeywords: '',
  allowedThemes: '', bannedThemes: '', customRules: '',
  audience: '', tone: '', priority: 0, strictness: 'MEDIO', active: true,
};

const RIGOR = [
  { v: 'BAIXO', t: 'Baixo — palavra proibida só desconta um pouco' },
  { v: 'MEDIO', t: 'Médio — palavra proibida derruba bastante' },
  { v: 'ALTO', t: 'Alto — uma violação já zera a compatibilidade' },
];

export default function Niches() {
  const [aba, setAba] = useState('nichos');

  return (
    <>
      <div className="page-head">
        <p className="page-desc">
          Impede que o conteúdo de um nicho seja publicado numa conta de outro. Enquanto a
          separação estiver desligada em Configurações, nada aqui interfere na fila.
        </p>
      </div>

      <Tabs
        value={aba}
        onChange={setAba}
        items={[
          { value: 'nichos', label: 'Nichos' },
          { value: 'contas', label: 'Contas' },
          { value: 'revisao', label: 'Revisão' },
        ]}
      />

      {aba === 'nichos' && <ListaDeNichos />}
      {aba === 'contas' && <VinculoDeContas />}
      {aba === 'revisao' && <Review />}
    </>
  );
}

// ------------------------------------------------------------------ nichos

function ListaDeNichos() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data: nichos, loading, reload } = useQuery('/niches');

  const [editando, setEditando] = useState(null);

  const salvar = useMutation(async (form) => {
    if (form.id) await api.patch(`/niches/${form.id}`, form);
    else await api.post('/niches', form);
    setEditando(null);
    await reload({ quiet: true });
    toast.success(form.id ? 'Nicho atualizado.' : `Nicho "${form.name}" criado.`);
  });

  const alternar = useMutation(async (n) => {
    await api.patch(`/niches/${n.id}`, { active: !n.active });
    await reload({ quiet: true });
  });

  const duplicar = useMutation(async (n) => {
    const copia = await api.post(`/niches/${n.id}/duplicate`);
    await reload({ quiet: true });
    toast.success(`"${copia.name}" criado, desativado — ajuste e ative.`);
  });

  async function excluir(n) {
    const ok = await confirm({
      title: `Excluir "${n.name}"`,
      description:
        'Os vídeos já classificados neste nicho continuam na fila e ficam sem nicho. '
        + 'As contas vinculadas a ele perdem o vínculo. Nenhum vídeo é apagado.',
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    await api.delete(`/niches/${n.id}`);
    await reload({ quiet: true });
    toast.success('Nicho excluído.');
  }

  if (loading) return <Skeleton height={280} />;

  return (
    <>
      <div className="niches-toolbar">
        <Button icon={Plus} onClick={() => setEditando({ ...VAZIO })}>Adicionar nicho</Button>
        <Testador />
      </div>

      {editando && (
        <Editor
          valor={editando}
          onCancelar={() => setEditando(null)}
          onSalvar={(f) => salvar.run(f)}
          salvando={salvar.loading}
        />
      )}

      {!nichos?.length && !editando && (
        <Empty
          icon={Target}
          title="Nenhum nicho cadastrado"
          action={<Button icon={Plus} onClick={() => setEditando({ ...VAZIO })}>Criar o primeiro</Button>}
        >
          Um nicho é um assunto que você publica — "Emagrecimento", "Cortes de Podcast",
          "Investimentos". Você define o nome, as palavras que o identificam e as regras;
          nada aqui vem pronto.
        </Empty>
      )}

      <div className="niches-grid">
        {(nichos ?? []).map((n) => (
          <Card key={n.id} className={n.active ? '' : 'niche--off'}>
            <div className="niche-head">
              <div>
                <h4>{n.name}</h4>
                {n.category && <span className="niche-cat">{n.category}</span>}
              </div>
              <Badge tone={n.active ? 'ok' : 'muted'}>{n.active ? 'ativo' : 'inativo'}</Badge>
            </div>

            {n.description && <p className="niche-desc">{n.description}</p>}

            <div className="niche-tags">
              {resumo(n.keywords, 'palavras-chave')}
              {resumo(n.subniches, 'subnichos')}
              {resumo(n.bannedKeywords, 'proibidas', 'danger')}
              {resumo(n.customRules, 'regras', 'warn', true)}
            </div>

            <div className="niche-meta">
              <span>rigor: <strong>{n.strictness.toLowerCase()}</strong></span>
              <span>prioridade: <strong>{n.priority}</strong></span>
              {!!n.accounts?.length && (
                <span><Users size={12} /> {n.accounts.map((a) => `@${a.account.username}`).join(', ')}</span>
              )}
            </div>

            <div className="niche-actions">
              <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditando(paraForm(n))}>Editar</Button>
              <Button size="sm" variant="ghost" icon={Power} onClick={() => alternar.run(n)}>
                {n.active ? 'Desativar' : 'Ativar'}
              </Button>
              <Button size="sm" variant="ghost" icon={Copy} onClick={() => duplicar.run(n)}>Duplicar</Button>
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => excluir(n)}>Excluir</Button>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

function resumo(texto, rotulo, tone = 'muted', porLinha = false) {
  const itens = String(texto ?? '')
    .split(porLinha ? /\n+/ : /[\n,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!itens.length) return null;
  return <Badge tone={tone}>{itens.length} {rotulo}</Badge>;
}

function paraForm(n) {
  const { accounts, _count, createdAt, updatedAt, ...resto } = n;
  return resto;
}

function Editor({ valor, onCancelar, onSalvar, salvando }) {
  const [form, setForm] = useState(valor);
  const set = (k) => (e) => setForm((f) => ({
    ...f,
    [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
  }));

  return (
    <Card
      title={form.id ? `Editar "${valor.name}"` : 'Novo nicho'}
      icon={Target}
      action={<Button size="sm" variant="ghost" icon={X} onClick={onCancelar}>Cancelar</Button>}
      className="niche-editor"
    >
      <div className="niche-form">
        <Field label="Nome" hint="Como você chama esse assunto.">
          <Input value={form.name} onChange={set('name')} placeholder="Emagrecimento" />
        </Field>
        <Field label="Categoria" hint="Opcional. Agrupa nichos parecidos.">
          <Input value={form.category ?? ''} onChange={set('category')} placeholder="Saúde" />
        </Field>

        <Field label="Descrição" className="span-2">
          <Input value={form.description ?? ''} onChange={set('description')} placeholder="Conteúdo sobre perda de peso e alimentação" />
        </Field>

        <Field label="Subnichos" hint="Separe por vírgula ou linha." className="span-2">
          <Textarea rows={2} value={form.subniches} onChange={set('subniches')} placeholder="dieta, jejum intermitente, low carb" />
        </Field>

        <Field
          label="Palavras-chave"
          hint="O sinal mais forte. Expressões de duas palavras valem o dobro — são mais específicas."
          className="span-2"
        >
          <Textarea rows={3} value={form.keywords} onChange={set('keywords')} placeholder="emagrecer, perder peso, gordura abdominal, dieta, calorias" />
        </Field>

        <Field label="Palavras-chave proibidas" hint="Derrubam a compatibilidade." className="span-2">
          <Textarea rows={2} value={form.bannedKeywords} onChange={set('bannedKeywords')} placeholder="remédio milagroso, emagreça em 3 dias" />
        </Field>

        <Field label="Temas permitidos">
          <Textarea rows={2} value={form.allowedThemes} onChange={set('allowedThemes')} placeholder="alimentação, exercício" />
        </Field>
        <Field label="Temas proibidos">
          <Textarea rows={2} value={form.bannedThemes} onChange={set('bannedThemes')} placeholder="cirurgia, medicamento" />
        </Field>

        <Field
          label="Regras personalizadas"
          hint="Uma por linha, em português. São levadas à IA e valem mais que a opinião dela."
          className="span-2"
        >
          <Textarea rows={3} value={form.customRules} onChange={set('customRules')} placeholder={'Não aceitar promessas de perda de peso rápida.\nNão citar medicamento pelo nome.'} />
        </Field>

        <Field label="Público-alvo">
          <Input value={form.audience ?? ''} onChange={set('audience')} placeholder="Mulheres de 25 a 45 anos" />
        </Field>
        <Field label="Tom de comunicação">
          <Input value={form.tone ?? ''} onChange={set('tone')} placeholder="Direto, acolhedor, sem promessas" />
        </Field>

        <Field label="Nível de rigor" hint="O quanto uma violação pesa.">
          <Select value={form.strictness} onChange={set('strictness')}>
            {RIGOR.map((r) => <option key={r.v} value={r.v}>{r.t}</option>)}
          </Select>
        </Field>
        <Field label="Prioridade" hint="Desempata quando dois nichos pontuam igual.">
          <Input type="number" min={0} max={100} value={form.priority} onChange={set('priority')} />
        </Field>

        <div className="span-2">
          <Checkbox label="Ativo" checked={form.active} onChange={set('active')} hint="Nicho inativo não participa da classificação." />
        </div>
      </div>

      <div className="niche-form-actions">
        <Button onClick={() => onSalvar(form)} loading={salvando} disabled={!form.name.trim()}>
          {form.id ? 'Salvar' : 'Criar nicho'}
        </Button>
      </div>
    </Card>
  );
}

/**
 * Experimentar um texto sem gravar nada.
 *
 * Existe para calibrar o cadastro ANTES de deixar o sistema decidir sozinho:
 * cola-se o nome de um arquivo real e vê-se a nota e o motivo na hora, em vez
 * de descobrir o erro pela fila bloqueada.
 */
function Testador() {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState('');
  const [r, setR] = useState(null);

  const testar = useMutation(async () => {
    setR(await api.post('/niches/testar', { texto }));
  });

  if (!aberto) {
    return <Button variant="ghost" icon={FlaskConical} onClick={() => setAberto(true)}>Testar um texto</Button>;
  }

  return (
    <Card
      title="Testar classificação"
      icon={FlaskConical}
      action={<Button size="sm" variant="ghost" icon={X} onClick={() => setAberto(false)}>Fechar</Button>}
      className="niche-tester"
    >
      <Field label="Nome do arquivo ou legenda" hint="Nada é gravado. É só para conferir o cadastro.">
        <Input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && texto.trim() && testar.run()}
          placeholder="5 alimentos que ajudam a emagrecer.mp4"
        />
      </Field>
      <Button size="sm" onClick={() => testar.run()} loading={testar.loading} disabled={!texto.trim()}>Testar</Button>

      {r && (
        <div className="tester-out">
          <p className="tester-limiares">
            Aprovado a partir de {r.limiares.approve}% · revisão a partir de {r.limiares.review}%
          </p>
          {!r.ranking.length && <p className="muted">Nenhum nicho ativo cadastrado.</p>}
          {r.ranking.map((x) => (
            <div key={x.nicheId} className="tester-linha">
              <strong>{x.score}%</strong>
              <span>{x.name}</span>
              <em>{x.motivos.join(' · ') || 'nenhum sinal encontrado'}</em>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------- vínculo com contas

function VinculoDeContas() {
  const toast = useToast();
  const { data: contas, loading } = useQuery('/accounts');
  const { data: nichos } = useQuery('/niches', { params: { ativos: '1' } });

  if (loading) return <Skeleton height={200} />;

  return (
    <>
      <Banner tone="info">
        A conta continua sendo a mesma: login, sessão, horários e fila não mudam. O nicho só diz
        <strong> que assunto ela publica</strong> — e conta sem nicho nenhum publica tudo, como antes.
      </Banner>

      <div className="niches-grid">
        {(contas ?? []).map((c) => (
          <ContaCard key={c.id} conta={c} nichos={nichos ?? []} toast={toast} />
        ))}
      </div>
    </>
  );
}

function ContaCard({ conta, nichos, toast }) {
  const { data: atuais, reload } = useQuery(`/niches/accounts/${conta.id}`);

  const principal = atuais?.find((a) => a.isPrimary)?.nicheId ?? '';
  const secundarios = (atuais ?? []).filter((a) => !a.isPrimary).map((a) => a.nicheId);

  const salvar = useMutation(async (payload) => {
    await api.put(`/niches/accounts/${conta.id}`, payload);
    await reload({ quiet: true });
    toast.success(`Nichos de @${conta.username} atualizados.`);
  });

  return (
    <Card>
      <div className="niche-head">
        <h4>@{conta.username}</h4>
        {conta.label && <Badge tone="muted">{conta.label}</Badge>}
      </div>

      <Field label="Nicho principal" hint="Recebe as recomendações automáticas deste assunto.">
        <Select
          value={principal}
          onChange={(e) => salvar.run({ primaryNicheId: e.target.value || null, secondaryNicheIds: secundarios })}
        >
          <option value="">(nenhum — publica tudo)</option>
          {nichos.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </Select>
      </Field>

      <Field label="Nichos secundários" hint="Também são aceitos nesta conta.">
        <div className="niche-checks">
          {nichos.filter((n) => n.id !== principal).map((n) => (
            <Checkbox
              key={n.id}
              label={n.name}
              checked={secundarios.includes(n.id)}
              onChange={(e) => salvar.run({
                primaryNicheId: principal || null,
                secondaryNicheIds: e.target.checked
                  ? [...secundarios, n.id]
                  : secundarios.filter((x) => x !== n.id),
              })}
            />
          ))}
          {!nichos.length && <p className="muted">Cadastre um nicho primeiro.</p>}
        </div>
      </Field>
    </Card>
  );
}
