# Reels Manager

Painel local para publicar Reels no Instagram em várias contas: fila, horários,
editor em massa, pastas monitoradas, avisos no WhatsApp e um assistente que
corrige erros do próprio código pela API do Claude.

Roda **na sua máquina**. Nenhum servidor externo, nenhuma senha guardada.

---

## Instalação

### 1. O que precisa estar instalado

| | versão | como conferir |
|---|---|---|
| **Node.js** | 20 ou mais novo | `node -v` |
| **Git** | qualquer | `git --version` |

Se `node -v` não responder, baixe em <https://nodejs.org> (a versão **LTS**) e
reinicie o terminal.

O `ffmpeg` **não** precisa ser instalado: vem junto pelo `npm`.

### 2. Baixar

```bash
git clone https://github.com/fyr1ck/reels-melhorado.git
cd reels-melhorado
```

Ou baixe o ZIP pelo botão **Code → Download ZIP** no GitHub e descompacte.

### 3. Instalar

Um comando só, e ele faz tudo — dependências do servidor e do painel, banco de
dados e o navegador que publica:

```bash
npm run setup
```

Demora alguns minutos na primeira vez (o Chromium tem ~150 MB).

### 4. Configurar

Copie o arquivo de exemplo e abra para editar:

```bash
cp .env.example .env
```

O padrão já funciona. Vale mexer em dois:

```ini
# Deixe false para VER a janela do navegador. É assim que você resolve
# CAPTCHA e 2FA quando o Instagram pedir.
HEADLESS=false

# Onde os vídeos ficam. Pode apontar para outro disco.
VIDEOS_DIR=./videos
```

### 5. Rodar

```bash
npm run dev
```

Abra <http://localhost:3000>. Para parar: `Ctrl+C` no terminal.

---

## Primeiros passos no painel

1. **Contas** → renomeie `conta-principal` para o seu @ real do Instagram.
2. **Contas** → **Conectar**. Uma janela abre no Instagram; faça login à mão,
   com 2FA e tudo. *A senha nunca passa pelo app* — quem digita é você, na
   janela real.
3. **Contas** → **Ativar**.
4. **Fila** → arraste seus vídeos.
5. **Horários** → escolha o ritmo (veja abaixo).

Pronto. A partir daí o agendador publica sozinho.

---

## Os três modos de publicação

Em **Horários → Quando publicar**:

**Horários fixos** — você cadastra 08:00, 12:00, 18:00 e ele publica nesses
horários, todo dia. Bom para poucos posts.

**Volume por dia** — você diz *"70 vídeos por dia, das 7h às 23h"* e ele divide
por igual: um a cada 14 minutos, nada de madrugada. Tem atalhos prontos para
20, 50 e 70 por dia. É o modo para operar volume.

**A cada X tempo** — a cada 20 minutos, 2 horas, o que for, sem parar. Ignora a
hora do dia.

### Limites de segurança

Logo abaixo, e valem **por cima** do modo escolhido:

- **Teto diário** — máximo por dia, mesmo que o modo peça mais. Se você pedir
  70 e o teto for 30, saem 30 — espalhados pela faixa inteira, não amontoados
  de manhã.
- **Janela de silêncio** — faixa em que a conta não publica. Pode atravessar a
  meia-noite (23:00 às 07:00).
- **Aquecimento** — conta nova começa em 1 post/dia e sobe até o alvo ao longo
  de N dias.

> Um aviso honesto sobre volume: 70 posts por dia é um post a cada 14 minutos.
> É um ritmo que o Instagram nota. Se a conta for nova, ligue o aquecimento —
> ele segura o volume nos primeiros dias e vai soltando.

---

## WhatsApp — avisos e comandos

Menu **WhatsApp**. Funciona como um bot: roda em segundo plano, sem abrir
janela nenhuma.

**São dois números, com papéis diferentes:**

- Quem **escaneia o QR** é o *telefone do bot*. Pode ser um chip separado.
- O número que você **configura no campo** é o *seu*: é para ele que os avisos
  vão, e é só dele que os comandos são aceitos.

Para conectar: ligue, ponha seu número com código do país (`5516994441788`),
clique em **Conectar com QR** e leia o código com o telefone do bot.

Mande **menu** para ver o que dá para fazer: `status`, `fila`, `proximo`,
`contas`, `erros`, `pausar`, `ativar`.

Detalhes e limitações: [`server/core/whatsapp/LEIA-ME.md`](server/core/whatsapp/LEIA-ME.md)

---

## Assistente de código (API do Claude)

Menu **Assistente**. Quando algo quebra, ele captura o erro com o trecho de
código que o causou, manda para a API do Claude e traz a correção para você
revisar.

**Ligar:**

1. Pegue uma chave em <https://console.anthropic.com> → **API Keys**
2. Coloque no `.env`:

```ini
ANTHROPIC_API_KEY=sk-ant-cole-a-sua-aqui
```

3. No painel, **Assistente** → marque *Capturar erros e permitir análise*

A chave no `.env` tem prioridade sobre a do painel, não passa pelo banco e
nunca entra no backup. **É paga por uso** — cada análise é uma chamada.

Detalhes, e o que nunca sai da sua máquina:
[`server/core/assistant/LEIA-ME.md`](server/core/assistant/LEIA-ME.md)

---

## Backup

**Configurações → Backup da configuração → Baixar backup.**

Guarda contas, fila, horários, legendas, hashtags, templates e pastas num JSON.
Restaurar só acrescenta o que falta — não duplica nada.

Ficam de fora de propósito: as sessões do navegador (copiar sessão é o que o
Instagram trata como sessão roubada) e as chaves de API. Depois de restaurar,
reconecte cada conta.

---

## Comandos

| comando | o que faz |
|---|---|
| `npm run dev` | roda painel + API, recarregando ao salvar |
| `npm start` | roda em modo produção |
| `npm test` | roda os 137 testes |
| `npm run build` | gera o painel para produção |
| `npm run db:studio` | abre o navegador do banco de dados |
| `npm run setup` | instala tudo do zero |

---

## Problemas comuns

**`node` não é reconhecido** — o Node não está instalado ou o terminal não foi
reiniciado depois de instalar.

**A porta 3001 já está em uso** — outro programa está nela. Mude `PORT` no
`.env`.

**O Instagram pede CAPTCHA ou 2FA** — deixe `HEADLESS=false` no `.env` para ver
a janela e resolver à mão. É por isso que o padrão é visível.

**A conta pausou sozinha** — três falhas seguidas pausam a conta, de propósito.
Veja **Fila → Falhados** e **Atividade** para o motivo, resolva e reative em
**Contas**.

**A fila não publica** — confira nesta ordem: a conta está *conectada*? está
*ativa*? tem *horário* cadastrado (ou um modo que não precise)? tem *vídeo
pendente*? o **teto diário** ou a **janela de silêncio** não estão cortando
tudo? O **Dashboard** mostra o estado de cada conta.

**O WhatsApp parou de conectar** — `GET /api/whatsapp/diagnostico` diz qual
seletor deixou de funcionar. Desligue *Rodar sem abrir janela* para ver a
página de verdade.

---

## O que este projeto NÃO faz

Por decisão, não por falta de tempo:

- **Não publica stories.** A web do Instagram não permite; agendar um story
  levaria o vídeo a esgotar as tentativas e ser movido para `failed/`. O
  agendador pula stories de propósito.
- **Não baixa vídeo de outros criadores.**
- **Não mascara fingerprint** nem integra navegador anti-detecção. O isolamento
  entre contas é só de sessão — cookies separados para o app não misturar
  contas. Operar muitas contas continua sendo risco de bloqueio.
- **Não cria contas em massa.**

## Como isto funciona por dentro

Publicação por **automação de navegador**: o app dirige um Chromium real,
logado com a sua sessão, e faz os mesmos cliques que você faria. Não usa a API
oficial do Instagram — ela não permite este tipo de uso.

A consequência prática: quando o Instagram muda o HTML, os seletores em
`server/playwright/selectors.js` precisam mudar junto. As mensagens de erro
apontam para esse arquivo quando isso acontece.

## Estrutura

```
server/
  core/          regras de negócio, sem Express — é o que os testes cobrem
    scheduling/  quando publicar, limites, aquecimento
    publishing/  o que dirige o navegador do Instagram
    queue/       fila, capas, conteúdo repetido, reciclagem
    editor/      editor em massa (ffmpeg)
    whatsapp/    bot de avisos e comandos
    assistant/   correção de erros pela API do Claude
  http/          rotas e middleware
  playwright/    navegador e seletores
client/src/
  features/      uma pasta por tela
  design/        primitivos da interface
tests/           137 testes, `node --test`
```
