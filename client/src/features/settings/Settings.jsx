import {
  Monitor, Save, ExternalLink, Info, FileText, Copy, Bell, Send,
  DatabaseBackup, Download, Upload, AlertTriangle,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation } from '../../hooks/useQuery.js';
import { useToast } from '../../hooks/useToast.jsx';
import { api } from '../../lib/api.js';
import { useEffect, useState } from 'react';
import { useRef } from 'react';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { Card, Button, Checkbox, Skeleton, Banner, Textarea, Field, Input } from '../../design/ui.jsx';
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

  const confirm = useConfirm();
  const backupRef = useRef(null);
  const [avisos, setAvisos] = useState({ telegramBotToken: '', telegramChatId: '', webhookUrl: '' });

  useEffect(() => {
    if (!data) return;
    setAvisos({
      telegramBotToken: data.telegramBotToken ?? '',
      telegramChatId: data.telegramChatId ?? '',
      webhookUrl: data.webhookUrl ?? '',
    });
  }, [data?.telegramBotToken, data?.telegramChatId, data?.webhookUrl]);

  const testarAviso = useMutation(async () => {
    const r = await api.post('/settings/notify/test');
    // O servidor devolve ok:false com o motivo — não é erro de rede, é
    // resultado do teste, e mostrar como falha de requisição confundiria.
    if (r.ok) toast.success(r.mensagem);
    else toast.error(r.mensagem);
  });

  /**
   * Baixa o backup.
   *
   * Um <a download> apontando para a rota abriria o JSON numa aba em alguns
   * navegadores; buscar e criar o blob garante o "salvar como" em todos.
   */
  const baixarBackup = useMutation(async () => {
    const r = await fetch('/api/settings/backup');
    if (!r.ok) throw new Error('Não foi possível gerar o backup.');
    const blob = await r.blob();

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reels-manager-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Backup salvo. Guarde fora deste computador.');
  });

  async function restaurar(file) {
    let backup;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      toast.error('Esse arquivo não é um backup válido.');
      return;
    }

    const resumo = backup?.resumo;
    const ok = await confirm({
      title: 'Restaurar backup',
      description: resumo
        ? `O arquivo tem ${resumo.contas} conta(s), ${resumo.videos} vídeo(s) e ${resumo.horarios} horário(s). `
          + 'Só o que ainda não existe é acrescentado — nada é apagado nem duplicado. '
          + 'As sessões do navegador não vêm no backup: reconecte cada conta depois.'
        : 'O arquivo não traz um resumo. Continuar mesmo assim?',
      confirmLabel: 'Restaurar',
    });
    if (!ok) return;

    try {
      const r = await api.post('/settings/backup/restore', { backup });
      await reload({ quiet: true });
      toast.success(`Restaurado: ${r.contas} conta(s), ${r.videos} vídeo(s), ${r.horarios} horário(s).`);
    } catch (err) {
      toast.error(err.message);
    }
  }

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

      {/* Avisos: a automação roda sozinha, mas até aqui uma falha só existia
          dentro do painel. Conta pausada às 3h da manhã ficava parada até
          alguém abrir o app por acaso. */}
      <Card
        title="Avisos no celular"
        icon={Bell}
        className="mt"
        action={
          <Button
            icon={Send} loading={testarAviso.busy}
            onClick={() => testarAviso.run().catch((e) => toast.error(e.message))}
          >
            Enviar teste
          </Button>
        }
      >
        <p className="faint" style={{ marginBottom: 12 }}>
          Quando uma conta é pausada por falha, ou o Instagram pede CAPTCHA/2FA, você recebe a
          mensagem onde estiver. Sem isto, a fila pode ficar parada a noite inteira sem ninguém saber.
        </p>

        <div className="grid grid--2">
          <Field
            label="Token do bot do Telegram"
            hint="Fale com o @BotFather no Telegram, mande /newbot e cole o token aqui."
          >
            <Input
              type="password"
              value={avisos.telegramBotToken}
              placeholder="123456:ABC-DEF..."
              onChange={(e) => setAvisos((a) => ({ ...a, telegramBotToken: e.target.value }))}
              onBlur={() => salvar.run({ telegramBotToken: avisos.telegramBotToken })}
            />
          </Field>
          <Field
            label="Id do chat"
            hint="Mande qualquer mensagem para o bot e abra api.telegram.org/bot<token>/getUpdates para ver o id."
          >
            <Input
              value={avisos.telegramChatId}
              placeholder="123456789"
              onChange={(e) => setAvisos((a) => ({ ...a, telegramChatId: e.target.value }))}
              onBlur={() => salvar.run({ telegramChatId: avisos.telegramChatId })}
            />
          </Field>
        </div>

        <Field
          className="mt"
          label="Ou um webhook (Discord, n8n, Make)"
          hint="Recebe um POST com JSON. O campo `content` sai preenchido, que é o que o Discord lê."
        >
          <Input
            value={avisos.webhookUrl}
            placeholder="https://discord.com/api/webhooks/..."
            onChange={(e) => setAvisos((a) => ({ ...a, webhookUrl: e.target.value }))}
            onBlur={() => salvar.run({ webhookUrl: avisos.webhookUrl })}
          />
        </Field>

        <Checkbox
          className="mt"
          label="Avisar também quando publicar com sucesso"
          hint="Desligado por padrão: quem publica 20 vezes por dia não quer 20 mensagens. Falhas avisam sempre."
          checked={data?.notifyOnSuccess ?? false}
          onChange={(e) => salvar.run({ notifyOnSuccess: e.target.checked })}
        />
      </Card>

      {/* Backup: fila, horários e biblioteca vivem num arquivo SQLite só. */}
      <Card title="Backup da configuração" icon={DatabaseBackup} className="mt">
        <p className="faint" style={{ marginBottom: 12 }}>
          Contas, fila, horários, legendas, hashtags, templates e pastas monitoradas num arquivo
          JSON. Restaurar só acrescenta o que falta — não apaga nem duplica nada.
        </p>

        <Banner tone="warn" icon={AlertTriangle}>
          O backup <b>não</b> inclui as sessões do navegador nem os arquivos de vídeo. Sessão
          copiada é o que o Instagram trata como sessão roubada; depois de restaurar, reconecte
          cada conta. Os vídeos continuam onde estão no disco.
        </Banner>

        <input
          ref={backupRef} type="file" accept="application/json,.json" hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) restaurar(f);
          }}
        />

        <div className="row mt">
          <Button
            variant="primary" icon={Download} loading={baixarBackup.busy}
            onClick={() => baixarBackup.run().catch((e) => toast.error(e.message))}
          >
            Baixar backup
          </Button>
          <Button icon={Upload} onClick={() => backupRef.current?.click()}>
            Restaurar de um arquivo
          </Button>
        </div>
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
