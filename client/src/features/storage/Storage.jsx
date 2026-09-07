import { HardDrive, RefreshCw, Trash2, Bomb } from 'lucide-react';
import { useQuery, useMutation } from '../../hooks/useQuery.js';
import { useToast } from '../../hooks/useToast.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { api } from '../../lib/api.js';
import { Card, Button, Metric, Skeleton } from '../../design/ui.jsx';
import { bytes } from '../../lib/format.js';
import './storage.css';

export default function Storage() {
  const { data, loading, reload } = useQuery('/settings/storage');
  const toast = useToast();
  const confirm = useConfirm();

  const limpar = useMutation(async (key) => {
    const r = await api.post(`/settings/storage/clear/${key}`);
    await reload({ quiet: true });
    toast.success(`${r.label}: ${r.removidos} item(ns) removido(s).`);
  });

  const limparTudo = useMutation(async () => {
    const r = await api.post('/settings/storage/clear-all');
    await reload({ quiet: true });
    const erros = Object.entries(r.results).filter(([, v]) => v.erro);
    if (erros.length) toast.warn(`Algumas pastas não foram limpas: ${erros.map(([k]) => k).join(', ')}.`);
    else toast.success('Todas as pastas foram limpas.');
  });

  async function pedirConfirmacao(key, meta) {
    const ok = await confirm({
      title: `Limpar "${meta.label}"?`,
      // O aviso vem do servidor: a regra do que se perde mora junto do código
      // que apaga, não duplicada aqui.
      description: `${meta.aviso} Não há desfazer.`,
      confirmLabel: 'Limpar',
      danger: true,
    });
    if (ok) limpar.run(key).catch((e) => toast.error(e.message));
  }

  if (loading && !data) return <Skeleton height={110} />;

  const pastas = Object.entries(data?.meta ?? {});

  return (
    <>
      <div className="page-head page-head--row">
        <div>
          <h2>Armazenamento</h2>
          <p>Espaço ocupado por pasta. Toda limpeza diz exatamente o que se perde antes de agir.</p>
        </div>
        <Button icon={RefreshCw} onClick={() => reload()}>Atualizar</Button>
      </div>

      <div className="grid grid--4">
        <Metric icon={HardDrive} label="Total em disco" value={bytes(data?.total)} hint="somando todas as pastas" />
        <Metric label="Pendentes" value={bytes(data?.folders.pending)} hint="aguardando publicação" />
        <Metric label="Publicados" value={bytes(data?.folders.published)} hint="já foram ao ar" />
        <Metric label="Cache" value={bytes(data?.folders.editorTmp)} hint="temporários do editor" />
      </div>

      <Card
        title="Zona de risco"
        icon={Bomb}
        tone="danger"
        className="mt"
        action={
          <Button
            variant="danger" icon={Bomb} loading={limparTudo.busy}
            onClick={async () => {
              const ok = await confirm({
                title: 'Limpar TUDO?',
                description: 'Apaga vídeos pendentes, falhados, arquivos publicados, capas e tudo do editor. Não há desfazer.',
                confirmLabel: 'Sim, limpar tudo', danger: true,
              });
              if (ok) limparTudo.run().catch((e) => toast.error(e.message));
            }}
          >
            Limpar tudo
          </Button>
        }
      >
        {pastas.map(([key, meta]) => (
          <div key={key} className="dz-row">
            <div>
              <div className="dz-row__name">{meta.label}</div>
              <div className="dz-row__size">{bytes(data?.folders[key])}</div>
              <div className="faint">{meta.aviso}</div>
            </div>
            <Button
              size="sm" variant="danger" icon={Trash2}
              disabled={limpar.busy || !data?.folders[key]}
              onClick={() => pedirConfirmacao(key, meta)}
            >
              Limpar
            </Button>
          </div>
        ))}
      </Card>
    </>
  );
}
