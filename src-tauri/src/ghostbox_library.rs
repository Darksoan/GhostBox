use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;
use std::time::{Duration, Instant};

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
    let mut game = value.clone();
    // Legacy launch overrides are discarded: all launches now go through Steam.
    if let Some(object) = game.as_object_mut() {
        object.remove("customExePath");
        object.remove("launchArguments");
        // Adding games no longer starts a background depot installation.
        object.remove("installationPending");
    }
    Some(game)
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

#[tauri::command]
pub fn ghostbox_library_register_steam_game(app: AppHandle, game: Value) -> Result<Value, String> {
    let app_id = extract_app_id(&game);
    let title = text_value(game.get("title"));
    if app_id.is_empty() || title.is_empty() {
        return Ok(json!({
            "success": false,
            "error": "AppID inválido para registrar o jogo da Steam."
        }));
    }
    if is_library_app_blocked(&app_id, &title) {
        return Ok(json!({
            "success": false,
            "error": "Este item não é um jogo e foi bloqueado da Biblioteca."
        }));
    }

    let mut library_game = game;
    if let Some(object) = library_game.as_object_mut() {
        object.insert("status".to_string(), json!("discover"));
        // Keep registered Steam games distinct from auto-listed owned stubs.
        object.insert("librarySource".to_string(), json!("registered"));
        object.remove("luaToolsManifests");
        object.remove("luaToolsManifestFiles");
    }

    upsert_ghostbox_library_game(&app, library_game.clone())?;

    Ok(json!({
        "success": true,
        "api": "steam",
        "installedPath": "",
        "manifestCount": 0,
        "libraryGame": library_game
    }))
}

fn executable_is_noise(path: &Path) -> bool {
    let normalized = path.to_string_lossy().to_lowercase();
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_lowercase();
    let noisy_directories = [
        "_commonredist",
        "commonredist",
        "redist",
        "redistributables",
        "directx",
        "vcredist",
        "prerequisites",
    ];
    if noisy_directories
        .iter()
        .any(|segment| normalized.split(['\\', '/']).any(|part| part == *segment))
    {
        return true;
    }

    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_lowercase();

    // Installer/uninstaller binaries (Inno Setup `unins000.exe`, `setup.exe`,
    // `setup_game.exe`, ...). Prefix-anchored so game titles that merely
    // contain those letters keep passing the scan.
    if ["unins", "setup"]
        .iter()
        .any(|prefix| stem.starts_with(prefix))
    {
        return true;
    }

    // Crash/bug reporter helpers. A bare `crash` or `report` substring is not
    // enough on its own: legitimate game binaries such as
    // `CrashBandicoot.exe` or `Reporter.exe` must survive the scan.
    const CRASH_HELPER_FRAGMENTS: [&str; 15] = [
        "crashhandler",
        "crash_handler",
        "crashreporter",
        "crash_reporter",
        "crashreport",
        "crash_report",
        "crashpad",
        "crashsender",
        "crash_sender",
        "crashdump",
        "crash_dump",
        "bugreport",
        "bug_report",
        "errorreport",
        "error_report",
    ];
    if CRASH_HELPER_FRAGMENTS
        .iter()
        .any(|fragment| stem.contains(fragment))
    {
        return true;
    }

    // Redistributable payloads are never the game itself.
    // (`unitycrashhandler` and `crashpad_handler` are already covered by the
    // crash-helper fragments above.)
    ["redist", "dxsetup", "vc_redist"]
        .iter()
        .any(|fragment| file_name.contains(fragment))
}

const EXECUTABLE_SCAN_MAX_DEPTH: usize = 6;
const EXECUTABLE_SCAN_MAX_DIRECTORIES: usize = 2_000;
const EXECUTABLE_SCAN_MAX_ENTRIES: usize = 50_000;
const EXECUTABLE_SCAN_MAX_CANDIDATES: usize = 200;
const EXECUTABLE_SCAN_DEADLINE: Duration = Duration::from_secs(5);

fn list_executables_blocking(install_path: &str, game_title: &str) -> Result<Vec<Value>, String> {
    let root = std::fs::canonicalize(install_path.trim())
        .map_err(|error| format!("Could not resolve installation folder: {error}"))?;
    if !root.is_dir() {
        return Err("Installation folder is unavailable.".to_string());
    }
    let title_words = game_title
        .to_lowercase()
        .split(|character: char| !character.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let mut candidates = Vec::new();
    let mut pending = VecDeque::from([(root.clone(), 0usize)]);
    let started_at = Instant::now();
    let mut directories_visited = 0usize;
    let mut entries_seen = 0usize;
    let mut hit_scan_limit = false;

    'scan: while let Some((directory, depth)) = pending.pop_front() {
        if started_at.elapsed() >= EXECUTABLE_SCAN_DEADLINE
            || directories_visited >= EXECUTABLE_SCAN_MAX_DIRECTORIES
        {
            hit_scan_limit = true;
            break;
        }
        directories_visited += 1;

        let entries = match std::fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) if directory == root => {
                return Err("Could not read the installation folder.".to_string());
            }
            Err(_) => continue,
        };

        for entry in entries {
            if started_at.elapsed() >= EXECUTABLE_SCAN_DEADLINE
                || entries_seen >= EXECUTABLE_SCAN_MAX_ENTRIES
                || candidates.len() >= EXECUTABLE_SCAN_MAX_CANDIDATES
            {
                hit_scan_limit = true;
                break 'scan;
            }
            let Ok(entry) = entry else { continue };
            entries_seen += 1;
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };

            // Symlinks and Windows junctions can escape the installation root or
            // create cycles. Never traverse them during an automatic scan.
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                if depth < EXECUTABLE_SCAN_MAX_DEPTH && !executable_is_noise(&path) {
                    pending.push_back((path, depth + 1));
                }
                continue;
            }
            if !file_type.is_file()
                || !path
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
                || executable_is_noise(&path)
            {
                continue;
            }

            let stem = path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_lowercase();
            let relative = path.strip_prefix(&root).unwrap_or(&path);
            let size = entry.metadata().map(|metadata| metadata.len()).unwrap_or(0);
            let title_matches = title_words
                .iter()
                .filter(|word| word.len() >= 3 && stem.contains(word.as_str()))
                .count() as i64;
            let score = title_matches * 100
                + (if depth <= 1 { 20 } else { 0 })
                + ((size / (1024 * 1024)).min(50) as i64);
            let reason = if title_matches > 0 {
                "title-match"
            } else if depth <= 1 {
                "installation-root"
            } else {
                "executable"
            };
            candidates.push(json!({
                "path": path.to_string_lossy(),
                "relativePath": relative.to_string_lossy(),
                "fileName": path.file_name().and_then(|value| value.to_str()).unwrap_or_default(),
                "sizeBytes": size,
                "score": score,
                "reason": reason,
            }));
        }
    }

    if hit_scan_limit && candidates.is_empty() {
        return Err("Executable scan exceeded its safe limits.".to_string());
    }

    candidates.sort_by(|left, right| {
        let right_score = right
            .get("score")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        let left_score = left
            .get("score")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        right_score.cmp(&left_score).then_with(|| {
            text_value(left.get("relativePath")).cmp(&text_value(right.get("relativePath")))
        })
    });
    if let Some(first) = candidates.first_mut().and_then(Value::as_object_mut) {
        first.insert("recommended".to_string(), json!(true));
    }
    Ok(candidates)
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
        "librarySource": "plugin",
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
    for game in steam_games.iter_mut() {
        let app_id = extract_app_id(game);
        if let Some(object) = game.as_object_mut() {
            if plugin_app_ids
                .iter()
                .any(|plugin_app_id| plugin_app_id == &app_id)
            {
                object.insert("librarySource".to_string(), json!("plugin"));
            } else {
                object
                    .entry("librarySource".to_string())
                    .or_insert_with(|| json!("steam-installed"));
            }
        }
    }
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

    // A procedência do jogo adicionado pelo GhostBox precisa sobreviver ao
    // merge: quando ele também está instalado, o stub do scan (instalado via
    // Steam) vence e sairia sem marcador — ficando indistinguível de um
    // install feito pela própria Steam. Entrada sem `librarySource` no
    // registry (adds LuaTools antigos) conta como adicionada pelo GhostBox.
    // Marcadores LuaTools (`luaToolsManifests`/`luaToolsManifestFiles`) forçam
    // `ghostbox` mesmo se o registry estiver com fonte Steam — sem isso o
    // jogo instalado aparece só em "Instalados" e some do filtro "Ghostbox".
    fn has_lua_tools_markers(game: &Value) -> bool {
        let has_list = |key: &str| {
            game.get(key)
                .and_then(|value| value.as_array())
                .is_some_and(|values| !values.is_empty())
        };
        has_list("luaToolsManifests") || has_list("luaToolsManifestFiles")
    }
    let mut registry_games: HashMap<String, Value> = ghostbox_library_games
        .iter()
        .filter_map(|game| {
            let app_id = extract_app_id(game);
            if app_id.is_empty() {
                return None;
            }
            Some((app_id, game.clone()))
        })
        .collect();

    let mut games = merge_library_games(steam_games, ghostbox_library_games);
    for game in games.iter_mut() {
        let app_id = extract_app_id(game);
        let Some(registry_game) = registry_games.remove(&app_id) else {
            continue;
        };
        let mut source = registry_game
            .get("librarySource")
            .cloned()
            .unwrap_or_else(|| json!("ghostbox"));
        if has_lua_tools_markers(&registry_game) {
            source = json!("ghostbox");
        }
        if let Some(object) = game.as_object_mut() {
            object.insert("librarySource".to_string(), source);
            // Preserva os marcadores para o frontend/removal mesmo quando o
            // stub instalado do scan vence o merge.
            for key in ["luaToolsManifests", "luaToolsManifestFiles"] {
                if object.get(key).is_none() {
                    if let Some(value) = registry_game.get(key).cloned() {
                        object.insert(key.to_string(), value);
                    }
                }
            }
        }
    }

    (added_app_ids, games)
}

#[cfg(test)]
mod tests {
    use super::{build_scan_games_with_plugins, list_executables_blocking};

    #[test]
    fn ghostbox_provenance_survives_an_installed_scan_stub() {
        // Jogo adicionado pelo GhostBox e depois também visto como instalado
        // pelo scan da Steam: o stub do scan vence no merge, mas a fonte tem
        // que ser preservada — sem isso o toggle de jogos Steam não distingue
        // install do GhostBox de install da própria Steam.
        let installed = vec![serde_json::json!({
            "appId": "620",
            "id": "steam-620",
            "title": "Portal 2",
            "subtitle": "Instalado via Steam",
            "status": "installed"
        })];
        let registry = vec![serde_json::json!({
            "appId": "620",
            "id": "steam-620",
            "title": "Portal 2",
            "subtitle": "Adicionado pelo GhostBox",
            "status": "discover"
        })];

        let (_, games) = build_scan_games_with_plugins(installed, &[], registry);

        assert_eq!(games.len(), 1);
        assert_eq!(games[0]["status"], "installed");
        assert_eq!(games[0]["librarySource"], "ghostbox");
    }

    #[test]
    fn luatools_markers_force_ghostbox_source_and_survive_installed_merge() {
        let installed = vec![serde_json::json!({
            "appId": "1003",
            "id": "steam-1003",
            "title": "Installed GhostBox game",
            "status": "installed",
            "librarySource": "steam-installed"
        })];
        let registry = vec![serde_json::json!({
            "appId": "1003",
            "id": "steam-1003",
            "title": "Installed GhostBox game",
            "librarySource": "steam-installed",
            "luaToolsManifests": ["manifest_1003.manifest"]
        })];

        let (_, games) = build_scan_games_with_plugins(installed, &[], registry);

        assert_eq!(games.len(), 1);
        assert_eq!(games[0]["status"], "installed");
        assert_eq!(games[0]["librarySource"], "ghostbox");
        assert_eq!(
            games[0]["luaToolsManifests"],
            serde_json::json!(["manifest_1003.manifest"])
        );
    }

    #[test]
    fn declared_source_in_the_registry_wins_over_the_ghostbox_default() {
        let installed = Vec::new();
        let registry = vec![serde_json::json!({
            "appId": "730",
            "id": "steam-730",
            "title": "CS2",
            "librarySource": "registered"
        })];

        let (_, games) = build_scan_games_with_plugins(installed, &[], registry);

        assert_eq!(games[0]["librarySource"], "registered");
    }

    #[test]
    fn pure_steam_installs_keep_their_declared_source() {
        let installed = vec![serde_json::json!({
            "appId": "570",
            "id": "steam-570",
            "title": "Dota 2",
            "status": "installed"
        })];

        let (_, games) = build_scan_games_with_plugins(installed, &[], Vec::new());

        assert_eq!(games.len(), 1);
        assert_eq!(games[0]["librarySource"], "steam-installed");
    }

    #[test]
    fn plugin_fallback_is_kept_as_a_ghostbox_game() {
        let (_, games) = build_scan_games_with_plugins(Vec::new(), &["1250".into()], Vec::new());

        assert_eq!(games.len(), 1);
        assert_eq!(games[0]["librarySource"], "plugin");
    }

    #[test]
    fn installed_plugin_is_kept_as_a_ghostbox_game() {
        let installed = vec![serde_json::json!({
            "appId": "1250",
            "id": "steam-1250",
            "title": "Killing Floor",
            "status": "installed",
            "librarySource": "steam-installed"
        })];

        let (_, games) = build_scan_games_with_plugins(installed, &["1250".into()], Vec::new());

        assert_eq!(games.len(), 1);
        assert_eq!(games[0]["status"], "installed");
        assert_eq!(games[0]["librarySource"], "plugin");
    }

    #[test]
    fn executable_scan_prefers_the_game_and_ignores_installers() {
        let root = std::env::temp_dir().join(format!(
            "ghostbox-executables-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(root.join("_CommonRedist")).unwrap();
        std::fs::write(root.join("Portal2.exe"), b"game").unwrap();
        std::fs::write(root.join("setup.exe"), b"setup").unwrap();
        std::fs::write(root.join("_CommonRedist").join("dxsetup.exe"), b"redist").unwrap();

        let candidates =
            list_executables_blocking(root.to_string_lossy().as_ref(), "Portal 2").unwrap();

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0]["fileName"], "Portal2.exe");
        assert_eq!(candidates[0]["recommended"], true);
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn executable_scan_keeps_game_titles_with_crash_or_report_words() {
        let root = std::env::temp_dir().join(format!(
            "ghostbox-executables-titles-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("CrashBandicoot.exe"), b"game").unwrap();
        std::fs::write(root.join("Reporter.exe"), b"game").unwrap();
        std::fs::write(root.join("crashhandler.exe"), b"helper").unwrap();
        std::fs::write(root.join("CrashReporter.exe"), b"helper").unwrap();
        std::fs::write(root.join("bugreport.exe"), b"helper").unwrap();

        let candidates =
            list_executables_blocking(root.to_string_lossy().as_ref(), "Crash Bandicoot Reporter")
                .unwrap();

        let names = candidates
            .iter()
            .filter_map(|candidate| candidate.get("fileName").and_then(|name| name.as_str()))
            .collect::<Vec<_>>();
        assert!(names.contains(&"CrashBandicoot.exe"));
        assert!(names.contains(&"Reporter.exe"));
        assert_eq!(names.len(), 2);
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn executable_scan_reaches_the_sixth_directory_level() {
        let root = std::env::temp_dir().join(format!(
            "ghostbox-executables-depth-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let nested = root
            .join("one")
            .join("two")
            .join("three")
            .join("four")
            .join("five")
            .join("six");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("DeepGame.exe"), b"game").unwrap();

        let candidates =
            list_executables_blocking(root.to_string_lossy().as_ref(), "Deep Game").unwrap();

        assert_eq!(candidates[0]["fileName"], "DeepGame.exe");
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn executable_scan_reports_an_unavailable_root() {
        let missing = std::env::temp_dir().join(format!(
            "ghostbox-missing-executables-{}",
            uuid::Uuid::new_v4().simple()
        ));

        let error =
            list_executables_blocking(missing.to_string_lossy().as_ref(), "Missing").unwrap_err();

        assert!(error.contains("Could not resolve installation folder"));
    }

    #[cfg(unix)]
    #[test]
    fn executable_scan_does_not_follow_directory_symlinks() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "ghostbox-executables-links-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let outside = root.with_file_name(format!("{}-outside", root.display()));
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(outside.join("OutsideGame.exe"), b"game").unwrap();
        symlink(&outside, root.join("linked")).unwrap();

        let candidates =
            list_executables_blocking(root.to_string_lossy().as_ref(), "Outside Game").unwrap();

        assert!(candidates.is_empty());
        std::fs::remove_dir_all(root).ok();
        std::fs::remove_dir_all(outside).ok();
    }

    #[cfg(windows)]
    #[test]
    fn executable_scan_does_not_follow_directory_junctions() {
        use std::os::windows::fs::symlink_dir;

        let root = std::env::temp_dir().join(format!(
            "ghostbox-executables-links-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let outside = root.with_file_name(format!("{}-outside", root.display()));
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(outside.join("OutsideGame.exe"), b"game").unwrap();
        if symlink_dir(&outside, root.join("linked")).is_err() {
            std::fs::remove_dir_all(root).ok();
            std::fs::remove_dir_all(outside).ok();
            return;
        }

        let candidates =
            list_executables_blocking(root.to_string_lossy().as_ref(), "Outside Game").unwrap();

        assert!(candidates.is_empty());
        std::fs::remove_dir_all(root).ok();
        std::fs::remove_dir_all(outside).ok();
    }
}
