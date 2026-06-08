fn empty_game_database() -> serde_json::Value {
    serde_json::json!({
        "games": [],
        "total": 0,
        "matched": 0,
        "limited": false,
        "source": "tauri-stub"
    })
}

fn default_startup_settings() -> serde_json::Value {
    serde_json::json!({
        "openAtLogin": false,
        "startMinimized": false,
        "minimizeToTray": false,
        "gameDatabaseUpdateIntervalHours": 24
    })
}

#[tauri::command]
fn app_get_status() -> serde_json::Value {
    serde_json::json!({
        "name": "PirateBox Tauri",
        "version": env!("CARGO_PKG_VERSION"),
        "runtime": "tauri-2",
        "dev": cfg!(debug_assertions)
    })
}

#[tauri::command]
fn database_get_games(request: Option<serde_json::Value>) -> serde_json::Value {
    let _ = request;
    empty_game_database()
}

#[tauri::command]
fn database_get_game_details(game_id: String) -> Option<serde_json::Value> {
    let _ = game_id;
    None
}

#[tauri::command]
fn database_get_game_store_details(game_id: String) -> Option<serde_json::Value> {
    let _ = game_id;
    None
}

#[tauri::command]
fn database_get_game_achievement_details(game_id: String) -> Option<serde_json::Value> {
    let _ = game_id;
    None
}

#[tauri::command]
fn cache_get_image(url: String) -> String {
    url
}

#[tauri::command]
fn app_get_startup_settings() -> serde_json::Value {
    default_startup_settings()
}

#[tauri::command]
fn app_set_startup_settings(settings: serde_json::Value) -> serde_json::Value {
    settings
}

#[tauri::command]
fn app_set_notification_settings(_settings: serde_json::Value) {}

#[tauri::command]
fn window_minimize(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
fn window_close(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|error| error.to_string())
}

#[tauri::command]
fn shell_open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            app_get_status,
            database_get_games,
            database_get_game_details,
            database_get_game_store_details,
            database_get_game_achievement_details,
            cache_get_image,
            app_get_startup_settings,
            app_set_startup_settings,
            app_set_notification_settings,
            window_minimize,
            window_close,
            shell_open_external,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
