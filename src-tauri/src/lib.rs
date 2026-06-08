#[tauri::command]
fn get_app_status() -> serde_json::Value {
    serde_json::json!({
        "name": "PirateBox Tauri",
        "version": env!("CARGO_PKG_VERSION"),
        "runtime": "tauri-2",
        "dev": cfg!(debug_assertions)
    })
}

#[tauri::command]
fn get_games() -> serde_json::Value {
    serde_json::json!({
        "games": [],
        "total": 0,
        "matched": 0,
        "limited": false,
        "source": "tauri-stub"
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_app_status, get_games])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
