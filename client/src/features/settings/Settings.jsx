import { Monitor, Save, ExternalLink, Info, FileText, Copy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation } from '../../hooks/useQuery.js';
import { useToast } from '../../hooks/useToast.jsx';
import { api } from '../../lib/api.js';
import { useEffect, useState } from 'react';
import { Card, Button, Checkbox, Skeleton, Banner, Textarea, Field } from '../../design/ui.jsx';
import './settings.css';

/**
 * Só o que é preferência da instalação inteira. Legenda, ritmo e automação
 * são POR CONTA e moram em Contas — um balcão único de configurações deixou
 * de fazer sentido quando o app virou multi-conta.
 */
const ATALHOS = [
  { to: '/biblioteca', label: 'Legendas e hashtags', where: 'Biblioteca' },
  { to: '/contas', label: 'Legenda e capa padrão de cada conta', where: 'Contas' },
  { to: '/horarios', label: 'Horários e variação aleatória', where: 'Horários' },
  { to: '/conteudo-repetido', label: 'Conteúdo repetido entre contas', where: 'Conteúdo repetido' },
  { to: '/armazenamento', label: 'Espaço em disco', where: 'Armazenamento' },
];

export default function Settings() {
  const { data, loading, reload } = useQuery('/settings');
  const toast = useToast();
  const [legenda, setLegenda] = useState('');

  // Só sincroniza quando o servidor responde: sobrescrever a cada polling
  // apagaria o que está sendo digitado.
  useEffect(() => {
    if (data) setLegenda(data.defaultCaption ?? '');
  }, [data?.defaultCaption]); // eslint-disable-line react-hooks/exhaustive-deps

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

      <Card
        title="Legenda padrão de todos os vídeos"
        icon={FileText}
        className="mt"
        action={
          <Button
            variant="primary" icon={Save} loading={salvar.busy}
            onClick={() => salvar.run({ defaultCaption: legenda })}
          >
            Salvar
          </Button>
        }
      >
        <Field hint="Último recurso da instalação inteira. A ordem é: legenda do vídeo > legenda da conta > esta. Se todo post sair com o mesmo texto, o padrão fica evidente — o rodízio da Biblioteca existe para variar.">
          <Textarea
            rows={3}
            value={legenda}
            onChange={(e) => setLegenda(e.target.value)}
            placeholder="Ex: Siga para mais 🔥"
          />
        </Field>
      </Card>

      <Card title="Conteúdo repetido entre contas" icon={Copy} className="mt">
        <Checkbox
          label="Recusar vídeo que já está na fila de outra conta"
          hint="Vale para o upload e para as pastas monitoradas. Duas contas publicando o mesmo vídeo é o padrão mais visível de automação — e o segundo post não ganha alcance nenhum."
          checked={data?.blockDuplicateContent ?? true}
          disabled={salvar.busy}
          onChange={(e) => salvar.run({ blockDuplicateContent: e.target.checked })}
        />
        <p className="faint mt">
          A tela <Link to="/conteudo-repetido">Conteúdo repetido</Link> mostra o que já entrou
          duplicado e resolve mantendo uma cópia só.
        </p>
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
