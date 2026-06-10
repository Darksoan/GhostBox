# PirateBox Tauri Migration Status

Atualizado em: 2026-06-09

## Resumo

A migração do Electron para Tauri 2 está em estado **release candidate funcional** para o runtime do app: catálogo remoto, biblioteca Steam local, launch de jogos, backups com Ludusavi sidecar, LuaTools básico e persistência local de configurações.

Não declarar como completa até concluir a checklist manual de release/instalador abaixo. Tooling de geração/publicação do catálogo do repo Electron fica fora do runtime Tauri por decisão de escopo.

## Critério Para Declarar Completa

Declarar a migração como completa quando todos estes critérios estiverem satisfeitos:

- build release/instalador validado manualmente no Windows;
- fluxos principais abaixo marcados como aprovados;
- nenhuma dependência runtime em Electron, preload, IPC, SQLite local ou `games.sqlite`;
- decisões de fora de escopo documentadas nesta página.

Status atual: **não completa; release candidate aguardando validação manual**.

## Já Migrado

- Tauri 2 configurado com React/Vite.
- Catálogo remoto via Worker.
- Home remoto via Worker `GET /home`:
  - command Tauri `catalogue_get_home` busca fora do WebView/CORS;
  - frontend usa `pirateboxApi.getHome` + `useHomeQuery`;
  - `HomePage` renderiza listas remotas `popular` e `recentlyAdded` com fallback visual local quando o remoto está indisponível.
- Busca, filtros, paginação e detalhes remotos básicos.
- Persistência local de startup settings.
- Persistência local de notification settings.
- Morrenus com storage seguro no Windows:
  - chave salva em `morrenus-api-key.bin` no app data;
  - payload criptografado por usuário via DPAPI;
  - leitura da chave no startup do frontend;
  - consulta de stats em `https://hubcapmanifest.com/api/v1/user/stats`.
- Steam Profile/Login:
  - persistência em `steam-profile.json` no app data;
  - leitura do profile no startup do frontend;
  - edição/salvamento do profile via backend Tauri;
  - sign-out remove profile persistido;
  - login Steam OpenID via browser externo e callback local `127.0.0.1`;
  - fetch de profile XML e avatar Steam.
- Backup root/settings com validação de raiz.
- Paridade backend de backup settings com Electron:
  - `getAppStatus` exposto na camada Tauri do frontend;
  - `getBackupSettings`, `setBackupOutputPath` e `ensureBackupRoot` expostos;
  - command Tauri `backup_ensure_root` cria/garante a raiz configurada antes de validar.
- Seleção de pasta via diálogo nativo Tauri.
- Open/delete de backups restrito ao backup root configurado.
- Steam local scan sem profile:
  - detecção de Steam path;
  - leitura de `libraryfolders.vdf`;
  - leitura de `appmanifest_*.acf`;
  - leitura de `config/stplug-in/*.lua` (jogos LuaTools);
  - persistência de biblioteca em `piratebox-library.json`;
  - merge biblioteca persistida + instalados + plugin no scan.
- Launch game:
  - executável customizado quando configurado;
  - fallback `steam://rungameid/{appId}`.
- Seleção de executável customizado com validação `.exe`.
- Ludusavi como sidecar Tauri:
  - `src-tauri/binaries/ludusavi-x86_64-pc-windows-msvc.exe`.
- Ludusavi básico:
  - previews;
  - details;
  - backup local;
  - restore local.
- Backup automático pós-jogo:
  - settings de backup automático por jogo e por biblioteca;
  - execução automática quando uma sessão monitorada termina;
  - falhas retornadas pelo backup automático são persistidas no record para diagnóstico/toasts;
  - fallback Windows por processo monitora jogos pendentes quando `RunningAppID` não abre sessão;
  - evento Tauri `backup-settings-changed` sincroniza settings na UI.
- Backup entries com retenção (até 3) e pin de entradas protegidas.
- Achievement server local loopback para executáveis customizados.
- Persistência local de achievements desbloqueados (`piratebox-achievements.json`).
- Monitor Steam `RunningAppID` para backup/playtime em jogos via `steam://`.
- Notificações de backup (toast in-app + desktop) no frontend.
- LuaTools add/remove sem secrets:
  - usa APIs públicas padrão;
  - download ZIP com limite de 64 MB;
  - validação básica de URL;
  - extração controlada de `.manifest` e `.lua`;
  - remoção de manifests/Lua por `appId`.
- Playtime com sessão monitorada:
  - `game-playtime.json` no app data;
  - `lastTimePlayed` registrado ao lançar jogo;
  - duração real somada quando há sessão monitorável;
  - snapshot ao vivo a cada 3s com `sessionActive`;
  - eventos Tauri `game-playtimes-changed` atualizam a UI.
- Window lifecycle básico:
  - single instance;
  - tray nativo com mostrar/ocultar/sair;
  - close-to-tray via `minimizeToTray`;
  - autostart via `openAtLogin`;
  - start minimized via `startMinimized`.
- Fallback de ícones/Steam tools:
  - `getGameIconUrl` usa assets públicos da Steam;
  - `isSteamToolsInstalled` retorna disponível via fallback remoto;
  - `installSteamTools` não baixa ferramenta local porque o fallback não requer instalação.
- Restart Steam seguro:
  - abre `steam.exe` quando a instalação local é encontrada;
  - fallback para `steam://open/main`;
  - não encerra processos existentes.
- Builds validados:
  - `cargo check --manifest-path src-tauri\Cargo.toml`;
  - `npm run build`;
  - `npm run tauri -- build --debug`.

## Backend Pendente

### Steam Profile/Login

- `getSteamProfile`, `saveSteamProfile`, `signInWithSteam` e `signOutSteam` no backend Tauri.
- Login OpenID com callback local e validação antes de responder ao navegador.
- Página de callback mostra sucesso só após validação (`Connected as {name}.`).
- Bloqueio de login concorrente no backend.
- Frontend propaga erros do invoke (não engole falhas com fallback).
- Toasts: aguardando browser, sucesso e mensagens amigáveis para cancelamento/timeout/validação.
- Merge de perfil nativo + customizações locais (avatar/banner) ao carregar.

Ainda falta:

- validação manual do fluxo real em build release/instalador.

### Secrets/Morrenus

- `getMorrenusApiKey`, `setMorrenusApiKey` e `getMorrenusStats` já existem no Tauri.
- A chave não é salva em JSON puro.
- No Windows, a persistência usa DPAPI por usuário antes de gravar `morrenus-api-key.bin`.
- Decisão de escopo: HubCap's/Morrenus é Windows-only no Tauri; storage seguro equivalente para Linux/macOS não é requisito.

### Playtime Completo

- Já registra `lastTimePlayed` e soma duração real por sessão.
- Snapshot ao vivo a cada 3s durante sessões (`get_game_playtime_snapshot`).
- Campo `sessionActive` no snapshot para a UI.
- Monitor Steam `RunningAppID` (Windows) + fallback por processo após 20s.
- Monitor por processo com `pgrep` em Linux/macOS.
- Heurística de executável melhorada com `installDir` do manifest Steam.

Ainda pode precisar refinamento:

- validação manual em builds release fora do Windows;
- indicador de sessão ativa em cards/listas além do GameModal.

### Backup Automático E Pin

- `setGameAutomaticBackup` e `setLibraryAutomaticBackups` existem e persistem settings.
- `runGameLocalBackup` e `restoreGameLocalBackup` existem para execução manual.
- Backup automático pós-jogo já dispara quando o processo do jogo é monitorável.
- `backup-settings-changed` já é emitido/consumido no Tauri.
- `backup_set_entry_pinned` persiste pin de entradas de backup.
- Backups mantêm até 3 entradas; entradas não fixadas são removidas ao exceder o limite.
- Entradas fixadas (`pinned`) são preservadas durante o trim.
- Monitor Steam via `RunningAppID` (Windows) cobre jogos lançados por `steam://` sem executável detectado.
- Watchdog Windows inicia monitoramento por processo para jogos pendentes com executável provável quando `RunningAppID` não cobre a sessão após 20s.
- Backup automático pós-sessão usa debounce (30s) e delay (2s) antes de gravar saves.
- Toasts in-app e notificações desktop após backup automático/manual (via `backupNotifications` + settings).

Limite conhecido: monitor Steam depende do registro `RunningAppID` no Windows. Fora do Windows, backup automático pós-jogo ainda depende de executável customizado monitorado ou heurística por processo (não-Windows).

### Achievements Locais

- Catálogo e detalhes de achievements remotos com merge de desbloqueios locais.
- Servidor local `POST /achievements/unlock` em loopback com token `x-piratebox-token`.
- Token e URL expostos via `PIRATEBOX_ACHIEVEMENTS_URL` / `PIRATEBOX_ACHIEVEMENTS_TOKEN` ao lançar executável customizado.
- Persistência em `piratebox-achievements.json` por jogo no backup root.
- Parser binary VDF do Steam (`appcache/stats`) em `src-tauri/src/steam_appcache.rs`.
- `steam_scan_library` enriquece jogos com progresso offline (`unlocked`/`total`/`progress`).
- `database_get_game_achievement_details` cruza lista remota com backup local e appcache.
- `getBackupDetails` enriquece achievements com ícones da API remota (fallback appcache quando não há backup JSON).
- Backup Ludusavi copia stats Steam para `piratebox-steam-achievements/` dentro da pasta do backup.
- Restore Ludusavi repõe stats Steam de `piratebox-steam-achievements/` em `appcache/stats`.

Ainda falta:

- validação manual do fluxo com jogos/ferramentas reais.

### SteamCMD / Ícones

- `getGameIconUrl` no Tauri usa fallback por assets públicos da Steam.
- `isSteamToolsInstalled`/`installSteamTools` são tratados como disponíveis por fallback remoto.
- Decisão: SteamCMD local não é mais requisito para ícones no Tauri.
- O frontend não depende mais de `steamcmd:ready` para recarregar ícones.

O comportamento Electron com `ensureSteamCmd()` foi substituído pelo fallback remoto atual. Reabrir apenas se houver requisito futuro de cache local ou assets privados.

### Window Lifecycle

Implementado e refinado para build release:

- single instance com foco na janela existente;
- tray nativo com **Abrir PirateBox**, ocultar e sair;
- close-to-tray via `minimizeToTray` (botão X e `window_close`);
- notificação desktop ao ocultar para a bandeja (`window-hidden-to-tray`);
- autostart via `openAtLogin`;
- start minimized via `startMinimized`;
- shutdown limpo ao sair (sessões de playtime + achievement server);
- `AppUserModelID` Windows (`com.piratebox.app`) para notificações desktop em release;
- product/window title alinhados a **PirateBox** no bundle.

Ainda pode precisar:

- validação manual em build release/instalador;
- ícone/menus de tray mais ricos (opcional).

Plugins usados:

- `tauri-plugin-single-instance`;
- `tauri-plugin-autostart`;
- tray nativo do Tauri.

### Refactor Técnico

`src-tauri/src/lib.rs` ainda ficou grande. Refactor incremental iniciado:

- `catalogue.rs` implementado;
- `backup.rs` iniciado com comandos de backup root/settings, backup automático settings, pin, custom executable, open/delete, metadata refresh, backup manual, restore manual e details;
- `steam_appcache.rs` implementado;
- `luatools.rs` implementado;
- `ludusavi.rs` implementado;
- `settings.rs` implementado.

Ainda falta separar de `lib.rs`:

- Steam profile/login e Steam scan;
- window lifecycle/tray;
- playtime/monitoramento de sessão.

## Pendências Restantes Sem Validação Manual

Backend:

- continuar refactor técnico de `src-tauri/src/lib.rs` para módulos de Steam profile/login, Steam scan, window lifecycle/tray e playtime/monitoramento;
- decidir se `shell_open_external` deve restringir URLs como o Electron fazia ou manter o comportamento atual do frontend/Tauri.

Frontend:

- melhorar UX de Ludusavi/backup com progresso, estado explícito de sidecar ausente e mensagens específicas;
- adicionar indicador de sessão ativa em cards/listas além do `GameModal`, se desejado;
- otimizar chunk grande de `GameModal` com lazy imports internos.

## Frontend Pendente

### Profile UI

- Tela existe.
- Backend real de Steam profile/login já existe no Tauri.
- Edit profile salva via backend Tauri e mantém fallback local do frontend.
- Ainda precisa validação manual do login Steam em build release/instalador.

### Settings/Morrenus

- UI chama `getMorrenusStats`.
- A chave é carregada do backend no startup.
- Escopo Windows-only; não há pendência de UX para storage seguro fora do Windows.

### Backup Automático UI

- Toggles de backup automático chamam o backend Tauri e salvam settings.
- `onBackupSettingsChanged` recebe evento real do Tauri.
- O backup automático pós-jogo atualiza settings por evento quando grava o record.
- Toasts in-app e desktop disparam quando um record de backup muda (`queueBackupToast`).

### Playtime UI

- Consome tempo ao vivo via `game-playtimes-changed` durante sessões.
- GameModal mostra "Sessão ativa" / "Playing" e destaque visual no painel de playtime.
- `activeSessionAppIds` exposto no AppDataContext.

### Backup/Ludusavi UX

Backend básico existe. Ainda pode precisar refinamento para:

- progresso de backup/restore;
- mensagens específicas do Ludusavi;
- estado claro de sidecar ausente;
- detalhes de backup mais ricos.

### Performance Frontend

- `GameModal` continua gerando chunk acima de 500 kB.
- Não bloqueia a migração funcional.
- Otimizar depois com lazy imports internos, especialmente vídeo/galeria/HLS se necessário.

## Ordem Recomendada Para Continuar

1. Executar a checklist manual de release/instalador.
2. Corrigir qualquer falha encontrada na checklist.
3. Refatorar `src-tauri/src/lib.rs` em módulos depois da estabilização.

## Checklist Manual De Release

Marcar cada item durante validação do instalador `PirateBox_0.1.0_x64-setup.exe` ou MSI gerado pelo Tauri.

- [ ] Instalar em uma máquina Windows limpa ou perfil de usuário limpo.
- [ ] Abrir pelo atalho/menu iniciar e confirmar título/produto **PirateBox**.
- [ ] Confirmar que a Home carrega dados remotos (`popular`/`recentlyAdded`) sem SQLite local.
- [ ] Confirmar busca, filtros, paginação e detalhes do catálogo remoto.
- [ ] Confirmar que botão X respeita `minimizeToTray`.
- [ ] Confirmar tray: abrir, ocultar e sair.
- [ ] Confirmar single instance: abrir segunda instância foca a janela existente.
- [ ] Confirmar `openAtLogin` cria/remove autostart corretamente.
- [ ] Confirmar `startMinimized` inicia oculto/minimizado conforme configuração.
- [ ] Confirmar notificação desktop ao esconder para tray.
- [ ] Confirmar login Steam OpenID real: browser externo, callback local, perfil/avatar carregados.
- [ ] Confirmar sign-out remove profile persistido.
- [ ] Confirmar edição de perfil salva customizações locais.
- [ ] Confirmar detecção de Steam path e scan de `libraryfolders.vdf`/`appmanifest_*.acf`.
- [ ] Confirmar scan de jogos LuaTools via `config/stplug-in/*.lua`.
- [ ] Confirmar launch via executável customizado.
- [ ] Confirmar launch fallback via `steam://rungameid/{appId}`.
- [ ] Confirmar playtime: `lastTimePlayed`, sessão ativa e duração somada após fechar jogo.
- [ ] Confirmar backup root: selecionar pasta, validar marker e persistir settings.
- [ ] Confirmar backup manual com Ludusavi sidecar.
- [ ] Confirmar restore manual com Ludusavi sidecar.
- [ ] Confirmar pin/retenção de backups preserva entradas fixadas e limita não fixadas.
- [ ] Confirmar backup automático pós-jogo para executável customizado monitorável.
- [ ] Confirmar backup automático pós-jogo para jogo Steam monitorado por `RunningAppID`.
- [ ] Confirmar toasts in-app e notificações desktop de backup/restore.
- [ ] Confirmar achievements locais por servidor loopback com token em executável customizado.
- [ ] Confirmar merge de achievements remotos + desbloqueios locais + appcache Steam.
- [ ] Confirmar Morrenus: salvar chave, reiniciar app, carregar chave via DPAPI e consultar stats.
- [ ] Confirmar LuaTools add/remove baixa/extrai apenas `.manifest` e `.lua`, sem secrets.
- [ ] Confirmar restart Steam abre instalação local ou fallback `steam://open/main` sem matar processo.
- [ ] Confirmar que `rg "window\.piratebox|ipcRenderer|contextBridge|BrowserWindow|sqlite|games\.sqlite" src src-tauri` não retorna ocorrências.

## Fora Do Escopo Do Runtime Tauri

Estes itens do repo Electron continuam fora do runtime Tauri por decisão de escopo. Manter no repo Electron ou em tooling separado, não bloquear a migração do app Tauri.

- Scripts de geração/publicação do catálogo: `build-games-sqlite`, `publish-games-r2`, Workers Cloudflare e jobs de popularidade.
- Banco local `games.sqlite` e fallbacks locais de catálogo no runtime.
- Worker thread Node usado para cache/índice local de jogos do Electron.
- SteamCMD local e evento `steamcmd:ready`; substituído por fallback remoto de assets públicos Steam no Tauri.
- Python RPC e binário `piratebox-native`; fluxos necessários foram reimplementados em comandos Rust/Tauri ou removidos do runtime.
- Dependências Electron/preload/IPC (`window.piratebox`, `ipcRenderer`, `contextBridge`, `BrowserWindow`).

## Observações De Segurança

- Morrenus/API keys no Windows agora usam DPAPI por usuário antes de persistir em disco.
- Não gravar secrets em JSON puro.
- LuaTools atual usa apenas fontes públicas sem chave.
- Operações de backup/restore/delete validam path dentro do backup root configurado.
- Extração LuaTools foi limitada a arquivos esperados e com limite de tamanho de download.

## Validação Atual

Últimos comandos executados com sucesso durante a migração:

```powershell
cargo check --manifest-path "src-tauri\Cargo.toml"
npm run build
npm run tauri -- build
rg "window\.piratebox|ipcRenderer|contextBridge|BrowserWindow|sqlite|games\.sqlite" src src-tauri
```

Artefactos release (2026-06-09):

- `src-tauri\target\release\piratebox-tauri.exe` (~14 MB)
- `src-tauri\target\release\bundle\nsis\PirateBox_0.1.0_x64-setup.exe` (~11 MB)
- `src-tauri\target\release\bundle\msi\PirateBox_0.1.0_x64_en-US.msi` (~16 MB)

Validação manual pendente no instalador: tray/close-to-tray, autostart, login Steam OpenID e notificações desktop.

Avisos conhecidos:

- Chunk grande em `GameModal`, não bloqueante.
- Bundle identifier `com.piratebox.app` termina com `.app`; Tauri recomenda evitar isso para macOS.
