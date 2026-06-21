use crate::util::{merge_object_defaults, text_value, EmptyStringExt};

pub(crate) const STARTUP_SETTINGS_FILE: &str = "startup-settings.json";
pub(crate) const NOTIFICATION_SETTINGS_FILE: &str = "notification-settings.json";
const HUBCAP_MANIFEST_API_KEY_FILE: &str = "morrenus-api-key.bin";
const STEAM_WEB_API_KEY_FILE: &str = "steam-web-api-key.bin";
const DEFAULT_STEAM_STATS_PROXY_URL: &str = "https://ghostbox-steam-stats.hella.workers.dev";

pub(crate) fn default_startup_settings() -> serde_json::Value {
    serde_json::json!({
        "openAtLogin": false,
        "startMinimized": false,
        "minimizeToTray": false,
        "gameDatabaseUpdateIntervalHours": 24
    })
}

pub(crate) fn default_notification_settings() -> serde_json::Value {
    serde_json::json!({
        "inAppToastsEnabled": true,
        "inAppSuccessToastsEnabled": true,
        "inAppErrorToastsEnabled": true,
        "desktopNotificationsEnabled": true,
        "achievementsEnabled": true,
        "backupSuccessEnabled": true,
        "backupErrorEnabled": true,
        "restoreSuccessEnabled": true,
        "restoreErrorEnabled": true
    })
}

pub(crate) fn data_file_path(
    app: &tauri::AppHandle,
    file_name: &str,
) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;

    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(file_name))
}

pub(crate) fn read_json_file(app: &tauri::AppHandle, file_name: &str) -> Option<serde_json::Value> {
    let path = data_file_path(app, file_name).ok()?;
    let contents = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&contents).ok()
}

pub(crate) fn write_json_file(
    app: &tauri::AppHandle,
    file_name: &str,
    value: &serde_json::Value,
) -> Result<(), String> {
    let path = data_file_path(app, file_name)?;
    let contents = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    std::fs::write(path, contents).map_err(|error| error.to_string())
}

pub(crate) fn read_binary_file(app: &tauri::AppHandle, file_name: &str) -> Result<Vec<u8>, String> {
    let path = data_file_path(app, file_name)?;
    std::fs::read(path).map_err(|error| error.to_string())
}

pub(crate) fn write_binary_file(
    app: &tauri::AppHandle,
    file_name: &str,
    value: &[u8],
) -> Result<(), String> {
    let path = data_file_path(app, file_name)?;
    std::fs::write(path, value).map_err(|error| error.to_string())
}

pub(crate) fn remove_data_file(app: &tauri::AppHandle, file_name: &str) -> Result<(), String> {
    let path = data_file_path(app, file_name)?;
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(target_os = "windows")]
fn encrypt_secret_for_current_user(value: &str) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let mut input = value.as_bytes().to_vec();
    let mut input_blob = CRYPT_INTEGER_BLOB {
        cbData: input.len().try_into().unwrap_or(u32::MAX),
        pbData: input.as_mut_ptr(),
    };
    let mut output_blob = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    let ok = unsafe {
        CryptProtectData(
            &mut input_blob,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output_blob,
        )
    };

    if ok == 0 {
        return Err("Falha ao proteger a API key do Hubcap's Manifest.".to_string());
    }

    let protected = unsafe {
        std::slice::from_raw_parts(output_blob.pbData, output_blob.cbData as usize).to_vec()
    };
    unsafe {
        LocalFree(output_blob.pbData as _);
    }
    Ok(protected)
}

#[cfg(target_os = "windows")]
fn decrypt_secret_for_current_user(value: &[u8]) -> Result<String, String> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let mut input = value.to_vec();
    let mut input_blob = CRYPT_INTEGER_BLOB {
        cbData: input.len().try_into().unwrap_or(u32::MAX),
        pbData: input.as_mut_ptr(),
    };
    let mut output_blob = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    let ok = unsafe {
        CryptUnprotectData(
            &mut input_blob,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output_blob,
        )
    };

    if ok == 0 {
        return Err("Falha ao desproteger a API key do Hubcap's Manifest.".to_string());
    }

    let decrypted = unsafe {
        std::slice::from_raw_parts(output_blob.pbData, output_blob.cbData as usize).to_vec()
    };
    unsafe {
        LocalFree(output_blob.pbData as _);
    }

    String::from_utf8(decrypted).map_err(|_| "API key do Hubcap's Manifest inválida.".to_string())
}

#[cfg(not(target_os = "windows"))]
fn encrypt_secret_for_current_user(value: &str) -> Result<Vec<u8>, String> {
    Ok(value.as_bytes().to_vec())
}

#[cfg(not(target_os = "windows"))]
fn decrypt_secret_for_current_user(value: &[u8]) -> Result<String, String> {
    String::from_utf8(value.to_vec())
        .map_err(|_| "API key do Hubcap's Manifest inválida.".to_string())
}

pub(crate) fn load_morrenus_api_key(app: &tauri::AppHandle) -> String {
    match read_binary_file(app, HUBCAP_MANIFEST_API_KEY_FILE) {
        Ok(bytes) if bytes.is_empty() => String::new(),
        Ok(bytes) => decrypt_secret_for_current_user(&bytes).unwrap_or_default(),
        Err(_) => String::new(),
    }
}

pub(crate) fn save_morrenus_api_key(
    app: &tauri::AppHandle,
    api_key: &str,
) -> Result<String, String> {
    let normalized = api_key.trim().to_string();
    if normalized.is_empty() {
        remove_data_file(app, HUBCAP_MANIFEST_API_KEY_FILE)?;
        return Ok(normalized);
    }

    let payload = encrypt_secret_for_current_user(&normalized)?;
    write_binary_file(app, HUBCAP_MANIFEST_API_KEY_FILE, &payload)?;
    Ok(normalized)
}

pub(crate) fn load_steam_web_api_key(app: &tauri::AppHandle) -> String {
    if let Ok(api_key) = std::env::var("GHOSTBOX_STEAM_WEB_API_KEY") {
        let api_key = api_key.trim().to_string();
        if !api_key.is_empty() {
            return api_key;
        }
    }
    if let Ok(api_key) = std::env::var("STEAM_WEB_API_KEY") {
        let api_key = api_key.trim().to_string();
        if !api_key.is_empty() {
            return api_key;
        }
    }
    match read_binary_file(app, STEAM_WEB_API_KEY_FILE) {
        Ok(bytes) if bytes.is_empty() => String::new(),
        Ok(bytes) => decrypt_secret_for_current_user(&bytes).unwrap_or_default(),
        Err(_) => String::new(),
    }
}

pub(crate) fn load_steam_stats_proxy_url() -> String {
    for key in ["GHOSTBOX_STEAM_STATS_API_URL", "STEAM_STATS_API_URL"] {
        if let Ok(value) = std::env::var(key) {
            let value = value.trim().trim_end_matches('/').to_string();
            if value.starts_with("https://") {
                return value;
            }
        }
    }
    for value in [
        option_env!("GHOSTBOX_STEAM_STATS_API_URL"),
        option_env!("STEAM_STATS_API_URL"),
    ]
    .into_iter()
    .flatten()
    {
        let value = value.trim().trim_end_matches('/').to_string();
        if value.starts_with("https://") {
            return value;
        }
    }
    DEFAULT_STEAM_STATS_PROXY_URL.to_string()
}

pub(crate) fn load_startup_settings(app: &tauri::AppHandle) -> serde_json::Value {
    merge_object_defaults(
        default_startup_settings(),
        read_json_file(app, STARTUP_SETTINGS_FILE).unwrap_or_else(|| serde_json::json!({})),
    )
}

pub(crate) fn startup_setting_enabled(settings: &serde_json::Value, key: &str) -> bool {
    settings
        .get(key)
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

pub(crate) fn is_startup_setting_enabled(app: &tauri::AppHandle, key: &str) -> bool {
    startup_setting_enabled(&load_startup_settings(app), key)
}

pub(crate) fn apply_autostart_settings(
    app: &tauri::AppHandle,
    settings: &serde_json::Value,
) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;

    let autostart = app.autolaunch();
    if startup_setting_enabled(settings, "openAtLogin") {
        autostart.enable().map_err(|error| error.to_string())
    } else {
        autostart.disable().map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub fn app_get_startup_settings(app: tauri::AppHandle) -> serde_json::Value {
    load_startup_settings(&app)
}

#[tauri::command]
pub fn app_set_startup_settings(
    app: tauri::AppHandle,
    settings: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let current = load_startup_settings(&app);
    let mut next = merge_object_defaults(current, settings);
    if let Some(object) = next.as_object_mut() {
        let interval_hours = crate::catalogue_cache::normalize_update_interval_hours(
            object
                .get("gameDatabaseUpdateIntervalHours")
                .and_then(|value| value.as_u64()),
        );
        object.insert(
            "gameDatabaseUpdateIntervalHours".to_string(),
            serde_json::json!(interval_hours),
        );
    }
    write_json_file(&app, STARTUP_SETTINGS_FILE, &next)?;
    apply_autostart_settings(&app, &next)?;
    Ok(next)
}

#[tauri::command]
pub fn app_set_notification_settings(
    app: tauri::AppHandle,
    settings: serde_json::Value,
) -> Result<(), String> {
    let current = merge_object_defaults(
        default_notification_settings(),
        read_json_file(&app, NOTIFICATION_SETTINGS_FILE).unwrap_or_else(|| serde_json::json!({})),
    );
    let next = merge_object_defaults(current, settings);
    write_json_file(&app, NOTIFICATION_SETTINGS_FILE, &next)
}

#[tauri::command]
pub fn app_get_morrenus_api_key(app: tauri::AppHandle) -> String {
    load_morrenus_api_key(&app)
}

#[tauri::command]
pub fn app_set_morrenus_api_key(app: tauri::AppHandle, api_key: String) -> Result<String, String> {
    save_morrenus_api_key(&app, &api_key)
}

#[tauri::command]
pub async fn app_get_morrenus_stats(api_key: String) -> serde_json::Value {
    let normalized_api_key = api_key.trim();
    if normalized_api_key.is_empty() {
        return serde_json::json!({
            "success": false,
            "error": "Informe uma API key do Hubcap's Manifest."
        });
    }

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return serde_json::json!({
                "success": false,
                "error": error.to_string()
            });
        }
    };

    let response = match client
        .get("https://hubcapmanifest.com/api/v1/user/stats")
        .header(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {normalized_api_key}"),
        )
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return serde_json::json!({
                "success": false,
                "error": error.to_string()
            });
        }
    };

    let status = response.status();
    let response_text = match response.text().await {
        Ok(text) => text,
        Err(error) => {
            return serde_json::json!({
                "success": false,
                "error": error.to_string()
            });
        }
    };

    let data = serde_json::from_str::<serde_json::Value>(&response_text)
        .unwrap_or_else(|_| serde_json::json!(response_text));

    if !status.is_success() {
        let message = data
            .as_object()
            .map(|object| {
                text_value(object.get("error")).if_empty(text_value(object.get("message")))
            })
            .unwrap_or_else(|| text_value(Some(&data)));

        return serde_json::json!({
            "success": false,
            "error": message.if_empty(format!("Hubcap's Manifest respondeu HTTP {status}"))
        });
    }

    serde_json::json!({
        "success": true,
        "stats": data
    })
}
