# Tauri Backend And Frontend Completion Plan

## Objetivo

Levar o runtime Tauri o mais próximo possível de 100% migrado do Electron, sem depender de validações manuais, mantendo o app sem dependência runtime em Electron, preload, IPC, `games.sqlite` ou SQLite local.

Estado atual:

- Backend funcional principal já migrado.
- `catalogue.rs`, `backup.rs`, `steam_appcache.rs`, `luatools.rs`, `ludusavi.rs`, `settings.rs` já existem.
- `backup.rs` já contém comandos de backup root/settings, backup automático settings, pin, custom executable, open/delete, metadata refresh, backup manual, restore manual e details.
- Ainda falta refactor técnico de `src-tauri/src/lib.rs` e melhorias frontend de UX/performance.

Este plano é para outra IA continuar de forma segura e incremental.

## Regras De Trabalho

- Fazer uma fatia por vez e validar antes de continuar.
- Evitar refactor grande em um único commit.
- Não mudar comportamento funcional quando o objetivo for só mover código.
- Não reintroduzir Electron/preload/IPC/SQLite local.
- Não mover helpers para módulos privados se ainda são usados por outros módulos.
- Preferir `pub(crate)` para helpers compartilhados, nunca `pub` sem necessidade.
- Rodar sempre:

```powershell
cargo check --manifest-path "src-tauri\Cargo.toml"
npm run build
rg "window\.piratebox|ipcRenderer|contextBridge|BrowserWindow|sqlite|games\.sqlite" src src-tauri
git diff --check
```

## Ordem Recomendada

1. Backend: extrair Steam profile/login para `src-tauri/src/steam.rs`.
2. Backend: extrair Steam scan/restart/path para `src-tauri/src/steam.rs` ou `src-tauri/src/steam_library.rs`.
3. Backend: extrair playtime/session monitor para `src-tauri/src/playtime.rs`.
4. Backend: extrair window lifecycle/tray para `src-tauri/src/window_lifecycle.rs`.
5. Backend: revisar `shell_open_external` e decidir restrição de URL.
6. Frontend: melhorar UX de Ludusavi/backup.
7. Frontend: adicionar indicador de sessão ativa em cards/listas, se desejado.
8. Frontend: reduzir chunk grande de `GameModal`.
9. Atualizar `MIGRATION_STATUS.md` depois de cada bloco.

## Backend 1: Extrair Steam Profile/Login

### O Que Mover

De `src-tauri/src/lib.rs` para `src-tauri/src/steam.rs`:

- `steam_get_profile`
- `steam_save_profile`
- `steam_sign_in`
- `steam_sign_out`
- helpers usados exclusivamente pelo login/profile Steam, por exemplo:
  - profile file read/write helpers específicos;
  - OpenID callback helpers;
  - `sign_in_with_steam`;
  - HTML callback page helpers;
  - avatar fetch/cache helpers se forem exclusivos do profile.

Não mover ainda scan de biblioteca se isso tornar o diff grande. Faça profile/login primeiro.

### Exemplo De Estrutura

```rust
// src-tauri/src/steam.rs
use crate::settings::{read_json_file, remove_data_file, write_json_file};
use crate::util::{text_value, EmptyStringExt};

const STEAM_PROFILE_FILE: &str = "steam-profile.json";

#[tauri::command]
pub fn steam_get_profile(app: tauri::AppHandle) -> Option<serde_json::Value> {
    load_steam_profile(&app)
}

#[tauri::command]
pub fn steam_save_profile(
    app: tauri::AppHandle,
    profile: serde_json::Value,
) -> Result<serde_json::Value, String> {
    save_steam_profile(&app, profile)
}

#[tauri::command]
pub async fn steam_sign_in(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    sign_in_with_steam(&app).await
}

#[tauri::command]
pub fn steam_sign_out(app: tauri::AppHandle) -> Result<(), String> {
    remove_data_file(&app, STEAM_PROFILE_FILE)
}
```

No `lib.rs`:

```rust
mod steam;

.invoke_handler(tauri::generate_handler![
    steam::steam_get_profile,
    steam::steam_save_profile,
    steam::steam_sign_in,
    steam::steam_sign_out,
])
```

### Contornos De Erro

- Preserve bloqueio de login concorrente.
- Se mover `STEAM_SIGN_IN_ACTIVE`, mantenha `static` no módulo `steam.rs`.
- Nunca responda sucesso ao browser antes de validar OpenID e buscar profile.
- Se fetch de avatar falhar, retorne profile com avatar remoto original, não falhe o login inteiro.
- Mantenha callback local em loopback (`127.0.0.1`) e timeout.

### Código Robusto Para Lock De Login

```rust
struct SignInGuard;

impl Drop for SignInGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = STEAM_SIGN_IN_ACTIVE.lock() {
            *active = false;
        }
    }
}

fn acquire_sign_in_guard() -> Result<SignInGuard, String> {
    let mut active = STEAM_SIGN_IN_ACTIVE
        .lock()
        .map_err(|_| "Falha ao acessar estado de login Steam.".to_string())?;
    if *active {
        return Err("Login Steam já está em andamento.".to_string());
    }
    *active = true;
    Ok(SignInGuard)
}
```

Use assim:

```rust
async fn sign_in_with_steam(app: &tauri::AppHandle) -> Result<serde_json::Value, String> {
    let _guard = acquire_sign_in_guard()?;
    // abrir browser, aguardar callback, validar OpenID, salvar profile
}
```

## Backend 2: Extrair Steam Scan/Restart/Path

### O Que Mover

Pode ir para `steam.rs` se o módulo ficar aceitável, ou criar `steam_library.rs` se ficar grande.

Mover:

- `steam_select_path`
- `steam_scan_library`
- `steam_restart`
- `resolve_steam_path`
- helpers de path Steam:
  - `default_steam_path_candidates`
  - `normalize_steam_root_path`
  - `steamapps_path`
  - `read_steam_library_paths`
  - `parse_app_manifest`
  - `scan_installed_steam_games`
  - `load_saved_steam_path`
  - `save_steam_path`

### Cuidados

- `resolve_steam_path` é usado por backup, achievements e playtime. Se mover, mantenha `pub(crate)` e atualize imports.
- Preserve fallback para biblioteca persistida quando Steam não é encontrada.
- Preserve merge com jogos LuaTools/plugin.
- Preserve enriquecimento com achievements locais.

### Exemplo De Handler

```rust
.invoke_handler(tauri::generate_handler![
    steam::steam_select_path,
    steam::steam_scan_library,
    steam::steam_restart,
])
```

### Contornos De Erro

- `steam_select_path` deve retornar `invalid`, não erro fatal, quando pasta não tem `steamapps/libraryfolders.vdf`.
- `steam_scan_library` deve retornar `missing` se não há Steam e nem biblioteca PirateBox persistida.
- Se há biblioteca PirateBox persistida, deve retornar `ok` com jogos persistidos mesmo sem Steam.

## Backend 3: Extrair Playtime E Session Monitor

### O Que Mover

Criar `src-tauri/src/playtime.rs`.

Mover:

- `game_get_playtimes`
- `record_game_launch_playtime`
- `record_game_session_playtime`
- `emit_game_playtimes_changed`
- `active_playtime_sessions`
- `get_game_playtime_snapshot`
- `emit_game_playtimes_snapshot`
- `start_game_playtime_snapshot_emitter`
- `GamePlaytimeSession`
- `SteamMonitorState` ou parte dele, se decidir separar monitor também.

Se o monitor Steam/processo estiver acoplado demais, mover em duas etapas:

- Etapa A: persistência/snapshot de playtime.
- Etapa B: monitor de sessão e `RunningAppID`.

### Código Robusto Para Snapshot

```rust
pub(crate) fn get_game_playtime_snapshot(app: &tauri::AppHandle) -> serde_json::Value {
    let persisted = load_game_playtimes(app);
    let sessions = active_playtime_sessions();
    if sessions.is_empty() {
        return persisted;
    }

    let mut snapshot = persisted.as_object().cloned().unwrap_or_default();
    let now = std::time::SystemTime::now();

    for (app_id, session) in sessions {
        let elapsed = now
            .duration_since(session.started_at)
            .map(|duration| duration.as_millis())
            .unwrap_or(0)
            .min(i64::MAX as u128) as u64;

        let current = snapshot
            .get(&app_id)
            .cloned()
            .unwrap_or_else(|| serde_json::json!({ "appId": app_id }));

        snapshot.insert(app_id.clone(), serde_json::json!({
            "appId": app_id,
            "playTimeInMilliseconds": current
                .get("playTimeInMilliseconds")
                .and_then(|value| value.as_u64())
                .unwrap_or(0)
                .saturating_add(elapsed),
            "lastTimePlayed": current
                .get("lastTimePlayed")
                .cloned()
                .unwrap_or_else(|| serde_json::json!(crate::current_timestamp_string())),
            "lastSessionRecordedAt": current.get("lastSessionRecordedAt").cloned(),
            "lastSessionDurationInMilliseconds": elapsed,
            "sessionActive": true
        }));
    }

    serde_json::Value::Object(snapshot)
}
```

### Contornos De Erro

- Não deixar thread de monitor travar se lock falhar.
- Não manter sessão ativa depois do processo fechar.
- Sempre chamar `achievement_monitor::stop_local_achievement_monitor(app_id)` ao fechar sessão.
- Se backup automático falhar, manter persistência de falha já implementada.

## Backend 4: Extrair Window Lifecycle/Tray

### O Que Mover

Criar `src-tauri/src/window_lifecycle.rs`.

Mover:

- `setup_window_lifecycle`
- `request_close_main_window`
- `hide_main_window_to_tray`
- `show_main_window`
- `create_tray`
- `shutdown_app_services` se não ficar muito acoplado; caso contrário, manter em `lib.rs` e chamar do módulo.
- commands:
  - `window_minimize`
  - `window_close`

### Cuidados

- `IS_QUITTING` e `SHUTDOWN_STARTED` podem ficar em `lib.rs` ou ir para o módulo. Se mover, cuide para não duplicar state.
- `shutdown_app_services` chama playtime/achievement server; se playtime for movido antes, atualize imports.
- Mantenha evento `window-hidden-to-tray`.

### Exemplo De Command

```rust
#[tauri::command]
pub fn window_close(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    request_close_main_window(&app, &window)
}
```

## Backend 5: Revisar `shell_open_external`

No Electron, `openExternal` restringia URLs a `steam://` e `https://discord.gg/hubcapsmanifest`.

No Tauri atual, `shell_open_external` abre qualquer URL recebida.

Minha recomendação: restringir no backend e, se necessário, permitir apenas as URLs usadas pelo frontend.

Exemplo robusto:

```rust
fn is_allowed_external_url(url: &str) -> bool {
    let trimmed = url.trim();
    if trimmed.starts_with("steam://") {
        return true;
    }

    let Ok(parsed) = reqwest::Url::parse(trimmed) else {
        return false;
    };
    if parsed.scheme() != "https" {
        return false;
    }

    matches!(
        parsed.host_str(),
        Some("discord.gg") | Some("hubcapmanifest.com") | Some("steamcommunity.com")
    )
}

#[tauri::command]
fn shell_open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if !is_allowed_external_url(&url) {
        return Err("URL externa não permitida.".to_string());
    }
    app.opener()
        .open_url(url.trim().to_string(), None::<&str>)
        .map_err(|error| error.to_string())
}
```

Antes de aplicar, faça `rg "openExternal|openUrl|openExternal\(" src` para listar URLs reais usadas.

## Frontend 1: UX De Ludusavi/Backup

### Objetivo

Melhorar a experiência sem mudar contrato backend.

Implementar:

- estado `runningBackupAppIds` e `runningRestoreAppIds` no `AppDataContext` ou na página que dispara ações;
- mensagens específicas para:
  - sidecar ausente;
  - backup sem saves encontrado;
  - erro Ludusavi;
  - path inválido;
- estado visual quando Ludusavi não está disponível.

### Exemplo De Tratamento Robusto

```ts
function backupErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return fallback;
}

async function runBackup(game: LudusaviBackupPreviewGame) {
  setRunningBackupAppIds((current) => new Set(current).add(game.appId));
  try {
    const result = await pirateboxApi.runGameLocalBackup(game);
    if (!result?.success) {
      showToast({
        type: "error",
        title: "Backup falhou",
        message: result?.error || "Não foi possível criar o backup.",
      });
      return;
    }
    showToast({ type: "success", title: "Backup concluído", message: result.title });
  } catch (error) {
    showToast({
      type: "error",
      title: "Backup falhou",
      message: backupErrorMessage(error, "Erro inesperado ao criar backup."),
    });
  } finally {
    setRunningBackupAppIds((current) => {
      const next = new Set(current);
      next.delete(game.appId);
      return next;
    });
  }
}
```

### Cuidados

- Não bloquear toda a UI durante backup de um único jogo.
- Não engolir erro com fallback silencioso.
- Reusar `backupNotifications.ts` quando possível.
- Não disparar notificação desktop se settings desabilitam.

## Frontend 2: Indicador De Sessão Ativa

Hoje `GameModal` já mostra sessão ativa. `AppDataContext` expõe `activeSessionAppIds`.

Adicionar indicador em:

- `GameCard`;
- `LibraryPage`/listas;
- possivelmente `Sidebar` se mostrar jogos recentes.

Exemplo mínimo:

```tsx
export function GameCard({ game, active }: { game: PirateGame; active?: boolean }) {
  return (
    <article className={`game-card${active ? " game-card--active" : ""}`}>
      {active && <span className="game-card__active-badge">Playing</span>}
      {/* restante do card */}
    </article>
  );
}
```

CSS mínimo:

```scss
.game-card__active-badge {
  position: absolute;
  top: 10px;
  right: 10px;
  border-radius: 999px;
  padding: 4px 8px;
  background: rgba(53, 208, 127, 0.18);
  color: #35d07f;
  font-size: 12px;
  font-weight: 700;
}
```

Cuidados:

- Usar `activeSessionAppIds.has(game.appId)`.
- Não criar polling novo; consumir estado já existente.
- Respeitar i18n (`Playing`/`Jogando`) se o componente já usa `t`.

## Frontend 3: Reduzir Chunk De `GameModal`

O build avisa que `GameModal` passa de 500 kB. Não é bloqueante, mas é polish.

Minha recomendação:

- manter `GameModal` lazy no `ContentOverlay`/router se ainda não estiver;
- lazy-load de componentes pesados dentro do modal:
  - `VideoPlayer`;
  - `GallerySlider`;
  - HLS/video extras.

Exemplo:

```tsx
import { lazy, Suspense } from "react";

const LazyVideoPlayer = lazy(() =>
  import("../ui/VideoPlayer").then((module) => ({ default: module.VideoPlayer }))
);

function MediaPanel(props: VideoPlayerProps) {
  return (
    <Suspense fallback={<div className="media-placeholder" />}>
      <LazyVideoPlayer {...props} />
    </Suspense>
  );
}
```

Cuidados:

- Não lazy-load tudo se isso piorar UX.
- Manter fallback leve.
- Rodar `npm run build` e comparar chunks.

## Atualização De Status

Depois de cada etapa, atualizar `MIGRATION_STATUS.md`:

- mover item concluído para “Já Migrado” ou atualizar “Refactor Técnico”;
- manter “Pendências Restantes Sem Validação Manual” honesto;
- não marcar validações manuais como feitas sem executar.

## Commits Recomendados

Usar commits pequenos:

- `refactor: extract steam profile commands`
- `refactor: extract steam library commands`
- `refactor: extract playtime monitor`
- `refactor: extract window lifecycle`
- `fix: restrict external URL opening`
- `feat: improve backup status UX`
- `feat: show active game sessions in lists`
- `perf: split game modal media chunks`

Antes de cada commit:

```powershell
git status --short
git diff --check
cargo check --manifest-path "src-tauri\Cargo.toml"
npm run build
rg "window\.piratebox|ipcRenderer|contextBridge|BrowserWindow|sqlite|games\.sqlite" src src-tauri
git diff --stat
```

## Definição De Pronto

Sem validação manual, considerar a implementação pronta quando:

- `src-tauri/src/lib.rs` estiver reduzido a bootstrap, `run()`, wiring e poucos helpers realmente globais;
- backend continuar compilando sem warnings;
- frontend build passar;
- `MIGRATION_STATUS.md` listar apenas validações manuais ou melhorias opcionais;
- busca de acoplamentos Electron/SQLite continuar sem ocorrências.
