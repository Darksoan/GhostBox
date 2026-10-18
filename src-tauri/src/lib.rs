pub(crate) const FACETS_VERSION: &str = "catalogue-response-v2";
pub(crate) const RANKING_VERSION: &str = "ranking-v9-quality-score";
const BACKUP_SETTINGS_FILE: &str = "backup-settings.json";
const STEAM_LIBRARY_PATH_FILE: &str = "steam-library-path.json";
const BACKUP_SETTINGS_CHANGED_EVENT: &str = "backup-settings-changed";

const GHOSTBOX_ACHIEVEMENTS_BACKUP_FILE: &str = "ghostbox-achievements.json";
const GHOSTBOX_PLAYTIME_BACKUP_FILE: &str = "ghostbox-playtime.json";

#[derive(Debug, Clone, Default)]
pub(crate) struct ProfileProgressSnapshot {
    pub has_achievements: bool,
    pub achievement_count: Option<usize>,
    pub has_playtime: bool,
}

impl ProfileProgressSnapshot {
    pub fn has_any(&self) -> bool {
        self.has_achievements || self.has_playtime
    }
}

mod achievement_monitor;
mod backup;
mod catalogue;
mod catalogue_cache;
mod cdndownload;
mod download_storage;
mod chunk_index;
mod cloud_save;
mod ghostbox_library;
mod goldberg;
mod image_cache;
mod luatools;
mod luatools_bootstrap;
mod ludusavi;
mod manifest_sources;
mod oauth_loopback;
mod playtime;
mod settings;
mod steam;
mod steam_appcache;
mod steam_appinfo;
mod steam_appmanifest;
mod steam_assets;
mod steam_localconfig;
mod steam_pics;
mod storage_audit;
mod subscription;
mod util;
mod window_lifecycle;

pub(crate) use catalogue::normalize_api_url;
pub(crate) use settings::load_startup_settings;

use settings::{read_json_file, write_json_file};
use tauri::Manager;
use util::{object_or_empty, text_value, EmptyStringExt};

fn default_backup_settings() -> serde_json::Value {
    serde_json::json!({ "backupRecords": {} })
}

fn normalize_backup_settings(value: Option<serde_json::Value>) -> serde_json::Value {
    let Some(value) = value.and_then(|value| value.as_object().cloned()) else {
        return default_backup_settings();
    };

    let mut records = object_or_empty(value.get("backupRecords"));

    // Migração: registros de falha que na verdade eram bloqueio de plano
    // ("requer Premium" / "faça login") não são falhas reais e hoje o gate no
    // playtime nem os produz mais. Saem na primeira leitura para a UI nunca
    // mais exibir erro vermelho por causa deles.
    if let Some(records) = records.as_object_mut() {
        strip_blocked_plan_backup_errors(records);
        // Registros locais antigos não representam saves na nuvem. Não os
        // exponha como backups atuais; os arquivos dos jogos não são apagados.
        records.retain(|_, record| {
            record.get("cloud").and_then(|value| value.as_bool()) == Some(true)
                || record
                    .get("lastCloudBackupAt")
                    .and_then(|value| value.as_str())
                    .is_some_and(|date| !date.is_empty())
        });
        for record in records.values_mut() {
            if let Some(record) = record.as_object_mut() {
                record.remove("lastBackupPath");
                record.remove("entries");
            }
        }
    }

    serde_json::json!({ "backupRecords": records })
}

/// Remove dos `backupRecords` as falhas que eram bloqueio de plano.
fn strip_blocked_plan_backup_errors(records: &mut serde_json::Map<String, serde_json::Value>) {
    records.retain(|_, record| {
        let error = record
            .get("lastBackupError")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        !is_blocked_plan_backup_error(error)
    });
}

/// Mensagens que o fluxo antigo gravava quando o bloqueio era de plano, não
/// uma falha real. Qualquer correspondência exata descarta o registro.
fn is_blocked_plan_backup_error(error: &str) -> bool {
    const BLOCKED_ERRORS: [&str; 2] = [
        "Backup em nuvem requer GhostBox Premium.",
        "Backup em nuvem ignorado: faça login com a Steam.",
    ];
    BLOCKED_ERRORS.contains(&error.trim())
}

pub(crate) fn load_backup_settings(app: &tauri::AppHandle) -> serde_json::Value {
    normalize_backup_settings(read_json_file(app, BACKUP_SETTINGS_FILE))
}

pub(crate) fn save_backup_settings(
    app: &tauri::AppHandle,
    patch: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let current = load_backup_settings(app);
    let mut records = current
        .get("backupRecords")
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();
    if let Some(changed) = patch
        .get("backupRecords")
        .and_then(|value| value.as_object())
    {
        for (app_id, record) in changed {
            records.insert(app_id.clone(), record.clone());
        }
    }
    persist_backup_settings(app, serde_json::json!({ "backupRecords": records }))
}

pub(crate) fn persist_backup_settings(
    app: &tauri::AppHandle,
    settings: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let normalized = normalize_backup_settings(Some(settings));
    write_json_file(app, BACKUP_SETTINGS_FILE, &normalized)?;
    emit_backup_settings_changed(app, &normalized);
    Ok(normalized)
}

fn emit_backup_settings_changed(app: &tauri::AppHandle, settings: &serde_json::Value) {
    use tauri::Emitter;

    let _ = app.emit(BACKUP_SETTINGS_CHANGED_EVENT, settings.clone());
}

fn current_timestamp_string() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub(crate) fn steam_asset_url(app_id: &str, file_name: &str) -> String {
    format!("https://cdn.cloudflare.steamstatic.com/steam/apps/{app_id}/{file_name}")
}

/// Steam's own record of where it is installed (Windows registry, or the
/// platform equivalent). Catches installs on drives other than C:, which the
/// hardcoded candidates below miss entirely.
///
/// Cached: `resolve_steam_path` runs this on every call — including per-image
/// paths in `image_cache.rs` — and Steam does not move while GhostBox is
/// running, so a registry hit per lookup would be pure waste.
fn located_steam_path() -> Option<&'static String> {
    static LOCATED: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    LOCATED
        .get_or_init(|| {
            steamlocate::SteamDir::locate()
                .ok()
                .map(|steam_dir| steam_dir.path().to_string_lossy().to_string())
        })
        .as_ref()
}

fn default_steam_path_candidates() -> Vec<String> {
    let mut candidates = Vec::new();

    if let Some(located) = located_steam_path() {
        candidates.push(located.clone());
    }

    candidates.push("C:\\Program Files (x86)\\Steam".to_string());
    candidates.push("C:\\Program Files\\Steam".to_string());

    if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
        candidates.push(format!("{home}\\.steam\\steam"));
        candidates.push(format!("{home}\\.local\\share\\Steam"));
    }

    candidates
}

pub(crate) fn steamapps_path(root: &std::path::Path) -> std::path::PathBuf {
    if root
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("steamapps"))
    {
        root.to_path_buf()
    } else {
        root.join("steamapps")
    }
}

fn is_valid_steam_path(path: &std::path::Path) -> bool {
    steamapps_path(path).join("libraryfolders.vdf").exists()
}

pub(crate) fn normalize_steam_root_path(input: &str) -> Option<String> {
    let path = std::path::PathBuf::from(input.trim());
    if !path.exists() {
        return None;
    }

    // Biblioteca válida = pasta que contém `steamapps`. Bibliotecas secundárias
    // (outros discos) NÃO têm `libraryfolders.vdf` próprio — esse arquivo só
    // existe na raiz da instalação da Steam. Exigi-lo aqui descartava toda
    // unidade extra no parser do libraryfolders.vdf: só a raiz sobrevivia.
    let has_steamapps = |candidate: &std::path::Path| candidate.join("steamapps").is_dir();

    if has_steamapps(&path) {
        return Some(path.to_string_lossy().to_string());
    }

    if path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("steamapps"))
    {
        if let Some(parent) = path.parent() {
            return Some(parent.to_string_lossy().to_string());
        }
    }

    None
}

pub(crate) fn load_saved_steam_path(app: &tauri::AppHandle) -> String {
    read_json_file(app, STEAM_LIBRARY_PATH_FILE)
        .and_then(|value| {
            value
                .get("steamPath")
                .and_then(|value| value.as_str())
                .map(ToOwned::to_owned)
        })
        .unwrap_or_default()
}

pub(crate) fn save_steam_path(app: &tauri::AppHandle, steam_path: &str) -> Result<(), String> {
    write_json_file(
        app,
        STEAM_LIBRARY_PATH_FILE,
        &serde_json::json!({ "steamPath": steam_path }),
    )
}

pub(crate) fn merge_playtime_into_game(
    mut game: serde_json::Value,
    snapshot: &serde_json::Value,
) -> serde_json::Value {
    let app_id = text_value(game.get("appId"));
    if let Some(playtime) = snapshot.get(&app_id) {
        if let Some(value) = playtime.get("playTimeInMilliseconds") {
            game["playTimeInMilliseconds"] = value.clone();
        }
        if let Some(value) = playtime.get("lastTimePlayed") {
            game["lastTimePlayed"] = value.clone();
        }
        if let Some(value) = playtime.get("lastSessionRecordedAt") {
            game["lastSessionRecordedAt"] = value.clone();
        }
        if let Some(value) = playtime.get("lastSessionDurationInMilliseconds") {
            game["lastSessionDurationInMilliseconds"] = value.clone();
        }
        if let Some(value) = playtime.get("sessionActive") {
            game["sessionActive"] = value.clone();
        }
    }
    game
}

pub(crate) fn resolve_steam_path(
    app: &tauri::AppHandle,
    steam_path: Option<String>,
) -> (Option<String>, Vec<String>) {
    let mut checked = Vec::new();
    let mut candidates = Vec::new();

    if let Some(path) = steam_path
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
    {
        candidates.push(path);
    }

    let saved = load_saved_steam_path(app);
    if !saved.is_empty() {
        candidates.push(saved);
    }

    candidates.extend(default_steam_path_candidates());

    for candidate in candidates {
        if checked.iter().any(|path| path == &candidate) {
            continue;
        }
        checked.push(candidate.clone());

        if let Some(path) = normalize_steam_root_path(&candidate) {
            return (Some(path), checked);
        }
    }

    (None, checked)
}

pub(crate) fn extract_app_id(value: &serde_json::Value) -> String {
    text_value(value.get("appId"))
        .chars()
        .filter(char::is_ascii_digit)
        .collect()
}

fn normalize_search_text(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_alphanumeric())
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

pub(crate) fn enrich_game_with_local_achievement_stats(
    _app: &tauri::AppHandle,
    mut game: serde_json::Value,
    steam_path: &str,
) -> serde_json::Value {
    let app_id = extract_app_id(&game);
    if app_id.is_empty() {
        return game;
    }

    let achievements = steam_appcache::read_local_achievement_stats(
        steam_path,
        &app_id,
        &serde_json::json!({ "unlocked": 0, "total": 0, "progress": 0 }),
    );
    if achievements
        .get("total")
        .and_then(|value| value.as_u64())
        .unwrap_or(0)
        == 0
    {
        return game;
    }

    if let Some(object) = game.as_object_mut() {
        object.insert("achievements".to_string(), achievements);
    }
    game
}

fn mark_local_unlocked_achievements(
    app_id: &str,
    steam_path: &str,
    achievements: Vec<serde_json::Value>,
) -> Vec<serde_json::Value> {
    if achievements.is_empty() {
        return achievements;
    }

    let unlocked_names = steam_appcache::read_local_unlocked_achievement_names(steam_path, app_id);

    if unlocked_names.is_empty() {
        return achievements;
    }

    let normalized_unlocked_names = unlocked_names
        .iter()
        .map(|value| normalize_search_text(value))
        .collect::<std::collections::HashSet<_>>();
    achievements
        .into_iter()
        .map(|achievement| {
            let name = text_value(achievement.get("name"));
            let title = text_value(achievement.get("title"));
            let normalized_name = normalize_search_text(&name);
            let normalized_title = normalize_search_text(&title);

            let unlocked = normalized_unlocked_names.contains(&normalized_name)
                || normalized_unlocked_names.contains(&normalized_title)
                || achievement
                    .get("unlocked")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false);

            let mut next = achievement;
            if let Some(object) = next.as_object_mut() {
                object.insert("unlocked".to_string(), serde_json::Value::Bool(unlocked));
            }
            next
        })
        .collect()
}

pub(crate) fn merge_game_achievement_details(
    _app: &tauri::AppHandle,
    mut game: serde_json::Value,
    steam_path: &str,
) -> serde_json::Value {
    let app_id = extract_app_id(&game);
    if app_id.is_empty() {
        return game;
    }

    let achievement_list = game
        .get("achievementList")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    if achievement_list.is_empty() {
        return game;
    }

    let achievement_list = mark_local_unlocked_achievements(&app_id, steam_path, achievement_list);
    let unlocked_count = achievement_list
        .iter()
        .filter(|achievement| {
            achievement
                .get("unlocked")
                .and_then(|value| value.as_bool())
                .unwrap_or(false)
        })
        .count();
    let total = achievement_list.len();
    let progress = if total > 0 {
        ((unlocked_count as f64 / total as f64) * 100.0).round() as u32
    } else {
        0
    };

    if let Some(object) = game.as_object_mut() {
        object.insert(
            "achievementList".to_string(),
            serde_json::json!(achievement_list),
        );
        object.insert(
            "achievements".to_string(),
            serde_json::json!({
                "unlocked": unlocked_count,
                "total": total,
                "progress": progress
            }),
        );
    }
    game
}

fn normalize_ghostbox_achievements_backup_file(
    value: &serde_json::Value,
    app_id: &str,
) -> Option<serde_json::Value> {
    let record = value.as_object()?;
    if text_value(record.get("appId")) != app_id {
        return None;
    }
    let unlocked = record
        .get("unlocked")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|achievement| {
                    let achievement = achievement.as_object()?;
                    let name = text_value(achievement.get("name"));
                    if name.is_empty() {
                        return None;
                    }
                    Some(serde_json::json!({
                        "name": name,
                        "title": text_value(achievement.get("title")).if_empty(name.clone()),
                        "unlockedAt": achievement.get("unlockedAt").and_then(|value| value.as_str())
                    }))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let total = record
        .get("total")
        .and_then(|value| value.as_u64())
        .map(|value| value as usize)
        .unwrap_or(unlocked.len())
        .max(unlocked.len());
    Some(serde_json::json!({
        "version": record.get("version").and_then(|value| value.as_u64()).unwrap_or(1),
        "appId": app_id,
        "title": text_value(record.get("title")).if_empty(app_id.to_string()),
        "updatedAt": text_value(record.get("updatedAt")),
        "source": text_value(record.get("source")).if_empty("ghostbox".to_string()),
        "total": total,
        "unlocked": unlocked
    }))
}

fn read_cloud_achievements_file(
    app_id: &str,
    restore_path: &std::path::Path,
) -> Option<serde_json::Value> {
    let raw = std::fs::read_to_string(restore_path.join(GHOSTBOX_ACHIEVEMENTS_BACKUP_FILE)).ok()?;
    let parsed = serde_json::from_str::<serde_json::Value>(&raw).ok()?;
    normalize_ghostbox_achievements_backup_file(&parsed, app_id)
}

fn write_cloud_achievements_file(
    file: &serde_json::Value,
    staging_path: &std::path::Path,
) -> Result<(), String> {
    let file_path = staging_path.join(GHOSTBOX_ACHIEVEMENTS_BACKUP_FILE);
    let contents = serde_json::to_string_pretty(file).map_err(|error| error.to_string())?;
    std::fs::write(&file_path, contents).map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn save_failed_backup_record(
    app: &tauri::AppHandle,
    app_id: &str,
    title: &str,
    error: &str,
) -> Result<serde_json::Value, String> {
    save_backup_record(
        app,
        app_id,
        serde_json::json!({
            "title": title,
            "cloud": true,
            "lastBackupAt": current_timestamp_string(),
            "lastBackupSuccess": false,
            "lastBackupError": error,
        }),
    )
}

/// Export full profile progress for a game into a backup directory:
/// Steam achievement stats files, GhostBox achievements JSON, and playtime.
pub(crate) fn export_game_profile_progress(
    app: &tauri::AppHandle,
    app_id: &str,
    title: &str,
    backup_path: &std::path::Path,
) -> ProfileProgressSnapshot {
    let mut snapshot = ProfileProgressSnapshot::default();
    if app_id.is_empty() {
        return snapshot;
    }
    let _ = std::fs::create_dir_all(backup_path);

    let steam_path = resolve_steam_path(app, None).0;
    if let Some(ref steam_path) = steam_path {
        steam_appcache::backup_steam_achievement_files(steam_path, app_id, backup_path);
        let achievements_dir = backup_path.join(steam_appcache::STEAM_ACHIEVEMENTS_BACKUP_FOLDER);
        if achievements_dir.is_dir() && directory_has_content(&achievements_dir) {
            snapshot.has_achievements = true;
        }
    }

    let achievements_file = steam_path.as_ref().and_then(|steam_path| {
        steam_appcache::read_steam_local_achievement_backup_file(steam_path, app_id, title)
    });

    if let Some(file) = achievements_file {
        snapshot.achievement_count = file
            .get("unlocked")
            .and_then(|value| value.as_array())
            .map(Vec::len);
        if write_cloud_achievements_file(&file, backup_path).is_ok() {
            snapshot.has_achievements = true;
        }
    }

    if let Some(playtime_entry) = playtime::load_game_playtimes(app).get(app_id).cloned() {
        let play_time = playtime_entry
            .get("playTimeInMilliseconds")
            .and_then(|value| value.as_u64())
            .unwrap_or(0);
        let payload = serde_json::json!({
            "version": 1,
            "appId": app_id,
            "title": title,
            "updatedAt": current_timestamp_string(),
            "playTimeInMilliseconds": play_time,
            "lastTimePlayed": playtime_entry.get("lastTimePlayed").cloned(),
            "lastSessionRecordedAt": playtime_entry.get("lastSessionRecordedAt").cloned(),
            "lastSessionDurationInMilliseconds": playtime_entry
                .get("lastSessionDurationInMilliseconds")
                .cloned(),
        });
        let playtime_path = backup_path.join(GHOSTBOX_PLAYTIME_BACKUP_FILE);
        if let Ok(contents) = serde_json::to_string_pretty(&payload) {
            if std::fs::write(&playtime_path, contents).is_ok() {
                snapshot.has_playtime = play_time > 0
                    || playtime_entry.get("lastTimePlayed").is_some()
                    || playtime_entry.get("lastSessionRecordedAt").is_some();
            }
        }
    }

    snapshot
}

/// Restore full profile progress from a backup directory into this PC.
pub(crate) fn import_game_profile_progress(
    app: &tauri::AppHandle,
    app_id: &str,
    backup_path: &std::path::Path,
) -> ProfileProgressSnapshot {
    let mut snapshot = ProfileProgressSnapshot::default();
    if app_id.is_empty() || !backup_path.exists() {
        return snapshot;
    }

    if let Some(steam_path) = resolve_steam_path(app, None).0 {
        steam_appcache::restore_steam_achievement_files(&steam_path, app_id, backup_path);
        let restored_dir = [
            steam_appcache::STEAM_ACHIEVEMENTS_BACKUP_FOLDER,
            "eden-steam-achievements",
            "piratebox-steam-achievements",
        ]
        .into_iter()
        .map(|folder| backup_path.join(folder))
        .find(|path| path.is_dir());
        if restored_dir.is_some() {
            snapshot.has_achievements = true;
        }
    }

    if let Some(file) = read_cloud_achievements_file(app_id, backup_path) {
        snapshot.achievement_count = file
            .get("unlocked")
            .and_then(|value| value.as_array())
            .map(Vec::len);
        snapshot.has_achievements = true;
    }

    let playtime_path = backup_path.join(GHOSTBOX_PLAYTIME_BACKUP_FILE);
    if playtime_path.is_file() {
        if let Ok(contents) = std::fs::read_to_string(&playtime_path) {
            if let Ok(payload) = serde_json::from_str::<serde_json::Value>(&contents) {
                if playtime::apply_playtime_from_backup(app, app_id, &payload).is_ok() {
                    snapshot.has_playtime = true;
                }
            }
        }
    }

    snapshot
}

/// Updates backup status after a successful cloud upload without requiring a local folder entry.
pub(crate) fn save_cloud_backup_success_record(
    app: &tauri::AppHandle,
    app_id: &str,
    title: &str,
    size_bytes: u64,
) -> Result<serde_json::Value, String> {
    save_backup_record(
        app,
        app_id,
        serde_json::json!({
            "title": title,
            "cloud": true,
            "lastBackupAt": current_timestamp_string(),
            "lastBackupSuccess": true,
            "lastBackupSizeBytes": size_bytes,
            "lastCloudBackupAt": current_timestamp_string(),
        }),
    )
}

pub(crate) fn save_backup_record(
    app: &tauri::AppHandle,
    app_id: &str,
    record: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut records = serde_json::Map::new();
    records.insert(app_id.to_string(), record);
    save_backup_settings(app, serde_json::json!({ "backupRecords": records }))
}

pub(crate) fn directory_has_content(path: &std::path::Path) -> bool {
    let Ok(entries) = std::fs::read_dir(path) else {
        return false;
    };

    entries.flatten().next().is_some()
}

pub(crate) fn launch_game_from_value(
    app: tauri::AppHandle,
    game: serde_json::Value,
) -> Result<serde_json::Value, String> {
    use tauri_plugin_opener::OpenerExt;

    let app_id = extract_app_id(&game);
    if app_id.is_empty() {
        return Ok(serde_json::json!({
            "success": false,
            "appId": "",
            "error": "AppId inválido."
        }));
    }

    // Launch overrides and arguments are intentionally no longer honored.
    let launch_arguments = "";

    if !launch_arguments.is_empty() {
        let Some(steam_path) = resolve_steam_path(&app, None).0 else {
            return Ok(serde_json::json!({
                "success": false,
                "appId": app_id,
                "error": "Steam installation was not found."
            }));
        };
        let steam_executable = std::path::PathBuf::from(&steam_path).join("steam.exe");
        let mut command = std::process::Command::new(steam_executable);
        command
            .current_dir(steam_path)
            .arg("-applaunch")
            .arg(&app_id)
            .args(parse_launch_arguments(launch_arguments));
        match command.spawn() {
            Ok(_) => {
                playtime::register_pending_steam_game(game.clone());
                let _ = playtime::record_game_launch_playtime(&app, &app_id);
                Ok(serde_json::json!({
                    "success": true,
                    "appId": app_id,
                    "launchMethod": "steam-applaunch"
                }))
            }
            Err(error) => Ok(serde_json::json!({
                "success": false,
                "appId": app_id,
                "error": format!("Could not launch Steam: {error}")
            })),
        }
    } else {
        let url = format!("steam://rungameid/{app_id}");
        match app.opener().open_url(url, None::<&str>) {
            Ok(_) => {
                playtime::register_pending_steam_game(game.clone());
                let _ = playtime::record_game_launch_playtime(&app, &app_id);
                if let Some(executable_path) = playtime::find_likely_game_executable(&game) {
                    #[cfg(windows)]
                    {
                        let app_handle = app.clone();
                        let fallback_game = game.clone();
                        let fallback_app_id = app_id.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_secs(20));
                            if playtime::mark_process_fallback_started(&fallback_app_id) {
                                playtime::monitor_game_process(
                                    app_handle,
                                    fallback_game,
                                    fallback_app_id,
                                    executable_path,
                                );
                            }
                        });
                    }
                    #[cfg(not(windows))]
                    playtime::monitor_game_process(
                        app.clone(),
                        game.clone(),
                        app_id.clone(),
                        executable_path,
                    );
                }
                Ok(serde_json::json!({
                    "success": true,
                    "appId": app_id
                }))
            }
            Err(error) => Ok(serde_json::json!({
                "success": false,
                "appId": app_id,
                "error": error.to_string()
            })),
        }
    }
}

fn launch_app_id_from_args(args: &[String]) -> Option<String> {
    let index = args.iter().position(|arg| arg == "--ghostbox-launch")?;
    let app_id = args.get(index + 1)?.trim();
    if app_id.is_empty() || !app_id.chars().all(|character| character.is_ascii_digit()) {
        return None;
    }
    Some(app_id.to_string())
}

pub(crate) fn launch_registered_game(
    app: tauri::AppHandle,
    app_id: &str,
) -> Result<serde_json::Value, String> {
    let normalized_app_id = app_id
        .chars()
        .filter(char::is_ascii_digit)
        .collect::<String>();
    if normalized_app_id.is_empty() {
        return Ok(serde_json::json!({
            "success": false,
            "appId": "",
            "error": "AppId inválido."
        }));
    }

    let game = ghostbox_library::read_ghostbox_library_games(&app)
        .into_iter()
        .find(|game| {
            game.get("appId")
                .and_then(|value| value.as_str())
                .map(|value| {
                    value
                        .chars()
                        .filter(char::is_ascii_digit)
                        .collect::<String>()
                        == normalized_app_id
                })
                .unwrap_or(false)
        });
    let Some(game) = game else {
        return Ok(serde_json::json!({
            "success": false,
            "appId": normalized_app_id,
            "error": "Jogo não encontrado na biblioteca."
        }));
    };

    launch_game_from_value(app, game)
}

fn launch_registered_game_from_args(app: &tauri::AppHandle, args: &[String]) {
    let Some(app_id) = launch_app_id_from_args(args) else {
        return;
    };

    match launch_registered_game(app.clone(), &app_id) {
        Ok(result) if result.get("success").and_then(|value| value.as_bool()) == Some(true) => {}
        Ok(result) => eprintln!(
            "GhostBox shortcut launch failed: {}",
            result
                .get("error")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown error")
        ),
        Err(error) => eprintln!("GhostBox shortcut launch failed: {error}"),
    }
}

pub(crate) fn parse_launch_arguments(input: &str) -> Vec<String> {
    let mut arguments = Vec::new();
    let mut current = String::new();
    let mut characters = input.chars().peekable();
    let mut quoted = false;

    while let Some(character) = characters.next() {
        match character {
            '"' => quoted = !quoted,
            '\\' if characters.peek() == Some(&'"') => {
                characters.next();
                current.push('"');
            }
            value if value.is_whitespace() && !quoted => {
                if !current.is_empty() {
                    arguments.push(std::mem::take(&mut current));
                }
            }
            value => current.push(value),
        }
    }
    if !current.is_empty() {
        arguments.push(current);
    }
    arguments
}

fn shortcut_powershell_script() -> &'static str {
    r#"$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $shell = New-Object -ComObject WScript.Shell; $location = $env:GHOSTBOX_SHORTCUT_LOCATION; $base = if ($location -eq 'desktop') { [Environment]::GetFolderPath('Desktop') } else { $shell.SpecialFolders.Item('Programs') }; $name = $env:GHOSTBOX_SHORTCUT_NAME -replace '[<>:\"/\\|?*]', '_'; $path = Join-Path $base ($name + '.lnk'); $shortcut = $shell.CreateShortcut($path); $shortcut.TargetPath = $env:GHOSTBOX_SHORTCUT_TARGET; $shortcut.Arguments = $env:GHOSTBOX_SHORTCUT_ARGUMENTS; $shortcut.WorkingDirectory = $env:GHOSTBOX_SHORTCUT_WORKING_DIRECTORY; $icon = $env:GHOSTBOX_SHORTCUT_ICON; if (-not [string]::IsNullOrWhiteSpace($icon)) { $shortcut.IconLocation = $icon }; $shortcut.Save(); if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Shortcut was not created.' }; Write-Output $path"#
}

#[tauri::command]
async fn game_create_shortcut(
    app: tauri::AppHandle,
    game: serde_json::Value,
    location: String,
) -> Result<serde_json::Value, String> {
    let app_id = extract_app_id(&game);
    let title = text_value(game.get("title"));
    if app_id.is_empty() || title.is_empty() {
        return Err("Game information is incomplete.".to_string());
    }
    if location != "desktop" && location != "start-menu" {
        return Err("Unsupported shortcut location.".to_string());
    }

    let target = std::env::current_exe()
        .map_err(|error| format!("Could not resolve GhostBox executable: {error}"))?;
    let working_directory = target
        .parent()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let target = target.to_string_lossy().to_string();
    let arguments = format!("--ghostbox-launch {app_id}");

    // O alvo continua sendo o GhostBox (mesmo fluxo Steam de Play), mas o
    // `IconLocation` aponta para o `.ico` do jogo quando resolvido. Sem ele,
    // o Windows herda o ícone do launcher.
    let icon_path = catalogue::game_ico_for_shortcut(&app, &app_id)
        .await
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_default();

    // Valores depois de `powershell -Command` são reinterpretados como parte
    // do comando e perdem os limites originais (especialmente paths com
    // espaços). Variáveis de ambiente preservam cada valor sem interpolação.
    let script = shortcut_powershell_script();
    let output = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            script,
        ])
        .env("GHOSTBOX_SHORTCUT_LOCATION", &location)
        .env("GHOSTBOX_SHORTCUT_NAME", &title)
        .env("GHOSTBOX_SHORTCUT_TARGET", &target)
        .env("GHOSTBOX_SHORTCUT_ARGUMENTS", &arguments)
        .env("GHOSTBOX_SHORTCUT_WORKING_DIRECTORY", &working_directory)
        .env("GHOSTBOX_SHORTCUT_ICON", &icon_path)
        .output()
        .map_err(|error| format!("Could not create shortcut: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(serde_json::json!({
        "success": true,
        "path": String::from_utf8_lossy(&output.stdout).trim()
    }))
}

#[tauri::command]
fn game_launch(
    app: tauri::AppHandle,
    game: serde_json::Value,
) -> Result<serde_json::Value, String> {
    launch_game_from_value(app, game)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Manutenção de cache WebView2 ANTES do Builder: aqui o navegador ainda
    // não existe, então as pastas estão destravadas. Barato: só roda de fato
    // quando há flag pendente ou o cache passou do teto.
    storage_audit::webview_cache_boot_maintenance();

    tauri::Builder::default()
        .on_page_load(|webview, payload| {
            if webview.label() == "main"
                && matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
            {
                window_lifecycle::show_main_window_when_ready(webview.app_handle());
            }
        })
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            launch_registered_game_from_args(app, &args);
            window_lifecycle::show_main_window_for_launch_args(app, &args);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_denylist(&["tray-menu"])
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            image_cache::start_image_cache_cleanup(app.handle().clone());
            catalogue_cache::start_catalogue_refresh_scheduler(app.handle().clone());
            // Temporários órfãos de crashes anteriores: fora do disco antes
            // de qualquer escrita nova começar. Fora da thread principal.
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || storage_audit::startup_temp_sweep(&handle));
            }
            window_lifecycle::setup_window_lifecycle(app)?;
            let startup_args = std::env::args().collect::<Vec<_>>();
            launch_registered_game_from_args(app.handle(), &startup_args);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            catalogue::app_get_status,
            catalogue::database_get_games,
            catalogue::database_search_steam_store,
            catalogue::database_get_game_details,
            catalogue::database_get_game_store_details,
            catalogue::database_get_game_achievement_details,
            catalogue::database_get_game_reviews,
            catalogue::catalogue_get_home,
            catalogue::steam_get_featured,
            catalogue::steam_get_player_counts,
            catalogue::steam_get_app_types,
            catalogue::steam_get_game_icon_url,
            catalogue::steam_get_game_icon_urls,
            catalogue::steam_get_local_game_icon_urls,
            catalogue::steam_resolve_game_icon_urls,
            catalogue::app_is_steamtools_installed,
            catalogue::app_install_steamtools,
            catalogue::cache_get_image,
            catalogue::cache_get_images,
            catalogue::cache_lookup_images,
            catalogue::cache_resolve_steam_library_asset,
            catalogue::cache_resolve_steam_library_assets_batch,
            steam_assets::steam_get_asset_manifests,
            steam_assets::steam_get_cached_asset_manifests,
            steam_assets::steam_refresh_asset_manifest,
            settings::app_get_startup_settings,
            settings::app_set_startup_settings,
            settings::app_set_notification_settings,
            steam::steam_get_profile,
            steam::steam_restore_account,
            steam::steam_get_account_stats,
            steam::steam_sync_playtimes,
            steam::steam_get_player_level,
            steam::steam_is_running,
            steam::steam_get_wishlist,
            steam::steam_get_recommended_tags_for_user,
            steam::steam_get_similar_app_ids,
            steam::steam_save_profile,
            steam::steam_connect_account,
            steam::steam_disconnect_account,
            steam::steam_clear_local_profile,
            cloud_save::cloud_get_session,
            cloud_save::cloud_sign_out,
            cloud_save::cloud_register,
            cloud_save::cloud_login,
            cloud_save::cloud_oauth_login,
            cloud_save::cloud_discord_recover_start,
            cloud_save::cloud_discord_recover_confirm,
            cloud_save::cloud_recover_set_password,
            cloud_save::cloud_discord_send_code,
            cloud_save::cloud_discord_confirm_code,
            cloud_save::cloud_change_password,
            steam::cloud_steam_login,
            steam::cloud_steam_recover,
            cloud_save::cloud_get_account,
            cloud_save::cloud_disconnect_connection,
            cloud_save::cloud_list_saves,
            cloud_save::cloud_backup_game,
            cloud_save::cloud_restore_save,
            cloud_save::cloud_delete_save,
            cloud_save::cloud_delete_game_saves,
            cloud_save::cloud_set_save_pinned,
            cloud_save::cloud_get_profile_avatar,
            cloud_save::cloud_put_profile_avatar,
            cloud_save::cloud_get_profile_snapshot,
            cloud_save::cloud_put_profile_snapshot,
            cloud_save::cloud_upload_profile_image,
            cloud_save::cloud_delete_profile_banner,
            subscription::subscription_get_status,
            subscription::subscription_create_checkout,
            subscription::subscription_create_portal_session,
            subscription::subscription_refresh_status,
            subscription::discord_link_start,
            subscription::discord_link_status,
            backup::backup_get_settings,
            steam::steam_select_path,
            steam::steam_scan_library,
            steam::steam_is_game_installed,
            steam::steam_restart,
            cdndownload::cdndownload_default_dir,
            download_storage::downloads_list_destinations,
            cdndownload::cdndownload_download_game,
            cdndownload::cdndownload_cancel_game,
            cdndownload::cdndownload_delete_output_dir,
            cdndownload::cdndownload_register_library,
            game_launch,
            playtime::game_get_playtimes,
            ghostbox_library::ghostbox_library_register_steam_game,
            game_create_shortcut,
            luatools::luatools_add_game,
            luatools::luatools_remove_game,
            luatools_bootstrap::luatools_dependencies_status,
            luatools_bootstrap::luatools_dependencies_ensure,
            storage_audit::storage_usage,
            storage_audit::clear_app_caches,
            storage_audit::clear_storage_category,
            window_lifecycle::window_minimize,
            window_lifecycle::window_close,
            window_lifecycle::tray_set_library_games,
            window_lifecycle::tray_get_library_games,
            window_lifecycle::tray_launch_game,
            window_lifecycle::tray_show_main_window,
            window_lifecycle::tray_navigate,
            window_lifecycle::tray_hide_menu,
            window_lifecycle::tray_quit_application,
            window_lifecycle::shell_open_external,
            window_lifecycle::shell_open_path,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                cdndownload::shutdown_download_worker();
                window_lifecycle::shutdown_app_services(app_handle);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_local_backup_paths_are_not_exposed_as_cloud_backups() {
        let settings = normalize_backup_settings(Some(serde_json::json!({
            "outputPath": "C:\\Users\\player\\Documents\\GhostBoxBackups",
            "automaticBackupsForLibrary": true,
            "backupRecords": {
                "10": { "title": "Local only", "lastBackupPath": "C:\\local", "lastBackupSuccess": true },
                "20": {
                    "title": "Cloud",
                    "lastCloudBackupAt": "2026-09-24T21:38:00Z",
                    "lastBackupPath": "C:\\old-local",
                    "entries": [{ "path": "C:\\old-local" }]
                },
                "30": { "title": "Cloud attempt", "cloud": true, "lastBackupSuccess": false }
            }
        })));

        assert!(settings.get("outputPath").is_none());
        assert!(settings.get("automaticBackupsForLibrary").is_none());
        assert!(settings["backupRecords"].get("10").is_none());
        assert!(settings["backupRecords"]["20"]
            .get("lastBackupPath")
            .is_none());
        assert!(settings["backupRecords"]["20"].get("entries").is_none());
        assert_eq!(settings["backupRecords"]["30"]["cloud"], true);
    }

    #[test]
    fn strips_legacy_blocked_plan_records_but_keeps_real_failures() {
        let mut records = serde_json::Map::new();
        records.insert(
            "480".to_string(),
            serde_json::json!({
                "title": "Free Game",
                "lastBackupAt": "2026-08-01T10:00:00Z",
                "lastBackupSuccess": false,
                "lastBackupError": "Backup em nuvem requer GhostBox Premium."
            }),
        );
        records.insert(
            "481".to_string(),
            serde_json::json!({
                "title": "Not Linked",
                "lastBackupSuccess": false,
                "lastBackupError": "Backup em nuvem ignorado: faça login com a Steam."
            }),
        );
        records.insert(
            "367520".to_string(),
            serde_json::json!({
                "title": "Real Failure",
                "lastBackupSuccess": false,
                "lastBackupError": "Falha ao enviar o backup para a nuvem."
            }),
        );

        strip_blocked_plan_backup_errors(&mut records);

        assert!(!records.contains_key("480"), "bloqueio premium deve sair");
        assert!(
            !records.contains_key("481"),
            "aviso de login (fluxo antigo) deve sair"
        );
        assert!(
            records.contains_key("367520"),
            "falha real de rede/upload permanece"
        );
    }

    #[test]
    fn blocked_error_match_tolerates_whitespace_only() {
        assert!(is_blocked_plan_backup_error(
            "  Backup em nuvem requer GhostBox Premium.  "
        ));
        assert!(!is_blocked_plan_backup_error(""));
        assert!(!is_blocked_plan_backup_error(
            "Falha ao enviar o backup para a nuvem."
        ));
    }

    #[test]
    fn launch_arguments_preserve_quoted_values_without_using_a_shell() {
        assert_eq!(
            parse_launch_arguments(r#"-windowed -path "C:\Games\My Game" -name "two words""#),
            vec![
                "-windowed",
                "-path",
                r#"C:\Games\My Game"#,
                "-name",
                "two words",
            ]
        );
    }

    #[test]
    fn shortcut_script_sets_game_icon_location() {
        let script = super::shortcut_powershell_script();
        assert!(
            script.contains("$shortcut.IconLocation"),
            "atalho precisa definir IconLocation para não herdar o ícone do launcher"
        );
        assert!(
            script.contains("GHOSTBOX_SHORTCUT_ICON"),
            "ícone do jogo precisa chegar via variável de ambiente"
        );
    }

    #[test]
    fn shortcut_launch_arguments_extract_only_numeric_app_ids() {
        assert_eq!(
            super::launch_app_id_from_args(&[
                "GhostBox.exe".to_string(),
                "--ghostbox-launch".to_string(),
                "620".to_string(),
            ]),
            Some("620".to_string())
        );
        assert_eq!(
            super::launch_app_id_from_args(&[
                "GhostBox.exe".to_string(),
                "--ghostbox-launch".to_string(),
                "620;evil".to_string(),
            ]),
            None
        );
        assert_eq!(
            super::launch_app_id_from_args(&["GhostBox.exe".to_string()]),
            None
        );
    }
}

#[cfg(test)]
mod normalize_steam_root_tests {
    use super::normalize_steam_root_path;
    use std::path::PathBuf;

    fn temp_root(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "ghostbox-{tag}-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4().simple()
        ))
    }

    /// Bibliotecas secundárias não têm `libraryfolders.vdf` próprio — só a
    /// raiz da instalação da Steam tem. A validação não pode exigir o arquivo
    /// dentro de cada biblioteca, senão todo disco extra é descartado.
    #[test]
    fn accepts_secondary_libraries_without_local_libraryfolders_vdf() {
        let root = temp_root("steam-root");
        let library = root.join("SteamLibrary");
        std::fs::create_dir_all(library.join("steamapps").join("common")).unwrap();

        assert_eq!(
            normalize_steam_root_path(library.to_str().unwrap()).as_deref(),
            Some(library.to_str().unwrap())
        );
        assert_eq!(
            normalize_steam_root_path(library.join("steamapps").to_str().unwrap()).as_deref(),
            Some(library.to_str().unwrap())
        );

        // Pasta sem `steamapps` não é biblioteca.
        let other = root.join("Vazio");
        std::fs::create_dir_all(&other).unwrap();
        assert_eq!(normalize_steam_root_path(other.to_str().unwrap()), None);
        // Caminho inexistente também não.
        assert_eq!(
            normalize_steam_root_path(root.join("Fantasma").to_str().unwrap()),
            None
        );
    }
}
