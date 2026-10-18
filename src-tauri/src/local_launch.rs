//! Lancamento direto opcional. Nao substitui DLLs nem contorna DRM.
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub(crate) fn direct_launch_enabled(settings: &Value) -> bool {
    // Configuracoes antigas ou invalidas mantem o lancamento pela Steam.
    settings
        .get("openSteamOnGameLaunch")
        .and_then(Value::as_bool)
        == Some(false)
}

fn ghostbox_origin(game: &Value) -> bool {
    game.get("downloadedByGhostBox").and_then(Value::as_bool) == Some(true)
        || matches!(
            game.get("librarySource").and_then(Value::as_str),
            Some("ghostbox" | "plugin")
        )
        || ["luaToolsManifests", "luaToolsManifestFiles"]
            .iter()
            .any(|key| {
                game.get(key)
                    .and_then(Value::as_array)
                    .is_some_and(|items| !items.is_empty())
            })
        || (game.get("status").and_then(Value::as_str) == Some("completed")
            && !text(game, "outputDir").is_empty()
            && !text(game, "downloadsRoot").is_empty())
}

fn text<'a>(game: &'a Value, key: &str) -> &'a str {
    game.get(key).and_then(Value::as_str).unwrap_or("").trim()
}

pub(crate) fn register_download(
    app: &tauri::AppHandle,
    app_id: &str,
    title: &str,
    install_dir: &str,
    install_path: &Path,
) -> Result<(), String> {
    let mut game = crate::ghostbox_library::read_ghostbox_library_games(app)
        .into_iter()
        .find(|game| text(game, "appId") == app_id)
        .unwrap_or_else(|| json!({"id": format!("steam-{app_id}"), "appId": app_id}));
    if !title.trim().is_empty() {
        game["title"] = json!(title);
    }
    if text(&game, "title").is_empty() {
        game["title"] = json!(install_dir);
    }
    game["librarySource"] = json!("ghostbox");
    game["downloadedByGhostBox"] = json!(true);
    game["installDir"] = json!(install_dir);
    game["installPath"] = json!(install_path.to_string_lossy());
    crate::ghostbox_library::upsert_ghostbox_library_game(app, game)
}

pub(crate) fn resolve_ghostbox_game(
    app: &tauri::AppHandle,
    game: &Value,
    app_id: &str,
) -> Option<Value> {
    let registered = crate::ghostbox_library::read_ghostbox_library_games(app)
        .into_iter()
        .find(|item| text(item, "appId") == app_id);
    let registered_origin = registered.as_ref().is_some_and(|item| {
        // Registros LuaTools antigos nao declaravam a fonte.
        ghostbox_origin(item) || text(item, "librarySource").is_empty()
    });
    if !ghostbox_origin(game) && !registered_origin {
        return None;
    }

    let mut resolved = game.clone();
    if text(&resolved, "installPath").is_empty() && !text(&resolved, "outputDir").is_empty() {
        resolved["installPath"] = json!(text(&resolved, "outputDir"));
    }
    for key in ["title", "installPath", "installDir"] {
        if text(&resolved, key).is_empty() {
            if let Some(value) = registered.as_ref().and_then(|item| item.get(key)) {
                resolved[key] = value.clone();
            }
        }
    }
    if !Path::new(text(&resolved, "installPath")).is_dir() {
        if let Some(steam_path) = crate::resolve_steam_path(app, None).0 {
            let libraries = crate::steam::read_steam_library_paths(&steam_path);
            if let Some(installed) = crate::steam::scan_installed_steam_games(&libraries)
                .into_iter()
                .find(|item| text(item, "appId") == app_id)
            {
                for key in ["installPath", "installDir"] {
                    resolved[key] = installed.get(key).cloned().unwrap_or(Value::Null);
                }
            }
        }
    }
    Some(resolved)
}

fn validated_executable(game: &Value) -> Result<PathBuf, String> {
    let root = Path::new(text(game, "installPath"))
        .canonicalize()
        .map_err(|_| "A pasta de instalacao do jogo nao esta disponivel.".to_string())?;
    if !root.is_dir() {
        return Err("A instalacao do jogo nao e uma pasta.".to_string());
    }
    let downloads_root = text(game, "downloadsRoot");
    if !downloads_root.is_empty() {
        let downloads_root = Path::new(downloads_root)
            .canonicalize()
            .map_err(|error| error.to_string())?;
        if root == downloads_root || !root.starts_with(&downloads_root) {
            return Err("A instalacao esta fora da biblioteca de downloads.".to_string());
        }
    }
    let mut canonical_game = game.clone();
    canonical_game["installPath"] = json!(root.to_string_lossy());
    let executable = crate::playtime::find_likely_game_executable(&canonical_game)
        .ok_or("Nenhum executavel do jogo foi encontrado. Verifique se o download foi concluido.")?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !executable.starts_with(&root)
        || !executable.is_file()
        || !executable
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
    {
        return Err("O executavel detectado esta fora da instalacao do jogo.".to_string());
    }
    Ok(executable)
}

pub(crate) fn launch(app: &tauri::AppHandle, game: Value, app_id: &str) -> Result<String, String> {
    let executable = validated_executable(&game)?;
    let working_dir = executable
        .parent()
        .ok_or("Executavel sem pasta de trabalho.")?;
    // Nao usa shell, argumentos legados, Steam URI ou preparacao de emuladores.
    std::process::Command::new(&executable).current_dir(working_dir).spawn()
        .map_err(|error| format!("Nao foi possivel iniciar o jogo: {error}. Se ele exigir a Steam, ative a opcao em Ajustes > Downloads."))?;
    if crate::playtime::mark_process_fallback_started(app_id) {
        crate::playtime::monitor_game_process(
            app.clone(),
            game,
            app_id.to_string(),
            executable.clone(),
        );
    }
    Ok(executable.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_launch_requires_an_explicit_opt_out() {
        for settings in [
            json!({}),
            json!({"openSteamOnGameLaunch": true}),
            json!({"openSteamOnGameLaunch": null}),
            json!({"openSteamOnGameLaunch": "false"}),
        ] {
            assert!(!direct_launch_enabled(&settings));
        }
        assert!(direct_launch_enabled(
            &json!({"openSteamOnGameLaunch": false})
        ));
        assert!(!direct_launch_enabled(
            &crate::settings::default_startup_settings()
        ));
    }

    #[test]
    fn preference_migrates_and_survives_partial_startup_updates() {
        let legacy = crate::util::merge_object_defaults(
            crate::settings::default_startup_settings(),
            json!({"openAtLogin": true}),
        );
        assert!(!direct_launch_enabled(&legacy));
        let disabled =
            crate::util::merge_object_defaults(legacy, json!({"openSteamOnGameLaunch": false}));
        let updated = crate::util::merge_object_defaults(disabled, json!({"minimizeToTray": true}));
        assert!(direct_launch_enabled(&updated));
        assert_eq!(updated["openAtLogin"], true);
        assert_eq!(updated["minimizeToTray"], true);
    }

    #[test]
    fn steam_installs_and_incomplete_tasks_do_not_use_direct_launch() {
        for game in [
            json!({}),
            json!({"librarySource": "steam-installed"}),
            json!({"librarySource": "registered"}),
            json!({"status": "paused", "outputDir": "game", "downloadsRoot": "root"}),
        ] {
            assert!(!ghostbox_origin(&game));
        }
        for game in [
            json!({"librarySource": "ghostbox"}),
            json!({"librarySource": "plugin"}),
            json!({"downloadedByGhostBox": true}),
            json!({"status": "completed", "outputDir": "game", "downloadsRoot": "root"}),
        ] {
            assert!(ghostbox_origin(&game));
        }
    }

    #[test]
    fn executable_is_detected_in_the_installation_not_from_legacy_overrides() {
        let root = std::env::temp_dir()
            .join("opencode")
            .join(format!("ghostbox-launch-{}", uuid::Uuid::new_v4()));
        let game_dir = root.join("Example");
        std::fs::create_dir_all(&game_dir).unwrap();
        std::fs::write(root.join("outside.exe"), b"outside").unwrap();
        let mut game = json!({"installPath": game_dir, "downloadsRoot": root, "title": "Example", "customExePath": root.join("outside.exe"), "launchArguments": "ignored"});
        assert!(validated_executable(&game).is_err());
        std::fs::write(game_dir.join("Example.exe"), b"game").unwrap();
        assert_eq!(
            validated_executable(&game).unwrap(),
            game_dir.join("Example.exe").canonicalize().unwrap()
        );
        game["downloadsRoot"] = json!(game_dir);
        assert!(validated_executable(&game).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
