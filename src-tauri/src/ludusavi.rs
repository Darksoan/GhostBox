use crate::util::{silent_command, text_value, EmptyStringExt};

pub(crate) fn ludusavi_config_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;

    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("ludusavi");
    std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

pub(crate) fn ludusavi_binary_path() -> Result<std::path::PathBuf, String> {
    const BINARY_NAMES: [&str; 2] = ["ludusavi-x86_64-pc-windows-msvc.exe", "ludusavi.exe"];

    // Installed builds get the sidecar next to the executable (tauri.conf.json
    // `externalBin`). CARGO_MANIFEST_DIR is a build-time path that only exists
    // on the dev machine, so it is a fallback, never the first choice.
    let mut roots = Vec::new();
    if let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(std::path::Path::to_path_buf))
    {
        roots.push(exe_dir);
    }
    roots.push(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries"));

    roots
        .into_iter()
        .flat_map(|root| BINARY_NAMES.map(|name| root.join(name)))
        .find(|path| path.exists())
        .ok_or_else(|| "Sidecar do Ludusavi não encontrado.".to_string())
}

pub(crate) fn run_ludusavi(
    app: &tauri::AppHandle,
    args: &[String],
) -> Result<serde_json::Value, String> {
    let binary = ludusavi_binary_path()?;
    let config_dir = ludusavi_config_dir(app)?;
    let output = silent_command(binary)
        .arg("--config")
        .arg(config_dir)
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(stderr
            .if_empty(stdout)
            .if_empty("Falha ao executar Ludusavi.".to_string()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        return Ok(serde_json::json!({}));
    }

    serde_json::from_str(&stdout).map_err(|error| format!("Saída inválida do Ludusavi: {error}"))
}

pub(crate) fn game_title(game: &serde_json::Value, app_id: &str) -> String {
    text_value(game.get("title")).if_empty(app_id.to_string())
}

pub(crate) fn is_steam_app_title_placeholder(title: &str, app_id: &str) -> bool {
    let normalized_title = title
        .trim()
        .chars()
        .filter(|character| !character.is_whitespace() && *character != '-' && *character != '_')
        .collect::<String>()
        .to_ascii_lowercase();
    let normalized_app_id = app_id.trim().to_ascii_lowercase();

    if normalized_title.is_empty() {
        return true;
    }
    if normalized_app_id.is_empty() {
        return false;
    }

    normalized_title == normalized_app_id
        || normalized_title == format!("steam{normalized_app_id}")
        || normalized_title == format!("steamapp{normalized_app_id}")
        || normalized_title == format!("steamappid{normalized_app_id}")
}

pub(crate) fn resolved_game_title(
    app: &tauri::AppHandle,
    game: &serde_json::Value,
    app_id: &str,
) -> String {
    let title = game_title(game, app_id);
    if !is_steam_app_title_placeholder(&title, app_id) {
        return title;
    }

    crate::catalogue::read_cached_steam_store_title(app, app_id)
        .or_else(|| crate::catalogue::read_local_steam_app_title(app, app_id))
        .filter(|title| !is_steam_app_title_placeholder(title, app_id))
        .unwrap_or_else(|| app_id.to_string())
}

/// Resolve the game name Ludusavi's manifest actually knows.
///
/// Ludusavi's `backup`/`restore` take manifest game *names*, not Steam app ids:
/// passing "2138720" yields `unknownGames` and silently copies zero saves.
/// `find --steam-id` maps the app id to the canonical name ("Rematch"), which
/// also differs in casing from the Steam store title ("REMATCH").
pub(crate) fn resolve_ludusavi_game_name(
    app: &tauri::AppHandle,
    app_id: &str,
    title: &str,
) -> Option<String> {
    let first_match = |value: serde_json::Value| -> Option<String> {
        value
            .get("games")?
            .as_object()?
            .keys()
            .next()
            .map(String::to_owned)
    };

    if !app_id.trim().is_empty() {
        let args = [
            "find".to_string(),
            "--api".to_string(),
            "--steam-id".to_string(),
            app_id.trim().to_string(),
        ];
        if let Some(name) = run_ludusavi(app, &args).ok().and_then(first_match) {
            return Some(name);
        }
    }

    if !title.trim().is_empty() && !is_steam_app_title_placeholder(title, app_id) {
        let args = [
            "find".to_string(),
            "--api".to_string(),
            "--normalized".to_string(),
            title.trim().to_string(),
        ];
        if let Some(name) = run_ludusavi(app, &args).ok().and_then(first_match) {
            return Some(name);
        }
    }

    None
}

pub(crate) fn ludusavi_args(
    command: &str,
    game_name: &str,
    path_arg: Option<&str>,
    preview: bool,
) -> Vec<String> {
    let mut args = vec![
        command.to_string(),
        game_name.to_string(),
        "--api".to_string(),
        "--force".to_string(),
    ];
    if preview {
        args.push("--preview".to_string());
    }
    if let Some(path) = path_arg {
        args.push("--path".to_string());
        args.push(path.to_string());
    }
    args
}

