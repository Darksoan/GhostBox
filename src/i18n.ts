export type Language = "pt" | "en";

interface TranslationTree {
  [key: string]: string | TranslationTree;
}

const translations: Record<Language, TranslationTree> = {
  pt: {
    nav: {
      home: "Início",
      catalogue: "Catálogo",
      library: "Biblioteca",
      downloads: "Downloads",
      settings: "Ajustes",
    },
    header: {
      back: "Voltar",
      forward: "Avançar",
      searchPlaceholder: "Buscar jogos",
      searching: "Buscando...",
      searchNoResultsTitle: "Não achou o que queria?",
      searchNoResultsAppIdHint: "Tente adicionar pelo APPID da Steam",
      notifications: "Notificações",
      feedback: "Enviar feedback",
      discord: "Abrir Discord do GhostBox",
    },
    feedback: {
      title: "Enviar feedback",
      subtitle: "conte o que podemos melhorar no GhostBox.",
      messageLabel: "Mensagem",
      placeholder: "Descreva sua sugestão, problema ou ideia...",
      cancel: "Cancelar",
      send: "Enviar",
      sending: "Enviando...",
      successTitle: "Feedback enviado",
      successMessage: "Obrigado. Sua mensagem foi recebida no Discord.",
      errorTitle: "Erro ao enviar",
      errorMessage: "Não foi possível enviar o feedback agora.",
    },
    notifications: {
      title: "Notificações",
      description: "Acompanhe eventos importantes do GhostBox sem sair do app.",
      loading: "Carregando notificações...",
      filters: "Filtros de notificações",
      clear: "Limpar histórico",
      emptyTitle: "Nenhuma notificação por enquanto",
      emptyMessage: "Backups, conquistas, conta, downloads e alertas do sistema aparecerão aqui.",
    },
    downloads: {
      title: "Downloads",
      description: "Acompanhe o progresso dos downloads de jogos iniciados pelo GhostBox.",
      clear: "Limpar concluídos",
      emptyTitle: "Nenhum download por enquanto",
      emptyMessage: "Downloads iniciados pelo modal de um jogo aparecerão aqui.",
      remove: "Remover",
      queuePosition: "Na fila — posição {position}",
      statusDownloading: "Baixando",
      statusCompleted: "Concluído",
      statusError: "Erro",
      remaining: "Restante: {size}",
      totalDownloaded: "{size} baixados",
      failedFiles: "{count} arquivo(s) com falha",
      genericError: "Não foi possível concluir o download.",
      depotOf: "Depot {index} de {total}",
      status: {
        starting: "Iniciando",
        keyResolved: "Chave obtida",
        loadingManifest: "Carregando manifesto",
        manifestLoaded: "Manifesto carregado",
        connectingSteam: "Conectando à Steam",
        steamConnected: "Conectado à Steam",
        cdnReady: "CDN pronta",
        startingDepot: "Iniciando depot",
      },
    },
    loading: {
      catalogue: "Carregando catálogo",
      filters: "Carregando filtros",
      emptyTitle: "Nenhum jogo encontrado",
      emptyQuery: 'Não há resultados para "{term}".',
    },
    catalogue: {
      filters: {
        genres: "Gêneros",
        tags: "Tags",
        developers: "Desenvolvedoras",
        publishers: "Publicadoras",
        years: "Ano",
        clear: "Limpar {count}",
        options: "{count} opções",
        search: "Pesquisar {title}",
        showing: "Mostrando {visible} de {total}. Use a busca para refinar.",
        empty: "Nenhuma opção encontrada",
        label: "Filtros",
        clearAll: "Limpar filtros",
        clearShort: "Limpar",
        selected: "{count} filtro(s)",
      },
    },
    profile: {
      changeBanner: "Mudar capa",
      createCollection: "Criar coleção",
      overview: "Geral",
      unlockedAchievements: "Conquistas",
      libraryGames: "Jogos",
      completionPerGame: "Conclusão por jogo",
      totalPlaytimeLabel: "Tempo total",
      totalPlaytime: "registradas",
      played: "registradas",
      lastPlayed: "jogado pela última vez em",
      of: "de",
      noAchievements: "Sem conquistas",
      currentlyInGame: "Em jogo",
      steamMetrics: "Métricas Steam",
      achievementUnlocked: "Conquista desbloqueada",
      achievementUnlockedOn: "Desbloqueada em {date}",
      favorites: "Favoritos",
      library: "Biblioteca",
      editProfile: "Editar perfil",
      showSteamId: "Mostrar Steam ID",
      hideSteamId: "Ocultar Steam ID",
      copySteamId: "Copiar Steam ID",
      steamIdCopied: "Steam ID copiado",
      sortAria: "Ordenar atividade",
      sort: {
        recent: "Jogados recentemente",
        playtime: "Mais jogados",
        title: "Título (A-Z)",
        achievements: "Mais conquistas",
        perfect: "Jogos 100%",
      },
      noPerfectGames: "Nenhum jogo 100% encontrado",
    },
    achievements: {
      title: "Conquistas",
      pageAria: "Conquistas de {title}",
      progressSummary:
        "{unlocked} de {total} ({percent}%) conquistas alcançadas",
      viewMore: "Ver mais",
      empty: "Este jogo não possui conquistas.",
    },
    metrics: {
      locked: "Faça login para visualizar",
      lockedAchievements: "Faça login para ver as conquistas",
      lockedAria:
        "Conquistas e tempo de jogo bloqueados. Faça login para visualizar.",
    },
    home: {
      pageAria: "Jogos recomendados e categorias da página inicial",
      categoriesAria: "Categorias da página inicial",
      recommended: "Recomendados",
      featuredGames: "Bem avaliados",
    },
    sidebar: {
      collections: "Coleções",
      restartSteam: "Reiniciar Steam",
      noGames: "Nenhum jogo",
    },
    subscription: {
      title: "Desbloqueie sincronização em nuvem",
      actions: {
        subscribe: "Assinar",
      },
      discordLink: {
        title: "Vincular Steam ao Discord",
        description:
          "Conecte o Discord à conta Steam usada no GhostBox para receber Premium no servidor futuramente.",
        signInSteam: "Entrar com Steam",
        link: "Vincular Discord",
        relink: "Atualizar vínculo",
        linked: "Vinculado",
        linkedAs: "Discord vinculado como {name}.",
        openedTitle: "Discord aberto",
        openedMessage:
          "Conclua a autorização no navegador para ligar sua Steam ao Discord.",
      },
      benefits: {
        backupSync: "Backups e sincronização",
        localAndCloudBackups: "Backup em nuvem automático",
        sync: "Sincronização entre PCs",
        automaticRestore: "Restauração automática",
      },
      steps: {
        title: "Como ativar a assinatura",
        choose: "Escolha o plano que combina com seu uso.",
        checkout: "Finalize o pagamento no checkout seguro.",
        sync: "Entre na conta Steam e mantenha seus saves sincronizados.",
      },
      details: {
        payments: {
          title: "Pagamentos",
          card: "Pagamentos e reembolsos aprovados são processados pela Stripe.",
          methods:
            "Métodos, impostos e detalhes de cobrança são exibidos no checkout Stripe antes da confirmação.",
          security:
            "O GhostBox não armazena número completo de cartão nem credenciais de pagamento.",
        },
        billing: {
          title: "Cobrança e acesso",
          renewal:
            "A assinatura é recorrente e os termos finais aparecem no checkout Stripe antes do pagamento.",
          activation:
            "O Premium é liberado para a conta Steam usada no app após a confirmação do pagamento.",
          receipt:
            "Comprovantes, status da assinatura e revisões de reembolso ficam vinculados ao pagamento na Stripe.",
        },
        refunds: {
          title: "Reembolso",
          window:
            "Solicitações devem ser enviadas em até 7 dias do pagamento original sempre que possível.",
          prorated:
            "Reembolsos não são automáticos; cada pedido é revisado por status da conta, pagamento e motivo.",
          abuse:
            "Reembolsos parciais do período não são garantidos, exceto quando exigidos por lei ou por falha técnica confirmada.",
        },
        cancel: {
          title: "Cancelamento",
          anytime:
            "Você pode cancelar a assinatura para impedir renovações futuras.",
          access:
            "Ao cancelar, o acesso Premium continua ativo até o fim do período já pago.",
          data: "Cancelar não reembolsa automaticamente cobranças anteriores nem o período atual.",
        },
      },
      policy: {
        title: "Resumo importante",
        description:
          "A assinatura cobre recursos Premium opcionais do GhostBox, como backups automáticos, pontos de restauração e sincronização em nuvem. Para suporte ou revisão de reembolso, envie a conta, data da cobrança e descrição do problema para ghostbox@mail.com.",
      },
      plans: {
        free: {
          title: "Free",
          price: "R$ 0",
          cadence: "para sempre",
          action: "Atual",
        },
        monthly: {
          title: "Mensal",
          cadence: "por mês",
        },
        quarterly: {
          title: "Trimestral",
          cadence: "a cada 3 meses",
          savingsLabel: "Economize",
          savingsValue: "28%",
        },
      },
    },
    settings: {
      tabs: {
        general: {
          label: "Geral",
        },
        performance: {
          label: "Desempenho",
        },
        library: {
          label: "Biblioteca",
        },
        subscription: {
          label: "Assinatura",
        },
        notifications: {
          label: "Notificações",
        },
        download: {
          label: "APIs",
        },
      },
      general: {
        language: {
          label: "Idioma",
          description: "Escolha o idioma da interface do GhostBox.",
          portuguese: "Português",
          english: "English",
        },
        initialPage: {
          label: "Página inicial",
          description: "Escolha a tela aberta ao iniciar o GhostBox.",
          home: "Início",
          profile: "Perfil",
          catalogue: "Catálogo",
        },
        openAtLogin: {
          label: "Iniciar com Windows",
          description:
            "Abre o GhostBox automaticamente quando o Windows iniciar.",
        },
        startMinimized: {
          label: "Iniciar minimizado",
          description: "Quando ativado, o app abre direto na barra de tarefas.",
        },
        minimizeToTray: {
          label: "Minimizar ao fechar",
          description: "Ao fechar a janela, o app continua rodando minimizado.",
        },
      },
      performance: {
        reduceAllAnimations: {
          label: "Animações da interface",
          description: "Anima cards, telas e transições da interface.",
        },
        disableBackdropBlur: {
          label: "Desfoque de fundo",
          description: "Desfoca painéis translúcidos da interface.",
        },
        trailerQuality: {
          label: "Exibir trailers",
          description: "Mostra trailers na galeria de detalhes do jogo.",
        },
        trailerAutoplay: {
          label: "Reproduzir trailers automaticamente",
          description: "Reproduz o trailer sem som e em loop.",
        },
        imagePreloadConcurrency: {
          label: "Pré-carregamento de imagens",
          description: "Quantidade de imagens carregadas com antecedência.",
          low: "Baixo (2)",
          medium: "Padrão (4)",
          high: "Alto (6)",
        },
        disablePageKeepAlive: {
          label: "Manter páginas em memória",
          description: "Mantém páginas visitadas na memória para voltar mais rápido.",
        },
      },
      library: {
        steamPath: {
          label: "Pasta da Steam",
          description:
            "Caminho usado para localizar jogos instalados pelo LuaTools.",
        },
      },
      notifications: {
        inAppToasts: {
          label: "Toasts dentro do app",
          description:
            "Mostra avisos pequenos enquanto a janela do GhostBox está aberta.",
        },
        inAppSuccessToasts: {
          label: "Toasts de sucesso",
          description:
            "Permite avisos positivos, como backup concluído e ajustes salvos.",
        },
        inAppErrorToasts: {
          label: "Toasts de erro",
          description: "Permite avisos de falha, validação ou atenção.",
        },
      },
      download: {
        morrenusApiKey: {
          label: "HubCap's Key",
          description:
            "Chave usada para habilitar fontes HubCap's no download de jogos.",
          placeholder: "Cole sua API key aqui...",
          openLink: "Abrir link da HubCap's Key",
          saveKey: "Salvar chave",
        },
        accountStatus: {
          missingKey:
            "Adicione uma API key para consultar o status da conta HubCap's.",
          defaultError: "Falha ao consultar status da conta.",
          errorTitle: "Não foi possível validar a conta",
          retry: "Tentar novamente",
          dailyUsage: "Uso diário",
          planLimit: "Limite do plano",
          customLimit: "Limite custom",
          expiresAt: "Expira em",
        },
        sources: {
          title: "Outras APIs de download",
          auto: "Autoconfigurada",
          openDiscord: "Abrir Discord de {source}",
        },
      },
    },
  },
  en: {
    nav: {
      home: "Home",
      catalogue: "Catalogue",
      library: "Library",
      downloads: "Downloads",
      settings: "Settings",
    },
    header: {
      back: "Back",
      forward: "Forward",
      searchPlaceholder: "Search games",
      searching: "Searching...",
      searchNoResultsTitle: "Didn't find what you were looking for?",
      searchNoResultsAppIdHint: "Try adding by Steam APPID",
      notifications: "Notifications",
      feedback: "Send feedback",
      discord: "Open GhostBox Discord",
    },
    feedback: {
      title: "Send feedback",
      subtitle: "tell us what we can improve in GhostBox.",
      messageLabel: "Message",
      placeholder: "Describe your suggestion, issue, or idea...",
      cancel: "Cancel",
      send: "Send",
      sending: "Sending...",
      successTitle: "Feedback sent",
      successMessage: "Thanks. Your message was received in Discord.",
      errorTitle: "Could not send",
      errorMessage: "Feedback could not be sent right now.",
    },
    notifications: {
      title: "Notifications",
      description: "Track important GhostBox events without leaving the app.",
      loading: "Loading notifications...",
      filters: "Notification filters",
      clear: "Clear history",
      emptyTitle: "No notifications yet",
      emptyMessage: "Backups, achievements, account, downloads, and system alerts will appear here.",
    },
    downloads: {
      title: "Downloads",
      description: "Track the progress of game downloads started from GhostBox.",
      clear: "Clear completed",
      emptyTitle: "No downloads yet",
      emptyMessage: "Downloads started from a game's modal will appear here.",
      remove: "Remove",
      queuePosition: "Queued — position {position}",
      statusDownloading: "Downloading",
      statusCompleted: "Completed",
      statusError: "Error",
      remaining: "Remaining: {size}",
      totalDownloaded: "{size} downloaded",
      failedFiles: "{count} file(s) failed",
      genericError: "Could not complete the download.",
      depotOf: "Depot {index} of {total}",
      status: {
        starting: "Starting",
        keyResolved: "Key resolved",
        loadingManifest: "Loading manifest",
        manifestLoaded: "Manifest loaded",
        connectingSteam: "Connecting to Steam",
        steamConnected: "Connected to Steam",
        cdnReady: "CDN ready",
        startingDepot: "Starting depot",
      },
    },
    loading: {
      catalogue: "Loading catalogue",
      filters: "Loading filters",
      emptyTitle: "No games found",
      emptyQuery: 'No results for "{term}".',
    },
    catalogue: {
      filters: {
        genres: "Genres",
        tags: "Tags",
        developers: "Developers",
        publishers: "Publishers",
        years: "Year",
        clear: "Clear {count}",
        options: "{count} options",
        search: "Search {title}",
        showing: "Showing {visible} of {total}. Use search to refine.",
        empty: "No options found",
        label: "Filters",
        clearAll: "Clear filters",
        clearShort: "Clear",
        selected: "{count} filter(s)",
      },
    },
    profile: {
      changeBanner: "Change banner",
      createCollection: "Create collection",
      overview: "Overview",
      unlockedAchievements: "Achievements",
      libraryGames: "Games",
      completionPerGame: "Completion per game",
      totalPlaytimeLabel: "Total playtime",
      totalPlaytime: "recorded",
      played: "recorded",
      lastPlayed: "last played on",
      of: "of",
      noAchievements: "No achievements",
      currentlyInGame: "Currently In-Game",
      steamMetrics: "Steam metrics",
      achievementUnlocked: "Achievement unlocked",
      achievementUnlockedOn: "Unlocked {date}",
      favorites: "Favorites",
      library: "Library",
      editProfile: "Edit profile",
      showSteamId: "Show Steam ID",
      hideSteamId: "Hide Steam ID",
      copySteamId: "Copy Steam ID",
      steamIdCopied: "Steam ID copied",
      sortAria: "Sort activity",
      sort: {
        recent: "Recently played",
        playtime: "Most played",
        title: "Title (A-Z)",
        achievements: "Most achievements",
        perfect: "100% games",
      },
      noPerfectGames: "No 100% games found",
    },
    achievements: {
      title: "Achievements",
      pageAria: "Achievements for {title}",
      progressSummary: "{unlocked} of {total} ({percent}%) achievements earned",
      viewMore: "View more",
      empty: "This game has no achievements.",
    },
    metrics: {
      locked: "Sign in to view",
      lockedAchievements: "Sign in to view achievements",
      lockedAria:
        "Achievements and playtime locked. Sign in to view.",
    },
    home: {
      pageAria: "Recommended games and home categories",
      categoriesAria: "Home categories",
      recommended: "Recommended",
      featuredGames: "Top rated",
    },
    sidebar: {
      collections: "Collections",
      restartSteam: "Restart Steam",
      noGames: "No games",
    },
    subscription: {
      title: "Unlock cloud sync",
      actions: {
        subscribe: "Subscribe",
      },
      discordLink: {
        title: "Link Steam to Discord",
        description:
          "Connect Discord to the Steam account used in GhostBox so Premium can be granted in the server later.",
        signInSteam: "Sign in with Steam",
        link: "Link Discord",
        relink: "Update link",
        linked: "Linked",
        linkedAs: "Discord linked as {name}.",
        openedTitle: "Discord opened",
        openedMessage:
          "Finish the browser authorization to link Steam with Discord.",
      },
      benefits: {
        backupSync: "Backups and sync",
        localAndCloudBackups: "Automatic cloud backup",
        sync: "Sync across PCs",
        automaticRestore: "Automatic restore",
      },
      steps: {
        title: "How to activate the subscription",
        choose: "Choose the plan that fits your usage.",
        checkout: "Complete payment in the secure checkout.",
        sync: "Sign in with Steam and keep your saves synced.",
      },
      details: {
        payments: {
          title: "Payments",
          card: "Payments and approved refunds are processed by Stripe.",
          methods:
            "Payment methods, taxes, and billing details are shown in Stripe checkout before confirmation.",
          security:
            "GhostBox does not store full card numbers or payment credentials.",
        },
        billing: {
          title: "Billing and access",
          renewal:
            "The subscription is recurring and final terms appear in Stripe checkout before payment.",
          activation:
            "Premium is unlocked for the Steam account used in the app after payment confirmation.",
          receipt:
            "Receipts, subscription status, and refund reviews are linked to the Stripe payment.",
        },
        refunds: {
          title: "Refunds",
          window:
            "Requests should be sent within 7 days of the original payment whenever possible.",
          prorated:
            "Refunds are not automatic; each request is reviewed by account status, payment record, and reason.",
          abuse:
            "Partial-period refunds are not guaranteed unless required by law or caused by a confirmed technical issue.",
        },
        cancel: {
          title: "Cancellation",
          anytime: "You can cancel the subscription to stop future renewals.",
          access:
            "After cancellation, Premium access remains active until the end of the paid period.",
          data: "Cancellation does not automatically refund previous charges or the current billing period.",
        },
      },
      policy: {
        title: "Important summary",
        description:
          "The subscription covers optional GhostBox Premium features such as automatic backups, restore points, and cloud sync. For support or refund review, send the account, billing date, and issue description to ghostbox@mail.com.",
      },
      plans: {
        free: {
          title: "Free",
          price: "R$ 0",
          cadence: "forever",
          action: "Current",
        },
        monthly: {
          title: "Monthly",
          cadence: "per month",
        },
        quarterly: {
          title: "Quarterly",
          cadence: "every 3 months",
          savingsLabel: "Save",
          savingsValue: "28%",
        },
      },
    },
    settings: {
      tabs: {
        general: {
          label: "General",
        },
        performance: {
          label: "Performance",
        },
        library: {
          label: "Library",
        },
        subscription: {
          label: "Subscription",
        },
        notifications: {
          label: "Notifications",
        },
        download: {
          label: "APIs",
        },
      },
      general: {
        language: {
          label: "Language",
          description: "Choose the GhostBox interface language.",
          portuguese: "Portuguese",
          english: "English",
        },
        initialPage: {
          label: "Home page",
          description: "Choose the screen opened when GhostBox starts.",
          home: "Home",
          profile: "Profile",
          catalogue: "Catalogue",
        },
        openAtLogin: {
          label: "Start with Windows",
          description: "Opens GhostBox automatically when Windows starts.",
        },
        startMinimized: {
          label: "Start minimized",
          description: "When enabled, the app opens straight to the taskbar.",
        },
        minimizeToTray: {
          label: "Minimize instead of close",
          description:
            "When closing the window, the app keeps running minimized.",
        },
      },
      performance: {
        reduceAllAnimations: {
          label: "Interface animations",
          description: "Animates cards, screens, and interface transitions.",
        },
        disableBackdropBlur: {
          label: "Background blur",
          description: "Blurs translucent panels in the interface.",
        },
        trailerQuality: {
          label: "Show trailers",
          description: "Shows trailers in the game details gallery.",
        },
        trailerAutoplay: {
          label: "Play trailers automatically",
          description: "Plays the trailer muted and looping.",
        },
        imagePreloadConcurrency: {
          label: "Image preloading",
          description: "How many images load ahead of time at once.",
          low: "Low (2)",
          medium: "Default (4)",
          high: "High (6)",
        },
        disablePageKeepAlive: {
          label: "Keep pages in memory",
          description: "Keeps visited pages in memory so returning is faster.",
        },
      },
      library: {
        steamPath: {
          label: "Steam folder",
          description: "Path used to find games installed via LuaTools.",
        },
      },
      notifications: {
        inAppToasts: {
          label: "In-app toasts",
          description: "Shows small alerts while the GhostBox window is open.",
        },
        inAppSuccessToasts: {
          label: "Success toasts",
          description:
            "Allows positive alerts, such as completed backups and saved settings.",
        },
        inAppErrorToasts: {
          label: "Error toasts",
          description: "Allows failure, validation, or attention alerts.",
        },
      },
      download: {
        morrenusApiKey: {
          label: "HubCap's Key",
          description:
            "Key used to enable HubCap's sources when downloading games.",
          placeholder: "Paste your API key here...",
          openLink: "Open HubCap's Key link",
          saveKey: "Save key",
        },
        accountStatus: {
          missingKey: "Add an API key to check the HubCap's account status.",
          defaultError: "Failed to check account status.",
          errorTitle: "Could not validate the account",
          retry: "Try again",
          dailyUsage: "Daily usage",
          planLimit: "Plan limit",
          customLimit: "Custom limit",
          expiresAt: "Expires on",
        },
        sources: {
          title: "Other download APIs",
          auto: "Auto-configured",
          openDiscord: "Open {source} Discord",
        },
      },
    },
  },
};

function getValue(tree: TranslationTree, path: string): string | undefined {
  return path
    .split(".")
    .reduce<string | TranslationTree | undefined>((current, part) => {
      if (!current || typeof current === "string") return undefined;
      return current[part];
    }, tree) as string | undefined;
}

export function translate(
  language: Language,
  key: string,
  params?: Record<string, string | number>,
) {
  const raw =
    getValue(translations[language], key) ??
    getValue(translations.pt, key) ??
    key;
  if (!params) return raw;

  return Object.entries(params).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
    raw,
  );
}
