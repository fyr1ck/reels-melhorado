# Por que `--watch-path=./server`

`node --watch` sem alvo observa TUDO que o processo carrega, inclusive
`node_modules`. Várias bibliotecas carregam arquivos sob demanda na primeira
requisição — `iconv-lite` abre uma tabela de encoding quando chega o primeiro
upload multipart, o `@ffmpeg-installer` toca o próprio `package.json` — e o
watcher lê isso como "o código mudou" e reinicia a API **no meio do request**.

O sintoma é um `ECONNRESET` no cliente durante o primeiro upload da sessão, sem
nenhum erro no log do servidor: ele não falhou, ele foi reiniciado.

`--watch-path=./server` limita o watcher ao código do projeto.
