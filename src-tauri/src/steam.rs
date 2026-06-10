use crate::settings::{read_json_file, remove_data_file, write_json_file};
use crate::util::{escape_html, text_value, xml_text, EmptyStringExt};

const STEAM_PROFILE_FILE: &str = "steam-profile.json";
const MAX_PROFILE_AVATAR_BYTES: usize = 512 * 1024;
const STEAM_OPENID_ENDPOINT: &str = "https://steamcommunity.com/openid/login";

static STEAM_SIGN_IN_ACTIVE: std::sync::Mutex<bool> = std::sync::Mutex::new(false);

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

#[tauri::command]
pub fn steam_get_profile(app: tauri::AppHandle) -> Option<serde_json::Value> {
    load_steam_profile(&app)
}

#[tauri::command]
pub fn steam_save_profile(
    app: tauri::AppHandle,
    profile: serde_json::Value,
) -> Result<serde_json::Value, String> {
    save_steam_profile(&app, profile)
}

#[tauri::command]
pub async fn steam_sign_in(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    sign_in_with_steam(&app).await
}

#[tauri::command]
pub fn steam_sign_out(app: tauri::AppHandle) -> Result<(), String> {
    remove_data_file(&app, STEAM_PROFILE_FILE)
}
