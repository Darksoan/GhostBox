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
    },
    header: {
      back: "Voltar",
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
    },
    notifications: {
      groupTitle: "Jogos adicionados",
      loading: "Carregando jogos adicionados recentemente...",
      emptyMessage: "Nenhum jogo recente foi encontrado no banco de dados.",
    },
    backup: {
      eyebrow: "Backup local",
      title: "Jogos com preview do Ludusavi",
      description:
        "Lista vertical de todos os jogos encontrados pelo Ludusavi nesta máquina.",
      refresh: "Atualizar",
      loading: "Buscando por saves locais...",
      empty: "Nenhum jogo encontrado no preview.",
      listAria: "Jogos com backup disponível",
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
      achievementShowcase: "Destaque de conquistas",
      unlockedAchievements: "Conquistas",
      libraryGames: "Jogos",
      perfectGames: "Jogos perfeitos",
      averageAchievements: "Média de conquistas por jogo",
      overallProgress: "Progresso geral",
      xpProgress: "Progresso",
      levelLabel: "Nível {level}",
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
      achievementUnlocked: "Conquista desbloqueada",
      achievementLocked: "Conquista bloqueada",
      achievementUnlockedOn: "Desbloqueada em {date}",
      noTopGames: "Nenhum tempo de jogo registrado.",
      favorites: "Favoritos",
      library: "Biblioteca",
      editProfile: "Editar perfil",
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
      recentEmpty: "Nenhum jogo por aqui",
    },
    sidebar: {
      collections: "Coleções",
      restartSteam: "Reiniciar Steam",
      noGames: "Nenhum jogo",
    },
    settings: {
      tabs: {
        general: {
          label: "Geral",
          eyebrow: "Base do app",
          title: "Comportamento principal",
          description:
            "Preferências globais para iniciar, navegar e organizar a experiência do PirateBox.",
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
          eyebrow: "Saves locais",
          title: "Destino dos backups",
          description:
            "Configure onde o PirateBox salva backups locais criados pelo Ludusavi.",
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
          description: "Escolha o idioma da interface do PirateBox.",
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
          description: "Escolha a tela aberta ao iniciar o PirateBox.",
          home: "Início",
          profile: "Perfil",
          catalogue: "Catálogo",
        },
        openAtLogin: {
          label: "Iniciar com Windows",
          description:
            "Abre o PirateBox automaticamente quando o Windows iniciar.",
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
        disableCoverZoom: {
          label: "Remover zoom em capas",
          description:
            "Desativa o efeito de zoom ao passar o mouse nas capas dos jogos.",
        },
        disableTabAnimations: {
          label: "Remover animações de troca de abas",
          description:
            "Desativa animações ao navegar entre páginas e seções do app.",
        },
      },
      library: {
        steamPath: {
          label: "Pasta da Steam",
          description:
            "Caminho usado para localizar jogos instalados pelo LuaTools.",
        },
      },
      backups: {
        outputPath: {
          label: "Pasta de backups",
          description: "Onde os backups são salvos.",
        },
        automaticLibrary: {
          label: "Backup automático da biblioteca",
          description: "Ativa por padrão em novos jogos da biblioteca.",
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
            "Mostra avisos pequenos enquanto a janela do PirateBox está aberta.",
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
          description: "Avisa quando um backup local terminar com sucesso.",
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
    },
    header: {
      back: "Back",
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
    },
    notifications: {
      groupTitle: "Games added",
      loading: "Loading recently added games...",
      emptyMessage: "No recently added games were found in the database.",
    },
    backup: {
      eyebrow: "Local backup",
      title: "Games with Ludusavi preview",
      description:
        "Vertical list of every game Ludusavi found on this machine.",
      refresh: "Refresh",
      loading: "Searching local saves...",
      empty: "No games found in preview.",
      listAria: "Games with available backup",
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
      achievementShowcase: "Achievement showcase",
      unlockedAchievements: "Achievements",
      libraryGames: "Games",
      perfectGames: "Perfect games",
      averageAchievements: "Average achievements per game",
      overallProgress: "Overall progress",
      xpProgress: "Progress",
      levelLabel: "Level {level}",
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
      achievementUnlocked: "Achievement unlocked",
      achievementLocked: "Achievement locked",
      achievementUnlockedOn: "Unlocked {date}",
      noTopGames: "No playtime recorded.",
      favorites: "Favorites",
      library: "Library",
      editProfile: "Edit profile",
    },
    achievements: {
      title: "Achievements",
      pageAria: "Achievements for {title}",
      personalAchievements: "Personal achievements",
      progressSummary:
        "{unlocked} of {total} ({percent}%) achievements earned",
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
      recentEmpty: "No games here",
    },
    sidebar: {
      collections: "Collections",
      restartSteam: "Restart Steam",
      noGames: "No games",
    },
    settings: {
      tabs: {
        general: {
          label: "General",
          eyebrow: "App base",
          title: "Main behavior",
          description:
            "Global preferences for launch, navigation, and the PirateBox experience.",
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
          eyebrow: "Local saves",
          title: "Backup destination",
          description:
            "Configure where PirateBox saves local backups created by Ludusavi.",
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
          description: "Choose the PirateBox interface language.",
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
          description: "Choose the screen opened when PirateBox starts.",
          home: "Home",
          profile: "Profile",
          catalogue: "Catalogue",
        },
        openAtLogin: {
          label: "Start with Windows",
          description: "Opens PirateBox automatically when Windows starts.",
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
        disableCoverZoom: {
          label: "Remove cover zoom",
          description: "Disables the zoom effect when hovering game covers.",
        },
        disableTabAnimations: {
          label: "Remove tab switch animations",
          description:
            "Disables animations when navigating between pages and sections.",
        },
      },
      library: {
        steamPath: {
          label: "Steam folder",
          description: "Path used to find games installed via LuaTools.",
        },
      },
      backups: {
        outputPath: {
          label: "Backup folder",
          description: "Where backups are saved.",
        },
        automaticLibrary: {
          label: "Library auto-backup",
          description: "Keeps it on for new library games.",
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
          description: "Shows small alerts while the PirateBox window is open.",
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
          description: "Notifies about completed or failed backups and restores.",
        },
        backupSuccess: {
          label: "Completed backups",
          description: "Notifies when a local backup finishes successfully.",
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
  params?: Record<string, string | number>
) {
  const raw =
    getValue(translations[language], key) ??
    getValue(translations.pt, key) ??
    key;
  if (!params) return raw;

  return Object.entries(params).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
    raw
  );
}
