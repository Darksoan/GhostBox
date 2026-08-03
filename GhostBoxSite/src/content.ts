export type FeatureId =
  | "library"
  | "catalogue"
  | "collections"
  | "achievements"
  | "notifications"
  | "profile";

export type Feature = {
  id: FeatureId;
  eyebrow: string;
  title: string;
  description: string;
  metric: string;
  metricLabel: string;
};

export type PlanId = "free" | "premium";
export type BillingCycle = "monthly" | "quarterly";

export type Plan = {
  id: PlanId;
  name: string;
  description: string;
  prices: Record<BillingCycle, number> | null;
  features: string[];
  action: string;
  highlighted?: boolean;
};

export type FaqItem = {
  id: "steam" | "profile" | "cloud" | "cancel";
  question: string;
  answer: string;
};

export const heroCopy = {
  eyebrow: "Um lugar para tudo o que você joga",
  title: "Sua biblioteca Steam, do seu jeito.",
  description:
    "GhostBox transforma uma coleção espalhada em uma experiência pessoal: descubra o próximo jogo, acompanhe suas conquistas e deixe seu perfil com a sua cara.",
};

export const features: Feature[] = [
  {
    id: "library",
    eyebrow: "Sua base",
    title: "Tudo o que você joga, em um só lugar.",
    description:
      "Uma visão clara da sua biblioteca, do que está instalado e do que merece voltar para a sua próxima sessão.",
    metric: "248",
    metricLabel: "jogos organizados",
  },
  {
    id: "catalogue",
    eyebrow: "Descoberta",
    title: "Encontre algo novo para jogar.",
    description:
      "Explore o catálogo Steam com busca, filtros e detalhes que ajudam você a decidir sem abrir dez abas.",
    metric: "12k+",
    metricLabel: "possibilidades",
  },
  {
    id: "collections",
    eyebrow: "Curadoria",
    title: "Coleções que pensam como você.",
    description:
      "Crie listas, fixe favoritos e organize os jogos pelas histórias, gêneros e momentos que importam.",
    metric: "08",
    metricLabel: "coleções favoritas",
  },
  {
    id: "achievements",
    eyebrow: "Progresso",
    title: "Cada conquista deixa uma marca.",
    description:
      "Veja sua atividade, desbloqueios e progresso sem perder a sensação de acompanhar uma jornada.",
    metric: "76%",
    metricLabel: "progresso médio",
  },
  {
    id: "notifications",
    eyebrow: "Ritmo",
    title: "Fique por dentro sem sair do fluxo.",
    description:
      "Notificações e atualizações chegam quando precisam, com controles para deixar a experiência do seu jeito.",
    metric: "03",
    metricLabel: "novas atividades",
  },
  {
    id: "profile",
    eyebrow: "Identidade",
    title: "Seu perfil conta a sua história.",
    description:
      "Escolha avatar, capa, posição, coleções e métricas para transformar seu perfil em um espaço realmente seu.",
    metric: "100%",
    metricLabel: "sua personalidade",
  },
];

export const plans: Plan[] = [
  {
    id: "free",
    name: "Essencial",
    description: "O melhor ponto de partida para organizar sua biblioteca.",
    prices: null,
    features: [
      "Biblioteca Steam local",
      "Catálogo e busca de jogos",
      "Favoritos e coleções",
      "Perfil e conquistas",
    ],
    action: "Começar agora",
  },
  {
    id: "premium",
    name: "Premium",
    description: "Mais continuidade para uma biblioteca que nunca para de crescer.",
    prices: {
      monthly: 699,
      quarterly: 1499,
    },
    features: [
      "Tudo do plano Essencial",
      "Sincronização de perfil na nuvem",
      "Backups automáticos",
      "Pontos de restauração",
    ],
    action: "Conhecer Premium",
    highlighted: true,
  },
];

export const faqItems: FaqItem[] = [
  {
    id: "steam",
    question: "O GhostBox funciona com a minha conta Steam?",
    answer:
      "Sim. O GhostBox usa sua conta Steam para organizar sua biblioteca, atividade, conquistas e informações de jogos em uma interface feita para você.",
  },
  {
    id: "profile",
    question: "O que posso personalizar no meu perfil?",
    answer:
      "Você pode ajustar seu nome, avatar, banner, posição da capa, coleções, favoritos e a forma como suas métricas e atividade aparecem.",
  },
  {
    id: "cloud",
    question: "O que o Premium sincroniza?",
    answer:
      "O Premium adiciona sincronização do perfil, backups automáticos e pontos de restauração para manter suas escolhas disponíveis na nuvem.",
  },
  {
    id: "cancel",
    question: "Posso cancelar o Premium quando quiser?",
    answer:
      "Sim. O cancelamento interrompe as próximas renovações; o acesso continua seguindo o período já pago, conforme as condições exibidas no checkout.",
  },
];
