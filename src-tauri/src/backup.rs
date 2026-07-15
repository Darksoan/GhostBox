use crate::catalogue::fetch_remote_game;
use crate::util::text_value;
use crate::{
    backup_details_for_path, is_path_inside_or_equal, load_backup_settings,
    resolve_steam_path, selected_backup_entry_path,
};

#[tauri::command]
pub fn backup_get_settings(app: tauri::AppHandle) -> serde_json::Value {
    load_backup_settings(&app)
}

#[tauri::command]
pub fn backup_remove_record(
    app: tauri::AppHandle,
    app_id: String,
) -> Result<serde_json::Value, String> {
    crate::remove_backup_record(&app, app_id.trim())
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
