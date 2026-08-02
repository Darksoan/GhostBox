use crate::catalogue_cache;
use crate::image_cache;
use crate::{FACETS_VERSION, RANKING_VERSION};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};
use tauri::{Emitter, Manager};

const STEAM_STORE_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
const STEAM_STORE_DETAILS_CACHE_VERSION: u64 = 2;
const STEAM_STORE_DETAILS_CACHE_MAX_AGE_DAYS: i64 = 30;
const DEFAULT_STEAM_DETAILS_PROXY_URL: &str = "https://piratebox-steam-details.hella.workers.dev";
const STEAM_DETAILS_PROXY_URL_ENV: &str = "GHOSTBOX_STEAM_DETAILS_PROXY_URL";
const LEGACY_EDEN_STEAM_DETAILS_PROXY_URL_ENV: &str = "EDEN_STEAM_DETAILS_PROXY_URL";
const LEGACY_STEAM_DETAILS_PROXY_URL_ENV: &str = "PIRATEBOX_STEAM_DETAILS_PROXY_URL";
const GAME_ICON_URLS_RESOLVED_EVENT: &str = "game-icon-urls-resolved";
const STEAM_APPINFO_ICON_SEARCH_WINDOW: usize = 65_536;
const STEAMCMD_DOWNLOAD_URL: &str = "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip";
const STEAM_ICON_NEGATIVE_CACHE_TTL_SECS: u64 = 3_600;
static STEAM_STORE_DETAILS_CACHE_WRITE_LOCK: Mutex<()> = Mutex::new(());
static STEAM_ICON_URL_MEMORY: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
static STEAM_ICON_NEGATIVE_CACHE: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
static STEAM_APPINFO_BYTES_CACHE: OnceLock<Mutex<Option<AppinfoBytesCache>>> = OnceLock::new();
struct AppinfoBytesCache {
    path: PathBuf,
    modified: SystemTime,
    bytes: Arc<Vec<u8>>,
}

#[derive(Default)]
struct AchievementFetchResult {
    achievements: Vec<Value>,
    status: String,
    retry_after: Option<u64>,
}

fn text(value: Option<&Value>) -> String {
    value
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_default()
}

fn default_games_api_url() -> String {
    "https://piratebox-catalogue.hella.workers.dev".to_string()
}

pub(crate) fn normalize_api_url(api_url: Option<String>) -> String {
    api_url
        .or_else(|| std::env::var("GHOSTBOX_GAMES_API_URL").ok())
        .or_else(|| std::env::var("EDEN_GAMES_API_URL").ok())
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

fn html_decode(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
}

fn strip_html(value: &str) -> String {
    let mut output = String::new();
    let mut in_tag = false;
    for character in value.chars() {
        match character {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                output.push('\n');
            }
            _ if !in_tag => output.push(character),
            _ => {}
        }
    }
    html_decode(&output)
        .lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| {
            let lower = line.to_lowercase();
            !line.is_empty()
                && lower != "mínimos:"
                && lower != "minimos:"
                && lower != "minimum:"
                && lower != "recomendados:"
                && lower != "recommended:"
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn requirements(value: Option<&Value>) -> Vec<String> {
    text(value)
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .split('\n')
        .flat_map(|line| {
            strip_html(line)
                .lines()
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .collect()
}

fn steam_store_movie(movie: &Value) -> Option<Value> {
    let object = movie.as_object()?;
    let id = object
        .get("id")
        .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))?;
    let mp4 = object.get("mp4").and_then(|value| value.as_object());
    let webm = object.get("webm").and_then(|value| value.as_object());
    let hls_h264 = text(object.get("hls_h264"));
    let dash_h264 = text(object.get("dash_h264"));
    let dash_av1 = text(object.get("dash_av1"));
    let mp4_max = mp4.map(|value| text(value.get("max"))).unwrap_or_default();
    let mp4_480 = mp4.map(|value| text(value.get("480"))).unwrap_or_default();
    let webm_max = webm.map(|value| text(value.get("max"))).unwrap_or_default();
    let webm_480 = webm.map(|value| text(value.get("480"))).unwrap_or_default();

    if hls_h264.is_empty()
        && dash_h264.is_empty()
        && dash_av1.is_empty()
        && mp4_max.is_empty()
        && mp4_480.is_empty()
        && webm_max.is_empty()
        && webm_480.is_empty()
    {
        return None;
    }

    Some(serde_json::json!({
        "id": id,
        "name": text(object.get("name")),
        "thumbnail": text(object.get("thumbnail")),
        "highlight": object.get("highlight").and_then(|value| value.as_bool()).unwrap_or(false),
        "hls_h264": hls_h264,
        "dash_h264": dash_h264,
        "dash_av1": dash_av1,
        "mp4": { "max": mp4_max, "480": mp4_480 },
        "webm": { "max": webm_max, "480": webm_480 }
    }))
}

fn merge_steam_store_details(game: &mut Value, store_data: &Value) {
    let Some(object) = game.as_object_mut() else {
        return;
    };

    let name = text(store_data.get("name"));
    if !name.is_empty() {
        let current_title = text(object.get("title"));
        if current_title.is_empty()
            || current_title
                .eq_ignore_ascii_case(&format!("Steam App {}", text(object.get("appId"))))
        {
            object.insert("title".to_string(), Value::String(name));
        }
    }

    merge_header_image(object, text(store_data.get("header_image")));

    let screenshots: Vec<Value> = store_data
        .get("screenshots")
        .and_then(|value| value.as_array())
        .map(|screenshots| {
            screenshots
                .iter()
                .filter_map(|screenshot| {
                    let full = text(screenshot.get("path_full"));
                    (!full.is_empty()).then_some(Value::String(full))
                })
                .take(8)
                .collect()
        })
        .unwrap_or_default();
    if !screenshots.is_empty() {
        object.insert("screenshots".to_string(), Value::Array(screenshots));
    }

    let movies: Vec<Value> = store_data
        .get("movies")
        .and_then(|value| value.as_array())
        .map(|movies| movies.iter().filter_map(steam_store_movie).collect())
        .unwrap_or_default();
    if !movies.is_empty() {
        object.insert("movies".to_string(), Value::Array(movies));
    }

    let about_the_game = text(store_data.get("about_the_game"));
    if !about_the_game.is_empty() {
        object.insert("aboutTheGame".to_string(), Value::String(about_the_game));
    }

    let short_description = text(store_data.get("short_description"));
    if !short_description.is_empty() {
        object.insert(
            "shortDescription".to_string(),
            Value::String(short_description),
        );
    }

    let pc_requirements = store_data.get("pc_requirements").unwrap_or(&Value::Null);
    object.insert(
        "pcRequirements".to_string(),
        serde_json::json!({
            "minimum": requirements(pc_requirements.get("minimum")),
            "recommended": requirements(pc_requirements.get("recommended"))
        }),
    );

    let genres: Vec<Value> = store_data
        .get("genres")
        .and_then(|value| value.as_array())
        .map(|genres| {
            genres
                .iter()
                .filter_map(|genre| {
                    let description = text(genre.get("description"));
                    (!description.is_empty()).then_some(Value::String(description))
                })
                .take(6)
                .collect()
        })
        .unwrap_or_default();
    if !genres.is_empty() {
        object.insert("genres".to_string(), Value::Array(genres));
    }

    for key in ["developers", "publishers"] {
        let values: Vec<Value> = store_data
            .get(key)
            .and_then(|value| value.as_array())
            .map(|values| {
                values
                    .iter()
                    .filter_map(|value| {
                        let value = text(Some(value));
                        (!value.is_empty()).then_some(Value::String(value))
                    })
                    .collect()
            })
            .unwrap_or_default();
        if !values.is_empty() {
            object.insert(key.to_string(), Value::Array(values));
        }
    }
}

fn steam_store_details_from_store_data(store_data: &Value) -> Value {
    let screenshots: Vec<Value> = store_data
        .get("screenshots")
        .and_then(|value| value.as_array())
        .map(|screenshots| {
            screenshots
                .iter()
                .filter_map(|screenshot| {
                    let full = text(screenshot.get("path_full"));
                    (!full.is_empty()).then_some(Value::String(full))
                })
                .take(8)
                .collect()
        })
        .unwrap_or_default();
    let movies: Vec<Value> = store_data
        .get("movies")
        .and_then(|value| value.as_array())
        .map(|movies| movies.iter().filter_map(steam_store_movie).collect())
        .unwrap_or_default();
    let genres: Vec<Value> = store_data
        .get("genres")
        .and_then(|value| value.as_array())
        .map(|genres| {
            genres
                .iter()
                .filter_map(|genre| {
                    let description = text(genre.get("description"));
                    (!description.is_empty()).then_some(Value::String(description))
                })
                .take(6)
                .collect()
        })
        .unwrap_or_default();
    let pc_requirements = store_data.get("pc_requirements").unwrap_or(&Value::Null);

    serde_json::json!({
        "name": text(store_data.get("name")),
        "headerImage": text(store_data.get("header_image")),
        "screenshots": screenshots,
        "movies": movies,
        "aboutTheGame": text(store_data.get("about_the_game")),
        "shortDescription": text(store_data.get("short_description")),
        "pcRequirements": {
            "minimum": requirements(pc_requirements.get("minimum")),
            "recommended": requirements(pc_requirements.get("recommended")),
        },
        "genres": genres,
        "developers": text_array(store_data.get("developers"), usize::MAX),
        "publishers": text_array(store_data.get("publishers"), usize::MAX),
    })
}

#[allow(dead_code)]
fn is_steam_app_title_placeholder(title: &str, app_id: &str) -> bool {
    let title = title.trim();
    title.is_empty()
        || title.eq_ignore_ascii_case(&format!("Steam App {app_id}"))
        || title.eq_ignore_ascii_case(&format!("Steam {app_id}"))
}

#[allow(dead_code)]
fn set_game_title(game: &mut Value, title: String) {
    if let Some(object) = game.as_object_mut() {
        object.insert("title".to_string(), Value::String(title));
    }
}

fn merge_header_image(object: &mut serde_json::Map<String, Value>, header_image: String) {
    if header_image.is_empty() {
        return;
    }

    object.insert("cover".to_string(), Value::String(header_image.clone()));
    object.insert("coverUrl".to_string(), Value::String(header_image.clone()));

    let mut fallbacks = vec![Value::String(header_image.clone())];
    if let Some(existing) = object
        .get("coverFallbacks")
        .and_then(|value| value.as_array())
    {
        for fallback in existing {
            let fallback_text = text(Some(fallback));
            if fallback_text.is_empty() || fallback_text == header_image {
                continue;
            }
            fallbacks.push(Value::String(fallback_text));
        }
    }
    object.insert("coverFallbacks".to_string(), Value::Array(fallbacks));
}

fn steam_app_fallback_game(app_id: &str) -> Value {
    let header = format!(
        "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/{app_id}/header.jpg"
    );
    let hero = format!(
        "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/{app_id}/library_hero.jpg"
    );
    serde_json::json!({
        "appId": app_id,
        "id": format!("steam-{app_id}"),
        "title": format!("Steam App {app_id}"),
        "subtitle": "Steam",
        "status": "discover",
        "hours": 0,
        "rating": 0,
        "size": "Steam",
        "release": "Steam",
        "progress": 0,
        "accent": "#f0f1f7",
        "cover": header,
        "hero": hero,
        "coverUrl": header,
        "heroUrl": hero,
        "coverFallbacks": [header],
        "heroFallbacks": [hero],
        "logo": format!("https://cdn.cloudflare.steamstatic.com/steam/apps/{app_id}/logo.png"),
        "tags": [],
        "genres": [],
        "screenshots": [],
        "achievements": {
            "unlocked": 0,
            "total": 0,
            "progress": 0
        },
        "achievementList": []
    })
}

fn text_array(value: Option<&Value>, limit: usize) -> Vec<Value> {
    value
        .and_then(|value| value.as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(|value| {
                    let value = text(Some(value));
                    (!value.is_empty()).then_some(Value::String(value))
                })
                .take(limit)
                .collect()
        })
        .unwrap_or_default()
}

fn merge_normalized_steam_details(game: &mut Value, details: &Value) {
    let Some(object) = game.as_object_mut() else {
        return;
    };

    let name = text(details.get("name"));
    if !name.is_empty() {
        let current_title = text(object.get("title"));
        if current_title.is_empty()
            || current_title
                .eq_ignore_ascii_case(&format!("Steam App {}", text(object.get("appId"))))
        {
            object.insert("title".to_string(), Value::String(name));
        }
    }

    merge_header_image(object, text(details.get("headerImage")));

    let screenshots = text_array(details.get("screenshots"), 8);
    if !screenshots.is_empty() {
        object.insert("screenshots".to_string(), Value::Array(screenshots));
    }

    let movies: Vec<Value> = details
        .get("movies")
        .and_then(|value| value.as_array())
        .map(|movies| movies.iter().filter_map(steam_store_movie).collect())
        .unwrap_or_default();
    if !movies.is_empty() {
        object.insert("movies".to_string(), Value::Array(movies));
    }

    let about_the_game = text(details.get("aboutTheGame"))
        .if_empty_then(|| text(details.get("about_the_game")));
    if !about_the_game.is_empty() {
        object.insert("aboutTheGame".to_string(), Value::String(about_the_game));
    }

    let short_description = text(details.get("shortDescription"))
        .if_empty_then(|| text(details.get("short_description")));
    if !short_description.is_empty() {
        object.insert(
            "shortDescription".to_string(),
            Value::String(short_description),
        );
    }

    if let Some(pc_requirements) = details
        .get("pcRequirements")
        .and_then(|value| value.as_object())
    {
        let minimum = text_array(pc_requirements.get("minimum"), usize::MAX);
        let recommended = text_array(pc_requirements.get("recommended"), usize::MAX);
        if !minimum.is_empty() || !recommended.is_empty() {
            object.insert(
                "pcRequirements".to_string(),
                serde_json::json!({
                    "minimum": minimum,
                    "recommended": recommended,
                }),
            );
        }
    }

    let genres = text_array(details.get("genres"), 6);
    if !genres.is_empty() {
        object.insert("genres".to_string(), Value::Array(genres));
    }

    for key in ["developers", "publishers"] {
        let values = text_array(details.get(key), usize::MAX);
        if !values.is_empty() {
            object.insert(key.to_string(), Value::Array(values));
        }
    }
}

fn steam_store_details_cache_path(app: &tauri::AppHandle, app_id: &str) -> Option<PathBuf> {
    if !app_id.chars().all(|character| character.is_ascii_digit()) {
        return None;
    }

    let directory = app
        .path()
        .app_data_dir()
        .ok()?
        .join("cache")
        .join("steam-store-details");
    Some(directory.join(format!("{app_id}.json")))
}

fn read_cached_steam_store_details(app: &tauri::AppHandle, app_id: &str) -> Option<Value> {
    let path = steam_store_details_cache_path(app, app_id)?;
    let contents = fs::read_to_string(path).ok()?;
    let cached = serde_json::from_str::<Value>(&contents).ok()?;
    if cached.get("version").and_then(|value| value.as_u64())
        != Some(STEAM_STORE_DETAILS_CACHE_VERSION)
    {
        return None;
    }
    cached.get("data").cloned()
}

fn cached_steam_store_details_is_fresh(app: &tauri::AppHandle, app_id: &str) -> bool {
    let Some(path) = steam_store_details_cache_path(app, app_id) else {
        return false;
    };
    let Ok(contents) = fs::read_to_string(path) else {
        return false;
    };
    let Ok(cached) = serde_json::from_str::<Value>(&contents) else {
        return false;
    };
    let Some(cached_at) = cached.get("cachedAt").and_then(|value| value.as_str()) else {
        return false;
    };
    let Ok(cached_at) = chrono::DateTime::parse_from_rfc3339(cached_at) else {
        return false;
    };
    chrono::Utc::now().signed_duration_since(cached_at.with_timezone(&chrono::Utc))
        < chrono::Duration::days(STEAM_STORE_DETAILS_CACHE_MAX_AGE_DAYS)
}

pub(crate) fn read_cached_steam_store_title(
    app: &tauri::AppHandle,
    app_id: &str,
) -> Option<String> {
    let details = read_cached_steam_store_details(app, app_id)?;
    let title = text(details.get("name"));
    (!title.is_empty()).then_some(title)
}

fn read_string_after_binary_key(section: &[u8], key: &[u8]) -> Option<String> {
    let key_index = section
        .windows(key.len())
        .position(|window| window == key)?;
    let value_start = key_index + key.len();
    let value_end = section[value_start..].iter().position(|byte| *byte == 0)?;
    let value = String::from_utf8_lossy(&section[value_start..value_start + value_end])
        .trim()
        .to_string();
    (!value.is_empty()).then_some(value)
}

fn write_cached_steam_store_details(app: &tauri::AppHandle, app_id: &str, details: &Value) {
    let Ok(_guard) = STEAM_STORE_DETAILS_CACHE_WRITE_LOCK.lock() else {
        return;
    };
    let Some(path) = steam_store_details_cache_path(app, app_id) else {
        return;
    };
    if let Some(parent) = path.parent() {
        if fs::create_dir_all(parent).is_err() {
            return;
        }
    }

    let previous = fs::read_to_string(&path)
        .ok()
        .and_then(|contents| serde_json::from_str::<Value>(&contents).ok())
        .and_then(|cached| cached.get("data").cloned());
    let merged_details = merge_cached_steam_store_details(previous.as_ref(), details);
    let body = serde_json::json!({
        "version": STEAM_STORE_DETAILS_CACHE_VERSION,
        "cachedAt": chrono::Utc::now().to_rfc3339(),
        "appId": app_id,
        "data": merged_details,
    });
    let Ok(contents) = serde_json::to_string(&body) else {
        return;
    };
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let temporary = path.with_extension(format!("{}.{}.tmp", std::process::id(), unique));
    if fs::write(&temporary, contents).is_err() {
        return;
    }
    if path.exists() && fs::remove_file(&path).is_err() {
        let _ = fs::remove_file(temporary);
        return;
    }
    if fs::rename(&temporary, &path).is_err() {
        let _ = fs::remove_file(temporary);
    }
}

fn merge_cached_steam_store_details(previous: Option<&Value>, next: &Value) -> Value {
    let mut merged = previous
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    let Some(next) = next.as_object() else {
        return Value::Object(merged);
    };

    for (key, value) in next {
        let has_value = match value {
            Value::Null => false,
            Value::String(value) => !value.trim().is_empty(),
            Value::Array(value) => !value.is_empty(),
            Value::Object(value) => !value.is_empty(),
            _ => true,
        };
        if has_value {
            let value = match (merged.get(key), value) {
                (Some(Value::Object(previous)), Value::Object(next)) => {
                    let mut nested = previous.clone();
                    for (nested_key, nested_value) in next {
                        let nested_has_value = match nested_value {
                            Value::Null => false,
                            Value::String(value) => !value.trim().is_empty(),
                            Value::Array(value) => !value.is_empty(),
                            Value::Object(value) => !value.is_empty(),
                            _ => true,
                        };
                        if nested_has_value {
                            nested.insert(nested_key.clone(), nested_value.clone());
                        }
                    }
                    Value::Object(nested)
                }
                _ => value.clone(),
            };
            merged.insert(key.clone(), value);
        }
    }
    Value::Object(merged)
}

fn steam_details_proxy_url(app_id: &str) -> Option<reqwest::Url> {
    if !app_id.chars().all(|character| character.is_ascii_digit()) {
        return None;
    }

    let base = std::env::var(STEAM_DETAILS_PROXY_URL_ENV)
        .or_else(|_| std::env::var(LEGACY_EDEN_STEAM_DETAILS_PROXY_URL_ENV))
        .or_else(|_| std::env::var(LEGACY_STEAM_DETAILS_PROXY_URL_ENV))
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_STEAM_DETAILS_PROXY_URL.to_string());
    let mut url = reqwest::Url::parse(&base).ok()?;
    let is_localhost = matches!(url.host_str(), Some("localhost" | "127.0.0.1"));
    if url.scheme() != "https" && !is_localhost {
        return None;
    }

    let base_path = url.path().trim_end_matches('/');
    url.set_path(&format!("{base_path}/v2/games/{app_id}/details"));
    url.query_pairs_mut()
        .clear()
        .append_pair("lang", "portuguese");
    Some(url)
}

async fn fetch_steam_details_proxy(app_id: &str) -> Option<Value> {
    let url = steam_details_proxy_url(app_id)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .ok()?;
    let details = client
        .get(url)
        .header(reqwest::header::USER_AGENT, STEAM_STORE_USER_AGENT)
        .header(reqwest::header::ACCEPT, "application/json,text/plain,*/*")
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json::<Value>()
        .await
        .ok()?;
    let response_app_id = text(details.get("appId"));
    if response_app_id != app_id {
        return None;
    }
    Some(details)
}

async fn fetch_steam_store_details(app_id: &str) -> Option<Value> {
    let url = format!(
        "https://store.steampowered.com/api/appdetails?appids={}&l=portuguese",
        app_id
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .ok()?;
    let response = client
        .get(url)
        .header(reqwest::header::USER_AGENT, STEAM_STORE_USER_AGENT)
        .header(reqwest::header::ACCEPT, "application/json,text/plain,*/*")
        .send()
        .await
        .ok()?
        .json::<Value>()
        .await
        .ok()?;
    let app = response.get(app_id)?;
    if !app
        .get("success")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        return None;
    }
    app.get("data").cloned()
}

fn steam_details_have_about(details: &Value) -> bool {
    !text(details.get("aboutTheGame"))
        .if_empty_then(|| text(details.get("about_the_game")))
        .is_empty()
}

fn steam_reviews_response_is_usable(value: &Value) -> bool {
    value.get("success").and_then(Value::as_i64) == Some(1)
        && value.get("reviews").and_then(Value::as_array).is_some()
}

fn steam_reviews_language(language: Option<String>) -> &'static str {
    match language.as_deref().map(str::trim) {
        Some("all") => "all",
        Some("english") => "english",
        Some("brazilian") => "brazilian",
        _ => "brazilian",
    }
}

fn steam_reviews_type(review_type: Option<String>) -> &'static str {
    match review_type.as_deref().map(str::trim) {
        Some("positive") => "positive",
        Some("negative") => "negative",
        _ => "all",
    }
}

async fn fetch_steam_game_reviews_from_proxy(
    proxy_url: &str,
    app_id: &str,
    language: &str,
    review_type: &str,
) -> Option<Value> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .ok()?;
    client
        .get(format!("{proxy_url}/steam/game-reviews"))
        .query(&[
            ("appId", app_id),
            ("language", language),
            ("reviewType", review_type),
        ])
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json::<Value>()
        .await
        .ok()
}

async fn fetch_steam_game_reviews_direct(
    app_id: &str,
    language: &str,
    review_type: &str,
) -> Option<Value> {
    let url = format!("https://store.steampowered.com/appreviews/{app_id}");
    let filter = if review_type == "all" { "recent" } else { "all" };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .ok()?;
    client
        .get(url)
        .query(&[
            ("json", "1"),
            ("language", language),
            ("filter", filter),
            ("num_per_page", "60"),
            ("review_type", review_type),
            ("purchase_type", "all"),
        ])
        .header(reqwest::header::USER_AGENT, STEAM_STORE_USER_AGENT)
        .header(reqwest::header::ACCEPT, "application/json,text/plain,*/*")
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json::<Value>()
        .await
        .ok()
}

fn normalize_achievement(achievement: &Value) -> Option<Value> {
    let name = text(achievement.get("name"));
    let title = text(achievement.get("displayName"))
        .if_empty_then(|| text(achievement.get("title")))
        .if_empty_then(|| name.clone());
    let icon = text(achievement.get("icon"));
    let icon_gray =
        text(achievement.get("icongray")).if_empty_then(|| text(achievement.get("iconGray")));
    // Local schema fallback may omit icons; keep name/title-only entries.
    if name.is_empty() || title.is_empty() {
        return None;
    }

    let mut obj = serde_json::json!({
        "name": name,
        "title": title,
        "description": text(achievement.get("description")),
        "icon": icon,
        "iconGray": icon_gray
    });

    if let Some(percent) = achievement.get("globalPercent").and_then(|v| v.as_f64()) {
        if percent >= 0.0 && percent <= 100.0 && percent.is_finite() {
            if let Some(obj) = obj.as_object_mut() {
                obj.insert("globalPercent".to_string(), serde_json::json!(percent));
            }
        }
    }

    Some(obj)
}

trait EmptyThen {
    fn if_empty_then(self, fallback: impl FnOnce() -> String) -> String;
}

impl EmptyThen for String {
    fn if_empty_then(self, fallback: impl FnOnce() -> String) -> String {
        if self.is_empty() {
            fallback()
        } else {
            self
        }
    }
}

async fn fetch_steam_achievements_from_proxy(
    proxy_url: &str,
    app_id: &str,
    language: &str,
) -> AchievementFetchResult {
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
    else {
        return AchievementFetchResult {
            status: "unavailable".to_string(),
            ..Default::default()
        };
    };
    let Ok(response) = client
        .get(format!("{proxy_url}/steam/game-schema"))
        .query(&[("appId", app_id), ("language", language)])
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
    else {
        return AchievementFetchResult {
            status: "unavailable".to_string(),
            ..Default::default()
        };
    };
    let retry_after = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    let status_code = response.status();
    let Ok(response) = response.error_for_status() else {
        return AchievementFetchResult {
            status: if status_code.as_u16() == 429 {
                "rate-limited".to_string()
            } else {
                "unavailable".to_string()
            },
            retry_after,
            ..Default::default()
        };
    };
    let Ok(value) = response.json::<Value>().await else {
        return AchievementFetchResult {
            status: "unavailable".to_string(),
            retry_after,
            ..Default::default()
        };
    };

    let achievements: Vec<Value> = value
        .get("achievements")
        .and_then(|achievements| achievements.as_array())
        .map(|achievements| {
            achievements
                .iter()
                .filter_map(normalize_achievement)
                .collect()
        })
        .unwrap_or_default();
    AchievementFetchResult {
        status: value
            .get("status")
            .and_then(|value| value.as_str())
            .unwrap_or(if achievements.is_empty() {
                "no-achievements"
            } else {
                "ready"
            })
            .to_string(),
        retry_after: value
            .get("retryAfter")
            .and_then(|value| value.as_u64())
            .or(retry_after),
        achievements,
    }
}

async fn fetch_steam_achievements(
    app: &tauri::AppHandle,
    app_id: &str,
    steam_path: &str,
) -> AchievementFetchResult {
    let proxy_url = crate::settings::load_steam_stats_proxy_url();
    if !proxy_url.is_empty() {
        // Prefer pt-BR, then European Portuguese, then English schema.
        let mut last_result = AchievementFetchResult::default();
        for language in ["brazilian", "portuguese", "english"] {
            let result =
                fetch_steam_achievements_from_proxy(&proxy_url, app_id, language).await;
            if !result.achievements.is_empty() {
                return result;
            }
            last_result = result;
            if matches!(last_result.status.as_str(), "rate-limited" | "unavailable") {
                break;
            }
        }
        if !last_result.status.is_empty() {
            return last_result;
        }
    }

    // Offline / proxy miss: local Steam schema only (no HTML community scrape).
    let _ = app;
    let achievements = crate::steam_appcache::read_local_achievement_definitions(steam_path, app_id);
    AchievementFetchResult {
        status: if achievements.is_empty() {
            "no-achievements".to_string()
        } else {
            "ready".to_string()
        },
        achievements,
        ..Default::default()
    }
}

fn merge_achievement_list(game: &mut Value, achievements: Vec<Value>) {
    if achievements.is_empty() {
        return;
    }

    if let Some(object) = game.as_object_mut() {
        let total = achievements.len();
        object.insert("achievementList".to_string(), Value::Array(achievements));
        object.insert(
            "achievements".to_string(),
            serde_json::json!({
                "unlocked": 0,
                "total": total,
                "progress": 0
            }),
        );
    }
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

fn steam_community_icon_url(app_id: &str, hash: &str) -> String {
    format!(
        "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/{app_id}/{hash}.ico"
    )
}

fn steam_community_image_url(app_id: &str, hash: &str, extension: &str) -> String {
    format!(
        "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/{app_id}/{hash}.{extension}"
    )
}

fn is_hex_icon_hash(hash: &str) -> bool {
    hash.len() >= 20 && hash.chars().all(|character| character.is_ascii_hexdigit())
}

fn is_steam_community_icon_url(app_id: &str, url: &str) -> bool {
    let url = url.trim();
    url.starts_with("https://")
        && url.contains(&format!("steamcommunity/public/images/apps/{app_id}/"))
        && (url.contains(".ico") || url.contains(".jpg") || url.contains(".png"))
}

fn is_local_icon_path(path: &str) -> bool {
    let path = path.trim();
    if path.is_empty() || path.starts_with("https://") || path.starts_with("http://") {
        return false;
    }
    let candidate = Path::new(path);
    candidate.is_absolute()
        && candidate
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| {
                matches!(
                    extension.to_ascii_lowercase().as_str(),
                    "ico" | "jpg" | "jpeg" | "png"
                )
            })
        && candidate.is_file()
}

fn is_cached_icon_source(app_id: &str, value: &str) -> bool {
    is_steam_community_icon_url(app_id, value) || is_local_icon_path(value)
}

fn steam_icon_url_cache_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    Some(
        app.path()
            .app_data_dir()
            .ok()?
            .join("steam-icon-url-cache.json"),
    )
}

fn steam_icon_url_memory() -> &'static Mutex<HashMap<String, String>> {
    STEAM_ICON_URL_MEMORY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn steam_icon_negative_cache() -> &'static Mutex<HashMap<String, Instant>> {
    STEAM_ICON_NEGATIVE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn steam_appinfo_bytes_cache() -> &'static Mutex<Option<AppinfoBytesCache>> {
    STEAM_APPINFO_BYTES_CACHE.get_or_init(|| Mutex::new(None))
}

fn remember_steam_icon_url(app_id: &str, icon_url: &str) {
    if let Ok(mut memory) = steam_icon_url_memory().lock() {
        memory.insert(app_id.to_string(), icon_url.to_string());
    }
    if let Ok(mut negative) = steam_icon_negative_cache().lock() {
        negative.remove(app_id);
    }
}

fn memory_steam_icon_url(app_id: &str) -> Option<String> {
    steam_icon_url_memory()
        .lock()
        .ok()
        .and_then(|memory| memory.get(app_id).cloned())
        .filter(|url| is_cached_icon_source(app_id, url))
}

fn mark_steam_icon_negative(app_id: &str) {
    if let Ok(mut negative) = steam_icon_negative_cache().lock() {
        negative.insert(app_id.to_string(), Instant::now());
    }
}

fn is_steam_icon_negative(app_id: &str) -> bool {
    let Ok(mut negative) = steam_icon_negative_cache().lock() else {
        return false;
    };
    let Some(stored_at) = negative.get(app_id).copied() else {
        return false;
    };
    if stored_at.elapsed() > Duration::from_secs(STEAM_ICON_NEGATIVE_CACHE_TTL_SECS) {
        negative.remove(app_id);
        return false;
    }
    true
}

fn read_steam_icon_url_cache(app: &tauri::AppHandle) -> HashMap<String, String> {
    if let Ok(memory) = steam_icon_url_memory().lock() {
        if !memory.is_empty() {
            return memory.clone();
        }
    }

    let Some(path) = steam_icon_url_cache_path(app) else {
        return HashMap::new();
    };

    let disk = fs::read_to_string(path)
        .ok()
        .and_then(|value| serde_json::from_str::<HashMap<String, String>>(&value).ok())
        .unwrap_or_default();

    if let Ok(mut memory) = steam_icon_url_memory().lock() {
        *memory = disk.clone();
    }

    disk
}

fn write_steam_icon_url_cache(app: &tauri::AppHandle, cache: &HashMap<String, String>) {
    if let Ok(mut memory) = steam_icon_url_memory().lock() {
        *memory = cache.clone();
    }

    let Some(path) = steam_icon_url_cache_path(app) else {
        return;
    };

    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let persistent = cache
        .iter()
        .filter(|(app_id, url)| is_cached_icon_source(app_id, url))
        .map(|(app_id, url)| (app_id.clone(), url.clone()))
        .collect::<HashMap<_, _>>();

    if let Ok(value) = serde_json::to_string(&persistent) {
        let _ = fs::write(path, value);
    }
}

fn cached_steam_icon_url(cache: &HashMap<String, String>, app_id: &str) -> Option<String> {
    let url = cache.get(app_id)?.trim();
    if is_cached_icon_source(app_id, url) {
        Some(url.to_string())
    } else {
        None
    }
}

fn read_client_icon_from_vdf(bytes: &[u8], app_id: &str) -> Option<String> {
    let app_id = app_id.parse::<u32>().ok()?;
    let app_id_bytes = app_id.to_le_bytes();
    let key = b"clienticon\0";
    let mut pos = 0usize;

    while pos + app_id_bytes.len() < bytes.len() {
        let Some(relative_index) = bytes[pos..]
            .windows(app_id_bytes.len())
            .position(|window| window == app_id_bytes)
        else {
            break;
        };
        let index = pos + relative_index;
        let section_end = (index + STEAM_APPINFO_ICON_SEARCH_WINDOW).min(bytes.len());
        let section = &bytes[index..section_end];

        if let Some(key_index) = section.windows(key.len()).position(|window| window == key) {
            let value_start = key_index + key.len();
            if let Some(value_end) = section[value_start..].iter().position(|byte| *byte == 0) {
                let hash = String::from_utf8_lossy(&section[value_start..value_start + value_end]);
                let hash = hash.trim();
                if is_hex_icon_hash(hash) {
                    return Some(hash.to_ascii_lowercase());
                }
            }
        }

        pos = index + app_id_bytes.len();
    }

    None
}

fn read_icon_hash_from_vdf(bytes: &[u8], app_id: &str, key: &[u8]) -> Option<String> {
    let app_id = app_id.parse::<u32>().ok()?;
    let app_id_bytes = app_id.to_le_bytes();
    let mut pos = 0usize;

    while pos + app_id_bytes.len() < bytes.len() {
        let Some(relative_index) = bytes[pos..]
            .windows(app_id_bytes.len())
            .position(|window| window == app_id_bytes)
        else {
            break;
        };
        let index = pos + relative_index;
        let section_end = (index + STEAM_APPINFO_ICON_SEARCH_WINDOW).min(bytes.len());
        let section = &bytes[index..section_end];

        if let Some(key_index) = section.windows(key.len()).position(|window| window == key) {
            let value_start = key_index + key.len();
            if let Some(value_end) = section[value_start..].iter().position(|byte| *byte == 0) {
                let hash = String::from_utf8_lossy(&section[value_start..value_start + value_end]);
                let hash = hash.trim();
                if is_hex_icon_hash(hash) {
                    return Some(hash.to_ascii_lowercase());
                }
            }
        }

        pos = index + app_id_bytes.len();
    }

    None
}

pub(crate) fn read_local_steam_app_title(app: &tauri::AppHandle, app_id: &str) -> Option<String> {
    let app_id_number = app_id.parse::<u32>().ok()?;
    let app_id_bytes = app_id_number.to_le_bytes();
    let (steam_path, _) = crate::resolve_steam_path(app, None);
    let steam_path = steam_path?;
    let vdf_path = std::path::Path::new(&steam_path)
        .join("appcache")
        .join("appinfo.vdf");
    let bytes = fs::read(vdf_path).ok()?;
    let mut pos = 0usize;

    while pos + app_id_bytes.len() < bytes.len() {
        let Some(relative_index) = bytes[pos..]
            .windows(app_id_bytes.len())
            .position(|window| window == app_id_bytes)
        else {
            break;
        };
        let index = pos + relative_index;
        let section_end = (index + 8192).min(bytes.len());
        let section = &bytes[index..section_end];

        if let Some(title) = read_string_after_binary_key(section, b"name\0") {
            return Some(title);
        }

        pos = index + app_id_bytes.len();
    }

    None
}

fn load_appinfo_bytes(app: &tauri::AppHandle) -> Option<Arc<Vec<u8>>> {
    let (steam_path, _) = crate::resolve_steam_path(app, None);
    let steam_path = steam_path?;
    let vdf_path = Path::new(&steam_path).join("appcache").join("appinfo.vdf");
    let metadata = fs::metadata(&vdf_path).ok()?;
    let modified = metadata.modified().ok()?;

    if let Ok(mut cache) = steam_appinfo_bytes_cache().lock() {
        if let Some(existing) = cache.as_ref() {
            if existing.path == vdf_path && existing.modified == modified {
                return Some(existing.bytes.clone());
            }
        }

        let bytes = Arc::new(fs::read(&vdf_path).ok()?);
        *cache = Some(AppinfoBytesCache {
            path: vdf_path,
            modified,
            bytes: Arc::clone(&bytes),
        });
        return Some(bytes);
    }

    Some(Arc::new(fs::read(vdf_path).ok()?))
}

fn get_game_icons_from_local_appinfo(
    app: &tauri::AppHandle,
    app_ids: &[String],
) -> HashMap<String, String> {
    let Some(bytes) = load_appinfo_bytes(app) else {
        return HashMap::new();
    };

    app_ids
        .iter()
        .filter_map(|app_id| {
            if let Some(hash) = read_client_icon_from_vdf(&bytes, app_id) {
                return Some((app_id.clone(), steam_community_icon_url(app_id, &hash)));
            }
            read_icon_hash_from_vdf(&bytes, app_id, b"icon\0")
                .map(|hash| (app_id.clone(), steam_community_image_url(app_id, &hash, "jpg")))
        })
        .collect()
}

fn get_game_icon_from_local_files(app: &tauri::AppHandle, app_id: &str) -> Option<String> {
    let (steam_path, _) = crate::resolve_steam_path(app, None);
    let steam_path = steam_path?;
    let steam_root = Path::new(&steam_path);
    let candidates = [
        steam_root.join("steam").join("games").join(format!("{app_id}.ico")),
        steam_root
            .join("appcache")
            .join("librarycache")
            .join(app_id)
            .join("icon.jpg"),
        steam_root
            .join("appcache")
            .join("librarycache")
            .join(app_id)
            .join("icon.png"),
        steam_root
            .join("appcache")
            .join("librarycache")
            .join(format!("{app_id}_icon.jpg")),
        steam_root
            .join("appcache")
            .join("librarycache")
            .join(format!("{app_id}_icon.png")),
    ];

    candidates
        .into_iter()
        .find(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned())
}

fn get_game_icons_from_local_files(
    app: &tauri::AppHandle,
    app_ids: &[String],
) -> HashMap<String, String> {
    app_ids
        .iter()
        .filter_map(|app_id| {
            get_game_icon_from_local_files(app, app_id).map(|path| (app_id.clone(), path))
        })
        .collect()
}

fn steamcmd_candidates(app: &tauri::AppHandle) -> Vec<PathBuf> {
    use tauri::Manager;

    let mut candidates = Vec::new();
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        candidates.push(app_data_dir.join("steamcmd").join("steamcmd.exe"));
    }
    if let Some(app_data) = std::env::var_os("APPDATA") {
        let app_data = PathBuf::from(app_data);
        candidates.push(
            app_data
                .join("GhostBox")
                .join("steamcmd")
                .join("steamcmd.exe"),
        );
        candidates.push(app_data.join("Eden").join("steamcmd").join("steamcmd.exe"));
        candidates.push(
            app_data
                .join("piratebox")
                .join("steamcmd")
                .join("steamcmd.exe"),
        );
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(
            resource_dir
                .join("tools")
                .join("steamcmd")
                .join("steamcmd.exe"),
        );
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            candidates.push(exe_dir.join("tools").join("steamcmd").join("steamcmd.exe"));
        }
    }
    candidates.push(PathBuf::from("tools").join("steamcmd").join("steamcmd.exe"));

    candidates
}

fn steamcmd_install_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    Some(app.path().app_data_dir().ok()?.join("steamcmd"))
}

fn installed_steamcmd_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    steamcmd_candidates(app)
        .into_iter()
        .find(|candidate| candidate.exists())
}

async fn install_steamcmd(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = installed_steamcmd_path(app) {
        return Ok(path);
    }

    let install_dir = steamcmd_install_dir(app)
        .ok_or_else(|| "Não foi possível localizar o AppData do GhostBox.".to_string())?;
    fs::create_dir_all(&install_dir).map_err(|error| error.to_string())?;

    let bytes = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|error| error.to_string())?
        .get(STEAMCMD_DOWNLOAD_URL)
        .header(reqwest::header::USER_AGENT, STEAM_STORE_USER_AGENT)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .bytes()
        .await
        .map_err(|error| error.to_string())?;

    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes.to_vec())).map_err(|error| error.to_string())?;
    let mut found = false;
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|error| error.to_string())?;
        let Some(name) = file.enclosed_name().map(|path| path.to_path_buf()) else {
            continue;
        };
        if !name
            .file_name()
            .and_then(|file_name| file_name.to_str())
            .is_some_and(|file_name| file_name.eq_ignore_ascii_case("steamcmd.exe"))
        {
            continue;
        }

        let target = install_dir.join("steamcmd.exe");
        let mut output = fs::File::create(&target).map_err(|error| error.to_string())?;
        std::io::copy(&mut file, &mut output).map_err(|error| error.to_string())?;
        found = true;
        break;
    }

    if !found {
        return Err("O pacote baixado não continha steamcmd.exe.".to_string());
    }

    Ok(install_dir.join("steamcmd.exe"))
}

/// Ícone via manifesto da `GetItems`. Sai da mesma chamada que resolve as capas,
/// então não custa request extra quando o manifesto já foi buscado. É um JPG
/// 32×32 sem alfa — pior que o `.ico` do `clienticon`, mas resolve sem exigir
/// Steam instalado.
async fn resolve_missing_game_icon_urls_from_manifest(
    app: &tauri::AppHandle,
    missing: &[String],
) -> HashMap<String, String> {
    if missing.is_empty() {
        return HashMap::new();
    }

    let pending = missing
        .iter()
        .filter(|app_id| !is_steam_icon_negative(app_id))
        .cloned()
        .collect::<Vec<_>>();

    if pending.is_empty() {
        return HashMap::new();
    }

    let mut resolved = crate::steam_assets::community_icon_urls(app, &pending).await;
    resolved.retain(|app_id, icon_url| is_cached_icon_source(app_id, icon_url));

    for (app_id, icon_url) in &resolved {
        remember_steam_icon_url(app_id, icon_url);
    }
    for app_id in pending {
        if !resolved.contains_key(&app_id) {
            mark_steam_icon_negative(&app_id);
        }
    }

    if !resolved.is_empty() {
        let _ = app.emit(GAME_ICON_URLS_RESOLVED_EVENT, resolved.clone());
    }

    resolved
}

fn normalize_game_icon_app_ids(app_ids: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    app_ids
        .into_iter()
        .map(|app_id| {
            app_id
                .chars()
                .filter(char::is_ascii_digit)
                .collect::<String>()
        })
        .filter(|app_id| !app_id.is_empty() && seen.insert(app_id.clone()))
        .collect()
}

fn resolve_local_game_icon_urls(
    app: &tauri::AppHandle,
    app_ids: &[String],
) -> HashMap<String, String> {
    let mut resolved = HashMap::new();
    let mut missing = Vec::new();

    for app_id in app_ids {
        if let Some(icon_url) = memory_steam_icon_url(app_id) {
            resolved.insert(app_id.clone(), icon_url);
        } else {
            missing.push(app_id.clone());
        }
    }
    if missing.is_empty() {
        return resolved;
    }

    let mut cache = read_steam_icon_url_cache(app);
    missing.retain(|app_id| {
        if let Some(icon_url) = cached_steam_icon_url(&cache, app_id) {
            remember_steam_icon_url(app_id, &icon_url);
            resolved.insert(app_id.clone(), icon_url);
            false
        } else {
            true
        }
    });

    for (app_id, icon_url) in get_game_icons_from_local_appinfo(app, &missing) {
        remember_steam_icon_url(&app_id, &icon_url);
        cache.insert(app_id.clone(), icon_url.clone());
        resolved.insert(app_id, icon_url);
    }
    missing.retain(|app_id| !resolved.contains_key(app_id));

    for (app_id, icon_url) in get_game_icons_from_local_files(app, &missing) {
        remember_steam_icon_url(&app_id, &icon_url);
        cache.insert(app_id.clone(), icon_url.clone());
        resolved.insert(app_id, icon_url);
    }

    write_steam_icon_url_cache(app, &cache);
    resolved
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
        "name": "GhostBox Tauri",
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

    let query = get_string(&request, "query");
    if let Some(query) = query.as_ref() {
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
    let sort = get_string(&request, "sort");
    if let Some(sort) = sort.as_ref() {
        url.query_pairs_mut().append_pair("sort", &sort);
    }
    if get_string(&request, "match").as_deref() == Some("any") {
        url.query_pairs_mut().append_pair("match", "any");
    }
    // The rotation seed must ride on the URL: it is what makes the disk cache
    // key roll over with the period instead of serving a stale day's order.
    if let Some(seed) = get_u64(&request, "seed") {
        url.query_pairs_mut().append_pair("seed", &seed.to_string());
    }

    append_filter_params(&mut url, &request, "genres");
    append_filter_params(&mut url, &request, "tags");
    append_filter_params(&mut url, &request, "developers");
    append_filter_params(&mut url, &request, "publishers");
    append_filter_params(&mut url, &request, "years");

    // Text searches must see games ingested during this session immediately.
    // The disk cache remains available as an offline fallback if the request fails.
    let force_refresh = query.is_some() || sort.as_deref() == Some("recentlyAdded");
    match catalogue_cache::fetch_json_with_cache(&app, url, force_refresh).await {
        Ok((mut value, updated_at, from_cache)) => {
            catalogue_cache::prepare_cached_response(&mut value, updated_at, from_cache);
            Ok(value)
        }
        // Um catálogo vazio é indistinguível de "nenhum resultado" na UI. O
        // fallback offline já acontece dentro de `fetch_json_with_cache` (stale
        // cache); chegar aqui significa que não há nada utilizável.
        Err(error) => Err(error),
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
    let app_id: String = game_id.chars().filter(char::is_ascii_digit).collect();
    if app_id.is_empty() {
        return Ok(None);
    }

    let mut game = fetch_remote_game(&app, game_id, api_url)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| steam_app_fallback_game(&app_id));

    let latest_cached_details = read_cached_steam_store_details(&app, &app_id);
    if let Some(cached_details) = latest_cached_details.as_ref() {
        merge_normalized_steam_details(&mut game, cached_details);
        if cached_steam_store_details_is_fresh(&app, &app_id)
            && steam_details_have_about(cached_details)
        {
            return Ok(Some(game));
        }
    }

    if let Some(proxy_details) = fetch_steam_details_proxy(&app_id).await {
        let merged_details =
            merge_cached_steam_store_details(latest_cached_details.as_ref(), &proxy_details);
        merge_normalized_steam_details(&mut game, &merged_details);
        write_cached_steam_store_details(&app, &app_id, &merged_details);
        if steam_details_have_about(&merged_details) {
            return Ok(Some(game));
        }
    }

    // The details proxy can be online while omitting the description fields. Only
    // fall back to Steam's JSON endpoint when the data required by the UI is absent.
    if let Some(store_data) = fetch_steam_store_details(&app_id).await {
        let store_details = steam_store_details_from_store_data(&store_data);
        merge_steam_store_details(&mut game, &store_data);
        let merged_details =
            merge_cached_steam_store_details(latest_cached_details.as_ref(), &store_details);
        write_cached_steam_store_details(&app, &app_id, &merged_details);
    }

    Ok(Some(game))
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

    let mut game = fetch_remote_game(&app, game_id, api_url)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| steam_app_fallback_game(&app_id));

    let (steam_path, _) = crate::resolve_steam_path(&app, None);
    let steam_path = steam_path.as_deref().unwrap_or_default();

    let achievement_list = game
        .get("achievementList")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    let has_percentages = achievement_list.iter().any(|ach| ach.get("globalPercent").is_some());
    let previous_fetch_time = game
        .get("achievementMetadata")
        .and_then(|meta| meta.get("fetchedAt"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    let should_refetch_for_percentages = !has_percentages
        && !achievement_list.is_empty()
        && now.saturating_sub(previous_fetch_time) > 24 * 60 * 60;

    if achievement_list.is_empty() || should_refetch_for_percentages {
        let achievement_result = fetch_steam_achievements(&app, &app_id, steam_path).await;
        if let Some(object) = game.as_object_mut() {
            object.insert(
                "achievementMetadata".to_string(),
                serde_json::json!({
                    "status": achievement_result.status,
                    "retryAfter": achievement_result.retry_after,
                    "source": "steam-schema",
                    "fetchedAt": now,
                }),
            );
        }
        merge_achievement_list(&mut game, achievement_result.achievements);
    }

    Ok(Some(crate::merge_game_achievement_details(
        &app, game, steam_path,
    )))
}

#[tauri::command]
pub async fn database_get_game_reviews(
    game_id: String,
    language: Option<String>,
    review_type: Option<String>,
) -> Result<serde_json::Value, String> {
    let app_id: String = game_id.chars().filter(char::is_ascii_digit).collect();
    if app_id.is_empty() {
        return Ok(serde_json::json!({ "success": 0, "reviews": [] }));
    }

    let language = steam_reviews_language(language);
    let review_type = steam_reviews_type(review_type);
    let proxy_url = crate::settings::load_steam_stats_proxy_url();
    if proxy_url.is_empty() {
        return Ok(serde_json::json!({ "success": 0, "reviews": [] }));
    }

    let proxy_result =
        fetch_steam_game_reviews_from_proxy(&proxy_url, &app_id, language, review_type).await;
    if let Some(result) = proxy_result.as_ref() {
        if steam_reviews_response_is_usable(result) {
            return Ok(result.clone());
        }
    }

    if let Some(result) = fetch_steam_game_reviews_direct(&app_id, language, review_type).await {
        if steam_reviews_response_is_usable(&result) {
            return Ok(result);
        }
    }

    Ok(proxy_result.unwrap_or_else(|| serde_json::json!({ "success": 0, "reviews": [] })))
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
pub async fn steam_get_game_icon_url(app: tauri::AppHandle, app_id: String) -> Option<String> {
    let app_id: String = app_id.chars().filter(char::is_ascii_digit).collect();
    if app_id.is_empty() {
        return None;
    }

    steam_get_game_icon_urls(app, vec![app_id])
        .await
        .into_values()
        .next()
}

#[tauri::command]
pub async fn steam_get_game_icon_urls(
    app: tauri::AppHandle,
    app_ids: Vec<String>,
) -> HashMap<String, String> {
    let app_ids = normalize_game_icon_app_ids(app_ids);
    if app_ids.is_empty() {
        return HashMap::new();
    }

    // `resolve_local_game_icon_urls` varre o `appinfo.vdf` inteiro; num `async
    // fn` ela bloquearia um worker do Tokio.
    let mut resolved = {
        let app = app.clone();
        let app_ids = app_ids.clone();
        tauri::async_runtime::spawn_blocking(move || resolve_local_game_icon_urls(&app, &app_ids))
            .await
            .unwrap_or_default()
    };
    let mut cache = read_steam_icon_url_cache(&app);
    let still_missing = app_ids
        .iter()
        .filter(|app_id| !resolved.contains_key(*app_id))
        .cloned()
        .collect::<Vec<_>>();
    if still_missing.is_empty() {
        return resolved;
    }

    let fetched = resolve_missing_game_icon_urls_from_manifest(&app, &still_missing).await;
    for (app_id, icon_url) in fetched {
        cache.insert(app_id.clone(), icon_url.clone());
        resolved.insert(app_id, icon_url);
    }

    write_steam_icon_url_cache(&app, &cache);
    resolved
}

/// Sai da thread principal de propósito: resolver ícones locais lê o
/// `appinfo.vdf` inteiro (dezenas de MB) e o varre por appId. Como comando
/// síncrono, isso travava a UI a cada lote da viewport.
#[tauri::command]
pub async fn steam_get_local_game_icon_urls(
    app: tauri::AppHandle,
    app_ids: Vec<String>,
) -> HashMap<String, String> {
    let app_ids = normalize_game_icon_app_ids(app_ids);
    tauri::async_runtime::spawn_blocking(move || resolve_local_game_icon_urls(&app, &app_ids))
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn steam_resolve_game_icon_urls(
    app: tauri::AppHandle,
    app_ids: Vec<String>,
) -> HashMap<String, String> {
    let app_ids = normalize_game_icon_app_ids(app_ids);
    let mut resolved = HashMap::new();
    let missing = app_ids
        .into_iter()
        .filter(|app_id| {
            if let Some(icon_url) = memory_steam_icon_url(app_id) {
                resolved.insert(app_id.clone(), icon_url);
                false
            } else {
                true
            }
        })
        .collect::<Vec<_>>();

    let fetched = resolve_missing_game_icon_urls_from_manifest(&app, &missing).await;
    let mut cache = read_steam_icon_url_cache(&app);
    for (app_id, icon_url) in fetched {
        cache.insert(app_id.clone(), icon_url.clone());
        resolved.insert(app_id, icon_url);
    }
    write_steam_icon_url_cache(&app, &cache);
    resolved
}

#[tauri::command]
pub fn app_is_steamtools_installed(app: tauri::AppHandle) -> bool {
    installed_steamcmd_path(&app).is_some()
}

#[tauri::command]
pub async fn app_install_steamtools(app: tauri::AppHandle) -> serde_json::Value {
    match install_steamcmd(&app).await {
        Ok(path) => serde_json::json!({
            "success": true,
            "path": path.to_string_lossy()
        }),
        Err(error) => serde_json::json!({
            "success": false,
            "error": error
        }),
    }
}

#[tauri::command]
pub async fn cache_get_image(app: tauri::AppHandle, url: String) -> String {
    image_cache::cache_image_url(&app, &url).await
}

#[tauri::command]
pub async fn cache_resolve_steam_library_asset(
    app: tauri::AppHandle,
    app_id: String,
    file_name: String,
) -> String {
    image_cache::resolve_steam_library_asset_url(&app, &app_id, &file_name).await
}

#[cfg(test)]
mod tests {
    use super::{
        is_cached_icon_source, merge_cached_steam_store_details, read_client_icon_from_vdf,
        steam_details_have_about, steam_reviews_response_is_usable,
    };

    #[test]
    fn store_details_merge_preserves_existing_media_and_nested_requirements() {
        let previous = serde_json::json!({
            "movies": [{ "name": "Trailer" }],
            "pcRequirements": { "minimum": ["Windows 10"] }
        });
        let next = serde_json::json!({
            "aboutTheGame": "Updated description",
            "movies": [],
            "pcRequirements": { "recommended": ["Windows 11"] }
        });

        let merged = merge_cached_steam_store_details(Some(&previous), &next);
        assert_eq!(merged["movies"], previous["movies"]);
        assert_eq!(merged["aboutTheGame"], "Updated description");
        assert_eq!(merged["pcRequirements"]["minimum"], previous["pcRequirements"]["minimum"]);
        assert_eq!(
            merged["pcRequirements"]["recommended"],
            next["pcRequirements"]["recommended"]
        );
    }

    #[test]
    fn incomplete_proxy_details_require_store_fallback() {
        assert!(!steam_details_have_about(&serde_json::json!({
            "name": "Counter-Strike 2",
            "screenshots": []
        })));
        assert!(steam_details_have_about(&serde_json::json!({
            "aboutTheGame": "A description"
        })));
        assert!(steam_details_have_about(&serde_json::json!({
            "about_the_game": "A description"
        })));
    }

    #[test]
    fn unsuccessful_review_proxy_response_requires_fallback() {
        assert!(!steam_reviews_response_is_usable(&serde_json::json!({
            "success": 0,
            "reviews": []
        })));
        assert!(steam_reviews_response_is_usable(&serde_json::json!({
            "success": 1,
            "reviews": []
        })));
    }

    #[test]
    fn appinfo_icon_reader_finds_clienticon_beyond_small_window() {
        let app_id = 2_138_720u32;
        let hash = "1234567890abcdef1234567890abcdef12345678";
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&app_id.to_le_bytes());
        bytes.extend(std::iter::repeat(b'x').take(20_000));
        bytes.extend_from_slice(b"clienticon\0");
        bytes.extend_from_slice(hash.as_bytes());
        bytes.push(0);

        assert_eq!(read_client_icon_from_vdf(&bytes, "2138720"), Some(hash.to_string()));
    }

    #[test]
    fn community_icon_hash_only_resolves_as_jpg() {
        // O hash de `community_icon` (GetItems) e o de `clienticon` (appinfo.vdf)
        // são namespaces diferentes: o primeiro só existe como .jpg, o segundo
        // só como .ico. Trocar a extensão dá 404 no CDN.
        let hash = "4cc8c99722309845b2c4775902ace66f468303ec";
        assert!(is_cached_icon_source(
            "3602290",
            &format!("https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/3602290/{hash}.jpg")
        ));
        assert!(!is_cached_icon_source("3602290", &format!("https://example.com/{hash}.jpg")));
    }
}
