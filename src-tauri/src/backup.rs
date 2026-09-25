use crate::load_backup_settings;

#[tauri::command]
pub fn backup_get_settings(app: tauri::AppHandle) -> serde_json::Value {
    load_backup_settings(&app)
}
