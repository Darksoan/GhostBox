import { DISCORD_URL, POLICY_PATHS } from "./links";
import type { SiteContent } from "./types";

export const pt: SiteContent = {
  htmlLang: "pt-BR",
  meta: {
    title: "GhostBox — sua biblioteca Steam, do seu jeito",
    description:
      "Launcher de desktop que organiza sua biblioteca Steam: catálogo, coleções, conquistas, downloads e backup na nuvem em uma interface escura e silenciosa.",
  },
  skipToContent: "Ir para o conteúdo",
  nav: {
    brand: "GhostBox",
    links: [
      { label: "Recursos", href: "#recursos" },
      { label: "Premium", href: "#premium" },
      { label: "Instalação", href: "#instalacao" },
      { label: "Perguntas", href: "#perguntas" },
    ],
    cta: "Baixar",
    menuOpen: "Abrir menu",
    menuClose: "Fechar menu",
    languageLabel: "Idioma",
  },
  hero: {
    eyebrow: "Launcher para Windows",
    title: "Sua biblioteca Steam, organizada do seu jeito",
    lead: "O GhostBox reúne catálogo, coleções, conquistas e downloads em uma interface escura que não disputa atenção com a arte dos jogos.",
    ctaPrimary: "Baixar para Windows",
    ctaSecondary: "Ver planos",
    note: "Gratuito. O Premium é opcional e cabe no bolso.",
    mockupLabel: "Representação da interface do GhostBox",
  },
  showcase: {
    title: "O que você vê ao abrir",
    items: [
      {
        id: "library",
        eyebrow: "Biblioteca",
        title: "Todos os seus jogos em uma superfície só",
        body: "Contas Steam conectadas viram uma biblioteca única, com tempo jogado, última sessão e capa em alta resolução.",
        bullets: [
          "Várias contas Steam na mesma lista",
          "Busca imediata por título",
          "Coleções e favoritos que você define",
        ],
      },
      {
        id: "catalogue",
        eyebrow: "Catálogo",
        title: "Descoberta com filtro de verdade",
        body: "Gênero, tag, desenvolvedora, publicadora e ano se combinam. A ordenação segue popularidade, adições recentes ou quem está sendo mais jogado agora.",
        bullets: [
          "Filtros combinados com contador por opção",
          "Grade ou lista, do seu jeito",
          "Prévia com capturas ao passar o mouse",
        ],
      },
      {
        id: "achievements",
        eyebrow: "Conquistas",
        title: "Progresso visível, jogo a jogo",
        body: "Cada título mostra conclusão, conquistas desbloqueadas e data. O perfil reúne tempo total, jogos 100% e a atividade recente.",
        bullets: [
          "Conclusão por jogo",
          "Ordenação por mais conquistas ou jogos 100%",
          "Métricas da Steam no seu perfil",
        ],
      },
    ],
  },
  features: {
    eyebrow: "Recursos",
    title: "Feito para quem tem biblioteca grande",
    lead: "Cada aba resolve uma tarefa específica, sem enterrar o que importa em menus.",
    items: [
      {
        icon: "LibraryBig",
        title: "Biblioteca unificada",
        body: "Conecte suas contas Steam e veja tudo em uma lista só, com tempo jogado e última sessão.",
      },
      {
        icon: "Compass",
        title: "Catálogo com filtros",
        body: "Gênero, tag, estúdio e ano se combinam para achar o próximo jogo em poucos cliques.",
      },
      {
        icon: "Star",
        title: "Coleções e favoritos",
        body: "Monte listas próprias e marque favoritos. A organização é sua, não a da loja.",
      },
      {
        icon: "Trophy",
        title: "Conquistas",
        body: "Acompanhe conclusão por jogo, conquistas raras e sua atividade recente no perfil.",
      },
      {
        icon: "Download",
        title: "Downloads no app",
        body: "Baixe, pause, retome e acompanhe fila e espaço em disco sem sair do GhostBox.",
      },
      {
        icon: "Bell",
        title: "Notificações",
        body: "Backups, conquistas, downloads e alertas de conta chegam em um único lugar.",
      },
    ],
  },
  sync: {
    eyebrow: "Nuvem e backup",
    title: "Seus saves continuam seus",
    body: "O GhostBox é local primeiro: a organização vive na sua máquina. Quando você liga a nuvem, saves e perfil passam a ter cópia fora do PC.",
    points: [
      {
        title: "Backup automático de saves",
        body: "Pontos de restauração criados em segundo plano, com histórico para voltar a uma versão anterior.",
      },
      {
        title: "Sincronização de perfil",
        body: "Favoritos, coleções e ajustes acompanham sua conta em outra máquina.",
      },
      {
        title: "Você escolhe o que sobe",
        body: "Nada sai do seu computador sem você ligar a sincronização.",
      },
    ],
  },
  premium: {
    eyebrow: "Premium",
    title: "Backup na nuvem por menos que um café",
    lead: "O GhostBox funciona de graça. O Premium libera backup automático, sincronização e personalização de perfil.",
    plans: [
      {
        id: "monthly",
        name: "Mensal",
        cadence: "por mês",
        perMonth: "",
        benefits: [
          "Backup automático de saves",
          "Sincronização de perfil e coleções",
          "Capa e avatar personalizados",
          "Cancele quando quiser",
        ],
      },
      {
        id: "quarterly",
        name: "Trimestral",
        cadence: "a cada 3 meses",
        perMonth: "{price} por mês",
        highlight: "Melhor valor",
        benefits: [
          "Tudo do plano mensal",
          "Economia de cerca de 28%",
          "Uma cobrança a cada três meses",
          "Cancele quando quiser",
        ],
      },
    ],
    cta: "Assinar pelo app",
    ctaNote: "A assinatura é feita dentro do GhostBox, na aba Assinatura dos Ajustes.",
  },
  install: {
    eyebrow: "Instalação",
    title: "Três passos até a primeira abertura",
    steps: [
      {
        title: "Baixe o instalador",
        body: "O arquivo mais recente fica na página de releases do GitHub.",
      },
      {
        title: "Execute e siga o instalador",
        body: "O Windows pode pedir confirmação por ser um aplicativo novo. Autorize e siga adiante.",
      },
      {
        title: "Conecte sua conta Steam",
        body: "Na primeira abertura, ligue sua conta em Ajustes e a biblioteca aparece sozinha.",
      },
    ],
    cta: "Baixar para Windows",
    requirements: "Windows 10 ou 11, 64 bits.",
  },
  faq: {
    eyebrow: "Perguntas",
    title: "O que costumam perguntar",
    items: [
      {
        question: "O GhostBox substitui a Steam?",
        answer:
          "Não. Ele organiza e complementa a sua biblioteca Steam. A Steam continua sendo quem roda e valida os jogos.",
      },
      {
        question: "Preciso pagar para usar?",
        answer:
          "Não. Biblioteca, catálogo, coleções, conquistas, downloads e notificações são gratuitos. O Premium cobre backup na nuvem, sincronização e personalização de perfil.",
      },
      {
        question: "Meus dados saem do meu computador?",
        answer:
          "Só se você quiser. O GhostBox é local primeiro: a organização fica no seu PC e a nuvem só entra em ação quando você liga a sincronização.",
      },
      {
        question: "Dá para usar mais de uma conta Steam?",
        answer:
          "Dá. Você conecta várias contas e o GhostBox junta tudo em uma biblioteca só, sem duplicar títulos.",
      },
      {
        question: "Como cancelo o Premium?",
        answer:
          "Pela aba Assinatura, dentro do app. O cancelamento interrompe as próximas cobranças e o acesso segue até o fim do período pago.",
      },
      {
        question: "Funciona no macOS ou Linux?",
        answer: "Ainda não. Por enquanto o GhostBox é um aplicativo para Windows 10 e 11.",
      },
    ],
  },
  footer: {
    tagline: "GhostBox — sua biblioteca Steam, do seu jeito.",
    legal: [
      { label: "Termos de uso", href: POLICY_PATHS.terms },
      { label: "Privacidade", href: POLICY_PATHS.privacy },
      { label: "Reembolso", href: POLICY_PATHS.refund },
    ],
    social: [{ label: "Entrar no Discord do GhostBox", href: DISCORD_URL, icon: "discord" }],
    rights: "GhostBox não vende, distribui nem modifica jogos.",
  },
  policies: {
    terms: {
      slug: "terms",
      eyebrow: "GhostBox",
      title: "Termos de uso",
      paragraphs: [
        "O GhostBox é uma ferramenta de biblioteca e de gerenciamento de progresso para jogos e aplicativos que o usuário tem autorização para executar. O GhostBox não vende, não distribui, não fornece acesso e não modifica jogos.",
        "O GhostBox Premium é uma assinatura que oferece recursos opcionais como backup automático de saves, pontos de restauração e sincronização na nuvem. O acesso aos recursos Premium pode exigir assinatura ativa.",
        "O usuário é responsável por usar o GhostBox apenas com softwares e conteúdos aos quais tem acesso legal. Uso indevido do GhostBox ou tentativa de contornar termos de terceiros não é permitido.",
        "O GhostBox pode alterar, suspender ou descontinuar recursos conforme o produto evolui. As condições da assinatura são exibidas no checkout do Stripe antes da conclusão do pagamento.",
      ],
      back: "Voltar para o GhostBox",
    },
    privacy: {
      slug: "privacy",
      eyebrow: "GhostBox",
      title: "Política de privacidade",
      paragraphs: [
        "O GhostBox foi feito como uma ferramenta local primeiro. Dados de organização da biblioteca, entradas locais de jogos e backups locais são tratados no dispositivo do usuário, a menos que ele escolha usar os recursos de sincronização na nuvem.",
        "Os pagamentos são processados pelo Stripe. O GhostBox não armazena números completos de cartão nem credenciais de pagamento. O Stripe pode processar informações de pagamento, cobrança, impostos e prevenção a fraude de acordo com as políticas dele.",
        "Para os recursos Premium, o GhostBox pode processar dados de conta, assinatura e sincronização necessários para oferecer backup e sincronização na nuvem.",
        "O GhostBox não vende dados pessoais. Dúvidas sobre privacidade podem ser tratadas pelo canal de suporte informado com o produto.",
      ],
      back: "Voltar para o GhostBox",
    },
    refund: {
      slug: "refund",
      eyebrow: "GhostBox Premium",
      title: "Política de reembolso",
      paragraphs: [
        "O GhostBox Premium é cobrado por período. O usuário pode cancelar a assinatura para interromper as próximas renovações.",
        "Pedidos de reembolso são avaliados caso a caso. Se um problema técnico impedir o acesso aos recursos Premium e não puder ser resolvido, o reembolso do período afetado pode ser concedido.",
        "Os reembolsos são processados pelo Stripe e podem levar alguns dias úteis para aparecer, dependendo do meio de pagamento e do banco.",
        "Por ser um serviço digital, o GhostBox Premium não garante reembolso proporcional de período parcial, salvo quando exigido pela legislação aplicável.",
      ],
      back: "Voltar para o GhostBox",
    },
  },
};
