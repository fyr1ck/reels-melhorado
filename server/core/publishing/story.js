import { UnsupportedError } from '../../lib/errors.js';

/**
 * Publicação de story — NÃO É POSSÍVEL pela web do Instagram.
 *
 * Verificado com cinco sondas somente-leitura contra a interface real
 * (conta conectada, 07/09/2026):
 *
 *   1. Desktop: o menu "Criar" oferece apenas Postar / Vídeo ao vivo / Anúncio.
 *   2. /stories/create/ não é rota: redireciona para /create/, que o Instagram
 *      resolve como nome de usuário e abre um perfil qualquer.
 *   3. O feed desktop não tem bandeja de stories com botão de criação.
 *   4. Web móvel (Pixel 5 emulado): existe o rótulo "Seu story", mas ele não é
 *      clicável.
 *   5. Ainda na web móvel, TODOS os input[type=file] da página aceitam apenas
 *      imagem (image/avif,image/jpeg,image/png). Nenhum aceita vídeo.
 *
 * Não é seletor desatualizado: é ausência da funcionalidade na plataforma.
 *
 * O modelo de dados mantém `mediaType` e a grade de story continua salva, para
 * o dia em que isso mudar. Mas o agendador ignora stories de propósito —
 * tentar publicar consumiria as 3 tentativas, moveria o vídeo para /failed e
 * pausaria a conta, destruindo a fila por uma limitação sem conserto daqui.
 */
export const STORY_UNSUPPORTED_REASON =
  'A web do Instagram não permite publicar story em vídeo: não há criação de story em ' +
  'nenhum caminho (menu "Criar", URL direta ou versão móvel), e os campos de upload da ' +
  'versão móvel aceitam apenas imagem. Publique stories pelo app do celular.';

export async function publishStory() {
  throw new UnsupportedError(STORY_UNSUPPORTED_REASON);
}
