import { Monitor, Save, ExternalLink, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation } from '../../hooks/useQuery.js';
import { useToast } from '../../hooks/useToast.jsx';
import { api } from '../../lib/api.js';
import { Card, Button, Checkbox, Skeleton, Banner } from '../../design/ui.jsx';
import './settings.css';

/**
 * Só o que é preferência da instalação inteira. Legenda, ritmo e automação
 * são POR CONTA e moram em Contas — um balcão único de configurações deixou
 * de fazer sentido quando o app virou multi-conta.
 */
const ATALHOS = [
  { to: '/biblioteca', label: 'Legendas e hashtags', where: 'Biblioteca' },
  { to: '/contas', label: 'Legenda padrão, ritmo e automação por conta', where: 'Contas' },
  { to: '/horarios', label: 'Horários e variação aleatória', where: 'Horários' },
  { to: '/armazenamento', label: 'Espaço em disco', where: 'Armazenamento' },
];

export default function Settings() {
  const { data, loading, reload } = useQuery('/settings');
  const toast = useToast();

  const salvar = useMutation(async (patch) => {
    await api.patch('/settings', patch);
    await reload({ quiet: true });
    toast.success('Configuração salva.');
  });

  if (loading && !data) return <Skeleton height={160} />;

  return (
    <>
      <div className="page-head">
        <h2>Configurações</h2>
        <p>Preferências que valem para a instalação inteira.</p>
      </div>

      <Card title="Navegador" icon={Monitor}>
        <Checkbox
          label="Manter a janela do navegador aberta entre publicações"
          hint="Reaproveitar a janela deixa as publicações seguintes mais rápidas, mas mantém o Chromium consumindo memória entre elas."
          checked={data?.keepBrowserOpen ?? false}
          disabled={salvar.busy}
          onChange={(e) => salvar.run({ keepBrowserOpen: e.target.checked })}
        />
        <Banner tone="brand" icon={Info} className="mt">
          A <b>visibilidade</b> da janela é separada disso e fica em <code>HEADLESS</code>, no
          arquivo <code>.env</code>. Vale manter visível: é assim que você resolve um CAPTCHA ou
          2FA quando o Instagram pedir.
        </Banner>
      </Card>

      <Card title="Limpeza de cache" icon={Monitor} className="mt">
        <Checkbox
          label="Limpar arquivos temporários automaticamente"
          checked={data?.autoCleanCache ?? false}
          disabled={salvar.busy}
          onChange={(e) => salvar.run({ autoCleanCache: e.target.checked })}
        />
      </Card>

      <Card title="Onde ficam os outros ajustes" icon={Info} className="mt">
        <p className="faint" style={{ marginBottom: 12 }}>
          Cada ajuste mora na tela onde é usado, em vez de num balcão único distante do efeito
          que produz.
        </p>
        <div className="set-links">
          {ATALHOS.map((a) => (
            <Link key={a.to} to={a.to} className="set-link">
              <b>{a.label}</b>
              <span className="faint">{a.where}</span>
              <ExternalLink size={13} />
            </Link>
          ))}
        </div>
      </Card>
    </>
  );
}
