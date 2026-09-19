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
      settings: "Ajustes",
    },
    gameSettings: {
      sections: {
        launch: "Inicialização",
        installation: "Instalação",
        collections: "Coleções",
      },
      launch: {
        description: "Configure como o GhostBox inicia este jogo.",
        methodTitle: "Método de inicialização",
        methodDescription: "Escolha entre o fluxo padrão da Steam e um executável local.",
        steam: "Steam",
        steamDescription: "Usa o cliente Steam e mantém sua configuração padrão.",
        customExecutable: "Executável personalizado",
        customExecutableDescription: "Abre diretamente um arquivo dentro da instalação.",
        executableTitle: "Executável",
        executableDescription: "Selecione uma sugestão ou procure outro arquivo .exe.",
        browse: "Procurar",
        scanning: "Procurando executáveis na instalação…",
        recommended: "Recomendado",
        noExecutables: "Nenhum executável confiável foi encontrado automaticamente.",
        scanError: "Não foi possível procurar executáveis automaticamente. Selecione um arquivo .exe manualmente.",
        argumentsTitle: "Argumentos de inicialização",
        argumentsDescription: "São enviados diretamente ao jogo, sem executar comandos de shell.",
        argumentsPlaceholder: "Ex.: -windowed -novid",
        shortcutsTitle: "Atalho na área de trabalho",
        shortcutsDescription: "Crie um atalho usando a configuração de inicialização atual.",
        desktop: "Criar atalho na área de trabalho",
        startMenu: "Menu Iniciar",
        save: "Salvar alterações",
        saved: "Configuração de inicialização salva.",
        saveError: "Não foi possível salvar a configuração de inicialização.",
        executableRequired: "Escolha um executável antes de salvar.",
        desktopShortcutCreated: "Atalho criado na área de trabalho.",
        startMenuShortcutCreated: "Atalho criado no menu Iniciar.",
        shortcutError: "Não foi possível criar o atalho.",
      },
      installation: {
        steamInstalled: "Instalado pela Steam",
        steamManaged: "Instalação gerenciada pela Steam.",
        steamUninstallPrompt:
          "A Steam será aberta para desinstalar \"{title}\". A entrada na biblioteca não será removida.",
        openSteam: "Abrir Steam",
        steamUninstallOpened: "Desinstalação aberta na Steam.",
        steamUninstallError: "Não foi possível abrir a desinstalação na Steam.",
      },
      collections: {
        description: "Onde este jogo aparece na sua biblioteca.",
        selectionTitle: "Escolha as coleções",
        selectionDescription:
          "Marque Favoritos e todas as coleções em que este jogo deve aparecer.",
        favorites: "Favoritos",
        save: "Salvar alterações",
        saveError: "Não foi possível atualizar as coleções.",
      },
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
      cleared: "Histórico limpo.",
      undo: "Desfazer",
      emptyTitle: "Nenhuma notificação por enquanto",
       emptyMessage: "Backups, conquistas, conta e alertas do sistema aparecerão aqui.",
    },
    premium: {
      backupNudge: {
        title: "Backup em nuvem é Premium",
        message:
          "Seus saves não foram enviados à nuvem: o backup automático do GhostBox faz parte do Premium.",
        cta: "Conhecer Premium",
      },
      lockedBackup: {
        chipLabel: "Backup automático é Premium",
        viewPlans: "Ver planos",
        failedLabel: "Falha no último backup",
      },
      profileGate: {
        toastTitle: "Recurso Premium",
        toastMessage:
          "Edição de capa/avatar faz parte do Premium. Conheça os planos na aba Assinatura dos Ajustes.",
      },
    },
    loading: {
      catalogue: "Carregando catálogo",
      filters: "Carregando filtros",
      emptyTitle: "Nenhum jogo encontrado",
      emptyQuery: 'Não há resultados para "{term}".',
    },
    catalogue: {
      errorTitle: "Não foi possível carregar o catálogo",
      errorDescription:
        "Verifique sua conexão. O catálogo salvo em disco é usado quando disponível.",
      errorRetry: "Tentar novamente",
      filters: {
        genres: "Gêneros",
        tags: "Tags",
        developers: "Desenvolvedoras",
        publishers: "Publicadoras",
        years: "Ano",
        yearStart: "Ano inicial",
        yearEnd: "Ano final",
        clear: "Limpar {count}",
        options: "{count} opções",
        search: "Pesquisar {title}",
        empty: "Nenhuma opção encontrada",
        label: "Filtros",
        clearAll: "Limpar filtros",
        clearShort: "Limpar",
        selected: "{count} filtro(s)",
      },
      preview: {
        developer: "Desenvolvedora",
        previousScreenshot: "Screenshot anterior",
        nextScreenshot: "Próxima screenshot",
        columnLabel: "Preview do jogo",
        idleHint: "Passe o mouse sobre um jogo para ver a prévia.",
      },
      pagination: {
        label: "Paginação do catálogo",
        previous: "Página anterior",
        next: "Próxima página",
        page: "Página",
      },
      resultsCount: "{count} jogos encontrados",
      sort: {
        label: "Ordenar catálogo",
        popular: "Mais populares",
        recentlyAdded: "Adicionados recentemente",
        playingNow: "Mais jogados",
      },
      view: {
        label: "Método de visualização",
        grid: "Grade",
        list: "Listagem",
      },
      noResultsTitle: "Nenhum jogo corresponde aos filtros",
      noResultsDescription: "Tente remover um filtro ou limpar todos os filtros.",
      refreshError: "Não foi possível atualizar os resultados. Os dados anteriores continuam visíveis.",
      facetsError: "Não foi possível carregar todos os filtros.",
    },
    profile: {
      changeBanner: "Alterar capa",
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
      neverPlayed: "Nunca jogado",
      currentlyInGame: "Em jogo",
      steamMetrics: "Métricas Steam",
      achievementUnlocked: "Conquista desbloqueada",
      achievementUnlockedOn: "Desbloqueada em {date}",
      favorites: "Favoritos",
      library: "Biblioteca",
      editProfile: "Editar perfil",
      editProfileSubtitle: "Personalize seu nome, avatar e capa de perfil",
      profileAvatar: "Foto de perfil",
      changeAvatar: "Alterar",
      avatarFormatHelp: "JPG, PNG ou GIF.",
      processingAvatar: "Processando...",
      avatarTooLarge: "A animação é muito grande. Escolha um GIF menor ou mais curto.",
      avatarProcessingError: "Não foi possível processar a foto. Tente outra imagem.",
      displayNameHelp: "Seu nome público no perfil e nas classificações.",
      avatarCropHelp: "Arraste para reposicionar e use a roda do mouse para aproximar.",
      displayName: "Nome de exibição",
      displayNamePlaceholder: "Seu nome",
      bannerCover: "Capa do perfil",
      bannerPremiumHelp: "A alteração de capa está disponível somente na assinatura",
      bannerPremiumLink: "GhostBox Premium",
      removeBanner: "Remover",
      cropAvatar: "Recortar avatar",
      saveChanges: "Salvar alterações",
      changesSaved: "Perfil atualizado",
      saving: "Salvando...",
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
      globalPercent: "desbloquearam",
      viewMore: "Ver mais",
      empty: "Este jogo não possui conquistas.",
    },
    metrics: {
      locked: "Faça login",
      lockedAchievements: "Conecte-se ao app para ver as conquistas",
      lockedAria:
        "Conquistas e tempo de jogo bloqueados. Faça login para visualizar.",
    },
    video: {
      player: "Player de vídeo",
      play: "Reproduzir",
      pause: "Pausar",
      mute: "Silenciar",
      unmute: "Ativar som",
      volume: "Volume",
      progress: "Progresso do vídeo",
      fullscreenEnter: "Tela cheia",
      fullscreenExit: "Sair da tela cheia",
      buffering: "Carregando vídeo",
    },
    home: {
      pageAria: "Descobertas, lançamentos e recomendações da página inicial",
      recommended: "Recomendados",
      recommendedPreviousGame: "Jogo anterior",
      recommendedNextGame: "Próximo jogo",
      bannerGoToGame: "Ir para {title}",
      newReleases: "Novidades",
      comingSoon: "Em breve",
      topSellers: "Mais vendidos",
      featuredGames: "Bem avaliados",
      mostPlayed: "Bem avaliados",
      exploreByCategory: "Explore por categoria",
      personalCalendar: "Calendário pessoal",
      steamWishlist: "Da sua wishlist da Steam",
      seeMore: "Ver mais ({count})",
      reviews: "{count} avaliações",
    },
    sidebar: {
      profile: {
        signIn: "Fazer login",
        loading: "Carregando conta…",
        account: "Conta GhostBox",
      },
      collections: "Coleções",
      deleteCollectionConfirm: "Excluir a coleção \"{name}\"? Esta ação não pode ser desfeita.",
      searchCollections: "Pesquisar jogos nas coleções",
      collectionSearchPlaceholder: "Pesquisar nas coleções",
      noMatchingGames: "Nenhum jogo encontrado",
      restartSteam: "Reiniciar Steam",
      noGames: "Nenhum jogo",
    },
    subscription: {
      title: "Desbloqueie sincronização em nuvem",
      actions: {
        subscribe: "Assinar",
      },
      discordLink: {
        title: "Vincular Discord",
        description:
          "Opcional: vincule o Discord para receber o cargo Premium no servidor do GhostBox. Não é necessário para assinar.",
        signInSteam: "Entrar com Steam",
        link: "Vincular Discord",
        connecting: "Vinculando…",
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
        customProfile: "Perfil personalizado",
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
    auth: {
      login: {
        title: "Entre no GHOSTBOX",
        legalNotice: "Aceito as políticas do GhostBox.",
        terms: "Termos de Uso",
        privacy: "Política de Privacidade",
      },
      provider: {
        divider: "ou",
        discord: "Continuar com Discord",
        steam: "Continuar com Steam",
        signingIn: "Conectando…",
      },
      disclaimer:
        "A conta GhostBox é acessada exclusivamente pelo Discord ou pela Steam vinculados. Proteja essas contas e seus métodos de recuperação. A GhostBox não se responsabiliza por acessos decorrentes do comprometimento da sua conta no provedor.",
      recover: {
        title: "Recuperar acesso",
        subtitle:
          "O acesso por e-mail/senha foi desativado. Entre direto pelo Discord ou pela Steam vinculados à sua conta.",
        backToLogin: "Voltar ao login",
      },
      errors: {
        invalid_username: "Usuário inválido. Use de 3 a 20 letras, números ou _.",
        username_taken: "Esse usuário já está em uso.",
        terms_required: "É preciso aceitar os termos para criar a conta.",
        provider_already_linked: "Este provedor já pertence a outra conta. Fale com o suporte.",
        reauth_required: "Por segurança, entre novamente pelo provedor antes de continuar.",
        merge_conflict: "Essas contas não podem ser unidas automaticamente. Fale com o suporte.",
        too_many_attempts: "Muitas tentativas. Aguarde antes de tentar novamente.",
        account_not_found: "Conta não encontrada.",
        auth_error: "Não foi possível concluir. Tente novamente.",
      },
      verifyBanner: {
        message: "Confirme seu e-mail para liberar recursos Premium e nuvem.",
        resend: "Reenviar e-mail",
        resent: "E-mail reenviado.",
        verified: "E-mail confirmado.",
      },
      toast: {
        signedInTitle: "Sessão iniciada",
        signedInMessage: "Bem-vindo de volta, {name}.",
        signedInMessageGeneric: "Sua conta GhostBox está conectada.",
        signedOutTitle: "Sessão encerrada",
        signedOutMessage: "Você saiu da conta neste dispositivo.",
      },
    },
    settings: {
      tabs: {
        general: {
          label: "Geral",
          description: "Idioma, aparência e comportamento de início.",
        },
        performance: {
          label: "Desempenho",
          description: "Uso de memória, aceleração e diagnóstico.",
        },
        library: {
          label: "Biblioteca",
          description: "Origem Steam e licenças locais.",
        },
        connections: {
          label: "Conexões",
          description: "Contas, perfis e vínculos externos.",
        },
        subscription: {
          label: "Assinatura",
          description: "Plano na nuvem, backup e recursos exclusivos.",
        },
        notifications: {
          label: "Notificações",
          description: "Alertas e sons do sistema.",
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
        account: {
          title: "Conta",
          email: "E-mail:",
          noEmail: "Não informado",
          username: "Usuário:",
          deleteTitle: "Excluir conta",
          deleteDescription: "Apaga a conta e todos os seus dados. Não pode ser desfeito.",
          deleteConfirmLabel: "Digite EXCLUIR para confirmar",
          deleteConfirmPlaceholder: "EXCLUIR",
          deleteConfirmError: "Digite EXCLUIR para confirmar a exclusão.",
          delete: "Excluir conta",
          deleting: "Excluindo...",
          deleteError: "Não foi possível excluir a conta.",
          signOut: "Sair",
          signOutDescription: "Encerra sua sessão neste dispositivo.",
        },
      },
      connections: {
        title: "Conexões",
        description: "Conecte contas externas para desbloquear recursos opcionais.",
        lastConnectionWarning:
          "Este é o único provedor vinculado à conta e ele não pode ser removido: ele é o seu acesso.",
        steam: {
          title: "Steam",
          description: "Métricas, biblioteca e conquistas oficiais da sua conta Steam.",
          connect: "Conectar Steam",
          connecting: "Conectando...",
          disconnect: "Desconectar",
          disconnecting: "Desconectando...",
          disconnectConfirm: "Desconectar sua conta Steam? Suas métricas e biblioteca oficial ficam ocultas até reconectar.",
          connectedAsPrefix: "Conectado como ",
          connectedAsSuffix: ".",
          copyId: "Copiar ID da Steam",
          copiedId: "ID copiado",
          showOnProfile: "Mostrar dados Steam no perfil",
          showOnProfileDescription:
            "Exibe métricas e jogos da conta Steam no seu perfil GhostBox.",
          showInLibrary: "Mostrar jogos da biblioteca Steam no GhostBox",
          showInLibraryDescription:
            "Exibe os jogos da sua biblioteca Steam na aba Biblioteca do GhostBox.",
        },
        discord: {
          title: "Discord",
          description: "Vincule para receber o cargo Premium automaticamente no servidor do GhostBox.",
          connectedAsPrefix: "Conectado como ",
          connectedAsSuffix: ".",
          connect: "Conectar Discord",
          connecting: "Conectando...",
          disconnect: "Desconectar",
          disconnecting: "Desconectando...",
        },
      },
      performance: {
        coverQuality: {
          label: "Qualidade das capas",
          description: "Qualidade das capas do cat\u00e1logo: 50%, 80% ou 100%, independentemente do tamanho da janela.",
        },
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
        hiddenProfileGames: {
          label: "Ocultar jogos do perfil",
          description: "Selecione os jogos que não devem aparecer em Visão geral e Conquistas.",
          back: "Voltar para Biblioteca",
          searchPlaceholder: "Pesquisar jogos",
          alphabetLabel: "Filtrar jogos por letra",
          clearAlphabetFilter: "Exibir todos os jogos",
          filterByLetter: "Filtrar por {letter}",
          clearLetterFilter: "Remover filtro da letra {letter}",
          noResults: "Nenhum jogo encontrado.",
          empty: "Nenhum jogo disponível.",
        },
        steamPath: {
          label: "Pasta da Steam",
          description: "Caminho da pasta da Steam usado para localizar jogos instalados.",
        },
      },
      tempFiles: {
        title: "Arquivos temporários",
        description: "Caches que o GhostBox recria sozinho quando precisa.",
        descriptionWithSize:
          "{size} em caches que o GhostBox recria sozinho quando precisa.",
        clear: "Limpar",
        clearing: "Limpando...",
        successTitle: "Limpeza concluída",
        successMessage: "{freed} liberados.",
        errorTitle: "Falha na limpeza",
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
    },
  },
  en: {
    nav: {
      home: "Home",
      catalogue: "Catalogue",
      library: "Library",
      settings: "Settings",
    },
    gameSettings: {
      sections: {
        launch: "Launch",
        installation: "Installation",
        collections: "Collections",
      },
      launch: {
        description: "Configure how GhostBox launches this game.",
        methodTitle: "Launch method",
        methodDescription: "Choose between the standard Steam flow and a local executable.",
        steam: "Steam",
        steamDescription: "Uses the Steam client and keeps its default configuration.",
        customExecutable: "Custom executable",
        customExecutableDescription: "Opens a file inside the installation directly.",
        executableTitle: "Executable",
        executableDescription: "Select a suggestion or browse for another .exe file.",
        browse: "Browse",
        scanning: "Scanning the installation for executables…",
        recommended: "Recommended",
        noExecutables: "No trustworthy executable was found automatically.",
        scanError: "Executables could not be scanned automatically. Select an .exe file manually.",
        argumentsTitle: "Launch arguments",
        argumentsDescription: "They are passed directly to the game without running shell commands.",
        argumentsPlaceholder: "Example: -windowed -novid",
        shortcutsTitle: "Desktop shortcut",
        shortcutsDescription: "Create a shortcut using the current launch configuration.",
        desktop: "Create desktop shortcut",
        startMenu: "Start menu",
        save: "Save changes",
        saved: "Launch configuration saved.",
        saveError: "Could not save the launch configuration.",
        executableRequired: "Choose an executable before saving.",
        desktopShortcutCreated: "Desktop shortcut created.",
        startMenuShortcutCreated: "Start menu shortcut created.",
        shortcutError: "Could not create the shortcut.",
      },
      installation: {
        steamInstalled: "Installed through Steam",
        steamManaged: "Installation managed by Steam.",
        steamUninstallPrompt:
          "Steam will open to uninstall \"{title}\". The library entry will not be removed.",
        openSteam: "Open Steam",
        steamUninstallOpened: "Uninstall opened in Steam.",
        steamUninstallError: "Could not open the uninstall flow in Steam.",
      },
      collections: {
        description: "Where this game appears in your library.",
        selectionTitle: "Choose collections",
        selectionDescription:
          "Select Favorites and every collection where this game should appear.",
        favorites: "Favorites",
        save: "Save changes",
        saveError: "Could not update the collections.",
      },
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
      cleared: "History cleared.",
      undo: "Undo",
      emptyTitle: "No notifications yet",
       emptyMessage: "Backups, achievements, account, and system alerts will appear here.",
    },
    loading: {
      catalogue: "Loading catalogue",
      filters: "Loading filters",
      emptyTitle: "No games found",
      emptyQuery: 'No results for "{term}".',
    },
    catalogue: {
      errorTitle: "Could not load the catalogue",
      errorDescription:
        "Check your connection. The catalogue cached on disk is used when available.",
      errorRetry: "Try again",
      filters: {
        genres: "Genres",
        tags: "Tags",
        developers: "Developers",
        publishers: "Publishers",
        years: "Year",
        yearStart: "Start year",
        yearEnd: "End year",
        clear: "Clear {count}",
        options: "{count} options",
        search: "Search {title}",
        empty: "No options found",
        label: "Filters",
        clearAll: "Clear filters",
        clearShort: "Clear",
        selected: "{count} filter(s)",
      },
      preview: {
        columnLabel: "Game preview",
      },
      pagination: {
        label: "Catalogue pagination",
        previous: "Previous page",
        next: "Next page",
        page: "Page",
      },
      resultsCount: "{count} games found",
      sort: {
        label: "Sort catalogue",
        popular: "Most popular",
        recentlyAdded: "Recently added",
        playingNow: "Most played",
      },
      view: {
        label: "View mode",
        grid: "Grid",
        list: "List",
      },
      noResultsTitle: "No games match these filters",
      noResultsDescription: "Try removing a filter or clearing all filters.",
      refreshError: "Could not refresh results. Previous data remains visible.",
      facetsError: "Could not load all filters.",
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
      neverPlayed: "Never played",
      currentlyInGame: "Currently In-Game",
      steamMetrics: "Steam metrics",
      achievementUnlocked: "Achievement unlocked",
      achievementUnlockedOn: "Unlocked {date}",
      favorites: "Favorites",
      library: "Library",
      editProfile: "Edit profile",
      editProfileSubtitle: "Customize your display name, avatar and profile banner",
      profileAvatar: "Profile avatar",
      changeAvatar: "Change",
      avatarFormatHelp: "JPG, PNG or GIF.",
      processingAvatar: "Processing...",
      avatarTooLarge: "The animation is too large. Choose a smaller or shorter GIF.",
      avatarProcessingError: "Could not process the photo. Try another image.",
      displayNameHelp: "Your public name on your profile and leaderboards.",
      avatarCropHelp: "Drag to reposition and use the mouse wheel to zoom.",
      displayName: "Display name",
      displayNamePlaceholder: "Your name",
      bannerCover: "Profile banner",
      bannerPremiumHelp: "Banner changes are available only with the",
      bannerPremiumLink: "GhostBox Premium subscription",
      removeBanner: "Remove",
      cropAvatar: "Crop avatar",
      saveChanges: "Save changes",
      changesSaved: "Profile updated",
      saving: "Saving...",
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
      globalPercent: "unlocked",
      viewMore: "View more",
      empty: "This game has no achievements.",
    },
    metrics: {
      locked: "Log in",
      lockedAchievements: "Log in to the app to view achievements",
      lockedAria: "Achievements and playtime locked. Log in to view.",
    },
    video: {
      player: "Video player",
      play: "Play",
      pause: "Pause",
      mute: "Mute",
      unmute: "Unmute",
      volume: "Volume",
      progress: "Video progress",
      fullscreenEnter: "Fullscreen",
      fullscreenExit: "Exit fullscreen",
      buffering: "Buffering",
    },
    home: {
      pageAria: "Discovery, new releases and home recommendations",
      recommended: "Recommended",
      recommendedPreviousGame: "Previous game",
      recommendedNextGame: "Next game",
      bannerGoToGame: "Go to {title}",
      newReleases: "New releases",
      comingSoon: "Coming soon",
      topSellers: "Top sellers",
      featuredGames: "Top rated",
      mostPlayed: "Top rated",
      exploreByCategory: "Explore by category",
      personalCalendar: "Personal calendar",
      steamWishlist: "From your Steam wishlist",
      seeMore: "See more ({count})",
      reviews: "{count} reviews",
    },
    sidebar: {
      profile: {
        signIn: "Log in",
        loading: "Loading account…",
        account: "GhostBox account",
      },
      collections: "Collections",
      deleteCollectionConfirm: "Delete the \"{name}\" collection? This action cannot be undone.",
      searchCollections: "Search games in collections",
      collectionSearchPlaceholder: "Search collections",
      noMatchingGames: "No games found",
      restartSteam: "Restart Steam",
      noGames: "No games",
    },
    subscription: {
      title: "Unlock cloud sync",
      actions: {
        subscribe: "Subscribe",
      },
      discordLink: {
        title: "Link Discord",
        description:
          "Optional: link Discord to get the Premium role in the GhostBox server. It is not required to subscribe.",
        signInSteam: "Sign in with Steam",
        link: "Link Discord",
        connecting: "Linking…",
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
        customProfile: "Custom profile",
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
    auth: {
      login: {
        title: "Sign in to GHOSTBOX",
        legalNotice: "I accept GhostBox's policies.",
        terms: "Terms of Use",
        privacy: "Privacy Policy",
      },
      provider: {
        divider: "or",
        discord: "Continue with Discord",
        steam: "Continue with Steam",
        signingIn: "Connecting…",
      },
      disclaimer:
        "Your GhostBox account is accessed exclusively through the linked Discord or Steam. Protect those accounts and their recovery methods. GhostBox is not responsible for access resulting from the compromise of your provider account.",
      recover: {
        title: "Recover access",
        subtitle:
          "Email/password sign-in was disabled. Sign in directly with the Discord or Steam linked to your account.",
        backToLogin: "Back to sign in",
      },
      errors: {
        invalid_username: "Invalid username. Use 3 to 20 letters, numbers or _.",
        username_taken: "That username is already taken.",
        terms_required: "You must accept the terms to create the account.",
        provider_already_linked: "This provider already belongs to another account. Contact support.",
        reauth_required: "For your security, sign in again through the provider before continuing.",
        merge_conflict: "These accounts cannot be merged automatically. Contact support.",
        too_many_attempts: "Too many attempts. Wait before trying again.",
        account_not_found: "Account not found.",
        auth_error: "Couldn't complete that. Please try again.",
      },
      verifyBanner: {
        message: "Confirm your email to unlock Premium and cloud features.",
        resend: "Resend email",
        resent: "Email resent.",
        verified: "Email confirmed.",
      },
      toast: {
        signedInTitle: "Signed in",
        signedInMessage: "Welcome back, {name}.",
        signedInMessageGeneric: "Your GhostBox account is connected.",
        signedOutTitle: "Signed out",
        signedOutMessage: "You left your account on this device.",
      },
    },
    settings: {
      tabs: {
        general: {
          label: "General",
          description: "Language, appearance and startup defaults.",
        },
        performance: {
          label: "Performance",
          description: "Memory use, acceleration and diagnostics.",
        },
        library: {
          label: "Library",
          description: "Steam and local library sources.",
        },
        connections: {
          label: "Connections",
          description: "Accounts, profiles and external links.",
        },
        subscription: {
          label: "Subscription",
          description: "Cloud plan, backup and exclusive resources.",
        },
        notifications: {
          label: "Notifications",
          description: "System alerts and sounds.",
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
        account: {
          title: "Account",
          email: "Email:",
          noEmail: "Not provided",
          username: "Username:",
          deleteTitle: "Delete account",
          deleteDescription: "Deletes the account and all of its data. Cannot be undone.",
          deleteConfirmLabel: "Type DELETE to confirm",
          deleteConfirmPlaceholder: "DELETE",
          deleteConfirmError: "Type DELETE to confirm deletion.",
          delete: "Delete account",
          deleting: "Deleting...",
          deleteError: "Could not delete the account.",
          signOut: "Sign out",
          signOutDescription: "Ends your session on this device.",
        },
      },
      connections: {
        title: "Connections",
        description: "Connect external accounts to unlock optional features.",
        lastConnectionWarning:
          "This is the account's only linked provider and it cannot be removed: it is your sign-in.",
        steam: {
          title: "Steam",
          description: "Official metrics, library and achievements from your Steam account.",
          connect: "Connect Steam",
          connecting: "Connecting...",
          disconnect: "Disconnect",
          disconnecting: "Disconnecting...",
          disconnectConfirm: "Disconnect your Steam account? Your metrics and official library stay hidden until you reconnect.",
          connectedAsPrefix: "Connected as ",
          connectedAsSuffix: ".",
          copyId: "Copy Steam ID",
          copiedId: "ID copied",
          showOnProfile: "Show Steam data on profile",
          showOnProfileDescription:
            "Show metrics and games from your Steam account on your GhostBox profile.",
          showInLibrary: "Show Steam library games in GhostBox",
          showInLibraryDescription:
            "Show games from your Steam library in the GhostBox Library tab.",
        },
        discord: {
          title: "Discord",
          description: "Link to automatically receive the Premium role on the GhostBox server.",
          connectedAsPrefix: "Connected as ",
          connectedAsSuffix: ".",
          connect: "Connect Discord",
          connecting: "Connecting...",
          disconnect: "Disconnect",
          disconnecting: "Disconnecting...",
        },
      },
      performance: {
        coverQuality: {
          label: "Cover quality",
          description: "Catalogue cover quality: 50%, 80% or 100%, regardless of window size.",
        },
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
        hiddenProfileGames: {
          label: "Hide games from profile",
          description: "Select games that should not appear in Overview and Achievements.",
          back: "Back to Library",
          searchPlaceholder: "Search games",
          alphabetLabel: "Filter games by letter",
          clearAlphabetFilter: "Show all games",
          filterByLetter: "Filter by {letter}",
          clearLetterFilter: "Clear {letter} filter",
          noResults: "No games found.",
          empty: "No games available.",
        },
        steamPath: {
          label: "Steam folder",
          description: "Path to the Steam folder used to locate installed games.",
        },
      },
      tempFiles: {
        title: "Temporary files",
        description: "Caches GhostBox rebuilds on its own when needed.",
        descriptionWithSize:
          "{size} in caches GhostBox rebuilds on its own when needed.",
        clear: "Clear",
        clearing: "Clearing...",
        successTitle: "Cleanup finished",
        successMessage: "{freed} freed.",
        errorTitle: "Cleanup failed",
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
