pub(crate) const FACETS_VERSION: &str = "facets-v11-primary-tags";
pub(crate) const RANKING_VERSION: &str = "ranking-v7";
const BACKUP_SETTINGS_FILE: &str = "backup-settings.json";
const STEAM_PROFILE_FILE: &str = "steam-profile.json";
const STEAM_LIBRARY_PATH_FILE: &str = "steam-library-path.json";
const GAME_PLAYTIME_FILE: &str = "game-playtime.json";
const BACKUP_ROOT_FOLDER_NAME: &str = "PirateBoxBackups";
const BACKUP_ROOT_MARKER_FILE: &str = "piratebox-backup-root.json";
const MAIN_WINDOW_LABEL: &str = "main";
const GAME_PLAYTIMES_CHANGED_EVENT: &str = "game-playtimes-changed";
const BACKUP_SETTINGS_CHANGED_EVENT: &str = "backup-settings-changed";
const WINDOW_HIDDEN_TO_TRAY_EVENT: &str = "window-hidden-to-tray";
const TRAY_SHOW_ID: &str = "show";
const TRAY_HIDE_ID: &str = "hide";
const TRAY_QUIT_ID: &str = "quit";
const APP_USER_MODEL_ID: &str = "com.piratebox.app";

static IS_QUITTING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static SHUTDOWN_STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

static STEAM_SIGN_IN_ACTIVE: std::sync::Mutex<bool> = std::sync::Mutex::new(false);
const MAX_PROFILE_AVATAR_BYTES: usize = 512 * 1024;
const STEAM_OPENID_ENDPOINT: &str = "https://steamcommunity.com/openid/login";
const PIRATEBOX_ACHIEVEMENTS_BACKUP_FILE: &str = "piratebox-achievements.json";
const BACKUP_ENTRY_RETENTION_LIMIT: usize = 3;
const STEAM_RUNNING_APP_MONITOR_INTERVAL_MS: u64 = 3000;
const GAME_PLAYTIME_SNAPSHOT_INTERVAL_MS: u64 = 3000;
const STEAM_PENDING_PROCESS_FALLBACK_AFTER_MS: u64 = 20_000;
const AUTOMATIC_BACKUP_DEBOUNCE_WINDOW_MS: u64 = 30_000;
const AUTOMATIC_BACKUP_DELAY_AFTER_CLOSE_MS: u64 = 2_000;

mod achievement_monitor;
mod catalogue;
mod catalogue_cache;
mod image_cache;
mod luatools;
mod ludusavi;
mod pirate_library;
mod settings;
mod steam_appcache;
mod util;

pub(crate) use catalogue::normalize_api_url;
pub(crate) use settings::load_startup_settings;

use catalogue::fetch_remote_game;
use ludusavi::{game_title, ludusavi_args, run_ludusavi};
use settings::{
    apply_autostart_settings, is_startup_setting_enabled, read_json_file, remove_data_file,
    startup_setting_enabled, write_json_file,
};
use util::{
    escape_html, merge_object_defaults, object_or_empty, text_value, xml_text, EmptyStringExt,
};

struct AchievementServerState {
    url: String,
    token: String,
    _stop: std::sync::mpsc::Sender<()>,
}

static ACHIEVEMENT_SERVER: std::sync::OnceLock<std::sync::Mutex<Option<AchievementServerState>>> =
    std::sync::OnceLock::new();

fn achievement_server_state() -> &'static std::sync::Mutex<Option<AchievementServerState>> {
    ACHIEVEMENT_SERVER.get_or_init(|| std::sync::Mutex::new(None))
}

fn default_backup_settings(app: &tauri::AppHandle) -> serde_json::Value {
    serde_json::json!({
        "outputPath": default_backup_output_path(app),
        "automaticBackupsForLibrary": false,
        "automaticBackups": {},
        "backupRecords": {},
        "customExecutables": {}
    })
}

fn default_backup_output_path(app: &tauri::AppHandle) -> String {
    use tauri::Manager;

    app.path()
        .document_dir()
        .ok()
        .or_else(|| app.path().app_data_dir().ok())
        .map(|path| to_backup_root_path(path.to_string_lossy().as_ref()))
        .unwrap_or_else(|| BACKUP_ROOT_FOLDER_NAME.to_string())
}

fn is_image_data_url(value: &str) -> bool {
    let value = value.trim().to_lowercase();
    value.starts_with("data:image/") && value.contains(";base64,")
}

async fn fetch_image_data_url(url: &str, max_bytes: usize) -> String {
    use base64::Engine;

    let Ok(parsed) = reqwest::Url::parse(url.trim()) else {
        return String::new();
    };
    if parsed.scheme() != "https" {
        return String::new();
    }

    let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
    else {
        return String::new();
    };
    let Ok(response) = client
        .get(parsed)
        .header(
            reqwest::header::ACCEPT,
            "image/avif,image/webp,image/png,image/jpeg,image/*,*/*",
        )
        .send()
        .await
    else {
        return String::new();
    };
    if !response.status().is_success() {
        return String::new();
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .unwrap_or_default()
        .to_lowercase();
    if !content_type.starts_with("image/") {
        return String::new();
    }
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return String::new();
    }

    let Ok(bytes) = response.bytes().await else {
        return String::new();
    };
    if bytes.len() > max_bytes {
        return String::new();
    }

    format!(
        "data:{content_type};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

async fn resolve_steam_profile_avatar_url(avatar_url: &str) -> String {
    let avatar_url = avatar_url.trim();
    if avatar_url.is_empty() || is_image_data_url(avatar_url) {
        return avatar_url.to_string();
    }

    let data_url = fetch_image_data_url(avatar_url, MAX_PROFILE_AVATAR_BYTES).await;
    if data_url.is_empty() {
        avatar_url.to_string()
    } else {
        data_url
    }
}

fn normalize_banner_position(value: Option<&serde_json::Value>) -> Option<serde_json::Value> {
    let raw = value?.as_object()?;
    let clamp_percent = |key: &str| {
        raw.get(key)
            .and_then(|value| value.as_f64())
            .filter(|value| value.is_finite())
            .unwrap_or(50.0)
            .round()
            .clamp(0.0, 100.0)
    };
    let scale = raw
        .get("scale")
        .and_then(|value| value.as_f64())
        .filter(|value| value.is_finite())
        .unwrap_or(1.0)
        .clamp(1.0, 3.0);

    Some(serde_json::json!({
        "x": clamp_percent("x"),
        "y": clamp_percent("y"),
        "scale": (scale * 100.0).round() / 100.0
    }))
}

fn normalize_steam_profile(profile: &serde_json::Value) -> Option<serde_json::Value> {
    let steam_id = text_value(profile.get("steamId"));
    let display_name = text_value(profile.get("displayName"));
    let profile_url = text_value(profile.get("profileUrl"));
    if steam_id.is_empty() || display_name.is_empty() || profile_url.is_empty() {
        return None;
    }

    let mut next = serde_json::json!({
        "steamId": steam_id,
        "displayName": display_name,
        "avatarUrl": text_value(profile.get("avatarUrl")),
        "bannerUrl": text_value(profile.get("bannerUrl")),
        "profileUrl": profile_url
    });
    if let Some(position) = normalize_banner_position(profile.get("bannerPosition")) {
        next["bannerPosition"] = position;
    }
    Some(next)
}

fn load_steam_profile(app: &tauri::AppHandle) -> Option<serde_json::Value> {
    normalize_steam_profile(&read_json_file(app, STEAM_PROFILE_FILE)?)
}

fn save_steam_profile(
    app: &tauri::AppHandle,
    profile: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let profile =
        normalize_steam_profile(&profile).ok_or_else(|| "Steam profile is invalid".to_string())?;
    write_json_file(app, STEAM_PROFILE_FILE, &profile)?;
    Ok(profile)
}

async fn fetch_steam_profile(steam_id: &str) -> Result<serde_json::Value, String> {
    let profile_url = format!("https://steamcommunity.com/profiles/{steam_id}");
    let xml = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?
        .get(format!("{profile_url}/?xml=1"))
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .text()
        .await
        .map_err(|error| error.to_string())?;
    let avatar_source_url = xml_text(&xml, "avatarFull")
        .if_empty(xml_text(&xml, "avatarMedium"))
        .if_empty(xml_text(&xml, "avatarIcon"));
    let avatar_url = resolve_steam_profile_avatar_url(&avatar_source_url).await;

    Ok(serde_json::json!({
        "steamId": steam_id,
        "displayName": xml_text(&xml, "steamID").if_empty(format!("Steam {steam_id}")),
        "avatarUrl": avatar_url,
        "profileUrl": profile_url
    }))
}

async fn validate_steam_openid(callback_url: &reqwest::Url) -> Result<bool, String> {
    let mut params = callback_url
        .query_pairs()
        .filter(|(key, _)| key.starts_with("openid."))
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect::<Vec<_>>();
    params.retain(|(key, _)| key != "openid.mode");
    params.push((
        "openid.mode".to_string(),
        "check_authentication".to_string(),
    ));

    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?
        .post(STEAM_OPENID_ENDPOINT)
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .form(&params)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        return Ok(false);
    }

    Ok(response
        .text()
        .await
        .map_err(|error| error.to_string())?
        .contains("is_valid:true"))
}

fn steam_id_from_openid(callback_url: &reqwest::Url) -> String {
    callback_url
        .query_pairs()
        .find(|(key, _)| key == "openid.claimed_id")
        .map(|(_, value)| value.to_string())
        .and_then(|claimed_id| claimed_id.rsplit("/openid/id/").next().map(str::to_string))
        .filter(|value| !value.is_empty() && value.chars().all(|ch| ch.is_ascii_digit()))
        .unwrap_or_default()
}

fn steam_login_page_html(success: bool, message: &str) -> String {
    let text = if message.trim().is_empty() {
        if success {
            "Connected."
        } else {
            "Not connected."
        }
    } else {
        message.trim()
    };

    format!(
        "<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\" /><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" /><title>PirateBox</title><style>:root {{ color-scheme: dark; }} body {{ min-height: 100vh; margin: 0; display: grid; place-items: center; background: #0b0b0b; color: #d3d3d3; font: 500 24px \"Segoe UI\", system-ui, sans-serif; user-select: none; }} p {{ margin: 0; }}</style></head><body><p>{}</p></body></html>",
        escape_html(text)
    )
}

fn write_http_response(stream: &mut std::net::TcpStream, status: &str, body: &str) {
    use std::io::Write;

    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store, max-age=0\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.as_bytes().len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn accept_steam_login_callback(
    listener: std::net::TcpListener,
    port: u16,
    state: String,
) -> Result<(reqwest::Url, std::net::TcpStream), String> {
    use std::io::Read;

    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);

    while std::time::Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buffer = [0_u8; 8192];
                let length = stream
                    .read(&mut buffer)
                    .map_err(|error| error.to_string())?;
                let request = String::from_utf8_lossy(&buffer[..length]);
                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or("/");
                let callback_url = reqwest::Url::parse(&format!("http://127.0.0.1:{port}{path}"))
                    .map_err(|error| error.to_string())?;

                if callback_url.path() != "/steam/callback"
                    || callback_url
                        .query_pairs()
                        .find(|(key, _)| key == "state")
                        .map(|(_, value)| value.to_string())
                        != Some(state.clone())
                {
                    write_http_response(
                        &mut stream,
                        "404 Not Found",
                        &steam_login_page_html(false, "Not found."),
                    );
                    continue;
                }

                return Ok((callback_url, stream));
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(error) => return Err(error.to_string()),
        }
    }

    Err("Steam login timed out".to_string())
}

struct SteamSignInGuard;

impl Drop for SteamSignInGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = STEAM_SIGN_IN_ACTIVE.lock() {
            *active = false;
        }
    }
}

fn begin_steam_sign_in() -> Result<SteamSignInGuard, String> {
    let mut active = STEAM_SIGN_IN_ACTIVE
        .lock()
        .map_err(|_| "Steam login lock poisoned".to_string())?;
    if *active {
        return Err("Steam login already in progress".to_string());
    }
    *active = true;
    Ok(SteamSignInGuard)
}

async fn sign_in_with_steam(app: &tauri::AppHandle) -> Result<serde_json::Value, String> {
    use tauri_plugin_opener::OpenerExt;

    let _guard = begin_steam_sign_in()?;
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let state = uuid::Uuid::new_v4().to_string();
    let callback_url = format!("http://127.0.0.1:{port}/steam/callback?state={state}");
    let mut login_url =
        reqwest::Url::parse(STEAM_OPENID_ENDPOINT).map_err(|error| error.to_string())?;
    login_url
        .query_pairs_mut()
        .append_pair("openid.ns", "http://specs.openid.net/auth/2.0")
        .append_pair("openid.mode", "checkid_setup")
        .append_pair("openid.return_to", &callback_url)
        .append_pair("openid.realm", &format!("http://127.0.0.1:{port}"))
        .append_pair(
            "openid.identity",
            "http://specs.openid.net/auth/2.0/identifier_select",
        )
        .append_pair(
            "openid.claimed_id",
            "http://specs.openid.net/auth/2.0/identifier_select",
        );

    app.opener()
        .open_url(login_url.as_str(), None::<&str>)
        .map_err(|error| format!("Could not open Steam login in browser: {error}"))?;

    let (callback, mut stream) = accept_steam_login_callback(listener, port, state)?;
    let mode = callback
        .query_pairs()
        .find(|(key, _)| key == "openid.mode")
        .map(|(_, value)| value.to_string())
        .unwrap_or_default();

    if mode != "id_res" {
        write_http_response(
            &mut stream,
            "400 Bad Request",
            &steam_login_page_html(false, "Not connected."),
        );
        return Err("Steam login was cancelled".to_string());
    }

    let is_valid = validate_steam_openid(&callback).await?;
    let steam_id = steam_id_from_openid(&callback);
    if !is_valid || steam_id.is_empty() {
        write_http_response(
            &mut stream,
            "400 Bad Request",
            &steam_login_page_html(false, "Not connected."),
        );
        return Err("Steam OpenID validation failed".to_string());
    }

    let profile = match fetch_steam_profile(&steam_id).await {
        Ok(profile) => profile,
        Err(error) => {
            write_http_response(
                &mut stream,
                "400 Bad Request",
                &steam_login_page_html(false, "Not connected."),
            );
            return Err(error);
        }
    };

    let display_name = text_value(profile.get("displayName"));
    let success_message = if display_name.is_empty() {
        "Connected.".to_string()
    } else {
        format!("Connected as {display_name}.")
    };
    write_http_response(
        &mut stream,
        "200 OK",
        &steam_login_page_html(true, &success_message),
    );

    save_steam_profile(app, profile)
}

fn to_backup_root_path(output_path: &str) -> String {
    let path = std::path::PathBuf::from(output_path.trim());
    if path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case(BACKUP_ROOT_FOLDER_NAME))
    {
        path.to_string_lossy().to_string()
    } else {
        path.join(BACKUP_ROOT_FOLDER_NAME)
            .to_string_lossy()
            .to_string()
    }
}

fn normalize_backup_settings(
    app: &tauri::AppHandle,
    value: Option<serde_json::Value>,
) -> serde_json::Value {
    let fallback = default_backup_settings(app);
    let Some(value) = value.and_then(|value| value.as_object().cloned()) else {
        return fallback;
    };

    let fallback_output_path = text_value(fallback.get("outputPath"));
    let output_path =
        to_backup_root_path(&text_value(value.get("outputPath")).if_empty(fallback_output_path));

    serde_json::json!({
        "outputPath": output_path,
        "automaticBackupsForLibrary": value
            .get("automaticBackupsForLibrary")
            .and_then(|value| value.as_bool())
            .unwrap_or(false),
        "automaticBackups": object_or_empty(value.get("automaticBackups")),
        "backupRecords": object_or_empty(value.get("backupRecords")),
        "customExecutables": object_or_empty(value.get("customExecutables"))
    })
}

fn load_backup_settings(app: &tauri::AppHandle) -> serde_json::Value {
    normalize_backup_settings(app, read_json_file(app, BACKUP_SETTINGS_FILE))
}

fn save_backup_settings(
    app: &tauri::AppHandle,
    patch: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let current = load_backup_settings(app);
    let mut next = merge_object_defaults(current.clone(), patch.clone());

    for key in ["automaticBackups", "backupRecords", "customExecutables"] {
        let mut merged = current
            .get(key)
            .and_then(|value| value.as_object())
            .cloned()
            .unwrap_or_default();
        if let Some(patch_object) = patch.get(key).and_then(|value| value.as_object()) {
            for (entry_key, entry_value) in patch_object {
                merged.insert(entry_key.clone(), entry_value.clone());
            }
        }
        next[key] = serde_json::Value::Object(merged);
    }

    persist_backup_settings(app, next)
}

fn persist_backup_settings(
    app: &tauri::AppHandle,
    settings: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let normalized = normalize_backup_settings(app, Some(settings));
    write_json_file(app, BACKUP_SETTINGS_FILE, &normalized)?;
    emit_backup_settings_changed(app, &normalized);
    Ok(normalized)
}

fn emit_backup_settings_changed(app: &tauri::AppHandle, settings: &serde_json::Value) {
    use tauri::Emitter;

    let _ = app.emit(BACKUP_SETTINGS_CHANGED_EVENT, settings.clone());
}

fn backup_marker_path(output_path: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(output_path).join(BACKUP_ROOT_MARKER_FILE)
}

fn write_backup_root_marker(output_path: &str) -> Result<(), String> {
    let output_path = std::path::PathBuf::from(output_path);
    std::fs::create_dir_all(&output_path).map_err(|error| error.to_string())?;
    let marker = serde_json::json!({
        "version": 1,
        "createdBy": "PirateBox",
        "createdAt": current_timestamp_string()
    });
    let contents = serde_json::to_string_pretty(&marker).map_err(|error| error.to_string())?;
    std::fs::write(output_path.join(BACKUP_ROOT_MARKER_FILE), contents)
        .map_err(|error| error.to_string())
}

fn current_timestamp_string() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn backup_root_status(
    status: &str,
    output_path: &str,
    settings: serde_json::Value,
    message: &str,
) -> serde_json::Value {
    serde_json::json!({
        "status": status,
        "outputPath": output_path,
        "settings": settings,
        "message": message
    })
}

fn is_path_inside_or_equal(parent_path: &std::path::Path, child_path: &std::path::Path) -> bool {
    let parent = match parent_path.canonicalize() {
        Ok(path) => path,
        Err(_) => parent_path.to_path_buf(),
    };
    let child = match child_path.canonicalize() {
        Ok(path) => path,
        Err(_) => child_path.to_path_buf(),
    };

    child == parent || child.starts_with(parent)
}

fn selected_backup_path(
    settings: &serde_json::Value,
    app_id: &str,
    backup_path: Option<String>,
) -> String {
    if let Some(path) = backup_path
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
    {
        return path;
    }

    let Some(record) = settings
        .get("backupRecords")
        .and_then(|records| records.get(app_id))
    else {
        return String::new();
    };

    record
        .get("entries")
        .and_then(|entries| entries.as_array())
        .and_then(|entries| entries.first())
        .and_then(|entry| entry.get("path"))
        .and_then(|path| path.as_str())
        .or_else(|| record.get("lastBackupPath").and_then(|path| path.as_str()))
        .unwrap_or_default()
        .to_string()
}

pub(crate) fn steam_asset_url(app_id: &str, file_name: &str) -> String {
    format!("https://cdn.cloudflare.steamstatic.com/steam/apps/{app_id}/{file_name}")
}

fn default_steam_path_candidates() -> Vec<String> {
    let mut candidates = vec![
        "C:\\Program Files (x86)\\Steam".to_string(),
        "C:\\Program Files\\Steam".to_string(),
    ];

    if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
        candidates.push(format!("{home}\\.steam\\steam"));
        candidates.push(format!("{home}\\.local\\share\\Steam"));
    }

    candidates
}

fn steamapps_path(root: &std::path::Path) -> std::path::PathBuf {
    if root
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("steamapps"))
    {
        root.to_path_buf()
    } else {
        root.join("steamapps")
    }
}

fn is_valid_steam_path(path: &std::path::Path) -> bool {
    steamapps_path(path).join("libraryfolders.vdf").exists()
}

fn normalize_steam_root_path(input: &str) -> Option<String> {
    let path = std::path::PathBuf::from(input.trim());
    if !path.exists() {
        return None;
    }

    if is_valid_steam_path(&path) {
        return Some(path.to_string_lossy().to_string());
    }

    if path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("steamapps"))
    {
        if let Some(parent) = path.parent() {
            if is_valid_steam_path(parent) {
                return Some(parent.to_string_lossy().to_string());
            }
        }
    }

    None
}

fn load_saved_steam_path(app: &tauri::AppHandle) -> String {
    read_json_file(app, STEAM_LIBRARY_PATH_FILE)
        .and_then(|value| {
            value
                .get("steamPath")
                .and_then(|value| value.as_str())
                .map(ToOwned::to_owned)
        })
        .unwrap_or_default()
}

pub(crate) fn save_steam_path(app: &tauri::AppHandle, steam_path: &str) -> Result<(), String> {
    write_json_file(
        app,
        STEAM_LIBRARY_PATH_FILE,
        &serde_json::json!({ "steamPath": steam_path }),
    )
}

fn load_game_playtimes(app: &tauri::AppHandle) -> serde_json::Value {
    read_json_file(app, GAME_PLAYTIME_FILE)
        .and_then(|value| value.as_object().cloned().map(serde_json::Value::Object))
        .unwrap_or_else(|| serde_json::json!({}))
}

fn save_game_playtimes(app: &tauri::AppHandle, snapshot: &serde_json::Value) -> Result<(), String> {
    write_json_file(app, GAME_PLAYTIME_FILE, snapshot)
}

fn record_game_launch_playtime(
    app: &tauri::AppHandle,
    app_id: &str,
) -> Result<serde_json::Value, String> {
    let mut snapshot = load_game_playtimes(app);
    let now = current_timestamp_string();
    let current = snapshot
        .get(app_id)
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let play_time = current
        .get("playTimeInMilliseconds")
        .and_then(|value| value.as_u64())
        .unwrap_or(0);

    snapshot[app_id] = serde_json::json!({
        "appId": app_id,
        "playTimeInMilliseconds": play_time,
        "lastTimePlayed": now
    });
    save_game_playtimes(app, &snapshot)?;
    emit_game_playtimes_changed(app, &snapshot);
    Ok(snapshot)
}

fn record_game_session_playtime(
    app: &tauri::AppHandle,
    app_id: &str,
    started_at: std::time::SystemTime,
) -> Result<serde_json::Value, String> {
    let duration = started_at
        .elapsed()
        .map_err(|error| error.to_string())?
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX);
    if duration == 0 {
        return Ok(load_game_playtimes(app));
    }

    let mut snapshot = load_game_playtimes(app);
    let now = current_timestamp_string();
    let current = snapshot
        .get(app_id)
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let play_time = current
        .get("playTimeInMilliseconds")
        .and_then(|value| value.as_u64())
        .unwrap_or(0)
        .saturating_add(duration);

    snapshot[app_id] = serde_json::json!({
        "appId": app_id,
        "playTimeInMilliseconds": play_time,
        "lastTimePlayed": current.get("lastTimePlayed").cloned().unwrap_or_else(|| serde_json::json!(now)),
        "lastSessionRecordedAt": now,
        "lastSessionDurationInMilliseconds": duration
    });
    save_game_playtimes(app, &snapshot)?;
    emit_game_playtimes_changed(app, &snapshot);
    Ok(snapshot)
}

fn emit_game_playtimes_changed(app: &tauri::AppHandle, snapshot: &serde_json::Value) {
    use tauri::Emitter;

    let _ = app.emit(GAME_PLAYTIMES_CHANGED_EVENT, snapshot.clone());
}

fn active_playtime_sessions() -> std::collections::HashMap<String, GamePlaytimeSession> {
    steam_monitor_state()
        .lock()
        .map(|guard| guard.playtime_sessions.clone())
        .unwrap_or_default()
}

fn get_game_playtime_snapshot(app: &tauri::AppHandle) -> serde_json::Value {
    let persisted = load_game_playtimes(app);
    let sessions = active_playtime_sessions();
    if sessions.is_empty() {
        return persisted;
    }

    let mut snapshot = persisted.as_object().cloned().unwrap_or_default();
    let now = std::time::SystemTime::now();

    for (app_id, session) in sessions {
        let elapsed = now
            .duration_since(session.started_at)
            .map(|duration| duration.as_millis())
            .unwrap_or(0)
            .min(i64::MAX as u128) as u64;
        let current = snapshot
            .get(&app_id)
            .cloned()
            .unwrap_or_else(|| serde_json::json!({ "appId": app_id }));
        let base_playtime = current
            .get("playTimeInMilliseconds")
            .and_then(|value| value.as_u64())
            .unwrap_or(0);
        let last_time_played = current
            .get("lastTimePlayed")
            .cloned()
            .unwrap_or_else(|| serde_json::json!(current_timestamp_string()));

        snapshot.insert(
            app_id.clone(),
            serde_json::json!({
                "appId": app_id,
                "playTimeInMilliseconds": base_playtime.saturating_add(elapsed),
                "lastTimePlayed": last_time_played,
                "lastSessionRecordedAt": current.get("lastSessionRecordedAt").cloned(),
                "lastSessionDurationInMilliseconds": elapsed,
                "sessionActive": true
            }),
        );
    }

    serde_json::Value::Object(snapshot)
}

fn emit_game_playtimes_snapshot(app: &tauri::AppHandle) {
    let snapshot = get_game_playtime_snapshot(app);
    emit_game_playtimes_changed(app, &snapshot);
}

fn start_game_playtime_snapshot_emitter(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        let has_sessions = steam_monitor_state()
            .lock()
            .is_ok_and(|guard| !guard.playtime_sessions.is_empty());
        if has_sessions {
            emit_game_playtimes_snapshot(&app);
        }
        std::thread::sleep(std::time::Duration::from_millis(
            GAME_PLAYTIME_SNAPSHOT_INTERVAL_MS,
        ));
    });
}

#[derive(Clone)]
struct GamePlaytimeSession {
    started_at: std::time::SystemTime,
    title: String,
}

struct SteamMonitorState {
    active_running_app_id: Option<String>,
    pending_games: std::collections::HashMap<String, serde_json::Value>,
    pending_game_registered_at: std::collections::HashMap<String, u64>,
    process_fallback_started: std::collections::HashSet<String>,
    playtime_sessions: std::collections::HashMap<String, GamePlaytimeSession>,
    backup_in_progress: std::collections::HashSet<String>,
    last_automatic_backup_at: std::collections::HashMap<String, u64>,
}

static STEAM_MONITOR: std::sync::OnceLock<std::sync::Mutex<SteamMonitorState>> =
    std::sync::OnceLock::new();

pub(crate) fn is_playtime_session_active(app_id: &str) -> bool {
    let normalized_app_id: String = app_id.chars().filter(|c| c.is_ascii_digit()).collect();
    if normalized_app_id.is_empty() {
        return false;
    }

    steam_monitor_state()
        .lock()
        .ok()
        .is_some_and(|guard| guard.playtime_sessions.contains_key(&normalized_app_id))
}

fn steam_monitor_state() -> &'static std::sync::Mutex<SteamMonitorState> {
    STEAM_MONITOR.get_or_init(|| {
        std::sync::Mutex::new(SteamMonitorState {
            active_running_app_id: None,
            pending_games: std::collections::HashMap::new(),
            pending_game_registered_at: std::collections::HashMap::new(),
            process_fallback_started: std::collections::HashSet::new(),
            playtime_sessions: std::collections::HashMap::new(),
            backup_in_progress: std::collections::HashSet::new(),
            last_automatic_backup_at: std::collections::HashMap::new(),
        })
    })
}

fn current_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(windows)]
fn read_steam_running_app_id() -> Option<String> {
    let output = std::process::Command::new("reg")
        .args(["query", r"HKCU\Software\Valve\Steam", "/v", "RunningAppID"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let hex_value = stdout.lines().find_map(|line| {
        let line = line.trim();
        if !line.starts_with("RunningAppID") {
            return None;
        }
        line.split_whitespace().last().map(str::to_string)
    })?;
    let normalized = hex_value.trim_start_matches("0x").trim_start_matches("0X");
    let app_id = u32::from_str_radix(normalized, 16).ok()?;
    Some(app_id.to_string())
}

#[cfg(not(windows))]
fn read_steam_running_app_id() -> Option<String> {
    None
}

fn register_pending_steam_game(game: serde_json::Value) {
    let app_id = extract_app_id(&game);
    if app_id.is_empty() {
        return;
    }

    if let Ok(mut guard) = steam_monitor_state().lock() {
        guard.pending_games.insert(app_id.clone(), game);
        guard
            .pending_game_registered_at
            .insert(app_id, current_millis());
    }
}

fn resolve_backup_game(app_id: &str, title_fallback: &str) -> serde_json::Value {
    serde_json::json!({
        "id": format!("steam-{app_id}"),
        "appId": app_id,
        "title": title_fallback.to_string().if_empty(format!("Steam App {app_id}"))
    })
}

fn open_game_playtime_session(app: &tauri::AppHandle, game: &serde_json::Value) {
    let app_id = extract_app_id(game);
    if app_id.is_empty() {
        return;
    }

    let Ok(mut guard) = steam_monitor_state().lock() else {
        return;
    };
    if guard.playtime_sessions.contains_key(&app_id) {
        return;
    }

    let title = game_title(game, &app_id);
    guard.playtime_sessions.insert(
        app_id.clone(),
        GamePlaytimeSession {
            started_at: std::time::SystemTime::now(),
            title: title.clone(),
        },
    );
    drop(guard);
    let _ = record_game_launch_playtime(app, &app_id);
    emit_game_playtimes_snapshot(app);
    if let Some(steam_path) = resolve_steam_path(app, None).0 {
        achievement_monitor::start_local_achievement_monitor(app, &app_id, &title, &steam_path);
    }
}

fn close_game_playtime_session(app: &tauri::AppHandle, app_id: &str) -> Option<String> {
    achievement_monitor::stop_local_achievement_monitor(app_id);
    let session = steam_monitor_state()
        .lock()
        .ok()?
        .playtime_sessions
        .remove(app_id)?;
    let title = session.title;
    let _ = record_game_session_playtime(app, app_id, session.started_at);
    emit_game_playtimes_snapshot(app);
    Some(title)
}

fn automatic_backup_enabled_for_close(settings: &serde_json::Value, app_id: &str) -> bool {
    settings
        .get("automaticBackups")
        .and_then(|value| value.get(app_id))
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

fn run_automatic_backup_after_close(
    app: tauri::AppHandle,
    app_id: String,
    title_fallback: String,
    game: serde_json::Value,
) {
    std::thread::spawn(move || {
        let settings = load_backup_settings(&app);
        if !automatic_backup_enabled_for_close(&settings, &app_id) {
            return;
        }

        {
            let Ok(mut guard) = steam_monitor_state().lock() else {
                return;
            };
            if guard.backup_in_progress.contains(&app_id) {
                return;
            }
            let now = current_millis();
            if let Some(last_backup_at) = guard.last_automatic_backup_at.get(&app_id) {
                if now.saturating_sub(*last_backup_at) < AUTOMATIC_BACKUP_DEBOUNCE_WINDOW_MS {
                    return;
                }
            }
            guard.backup_in_progress.insert(app_id.clone());
        }

        std::thread::sleep(std::time::Duration::from_millis(
            AUTOMATIC_BACKUP_DELAY_AFTER_CLOSE_MS,
        ));

        let backup_game = if extract_app_id(&game).is_empty() {
            resolve_backup_game(&app_id, &title_fallback)
        } else {
            game
        };
        match backup_run_game_local(app.clone(), backup_game) {
            Ok(result) if result.get("success").and_then(|value| value.as_bool()) != Some(true) => {
                let error = text_value(result.get("error"))
                    .if_empty("Backup automÃ¡tico falhou.".to_string());
                let output_path = text_value(result.get("outputPath"));
                let _ =
                    save_failed_backup_record(&app, &app_id, &title_fallback, &output_path, &error);
            }
            Err(error) => {
                let _ = save_failed_backup_record(&app, &app_id, &title_fallback, "", &error);
            }
            _ => {}
        }

        if let Ok(mut guard) = steam_monitor_state().lock() {
            guard
                .last_automatic_backup_at
                .insert(app_id.clone(), current_millis());
            guard.backup_in_progress.remove(&app_id);
        }
    });
}

fn poll_steam_running_app_id(app: &tauri::AppHandle) {
    let Some(running_app_id) = read_steam_running_app_id() else {
        return;
    };

    if running_app_id != "0" {
        if pirate_library::is_library_app_blocked(&running_app_id, "") {
            return;
        }

        let closed_app_id = {
            let Ok(guard) = steam_monitor_state().lock() else {
                return;
            };
            let previous = guard.active_running_app_id.clone();
            if previous.as_deref() == Some(running_app_id.as_str()) {
                None
            } else {
                previous.filter(|value| value != &running_app_id)
            }
        };

        if let Some(closed_app_id) = closed_app_id {
            if let Ok(mut guard) = steam_monitor_state().lock() {
                guard.pending_games.remove(&closed_app_id);
                guard.pending_game_registered_at.remove(&closed_app_id);
                guard.process_fallback_started.remove(&closed_app_id);
            }
            let title = close_game_playtime_session(app, &closed_app_id).unwrap_or_default();
            let game = resolve_backup_game(&closed_app_id, &title);
            run_automatic_backup_after_close(app.clone(), closed_app_id, title, game);
        }

        let should_open_session = {
            let Ok(guard) = steam_monitor_state().lock() else {
                return;
            };
            !guard.playtime_sessions.contains_key(&running_app_id)
        };

        if should_open_session {
            let game = {
                let Ok(guard) = steam_monitor_state().lock() else {
                    return;
                };
                guard
                    .pending_games
                    .get(&running_app_id)
                    .cloned()
                    .unwrap_or_else(|| resolve_backup_game(&running_app_id, ""))
            };
            open_game_playtime_session(app, &game);
        }

        if let Ok(mut guard) = steam_monitor_state().lock() {
            guard.active_running_app_id = Some(running_app_id);
        }
        return;
    }

    let closed_app_id = steam_monitor_state().lock().ok().and_then(|mut guard| {
        let closed = guard.active_running_app_id.take();
        if let Some(app_id) = closed.as_ref() {
            guard.pending_games.remove(app_id);
            guard.pending_game_registered_at.remove(app_id);
            guard.process_fallback_started.remove(app_id);
        }
        closed
    });

    let Some(closed_app_id) = closed_app_id else {
        return;
    };

    let title = close_game_playtime_session(app, &closed_app_id).unwrap_or_default();
    let game = resolve_backup_game(&closed_app_id, &title);
    run_automatic_backup_after_close(app.clone(), closed_app_id, title, game);
}

#[cfg(windows)]
fn poll_pending_steam_process_fallbacks(app: &tauri::AppHandle) {
    let now = current_millis();
    let pending = steam_monitor_state()
        .lock()
        .map(|guard| {
            guard
                .pending_games
                .iter()
                .filter_map(|(app_id, game)| {
                    if guard.playtime_sessions.contains_key(app_id)
                        || guard.process_fallback_started.contains(app_id)
                    {
                        return None;
                    }
                    let registered_at = guard.pending_game_registered_at.get(app_id).copied()?;
                    if now.saturating_sub(registered_at) < STEAM_PENDING_PROCESS_FALLBACK_AFTER_MS {
                        return None;
                    }
                    let executable_path = find_likely_game_executable(game)?;
                    Some((app_id.clone(), game.clone(), executable_path))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    for (app_id, game, executable_path) in pending {
        let should_start = steam_monitor_state().lock().is_ok_and(|mut guard| {
            if guard.playtime_sessions.contains_key(&app_id)
                || guard.process_fallback_started.contains(&app_id)
            {
                return false;
            }
            guard.process_fallback_started.insert(app_id.clone());
            true
        });
        if should_start {
            monitor_game_process(app.clone(), game, app_id, executable_path);
        }
    }
}

#[cfg(not(windows))]
fn poll_pending_steam_process_fallbacks(_app: &tauri::AppHandle) {}

fn start_steam_running_app_monitor(app: tauri::AppHandle) {
    #[cfg(not(windows))]
    {
        let _ = app;
        return;
    }

    #[cfg(windows)]
    std::thread::spawn(move || loop {
        poll_steam_running_app_id(&app);
        poll_pending_steam_process_fallbacks(&app);
        std::thread::sleep(std::time::Duration::from_millis(
            STEAM_RUNNING_APP_MONITOR_INTERVAL_MS,
        ));
    });
}

fn merge_playtime_into_game(
    mut game: serde_json::Value,
    snapshot: &serde_json::Value,
) -> serde_json::Value {
    let app_id = text_value(game.get("appId"));
    if let Some(playtime) = snapshot.get(&app_id) {
        if let Some(value) = playtime.get("playTimeInMilliseconds") {
            game["playTimeInMilliseconds"] = value.clone();
        }
        if let Some(value) = playtime.get("lastTimePlayed") {
            game["lastTimePlayed"] = value.clone();
        }
        if let Some(value) = playtime.get("lastSessionRecordedAt") {
            game["lastSessionRecordedAt"] = value.clone();
        }
        if let Some(value) = playtime.get("lastSessionDurationInMilliseconds") {
            game["lastSessionDurationInMilliseconds"] = value.clone();
        }
        if let Some(value) = playtime.get("sessionActive") {
            game["sessionActive"] = value.clone();
        }
    }
    game
}

pub(crate) fn resolve_steam_path(
    app: &tauri::AppHandle,
    steam_path: Option<String>,
) -> (Option<String>, Vec<String>) {
    let mut checked = Vec::new();
    let mut candidates = Vec::new();

    if let Some(path) = steam_path
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
    {
        candidates.push(path);
    }

    let saved = load_saved_steam_path(app);
    if !saved.is_empty() {
        candidates.push(saved);
    }

    candidates.extend(default_steam_path_candidates());

    for candidate in candidates {
        if checked.iter().any(|path| path == &candidate) {
            continue;
        }
        checked.push(candidate.clone());

        if let Some(path) = normalize_steam_root_path(&candidate) {
            return (Some(path), checked);
        }
    }

    (None, checked)
}

fn parse_vdf_string_value(line: &str, key: &str) -> Option<String> {
    let mut parts = line.split('"').filter(|part| !part.trim().is_empty());
    let found_key = parts.next()?.trim();
    let value = parts.next()?.trim();
    if found_key.eq_ignore_ascii_case(key) {
        Some(value.replace("\\\\", "\\"))
    } else {
        None
    }
}

fn read_steam_library_paths(steam_path: &str) -> Vec<String> {
    let mut paths = vec![steam_path.to_string()];
    let libraryfolders_path =
        steamapps_path(std::path::Path::new(steam_path)).join("libraryfolders.vdf");
    let Ok(contents) = std::fs::read_to_string(libraryfolders_path) else {
        return paths;
    };

    for line in contents.lines() {
        if let Some(path) = parse_vdf_string_value(line, "path") {
            if normalize_steam_root_path(&path).is_some() && !paths.iter().any(|item| item == &path)
            {
                paths.push(path);
            }
        }
    }

    paths
}

fn parse_app_manifest(path: &std::path::Path) -> Option<serde_json::Value> {
    let contents = std::fs::read_to_string(path).ok()?;
    let mut app_id = String::new();
    let mut name = String::new();
    let mut install_dir = String::new();
    let mut size_on_disk = String::new();

    for line in contents.lines() {
        if app_id.is_empty() {
            app_id = parse_vdf_string_value(line, "appid").unwrap_or_default();
        }
        if name.is_empty() {
            name = parse_vdf_string_value(line, "name").unwrap_or_default();
        }
        if install_dir.is_empty() {
            install_dir = parse_vdf_string_value(line, "installdir").unwrap_or_default();
        }
        if size_on_disk.is_empty() {
            size_on_disk = parse_vdf_string_value(line, "SizeOnDisk").unwrap_or_default();
        }
    }

    if app_id.is_empty() || name.is_empty() {
        return None;
    }

    let library_path = path.parent()?.parent()?.to_string_lossy().to_string();
    let install_path = path
        .parent()?
        .join("common")
        .join(if install_dir.is_empty() {
            &name
        } else {
            &install_dir
        })
        .to_string_lossy()
        .to_string();
    let cover_url = steam_asset_url(&app_id, "header.jpg");
    let hero_url = steam_asset_url(&app_id, "library_hero.jpg");
    let size_bytes = size_on_disk.parse::<u64>().ok().unwrap_or(0);
    let size = if size_bytes > 0 {
        format!("{:.1} GB", size_bytes as f64 / 1_073_741_824.0)
    } else {
        String::new()
    };

    Some(serde_json::json!({
        "appId": app_id,
        "id": format!("steam-{app_id}"),
        "title": name,
        "subtitle": "Instalado via Steam",
        "status": "installed",
        "hours": 0,
        "playTimeInMilliseconds": 0,
        "lastTimePlayed": null,
        "rating": 0,
        "size": size,
        "release": "",
        "progress": 100,
        "accent": "#66c0f4",
        "cover": cover_url,
        "hero": hero_url,
        "coverUrl": cover_url,
        "heroUrl": hero_url,
        "coverFallbacks": [steam_asset_url(&app_id, "library_600x900.jpg"), steam_asset_url(&app_id, "capsule_616x353.jpg")],
        "heroFallbacks": [steam_asset_url(&app_id, "library_hero.jpg"), steam_asset_url(&app_id, "header.jpg")],
        "logo": steam_asset_url(&app_id, "logo.png"),
        "tags": [],
        "genres": [],
        "developers": [],
        "publishers": [],
        "screenshots": [hero_url],
        "achievements": { "unlocked": 0, "total": 0, "progress": 0 },
        "achievementList": [],
        "installDir": install_dir,
        "installPath": install_path,
        "libraryPath": library_path
    }))
}

fn scan_installed_steam_games(library_paths: &[String]) -> Vec<serde_json::Value> {
    let mut games = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for library_path in library_paths {
        let steamapps = steamapps_path(std::path::Path::new(library_path));
        let Ok(entries) = std::fs::read_dir(steamapps) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if !file_name.starts_with("appmanifest_") || !file_name.ends_with(".acf") {
                continue;
            }

            if let Some(game) = parse_app_manifest(&path) {
                let app_id = text_value(game.get("appId"));
                if seen.insert(app_id) {
                    games.push(game);
                }
            }
        }
    }

    games.sort_by(|a, b| text_value(a.get("title")).cmp(&text_value(b.get("title"))));
    games
}

pub(crate) fn extract_app_id(value: &serde_json::Value) -> String {
    text_value(value.get("appId"))
        .chars()
        .filter(char::is_ascii_digit)
        .collect()
}

fn custom_executable_path(settings: &serde_json::Value, app_id: &str) -> String {
    settings
        .get("customExecutables")
        .and_then(|value| value.get(app_id))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string()
}

fn normalize_search_text(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_alphanumeric())
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

fn string_similarity(left: &str, right: &str) -> f64 {
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    if left == right {
        return 1.0;
    }

    let left_chars: Vec<char> = left.chars().collect();
    let right_chars: Vec<char> = right.chars().collect();
    let mut distances = (0..=left_chars.len())
        .map(|index| index)
        .collect::<Vec<_>>();

    for (right_index, right_char) in right_chars.iter().enumerate() {
        let mut previous = distances[0];
        distances[0] = right_index + 1;

        for (left_index, left_char) in left_chars.iter().enumerate() {
            let current = distances[left_index + 1];
            let substitution_cost = if left_char == right_char { 0 } else { 1 };
            distances[left_index + 1] = (distances[left_index + 1] + 1)
                .min(distances[left_index] + 1)
                .min(previous + substitution_cost);
            previous = current;
        }
    }

    1.0 - (distances[left_chars.len()] as f64 / left_chars.len().max(right_chars.len()) as f64)
}

fn read_persisted_achievement_stats(
    app: &tauri::AppHandle,
    app_id: &str,
    title: &str,
) -> serde_json::Value {
    let backup_file = read_piratebox_achievements_backup_file(app, app_id, title, None);
    let total = backup_file
        .as_ref()
        .and_then(|file| file.get("total"))
        .and_then(|value| value.as_u64())
        .unwrap_or(0) as u32;
    let unlocked = backup_file
        .as_ref()
        .and_then(|file| file.get("unlocked"))
        .and_then(|value| value.as_array())
        .map(|items| items.len())
        .unwrap_or(0)
        .min(total as usize) as u32;

    serde_json::json!({
        "unlocked": unlocked,
        "total": total,
        "progress": if total > 0 {
            ((unlocked as f64 / total as f64) * 100.0).round() as u32
        } else {
            0
        }
    })
}

fn enrich_game_with_local_achievement_stats(
    app: &tauri::AppHandle,
    mut game: serde_json::Value,
    steam_path: &str,
) -> serde_json::Value {
    let app_id = extract_app_id(&game);
    if app_id.is_empty() {
        return game;
    }

    let title = game_title(&game, &app_id);
    let persisted = read_persisted_achievement_stats(app, &app_id, &title);
    let achievements =
        steam_appcache::read_local_achievement_stats(steam_path, &app_id, &persisted);
    if achievements
        .get("total")
        .and_then(|value| value.as_u64())
        .unwrap_or(0)
        == 0
    {
        return game;
    }

    if let Some(object) = game.as_object_mut() {
        object.insert("achievements".to_string(), achievements);
    }
    game
}

fn mark_local_unlocked_achievements(
    app: &tauri::AppHandle,
    app_id: &str,
    title: &str,
    steam_path: &str,
    achievements: Vec<serde_json::Value>,
) -> Vec<serde_json::Value> {
    if achievements.is_empty() {
        return achievements;
    }

    let backup_file = read_piratebox_achievements_backup_file(app, app_id, title, None);
    let backup_unlocked = backup_file
        .as_ref()
        .and_then(|file| file.get("unlocked"))
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    let unlocked_names = if !backup_unlocked.is_empty() {
        backup_unlocked
            .iter()
            .flat_map(|achievement| {
                let name = text_value(achievement.get("name"));
                let title = text_value(achievement.get("title"));
                [name, title]
            })
            .filter(|value| !value.is_empty())
            .collect::<std::collections::HashSet<_>>()
    } else {
        steam_appcache::read_local_unlocked_achievement_names(steam_path, app_id)
    };

    if unlocked_names.is_empty() {
        return achievements;
    }

    let normalized_unlocked_names = unlocked_names
        .iter()
        .map(|value| normalize_search_text(value))
        .collect::<std::collections::HashSet<_>>();
    let mut unlocked_at_by_name = std::collections::HashMap::new();
    for achievement in &backup_unlocked {
        let name = normalize_search_text(&text_value(achievement.get("name")));
        let title = normalize_search_text(&text_value(achievement.get("title")));
        let unlocked_at = achievement
            .get("unlockedAt")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string();
        if !name.is_empty() {
            unlocked_at_by_name.insert(name, unlocked_at.clone());
        }
        if !title.is_empty() {
            unlocked_at_by_name.insert(title, unlocked_at);
        }
    }

    achievements
        .into_iter()
        .map(|achievement| {
            let name = text_value(achievement.get("name"));
            let title = text_value(achievement.get("title"));
            let normalized_name = normalize_search_text(&name);
            let normalized_title = normalize_search_text(&title);

            let backup_match = backup_unlocked
                .iter()
                .find(|backup| {
                    normalize_search_text(&text_value(backup.get("name"))) == normalized_name
                        || normalize_search_text(&text_value(backup.get("title")))
                            == normalized_title
                })
                .or_else(|| {
                    backup_unlocked.iter().find(|backup| {
                        if normalized_title.is_empty() {
                            return false;
                        }
                        string_similarity(
                            &normalize_search_text(&text_value(backup.get("title"))),
                            &normalized_title,
                        ) >= 0.72
                    })
                });

            let unlocked = backup_match.is_some()
                || normalized_unlocked_names.contains(&normalized_name)
                || normalized_unlocked_names.contains(&normalized_title)
                || achievement
                    .get("unlocked")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false);
            let unlocked_at = backup_match
                .and_then(|backup| backup.get("unlockedAt"))
                .and_then(|value| value.as_str())
                .map(str::to_string)
                .or_else(|| unlocked_at_by_name.get(&normalized_name).cloned())
                .or_else(|| unlocked_at_by_name.get(&normalized_title).cloned())
                .or_else(|| {
                    achievement
                        .get("unlockedAt")
                        .and_then(|value| value.as_str())
                        .map(str::to_string)
                });

            let mut next = achievement;
            if let Some(object) = next.as_object_mut() {
                object.insert("unlocked".to_string(), serde_json::Value::Bool(unlocked));
                if let Some(unlocked_at) = unlocked_at.filter(|value| !value.is_empty()) {
                    object.insert(
                        "unlockedAt".to_string(),
                        serde_json::Value::String(unlocked_at),
                    );
                }
            }
            next
        })
        .collect()
}

pub(crate) fn merge_game_achievement_details(
    app: &tauri::AppHandle,
    mut game: serde_json::Value,
    steam_path: &str,
) -> serde_json::Value {
    let app_id = extract_app_id(&game);
    if app_id.is_empty() {
        return game;
    }

    let title = game_title(&game, &app_id);
    let achievement_list = game
        .get("achievementList")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    if achievement_list.is_empty() {
        return game;
    }

    let achievement_list =
        mark_local_unlocked_achievements(app, &app_id, &title, steam_path, achievement_list);
    let unlocked_count = achievement_list
        .iter()
        .filter(|achievement| {
            achievement
                .get("unlocked")
                .and_then(|value| value.as_bool())
                .unwrap_or(false)
        })
        .count();
    let total = achievement_list.len();
    let progress = if total > 0 {
        ((unlocked_count as f64 / total as f64) * 100.0).round() as u32
    } else {
        0
    };

    if let Some(object) = game.as_object_mut() {
        object.insert(
            "achievementList".to_string(),
            serde_json::json!(achievement_list),
        );
        object.insert(
            "achievements".to_string(),
            serde_json::json!({
                "unlocked": unlocked_count,
                "total": total,
                "progress": progress
            }),
        );
    }
    game
}

fn enrich_backup_achievements_with_icons(
    unlocked: Vec<serde_json::Value>,
    steam_achievements: &[serde_json::Value],
) -> Vec<serde_json::Value> {
    if unlocked.is_empty() {
        return unlocked;
    }

    let mut achievement_by_name = std::collections::HashMap::new();
    for achievement in steam_achievements {
        let name = normalize_search_text(&text_value(achievement.get("name")));
        let title = normalize_search_text(&text_value(achievement.get("title")));
        if !name.is_empty() {
            achievement_by_name.insert(name, achievement);
        }
        if !title.is_empty() {
            achievement_by_name.insert(title, achievement);
        }
    }

    unlocked
        .into_iter()
        .map(|achievement| {
            let normalized_name = normalize_search_text(&text_value(achievement.get("name")));
            let normalized_title = normalize_search_text(&text_value(achievement.get("title")));
            let steam_match = achievement_by_name
                .get(&normalized_name)
                .or_else(|| achievement_by_name.get(&normalized_title))
                .copied()
                .or_else(|| {
                    steam_achievements.iter().find(|steam_achievement| {
                        let steam_title =
                            normalize_search_text(&text_value(steam_achievement.get("title")));
                        !steam_title.is_empty()
                            && !normalized_title.is_empty()
                            && string_similarity(&steam_title, &normalized_title) >= 0.7
                    })
                });

            let mut next = achievement;
            if let Some(steam_match) = steam_match {
                if let Some(object) = next.as_object_mut() {
                    if let Some(icon) = steam_match.get("icon").filter(|value| !value.is_null()) {
                        object.insert("icon".to_string(), icon.clone());
                    }
                    if let Some(icon_gray) =
                        steam_match.get("iconGray").filter(|value| !value.is_null())
                    {
                        object.insert("iconGray".to_string(), icon_gray.clone());
                    }
                }
            }
            next
        })
        .collect()
}

fn piratebox_achievements_backup_path(
    settings: &serde_json::Value,
    title: &str,
) -> std::path::PathBuf {
    std::path::PathBuf::from(text_value(settings.get("outputPath")))
        .join(sanitize_folder_name(title))
        .join(PIRATEBOX_ACHIEVEMENTS_BACKUP_FILE)
}

fn normalize_piratebox_achievements_backup_file(
    value: &serde_json::Value,
    app_id: &str,
) -> Option<serde_json::Value> {
    let record = value.as_object()?;
    if text_value(record.get("appId")) != app_id {
        return None;
    }
    let unlocked = record
        .get("unlocked")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|achievement| {
                    let achievement = achievement.as_object()?;
                    let name = text_value(achievement.get("name"));
                    if name.is_empty() {
                        return None;
                    }
                    Some(serde_json::json!({
                        "name": name,
                        "title": text_value(achievement.get("title")).if_empty(name.clone()),
                        "unlockedAt": achievement.get("unlockedAt").and_then(|value| value.as_str())
                    }))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let total = record
        .get("total")
        .and_then(|value| value.as_u64())
        .map(|value| value as usize)
        .unwrap_or(unlocked.len())
        .max(unlocked.len());
    Some(serde_json::json!({
        "version": record.get("version").and_then(|value| value.as_u64()).unwrap_or(1),
        "appId": app_id,
        "title": text_value(record.get("title")).if_empty(app_id.to_string()),
        "updatedAt": text_value(record.get("updatedAt")),
        "source": text_value(record.get("source")).if_empty("piratebox".to_string()),
        "total": total,
        "unlocked": unlocked
    }))
}

fn read_piratebox_achievements_backup_file(
    app: &tauri::AppHandle,
    app_id: &str,
    title: &str,
    backup_path: Option<&str>,
) -> Option<serde_json::Value> {
    let settings = load_backup_settings(app);
    let mut candidates = vec![piratebox_achievements_backup_path(&settings, title)];
    if let Some(path) = backup_path.filter(|value| !value.is_empty()) {
        let backup = std::path::PathBuf::from(path);
        candidates.push(backup.join(PIRATEBOX_ACHIEVEMENTS_BACKUP_FILE));
        if let Some(parent) = backup.parent() {
            candidates.push(parent.join(PIRATEBOX_ACHIEVEMENTS_BACKUP_FILE));
        }
        if let Some(record) = settings
            .get("backupRecords")
            .and_then(|records| records.get(app_id))
        {
            if let Some(last_path) = record
                .get("lastBackupPath")
                .and_then(|value| value.as_str())
            {
                candidates.push(
                    std::path::PathBuf::from(last_path).join(PIRATEBOX_ACHIEVEMENTS_BACKUP_FILE),
                );
            }
        }
    }

    for candidate in candidates {
        let Ok(raw) = std::fs::read_to_string(&candidate) else {
            continue;
        };
        let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) else {
            continue;
        };
        if let Some(normalized) = normalize_piratebox_achievements_backup_file(&parsed, app_id) {
            if normalized
                .get("unlocked")
                .and_then(|value| value.as_array())
                .is_some_and(|items| !items.is_empty())
            {
                return Some(normalized);
            }
        }
    }

    None
}

fn write_piratebox_achievements_backup_file(
    app: &tauri::AppHandle,
    file: &serde_json::Value,
    target_directory: Option<&str>,
) -> Result<String, String> {
    let app_id = text_value(file.get("appId"));
    let title = text_value(file.get("title")).if_empty(app_id.clone());
    let file_path = if let Some(directory) = target_directory.filter(|value| !value.is_empty()) {
        std::path::PathBuf::from(directory).join(PIRATEBOX_ACHIEVEMENTS_BACKUP_FILE)
    } else {
        piratebox_achievements_backup_path(&load_backup_settings(app), &title)
    };
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let contents = serde_json::to_string_pretty(file).map_err(|error| error.to_string())?;
    std::fs::write(&file_path, contents).map_err(|error| error.to_string())?;
    Ok(file_path.to_string_lossy().to_string())
}

fn resolve_piratebox_achievement_total(
    existing_total: usize,
    provided_total: Option<&serde_json::Value>,
) -> usize {
    if let Some(total) = provided_total.and_then(|value| value.as_u64()) {
        if total > 0 {
            return existing_total.max(total as usize);
        }
    }
    existing_total
}

fn record_piratebox_steam_api_achievement_unlock(
    app: &tauri::AppHandle,
    payload: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let Some(payload) = payload.as_object() else {
        return Err("Payload de conquista invÃ¡lido.".to_string());
    };
    let app_id: String = text_value(payload.get("appId"))
        .chars()
        .filter(|ch| ch.is_ascii_digit())
        .collect();
    let name = [
        payload.get("name"),
        payload.get("achievementName"),
        payload.get("achievementId"),
        payload.get("apiName"),
    ]
    .iter()
    .find_map(|value| value.and_then(|value| value.as_str()))
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .map(str::to_string)
    .unwrap_or_default();
    if app_id.is_empty() || name.is_empty() {
        return Err("appId e name sÃ£o obrigatÃ³rios.".to_string());
    }

    let settings = load_backup_settings(app);
    let title = settings
        .get("backupRecords")
        .and_then(|records| records.get(&app_id))
        .and_then(|record| record.get("title"))
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| text_value(payload.get("gameTitle")).if_empty(app_id.clone()));
    let achievement_title = text_value(payload.get("title")).if_empty(name.clone());
    let unlocked_at = text_value(payload.get("unlockedAt"));
    let unlocked_at = chrono::DateTime::parse_from_rfc3339(&unlocked_at)
        .map(|value| value.to_rfc3339())
        .unwrap_or_else(|_| current_timestamp_string());

    let existing_file = read_piratebox_achievements_backup_file(app, &app_id, &title, None);
    let existing_unlocked = existing_file
        .as_ref()
        .and_then(|file| file.get("unlocked"))
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let normalized_name = normalize_search_text(&name);
    let normalized_title = normalize_search_text(&achievement_title);
    let existing_match_index = existing_unlocked.iter().position(|achievement| {
        let achievement_name = normalize_search_text(&text_value(achievement.get("name")));
        let achievement_title = normalize_search_text(&text_value(achievement.get("title")));
        achievement_name == normalized_name || achievement_title == normalized_title
    });
    let duplicate = existing_match_index.is_some();
    let mut next_unlocked = if let Some(match_index) = existing_match_index {
        existing_unlocked
            .into_iter()
            .enumerate()
            .map(|(index, achievement)| {
                if index == match_index {
                    serde_json::json!({
                        "name": text_value(achievement.get("name")).if_empty(name.clone()),
                        "title": text_value(achievement.get("title")).if_empty(achievement_title.clone()),
                        "unlockedAt": achievement
                            .get("unlockedAt")
                            .and_then(|value| value.as_str())
                            .filter(|value| !value.is_empty())
                            .unwrap_or(&unlocked_at)
                    })
                } else {
                    achievement
                }
            })
            .collect::<Vec<_>>()
    } else {
        let mut next = existing_unlocked;
        next.push(serde_json::json!({
            "name": name,
            "title": achievement_title,
            "unlockedAt": unlocked_at
        }));
        next
    };
    next_unlocked
        .sort_by(|left, right| text_value(left.get("name")).cmp(&text_value(right.get("name"))));
    let total = resolve_piratebox_achievement_total(
        existing_file
            .as_ref()
            .and_then(|file| file.get("total"))
            .and_then(|value| value.as_u64())
            .map(|value| value as usize)
            .unwrap_or(next_unlocked.len()),
        payload.get("total"),
    )
    .max(next_unlocked.len());
    let next_file = serde_json::json!({
        "version": 1,
        "appId": app_id,
        "title": title,
        "updatedAt": current_timestamp_string(),
        "source": "piratebox-steam-api-shim",
        "total": total,
        "unlocked": next_unlocked
    });
    write_piratebox_achievements_backup_file(app, &next_file, None)?;
    let _ = persist_backup_settings(app, load_backup_settings(app));

    Ok(serde_json::json!({
        "appId": app_id,
        "name": name,
        "unlockedAt": unlocked_at,
        "total": total,
        "unlocked": next_file
            .get("unlocked")
            .and_then(|value| value.as_array())
            .map(|items| items.len())
            .unwrap_or(0),
        "duplicate": duplicate
    }))
}

fn write_json_http_response(stream: &mut std::net::TcpStream, status: &str, body: &str) {
    use std::io::Write;

    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store, max-age=0\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.as_bytes().len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn parse_http_request(
    raw: &str,
) -> Option<(
    String,
    String,
    String,
    std::collections::HashMap<String, String>,
)> {
    let (head, body) = raw
        .split_once("\r\n\r\n")
        .or_else(|| raw.split_once("\n\n"))?;
    let mut lines = head.lines();
    let request_line = lines.next()?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next()?.to_string();
    let path = parts.next()?.to_string();
    let mut headers = std::collections::HashMap::new();
    for line in lines {
        if let Some((key, value)) = line.split_once(':') {
            headers.insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    Some((method, path, body.to_string(), headers))
}

fn is_local_achievement_address(address: &std::net::SocketAddr) -> bool {
    match address.ip() {
        std::net::IpAddr::V4(value) => value.is_loopback(),
        std::net::IpAddr::V6(value) => value.is_loopback(),
    }
}

fn handle_achievement_connection(
    app: &tauri::AppHandle,
    stream: &mut std::net::TcpStream,
    expected_token: &str,
) -> Result<(), String> {
    use std::io::Read;

    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];
    loop {
        let read = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > 64 * 1024 {
            write_json_http_response(
                stream,
                "400 Bad Request",
                r#"{"ok":false,"error":"Payload muito grande."}"#,
            );
            return Ok(());
        }
        if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }

    let raw = String::from_utf8_lossy(&buffer);
    let Some((method, path, body, headers)) = parse_http_request(&raw) else {
        write_json_http_response(stream, "400 Bad Request", r#"{"error":"invalid_request"}"#);
        return Ok(());
    };
    if method != "POST" || path != "/achievements/unlock" {
        write_json_http_response(stream, "404 Not Found", r#"{"error":"not_found"}"#);
        return Ok(());
    }
    let header_token = headers
        .get("x-piratebox-token")
        .map(String::as_str)
        .unwrap_or_default();
    if header_token != expected_token {
        write_json_http_response(stream, "401 Unauthorized", r#"{"error":"unauthorized"}"#);
        return Ok(());
    }

    let payload =
        serde_json::from_str::<serde_json::Value>(&body).unwrap_or_else(|_| serde_json::json!({}));
    match record_piratebox_steam_api_achievement_unlock(app, &payload) {
        Ok(result) => {
            let body = serde_json::json!({ "ok": true, "result": result });
            write_json_http_response(stream, "200 OK", &body.to_string());
        }
        Err(error) => write_json_http_response(
            stream,
            "400 Bad Request",
            &serde_json::json!({ "ok": false, "error": error }).to_string(),
        ),
    }
    Ok(())
}

fn start_piratebox_achievement_server(app: tauri::AppHandle) -> Result<(String, String), String> {
    let mut guard = achievement_server_state()
        .lock()
        .map_err(|_| "achievement server lock poisoned".to_string())?;
    if let Some(state) = guard.as_ref() {
        return Ok((state.url.clone(), state.token.clone()));
    }

    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let token = uuid::Uuid::new_v4().to_string();
    let url = format!("http://127.0.0.1:{port}");
    let (stop_tx, stop_rx) = std::sync::mpsc::channel();
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;

    let app_handle = app.clone();
    let expected_token = token.clone();
    std::thread::spawn(move || loop {
        if stop_rx.try_recv().is_ok() {
            break;
        }
        match listener.accept() {
            Ok((mut stream, address)) => {
                if !is_local_achievement_address(&address) {
                    write_json_http_response(
                        &mut stream,
                        "403 Forbidden",
                        r#"{"error":"forbidden"}"#,
                    );
                    continue;
                }
                let app_handle = app_handle.clone();
                let expected_token = expected_token.clone();
                std::thread::spawn(move || {
                    let _ =
                        handle_achievement_connection(&app_handle, &mut stream, &expected_token);
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(_) => break,
        }
    });

    *guard = Some(AchievementServerState {
        url: url.clone(),
        token: token.clone(),
        _stop: stop_tx,
    });
    Ok((url, token))
}

fn make_backup_entry(path: &str, size_bytes: u64) -> serde_json::Value {
    serde_json::json!({
        "path": path,
        "backupAt": current_timestamp_string(),
        "sizeBytes": size_bytes,
        "pinned": false
    })
}

fn get_backup_record_entries(record: Option<&serde_json::Value>) -> Vec<serde_json::Value> {
    let Some(record) = record else {
        return Vec::new();
    };
    if let Some(entries) = record
        .get("entries")
        .and_then(|value| value.as_array())
        .filter(|entries| !entries.is_empty())
    {
        return entries.clone();
    }
    let backup_path = text_value(record.get("lastBackupPath"));
    let backup_at = text_value(record.get("lastBackupAt"));
    if record
        .get("lastBackupSuccess")
        .and_then(|value| value.as_bool())
        != Some(true)
        || backup_path.is_empty()
        || backup_at.is_empty()
    {
        return Vec::new();
    }
    vec![serde_json::json!({
        "path": backup_path,
        "backupAt": backup_at,
        "sizeBytes": record.get("lastBackupSizeBytes"),
        "pinned": false
    })]
}

fn unique_backup_entries(entries: Vec<serde_json::Value>) -> Vec<serde_json::Value> {
    let mut entries_by_path = std::collections::BTreeMap::new();
    for entry in entries {
        let path = text_value(entry.get("path"));
        let backup_at = text_value(entry.get("backupAt"));
        if path.is_empty() || backup_at.is_empty() {
            continue;
        }
        entries_by_path.entry(path.clone()).or_insert_with(|| {
            serde_json::json!({
                "path": path,
                "backupAt": backup_at,
                "sizeBytes": entry.get("sizeBytes"),
                "pinned": entry.get("pinned").and_then(|value| value.as_bool()).unwrap_or(false)
            })
        });
    }
    let mut unique = entries_by_path.into_values().collect::<Vec<_>>();
    unique.sort_by(|left, right| {
        text_value(right.get("backupAt")).cmp(&text_value(left.get("backupAt")))
    });
    unique
}

fn trim_backup_entries(
    entries: Vec<serde_json::Value>,
    limit: usize,
) -> (Vec<serde_json::Value>, Vec<serde_json::Value>) {
    let mut kept = entries;
    let mut removed = Vec::new();
    while kept.len() > limit {
        let remove_index = kept.iter().enumerate().rev().find_map(|(index, entry)| {
            if entry.get("pinned").and_then(|value| value.as_bool()) != Some(true) {
                Some(index)
            } else {
                None
            }
        });
        let Some(remove_index) = remove_index else {
            break;
        };
        removed.push(kept.remove(remove_index));
    }
    (kept, removed)
}

fn save_successful_backup_record(
    app: &tauri::AppHandle,
    app_id: &str,
    title: &str,
    entry: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let settings = load_backup_settings(app);
    let current_record = settings
        .get("backupRecords")
        .and_then(|records| records.get(app_id));
    let all_entries =
        unique_backup_entries([vec![entry], get_backup_record_entries(current_record)].concat());
    let (kept_entries, removed_entries) =
        trim_backup_entries(all_entries, BACKUP_ENTRY_RETENTION_LIMIT);
    if kept_entries.is_empty() {
        return Ok(settings);
    }
    for removed_entry in removed_entries {
        let path = text_value(removed_entry.get("path"));
        if !path.is_empty() {
            let _ = std::fs::remove_dir_all(path);
        }
    }
    let latest_entry = kept_entries
        .first()
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    save_backup_record(
        app,
        app_id,
        serde_json::json!({
            "title": title,
            "lastBackupAt": latest_entry.get("backupAt").cloned().unwrap_or_else(|| serde_json::json!("")),
            "lastBackupSuccess": true,
            "lastBackupPath": latest_entry.get("path").cloned().unwrap_or_else(|| serde_json::json!("")),
            "lastBackupSizeBytes": latest_entry.get("sizeBytes").cloned(),
            "entries": kept_entries
        }),
    )
}

fn save_failed_backup_record(
    app: &tauri::AppHandle,
    app_id: &str,
    title: &str,
    backup_path: &str,
    error: &str,
) -> Result<serde_json::Value, String> {
    let settings = load_backup_settings(app);
    let current_record = settings
        .get("backupRecords")
        .and_then(|records| records.get(app_id));

    save_backup_record(
        app,
        app_id,
        serde_json::json!({
            "title": title,
            "lastBackupAt": current_timestamp_string(),
            "lastBackupSuccess": false,
            "lastBackupPath": backup_path,
            "lastBackupError": error,
            "entries": get_backup_record_entries(current_record)
        }),
    )
}

fn launch_custom_executable(
    app: &tauri::AppHandle,
    game: serde_json::Value,
    app_id: &str,
    executable_path: &str,
) -> serde_json::Value {
    let executable = std::path::PathBuf::from(executable_path);
    if !executable.is_file() {
        return serde_json::json!({
            "success": false,
            "appId": app_id,
            "customExecutable": true,
            "error": "O executÃ¡vel configurado nÃ£o foi encontrado."
        });
    }

    let achievement_env = start_piratebox_achievement_server(app.clone()).ok();
    let launched_title = game_title(&game, app_id);

    let mut command = std::process::Command::new(&executable);
    if let Some(parent) = executable.parent() {
        command.current_dir(parent);
    }
    command.env("PIRATEBOX_APP_ID", app_id);
    command.env("PIRATEBOX_GAME_TITLE", &launched_title);
    if let Some((url, token)) = achievement_env {
        command.env("PIRATEBOX_ACHIEVEMENTS_URL", url);
        command.env("PIRATEBOX_ACHIEVEMENTS_TOKEN", token);
    }

    match command.spawn() {
        Ok(mut child) => {
            let app = app.clone();
            let app_id = app_id.to_string();
            let launched_app_id = app_id.clone();
            open_game_playtime_session(&app, &game);
            std::thread::spawn(move || {
                let _ = child.wait();
                let title = close_game_playtime_session(&app, &app_id)
                    .unwrap_or_else(|| game_title(&game, &app_id));
                run_automatic_backup_after_close(app, app_id, title, game);
            });

            serde_json::json!({
                "success": true,
                "appId": launched_app_id,
                "customExecutable": true
            })
        }
        Err(error) => serde_json::json!({
            "success": false,
            "appId": app_id,
            "customExecutable": true,
            "error": error.to_string()
        }),
    }
}

fn find_likely_game_executable(game: &serde_json::Value) -> Option<std::path::PathBuf> {
    let install_path = text_value(game.get("installPath"));
    let root = std::path::PathBuf::from(install_path);
    if !root.is_dir() {
        return None;
    }

    let title = text_value(game.get("title")).to_lowercase();
    let install_dir = text_value(game.get("installDir")).to_lowercase();
    let mut candidates: Vec<(u8, u64, std::path::PathBuf)> = Vec::new();
    collect_executable_candidates(&root, &root, 0, &title, &install_dir, &mut candidates);
    candidates.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| right.1.cmp(&left.1)));
    candidates.into_iter().map(|(_, _, path)| path).next()
}

fn collect_executable_candidates(
    root: &std::path::Path,
    current: &std::path::Path,
    depth: usize,
    title: &str,
    install_dir: &str,
    candidates: &mut Vec<(u8, u64, std::path::PathBuf)>,
) {
    if depth > 3 || candidates.len() > 200 {
        return;
    }

    let Ok(entries) = std::fs::read_dir(current) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if path.is_dir() {
            if !matches!(
                name.as_str(),
                "_commonredist" | "redist" | "redistributables" | "directx"
            ) {
                collect_executable_candidates(
                    root,
                    &path,
                    depth + 1,
                    title,
                    install_dir,
                    candidates,
                );
            }
            continue;
        }

        if path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
        {
            if name.contains("unins")
                || name.contains("setup")
                || name.contains("crash")
                || name.contains("redist")
            {
                continue;
            }
            let size = entry.metadata().map(|metadata| metadata.len()).unwrap_or(0);
            let file_stem = path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_lowercase();
            let root_name = root
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_lowercase();
            let score = if !install_dir.is_empty() && file_stem == install_dir {
                4
            } else if !title.is_empty() && title.contains(&file_stem) {
                3
            } else if !root_name.is_empty() && file_stem.contains(&root_name) {
                2
            } else if depth <= 1 {
                1
            } else {
                0
            };
            candidates.push((score, size, path));
        }
    }
}

fn is_process_running_by_path(executable_path: &std::path::Path) -> bool {
    let path = executable_path.to_string_lossy();
    if path.is_empty() {
        return false;
    }

    #[cfg(windows)]
    {
        let escaped = path.replace('\'', "''");
        let script = format!(
            "$p = '{}'; [bool](Get-CimInstance Win32_Process | Where-Object {{ $_.ExecutablePath -eq $p }} | Select-Object -First 1)",
            escaped
        );
        return std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .output()
            .ok()
            .map(|output| {
                String::from_utf8_lossy(&output.stdout)
                    .trim()
                    .eq_ignore_ascii_case("true")
            })
            .unwrap_or(false);
    }

    #[cfg(not(windows))]
    {
        return std::process::Command::new("pgrep")
            .arg("-f")
            .arg(path.as_ref())
            .output()
            .ok()
            .is_some_and(|output| output.status.success());
    }
}

fn monitor_game_process(
    app: tauri::AppHandle,
    game: serde_json::Value,
    app_id: String,
    executable_path: std::path::PathBuf,
) {
    std::thread::spawn(move || {
        for _ in 0..60 {
            if is_process_running_by_path(&executable_path) {
                open_game_playtime_session(&app, &game);
                break;
            }
            std::thread::sleep(std::time::Duration::from_secs(5));
        }

        while is_process_running_by_path(&executable_path) {
            std::thread::sleep(std::time::Duration::from_secs(15));
        }

        let session_closed = close_game_playtime_session(&app, &app_id).is_some();
        if let Ok(mut guard) = steam_monitor_state().lock() {
            guard.pending_games.remove(&app_id);
            guard.pending_game_registered_at.remove(&app_id);
            guard.process_fallback_started.remove(&app_id);
        }

        if session_closed {
            run_automatic_backup_after_close(
                app.clone(),
                app_id,
                game_title(&game, &extract_app_id(&game)),
                game,
            );
        }
    });
}

fn sanitize_folder_name(value: &str) -> String {
    let invalid = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    let name = value
        .chars()
        .map(|ch| {
            if invalid.contains(&ch) || ch.is_control() {
                ' '
            } else {
                ch
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    name.chars()
        .take(80)
        .collect::<String>()
        .if_empty("Game".to_string())
}

fn backup_timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn save_backup_record(
    app: &tauri::AppHandle,
    app_id: &str,
    record: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut records = serde_json::Map::new();
    records.insert(app_id.to_string(), record);
    save_backup_settings(app, serde_json::json!({ "backupRecords": records }))
}

fn directory_has_content(path: &std::path::Path) -> bool {
    let Ok(entries) = std::fs::read_dir(path) else {
        return false;
    };

    entries.flatten().any(|entry| {
        entry
            .file_name()
            .to_str()
            .is_some_and(|name| name != BACKUP_ROOT_MARKER_FILE)
    })
}

fn directory_size(path: &std::path::Path) -> Result<u64, String> {
    let mut total = 0;
    let entries = std::fs::read_dir(path).map_err(|error| error.to_string())?;

    for entry in entries.flatten() {
        let path = entry.path();
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };

        if metadata.is_dir() {
            total += directory_size(&path).unwrap_or(0);
        } else if metadata.is_file() {
            total += metadata.len();
        }
    }

    Ok(total)
}

fn selected_backup_entry_path(
    settings: &serde_json::Value,
    app_id: &str,
    backup_path: Option<String>,
) -> String {
    selected_backup_path(settings, app_id, backup_path)
}

fn backup_details_for_path(
    app: &tauri::AppHandle,
    app_id: &str,
    backup_path: &str,
    steam_path: &str,
    steam_achievements: &[serde_json::Value],
) -> Result<serde_json::Value, String> {
    let settings = load_backup_settings(app);
    let title = settings
        .get("backupRecords")
        .and_then(|records| records.get(app_id))
        .and_then(|record| record.get("title"))
        .and_then(|value| value.as_str())
        .unwrap_or(app_id);
    let mut achievements =
        read_piratebox_achievements_backup_file(app, app_id, title, Some(backup_path))
            .and_then(|file| file.get("unlocked").cloned())
            .and_then(|value| value.as_array().cloned())
            .unwrap_or_default();

    if achievements.is_empty() {
        achievements =
            steam_appcache::read_steam_local_achievement_backup_file(steam_path, app_id, title)
                .and_then(|file| file.get("unlocked").cloned())
                .and_then(|value| value.as_array().cloned())
                .unwrap_or_default();
    }

    let achievements = enrich_backup_achievements_with_icons(achievements, steam_achievements);
    let root = std::path::PathBuf::from(backup_path);
    let mut files = Vec::new();
    let mut file_count = 0u64;
    let mut directory_count = 0u64;
    let mut truncated = false;

    fn visit(
        current: &std::path::Path,
        files: &mut Vec<serde_json::Value>,
        file_count: &mut u64,
        directory_count: &mut u64,
        truncated: &mut bool,
    ) {
        if files.len() >= 500 {
            *truncated = true;
            return;
        }

        let Ok(entries) = std::fs::read_dir(current) else {
            return;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let Ok(metadata) = entry.metadata() else {
                continue;
            };

            if metadata.is_dir() {
                *directory_count += 1;
                files.push(serde_json::json!({
                    "name": name,
                    "path": path.to_string_lossy(),
                    "type": "directory"
                }));
                visit(&path, files, file_count, directory_count, truncated);
            } else if metadata.is_file() {
                *file_count += 1;
                files.push(serde_json::json!({
                    "name": name,
                    "path": path.to_string_lossy(),
                    "type": "file",
                    "extension": path.extension().and_then(|value| value.to_str()).unwrap_or_default(),
                    "sizeBytes": metadata.len()
                }));
            }

            if files.len() >= 500 {
                *truncated = true;
                break;
            }
        }
    }

    visit(
        &root,
        &mut files,
        &mut file_count,
        &mut directory_count,
        &mut truncated,
    );

    Ok(serde_json::json!({
        "appId": app_id,
        "backupPath": backup_path,
        "files": files,
        "fileCount": file_count,
        "directoryCount": directory_count,
        "truncated": truncated,
        "achievements": achievements
    }))
}

#[cfg(windows)]
fn configure_windows_app_identity() {
    use std::os::windows::ffi::OsStrExt;

    let app_id: Vec<u16> = std::ffi::OsStr::new(APP_USER_MODEL_ID)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(app_id.as_ptr());
    }
}

#[cfg(not(windows))]
fn configure_windows_app_identity() {}

fn stop_piratebox_achievement_server() {
    if let Ok(mut guard) = achievement_server_state().lock() {
        if let Some(state) = guard.take() {
            let _ = state._stop.send(());
        }
    }
}

fn close_all_game_playtime_sessions(app: &tauri::AppHandle) {
    let app_ids = steam_monitor_state()
        .lock()
        .ok()
        .map(|guard| guard.playtime_sessions.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();

    for app_id in app_ids {
        close_game_playtime_session(app, &app_id);
    }
}

fn shutdown_app_services(app: &tauri::AppHandle) {
    if SHUTDOWN_STARTED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }

    close_all_game_playtime_sessions(app);
    achievement_monitor::stop_all_local_achievement_monitors();
    stop_piratebox_achievement_server();
}

fn hide_main_window_to_tray(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    use tauri::Emitter;

    let _ = window.hide();
    let _ = app.emit(WINDOW_HIDDEN_TO_TRAY_EVENT, ());
}

fn request_close_main_window(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
) -> Result<(), String> {
    if IS_QUITTING.load(std::sync::atomic::Ordering::SeqCst) {
        return window.close().map_err(|error| error.to_string());
    }

    if is_startup_setting_enabled(app, "minimizeToTray") {
        hide_main_window_to_tray(app, window);
        return Ok(());
    }

    IS_QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
    shutdown_app_services(app);
    window.close().map_err(|error| error.to_string())
}

fn quit_application(app: &tauri::AppHandle) {
    IS_QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
    shutdown_app_services(app);
    app.exit(0);
}

fn show_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn hide_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.hide();
    }
}

fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{TrayIconBuilder, TrayIconEvent};

    let show = MenuItem::with_id(app, TRAY_SHOW_ID, "Abrir PirateBox", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, TRAY_HIDE_ID, "Ocultar", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, TRAY_QUIT_ID, "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .tooltip("PirateBox")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_SHOW_ID => show_main_window(app),
            TRAY_HIDE_ID => hide_main_window(app),
            TRAY_QUIT_ID => quit_application(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(event, TrayIconEvent::DoubleClick { .. }) {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }

    tray.build(app)?;
    Ok(())
}

fn setup_window_lifecycle(app: &mut tauri::App) -> tauri::Result<()> {
    use tauri::Manager;

    configure_windows_app_identity();

    let handle = app.handle().clone();
    let settings = load_startup_settings(&handle);
    let _ = apply_autostart_settings(&handle, &settings);

    setup_tray(&handle)?;
    start_steam_running_app_monitor(handle.clone());
    start_game_playtime_snapshot_emitter(handle.clone());

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let close_app = handle.clone();
        let close_window = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if IS_QUITTING.load(std::sync::atomic::Ordering::SeqCst) {
                    return;
                }

                if is_startup_setting_enabled(&close_app, "minimizeToTray") {
                    api.prevent_close();
                    hide_main_window_to_tray(&close_app, &close_window);
                    return;
                }

                IS_QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
                shutdown_app_services(&close_app);
            }
        });

        if startup_setting_enabled(&settings, "startMinimized") {
            let _ = window.hide();
        }
    }

    Ok(())
}

#[tauri::command]
fn steam_get_profile(app: tauri::AppHandle) -> Option<serde_json::Value> {
    load_steam_profile(&app)
}

#[tauri::command]
fn steam_save_profile(
    app: tauri::AppHandle,
    profile: serde_json::Value,
) -> Result<serde_json::Value, String> {
    save_steam_profile(&app, profile)
}

#[tauri::command]
async fn steam_sign_in(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    sign_in_with_steam(&app).await
}

#[tauri::command]
fn steam_sign_out(app: tauri::AppHandle) -> Result<(), String> {
    remove_data_file(&app, STEAM_PROFILE_FILE)
}

#[tauri::command]
fn backup_get_settings(app: tauri::AppHandle) -> serde_json::Value {
    load_backup_settings(&app)
}

#[tauri::command]
fn backup_validate_root(app: tauri::AppHandle) -> serde_json::Value {
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
fn backup_ensure_root(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let settings = load_backup_settings(&app);
    let output_path = to_backup_root_path(&text_value(settings.get("outputPath")));
    write_backup_root_marker(&output_path)?;
    let _ = save_backup_settings(&app, serde_json::json!({ "outputPath": output_path }))?;
    Ok(backup_validate_root(app))
}

#[tauri::command]
fn backup_set_output_path(
    app: tauri::AppHandle,
    output_path: String,
) -> Result<serde_json::Value, String> {
    let output_path = to_backup_root_path(&output_path);
    write_backup_root_marker(&output_path)?;
    save_backup_settings(&app, serde_json::json!({ "outputPath": output_path }))
}

#[tauri::command]
fn backup_set_game_automatic(
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
fn backup_set_library_automatic(
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
fn backup_set_entry_pinned(
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
fn backup_set_game_custom_executable(
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
fn backup_open_folder(
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
fn backup_delete_folder(
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
fn backup_refresh_game_metadata(app: tauri::AppHandle, _app_id: String) -> serde_json::Value {
    load_backup_settings(&app)
}

#[tauri::command]
fn steam_select_path(
    app: tauri::AppHandle,
    steam_path: String,
) -> Result<serde_json::Value, String> {
    let selected_path = steam_path.trim();
    let Some(normalized_path) = normalize_steam_root_path(selected_path) else {
        let missing_entries = vec![steamapps_path(std::path::Path::new(selected_path))
            .join("libraryfolders.vdf")
            .to_string_lossy()
            .to_string()];
        return Ok(serde_json::json!({
            "status": "invalid",
            "selectedPath": selected_path,
            "missingEntries": missing_entries,
            "message": "A pasta selecionada nÃ£o parece conter uma instalaÃ§Ã£o vÃ¡lida da Steam."
        }));
    };

    save_steam_path(&app, &normalized_path)?;
    Ok(serde_json::json!({
        "status": "ok",
        "steamPath": normalized_path
    }))
}

#[tauri::command]
fn steam_scan_library(
    app: tauri::AppHandle,
    steam_path: Option<String>,
    _force_refresh_owned_games: Option<bool>,
    _include_owned_games: Option<bool>,
) -> Result<serde_json::Value, String> {
    let pirate_library_games = pirate_library::read_pirate_library_games(&app);
    let (resolved_path, checked_paths) = resolve_steam_path(&app, steam_path);

    let Some(steam_path) = resolved_path else {
        if pirate_library_games.is_empty() {
            return Ok(serde_json::json!({
                "status": "missing",
                "checkedPaths": checked_paths,
                "message": "NÃ£o foi possÃ­vel localizar a instalaÃ§Ã£o da Steam."
            }));
        }

        let stored_path = load_saved_steam_path(&app);
        let playtimes = load_game_playtimes(&app);
        let added_app_ids = pirate_library_games
            .iter()
            .map(|game| extract_app_id(game))
            .filter(|app_id| !app_id.is_empty())
            .collect::<Vec<_>>();
        let steam_path_ref = stored_path.as_str();
        let games = pirate_library_games
            .into_iter()
            .map(|game| merge_playtime_into_game(game, &playtimes))
            .map(|game| enrich_game_with_local_achievement_stats(&app, game, steam_path_ref))
            .collect::<Vec<_>>();

        return Ok(serde_json::json!({
            "status": "ok",
            "steamPath": stored_path,
            "libraryPaths": [],
            "appIds": added_app_ids,
            "addedAppIds": added_app_ids,
            "games": games
        }));
    };

    save_steam_path(&app, &steam_path)?;
    let library_paths = read_steam_library_paths(&steam_path);
    let installed_games = scan_installed_steam_games(&library_paths);
    let plugin_app_ids = pirate_library::read_plugin_added_steam_app_ids(&steam_path);
    let (added_app_ids, merged_games) = pirate_library::build_scan_games_with_plugins(
        installed_games,
        &plugin_app_ids,
        pirate_library_games,
    );
    let added_app_id_set = added_app_ids
        .iter()
        .cloned()
        .collect::<std::collections::HashSet<_>>();
    let playtimes = load_game_playtimes(&app);
    let games = merged_games
        .into_iter()
        .map(|game| merge_playtime_into_game(game, &playtimes))
        .map(|game| {
            if added_app_id_set.contains(&extract_app_id(&game)) {
                enrich_game_with_local_achievement_stats(&app, game, &steam_path)
            } else {
                game
            }
        })
        .collect::<Vec<_>>();

    Ok(serde_json::json!({
        "status": "ok",
        "steamPath": steam_path,
        "libraryPaths": library_paths,
        "appIds": added_app_ids,
        "addedAppIds": added_app_ids,
        "games": games
    }))
}

#[tauri::command]
fn steam_restart(app: tauri::AppHandle) -> serde_json::Value {
    use tauri_plugin_opener::OpenerExt;

    let (resolved_path, checked_paths) = resolve_steam_path(&app, None);
    if let Some(steam_path) = resolved_path {
        let steam_exe = std::path::PathBuf::from(&steam_path).join("steam.exe");
        if steam_exe.is_file() {
            let mut command = std::process::Command::new(&steam_exe);
            command.current_dir(&steam_path);
            return match command.spawn() {
                Ok(_) => serde_json::json!({
                    "success": true,
                    "status": "opened",
                    "steamPath": steam_path,
                    "message": "Steam foi aberta com seguranÃ§a. Processos existentes nÃ£o foram encerrados."
                }),
                Err(error) => serde_json::json!({
                    "success": false,
                    "status": "failed",
                    "steamPath": steam_path,
                    "error": error.to_string()
                }),
            };
        }
    }

    match app.opener().open_url("steam://open/main", None::<&str>) {
        Ok(_) => serde_json::json!({
            "success": true,
            "status": "opened-url",
            "checkedPaths": checked_paths,
            "message": "Steam foi solicitada via protocolo steam://. Processos existentes nÃ£o foram encerrados."
        }),
        Err(error) => serde_json::json!({
            "success": false,
            "status": "missing",
            "checkedPaths": checked_paths,
            "error": error.to_string()
        }),
    }
}

#[tauri::command]
fn game_launch(
    app: tauri::AppHandle,
    game: serde_json::Value,
) -> Result<serde_json::Value, String> {
    use tauri_plugin_opener::OpenerExt;

    let app_id = extract_app_id(&game);
    if app_id.is_empty() {
        return Ok(serde_json::json!({
            "success": false,
            "appId": "",
            "error": "AppId invÃ¡lido."
        }));
    }

    let settings = load_backup_settings(&app);
    let executable_path = custom_executable_path(&settings, &app_id);
    if !executable_path.is_empty() {
        let result = launch_custom_executable(&app, game.clone(), &app_id, &executable_path);
        return Ok(result);
    }

    let url = format!("steam://rungameid/{app_id}");
    match app.opener().open_url(url, None::<&str>) {
        Ok(_) => {
            register_pending_steam_game(game.clone());
            let _ = record_game_launch_playtime(&app, &app_id);
            if let Some(executable_path) = find_likely_game_executable(&game) {
                #[cfg(windows)]
                {
                    let app_handle = app.clone();
                    let fallback_game = game.clone();
                    let fallback_app_id = app_id.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(20));
                        let has_session = steam_monitor_state().lock().is_ok_and(|guard| {
                            guard.playtime_sessions.contains_key(&fallback_app_id)
                        });
                        if !has_session {
                            if let Ok(mut guard) = steam_monitor_state().lock() {
                                guard
                                    .process_fallback_started
                                    .insert(fallback_app_id.clone());
                            }
                            monitor_game_process(
                                app_handle,
                                fallback_game,
                                fallback_app_id,
                                executable_path,
                            );
                        }
                    });
                }
                #[cfg(not(windows))]
                monitor_game_process(app.clone(), game.clone(), app_id.clone(), executable_path);
            }
            Ok(serde_json::json!({
                "success": true,
                "appId": app_id,
                "customExecutable": false
            }))
        }
        Err(error) => Ok(serde_json::json!({
            "success": false,
            "appId": app_id,
            "customExecutable": false,
            "error": error.to_string()
        })),
    }
}

#[tauri::command]
fn game_get_playtimes(app: tauri::AppHandle) -> serde_json::Value {
    get_game_playtime_snapshot(&app)
}

#[tauri::command]
fn backup_select_game_executable(
    app: tauri::AppHandle,
    game: serde_json::Value,
    executable_path: String,
) -> Result<serde_json::Value, String> {
    let app_id = extract_app_id(&game);
    let settings = load_backup_settings(&app);
    if app_id.is_empty() {
        return Ok(serde_json::json!({
            "status": "invalid",
            "appId": "",
            "settings": settings,
            "message": "Jogo invÃ¡lido."
        }));
    }

    let path = executable_path.trim();
    let executable = std::path::PathBuf::from(path);
    if path.is_empty() || !executable.is_file() || !path.to_lowercase().ends_with(".exe") {
        return Ok(serde_json::json!({
            "status": "invalid",
            "appId": app_id,
            "settings": settings,
            "message": "Selecione um arquivo .exe vÃ¡lido."
        }));
    }

    let settings = backup_set_game_custom_executable(app, app_id.clone(), Some(path.to_string()))?;
    Ok(serde_json::json!({
        "status": "ok",
        "appId": app_id,
        "executablePath": path,
        "settings": settings,
        "libraryGame": game
    }))
}

#[tauri::command]
async fn backup_get_details(
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
        .map(|items| items.clone())
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
fn backup_run_game_local(
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
fn backup_restore_game_local(
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

#[tauri::command]
fn window_minimize(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
fn window_close(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    request_close_main_window(&app, &window)
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
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            image_cache::start_image_cache_cleanup(app.handle().clone());
            catalogue_cache::start_catalogue_refresh_scheduler(app.handle().clone());
            setup_window_lifecycle(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            catalogue::app_get_status,
            catalogue::database_get_games,
            catalogue::database_get_game_details,
            catalogue::database_get_game_store_details,
            catalogue::database_get_game_achievement_details,
            catalogue::catalogue_get_home,
            catalogue::steam_get_game_icon_url,
            catalogue::app_is_steamtools_installed,
            catalogue::app_install_steamtools,
            catalogue::cache_get_image,
            settings::app_get_startup_settings,
            settings::app_set_startup_settings,
            settings::app_set_notification_settings,
            settings::app_get_morrenus_api_key,
            settings::app_set_morrenus_api_key,
            settings::app_get_morrenus_stats,
            steam_get_profile,
            steam_save_profile,
            steam_sign_in,
            steam_sign_out,
            backup_get_settings,
            backup_validate_root,
            backup_ensure_root,
            backup_set_output_path,
            backup_set_game_automatic,
            backup_set_library_automatic,
            backup_set_entry_pinned,
            backup_set_game_custom_executable,
            backup_open_folder,
            backup_delete_folder,
            backup_refresh_game_metadata,
            steam_select_path,
            steam_scan_library,
            steam_restart,
            game_launch,
            game_get_playtimes,
            backup_select_game_executable,
            ludusavi::ludusavi_get_backup_previews,
            backup_get_details,
            backup_run_game_local,
            backup_restore_game_local,
            luatools::luatools_add_game,
            luatools::luatools_remove_game,
            window_minimize,
            window_close,
            shell_open_external,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                shutdown_app_services(app_handle);
            }
        });
}
