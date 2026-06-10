use crate::catalogue_cache;
use crate::image_cache;
use crate::{FACETS_VERSION, RANKING_VERSION};

pub(crate) fn empty_game_database(source: &str) -> serde_json::Value {
    serde_json::json!({
        "games": [],
        "total": 0,
        "matched": 0,
        "limited": false,
        "source": source
    })
}

fn default_games_api_url() -> String {
    "https://piratebox-catalogue.hella.workers.dev".to_string()
}

pub(crate) fn normalize_api_url(api_url: Option<String>) -> String {
    api_url
        .or_else(|| std::env::var("PIRATEBOX_GAMES_API_URL").ok())
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(default_games_api_url)
}

fn get_string(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn get_u64(value: &serde_json::Value, key: &str) -> Option<u64> {
    value.get(key).and_then(|value| value.as_u64())
}

fn get_bool(value: &serde_json::Value, key: &str) -> bool {
    value
        .get(key)
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

fn append_filter_params(url: &mut reqwest::Url, request: &serde_json::Value, key: &str) {
    let Some(values) = request
        .get("filters")
        .and_then(|filters| filters.get(key))
        .and_then(|value| value.as_array())
    else {
        return;
    };

    for value in values {
        if let Some(value) = value
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            url.query_pairs_mut().append_pair(key, value);
        }
    }
}

pub(crate) fn remote_url(api_url: Option<String>, path: &str) -> Result<reqwest::Url, String> {
    let base = format!("{}/", normalize_api_url(api_url));
    reqwest::Url::parse(&base)
        .and_then(|url| url.join(path.trim_start_matches('/')))
        .map_err(|error| error.to_string())
}

async fn is_remote_image_available(url: &str) -> bool {
    let client = reqwest::Client::new();
    for method in [reqwest::Method::HEAD, reqwest::Method::GET] {
        let request = client.request(method.clone(), url).header(
            reqwest::header::ACCEPT,
            "image/avif,image/webp,image/png,image/jpeg,image/*,*/*",
        );
        let request = if method == reqwest::Method::GET {
            request.header(reqwest::header::RANGE, "bytes=0-0")
        } else {
            request
        };

        if let Ok(response) = request.send().await {
            if response.status().is_success()
                || response.status() == reqwest::StatusCode::PARTIAL_CONTENT
            {
                return true;
            }
        }
    }

    false
}

fn steam_asset_candidates(app_id: &str) -> Vec<String> {
    [
        "logo.png",
        "library_600x900.jpg",
        "capsule_184x69.jpg",
        "header.jpg",
    ]
    .iter()
    .map(|asset| crate::steam_asset_url(app_id, asset))
    .collect()
}

pub(crate) async fn fetch_remote_game(
    app: &tauri::AppHandle,
    game_id: String,
    api_url: Option<String>,
) -> Result<Option<serde_json::Value>, String> {
    let app_id: String = game_id.chars().filter(char::is_ascii_digit).collect();
    if app_id.is_empty() {
        return Ok(None);
    }

    let url = remote_url(api_url, &format!("games/{app_id}"))?;
    let (value, _, _) = catalogue_cache::fetch_json_with_cache(app, url, false).await?;
    Ok(value
        .get("game")
        .cloned()
        .or_else(|| if value.is_object() { Some(value) } else { None }))
}

#[tauri::command]
pub fn app_get_status() -> serde_json::Value {
    serde_json::json!({
        "name": "PirateBox Tauri",
        "version": env!("CARGO_PKG_VERSION"),
        "runtime": "tauri-2",
        "dev": cfg!(debug_assertions)
    })
}

#[tauri::command]
pub async fn database_get_games(
    app: tauri::AppHandle,
    request: Option<serde_json::Value>,
    api_url: Option<String>,
) -> Result<serde_json::Value, String> {
    let request = request.unwrap_or_else(|| serde_json::json!({}));
    let mut url = remote_url(api_url, "catalogue/search")?;
    let limit = get_u64(&request, "limit").unwrap_or(20).clamp(1, 500);
    let offset = get_u64(&request, "offset").unwrap_or(0);

    if let Some(query) = get_string(&request, "query") {
        url.query_pairs_mut().append_pair("q", &query);
    }
    url.query_pairs_mut()
        .append_pair("limit", &limit.to_string())
        .append_pair("offset", &offset.to_string())
        .append_pair("facetsVersion", FACETS_VERSION)
        .append_pair("rankingVersion", RANKING_VERSION);

    if get_bool(&request, "includeFacets") || get_bool(&request, "facetsOnly") {
        url.query_pairs_mut().append_pair("includeFacets", "1");
    }
    if get_bool(&request, "facetsOnly") {
        url.query_pairs_mut().append_pair("facetsOnly", "1");
    }
    if let Some(sort) = get_string(&request, "sort") {
        url.query_pairs_mut().append_pair("sort", &sort);
    }

    append_filter_params(&mut url, &request, "genres");
    append_filter_params(&mut url, &request, "tags");
    append_filter_params(&mut url, &request, "developers");
    append_filter_params(&mut url, &request, "publishers");
    append_filter_params(&mut url, &request, "years");

    match catalogue_cache::fetch_json_with_cache(&app, url, false).await {
        Ok((mut value, updated_at, from_cache)) => {
            catalogue_cache::prepare_cached_response(&mut value, updated_at, from_cache);
            Ok(value)
        }
        Err(_) => Ok(empty_game_database("remote-unavailable")),
    }
}

#[tauri::command]
pub async fn database_get_game_details(
    app: tauri::AppHandle,
    game_id: String,
    api_url: Option<String>,
) -> Result<Option<serde_json::Value>, String> {
    fetch_remote_game(&app, game_id, api_url).await
}

#[tauri::command]
pub async fn database_get_game_store_details(
    app: tauri::AppHandle,
    game_id: String,
    api_url: Option<String>,
) -> Result<Option<serde_json::Value>, String> {
    fetch_remote_game(&app, game_id, api_url).await
}

#[tauri::command]
pub async fn database_get_game_achievement_details(
    app: tauri::AppHandle,
    game_id: String,
    api_url: Option<String>,
) -> Result<Option<serde_json::Value>, String> {
    let app_id: String = game_id.chars().filter(char::is_ascii_digit).collect();
    if app_id.is_empty() {
        return Ok(None);
    }

    let remote_game = fetch_remote_game(&app, game_id, api_url).await?;
    let Some(game) = remote_game else {
        return Ok(None);
    };

    let (steam_path, _) = crate::resolve_steam_path(&app, None);
    Ok(Some(crate::merge_game_achievement_details(
        &app,
        game,
        steam_path.as_deref().unwrap_or_default(),
    )))
}

#[tauri::command]
pub async fn catalogue_get_home(
    app: tauri::AppHandle,
    api_url: Option<String>,
) -> Result<serde_json::Value, String> {
    let url = remote_url(api_url, "home")?;
    let (mut value, updated_at, from_cache) =
        catalogue_cache::fetch_json_with_cache(&app, url, false).await?;
    catalogue_cache::prepare_cached_response(&mut value, updated_at, from_cache);
    Ok(value)
}

#[tauri::command]
pub async fn steam_get_game_icon_url(app_id: String) -> Option<String> {
    let app_id: String = app_id.chars().filter(char::is_ascii_digit).collect();
    if app_id.is_empty() {
        return None;
    }

    for candidate in steam_asset_candidates(&app_id) {
        if is_remote_image_available(&candidate).await {
            return Some(candidate);
        }
    }

    None
}

#[tauri::command]
pub fn app_is_steamtools_installed() -> bool {
    true
}

#[tauri::command]
pub fn app_install_steamtools() -> serde_json::Value {
    serde_json::json!({
        "success": true
    })
}

#[tauri::command]
pub async fn cache_get_image(app: tauri::AppHandle, url: String) -> String {
    image_cache::cache_image_url(&app, &url).await
}
