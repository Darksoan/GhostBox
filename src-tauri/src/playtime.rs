use crate::ludusavi::game_title;
use crate::settings::read_json_file;
use crate::util::{text_value, EmptyStringExt};
use crate::extract_app_id;

/// Steam-only playtime totals (playtime_forever). Local session accumulators are gone.
const STEAM_PLAYTIME_FILE: &str = "steam-owned-playtimes.json";
/// Legacy local accumulator — deleted on Steam sync; no longer used for totals.
const LEGACY_GAME_PLAYTIME_FILE: &str = "game-playtime.json";
const GAME_PLAYTIMES_CHANGED_EVENT: &str = "game-playtimes-changed";
const STEAM_RUNNING_APP_MONITOR_INTERVAL_MS: u64 = 3000;
const GAME_PLAYTIME_SNAPSHOT_INTERVAL_MS: u64 = 3000;
const STEAM_PENDING_PROCESS_FALLBACK_AFTER_MS: u64 = 20_000;
const AUTOMATIC_BACKUP_DEBOUNCE_WINDOW_MS: u64 = 30_000;
const AUTOMATIC_BACKUP_DELAY_AFTER_CLOSE_MS: u64 = 2_000;

#[derive(Clone)]
struct GamePlaytimeSession {
    started_at: std::time::SystemTime,
    title: String,
}

struct SteamMonitorState {
    active_running_app_id: Option<String>,
    pending_games: std::collections::HashMap<String, serde_json::Value>,
    pending_game_registered_at: std::collections::HashMap<String, u64>,
    process_fallback_started: std::collections::HashSet<String>,
    playtime_sessions: std::collections::HashMap<String, GamePlaytimeSession>,
    backup_in_progress: std::collections::HashSet<String>,
    last_automatic_backup_at: std::collections::HashMap<String, u64>,
}

static STEAM_MONITOR: std::sync::OnceLock<std::sync::Mutex<SteamMonitorState>> =
    std::sync::OnceLock::new();

fn steam_monitor_state() -> &'static std::sync::Mutex<SteamMonitorState> {
    STEAM_MONITOR.get_or_init(|| {
        std::sync::Mutex::new(SteamMonitorState {
            active_running_app_id: None,
            pending_games: std::collections::HashMap::new(),
            pending_game_registered_at: std::collections::HashMap::new(),
            process_fallback_started: std::collections::HashSet::new(),
            playtime_sessions: std::collections::HashMap::new(),
            backup_in_progress: std::collections::HashSet::new(),
            last_automatic_backup_at: std::collections::HashMap::new(),
        })
    })
}

fn current_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

pub(crate) fn load_game_playtimes(app: &tauri::AppHandle) -> serde_json::Value {
    // Prefer Steam-owned cache. Never fall back to legacy local accumulators for totals.
    if let Some(steam) = read_json_file(app, STEAM_PLAYTIME_FILE)
        .and_then(|value| value.as_object().cloned().map(serde_json::Value::Object))
    {
        return steam;
    }
    serde_json::json!({})
}

pub(crate) fn save_game_playtimes(app: &tauri::AppHandle, snapshot: &serde_json::Value) -> Result<(), String> {
    crate::settings::write_json_file(app, STEAM_PLAYTIME_FILE, snapshot)
}

/// Wipe legacy local playtime accumulator so UI never reloads fake session totals.
pub(crate) fn clear_legacy_local_playtime_cache(app: &tauri::AppHandle) {
    let _ = crate::settings::remove_data_file(app, LEGACY_GAME_PLAYTIME_FILE);
}

/// Replace the entire playtime snapshot with Steam-owned totals only.
pub(crate) fn replace_playtimes_from_steam(
    app: &tauri::AppHandle,
    snapshot: &serde_json::Value,
) -> Result<(), String> {
    clear_legacy_local_playtime_cache(app);
    save_game_playtimes(app, snapshot)?;
    emit_game_playtimes_changed(app, snapshot);
    Ok(())
}

pub(crate) fn emit_game_playtimes_changed(app: &tauri::AppHandle, snapshot: &serde_json::Value) {
    use tauri::Emitter;

    let _ = app.emit(GAME_PLAYTIMES_CHANGED_EVENT, snapshot.clone());
}

fn active_playtime_sessions() -> std::collections::HashMap<String, GamePlaytimeSession> {
    steam_monitor_state()
        .lock()
        .map(|guard| guard.playtime_sessions.clone())
        .unwrap_or_default()
}

fn get_game_playtime_snapshot(app: &tauri::AppHandle) -> serde_json::Value {
    let persisted = load_game_playtimes(app);
    let sessions = active_playtime_sessions();
    if sessions.is_empty() {
        return persisted;
    }

    // Session overlay only marks "playing now" — never inflates Steam totals.
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
        let steam_playtime = current
            .get("playTimeInMilliseconds")
            .and_then(|value| value.as_u64())
            .unwrap_or(0);
        let last_time_played = current
            .get("lastTimePlayed")
            .cloned()
            .unwrap_or_else(|| serde_json::json!(current_timestamp_string()));

        snapshot.insert(
            app_id.clone(),
            serde_json::json!({
                "appId": app_id,
                "playTimeInMilliseconds": steam_playtime,
                "lastTimePlayed": last_time_played,
                "lastSessionRecordedAt": current.get("lastSessionRecordedAt").cloned(),
                "lastSessionDurationInMilliseconds": elapsed,
                "sessionActive": true
            }),
        );
    }

    serde_json::Value::Object(snapshot)
}

fn emit_game_playtimes_snapshot(app: &tauri::AppHandle) {
    let snapshot = get_game_playtime_snapshot(app);
    emit_game_playtimes_changed(app, &snapshot);
}

pub(crate) fn start_game_playtime_snapshot_emitter(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        let has_sessions = steam_monitor_state()
            .lock()
            .is_ok_and(|guard| !guard.playtime_sessions.is_empty());
        if has_sessions {
            emit_game_playtimes_snapshot(&app);
        }
        std::thread::sleep(std::time::Duration::from_millis(
            GAME_PLAYTIME_SNAPSHOT_INTERVAL_MS,
        ));
    });
}

pub(crate) fn is_playtime_session_active(app_id: &str) -> bool {
    let normalized_app_id: String = app_id.chars().filter(|c| c.is_ascii_digit()).collect();
    if normalized_app_id.is_empty() {
        return false;
    }

    steam_monitor_state()
        .lock()
        .ok()
        .is_some_and(|guard| guard.playtime_sessions.contains_key(&normalized_app_id))
}

#[cfg(windows)]
fn read_steam_running_app_id() -> Option<String> {
    let output = std::process::Command::new("reg")
        .args(["query", r"HKCU\Software\Valve\Steam", "/v", "RunningAppID"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let hex_value = stdout.lines().find_map(|line| {
        let line = line.trim();
        if !line.starts_with("RunningAppID") {
            return None;
        }
        line.split_whitespace().last().map(str::to_string)
    })?;
    let normalized = hex_value.trim_start_matches("0x").trim_start_matches("0X");
    let app_id = u32::from_str_radix(normalized, 16).ok()?;
    Some(app_id.to_string())
}

#[cfg(not(windows))]
fn read_steam_running_app_id() -> Option<String> {
    None
}

pub(crate) fn register_pending_steam_game(game: serde_json::Value) {
    let app_id = extract_app_id(&game);
    if app_id.is_empty() {
        return;
    }

    if let Ok(mut guard) = steam_monitor_state().lock() {
        guard.pending_games.insert(app_id.clone(), game);
        guard
            .pending_game_registered_at
            .insert(app_id, current_millis());
    }
}

pub(crate) fn mark_process_fallback_started(app_id: &str) -> bool {
    steam_monitor_state().lock().is_ok_and(|mut guard| {
        if guard.playtime_sessions.contains_key(app_id)
            || guard.process_fallback_started.contains(app_id)
        {
            return false;
        }
        guard.process_fallback_started.insert(app_id.to_string());
        true
    })
}

fn resolve_backup_game(app_id: &str, title_fallback: &str) -> serde_json::Value {
    serde_json::json!({
        "id": format!("steam-{app_id}"),
        "appId": app_id,
        "title": title_fallback.to_string().if_empty(format!("Steam App {app_id}"))
    })
}

pub(crate) fn open_game_playtime_session(app: &tauri::AppHandle, game: &serde_json::Value) {
    let app_id = extract_app_id(game);
    if app_id.is_empty() {
        return;
    }

    let Ok(mut guard) = steam_monitor_state().lock() else {
        return;
    };
    if guard.playtime_sessions.contains_key(&app_id) {
        return;
    }

    let title = game_title(game, &app_id);
    guard.playtime_sessions.insert(
        app_id.clone(),
        GamePlaytimeSession {
            started_at: std::time::SystemTime::now(),
            title: title.clone(),
        },
    );
    drop(guard);
    let _ = record_game_launch_playtime(app, &app_id);
    emit_game_playtimes_snapshot(app);
    if let Some(steam_path) = crate::resolve_steam_path(app, None).0 {
        crate::achievement_monitor::start_local_achievement_monitor(
            app,
            &app_id,
            &title,
            &steam_path,
        );
    }
}

pub(crate) fn close_game_playtime_session(app: &tauri::AppHandle, app_id: &str) -> Option<String> {
    crate::achievement_monitor::stop_local_achievement_monitor(app_id);
    let session = steam_monitor_state()
        .lock()
        .ok()?
        .playtime_sessions
        .remove(app_id)?;
    let title = session.title;
    let _ = record_game_session_playtime(app, app_id, session.started_at);
    emit_game_playtimes_snapshot(app);
    Some(title)
}

pub(crate) fn close_all_game_playtime_sessions(app: &tauri::AppHandle) {
    let app_ids = steam_monitor_state()
        .lock()
        .ok()
        .map(|guard| guard.playtime_sessions.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();

    for app_id in app_ids {
        close_game_playtime_session(app, &app_id);
    }
}

fn is_local_automatic_backup_enabled(app: &tauri::AppHandle, app_id: &str) -> bool {
    let settings = crate::load_backup_settings(app);
    if settings
        .get("automaticBackupsForLibrary")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        return true;
    }

    settings
        .get("automaticBackups")
        .and_then(|value| value.get(app_id))
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

fn has_cloud_session(app: &tauri::AppHandle) -> bool {
    crate::cloud_save::cloud_get_session(app.clone())
        .and_then(|session| {
            session
                .get("token")
                .and_then(|value| value.as_str())
                .map(|token| !token.trim().is_empty())
        })
        .unwrap_or(false)
}

pub(crate) fn run_automatic_backup_after_close(
    app: tauri::AppHandle,
    app_id: String,
    title_fallback: String,
    game: serde_json::Value,
) {
    std::thread::spawn(move || {
        {
            let Ok(mut guard) = steam_monitor_state().lock() else {
                return;
            };
            if guard.backup_in_progress.contains(&app_id) {
                return;
            }
            let now = current_millis();
            if let Some(last_backup_at) = guard.last_automatic_backup_at.get(&app_id) {
                if now.saturating_sub(*last_backup_at) < AUTOMATIC_BACKUP_DEBOUNCE_WINDOW_MS {
                    return;
                }
            }
            guard.backup_in_progress.insert(app_id.clone());
        }

        let should_run_local = is_local_automatic_backup_enabled(&app, &app_id);
        let should_run_cloud = has_cloud_session(&app);
        if !should_run_local && !should_run_cloud {
            if let Ok(mut guard) = steam_monitor_state().lock() {
                guard.backup_in_progress.remove(&app_id);
            }
            return;
        }

        std::thread::sleep(std::time::Duration::from_millis(
            AUTOMATIC_BACKUP_DELAY_AFTER_CLOSE_MS,
        ));

        let backup_game = if extract_app_id(&game).is_empty() {
            resolve_backup_game(&app_id, &title_fallback)
        } else {
            game
        };

        let mut local_ok = false;
        if should_run_local {
            match crate::backup::backup_run_game_local(app.clone(), backup_game.clone()) {
                Ok(result) => {
                    local_ok = result
                        .get("success")
                        .and_then(|value| value.as_bool())
                        .unwrap_or(false);
                }
                Err(_) => {
                    local_ok = false;
                }
            }
        }

        let mut cloud_ok = false;
        if should_run_cloud {
            cloud_ok = tauri::async_runtime::block_on(crate::cloud_save::cloud_backup_game(
                app.clone(),
                backup_game.clone(),
            ))
            .is_ok();
        }

        // If only cloud was attempted and it failed, record the failure so the UI can show it.
        if !local_ok && should_run_cloud && !cloud_ok && !should_run_local {
            let title = game_title(&backup_game, &app_id);
            let _ = crate::save_failed_backup_record(
                &app,
                &app_id,
                &title,
                "",
                "Falha no backup automático em nuvem.",
            );
        }

        if let Ok(mut guard) = steam_monitor_state().lock() {
            guard
                .last_automatic_backup_at
                .insert(app_id.clone(), current_millis());
            guard.backup_in_progress.remove(&app_id);
        }
    });
}

fn poll_steam_running_app_id(app: &tauri::AppHandle) {
    let Some(running_app_id) = read_steam_running_app_id() else {
        return;
    };

    if running_app_id != "0" {
        if crate::ghostbox_library::is_library_app_blocked(&running_app_id, "") {
            return;
        }

        let closed_app_id = {
            let Ok(guard) = steam_monitor_state().lock() else {
                return;
            };
            let previous = guard.active_running_app_id.clone();
            if previous.as_deref() == Some(running_app_id.as_str()) {
                None
            } else {
                previous.filter(|value| value != &running_app_id)
            }
        };

        if let Some(closed_app_id) = closed_app_id {
            if let Ok(mut guard) = steam_monitor_state().lock() {
                guard.pending_games.remove(&closed_app_id);
                guard.pending_game_registered_at.remove(&closed_app_id);
                guard.process_fallback_started.remove(&closed_app_id);
            }
            let title = close_game_playtime_session(app, &closed_app_id).unwrap_or_default();
            let game = resolve_backup_game(&closed_app_id, &title);
            run_automatic_backup_after_close(app.clone(), closed_app_id, title, game);
        }

        let should_open_session = {
            let Ok(guard) = steam_monitor_state().lock() else {
                return;
            };
            !guard.playtime_sessions.contains_key(&running_app_id)
        };

        if should_open_session {
            let game = {
                let Ok(guard) = steam_monitor_state().lock() else {
                    return;
                };
                guard
                    .pending_games
                    .get(&running_app_id)
                    .cloned()
                    .unwrap_or_else(|| resolve_backup_game(&running_app_id, ""))
            };
            open_game_playtime_session(app, &game);
        }

        if let Ok(mut guard) = steam_monitor_state().lock() {
            guard.active_running_app_id = Some(running_app_id);
        }
        return;
    }

    let closed_app_id = steam_monitor_state().lock().ok().and_then(|mut guard| {
        let closed = guard.active_running_app_id.take();
        if let Some(app_id) = closed.as_ref() {
            guard.pending_games.remove(app_id);
            guard.pending_game_registered_at.remove(app_id);
            guard.process_fallback_started.remove(app_id);
        }
        closed
    });

    let Some(closed_app_id) = closed_app_id else {
        return;
    };

    let title = close_game_playtime_session(app, &closed_app_id).unwrap_or_default();
    let game = resolve_backup_game(&closed_app_id, &title);
    run_automatic_backup_after_close(app.clone(), closed_app_id, title, game);
}

#[cfg(windows)]
fn poll_pending_steam_process_fallbacks(app: &tauri::AppHandle) {
    let now = current_millis();
    let pending = steam_monitor_state()
        .lock()
        .map(|guard| {
            guard
                .pending_games
                .iter()
                .filter_map(|(app_id, game)| {
                    if guard.playtime_sessions.contains_key(app_id)
                        || guard.process_fallback_started.contains(app_id)
                    {
                        return None;
                    }
                    let registered_at = guard.pending_game_registered_at.get(app_id).copied()?;
                    if now.saturating_sub(registered_at) < STEAM_PENDING_PROCESS_FALLBACK_AFTER_MS {
                        return None;
                    }
                    let executable_path = find_likely_game_executable(game)?;
                    Some((app_id.clone(), game.clone(), executable_path))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    for (app_id, game, executable_path) in pending {
        let should_start = steam_monitor_state().lock().is_ok_and(|mut guard| {
            if guard.playtime_sessions.contains_key(&app_id)
                || guard.process_fallback_started.contains(&app_id)
            {
                return false;
            }
            guard.process_fallback_started.insert(app_id.clone());
            true
        });
        if should_start {
            monitor_game_process(app.clone(), game, app_id, executable_path);
        }
    }
}

#[cfg(not(windows))]
fn poll_pending_steam_process_fallbacks(_app: &tauri::AppHandle) {}

pub(crate) fn start_steam_running_app_monitor(app: tauri::AppHandle) {
    #[cfg(not(windows))]
    {
        let _ = app;
        return;
    }

    #[cfg(windows)]
    std::thread::spawn(move || loop {
        poll_steam_running_app_id(&app);
        poll_pending_steam_process_fallbacks(&app);
        std::thread::sleep(std::time::Duration::from_millis(
            STEAM_RUNNING_APP_MONITOR_INTERVAL_MS,
        ));
    });
}

pub(crate) fn find_likely_game_executable(game: &serde_json::Value) -> Option<std::path::PathBuf> {
    let install_path = text_value(game.get("installPath"));
    let root = std::path::PathBuf::from(install_path);
    if !root.is_dir() {
        return None;
    }

    let title = text_value(game.get("title")).to_lowercase();
    let install_dir = text_value(game.get("installDir")).to_lowercase();
    let mut candidates: Vec<(u8, u64, std::path::PathBuf)> = Vec::new();
    collect_executable_candidates(&root, &root, 0, &title, &install_dir, &mut candidates);
    candidates.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| right.1.cmp(&left.1)));
    candidates.into_iter().map(|(_, _, path)| path).next()
}

fn collect_executable_candidates(
    root: &std::path::Path,
    current: &std::path::Path,
    depth: usize,
    title: &str,
    install_dir: &str,
    candidates: &mut Vec<(u8, u64, std::path::PathBuf)>,
) {
    if depth > 3 || candidates.len() > 200 {
        return;
    }

    let Ok(entries) = std::fs::read_dir(current) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if path.is_dir() {
            if !matches!(
                name.as_str(),
                "_commonredist" | "redist" | "redistributables" | "directx"
            ) {
                collect_executable_candidates(
                    root,
                    &path,
                    depth + 1,
                    title,
                    install_dir,
                    candidates,
                );
            }
            continue;
        }

        if path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
        {
            if name.contains("unins")
                || name.contains("setup")
                || name.contains("crash")
                || name.contains("redist")
            {
                continue;
            }
            let size = entry.metadata().map(|metadata| metadata.len()).unwrap_or(0);
            let file_stem = path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_lowercase();
            let root_name = root
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_lowercase();
            let score = if !install_dir.is_empty() && file_stem == install_dir {
                4
            } else if !title.is_empty() && title.contains(&file_stem) {
                3
            } else if !root_name.is_empty() && file_stem.contains(&root_name) {
                2
            } else if depth <= 1 {
                1
            } else {
                0
            };
            candidates.push((score, size, path));
        }
    }
}

fn is_process_running_by_path(executable_path: &std::path::Path) -> bool {
    let path = executable_path.to_string_lossy();
    if path.is_empty() {
        return false;
    }

    #[cfg(windows)]
    {
        let escaped = path.replace('\'', "''");
        let script = format!(
            "$p = '{}'; [bool](Get-CimInstance Win32_Process | Where-Object {{ $_.ExecutablePath -eq $p }} | Select-Object -First 1)",
            escaped
        );
        return std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .output()
            .ok()
            .map(|output| {
                String::from_utf8_lossy(&output.stdout)
                    .trim()
                    .eq_ignore_ascii_case("true")
            })
            .unwrap_or(false);
    }

    #[cfg(not(windows))]
    {
        return std::process::Command::new("pgrep")
            .arg("-f")
            .arg(path.as_ref())
            .output()
            .ok()
            .is_some_and(|output| output.status.success());
    }
}

pub(crate) fn monitor_game_process(
    app: tauri::AppHandle,
    game: serde_json::Value,
    app_id: String,
    executable_path: std::path::PathBuf,
) {
    std::thread::spawn(move || {
        for _ in 0..60 {
            if is_process_running_by_path(&executable_path) {
                open_game_playtime_session(&app, &game);
                break;
            }
            std::thread::sleep(std::time::Duration::from_secs(5));
        }

        while is_process_running_by_path(&executable_path) {
            std::thread::sleep(std::time::Duration::from_secs(15));
        }

        let session_closed = close_game_playtime_session(&app, &app_id).is_some();
        if let Ok(mut guard) = steam_monitor_state().lock() {
            guard.pending_games.remove(&app_id);
            guard.pending_game_registered_at.remove(&app_id);
            guard.process_fallback_started.remove(&app_id);
        }

        if session_closed {
            run_automatic_backup_after_close(
                app.clone(),
                app_id,
                game_title(&game, &extract_app_id(&game)),
                game,
            );
        }
    });
}

#[tauri::command]
pub(crate) fn game_get_playtimes(app: tauri::AppHandle) -> serde_json::Value {
    // Drop legacy local accumulators so UI cannot re-read fake session totals.
    clear_legacy_local_playtime_cache(&app);
    get_game_playtime_snapshot(&app)
}

fn current_timestamp_string() -> String {
    unix_seconds_to_iso(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    )
}

/// Convert a unix timestamp (seconds since epoch) to an ISO 8601 UTC string.
/// Uses Howard Hinnant's civil-from-days algorithm to avoid external crates.
pub(crate) fn unix_seconds_to_iso(epoch_secs: u64) -> String {
    let days = (epoch_secs / 86400) as i64;
    let time_of_day = epoch_secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    let z = days + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };

    format!("{y:04}-{m:02}-{d:02}T{hours:02}:{minutes:02}:{seconds:02}.000Z")
}

fn record_game_launch_playtime_impl(
    app: &tauri::AppHandle,
    app_id: &str,
) -> Result<serde_json::Value, String> {
    let mut snapshot = load_game_playtimes(app);
    let now = current_timestamp_string();
    let current = snapshot
        .get(app_id)
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let play_time = current
        .get("playTimeInMilliseconds")
        .and_then(|value| value.as_u64())
        .unwrap_or(0);

    snapshot[app_id] = serde_json::json!({
        "appId": app_id,
        "playTimeInMilliseconds": play_time,
        "lastTimePlayed": now
    });
    save_game_playtimes(app, &snapshot)?;
    emit_game_playtimes_changed(app, &snapshot);
    Ok(snapshot)
}

fn record_game_session_playtime(
    app: &tauri::AppHandle,
    app_id: &str,
    started_at: std::time::SystemTime,
) -> Result<serde_json::Value, String> {
    let duration = started_at
        .elapsed()
        .map_err(|error| error.to_string())?
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX);
    if duration == 0 {
        return Ok(load_game_playtimes(app));
    }

    // Do not accumulate local session time into totals — Steam is the only source.
    // Only refresh last-played / session metadata for UI.
    let mut snapshot = load_game_playtimes(app);
    let now = current_timestamp_string();
    let current = snapshot
        .get(app_id)
        .cloned()
        .unwrap_or_else(|| serde_json::json!({ "appId": app_id }));
    let play_time = current
        .get("playTimeInMilliseconds")
        .and_then(|value| value.as_u64())
        .unwrap_or(0);

    snapshot[app_id] = serde_json::json!({
        "appId": app_id,
        "playTimeInMilliseconds": play_time,
        "lastTimePlayed": now,
        "lastSessionRecordedAt": now,
        "lastSessionDurationInMilliseconds": duration
    });
    save_game_playtimes(app, &snapshot)?;
    emit_game_playtimes_changed(app, &snapshot);
    Ok(snapshot)
}

pub(crate) fn record_game_launch_playtime(
    app: &tauri::AppHandle,
    app_id: &str,
) -> Result<serde_json::Value, String> {
    record_game_launch_playtime_impl(app, app_id)
}

pub(crate) fn rfc3339_millis(value: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|value| value.timestamp_millis())
        .unwrap_or(0)
}

/// Apply playtime restored from a backup snapshot for a single game.
/// Uses the maximum of current vs backup playtime so multi-PC progress is not lost.
pub(crate) fn apply_playtime_from_backup(
    app: &tauri::AppHandle,
    app_id: &str,
    payload: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let app_id: String = app_id.chars().filter(|ch| ch.is_ascii_digit()).collect();
    if app_id.is_empty() {
        return Err("AppId inválido para restaurar tempo de jogo.".to_string());
    }

    let backup_play_time = payload
        .get("playTimeInMilliseconds")
        .and_then(|value| value.as_u64())
        .unwrap_or(0);
    let backup_last_played = payload
        .get("lastTimePlayed")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let backup_last_session_at = payload
        .get("lastSessionRecordedAt")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let backup_last_session_duration = payload
        .get("lastSessionDurationInMilliseconds")
        .and_then(|value| value.as_u64());

    let mut snapshot = load_game_playtimes(app);
    let current = snapshot
        .get(&app_id)
        .cloned()
        .unwrap_or_else(|| serde_json::json!({ "appId": app_id }));
    let current_play_time = current
        .get("playTimeInMilliseconds")
        .and_then(|value| value.as_u64())
        .unwrap_or(0);
    let play_time = current_play_time.max(backup_play_time);

    let current_last_played = current
        .get("lastTimePlayed")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let last_time_played = match (current_last_played.as_deref(), backup_last_played.as_deref()) {
        (Some(current_value), Some(backup_value)) => {
            if rfc3339_millis(backup_value) >= rfc3339_millis(current_value) {
                backup_value.to_string()
            } else {
                current_value.to_string()
            }
        }
        (Some(current_value), None) => current_value.to_string(),
        (None, Some(backup_value)) => backup_value.to_string(),
        (None, None) => current_timestamp_string(),
    };

    let mut next = serde_json::json!({
        "appId": app_id,
        "playTimeInMilliseconds": play_time,
        "lastTimePlayed": last_time_played,
    });
    if let Some(value) = backup_last_session_at.or_else(|| {
        current
            .get("lastSessionRecordedAt")
            .and_then(|value| value.as_str())
            .map(str::to_string)
    }) {
        next["lastSessionRecordedAt"] = serde_json::json!(value);
    }
    if let Some(value) = backup_last_session_duration.or_else(|| {
        current
            .get("lastSessionDurationInMilliseconds")
            .and_then(|item| item.as_u64())
    }) {
        next["lastSessionDurationInMilliseconds"] = serde_json::json!(value);
    }

    snapshot[&app_id] = next;
    save_game_playtimes(app, &snapshot)?;
    emit_game_playtimes_changed(app, &snapshot);
    Ok(snapshot)
}
