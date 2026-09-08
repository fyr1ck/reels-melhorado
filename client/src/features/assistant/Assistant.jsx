import { useState } from 'react';
import {
  Bot, Power, Key, Bug, Sparkles, Check, Undo2, EyeOff, Eye, Trash2,
  AlertTriangle, FileCode, History, ShieldCheck,
} from 'lucide-react';
import { useQuery, useMutation } from '../../hooks/useQuery.js';
import { useToast } from '../../hooks/useToast.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { api } from '../../lib/api.js';
import {
  Card, Button, Badge, Field, Input, Select, Checkbox, Empty, Skeleton, Banner, Metric,
} from '../../design/ui.jsx';
import { dateTime } from '../../lib/format.js';
import './assistant.css';

/**
 * Assistente de código.
 *
 * Captura os erros que acontecem de verdade rodando o painel, manda para a API
 * do Claude com o trecho de código relevante e recebe a correção. Aplicar é um
 * passo separado, com backup e desfazer — escrever no código de um app em
 * execução é a operação mais perigosa daqui.
 */

const TOM = { ABERTO: 'danger', ANALISADO: 'brand', RESOLVIDO: 'ok', IGNORADO: 'muted' };
const ORIGEM = {
  SERVIDOR: 'servidor', ROTA: 'API', PAINEL: 'navegador',
  PUBLICACAO: 'publicação', EDITOR: 'editor',
};

export default function Assistant() {
  const toast = useToast();
  const confirm = useConfirm();
  const [chave, setChave] = useState('');
  const [mostrandoPrompt, setMostrandoPrompt] = useState(null);
  const [expandido, setExpandido] = useState(null);

  const { data: estado, loading, reload } = useQuery('/assistant');
  const { data: erros, reload: reloadErros } = useQuery('/assistant/errors', { refetchMs: 20000 });
  const { data: historico, reload: reloadHistorico } = useQuery('/assistant/history');

  const salvar = useMutation(async (patch) => {
    await api.patch('/assistant', patch);
    await reload({ quiet: true });
  });

  const analisar = useMutation(async (id) => {
    await api.post(`/assistant/errors/${id}/analyze`);
    await reloadErros({ quiet: true });
    setExpandido(id);
    toast.success('Análise pronta.');
  });

  async function aplicar(erro) {
    const arquivos = [...new Set(erro.analise.correcoes.map((c) => c.arquivo))];
    const ok = await confirm({
      title: 'Aplicar a correção no código?',
      description:
        `Vai alterar: ${arquivos.join(', ')}. O arquivo original é copiado antes, e dá para `
        + 'desfazer com um clique no histórico abaixo. O servidor reinicia sozinho depois da mudança.',
      confirmLabel: 'Aplicar',
      danger: true,
    });
    if (!ok) return;

    try {
      const r = await api.post(`/assistant/errors/${erro.id}/apply`);
      await Promise.all([reloadErros({ quiet: true }), reloadHistorico({ quiet: true })]);
      toast.success(`Aplicado em ${r.arquivos.join(', ')}.`);
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function desfazer(item) {
    const ok = await confirm({
      title: `Desfazer a mudança em ${item.arquivo}?`,
      description: 'O arquivo volta exatamente ao conteúdo anterior à correção. '
        + 'Se você editou esse arquivo depois, essas edições se perdem.',
      confirmLabel: 'Desfazer',
      danger: true,
    });
    if (!ok) return;

    try {
      await api.post(`/assistant/history/${item.id}/undo`);
      await Promise.all([reloadHistorico({ quiet: true }), reloadErros({ quiet: true })]);
      toast.success('Arquivo restaurado.');
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function verPrompt(id) {
    try {
      const r = await api.get(`/assistant/errors/${id}/prompt`);
      setMostrandoPrompt(r.prompt);
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (loading && !estado) return <Skeleton height={340} />;

  const abertos = (erros ?? []).filter((e) => e.estado === 'ABERTO');
  const analisados = (erros ?? []).filter((e) => e.estado === 'ANALISADO');
  const visiveis = (erros ?? []).filter((e) => e.estado !== 'IGNORADO');

  return (
    <>
      <div className="page-head">
        <h2>Assistente de código</h2>
        <p>
          Quando algo quebra rodando o painel, o erro é capturado com o trecho de código que o
          causou. Você manda para o Claude e recebe a correção — para revisar antes de aplicar.
        </p>
      </div>

      {/* Liga/desliga e chave. Vem primeiro porque nada abaixo funciona sem. */}
      <Card
        title="Ligar o assistente"
        icon={Bot}
        tone={estado?.habilitado ? undefined : 'muted'}
        action={
          <Badge tone={estado?.habilitado ? 'ok' : 'muted'}>
            {estado?.habilitado ? 'ligado' : 'desligado'}
          </Badge>
        }
      >
        <Checkbox
          label={<><Power size={12} /> Capturar erros e permitir análise</>}
          hint="Desligado, nada é guardado e nenhuma requisição sai desta máquina."
          checked={estado?.ligadoNoPainel ?? false}
          onChange={(e) => salvar.run({ enabled: e.target.checked })
            .then(() => toast.success(e.target.checked ? 'Assistente ligado.' : 'Assistente desligado.'))
            .catch((err) => toast.error(err.message))}
        />

        {estado?.ligadoNoPainel && !estado?.temChave && (
          <div className="mt">
            <Banner tone="warn" icon={AlertTriangle}>
              Ligado, mas <b>sem chave da API</b> — os erros são capturados e a análise não roda.
              Cole a chave abaixo.
            </Banner>
          </div>
        )}

        <div className="grid grid--2 mt">
          <Field
            label={<><Key size={12} /> Chave da API da Anthropic</>}
            hint={estado?.chaveDoAmbiente
              ? 'Já vem de ANTHROPIC_API_KEY no .env — é o lugar preferível, e o que estiver aqui é ignorado.'
              : 'console.anthropic.com → API Keys. Fica só nesta máquina e nunca sai no backup.'}
          >
            <Input
              type="password"
              disabled={estado?.chaveDoAmbiente}
              placeholder={estado?.temChave ? '•••••••••••••••• (salva)' : 'sk-ant-...'}
              value={chave}
              onChange={(e) => setChave(e.target.value)}
              onBlur={() => chave && salvar.run({ apiKey: chave })
                .then(() => { setChave(''); toast.success('Chave salva.'); })
                .catch((err) => toast.error(err.message))}
            />
          </Field>

          <Field label="Modelo" hint={estado?.modelos?.find((m) => m.id === estado.modelo)?.hint}>
            <Select
              value={estado?.modelo ?? 'claude-sonnet-5'}
              onChange={(e) => salvar.run({ model: e.target.value })
                .then(() => toast.success('Modelo trocado.'))
                .catch((err) => toast.error(err.message))}
            >
              {(estado?.modelos ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.nome}</option>
              ))}
            </Select>
          </Field>
        </div>

        <Checkbox
          className="mt"
          label={<><Sparkles size={12} /> Corrigir sozinho, sem me perguntar</>}
          hint="Só age quando o Claude diz que é defeito de código E tem confiança alta E o trecho ainda bate com o arquivo. Mesmo assim: cada mudança faz backup e aparece no histórico com botão de desfazer."
          checked={estado?.aplicarAutomatico ?? false}
          disabled={!estado?.habilitado}
          onChange={(e) => salvar.run({ autoApply: e.target.checked })
            .then(() => toast.success(e.target.checked
              ? 'Modo automático ligado. Acompanhe o histórico.'
              : 'Modo automático desligado.'))
            .catch((err) => toast.error(err.message))}
        />

        <div className="mt">
          <Banner tone="brand" icon={ShieldCheck}>
            O que sai daqui: a mensagem de erro, o stack e o trecho dos arquivos citados nele.
            <b> Nunca</b> o <code>.env</code>, o banco, nem as sessões do Instagram — e você pode
            conferir o pacote exato em "Ver o que seria enviado", antes de qualquer chamada.
          </Banner>
        </div>
      </Card>

      <div className="grid grid--3 mt">
        <Metric icon={Bug} label="Erros abertos" value={abertos.length}
          tone={abertos.length ? 'danger' : 'ok'} hint="ainda sem análise" />
        <Metric icon={Sparkles} label="Analisados" value={analisados.length} hint="com correção proposta" />
        <Metric icon={History} label="Correções aplicadas" value={(historico ?? []).filter((h) => !h.desfeitoEm).length} />
      </div>

      <Card
        className="mt"
        title={`Erros capturados (${visiveis.length})`}
        icon={Bug}
        action={visiveis.length > 0 && (
          <Button
            size="sm" variant="ghost" icon={Trash2}
            onClick={async () => {
              await api.del('/assistant/errors');
              await reloadErros({ quiet: true });
              toast.success('Lista limpa.');
            }}
          >
            Limpar
          </Button>
        )}
      >
        {!visiveis.length ? (
          <Empty icon={Check} title="Nenhum erro capturado">
            {estado?.ligadoNoPainel
              ? 'Nada quebrou desde que o assistente foi ligado.'
              : 'Ligue o assistente acima para começar a capturar.'}
          </Empty>
        ) : (
          <div className="stack">
            {visiveis.map((e) => (
              <div key={e.id} className={`erro erro--${e.estado}`}>
                <div className="erro__topo">
                  <Badge tone={TOM[e.estado]}>{e.estado.toLowerCase()}</Badge>
                  <span className="faint">{ORIGEM[e.origem] ?? e.origem}</span>
                  {e.vezes > 1 && <Badge tone="warn">{e.vezes}x</Badge>}
                  <span className="faint">{dateTime(e.ultimaEm)}</span>
                  <span style={{ flex: 1 }} />
                  <Button
                    size="sm" variant="ghost" icon={expandido === e.id ? EyeOff : Eye}
                    onClick={() => setExpandido(expandido === e.id ? null : e.id)}
                    title="Ver stack e análise"
                  />
                  <Button
                    size="sm" variant="ghost" icon={FileCode}
                    onClick={() => verPrompt(e.id)}
                    title="Ver o que seria enviado ao Claude"
                  />
                </div>

                <p className="erro__msg">{e.mensagem}</p>

                {expandido === e.id && (
                  <pre className="erro__stack">{e.stack || '(sem stack)'}</pre>
                )}

                {e.analise && (
                  <div className="analise">
                    <div className="analise__cab">
                      <Sparkles size={13} />
                      <b>{e.analise.causa}</b>
                      <Badge tone={
                        e.analise.confianca === 'alta' ? 'ok'
                          : e.analise.confianca === 'media' ? 'warn' : 'muted'
                      }>
                        confiança {e.analise.confianca}
                      </Badge>
                      {!e.analise.ehBugDeCodigo && <Badge tone="muted">não é código</Badge>}
                    </div>

                    <p className="dim">{e.analise.explicacao}</p>

                    {!e.analise.ehBugDeCodigo && e.analise.seNaoForCodigo && (
                      <div className="mt">
                        <Banner tone="warn" icon={AlertTriangle}>{e.analise.seNaoForCodigo}</Banner>
                      </div>
                    )}

                    {e.analise.correcoes?.map((c, i) => (
                      <div key={i} className="correcao">
                        <div className="correcao__cab">
                          <FileCode size={12} />
                          <code>{c.arquivo}</code>
                          {!c.aplicavel && <Badge tone="danger">não aplicável</Badge>}
                        </div>
                        {c.porque && <p className="faint">{c.porque}</p>}
                        {!c.aplicavel && <p className="faint">{c.motivo}</p>}
                        <div className="diff">
                          <pre className="diff__antes">{c.trechoAntigo}</pre>
                          <pre className="diff__depois">{c.trechoNovo}</pre>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="row mt">
                  {e.estado !== 'RESOLVIDO' && (
                    <Button
                      size="sm" variant="primary" icon={Sparkles}
                      disabled={!estado?.habilitado}
                      loading={analisar.busy}
                      title={!estado?.habilitado ? 'Ligue o assistente e configure a chave.' : undefined}
                      onClick={() => analisar.run(e.id).catch((err) => toast.error(err.message))}
                    >
                      {e.analise ? 'Analisar de novo' : 'Analisar com o Claude'}
                    </Button>
                  )}

                  {e.analise?.correcoes?.length > 0 && e.estado !== 'RESOLVIDO' && (
                    <Button
                      size="sm" icon={Check}
                      disabled={e.analise.correcoes.some((c) => !c.aplicavel)}
                      title={e.analise.correcoes.some((c) => !c.aplicavel)
                        ? 'Alguma correção não bate mais com o arquivo. Analise de novo.'
                        : undefined}
                      onClick={() => aplicar(e)}
                    >
                      Aplicar no código
                    </Button>
                  )}

                  <span style={{ flex: 1 }} />
                  <Button
                    size="sm" variant="ghost"
                    onClick={async () => {
                      await api.post(`/assistant/errors/${e.id}/ignore`);
                      await reloadErros({ quiet: true });
                    }}
                  >
                    Ignorar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {historico?.length > 0 && (
        <Card className="mt" title="Correções aplicadas" icon={History}>
          <div className="stack">
            {historico.map((h) => (
              <div key={h.id} className="hist">
                <div className="hist__info">
                  <code>{h.arquivo}</code>
                  <span className="faint">{h.porque ?? h.causa ?? '—'}</span>
                  <span className="faint">
                    {dateTime(h.aplicadoEm)} · {h.linhasAntes} → {h.linhasDepois} linha(s)
                  </span>
                </div>
                {h.desfeitoEm
                  ? <Badge tone="muted">desfeita</Badge>
                  : <Button size="sm" variant="danger" icon={Undo2} onClick={() => desfazer(h)}>Desfazer</Button>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {mostrandoPrompt !== null && (
        <Card className="mt" title="O que seria enviado ao Claude" icon={FileCode}
          action={<Button size="sm" variant="ghost" onClick={() => setMostrandoPrompt(null)}>Fechar</Button>}>
          <pre className="erro__stack">{mostrandoPrompt}</pre>
        </Card>
      )}
    </>
  );
}
