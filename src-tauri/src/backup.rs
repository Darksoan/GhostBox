use crate::util::text_value;
use crate::{
    backup_marker_path, backup_root_status, default_backup_output_path, get_backup_record_entries,
    is_path_inside_or_equal, load_backup_settings, persist_backup_settings, save_backup_record,
    save_backup_settings, selected_backup_path, to_backup_root_path, write_backup_root_marker,
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
