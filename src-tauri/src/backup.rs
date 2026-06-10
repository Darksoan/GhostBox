use crate::util::text_value;
use crate::{
    backup_marker_path, backup_root_status, default_backup_output_path, load_backup_settings,
    save_backup_settings, to_backup_root_path, write_backup_root_marker,
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
