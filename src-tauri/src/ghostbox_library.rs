use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde_json::{json, Value};
use tauri::AppHandle;

pub const GHOSTBOX_LIBRARY_FILE: &str = "ghostbox-library.json";
const LEGACY_EDEN_LIBRARY_FILE: &str = "eden-library.json";
const LEGACY_LIBRARY_FILE: &str = "piratebox-library.json";

fn library_file_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;

    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(GHOSTBOX_LIBRARY_FILE))
}

fn legacy_library_file_path(
    app: &AppHandle,
    file_name: &str,
) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;

    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(directory.join(file_name))
}

fn text_value(value: Option<&Value>) -> String {
    value
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string()
}

fn extract_app_id(value: &Value) -> String {
    text_value(value.get("appId"))
        .chars()
        .filter(char::is_ascii_digit)
        .collect()
}

pub fn is_library_app_blocked(app_id: &str, title: &str) -> bool {
    app_id == "228980"
        || title
            .to_lowercase()
            .contains("steamworks common redistributables")
}

fn sanitize_ghostbox_library_game(value: &Value) -> Option<Value> {
    let app_id = extract_app_id(value);
    let id = text_value(value.get("id"));
    let title = text_value(value.get("title"));
    if app_id.is_empty() || id.is_empty() || title.is_empty() {
        return None;
    }
    if is_library_app_blocked(&app_id, &title) {
        return None;
    }
    Some(value.clone())
}

pub fn read_ghostbox_library_games(app: &AppHandle) -> Vec<Value> {
    let Ok(mut path) = library_file_path(app) else {
        return Vec::new();
    };
    if !path.exists() {
        for file_name in [LEGACY_EDEN_LIBRARY_FILE, LEGACY_LIBRARY_FILE] {
            if let Ok(legacy_path) = legacy_library_file_path(app, file_name) {
                if legacy_path.exists() {
                    path = legacy_path;
                    break;
                }
            }
        }
    }
    let Ok(contents) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(parsed) = serde_json::from_str::<Value>(&contents) else {
        return Vec::new();
    };
    parsed
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(sanitize_ghostbox_library_game)
                .collect()
        })
        .unwrap_or_default()
}

fn write_ghostbox_library_games(app: &AppHandle, games: &[Value]) -> Result<(), String> {
    let path = library_file_path(app)?;
    let contents = serde_json::to_string_pretty(games).map_err(|error| error.to_string())?;
    std::fs::write(path, contents).map_err(|error| error.to_string())
}

pub fn upsert_ghostbox_library_game(app: &AppHandle, game: Value) -> Result<(), String> {
    let Some(mut next_game) = sanitize_ghostbox_library_game(&game) else {
        return Ok(());
    };
    if let Some(object) = next_game.as_object_mut() {
        object.insert("status".to_string(), json!("discover"));
    }

    let app_id = extract_app_id(&next_game);
    let mut games = read_ghostbox_library_games(app)
        .into_iter()
        .filter(|game| extract_app_id(game) != app_id)
        .collect::<Vec<_>>();
    games.insert(0, next_game);
    write_ghostbox_library_games(app, &games)
}

pub fn remove_ghostbox_library_game(app: &AppHandle, app_id: &str) -> Result<(), String> {
    let app_id = app_id
        .chars()
        .filter(char::is_ascii_digit)
        .collect::<String>();
    if app_id.is_empty() {
        return Ok(());
    }

    let games = read_ghostbox_library_games(app)
        .into_iter()
        .filter(|game| extract_app_id(game) != app_id)
        .collect::<Vec<_>>();
    write_ghostbox_library_games(app, &games)
}

pub fn read_plugin_added_steam_app_ids(steam_path: &str) -> Vec<String> {
    let st_plugin_path = Path::new(steam_path).join("config").join("stplug-in");
    let Ok(entries) = std::fs::read_dir(st_plugin_path) else {
        return Vec::new();
    };

    let mut app_ids = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let Some(captures) = regex_lite_app_id_from_lua_file(file_name) else {
            continue;
        };
        if !is_library_app_blocked(&captures, "") {
            app_ids.push(captures);
        }
    }

    unique_app_ids(app_ids)
}

fn regex_lite_app_id_from_lua_file(file_name: &str) -> Option<String> {
    let lower = file_name.to_ascii_lowercase();
    if !lower.ends_with(".lua") && !lower.ends_with(".lua.disabled") {
        return None;
    }
    let stem = file_name
        .trim_end_matches(".lua.disabled")
        .trim_end_matches(".lua");
    if stem.chars().all(|ch| ch.is_ascii_digit()) && !stem.is_empty() {
        Some(stem.to_string())
    } else {
        None
    }
}

pub fn unique_app_ids(app_ids: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    app_ids
        .into_iter()
        .filter(|app_id| seen.insert(app_id.clone()))
        .collect()
}

pub fn steam_plugin_fallback_game(app_id: &str, title: &str) -> Value {
    let cover_url = crate::steam_asset_url(app_id, "header.jpg");
    let hero_url = crate::steam_asset_url(app_id, "library_hero.jpg");
    let display_title = if title.trim().is_empty() {
        format!("Steam App {app_id}")
    } else {
        title.trim().to_string()
    };

    json!({
        "appId": app_id,
        "id": format!("steam-{app_id}"),
        "title": display_title,
        "subtitle": "Biblioteca Steam",
        "status": "discover",
        "hours": 0,
        "rating": 0,
        "size": "Adicionado",
        "release": "Steam",
        "progress": 0,
        "accent": "#66c0f4",
        "cover": cover_url,
        "hero": hero_url,
        "coverUrl": cover_url,
        "heroUrl": hero_url,
        "coverFallbacks": [
            crate::steam_asset_url(app_id, "library_600x900.jpg"),
            crate::steam_asset_url(app_id, "capsule_616x353.jpg")
        ],
        "heroFallbacks": [
            crate::steam_asset_url(app_id, "library_hero.jpg"),
            crate::steam_asset_url(app_id, "header.jpg")
        ],
        "logo": crate::steam_asset_url(app_id, "logo.png"),
        "tags": ["Steam"],
        "genres": [],
        "screenshots": [hero_url],
        "achievements": { "unlocked": 0, "total": 0, "progress": 0 },
        "achievementList": []
    })
}

pub fn merge_library_games(steam_games: Vec<Value>, added_games: Vec<Value>) -> Vec<Value> {
    let mut games_by_app_id = HashMap::new();

    for game in steam_games {
        let app_id = extract_app_id(&game);
        let title = text_value(game.get("title"));
        if app_id.is_empty() || is_library_app_blocked(&app_id, &title) {
            continue;
        }
        games_by_app_id.insert(app_id, game);
    }

    for game in added_games {
        let app_id = extract_app_id(&game);
        let title = text_value(game.get("title"));
        if app_id.is_empty() || is_library_app_blocked(&app_id, &title) {
            continue;
        }

        if let Some(existing) = games_by_app_id.get(&app_id) {
            if text_value(existing.get("status")) == "installed" {
                continue;
            }
            let mut merged = game;
            if let Some(object) = merged.as_object_mut() {
                object.insert(
                    "status".to_string(),
                    existing
                        .get("status")
                        .cloned()
                        .unwrap_or_else(|| json!("discover")),
                );
            }
            games_by_app_id.insert(app_id, merged);
        } else {
            let mut merged = game;
            if let Some(object) = merged.as_object_mut() {
                object.insert("status".to_string(), json!("discover"));
            }
            games_by_app_id.insert(app_id, merged);
        }
    }

    let mut games = games_by_app_id.into_values().collect::<Vec<_>>();
    games.sort_by(|left, right| text_value(left.get("title")).cmp(&text_value(right.get("title"))));
    games
}

pub fn build_scan_games_with_plugins(
    installed_games: Vec<Value>,
    plugin_app_ids: &[String],
    ghostbox_library_games: Vec<Value>,
) -> (Vec<String>, Vec<Value>) {
    let installed_app_ids = installed_games
        .iter()
        .map(extract_app_id)
        .filter(|app_id| !app_id.is_empty())
        .collect::<HashSet<_>>();

    let mut steam_games = installed_games;
    for app_id in plugin_app_ids {
        if installed_app_ids.contains(app_id.as_str()) {
            continue;
        }
        steam_games.push(steam_plugin_fallback_game(app_id, ""));
    }

    let added_app_ids = unique_app_ids(
        plugin_app_ids
            .iter()
            .cloned()
            .chain(
                ghostbox_library_games
                    .iter()
                    .map(extract_app_id)
                    .filter(|app_id| !app_id.is_empty()),
            )
            .collect(),
    );

    let games = merge_library_games(steam_games, ghostbox_library_games);
    (added_app_ids, games)
}
