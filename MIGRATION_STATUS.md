# PirateBox Tauri Migration Status

Atualizado em: 2026-06-09

## Resumo

A migração do Electron para Tauri 2 já cobre a maior parte dos fluxos funcionais principais: catálogo remoto, biblioteca Steam local, launch de jogos, backups com Ludusavi sidecar, LuaTools básico e persistência local de configurações.

Ainda faltam principalmente: refinamentos de UX/empacotamento e validação manual em build release.

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

Pendência restante:

- definir estratégia equivalente para plataformas não-Windows, se continuarem no escopo.

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
- Backup automático pós-sessão usa debounce (30s) e delay (2s) antes de gravar saves.
- Toasts in-app e notificações desktop após backup automático/manual (via `backupNotifications` + settings).

Ainda pode precisar refinamento:

- persistência de falhas de backup automático no record para toasts de erro;
- fallback de monitoramento por processo no Windows quando o registro Steam falhar.

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

`src-tauri/src/lib.rs` ficou grande. Depois da estabilização funcional, separar em módulos:

- `catalogue.rs`;
- `backup.rs`;
- `steam.rs`;
- `steam_appcache.rs`;
- `luatools.rs`;
- `ludusavi.rs`;
- `settings.rs`.

## Frontend Pendente

### Profile UI

- Tela existe.
- Backend real de Steam profile/login já existe no Tauri.
- Edit profile salva via backend Tauri e mantém fallback local do frontend.
- Ainda precisa validação manual do login Steam em build release/instalador.

### Settings/Morrenus

- UI chama `getMorrenusStats`.
- A chave é carregada do backend no startup.
- Ideal mostrar estado explícito quando storage seguro estiver indisponível fora do Windows.

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

1. Validar Window Lifecycle e autostart em build release/instalador.
2. Validar Steam Profile/Login em build release/instalador.
3. Validar achievements locais com jogos/ferramentas reais.
4. Definir storage seguro equivalente para Morrenus fora do Windows, se necessário.
5. Refatorar `src-tauri/src/lib.rs` em módulos.

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
