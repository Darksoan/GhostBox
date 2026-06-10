use crate::catalogue::fetch_remote_game;
use crate::ludusavi::{game_title, ludusavi_args, run_ludusavi};
use crate::steam_appcache;
use crate::util::text_value;
use crate::{
    backup_details_for_path, backup_marker_path, backup_root_status, backup_timestamp,
    default_backup_output_path, directory_has_content, directory_size, extract_app_id,
    get_backup_record_entries, is_path_inside_or_equal, load_backup_settings, make_backup_entry,
    persist_backup_settings, resolve_steam_path, sanitize_folder_name, save_backup_record,
    save_backup_settings, save_failed_backup_record, save_successful_backup_record,
    selected_backup_entry_path, selected_backup_path, to_backup_root_path,
    write_backup_root_marker,
};

#[tauri::command]
pub fn backup_get_settings(app: tauri::AppHandle) -> serde_json::Value {
    load_backup_settings(&app)
}

#[tauri::command]
pub fn backup_validate_root(app: tauri::AppHandle) -> serde_json::Value {
    let mut settings = load_backup_settings(&app);
    let output_path = text_value(settings.get("outputPath"));

    if output_path.is_empty() {
        return backup_root_status(
            "missing",
            "",
            settings,
            "A pasta de backups ainda nÃ£o foi configurada.",
        );
    }

    let output = std::path::PathBuf::from(&output_path);
    if !output.exists() {
        if output_path == default_backup_output_path(&app) {
            match write_backup_root_marker(&output_path) {
                Ok(()) => {
                    if let Ok(saved) =
                        save_backup_settings(&app, serde_json::json!({ "outputPath": output_path }))
                    {
                        settings = saved;
                    }
                    return backup_root_status(
                        "ok",
                        &output_path,
                        settings,
                        "Pasta de backups pronta.",
                    );
                }
                Err(error) => {
                    return backup_root_status(
                        "missing",
                        &output_path,
                        settings,
                        &format!("NÃ£o foi possÃ­vel criar a pasta de backups padrÃ£o: {error}"),
                    );
                }
            }
        }

        return backup_root_status(
            "missing",
            &output_path,
            settings,
            "A pasta de backups configurada nÃ£o foi encontrada. Ela pode ter sido movida ou removida.",
        );
    }

    if !backup_marker_path(&output_path).exists() {
        return backup_root_status(
            "invalid",
            &output_path,
            settings,
            "A pasta selecionada nÃ£o parece ser uma raiz de backups do PirateBox.",
        );
    }

    backup_root_status("ok", &output_path, settings, "Pasta de backups pronta.")
}

#[tauri::command]
pub fn backup_ensure_root(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let settings = load_backup_settings(&app);
    let output_path = to_backup_root_path(&text_value(settings.get("outputPath")));
    write_backup_root_marker(&output_path)?;
    let _ = save_backup_settings(&app, serde_json::json!({ "outputPath": output_path }))?;
    Ok(backup_validate_root(app))
}

#[tauri::command]
pub fn backup_set_output_path(
    app: tauri::AppHandle,
    output_path: String,
) -> Result<serde_json::Value, String> {
    let output_path = to_backup_root_path(&output_path);
    write_backup_root_marker(&output_path)?;
    save_backup_settings(&app, serde_json::json!({ "outputPath": output_path }))
}

#[tauri::command]
pub fn backup_set_game_automatic(
    app: tauri::AppHandle,
    app_id: String,
    enabled: bool,
) -> Result<serde_json::Value, String> {
    let app_id = app_id.trim();
    if app_id.is_empty() {
        return Ok(load_backup_settings(&app));
    }

    save_backup_settings(
        &app,
        serde_json::json!({ "automaticBackups": { app_id: enabled } }),
    )
}

#[tauri::command]
pub fn backup_set_library_automatic(
    app: tauri::AppHandle,
    enabled: bool,
    app_ids: Vec<String>,
) -> Result<serde_json::Value, String> {
    let automatic_backups = app_ids
        .into_iter()
        .map(|app_id| app_id.trim().to_string())
        .filter(|app_id| !app_id.is_empty())
        .map(|app_id| (app_id, serde_json::json!(enabled)))
        .collect::<serde_json::Map<String, serde_json::Value>>();

    save_backup_settings(
        &app,
        serde_json::json!({
            "automaticBackupsForLibrary": enabled,
            "automaticBackups": automatic_backups
        }),
    )
}

#[tauri::command]
pub fn backup_set_entry_pinned(
    app: tauri::AppHandle,
    app_id: String,
    backup_path: String,
    pinned: bool,
) -> Result<serde_json::Value, String> {
    let app_id = app_id.trim().to_string();
    let backup_path = backup_path.trim().to_string();
    let settings = load_backup_settings(&app);
    let Some(record) = settings
        .get("backupRecords")
        .and_then(|records| records.get(&app_id))
        .cloned()
    else {
        return Ok(settings);
    };
    if backup_path.is_empty() {
        return Ok(settings);
    }

    let entries = get_backup_record_entries(Some(&record));
    let next_entries = entries
        .into_iter()
        .map(|entry| {
            if text_value(entry.get("path")) == backup_path {
                serde_json::json!({
                    "path": backup_path,
                    "backupAt": entry.get("backupAt").cloned().unwrap_or_else(|| serde_json::json!("")),
                    "sizeBytes": entry.get("sizeBytes").cloned(),
                    "pinned": pinned
                })
            } else {
                entry
            }
        })
        .collect::<Vec<_>>();
    if next_entries == get_backup_record_entries(Some(&record)) {
        return Ok(settings);
    }

    save_backup_record(
        &app,
        &app_id,
        serde_json::json!({
            "title": record.get("title").cloned().unwrap_or_else(|| serde_json::json!(app_id)),
            "lastBackupAt": record.get("lastBackupAt").cloned().unwrap_or_else(|| serde_json::json!("")),
            "lastBackupSuccess": record.get("lastBackupSuccess").cloned().unwrap_or_else(|| serde_json::json!(false)),
            "lastBackupPath": record.get("lastBackupPath").cloned(),
            "lastBackupError": record.get("lastBackupError").cloned(),
            "lastBackupSizeBytes": record.get("lastBackupSizeBytes").cloned(),
            "entries": next_entries
        }),
    )
}

#[tauri::command]
pub fn backup_set_game_custom_executable(
    app: tauri::AppHandle,
    app_id: String,
    executable_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let app_id = app_id.trim();
    if app_id.is_empty() {
        return Ok(load_backup_settings(&app));
    }

    let mut settings = load_backup_settings(&app);
    let mut custom_executables = settings
        .get("customExecutables")
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();

    match executable_path
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
    {
        Some(path) => {
            custom_executables.insert(app_id.to_string(), serde_json::json!(path));
        }
        None => {
            custom_executables.remove(app_id);
        }
    }

    settings["customExecutables"] = serde_json::Value::Object(custom_executables);
    save_backup_settings(&app, settings)
}

#[tauri::command]
pub fn backup_open_folder(
    app: tauri::AppHandle,
    app_id: String,
    backup_path: Option<String>,
) -> Result<serde_json::Value, String> {
    use tauri_plugin_opener::OpenerExt;

    let settings = load_backup_settings(&app);
    let output_path = text_value(settings.get("outputPath"));
    let selected_path = selected_backup_path(&settings, app_id.trim(), backup_path);

    if selected_path.is_empty() {
        return Ok(
            serde_json::json!({ "success": false, "error": "Caminho de backup invÃ¡lido." }),
        );
    }

    let root = std::path::PathBuf::from(&output_path);
    let selected = std::path::PathBuf::from(&selected_path);
    if !is_path_inside_or_equal(&root, &selected) {
        return Ok(serde_json::json!({
            "success": false,
            "path": selected_path,
            "error": "A pasta de backup estÃ¡ fora da raiz configurada."
        }));
    }

    app.opener()
        .open_path(selected_path.clone(), None::<&str>)
        .map(|_| serde_json::json!({ "success": true, "path": selected_path }))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn backup_delete_folder(
    app: tauri::AppHandle,
    app_id: String,
    backup_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let app_id = app_id.trim().to_string();
    let mut settings = load_backup_settings(&app);
    let output_path = text_value(settings.get("outputPath"));
    let selected_path = selected_backup_path(&settings, &app_id, backup_path);

    if app_id.is_empty() || selected_path.is_empty() {
        return Ok(serde_json::json!({
            "success": false,
            "error": "Nenhuma pasta de backup vÃ¡lida foi encontrada."
        }));
    }

    let root = std::path::PathBuf::from(&output_path);
    let selected = std::path::PathBuf::from(&selected_path);
    if !is_path_inside_or_equal(&root, &selected) {
        return Ok(serde_json::json!({
            "success": false,
            "path": selected_path,
            "error": "A pasta de backup estÃ¡ fora da raiz configurada."
        }));
    }

    if let Err(error) = std::fs::remove_dir_all(&selected) {
        return Ok(serde_json::json!({
            "success": false,
            "path": selected_path,
            "error": error.to_string()
        }));
    }

    if let Some(records) = settings
        .get_mut("backupRecords")
        .and_then(|value| value.as_object_mut())
    {
        records.remove(&app_id);
    }
    let settings = persist_backup_settings(&app, settings)?;

    Ok(serde_json::json!({
        "success": true,
        "path": selected_path,
        "settings": settings
    }))
}

#[tauri::command]
pub fn backup_refresh_game_metadata(app: tauri::AppHandle, _app_id: String) -> serde_json::Value {
    load_backup_settings(&app)
}

#[tauri::command]
pub async fn backup_get_details(
    app: tauri::AppHandle,
    app_id: String,
    backup_path: Option<String>,
    api_url: Option<String>,
) -> Result<Option<serde_json::Value>, String> {
    let app_id = app_id.trim().to_string();
    let settings = load_backup_settings(&app);
    let selected_path = selected_backup_entry_path(&settings, &app_id, backup_path);
    if app_id.is_empty() || selected_path.is_empty() {
        return Ok(None);
    }

    let root = std::path::PathBuf::from(text_value(settings.get("outputPath")));
    let selected = std::path::PathBuf::from(&selected_path);
    if !is_path_inside_or_equal(&root, &selected) || !selected.exists() {
        return Ok(None);
    }

    let (steam_path, _) = resolve_steam_path(&app, None);
    let remote_game = fetch_remote_game(&app, app_id.clone(), api_url).await?;
    let steam_achievements = remote_game
        .as_ref()
        .and_then(|game| game.get("achievementList"))
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    backup_details_for_path(
        &app,
        &app_id,
        &selected_path,
        steam_path.as_deref().unwrap_or_default(),
        &steam_achievements,
    )
    .map(Some)
}

#[tauri::command]
pub fn backup_run_game_local(
    app: tauri::AppHandle,
    game: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let app_id = extract_app_id(&game);
    let title = game_title(&game, &app_id);
    if app_id.is_empty() {
        return Ok(serde_json::json!({
            "success": false,
            "appId": "",
            "title": title,
            "error": "Jogo invÃ¡lido para backup."
        }));
    }

    let status = backup_validate_root(app.clone());
    let settings = status
        .get("settings")
        .cloned()
        .unwrap_or_else(|| load_backup_settings(&app));
    if status.get("status").and_then(|value| value.as_str()) != Some("ok") {
        return Ok(serde_json::json!({
            "success": false,
            "appId": app_id,
            "title": title,
            "error": text_value(status.get("message")),
            "settings": settings
        }));
    }

    let output_root = text_value(settings.get("outputPath"));
    let output_path = std::path::PathBuf::from(&output_root)
        .join(sanitize_folder_name(&title))
        .join(backup_timestamp());
    std::fs::create_dir_all(&output_path).map_err(|error| error.to_string())?;
    let output_path_text = output_path.to_string_lossy().to_string();
    let args = ludusavi_args("backup", &app_id, Some(&output_path_text), false);

    if let Err(error) = run_ludusavi(&app, &args) {
        let _ = std::fs::remove_dir_all(&output_path);
        let settings = save_failed_backup_record(&app, &app_id, &title, &output_path_text, &error)
            .unwrap_or(settings);
        return Ok(serde_json::json!({
            "success": false,
            "appId": app_id,
            "title": title,
            "outputPath": output_path_text,
            "error": error,
            "settings": settings
        }));
    }

    if !directory_has_content(&output_path) {
        let _ = std::fs::remove_dir_all(&output_path);
        return Ok(serde_json::json!({
            "success": false,
            "appId": app_id,
            "title": title,
            "skipped": true,
            "error": "Nenhum save encontrado para backup.",
            "settings": settings
        }));
    }

    if let Some(steam_path) = resolve_steam_path(&app, None).0 {
        steam_appcache::backup_steam_achievement_files(&steam_path, &app_id, &output_path);
    }

    let size_bytes = directory_size(std::path::Path::new(&output_path_text)).unwrap_or(0);
    let entry = make_backup_entry(&output_path_text, size_bytes);
    let settings = save_successful_backup_record(&app, &app_id, &title, entry)?;
    Ok(serde_json::json!({
        "success": true,
        "appId": app_id,
        "title": title,
        "outputPath": output_path_text,
        "settings": settings
    }))
}

#[tauri::command]
pub fn backup_restore_game_local(
    app: tauri::AppHandle,
    game: serde_json::Value,
    backup_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let app_id = extract_app_id(&game);
    let title = game_title(&game, &app_id);
    let settings = load_backup_settings(&app);
    let selected_path = selected_backup_entry_path(&settings, &app_id, backup_path);

    if app_id.is_empty() || selected_path.is_empty() {
        return Ok(serde_json::json!({
            "success": false,
            "appId": app_id,
            "title": title,
            "error": "Nenhum backup vÃ¡lido encontrado para este jogo.",
            "settings": settings
        }));
    }

    let root = std::path::PathBuf::from(text_value(settings.get("outputPath")));
    let selected = std::path::PathBuf::from(&selected_path);
    if !is_path_inside_or_equal(&root, &selected) || !selected.exists() {
        return Ok(serde_json::json!({
            "success": false,
            "appId": app_id,
            "title": title,
            "backupPath": selected_path,
            "error": "A pasta de backup estÃ¡ fora da raiz configurada ou nÃ£o existe.",
            "settings": settings
        }));
    }

    let args = ludusavi_args("restore", &app_id, Some(&selected_path), false);
    if let Err(error) = run_ludusavi(&app, &args) {
        return Ok(serde_json::json!({
            "success": false,
            "appId": app_id,
            "title": title,
            "backupPath": selected_path,
            "error": error,
            "settings": settings
        }));
    }

    if let Some(steam_path) = resolve_steam_path(&app, None).0 {
        steam_appcache::restore_steam_achievement_files(&steam_path, &app_id, &selected);
    }

    Ok(serde_json::json!({
        "success": true,
        "appId": app_id,
        "title": title,
        "backupPath": selected_path,
        "backupSizeBytes": directory_size(&selected).unwrap_or(0),
        "settings": settings
    }))
}
