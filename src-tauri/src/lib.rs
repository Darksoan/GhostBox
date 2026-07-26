pub(crate) const FACETS_VERSION: &str = "catalogue-response-v2";
pub(crate) const RANKING_VERSION: &str = "ranking-v8-strict-filters";
const BACKUP_SETTINGS_FILE: &str = "backup-settings.json";
const STEAM_LIBRARY_PATH_FILE: &str = "steam-library-path.json";
const BACKUP_ROOT_FOLDER_NAME: &str = "GhostBoxBackups";
const LEGACY_EDEN_BACKUP_ROOT_FOLDER_NAME: &str = "EdenBackups";
const LEGACY_BACKUP_ROOT_FOLDER_NAME: &str = "PirateBoxBackups";
const BACKUP_ROOT_MARKER_FILE: &str = "ghostbox-backup-root.json";
const LEGACY_EDEN_BACKUP_ROOT_MARKER_FILE: &str = "eden-backup-root.json";
const LEGACY_BACKUP_ROOT_MARKER_FILE: &str = "piratebox-backup-root.json";
const BACKUP_SETTINGS_CHANGED_EVENT: &str = "backup-settings-changed";

const GHOSTBOX_ACHIEVEMENTS_BACKUP_FILE: &str = "ghostbox-achievements.json";
const LEGACY_EDEN_ACHIEVEMENTS_BACKUP_FILE: &str = "eden-achievements.json";
const LEGACY_ACHIEVEMENTS_BACKUP_FILE: &str = "piratebox-achievements.json";
const GHOSTBOX_PLAYTIME_BACKUP_FILE: &str = "ghostbox-playtime.json";


#[derive(Debug, Clone, Default)]
pub(crate) struct ProfileProgressSnapshot {
    pub has_achievements: bool,
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
mod cloud_save;
mod ghostbox_library;
mod image_cache;
mod luatools;
mod ludusavi;
mod luatools_bootstrap;
mod playtime;
mod settings;
mod steam;
mod steam_appcache;
mod util;
mod window_lifecycle;

pub(crate) use catalogue::normalize_api_url;
pub(crate) use settings::load_startup_settings;

use ludusavi::resolved_game_title;
use settings::{read_json_file, write_json_file};
use tauri::Manager;
use util::{merge_object_defaults, object_or_empty, text_value, EmptyStringExt};

fn default_backup_settings(app: &tauri::AppHandle) -> serde_json::Value {
    serde_json::json!({
        "outputPath": default_backup_output_path(app),
        "automaticBackupsForLibrary": false,
        "automaticBackups": {},
        "backupRecords": {}
    })
}

pub(crate) fn default_backup_output_path(app: &tauri::AppHandle) -> String {
    use tauri::Manager;

    app.path()
        .document_dir()
        .ok()
        .or_else(|| app.path().app_data_dir().ok())
        .map(|path| to_backup_root_path(path.to_string_lossy().as_ref()))
        .unwrap_or_else(|| BACKUP_ROOT_FOLDER_NAME.to_string())
}

pub(crate) fn to_backup_root_path(output_path: &str) -> String {
    let path = std::path::PathBuf::from(output_path.trim());
    if path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            name.eq_ignore_ascii_case(BACKUP_ROOT_FOLDER_NAME)
                || name.eq_ignore_ascii_case(LEGACY_EDEN_BACKUP_ROOT_FOLDER_NAME)
                || name.eq_ignore_ascii_case(LEGACY_BACKUP_ROOT_FOLDER_NAME)
        })
    {
        path.to_string_lossy().to_string()
    } else {
        path.join(BACKUP_ROOT_FOLDER_NAME)
            .to_string_lossy()
            .to_string()
    }
}

fn normalize_backup_settings(
    app: &tauri::AppHandle,
    value: Option<serde_json::Value>,
) -> serde_json::Value {
    let fallback = default_backup_settings(app);
    let Some(value) = value.and_then(|value| value.as_object().cloned()) else {
        return fallback;
    };

    let fallback_output_path = text_value(fallback.get("outputPath"));
    let output_path =
        to_backup_root_path(&text_value(value.get("outputPath")).if_empty(fallback_output_path));

    serde_json::json!({
        "outputPath": output_path,
        "automaticBackupsForLibrary": value
            .get("automaticBackupsForLibrary")
            .and_then(|value| value.as_bool())
            .unwrap_or(false),
        "automaticBackups": object_or_empty(value.get("automaticBackups")),
        "backupRecords": object_or_empty(value.get("backupRecords"))
    })
}

pub(crate) fn load_backup_settings(app: &tauri::AppHandle) -> serde_json::Value {
    normalize_backup_settings(app, read_json_file(app, BACKUP_SETTINGS_FILE))
}

pub(crate) fn save_backup_settings(
    app: &tauri::AppHandle,
    patch: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let current = load_backup_settings(app);
    let mut next = merge_object_defaults(current.clone(), patch.clone());

    for key in ["automaticBackups", "backupRecords"] {
        let mut merged = current
            .get(key)
            .and_then(|value| value.as_object())
            .cloned()
            .unwrap_or_default();
        if let Some(patch_object) = patch.get(key).and_then(|value| value.as_object()) {
            for (entry_key, entry_value) in patch_object {
                merged.insert(entry_key.clone(), entry_value.clone());
            }
        }
        next[key] = serde_json::Value::Object(merged);
    }

    persist_backup_settings(app, next)
}

pub(crate) fn persist_backup_settings(
    app: &tauri::AppHandle,
    settings: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let normalized = normalize_backup_settings(app, Some(settings));
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


pub(crate) fn is_path_inside_or_equal(
    parent_path: &std::path::Path,
    child_path: &std::path::Path,
) -> bool {
    let parent = match parent_path.canonicalize() {
        Ok(path) => path,
        Err(_) => parent_path.to_path_buf(),
    };
    let child = match child_path.canonicalize() {
        Ok(path) => path,
        Err(_) => child_path.to_path_buf(),
    };

    child == parent || child.starts_with(parent)
}

pub(crate) fn selected_backup_path(
    settings: &serde_json::Value,
    app_id: &str,
    backup_path: Option<String>,
) -> String {
    if let Some(path) = backup_path
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
    {
        return path;
    }

    let Some(record) = settings
        .get("backupRecords")
        .and_then(|records| records.get(app_id))
    else {
        return String::new();
    };

    record
        .get("entries")
        .and_then(|entries| entries.as_array())
        .and_then(|entries| entries.first())
        .and_then(|entry| entry.get("path"))
        .and_then(|path| path.as_str())
        .or_else(|| record.get("lastBackupPath").and_then(|path| path.as_str()))
        .unwrap_or_default()
        .to_string()
}

pub(crate) fn steam_asset_url(app_id: &str, file_name: &str) -> String {
    format!("https://cdn.cloudflare.steamstatic.com/steam/apps/{app_id}/{file_name}")
}

fn default_steam_path_candidates() -> Vec<String> {
    let mut candidates = vec![
        "C:\\Program Files (x86)\\Steam".to_string(),
        "C:\\Program Files\\Steam".to_string(),
    ];

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

    if is_valid_steam_path(&path) {
        return Some(path.to_string_lossy().to_string());
    }

    if path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("steamapps"))
    {
        if let Some(parent) = path.parent() {
            if is_valid_steam_path(parent) {
                return Some(parent.to_string_lossy().to_string());
            }
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

fn string_similarity(left: &str, right: &str) -> f64 {
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    if left == right {
        return 1.0;
    }

    let left_chars: Vec<char> = left.chars().collect();
    let right_chars: Vec<char> = right.chars().collect();
    let mut distances = (0..=left_chars.len())
        .map(|index| index)
        .collect::<Vec<_>>();

    for (right_index, right_char) in right_chars.iter().enumerate() {
        let mut previous = distances[0];
        distances[0] = right_index + 1;

        for (left_index, left_char) in left_chars.iter().enumerate() {
            let current = distances[left_index + 1];
            let substitution_cost = if left_char == right_char { 0 } else { 1 };
            distances[left_index + 1] = (distances[left_index + 1] + 1)
                .min(distances[left_index] + 1)
                .min(previous + substitution_cost);
            previous = current;
        }
    }

    1.0 - (distances[left_chars.len()] as f64 / left_chars.len().max(right_chars.len()) as f64)
}

fn read_persisted_achievement_stats(
    app: &tauri::AppHandle,
    app_id: &str,
    title: &str,
) -> serde_json::Value {
    let backup_file = read_ghostbox_achievements_backup_file(app, app_id, title, None);
    let total = backup_file
        .as_ref()
        .and_then(|file| file.get("total"))
        .and_then(|value| value.as_u64())
        .unwrap_or(0) as u32;
    let unlocked = backup_file
        .as_ref()
        .and_then(|file| file.get("unlocked"))
        .and_then(|value| value.as_array())
        .map(|items| items.len())
        .unwrap_or(0)
        .min(total as usize) as u32;

    serde_json::json!({
        "unlocked": unlocked,
        "total": total,
        "progress": if total > 0 {
            ((unlocked as f64 / total as f64) * 100.0).round() as u32
        } else {
            0
        }
    })
}

pub(crate) fn enrich_game_with_local_achievement_stats(
    app: &tauri::AppHandle,
    mut game: serde_json::Value,
    steam_path: &str,
) -> serde_json::Value {
    let app_id = extract_app_id(&game);
    if app_id.is_empty() {
        return game;
    }

    let title = resolved_game_title(app, &game, &app_id);
    let persisted = read_persisted_achievement_stats(app, &app_id, &title);
    let achievements =
        steam_appcache::read_local_achievement_stats(steam_path, &app_id, &persisted);
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
    app: &tauri::AppHandle,
    app_id: &str,
    title: &str,
    steam_path: &str,
    achievements: Vec<serde_json::Value>,
) -> Vec<serde_json::Value> {
    if achievements.is_empty() {
        return achievements;
    }

    let backup_file = read_ghostbox_achievements_backup_file(app, app_id, title, None);
    let backup_unlocked = backup_file
        .as_ref()
        .and_then(|file| file.get("unlocked"))
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    let unlocked_names = if !backup_unlocked.is_empty() {
        backup_unlocked
            .iter()
            .flat_map(|achievement| {
                let name = text_value(achievement.get("name"));
                let title = text_value(achievement.get("title"));
                [name, title]
            })
            .filter(|value| !value.is_empty())
            .collect::<std::collections::HashSet<_>>()
    } else {
        steam_appcache::read_local_unlocked_achievement_names(steam_path, app_id)
    };

    if unlocked_names.is_empty() {
        return achievements;
    }

    let normalized_unlocked_names = unlocked_names
        .iter()
        .map(|value| normalize_search_text(value))
        .collect::<std::collections::HashSet<_>>();
    let mut unlocked_at_by_name = std::collections::HashMap::new();
    for achievement in &backup_unlocked {
        let name = normalize_search_text(&text_value(achievement.get("name")));
        let title = normalize_search_text(&text_value(achievement.get("title")));
        let unlocked_at = achievement
            .get("unlockedAt")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string();
        if !name.is_empty() {
            unlocked_at_by_name.insert(name, unlocked_at.clone());
        }
        if !title.is_empty() {
            unlocked_at_by_name.insert(title, unlocked_at);
        }
    }

    achievements
        .into_iter()
        .map(|achievement| {
            let name = text_value(achievement.get("name"));
            let title = text_value(achievement.get("title"));
            let normalized_name = normalize_search_text(&name);
            let normalized_title = normalize_search_text(&title);

            let backup_match = backup_unlocked
                .iter()
                .find(|backup| {
                    normalize_search_text(&text_value(backup.get("name"))) == normalized_name
                        || normalize_search_text(&text_value(backup.get("title")))
                            == normalized_title
                })
                .or_else(|| {
                    backup_unlocked.iter().find(|backup| {
                        if normalized_title.is_empty() {
                            return false;
                        }
                        string_similarity(
                            &normalize_search_text(&text_value(backup.get("title"))),
                            &normalized_title,
                        ) >= 0.72
                    })
                });

            let unlocked = backup_match.is_some()
                || normalized_unlocked_names.contains(&normalized_name)
                || normalized_unlocked_names.contains(&normalized_title)
                || achievement
                    .get("unlocked")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false);
            let unlocked_at = backup_match
                .and_then(|backup| backup.get("unlockedAt"))
                .and_then(|value| value.as_str())
                .map(str::to_string)
                .or_else(|| unlocked_at_by_name.get(&normalized_name).cloned())
                .or_else(|| unlocked_at_by_name.get(&normalized_title).cloned())
                .or_else(|| {
                    achievement
                        .get("unlockedAt")
                        .and_then(|value| value.as_str())
                        .map(str::to_string)
                });

            let mut next = achievement;
            if let Some(object) = next.as_object_mut() {
                object.insert("unlocked".to_string(), serde_json::Value::Bool(unlocked));
                if let Some(unlocked_at) = unlocked_at.filter(|value| !value.is_empty()) {
                    object.insert(
                        "unlockedAt".to_string(),
                        serde_json::Value::String(unlocked_at),
                    );
                }
            }
            next
        })
        .collect()
}

pub(crate) fn merge_game_achievement_details(
    app: &tauri::AppHandle,
    mut game: serde_json::Value,
    steam_path: &str,
) -> serde_json::Value {
    let app_id = extract_app_id(&game);
    if app_id.is_empty() {
        return game;
    }

    let title = resolved_game_title(app, &game, &app_id);
    let achievement_list = game
        .get("achievementList")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    if achievement_list.is_empty() {
        return game;
    }

    let achievement_list =
        mark_local_unlocked_achievements(app, &app_id, &title, steam_path, achievement_list);
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

fn enrich_backup_achievements_with_icons(
    unlocked: Vec<serde_json::Value>,
    steam_achievements: &[serde_json::Value],
) -> Vec<serde_json::Value> {
    if unlocked.is_empty() {
        return unlocked;
    }

    let mut achievement_by_name = std::collections::HashMap::new();
    for achievement in steam_achievements {
        let name = normalize_search_text(&text_value(achievement.get("name")));
        let title = normalize_search_text(&text_value(achievement.get("title")));
        if !name.is_empty() {
            achievement_by_name.insert(name, achievement);
        }
        if !title.is_empty() {
            achievement_by_name.insert(title, achievement);
        }
    }

    unlocked
        .into_iter()
        .map(|achievement| {
            let normalized_name = normalize_search_text(&text_value(achievement.get("name")));
            let normalized_title = normalize_search_text(&text_value(achievement.get("title")));
            let steam_match = achievement_by_name
                .get(&normalized_name)
                .or_else(|| achievement_by_name.get(&normalized_title))
                .copied()
                .or_else(|| {
                    steam_achievements.iter().find(|steam_achievement| {
                        let steam_title =
                            normalize_search_text(&text_value(steam_achievement.get("title")));
                        !steam_title.is_empty()
                            && !normalized_title.is_empty()
                            && string_similarity(&steam_title, &normalized_title) >= 0.7
                    })
                });

            let mut next = achievement;
            if let Some(steam_match) = steam_match {
                if let Some(object) = next.as_object_mut() {
                    if let Some(icon) = steam_match.get("icon").filter(|value| !value.is_null()) {
                        object.insert("icon".to_string(), icon.clone());
                    }
                    if let Some(icon_gray) =
                        steam_match.get("iconGray").filter(|value| !value.is_null())
                    {
                        object.insert("iconGray".to_string(), icon_gray.clone());
                    }
                }
            }
            next
        })
        .collect()
}

fn ghostbox_achievements_backup_path(
    settings: &serde_json::Value,
    title: &str,
) -> std::path::PathBuf {
    std::path::PathBuf::from(text_value(settings.get("outputPath")))
        .join(sanitize_folder_name(title))
        .join(GHOSTBOX_ACHIEVEMENTS_BACKUP_FILE)
}

fn legacy_achievements_backup_path(
    settings: &serde_json::Value,
    title: &str,
) -> std::path::PathBuf {
    std::path::PathBuf::from(text_value(settings.get("outputPath")))
        .join(sanitize_folder_name(title))
        .join(LEGACY_ACHIEVEMENTS_BACKUP_FILE)
}

fn legacy_eden_achievements_backup_path(
    settings: &serde_json::Value,
    title: &str,
) -> std::path::PathBuf {
    std::path::PathBuf::from(text_value(settings.get("outputPath")))
        .join(sanitize_folder_name(title))
        .join(LEGACY_EDEN_ACHIEVEMENTS_BACKUP_FILE)
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

fn read_ghostbox_achievements_backup_file(
    app: &tauri::AppHandle,
    app_id: &str,
    title: &str,
    backup_path: Option<&str>,
) -> Option<serde_json::Value> {
    let settings = load_backup_settings(app);
    let mut candidates = vec![
        ghostbox_achievements_backup_path(&settings, title),
        legacy_eden_achievements_backup_path(&settings, title),
        legacy_achievements_backup_path(&settings, title),
    ];
    if let Some(path) = backup_path.filter(|value| !value.is_empty()) {
        let backup = std::path::PathBuf::from(path);
        candidates.push(backup.join(GHOSTBOX_ACHIEVEMENTS_BACKUP_FILE));
        candidates.push(backup.join(LEGACY_EDEN_ACHIEVEMENTS_BACKUP_FILE));
        candidates.push(backup.join(LEGACY_ACHIEVEMENTS_BACKUP_FILE));
        if let Some(parent) = backup.parent() {
            candidates.push(parent.join(GHOSTBOX_ACHIEVEMENTS_BACKUP_FILE));
            candidates.push(parent.join(LEGACY_EDEN_ACHIEVEMENTS_BACKUP_FILE));
            candidates.push(parent.join(LEGACY_ACHIEVEMENTS_BACKUP_FILE));
        }
        if let Some(record) = settings
            .get("backupRecords")
            .and_then(|records| records.get(app_id))
        {
            if let Some(last_path) = record
                .get("lastBackupPath")
                .and_then(|value| value.as_str())
            {
                candidates.push(
                    std::path::PathBuf::from(last_path).join(GHOSTBOX_ACHIEVEMENTS_BACKUP_FILE),
                );
                candidates.push(
                    std::path::PathBuf::from(last_path).join(LEGACY_EDEN_ACHIEVEMENTS_BACKUP_FILE),
                );
                candidates.push(
                    std::path::PathBuf::from(last_path).join(LEGACY_ACHIEVEMENTS_BACKUP_FILE),
                );
            }
        }
    }

    for candidate in candidates {
        let Ok(raw) = std::fs::read_to_string(&candidate) else {
            continue;
        };
        let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) else {
            continue;
        };
        if let Some(normalized) = normalize_ghostbox_achievements_backup_file(&parsed, app_id) {
            if normalized
                .get("unlocked")
                .and_then(|value| value.as_array())
                .is_some_and(|items| !items.is_empty())
            {
                return Some(normalized);
            }
        }
    }

    None
}

fn write_ghostbox_achievements_backup_file(
    app: &tauri::AppHandle,
    file: &serde_json::Value,
    target_directory: Option<&str>,
) -> Result<String, String> {
    let app_id = text_value(file.get("appId"));
    let title = text_value(file.get("title")).if_empty(app_id.clone());
    let file_path = if let Some(directory) = target_directory.filter(|value| !value.is_empty()) {
        std::path::PathBuf::from(directory).join(GHOSTBOX_ACHIEVEMENTS_BACKUP_FILE)
    } else {
        ghostbox_achievements_backup_path(&load_backup_settings(app), &title)
    };
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let contents = serde_json::to_string_pretty(file).map_err(|error| error.to_string())?;
    std::fs::write(&file_path, contents).map_err(|error| error.to_string())?;
    Ok(file_path.to_string_lossy().to_string())
}


pub(crate) fn get_backup_record_entries(
    record: Option<&serde_json::Value>,
) -> Vec<serde_json::Value> {
    let Some(record) = record else {
        return Vec::new();
    };
    if let Some(entries) = record
        .get("entries")
        .and_then(|value| value.as_array())
        .filter(|entries| !entries.is_empty())
    {
        return entries.clone();
    }
    let backup_path = text_value(record.get("lastBackupPath"));
    let backup_at = text_value(record.get("lastBackupAt"));
    if record
        .get("lastBackupSuccess")
        .and_then(|value| value.as_bool())
        != Some(true)
        || backup_path.is_empty()
        || backup_at.is_empty()
    {
        return Vec::new();
    }
    vec![serde_json::json!({
        "path": backup_path,
        "backupAt": backup_at,
        "sizeBytes": record.get("lastBackupSizeBytes"),
        "pinned": false
    })]
}


pub(crate) fn save_failed_backup_record(
    app: &tauri::AppHandle,
    app_id: &str,
    title: &str,
    backup_path: &str,
    error: &str,
) -> Result<serde_json::Value, String> {
    let settings = load_backup_settings(app);
    let current_record = settings
        .get("backupRecords")
        .and_then(|records| records.get(app_id));

    save_backup_record(
        app,
        app_id,
        serde_json::json!({
            "title": title,
            "lastBackupAt": current_timestamp_string(),
            "lastBackupSuccess": false,
            "lastBackupPath": backup_path,
            "lastBackupError": error,
            "entries": get_backup_record_entries(current_record)
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

    let achievements_file = read_ghostbox_achievements_backup_file(app, app_id, title, None)
        .or_else(|| {
            steam_path.as_ref().and_then(|steam_path| {
                steam_appcache::read_steam_local_achievement_backup_file(steam_path, app_id, title)
            })
        })
        .or_else(|| {
            // Prefer achievements already stored inside this backup folder (re-export).
            read_ghostbox_achievements_backup_file(
                app,
                app_id,
                title,
                Some(backup_path.to_string_lossy().as_ref()),
            )
        });

    if let Some(file) = achievements_file {
        if write_ghostbox_achievements_backup_file(
            app,
            &file,
            Some(backup_path.to_string_lossy().as_ref()),
        )
        .is_ok()
        {
            snapshot.has_achievements = true;
            // Keep the canonical per-game achievements file in the backup root in sync.
            let _ = write_ghostbox_achievements_backup_file(app, &file, None);
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
    title: &str,
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

    if let Some(file) = read_ghostbox_achievements_backup_file(
        app,
        app_id,
        title,
        Some(backup_path.to_string_lossy().as_ref()),
    ) {
        if write_ghostbox_achievements_backup_file(app, &file, None).is_ok() {
            snapshot.has_achievements = true;
        }
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
    let settings = load_backup_settings(app);
    let current_record = settings
        .get("backupRecords")
        .and_then(|records| records.get(app_id));
    let entries = get_backup_record_entries(current_record);
    let last_path = current_record
        .and_then(|record| record.get("lastBackupPath"))
        .cloned()
        .or_else(|| entries.first().and_then(|entry| entry.get("path")).cloned())
        .unwrap_or_else(|| serde_json::json!(""));

    save_backup_record(
        app,
        app_id,
        serde_json::json!({
            "title": title,
            "lastBackupAt": current_timestamp_string(),
            "lastBackupSuccess": true,
            "lastBackupPath": last_path,
            "lastBackupSizeBytes": size_bytes,
            "lastCloudBackupAt": current_timestamp_string(),
            "entries": entries
        }),
    )
}

pub(crate) fn sanitize_folder_name(value: &str) -> String {
    let invalid = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    let name = value
        .chars()
        .map(|ch| {
            if invalid.contains(&ch) || ch.is_control() {
                ' '
            } else {
                ch
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    name.chars()
        .take(80)
        .collect::<String>()
        .if_empty("Game".to_string())
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

pub(crate) fn remove_backup_record(
    app: &tauri::AppHandle,
    app_id: &str,
) -> Result<serde_json::Value, String> {
    let mut settings = load_backup_settings(app);
    if let Some(records) = settings
        .get_mut("backupRecords")
        .and_then(|value| value.as_object_mut())
    {
        records.remove(app_id);
    }
    persist_backup_settings(app, settings)
}

pub(crate) fn directory_has_content(path: &std::path::Path) -> bool {
    let Ok(entries) = std::fs::read_dir(path) else {
        return false;
    };

    entries.flatten().any(|entry| {
        entry.file_name().to_str().is_some_and(|name| {
            name != BACKUP_ROOT_MARKER_FILE
                && name != LEGACY_EDEN_BACKUP_ROOT_MARKER_FILE
                && name != LEGACY_BACKUP_ROOT_MARKER_FILE
        })
    })
}


pub(crate) fn selected_backup_entry_path(
    settings: &serde_json::Value,
    app_id: &str,
    backup_path: Option<String>,
) -> String {
    selected_backup_path(settings, app_id, backup_path)
}

pub(crate) fn backup_details_for_path(
    app: &tauri::AppHandle,
    app_id: &str,
    backup_path: &str,
    steam_path: &str,
    steam_achievements: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let settings = load_backup_settings(app);
    let title = settings
        .get("backupRecords")
        .and_then(|records| records.get(app_id))
        .and_then(|record| record.get("title"))
        .and_then(|value| value.as_str())
        .unwrap_or(app_id);
    let mut achievements =
        read_ghostbox_achievements_backup_file(app, app_id, title, Some(backup_path))
            .and_then(|file| file.get("unlocked").cloned())
            .and_then(|value| value.as_array().cloned())
            .unwrap_or_default();

    if achievements.is_empty() {
        achievements =
            steam_appcache::read_steam_local_achievement_backup_file(steam_path, app_id, title)
                .and_then(|file| file.get("unlocked").cloned())
                .and_then(|value| value.as_array().cloned())
                .unwrap_or_default();
    }

    let achievements = enrich_backup_achievements_with_icons(achievements, steam_achievements);
    let root = std::path::PathBuf::from(backup_path);
    let mut files = Vec::new();
    let mut file_count = 0u64;
    let mut directory_count = 0u64;
    let mut truncated = false;

    fn visit(
        current: &std::path::Path,
        files: &mut Vec<serde_json::Value>,
        file_count: &mut u64,
        directory_count: &mut u64,
        truncated: &mut bool,
    ) {
        if files.len() >= 500 {
            *truncated = true;
            return;
        }

        let Ok(entries) = std::fs::read_dir(current) else {
            return;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let Ok(metadata) = entry.metadata() else {
                continue;
            };

            if metadata.is_dir() {
                *directory_count += 1;
                files.push(serde_json::json!({
                    "name": name,
                    "path": path.to_string_lossy(),
                    "type": "directory"
                }));
                visit(&path, files, file_count, directory_count, truncated);
            } else if metadata.is_file() {
                *file_count += 1;
                files.push(serde_json::json!({
                    "name": name,
                    "path": path.to_string_lossy(),
                    "type": "file",
                    "extension": path.extension().and_then(|value| value.to_str()).unwrap_or_default(),
                    "sizeBytes": metadata.len()
                }));
            }

            if files.len() >= 500 {
                *truncated = true;
                break;
            }
        }
    }

    visit(
        &root,
        &mut files,
        &mut file_count,
        &mut directory_count,
        &mut truncated,
    );

    Ok(serde_json::json!({
        "appId": app_id,
        "backupPath": backup_path,
        "files": files,
        "fileCount": file_count,
        "directoryCount": directory_count,
        "truncated": truncated,
        "achievements": achievements
    }))
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

#[tauri::command]
fn game_launch(
    app: tauri::AppHandle,
    game: serde_json::Value,
) -> Result<serde_json::Value, String> {
    launch_game_from_value(app, game)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .on_page_load(|webview, payload| {
            if webview.label() == "main"
                && matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
            {
                window_lifecycle::show_main_window_when_ready(webview.app_handle());
            }
        })
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            window_lifecycle::show_main_window(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            image_cache::start_image_cache_cleanup(app.handle().clone());
            catalogue_cache::start_catalogue_refresh_scheduler(app.handle().clone());
            window_lifecycle::setup_window_lifecycle(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            catalogue::app_get_status,
            catalogue::database_get_games,
            catalogue::database_get_game_details,
            catalogue::database_get_game_store_details,
            catalogue::database_get_game_achievement_details,
            catalogue::database_get_game_reviews,
            catalogue::catalogue_get_home,
            catalogue::steam_get_game_icon_url,
            catalogue::steam_get_game_icon_urls,
            catalogue::steam_get_local_game_icon_urls,
            catalogue::steam_resolve_game_icon_urls,
            catalogue::app_is_steamtools_installed,
            catalogue::app_install_steamtools,
            catalogue::cache_get_image,
            catalogue::cache_resolve_steam_library_asset,
            settings::app_get_startup_settings,
            settings::app_set_startup_settings,
            settings::app_set_notification_settings,
            settings::app_get_morrenus_api_key,
            settings::app_set_morrenus_api_key,
            settings::app_get_morrenus_stats,
            steam::steam_get_profile,
            steam::steam_get_account_stats,
            steam::steam_sync_playtimes,
            steam::steam_get_player_level,
            steam::steam_is_running,
            steam::steam_get_wishlist,
            steam::steam_get_recommended_tags_for_user,
            steam::steam_get_similar_app_ids,
            steam::steam_save_profile,
            steam::steam_sign_in,
            steam::steam_sign_out,
            cloud_save::cloud_get_session,
            cloud_save::cloud_sign_out,
            cloud_save::cloud_list_saves,
            cloud_save::cloud_backup_game,
            cloud_save::cloud_restore_save,
            cloud_save::cloud_delete_save,
            cloud_save::cloud_set_save_pinned,
            cloud_save::cloud_get_profile_snapshot,
            cloud_save::cloud_put_profile_snapshot,
            cloud_save::cloud_upload_profile_image,
            cloud_save::cloud_delete_profile_banner,
            backup::backup_get_settings,
            backup::backup_remove_record,
            backup::backup_get_details,
            steam::steam_select_path,
            steam::steam_scan_library,
            steam::steam_restart,
            game_launch,
            playtime::game_get_playtimes,
            ghostbox_library::ghostbox_library_register_steam_game,
            luatools::luatools_add_game,
            luatools::luatools_remove_game,
            luatools_bootstrap::luatools_dependencies_status,
            luatools_bootstrap::luatools_dependencies_ensure,
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
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                window_lifecycle::shutdown_app_services(app_handle);
            }
        });
}
