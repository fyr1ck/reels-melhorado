import { HardDrive, RefreshCw } from 'lucide-react';
import { useQuery } from '../../hooks/useQuery.js';
import { Card, Button, Metric, Skeleton } from '../../design/ui.jsx';
import { bytes } from '../../lib/format.js';
import './storage.css';

const PASTAS = [
  { key: 'pending', label: 'Vídeos pendentes' },
  { key: 'published', label: 'Vídeos publicados' },
  { key: 'failed', label: 'Vídeos falhados' },
  { key: 'covers', label: 'Capas' },
  { key: 'editorSource', label: 'Editor — origem' },
  { key: 'editorOutput', label: 'Editor — processados' },
  { key: 'editorAssets', label: 'Editor — recursos' },
  { key: 'editorTmp', label: 'Cache temporário' },
];

export default function Storage() {
  const { data, loading, reload } = useQuery('/settings/storage');

  return (
    <>
      <div className="page-head page-head--row">
        <div>
          <h2>Armazenamento</h2>
          <p>Quanto espaço cada pasta ocupa no disco.</p>
        </div>
        <Button icon={RefreshCw} onClick={() => reload()}>Atualizar</Button>
      </div>

      {loading && !data ? (
        <Skeleton height={110} />
      ) : (
        <>
          <div className="grid grid--4">
            <Metric icon={HardDrive} label="Total em disco" value={bytes(data?.total)} hint="somando todas as pastas" />
            <Metric label="Pendentes" value={bytes(data?.folders.pending)} hint="aguardando publicação" />
            <Metric label="Publicados" value={bytes(data?.folders.published)} hint="já foram ao ar" />
            <Metric label="Cache" value={bytes(data?.folders.editorTmp)} hint="temporários do editor" />
          </div>

          <Card title="Por pasta" icon={HardDrive} className="mt">
            {PASTAS.map((p) => (
              <div key={p.key} className="dz-row">
                <div>
                  <div className="dz-row__name">{p.label}</div>
                  <div className="dz-row__size">{bytes(data?.folders[p.key])}</div>
                </div>
              </div>
            ))}
            <p className="faint mt">
              Os arquivos ficam em <code>videos/</code>, na pasta do projeto. Para liberar espaço,
              apague de lá diretamente — assim você vê o que está removendo antes de remover.
            </p>
          </Card>
        </>
      )}
    </>
  );
}
