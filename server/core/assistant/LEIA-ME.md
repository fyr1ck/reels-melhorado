# Assistente de código

Captura os erros que acontecem rodando o painel, manda para a API do Claude
junto com o trecho de código que os causou, e recebe a correção.

## Ligar

1. Pegue uma chave em <https://console.anthropic.com> → **API Keys**.
2. No painel: **Assistente** → marque *Capturar erros e permitir análise* e cole
   a chave.

Melhor ainda: ponha a chave no `.env` como `ANTHROPIC_API_KEY=sk-ant-...`. Ela
tem prioridade sobre a do painel, não passa pelo banco, e o campo da tela fica
desabilitado indicando de onde a chave veio.

**A chave é paga por uso.** Cada análise é uma chamada à API — o custo depende
do modelo escolhido e do tamanho do erro. Erros repetidos não geram chamadas
novas: eles viram contagem numa entrada só.

## Como funciona

```
erro acontece  →  capturado com stack  →  você clica "Analisar"
                                                  ↓
                          trecho dos arquivos do stack + erro
                                                  ↓
                                          API do Claude
                                                  ↓
                       causa + explicação + trecho antigo/novo
                                                  ↓
                     você revisa o diff  →  "Aplicar no código"
                                                  ↓
                        backup do arquivo  →  escrita  →  histórico
```

De onde vêm os erros:

| origem | o quê |
|---|---|
| `SERVIDOR` | exceção não capturada, promessa rejeitada |
| `ROTA` | erro 500 numa rota da API |
| `PAINEL` | erro de React, capturado pelo ErrorBoundary |

## O que sai da sua máquina

Só isto: a mensagem de erro, o stack trace, e o trecho dos arquivos **citados
no stack**. O botão *Ver o que seria enviado* mostra o pacote exato antes de
qualquer chamada.

Nunca saem, por regra no código (`context.js`):

- `.env` — é onde mora a própria chave, e as credenciais
- `prisma/data/` — o banco, com a fila e o histórico
- `playwright/session/` — os cookies das suas contas do Instagram
- `videos/` e `node_modules/`

A checagem resolve o caminho antes de comparar, então `server/../../.ssh/id_rsa`
também é recusado — comparar prefixo de texto deixaria isso passar.

## Aplicar

Aplicar é sempre um passo separado e explícito. Três garantias:

1. **O trecho tem que bater exatamente e aparecer uma vez só.** Se o arquivo
   mudou depois da análise, ou se o trecho é ambíguo, a correção é recusada em
   vez de aplicada no lugar errado.
2. **Backup antes de escrever**, em `prisma/data/assistente-backups/`.
3. **Desfazer com um clique**, no histórico da própria tela.

### Modo automático

O botão *Corrigir sozinho, sem me perguntar* existe, e vem **desligado**. Ele
só age quando as três condições valem ao mesmo tempo:

- o Claude classificou como defeito de código (`ehBugDeCodigo`)
- a confiança é **alta**
- todos os trechos ainda batem com os arquivos

Fora disso, a proposta fica registrada esperando você. Vale saber o risco real:
escrever no código de um app em execução pode deixá-lo sem subir — e aí não há
interface para consertar a interface. O caminho de volta nesse caso é
`prisma/data/assistente-backups/`, que continua lá.

## O que ele não é

Não é um programador. Ele vê **um** erro por vez, com o trecho do arquivo em
volta — não o projeto inteiro, nem o histórico do git, nem o que você pretendia
fazer. Serve bem para o erro mecânico: variável que chegou `undefined`, campo
que faltou, `await` esquecido. Para decisão de arquitetura, não.

Quando o erro não é de código — o Instagram mudou o HTML, a rede caiu, o disco
encheu — ele diz isso e não inventa um patch.
