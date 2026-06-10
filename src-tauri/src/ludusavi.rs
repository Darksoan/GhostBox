use crate::util::{text_value, EmptyStringExt};

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
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidates = [
        manifest_dir
            .join("binaries")
            .join("ludusavi-x86_64-pc-windows-msvc.exe"),
        manifest_dir.join("binaries").join("ludusavi.exe"),
    ];

    candidates
        .into_iter()
        .find(|path| path.exists())
        .ok_or_else(|| "Sidecar do Ludusavi não encontrado.".to_string())
}

pub(crate) fn run_ludusavi(
    app: &tauri::AppHandle,
    args: &[String],
) -> Result<serde_json::Value, String> {
    let binary = ludusavi_binary_path()?;
    let config_dir = ludusavi_config_dir(app)?;
    let output = std::process::Command::new(binary)
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

pub(crate) fn ludusavi_args(
    command: &str,
    app_id: &str,
    path_arg: Option<&str>,
    preview: bool,
) -> Vec<String> {
    let mut args = vec![
        command.to_string(),
        app_id.to_string(),
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

#[tauri::command]
pub fn ludusavi_get_backup_previews(
    app: tauri::AppHandle,
    games: Vec<serde_json::Value>,
) -> Vec<serde_json::Value> {
    let mut previews = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for game in games {
        let app_id = crate::extract_app_id(&game);
        if app_id.is_empty() || !seen.insert(app_id.clone()) {
            continue;
        }

        let args = ludusavi_args("backup", &app_id, None, true);
        let Ok(result) = run_ludusavi(&app, &args) else {
            continue;
        };
        let has_files = result
            .get("games")
            .and_then(|games| games.as_object())
            .and_then(|games| games.values().next())
            .and_then(|game| game.get("files"))
            .and_then(|files| files.as_object())
            .is_some_and(|files| !files.is_empty());

        if has_files {
            previews.push(serde_json::json!({
                "id": text_value(game.get("id")).if_empty(format!("steam-{app_id}")),
                "appId": app_id,
                "title": game_title(&game, &app_id)
            }));
        }
    }

    previews.sort_by(|a, b| text_value(a.get("title")).cmp(&text_value(b.get("title"))));
    previews
}
