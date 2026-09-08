# Controle remoto por WhatsApp

Avisos no celular e comandos de volta, na mesma conversa. Conecta lendo um QR,
como o WhatsApp Web — a sessão fica nesta máquina.

## Conectar

1. **WhatsApp** no menu → ligue e coloque seu número com código do país
   (`5516994441788`, não `16994441788`).
2. **Conectar com QR**. Uma janela do Chromium abre e o código aparece no
   painel.
3. No celular: WhatsApp → **Configurações** → **Dispositivos conectados** →
   **Conectar dispositivo** → aponte para o código.

Depois disso a janela pode ficar minimizada. Nos reinícios seguintes o app
reconecta sozinho, sem pedir QR de novo.

## Comandos

Mande **menu** para ver a lista no celular.

| comando | o que faz |
|---|---|
| `menu` | mostra a lista |
| `status` | contas publicando, fila, publicados hoje, próxima |
| `fila` | quantos vídeos faltam em cada conta |
| `proximo` | as 5 próximas publicações |
| `contas` | estado de cada conta |
| `erros` | últimas 5 falhas |
| `pausar` | para tudo — ou `pausar @conta` |
| `ativar` | religa — ou `ativar @conta` |

Conversa normal não dispara nada. `oi` sozinho abre o menu; `oi, tudo bem?`
não faz nada. Foi de propósito: casar a primeira palavra de qualquer frase
faria um bom-dia pausar a operação inteira.

## Segurança

**Só o número configurado é atendido.** A trava é estrutural, não uma checagem
que dá para esquecer: o app abre a conversa por URL (`send?phone=`), então
mensagem de terceiro nem chega a ser lida.

**A lista de comandos é fechada.** Nada aqui apaga vídeo, remove conta ou mexe
em arquivo — mesmo vindo do seu número. Uma mensagem de WhatsApp é fácil demais
de mandar por engano, e um celular desbloqueado na mão de outra pessoa é um
cenário real. Pausar e retomar dão para desfazer; apagar não.

`ativar` recusa conta sem sessão do Instagram: ligar uma conta sem cookie só
geraria falha em loop e a pausaria de novo — e pelo WhatsApp você não veria por
quê.

## Quando parar de funcionar

Isto dirige o HTML do WhatsApp Web, do mesmo jeito que a publicação dirige o do
Instagram. Quando eles mudarem a interface, os seletores em `client.js` mudam
junto.

Para descobrir **o que** quebrou, existe `GET /api/whatsapp/diagnostico`: ele
diz quais seletores casam na página agora, separados por grupo (QR, lista de
conversas, caixa de mensagem). Sem isso o sintoma seria só "não conecta".

Foi esse diagnóstico que pegou o primeiro erro real desta implementação: a
detecção de login casava com o esqueleto que a página desenha enquanto carrega,
e o app anunciava "conectado" sem ninguém ter escaneado nada — as mensagens
sumiriam em silêncio a partir dali. A ordem da checagem passou a ser: QR
primeiro (se está na tela, não há sessão), lista de conversas depois, e ambos
exigindo elemento **visível**.

## Testar sem WhatsApp

A tela tem um campo "Testar um comando aqui, sem WhatsApp", e a mesma coisa
pela API:

```bash
curl -X POST http://localhost:3001/api/whatsapp/simulate \
  -H "Content-Type: application/json" -d '{"texto":"status"}'
```

Devolve exatamente a resposta que iria para o celular.
