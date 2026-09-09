/**
 * Centraliza TODOS os seletores usados na automação do Instagram.
 *
 * A interface do Instagram muda com frequência. Se a publicação parar de
 * funcionar (ex: "Botão de criar publicação não encontrado"), este é o
 * primeiro (e idealmente único) arquivo que precisa de manutenção — não é
 * necessário mexer na lógica do publisher, apenas ajustar os seletores/textos
 * abaixo para refletir a interface atual.
 *
 * Dica: use o Playwright Inspector (npx playwright codegen instagram.com)
 * para descobrir os seletores atualizados caso algo pare de funcionar.
 */

export const SELECTORS = {
  // Página de login manual
  loginPage: {
    urlContains: '/accounts/login',
  },

  // Indicadores de que o Instagram está pedindo verificação de segurança
  // (CAPTCHA, código de 2FA, confirmação de identidade, checkpoint, etc.)
  checkpoint: {
    urlPatterns: [
      '/challenge/',
      '/two_factor',
      '/accounts/suspended',
      '/accounts/login/two_factor',
      '/consent/',
    ],
    textIndicators: [
      'Insira o código',
      'Enter the code',
      'We detected an unusual login attempt',
      'Ajude-nos a confirmar que é você',
      "Confirm it's you",
      'Suspicious Login Attempt',
      'Tentativa de login suspeita',
    ],
  },

  // Botão de criar publicação na barra lateral.
  //
  // O rótulo muda de nome entre versões, e a lista está em ordem do mais
  // recente para o mais antigo. Em 08/09/2026, na interface real, o rótulo é
  // "Novo post" — nenhum dos anteriores casava, e o sintoma era a publicação
  // falhando com "botão não encontrado" numa conta perfeitamente conectada.
  //
  // Quando isso voltar a acontecer, `GET /api/accounts/:id/diagnostico` lista
  // todos os rótulos clicáveis da tela: o nome novo sai de lá.
  createButton: [
    'svg[aria-label="Novo post"]',
    '[aria-label="Novo post"]',
    'svg[aria-label="New post"]',
    '[aria-label="New post"]',
    'svg[aria-label="Nova publicação"]',
    '[aria-label="Nova publicação"]',
    'svg[aria-label="Criar"]',
    'svg[aria-label="Create"]',
    '[aria-label="Criar"]',
    '[aria-label="Create"]',
    'a[href="#"]:has-text("Criar")',
    'a[href="#"]:has-text("Create")',
  ],

  // Opção "Postar" dentro do menu de criação (às vezes já abre direto)
  postOption: [
    'text=Postar',
    'text=Publicação',
    'text=Post',
  ],

  // Interruptor "Adicionar rótulo de IA", na tela da legenda.
  //
  // O texto é o único ponto estável: o interruptor em si é um `div` com
  // classes geradas. Daí a busca ser pelo rótulo, subindo até a linha que o
  // contém e procurando o controle lá dentro.
  aiLabelText: [
    'Adicionar rótulo de IA',
    'Add AI label',
    'Adicionar etiqueta de IA',
  ],
  aiLabelSwitch: [
    'input[type="checkbox"]',
    '[role="switch"]',
    'div[role="button"][tabindex="0"]',
  ],

  // Input de arquivo (upload do vídeo) — usado só como fallback
  fileInput: 'input[type="file"]',

  // Botão que abre o seletor de arquivos do sistema na tela de upload
  // (o mesmo texto é reutilizado depois, na tela "Foto da capa", para
  // trocar a capa por uma imagem do computador).
  selectFromComputerButton: [
    'text=Selecionar do computador',
    'text=Select from computer',
  ],

  // Título da tela onde o Instagram permite escolher a capa do Reel
  // (aparece logo após o upload do vídeo, antes das telas de filtro).
  coverHeading: [
    'text=Foto da capa',
    'text=Cover photo',
    'text=Cover',
  ],

  // Botão "Avançar" — aparece nas telas de corte/edição/filtro
  nextButton: [
    'text=Avançar',
    'text=Next',
  ],

  // Botão final "Compartilhar" — usa match EXATO (aspas) para não confundir
  // com "Compartilhar em" (seção de cross-post pro Facebook, no mesmo modal).
  // role=button/link com nome exato entra primeiro por ser mais confiável;
  // text="" exato fica como fallback.
  shareButton: [
    'role=button[name="Compartilhar"i]',
    'role=link[name="Compartilhar"i]',
    'text="Compartilhar"',
    'role=button[name="Share"i]',
    'role=link[name="Share"i]',
    'text="Share"',
  ],

  // Caixa de texto da legenda
  captionTextbox: [
    'div[aria-label="Escreva uma legenda…"]',
    'div[aria-label="Write a caption…"]',
    'textarea[aria-label="Escreva uma legenda…"]',
    'textarea[aria-label="Write a caption…"]',
  ],

  // Indicadores observáveis de que a publicação foi concluída com sucesso.
  // A automação só considera "publicado" quando um destes aparece.
  //
  // IMPORTANTE: os textos abaixo precisam ser EXATAMENTE o trecho contínuo
  // que aparece na tela (a busca é por substring). O Instagram mostra o
  // diálogo "Reels compartilhados" com o texto "Seu reel foi compartilhado."
  successIndicators: {
    textPatterns: [
      'Reels compartilhados',
      'Seu reel foi compartilhado',
      'Sua publicação foi compartilhada',
      'Your reel has been shared',
      'Post shared',
      'Reel shared',
      'Publicação compartilhada',
    ],
  },
};