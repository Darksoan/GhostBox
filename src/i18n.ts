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
      backup: "Backup",
      favorites: "Favoritos",
      settings: "Ajustes",
      profile: "Perfil",
      notifications: "Notificações",
      discord: "Abrir Discord do GhostBox",
    },
    header: {
      back: "Voltar",
      forward: "Avançar",
      searchPlaceholder: "Buscar jogos",
      searching: "Buscando...",
      home: "Início",
      catalogue: "Catálogo",
      library: "Biblioteca",
      backup: "Backup",
      favorites: "Favoritos",
      settings: "Ajustes",
      profile: "Perfil",
      notifications: "Notificações",
      feedback: "Enviar feedback",
    },
    feedback: {
      title: "Enviar feedback",
      subtitle: "conte o que podemos melhorar no GhostBox.",
      messageLabel: "Mensagem",
      placeholder: "Descreva sua sugestão, problema ou ideia...",
      characterCount: "{count} caracteres restantes",
      cancel: "Cancelar",
      send: "Enviar",
      sending: "Enviando...",
      successTitle: "Feedback enviado",
      successMessage: "Obrigado. Sua mensagem foi recebida no Discord.",
      errorTitle: "Erro ao enviar",
      errorMessage: "Não foi possível enviar o feedback agora.",
    },
    notifications: {
      groupTitle: "Jogos adicionados",
      loading: "Carregando jogos adicionados recentemente...",
      emptyMessage: "Nenhum jogo recente foi encontrado no banco de dados.",
    },
    backup: {
      eyebrow: "Backup em nuvem",
      title: "Backups em nuvem",
      description: "Lista vertical dos jogos com backups salvos na nuvem.",
      refresh: "Atualizar",
      loading: "Carregando backups em nuvem...",
      empty: "Nenhum backup encontrado",
      emptyTitle: "Nenhum backup encontrado",
      emptyMessage: "Os backups em nuvem dos seus jogos aparecerão aqui.",
      listAria: "Jogos com backup em nuvem disponível",
    },
    loading: {
      catalogue: "Carregando catálogo",
      filters: "Carregando filtros",
      emptyTitle: "Nenhum jogo encontrado",
      emptyMessage: "A base de dados não retornou jogos para esta tela.",
      emptyQuery: 'Não há resultados para "{term}".',
    },
    catalogue: {
      sort: {
        title: "Ordenar",
        featured: "Bem avaliados",
        recentlyAdded: "Recentemente adicionados",
      },
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
      emptyTitle: "Perfil indisponível",
      emptyMessage: "Entre com a sua conta Steam para visualizar esta aba.",
      changeBanner: "Mudar capa",
      changeBannerShort: "Mudar capa",
      createCollection: "Criar coleção",
      addToCollection: "Adicionar à coleção",
      removeFromCollection: "Remover da coleção",
      gameDetails: "Detalhes do jogo",
      removeFromLibrary: "Remover da biblioteca",
      overview: "Geral",
      achievementShowcase: "Conquistas recentes",
      unlockedAchievements: "Conquistas",
      libraryGames: "Jogos",
      perfectGames: "Jogos perfeitos",
      averageAchievements: "Média de conquistas por jogo",
      completionPerGame: "Conclusão por jogo",
      overallProgress: "Progresso geral",
      averageCompletion: "conclusão média",
      totalPlaytimeLabel: "Tempo total",
      topGames: "Jogos mais jogados",
      mostPlayed: "Mais jogados",
      playersUnlocked: "dos jogadores",
      percentUnavailable: "Percentual indisponível",
      totalPlaytime: "registradas",
      played: "registradas",
      lastPlayed: "jogado pela última vez em",
      of: "de",
      noAchievements: "Sem conquistas",
      recentAchievements: "Conquistas recentes",
      recentActivity: "Atividade recente",
      recentActivityHours: "{hours} nas 2 últimas semanas",
      currentlyInGame: "Em jogo",
      steamMetrics: "Métricas Steam",
      steamMetricsLoading: "Sincronizando métricas da Steam...",
      steamPrivateProfile:
        "Perfil Steam privado. Métricas, conquistas recentes e biblioteca remota podem ficar indisponíveis.",
      steamScanProgress: "Escaneando conquistas: {scanned} jogos lidos, {pending} pendentes.",
      achievementUnlocked: "Conquista desbloqueada",
      achievementLocked: "Conquista bloqueada",
      achievementUnlockedOn: "Desbloqueada em {date}",
      favorites: "Favoritos",
      library: "Biblioteca",
      editProfile: "Editar perfil",
      showSteamId: "Mostrar Steam ID",
      hideSteamId: "Ocultar Steam ID",
      copySteamId: "Copiar Steam ID",
      steamIdCopied: "Steam ID copiado",
      showDiscordId: "Mostrar Discord ID",
      hideDiscordId: "Ocultar Discord ID",
      sortAria: "Ordenar atividade",
      sort: {
        recent: "Jogados recentemente",
        playtime: "Mais jogados",
        title: "Título (A-Z)",
        achievements: "Mais conquistas",
      },
    },
    achievements: {
      title: "Conquistas",
      pageAria: "Conquistas de {title}",
      personalAchievements: "Conquistas pessoais",
      progressSummary:
        "{unlocked} de {total} ({percent}%) conquistas alcançadas",
      viewMore: "Ver mais",
      globalPercent: "{percent} dos jogadores",
      empty: "Este jogo não possui conquistas.",
    },
    home: {
      pageAria: "Jogos recomendados e categorias da página inicial",
      categoriesAria: "Categorias da página inicial",
      recommended: "Recomendados",
      featuredGames: "Bem avaliados",
      recentSection: "Último jogado",
      recentSubtitle: "Jogado recentemente",
    },
    sidebar: {
      collections: "Coleções",
      restartSteam: "Reiniciar Steam",
      noGames: "Nenhum jogo",
    },
    subscription: {
      eyebrow: "Ghost Premium",
      title: "Desbloqueie sincronização em nuvem",
      description:
        "Backup automático, restauração rápida e progresso sincronizado entre PCs.",
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
      checkout: {
        title: "Checkout seguro via Stripe",
        label: "Checkout seguro via",
        provider: "Stripe",
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
          badge: "Recomendado",
          savingsLabel: "Economize",
          savingsValue: "28%",
        },
      },
    },
    settings: {
      tabs: {
        general: {
          label: "Geral",
          eyebrow: "Base do app",
          title: "Comportamento principal",
          description:
            "Preferências globais para iniciar, navegar e organizar a experiência do GhostBox.",
        },
        performance: {
          label: "Desempenho",
          eyebrow: "Fluidez",
          title: "Otimização visual",
          description:
            "Ajuste animações e efeitos para melhorar a responsividade do app.",
        },
        library: {
          label: "Biblioteca",
          eyebrow: "Jogos",
          title: "Steam e LuaTools",
          description:
            "Caminho da Steam usado para localizar jogos adicionados pelo LuaTools.",
        },
        backups: {
          label: "Backups",
          eyebrow: "Nuvem",
          title: "Backups em nuvem",
          description:
            "Backups automáticos em nuvem disponíveis para contas Premium.",
        },
        subscription: {
          label: "Assinatura",
          eyebrow: "Premium",
          title: "Status da assinatura",
          description:
            "Veja seu plano, pagamentos, expiração e backups em nuvem.",
        },
        notifications: {
          label: "Notificações",
          eyebrow: "Avisos",
          title: "Toasts e sobreposição",
          description:
            "Escolha quais avisos aparecem dentro do app e sobre outros programas.",
        },
        download: {
          label: "APIs",
          eyebrow: "APIs de jogos",
          title: "Configuração do HubCap's",
          description:
            "Opcional. Cole sua chave do HubCap's para habilitar fontes premium no download de jogos.",
        },
      },
      general: {
        language: {
          label: "Idioma",
          description: "Escolha o idioma da interface do GhostBox.",
          portuguese: "Português",
          english: "English",
        },
        showSteamGames: {
          label: "Mostrar jogos da Steam",
          description:
            "Exibe toda a biblioteca detectada da Steam (não apenas jogos adicionados pelo LuaTools).",
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
        disableTabAnimations: {
          label: "Remover animações de troca de abas",
          description:
            "Desativa animações ao navegar entre páginas e seções do app.",
        },
        reduceAllAnimations: {
          label: "Desativar todas as animações",
          description:
            "Remove animações, pulsos e transições visuais pesadas em todo o app.",
        },
        disableBackdropBlur: {
          label: "Desativar blur/glass",
          description:
            "Troca efeitos de vidro por fundos sólidos para reduzir custo de renderização.",
        },
        disableExplorePan: {
          label: "Desativar pan do Explore",
          description:
            "Pausa o movimento automático das capas nos cards de exploração da tela inicial.",
        },
        trailerQuality: {
          label: "Qualidade de trailer",
          description:
            "Escolhe a fonte de vídeo preferida para trailers dentro dos detalhes do jogo.",
          high: "Alta qualidade",
          low: "Economia de dados",
        },
        trailerAutoplay: {
          label: "Autoplay de trailer",
          description:
            "Reproduz automaticamente o trailer selecionado na galeria do jogo.",
        },
        preferLowResCovers: {
          label: "Capas em resolução menor",
          description:
            "Prioriza capas 1x da Steam antes das versões 2x para poupar memória e rede.",
        },
        imagePreloadConcurrency: {
          label: "Preload de imagens",
          description:
            "Define quantas imagens podem ser pré-carregadas ao mesmo tempo.",
          low: "Leve (2)",
          medium: "Equilibrado (4)",
          high: "Rápido (6)",
        },
        disablePageKeepAlive: {
          label: "Desativar keep-alive de páginas",
          description:
            "Mantém apenas a página atual montada para reduzir uso de memória.",
        },
      },
      library: {
        steamPath: {
          label: "Pasta da Steam",
          description:
            "Caminho usado para localizar jogos instalados pelo LuaTools.",
        },
        showSteamGames: {
          label: "Mostrar jogos da Steam",
          description:
            "Exibe jogos da conta Steam na biblioteca, incluindo jogos não instalados quando disponíveis.",
        },
      },
      backups: {
        outputPath: {
          label: "Backups em nuvem",
          description: "Backups são salvos na nuvem para contas Premium.",
        },
        automaticLibrary: {
          label: "Backup automático em nuvem",
          description:
            "Salva backups na nuvem ao fechar jogos, para contas Premium.",
        },
      },
      notifications: {
        test: {
          label: "Teste de notificação",
          description:
            "Exibe uma notificação de exemplo sobre os outros programas.",
          button: "Testar notificação",
        },
        testAchievement: {
          label: "Teste de conquista",
          description:
            "Exibe uma conquista de exemplo usando ícone de conquista.",
          button: "Testar conquista",
        },
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
        desktop: {
          label: "Notificações sobre programas",
          description:
            "Mostra cards flutuantes por cima de outros aplicativos.",
        },
        achievements: {
          label: "Conquistas desbloqueadas",
          description:
            "Avisa quando novas conquistas locais forem detectadas ao fechar um jogo.",
        },
        backupRestore: {
          label: "Notificações de backup e restauração",
          description:
            "Avisa sobre backups e restaurações concluídos ou com falha.",
        },
        backupSuccess: {
          label: "Backups concluídos",
          description: "Avisa quando um backup terminar com sucesso.",
        },
        backupError: {
          label: "Falhas em backup",
          description: "Avisa quando um backup não puder ser criado.",
        },
        restoreSuccess: {
          label: "Restaurações concluídas",
          description: "Avisa quando um save for restaurado com sucesso.",
        },
        restoreError: {
          label: "Falhas em restauração",
          description: "Avisa quando um save não puder ser restaurado.",
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
          loading: "Consultando status da conta...",
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
          description:
            "Essas fontes são autoconfiguradas pelo manifesto do LuaTools e usadas como fallback quando disponíveis.",
          auto: "Autoconfigurada",
          premium: "Chave opcional",
          morrenus:
            "Fonte premium do Hubcap's Manifest habilitada quando uma API key válida é informada.",
          manifest: "Fonte carregada pelo manifesto remoto do LuaTools.",
          fallback: "Fonte padrão já embutida no app como fallback.",
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
      backup: "Backup",
      favorites: "Favorites",
      settings: "Settings",
      profile: "Profile",
      notifications: "Notifications",
      discord: "Open GhostBox Discord",
    },
    header: {
      back: "Back",
      forward: "Forward",
      searchPlaceholder: "Search games",
      searching: "Searching...",
      home: "Home",
      catalogue: "Catalogue",
      library: "Library",
      backup: "Backup",
      favorites: "Favorites",
      settings: "Settings",
      profile: "Profile",
      notifications: "Notifications",
      feedback: "Send feedback",
    },
    feedback: {
      title: "Send feedback",
      subtitle: "tell us what we can improve in GhostBox.",
      messageLabel: "Message",
      placeholder: "Describe your suggestion, issue, or idea...",
      characterCount: "{count} characters remaining",
      cancel: "Cancel",
      send: "Send",
      sending: "Sending...",
      successTitle: "Feedback sent",
      successMessage: "Thanks. Your message was received in Discord.",
      errorTitle: "Could not send",
      errorMessage: "Feedback could not be sent right now.",
    },
    notifications: {
      groupTitle: "Games added",
      loading: "Loading recently added games...",
      emptyMessage: "No recently added games were found in the database.",
    },
    backup: {
      eyebrow: "Cloud backup",
      title: "Cloud backups",
      description: "Vertical list of games with backups saved in the cloud.",
      refresh: "Refresh",
      loading: "Loading cloud backups...",
      empty: "No backups found",
      emptyTitle: "No backups found",
      emptyMessage: "Cloud backups for your games will appear here.",
      listAria: "Games with available cloud backup",
    },
    loading: {
      catalogue: "Loading catalogue",
      filters: "Loading filters",
      emptyTitle: "No games found",
      emptyMessage: "The database returned no games for this view.",
      emptyQuery: 'No results for "{term}".',
    },
    catalogue: {
      sort: {
        title: "Sort",
        featured: "Top rated",
        recentlyAdded: "Recently added",
      },
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
      emptyTitle: "Profile unavailable",
      emptyMessage: "Sign in to Steam to view this tab.",
      changeBanner: "Change banner",
      changeBannerShort: "Change banner",
      createCollection: "Create collection",
      addToCollection: "Add to collection",
      removeFromCollection: "Remove from collection",
      gameDetails: "Game details",
      removeFromLibrary: "Remove from library",
      overview: "Overview",
      achievementShowcase: "Recent achievements",
      unlockedAchievements: "Achievements",
      libraryGames: "Games",
      perfectGames: "Perfect games",
      averageAchievements: "Average achievements per game",
      completionPerGame: "Completion per game",
      overallProgress: "Overall progress",
      averageCompletion: "average completion",
      totalPlaytimeLabel: "Total playtime",
      topGames: "Top games",
      mostPlayed: "Most played",
      playersUnlocked: "of players",
      percentUnavailable: "Percentage unavailable",
      totalPlaytime: "recorded",
      played: "recorded",
      lastPlayed: "last played on",
      of: "of",
      noAchievements: "No achievements",
      recentAchievements: "Recent achievements",
      recentActivity: "Recent activity",
      recentActivityHours: "{hours} in the last 2 weeks",
      currentlyInGame: "Currently In-Game",
      steamMetrics: "Steam metrics",
      steamMetricsLoading: "Syncing Steam metrics...",
      steamPrivateProfile:
        "Steam profile is private. Metrics, recent achievements, and remote library may be unavailable.",
      steamScanProgress: "Scanning achievements: {scanned} games read, {pending} pending.",
      achievementUnlocked: "Achievement unlocked",
      achievementLocked: "Achievement locked",
      achievementUnlockedOn: "Unlocked {date}",
      favorites: "Favorites",
      library: "Library",
      editProfile: "Edit profile",
      showSteamId: "Show Steam ID",
      hideSteamId: "Hide Steam ID",
      copySteamId: "Copy Steam ID",
      steamIdCopied: "Steam ID copied",
      showDiscordId: "Show Discord ID",
      hideDiscordId: "Hide Discord ID",
      sortAria: "Sort activity",
      sort: {
        recent: "Recently played",
        playtime: "Most played",
        title: "Title (A-Z)",
        achievements: "Most achievements",
      },
    },
    achievements: {
      title: "Achievements",
      pageAria: "Achievements for {title}",
      personalAchievements: "Personal achievements",
      progressSummary: "{unlocked} of {total} ({percent}%) achievements earned",
      viewMore: "View more",
      globalPercent: "{percent} of players",
      empty: "This game has no achievements.",
    },
    home: {
      pageAria: "Recommended games and home categories",
      categoriesAria: "Home categories",
      recommended: "Recommended",
      featuredGames: "Top rated",
      recentSection: "Last played",
      recentSubtitle: "Recently played",
    },
    sidebar: {
      collections: "Collections",
      restartSteam: "Restart Steam",
      noGames: "No games",
    },
    subscription: {
      eyebrow: "Ghost Premium",
      title: "Unlock cloud sync",
      description:
        "Automatic backup, fast restore, and progress synced across PCs.",
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
      checkout: {
        title: "Secure checkout via Stripe",
        label: "Secure checkout via",
        provider: "Stripe",
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
          badge: "Recommended",
          savingsLabel: "Save",
          savingsValue: "28%",
        },
      },
    },
    settings: {
      tabs: {
        general: {
          label: "General",
          eyebrow: "App base",
          title: "Main behavior",
          description:
            "Global preferences for launch, navigation, and the GhostBox experience.",
        },
        performance: {
          label: "Performance",
          eyebrow: "Smoothness",
          title: "Visual optimization",
          description:
            "Tune animations and effects to improve app responsiveness.",
        },
        library: {
          label: "Library",
          eyebrow: "Games",
          title: "Steam and LuaTools",
          description: "Steam path used to find games added by LuaTools.",
        },
        backups: {
          label: "Backups",
          eyebrow: "Cloud",
          title: "Cloud backups",
          description:
            "Automatic cloud backups available for Premium accounts.",
        },
        subscription: {
          label: "Subscription",
          eyebrow: "Premium",
          title: "Subscription status",
          description:
            "Review your plan, payments, expiration, and cloud backups.",
        },
        notifications: {
          label: "Notifications",
          eyebrow: "Alerts",
          title: "Toasts and overlay",
          description:
            "Choose which alerts appear inside the app and over other programs.",
        },
        download: {
          label: "APIs",
          eyebrow: "Game APIs",
          title: "HubCap's configuration",
          description:
            "Optional. Paste your HubCap's key to enable premium sources when downloading games.",
        },
      },
      general: {
        language: {
          label: "Language",
          description: "Choose the GhostBox interface language.",
          portuguese: "Portuguese",
          english: "English",
        },
        showSteamGames: {
          label: "Show Steam games",
          description:
            "Shows the full detected Steam library (not only LuaTools-added games).",
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
        disableTabAnimations: {
          label: "Remove tab switch animations",
          description:
            "Disables animations when navigating between pages and sections.",
        },
        reduceAllAnimations: {
          label: "Disable all animations",
          description:
            "Removes animations, pulses, and heavier visual transitions across the app.",
        },
        disableBackdropBlur: {
          label: "Disable blur/glass",
          description:
            "Replaces glass effects with solid surfaces to reduce rendering cost.",
        },
        disableExplorePan: {
          label: "Disable Explore pan",
          description:
            "Pauses automatic cover movement in the home Explore cards.",
        },
        trailerQuality: {
          label: "Trailer quality",
          description:
            "Chooses the preferred video source for trailers in game details.",
          high: "High quality",
          low: "Data saver",
        },
        trailerAutoplay: {
          label: "Trailer autoplay",
          description:
            "Automatically plays the selected trailer in the game gallery.",
        },
        preferLowResCovers: {
          label: "Lower-resolution covers",
          description:
            "Prioritizes Steam 1x covers before 2x versions to save memory and network.",
        },
        imagePreloadConcurrency: {
          label: "Image preload",
          description:
            "Sets how many images can be preloaded at the same time.",
          low: "Light (2)",
          medium: "Balanced (4)",
          high: "Fast (6)",
        },
        disablePageKeepAlive: {
          label: "Disable page keep-alive",
          description:
            "Keeps only the current page mounted to reduce memory usage.",
        },
      },
      library: {
        steamPath: {
          label: "Steam folder",
          description: "Path used to find games installed via LuaTools.",
        },
        showSteamGames: {
          label: "Show Steam games",
          description:
            "Shows games from the Steam account in the library, including uninstalled games when available.",
        },
      },
      backups: {
        outputPath: {
          label: "Cloud backups",
          description: "Backups are saved in the cloud for Premium accounts.",
        },
        automaticLibrary: {
          label: "Automatic cloud backup",
          description:
            "Saves backups to the cloud after closing games, for Premium accounts.",
        },
      },
      notifications: {
        test: {
          label: "Notification test",
          description: "Shows a sample notification over other programs.",
          button: "Test notification",
        },
        testAchievement: {
          label: "Achievement test",
          description: "Shows a sample achievement using an achievement icon.",
          button: "Test achievement",
        },
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
        desktop: {
          label: "Overlay notifications",
          description: "Shows floating cards over other applications.",
        },
        achievements: {
          label: "Unlocked achievements",
          description:
            "Notifies when new local achievements are detected after closing a game.",
        },
        backupRestore: {
          label: "Backup and restore notifications",
          description:
            "Notifies about completed or failed backups and restores.",
        },
        backupSuccess: {
          label: "Completed backups",
          description: "Notifies when a backup finishes successfully.",
        },
        backupError: {
          label: "Backup failures",
          description: "Notifies when a backup cannot be created.",
        },
        restoreSuccess: {
          label: "Completed restores",
          description: "Notifies when a save is restored successfully.",
        },
        restoreError: {
          label: "Restore failures",
          description: "Notifies when a save cannot be restored.",
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
          loading: "Checking account status...",
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
          description:
            "These sources are auto-configured by the LuaTools manifest and used as fallback when available.",
          auto: "Auto-configured",
          premium: "Optional key",
          morrenus:
            "Hubcap's Manifest premium source enabled when a valid API key is provided.",
          manifest: "Source loaded from the remote LuaTools manifest.",
          fallback: "Default source bundled in the app as fallback.",
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
