import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Card, Button } from '../design/ui.jsx';

/**
 * Rede de segurança das telas.
 *
 * Existe por causa do carregamento sob demanda: cada rota é um arquivo à
 * parte, buscado quando alguém abre a tela. Se esse arquivo não chega — o
 * servidor reiniciou, o app foi atualizado com a aba aberta, a rede caiu no
 * meio — o React derruba a árvore inteira e sobra uma página em branco, sem
 * menu e sem nenhuma pista do que fazer.
 *
 * Aqui o erro vira uma tela com um botão. E como o caso mais comum é o
 * arquivo ter mudado de nome numa atualização, recarregar resolve de fato.
 */
export default class ErrorBoundary extends Component {
  state = { erro: null };

  static getDerivedStateFromError(erro) {
    return { erro };
  }

  render() {
    const { erro } = this.state;
    if (!erro) return this.props.children;

    // Falha de carregamento de módulo tem tratamento próprio: a mensagem
    // técnica não ajuda ninguém, e a solução é sempre recarregar.
    const ehPedacoFaltando = /dynamically imported module|Importing a module script failed|Failed to fetch/i
      .test(erro.message ?? '');

    return (
      <Card
        tone="danger"
        title={ehPedacoFaltando ? 'O painel foi atualizado' : 'Algo quebrou nesta tela'}
        icon={AlertTriangle}
      >
        <p className="dim">
          {ehPedacoFaltando
            ? 'Esta aba está com uma versão antiga do painel e não conseguiu carregar a tela. Recarregar resolve.'
            : 'A tela não conseguiu ser desenhada. Suas contas, fila e horários não foram afetados — o erro é só na interface.'}
        </p>

        {!ehPedacoFaltando && (
          <pre className="erro-detalhe">{erro.message}</pre>
        )}

        <div className="row mt">
          <Button variant="primary" icon={RefreshCw} onClick={() => window.location.reload()}>
            Recarregar o painel
          </Button>
          {!ehPedacoFaltando && (
            <Button onClick={() => this.setState({ erro: null })}>Tentar desenhar de novo</Button>
          )}
        </div>
      </Card>
    );
  }
}
