import { useEffect, useState } from 'react';
import {
  MessageCircle, QrCode, Power, Smartphone, Send, Terminal,
  ShieldCheck, LogOut, RefreshCw, AlertTriangle,
} from 'lucide-react';
import { useQuery, useMutation } from '../../hooks/useQuery.js';
import { useToast } from '../../hooks/useToast.jsx';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import { api } from '../../lib/api.js';
import {
  Card, Button, Badge, Field, Input, Checkbox, Banner, Skeleton, Empty,
} from '../../design/ui.jsx';
import './whatsapp.css';

/**
 * Controle remoto por WhatsApp.
 *
 * Conecta lendo um QR, como o WhatsApp Web — a sessão fica nesta máquina. A
 * partir daí os avisos chegam no celular e o número configurado pode dar
 * comandos de volta.
 */

const ESTADO = {
  DESLIGADO: { texto: 'desconectado', tom: 'muted' },
  ABRINDO: { texto: 'abrindo o navegador…', tom: 'warn' },
  AGUARDANDO_QR: { texto: 'esperando você ler o QR', tom: 'brand' },
  CONECTADO: { texto: 'conectado', tom: 'ok' },
  ERRO: { texto: 'erro', tom: 'danger' },
};

export default function WhatsApp() {
  const toast = useToast();
  const confirm = useConfirm();
  const [numero, setNumero] = useState('');
  const [teste, setTeste] = useState('menu');
  const [simulado, setSimulado] = useState(null);

  const { data, loading, reload } = useQuery('/whatsapp');

  // Enquanto espera o QR, consulta mais rápido: o código do WhatsApp expira em
  // cerca de 20 segundos e a página gera outro sozinha.
  const esperandoQr = data?.estado === 'AGUARDANDO_QR' || data?.estado === 'ABRINDO';
  const { data: qr } = useQuery('/whatsapp/qr', {
    enabled: esperandoQr,
    refetchMs: 3000,
  });

  useEffect(() => {
    if (data) setNumero(data.numero ?? '');
  }, [data?.numero]); // eslint-disable-line react-hooks/exhaustive-deps

  // Assim que conecta, recarrega o estado geral para a tela sair da espera.
  useEffect(() => {
    if (qr?.estado && qr.estado !== data?.estado) reload({ quiet: true });
  }, [qr?.estado]); // eslint-disable-line react-hooks/exhaustive-deps

  const salvar = useMutation(async (patch) => {
    await api.patch('/whatsapp', patch);
    await reload({ quiet: true });
  });

  const conectar = useMutation(async () => {
    await api.post('/whatsapp/connect');
    await reload({ quiet: true });
    toast.success('Abrindo o WhatsApp Web. O QR aparece aqui em instantes.');
  });

  const testar = useMutation(async () => {
    await api.post('/whatsapp/test');
    toast.success('Mensagem enviada. Confira o celular.');
  });

  const simular = useMutation(async () => {
    setSimulado(await api.post('/whatsapp/simulate', { texto: teste }));
  });

  async function desconectar(esquecer) {
    const ok = await confirm({
      title: esquecer ? 'Esquecer este telefone?' : 'Desconectar',
      description: esquecer
        ? 'A sessão salva é apagada e o próximo acesso vai pedir um QR novo. Use isto para trocar de telefone.'
        : 'Fecha o navegador do WhatsApp. A sessão fica salva e reconecta sem QR.',
      confirmLabel: esquecer ? 'Esquecer' : 'Desconectar',
      danger: esquecer,
    });
    if (!ok) return;

    await api.post('/whatsapp/disconnect', { esquecer });
    await reload({ quiet: true });
    toast.success(esquecer ? 'Sessão apagada.' : 'Desconectado.');
  }

  if (loading && !data) return <Skeleton height={340} />;

  const est = ESTADO[data?.estado] ?? ESTADO.DESLIGADO;
  const imagemQr = qr?.qr ?? null;

  return (
    <>
      <div className="page-head">
        <h2>WhatsApp</h2>
        <p>
          Receba os avisos no celular e comande o painel de onde estiver. Conecta lendo um QR,
          igual ao WhatsApp Web — a sessão fica nesta máquina.
        </p>
      </div>

      <Card
        title="Ligar e conectar"
        icon={MessageCircle}
        action={<Badge tone={est.tom}>{est.texto}</Badge>}
      >
        <Checkbox
          label={<><Power size={12} /> Usar o WhatsApp para avisos e comandos</>}
          hint="Desligado, nenhum navegador é aberto e nenhuma mensagem é enviada ou lida."
          checked={data?.habilitado ?? false}
          onChange={(e) => salvar.run({ enabled: e.target.checked })
            .then(() => toast.success(e.target.checked ? 'WhatsApp ligado.' : 'WhatsApp desligado.'))
            .catch((err) => toast.error(err.message))}
        />

        <Field
          className="mt"
          label={<><Smartphone size={12} /> Seu número, com código do país</>}
          hint="É o ÚNICO número atendido: mensagem de qualquer outra conversa é ignorada, e os avisos só vão para ele."
        >
          <Input
            value={numero}
            placeholder="5516994441788"
            onChange={(e) => setNumero(e.target.value)}
            onBlur={() => numero !== (data?.numero ?? '') && salvar.run({ numero })
              .then(() => toast.success('Número salvo.'))
              .catch((err) => toast.error(err.message))}
          />
        </Field>

        {data?.ultimoErro && (
          <div className="mt">
            <Banner tone="danger" icon={AlertTriangle}>{data.ultimoErro}</Banner>
          </div>
        )}

        <div className="row mt">
          {data?.estado !== 'CONECTADO' ? (
            <Button
              variant="primary" icon={QrCode} loading={conectar.busy || esperandoQr}
              disabled={!data?.habilitado || !data?.numero}
              title={!data?.habilitado ? 'Ligue o WhatsApp acima.'
                : !data?.numero ? 'Configure o número primeiro.' : undefined}
              onClick={() => conectar.run().catch((e) => toast.error(e.message))}
            >
              Conectar com QR
            </Button>
          ) : (
            <>
              <Button
                icon={Send} loading={testar.busy}
                onClick={() => testar.run().catch((e) => toast.error(e.message))}
              >
                Enviar teste
              </Button>
              <Button icon={LogOut} onClick={() => desconectar(false)}>Desconectar</Button>
              <Button variant="danger" icon={RefreshCw} onClick={() => desconectar(true)}>
                Trocar de telefone
              </Button>
            </>
          )}
        </div>
      </Card>

      {esperandoQr && (
        <Card className="mt" title="Leia o código no seu celular" icon={QrCode}>
          <div className="wa-qr">
            <div className="wa-qr__img">
              {imagemQr
                ? <img src={imagemQr} alt="QR code do WhatsApp Web" />
                : <div className="wa-qr__espera"><RefreshCw size={20} className="spin" /></div>}
            </div>
            <ol className="wa-qr__passos">
              <li>Abra o <b>WhatsApp</b> no celular</li>
              <li>Toque em <b>Configurações</b> → <b>Dispositivos conectados</b></li>
              <li>Toque em <b>Conectar dispositivo</b></li>
              <li>Aponte a câmera para este código</li>
            </ol>
          </div>
          <p className="faint mt">
            O código expira sozinho a cada ~20 segundos e é trocado automaticamente — se ele piscar,
            é isso. Uma janela do Chromium também abriu; pode deixá-la minimizada depois de conectar.
          </p>
        </Card>
      )}

      <Card className="mt" title="O que dá para mandar" icon={Terminal}>
        <p className="faint" style={{ marginBottom: 12 }}>
          Mande <b>menu</b> no WhatsApp para ver esta lista no celular.
        </p>

        <div className="wa-cmds">
          {(data?.comandos ?? []).map((c) => (
            <div key={c.nome} className="wa-cmd">
              <code>{c.nome}</code>
              <span className="faint">{c.descricao}</span>
            </div>
          ))}
        </div>

        <div className="mt">
          <Banner tone="brand" icon={ShieldCheck}>
            Só <b>este número</b> é atendido, e a lista de comandos é fechada: nada aqui apaga
            vídeo, remove conta ou mexe em arquivo. Pausar e retomar dão para desfazer; apagar não.
          </Banner>
        </div>

        {/* Testar sem WhatsApp: confere a resposta de cada comando antes de
            conectar, e ajuda quando o que chega no celular não é o esperado. */}
        <div className="wa-teste mt">
          <Field label="Testar um comando aqui, sem WhatsApp">
            <Input
              value={teste}
              placeholder="menu"
              onChange={(e) => setTeste(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && simular.run()}
            />
          </Field>
          <Button icon={Terminal} loading={simular.busy}
            onClick={() => simular.run().catch((e) => toast.error(e.message))}>
            Ver resposta
          </Button>
        </div>

        {simulado && (
          <div className="wa-resposta mt">
            {!simulado.reconhecido && (
              <p className="faint">Não é um comando — no WhatsApp, isso recebe só uma dica.</p>
            )}
            <pre>{simulado.resposta}</pre>
          </div>
        )}
      </Card>

      {!data?.habilitado && (
        <Card className="mt">
          <Empty icon={MessageCircle} title="WhatsApp desligado">
            Ligue acima e configure seu número para receber avisos e comandar o painel de longe.
          </Empty>
        </Card>
      )}
    </>
  );
}
