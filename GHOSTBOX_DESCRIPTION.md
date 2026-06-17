# GhostBox — Descrição do Produto

## O que é o GhostBox?

O **GhostBox** é um aplicativo desktop de gerenciamento de biblioteca de jogos construído com **Tauri 2** (Rust + React/TypeScript). Ele funciona como um companion para a Steam, oferecendo organização avançada, backup de saves, rastreamento de conquistas e gerenciamento de coleções — tudo em uma interface moderna e fluida.

O aplicativo se conecta à conta Steam do usuário via OpenID para acessar perfil, biblioteca, wishlist e conquistas,提供endo uma experiência unificada que vai além do que a Steam oferece nativamente.

---

## Funcionalidades Principais (Atual)

### Biblioteca e Catálogo
- Catalogo de jogos curado e alimentado remotamente, com busca, filtros e recomendações baseadas em tags.
- Scan automático da biblioteca local de Steam, detectando jogos instalados via manifestos `.acf`.
- Sistema de coleções e favoritos para organização personalizada.
- Página de perfil com histórico de jogos, conquistas e coleções.

### Backup e Restauração de Saves
- Integração com o **Ludusavi**, ferramenta open-source de backup de saves de jogos.
- Backup local automatizado — pode ser acionado após cada sessão de jogo.
- Limite de retenção configurável com política de pruning automático.
- Restauração completa de saves com visualização da árvore de arquivos.
- Raiz de backup configurável pelo usuário.

### Rastreamento de Conquistas
- Leitura de conquistas diretamente dos arquivos locais da Steam.
- Monitoramento em tempo real de desbloqueios enquanto o jogo está em execução.
- Servidor HTTP local que permite que jogos reportem conquistas via API interna.
- Merge inteligente de conquistas de múltiplas fontes com matching fuzzy por similaridade de texto.

### Rastreamento de Tempo de Jogo
- Monitoramento contínuo do registro do Windows para detectar sessões ativas da Steam.
- Registro de duração total e sessões individuais por jogo.
- Fallback por monitoramento de processos quando o registro não está disponível.

### Autenticação
- Login via Steam OpenID com servidor callback local temporário.
- Acesso a perfil, avatar, wishlist e tags recomendadas.
- Todos os dados de autenticação permanecem locais no dispositivo do usuário.

---

## Funcionalidades Futuras — Assinatura Premium

O GhostBox está planejando a introdução de um modelo de assinatura para desbloquear recursos avançados de sincronização na nuvem e gerenciamento premium.

### Backup na Nuvem
- Upload automático e incremental de saves de jogos para armazenamento seguro na nuvem.
- Versionamento de backups com retenção configurável.
- Restauração seletiva a partir de qualquer ponto no tempo.
- Sincronização entre múltiplos dispositivos.
- Indicador visual de status de sincronização em tempo real.

### Sincronização de Conquistas na Nuvem
- Preservação permanente do progresso de conquistas independente do dispositivo.
- Merge automático de conquistas desbloqueadas em diferentes PCs.
- Badge visual indicando conquistas sincronizadas.
- Notificações ao desbloquear conquistas em outro dispositivo.

### Salvamento de Progresso na Nuvem
- Snapshots periódicos automáticos dos saves de jogos.
- Versionamento com possibilidade de restauração por timestamp específico.
- Toggle de sincronização automática por jogo.
- Backup criptografado antes do upload para garantir privacidade.

### Gerenciamento de Assinatura
- Página dedicada com planos, comparação de recursos e gerenciamento de cobrança.
- Verificação periódica de status com funcionamento offline via cache local.
- Notificações de expiração e renovação.
- Modo gradativo de downgrade preservando dados existentes.

---

## Stack Técnica

| Camada | Tecnologia |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tanstack Query, Framer Motion, SCSS |
| Backend | Rust, Tauri 2, Reqwest, Serde, Chrono |
| Plataforma | Windows (suporte futuro a Linux e macOS) |
| Build | Cargo (Rust), npm (frontend), Tauri CLI |
| Storage Local | JSON files (App Data Directory), localStorage |

---

## Modelo de Negócios

O GhostBox adota um modelo **freemium**:

- **Plano Gratuito**: Todas as funcionalidades atuais — biblioteca, catálogo, backup local, rastreamento de conquistas e tempo de jogo. Nenhuma funcionalidade existente será removida ou limitada.
- **Plano Pago (Premium)**: Desbloqueio de sincronização na nuvem para backups, conquistas e progresso, além de recursos avançados de gerenciamento e suporte prioritário.

O plano gratuito garante que o GhostBox continue acessível para todos os usuários, enquanto o plano premium oferece valor adicional para quem deseja sincronização entre dispositivos e preservação permanente de dados.

---

## Privacidade e Segurança

- Todos os dados do usuário são armazenados localmente por padrão.
- Nenhum dado pessoal é coletado ou transmitido sem consentimento explícito.
- Backup na nuvem utilizará criptografia de ponta a ponta.
- Autenticação via Steam OpenID — o GhostBox nunca armazena senhas da Steam.
- Chaves de API e tokens são armazenados de forma criptografada no dispositivo (Windows DPAPI).
