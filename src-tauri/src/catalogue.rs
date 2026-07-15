use crate::catalogue_cache;
use crate::image_cache;
use crate::util::{silent_steamcmd_output, with_steamcmd_lock};
use crate::{FACETS_VERSION, RANKING_VERSION};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use tauri::Manager;

const STEAM_STORE_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
const STEAM_STORE_DETAILS_CACHE_VERSION: u64 = 2;
const DEFAULT_STEAM_DETAILS_PROXY_URL: &str = "https://piratebox-steam-details.hella.workers.dev";
const STEAM_DETAILS_PROXY_URL_ENV: &str = "GHOSTBOX_STEAM_DETAILS_PROXY_URL";
const LEGACY_EDEN_STEAM_DETAILS_PROXY_URL_ENV: &str = "EDEN_STEAM_DETAILS_PROXY_URL";
const LEGACY_STEAM_DETAILS_PROXY_URL_ENV: &str = "PIRATEBOX_STEAM_DETAILS_PROXY_URL";

fn text(value: Option<&Value>) -> String {
    value
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_default()
}

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

fn is_steam_app_title_placeholder(title: &str, app_id: &str) -> bool {
    let title = title.trim();
    title.is_empty()
        || title.eq_ignore_ascii_case(&format!("Steam App {app_id}"))
        || title.eq_ignore_ascii_case(&format!("Steam {app_id}"))
}

fn set_game_title(game: &mut Value, title: String) {
    if let Some(object) = game.as_object_mut() {
        object.insert("title".to_string(), Value::String(title));
    }
}

fn extract_between(value: &str, start: &str, end: &str) -> Option<String> {
    let start_index = value.find(start)? + start.len();
    let after_start = &value[start_index..];
    let end_index = after_start.find(end)?;
    Some(after_start[..end_index].to_string())
}

fn extract_steam_store_page_title(html: &str) -> Option<String> {
    let apphub_title = extract_between(html, "<div class=\"apphub_AppName\">", "</div>")
        .or_else(|| extract_between(html, "<div class='apphub_AppName'>", "</div>"));
    let raw_title = apphub_title.or_else(|| extract_between(html, "<title>", "</title>"))?;
    let title = strip_html(&raw_title)
        .replace(" on Steam", "")
        .replace(" no Steam", "")
        .trim()
        .to_string();

    (!title.is_empty()).then_some(title)
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

    let about_the_game = text(details.get("aboutTheGame"));
    if !about_the_game.is_empty() {
        object.insert("aboutTheGame".to_string(), Value::String(about_the_game));
    }

    let short_description = text(details.get("shortDescription"));
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
    let Some(path) = steam_store_details_cache_path(app, app_id) else {
        return;
    };
    if let Some(parent) = path.parent() {
        if fs::create_dir_all(parent).is_err() {
            return;
        }
    }

    let body = serde_json::json!({
        "version": STEAM_STORE_DETAILS_CACHE_VERSION,
        "cachedAt": chrono::Utc::now().to_rfc3339(),
        "appId": app_id,
        "data": details,
    });
    let Ok(contents) = serde_json::to_string(&body) else {
        return;
    };
    let _ = fs::write(path, contents);
}

fn has_steam_store_movies(details: &Value) -> bool {
    details
        .get("movies")
        .and_then(|value| value.as_array())
        .map(|movies| {
            movies
                .iter()
                .any(|movie| steam_store_movie(movie).is_some())
        })
        .unwrap_or(false)
}

fn has_steam_store_about(details: &Value) -> bool {
    !text(details.get("aboutTheGame")).is_empty()
}

fn has_complete_steam_store_details(details: &Value) -> bool {
    has_steam_store_movies(details) && has_steam_store_about(details)
}

fn should_write_steam_store_details_cache(next: &Value, previous: Option<&Value>) -> bool {
    let next_has_movies = has_steam_store_movies(next);
    let next_has_about = has_steam_store_about(next);

    previous
        .map(|previous| {
            (next_has_movies && !has_steam_store_movies(previous))
                || (next_has_about && !has_steam_store_about(previous))
        })
        .unwrap_or(next_has_movies || next_has_about)
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
    url.set_path(&format!("{base_path}/games/{app_id}/details"));
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
    if !response_app_id.is_empty() && response_app_id != app_id {
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

async fn fetch_steam_store_page_title(app_id: &str) -> Option<String> {
    let url = format!("https://store.steampowered.com/app/{app_id}/?l=portuguese&cc=br");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .ok()?;
    let html = client
        .get(url)
        .header(reqwest::header::USER_AGENT, STEAM_STORE_USER_AGENT)
        .header(reqwest::header::ACCEPT, "text/html,*/*")
        .header(
            reqwest::header::COOKIE,
            "birthtime=568022401; lastagecheckage=1-January-1988",
        )
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .text()
        .await
        .ok()?;

    extract_steam_store_page_title(&html)
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

async fn fetch_steam_game_reviews(
    app_id: &str,
    language: &str,
    review_type: &str,
    filter: &str,
    purchase_type: &str,
) -> Option<Value> {
    let mut url = reqwest::Url::parse(&format!(
        "https://store.steampowered.com/appreviews/{app_id}"
    ))
    .ok()?;
    url.query_pairs_mut()
        .append_pair("json", "1")
        .append_pair("language", language)
        .append_pair("filter", filter)
        .append_pair("num_per_page", "60")
        .append_pair("review_type", review_type)
        .append_pair("purchase_type", purchase_type);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .ok()?;

    client
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
        .ok()
}

fn steam_reviews_empty(value: &Value) -> bool {
    value
        .get("reviews")
        .and_then(|reviews| reviews.as_array())
        .map(|reviews| reviews.is_empty())
        .unwrap_or(true)
}

fn steam_reviews_has_summary(value: &Value) -> bool {
    value
        .get("query_summary")
        .and_then(|summary| summary.as_object())
        .is_some_and(|summary| {
            summary
                .get("total_reviews")
                .or_else(|| summary.get("num_reviews"))
                .and_then(|value| value.as_u64())
                .is_some_and(|count| count > 0)
        })
}

async fn fetch_steam_game_reviews_with_fallbacks(
    app_id: &str,
    language: &str,
    review_type: &str,
) -> Option<Value> {
    let primary_filter = if review_type == "all" {
        "recent"
    } else {
        "all"
    };
    let mut best =
        fetch_steam_game_reviews(app_id, language, review_type, primary_filter, "steam").await;
    if best
        .as_ref()
        .is_some_and(|value| !steam_reviews_empty(value) || steam_reviews_has_summary(value))
    {
        return best;
    }

    let fallback_attempts = if review_type == "all" {
        vec![
            (language, "recent", "all"),
            (language, "updated", "steam"),
            ("all", "recent", "steam"),
            ("all", "recent", "all"),
        ]
    } else {
        vec![
            (language, "all", "all"),
            ("all", "all", "steam"),
            ("all", "all", "all"),
        ]
    };

    for (fallback_language, fallback_filter, fallback_purchase_type) in fallback_attempts {
        let result = fetch_steam_game_reviews(
            app_id,
            fallback_language,
            review_type,
            fallback_filter,
            fallback_purchase_type,
        )
        .await;

        if result
            .as_ref()
            .is_some_and(|value| !steam_reviews_empty(value) || steam_reviews_has_summary(value))
        {
            return result;
        }

        if best.is_none() {
            best = result;
        }
    }

    best
}

async fn fetch_steam_review_histogram(app_id: &str) -> Option<Value> {
    let mut url = reqwest::Url::parse(&format!(
        "https://store.steampowered.com/appreviewhistogram/{app_id}"
    ))
    .ok()?;
    url.query_pairs_mut()
        .append_pair("json", "1")
        .append_pair("l", "portuguese");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .ok()?;

    let histogram = client
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

    if histogram.get("success").and_then(|value| value.as_u64()) != Some(1) {
        return None;
    }

    histogram.get("results").cloned()
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
    Some(serde_json::json!({
        "name": name,
        "title": title,
        "description": text(achievement.get("description")),
        "icon": icon,
        "iconGray": icon_gray
    }))
}

fn between(value: &str, start: &str, end: &str) -> String {
    let Some(start_index) = value.find(start) else {
        return String::new();
    };
    let content_start = start_index + start.len();
    let Some(end_index) = value[content_start..].find(end) else {
        return String::new();
    };
    html_decode(value[content_start..content_start + end_index].trim())
}

fn attribute_value(value: &str, attribute: &str) -> String {
    for quote in ['"', '\''] {
        let marker = format!("{attribute}={quote}");
        let Some(start_index) = value.find(&marker) else {
            continue;
        };
        let content_start = start_index + marker.len();
        let Some(end_index) = value[content_start..].find(quote) else {
            continue;
        };
        return html_decode(value[content_start..content_start + end_index].trim());
    }
    String::new()
}

fn parse_community_achievements(html: &str) -> Vec<Value> {
    html.split("achieveRow")
        .skip(1)
        .filter_map(|row| {
            let img_start = row.find("<img")?;
            let img_end = row[img_start..].find('>').map(|index| img_start + index)?;
            let icon = attribute_value(&row[img_start..=img_end], "src");
            let title = between(row, "<h3>", "</h3>");
            let description = between(row, "<h5>", "</h5>");
            let percent = between(row, "<div class=\"achievePercent\">", "</div>")
                .trim_end_matches('%')
                .trim()
                .parse::<f64>()
                .ok();

            if title.is_empty() || icon.is_empty() {
                return None;
            }

            let mut achievement = serde_json::json!({
                "name": title,
                "title": title,
                "description": description,
                "icon": icon,
                "iconGray": icon
            });
            if let Some(percent) = percent {
                achievement["globalPercent"] = serde_json::json!(percent);
            }
            Some(achievement)
        })
        .collect()
}

async fn fetch_steam_achievements_from_community(app_id: &str) -> Vec<Value> {
    for language in ["brazilian", "english"] {
        let url = format!(
            "https://steamcommunity.com/stats/{}/achievements/?l={}",
            app_id, language
        );
        let Ok(response) = reqwest::get(url).await else {
            continue;
        };
        let Ok(html) = response.text().await else {
            continue;
        };
        let achievements = parse_community_achievements(&html);
        if !achievements.is_empty() {
            return achievements;
        }
    }
    Vec::new()
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

async fn fetch_steam_achievements_from_schema(app_id: &str, api_key: &str) -> Vec<Value> {
    if api_key.is_empty() {
        return Vec::new();
    }

    let Ok(mut url) =
        reqwest::Url::parse("https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/")
    else {
        return Vec::new();
    };
    url.query_pairs_mut()
        .append_pair("key", api_key)
        .append_pair("appid", app_id)
        .append_pair("l", "portuguese");

    let Ok(response) = reqwest::get(url).await else {
        return Vec::new();
    };
    let Ok(value) = response.json::<Value>().await else {
        return Vec::new();
    };

    value
        .get("game")
        .and_then(|game| game.get("availableGameStats"))
        .and_then(|stats| stats.get("achievements"))
        .and_then(|achievements| achievements.as_array())
        .map(|achievements| {
            achievements
                .iter()
                .filter_map(normalize_achievement)
                .collect()
        })
        .unwrap_or_default()
}

async fn fetch_steam_achievements(
    app: &tauri::AppHandle,
    app_id: &str,
    steam_path: &str,
) -> Vec<Value> {
    let api_key = crate::settings::load_steam_web_api_key(app);
    let schema_achievements = fetch_steam_achievements_from_schema(app_id, &api_key).await;
    if !schema_achievements.is_empty() {
        return schema_achievements;
    }

    let community_achievements = fetch_steam_achievements_from_community(app_id).await;
    if !community_achievements.is_empty() {
        return community_achievements;
    }

    // Offline / blocked network: build a basic list from local Steam schema.
    crate::steam_appcache::read_local_achievement_definitions(steam_path, app_id)
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

fn steam_icon_url_cache_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    Some(
        app.path()
            .app_data_dir()
            .ok()?
            .join("steam-icon-url-cache.json"),
    )
}

fn read_steam_icon_url_cache(app: &tauri::AppHandle) -> HashMap<String, String> {
    let Some(path) = steam_icon_url_cache_path(app) else {
        return HashMap::new();
    };

    fs::read_to_string(path)
        .ok()
        .and_then(|value| serde_json::from_str::<HashMap<String, String>>(&value).ok())
        .unwrap_or_default()
}

fn write_steam_icon_url_cache(app: &tauri::AppHandle, cache: &HashMap<String, String>) {
    let Some(path) = steam_icon_url_cache_path(app) else {
        return;
    };

    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    if let Ok(value) = serde_json::to_string(cache) {
        let _ = fs::write(path, value);
    }
}

fn cached_steam_icon_url(cache: &HashMap<String, String>, app_id: &str) -> Option<String> {
    let url = cache.get(app_id)?.trim();
    if url.starts_with("https://") && url.contains(&format!("/apps/{app_id}/")) {
        Some(url.to_string())
    } else {
        None
    }
}

fn cache_steam_icon_url(app: &tauri::AppHandle, app_id: &str, icon_url: &str) {
    let mut cache = read_steam_icon_url_cache(app);
    cache.insert(app_id.to_string(), icon_url.to_string());
    write_steam_icon_url_cache(app, &cache);
}

fn extract_client_icon_hash(value: &str) -> Option<String> {
    let marker = "\"clienticon\"";
    let marker_index = value.find(marker)?;
    let after_marker = &value[marker_index + marker.len()..];
    let value_start = after_marker.find('"')? + 1;
    let after_quote = &after_marker[value_start..];
    let value_end = after_quote.find('"')?;
    let hash = after_quote[..value_end].trim();

    if hash.len() >= 20 && hash.chars().all(|character| character.is_ascii_hexdigit()) {
        Some(hash.to_ascii_lowercase())
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
        let section_end = (index + 8192).min(bytes.len());
        let section = &bytes[index..section_end];

        if let Some(key_index) = section.windows(key.len()).position(|window| window == key) {
            let value_start = key_index + key.len();
            if let Some(value_end) = section[value_start..].iter().position(|byte| *byte == 0) {
                let hash = String::from_utf8_lossy(&section[value_start..value_start + value_end]);
                let hash = hash.trim();
                if hash.len() >= 20 && hash.chars().all(|character| character.is_ascii_hexdigit()) {
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

fn get_game_icon_from_local_appinfo(app: &tauri::AppHandle, app_id: &str) -> Option<String> {
    let (steam_path, _) = crate::resolve_steam_path(app, None);
    let steam_path = steam_path?;
    let vdf_path = std::path::Path::new(&steam_path)
        .join("appcache")
        .join("appinfo.vdf");
    let bytes = fs::read(vdf_path).ok()?;
    let hash = read_client_icon_from_vdf(&bytes, app_id)?;
    Some(steam_community_icon_url(app_id, &hash))
}

fn get_game_icons_from_local_appinfo(
    app: &tauri::AppHandle,
    app_ids: &[String],
) -> HashMap<String, String> {
    let (steam_path, _) = crate::resolve_steam_path(app, None);
    let Some(steam_path) = steam_path else {
        return HashMap::new();
    };
    let vdf_path = std::path::Path::new(&steam_path)
        .join("appcache")
        .join("appinfo.vdf");
    let Ok(bytes) = fs::read(vdf_path) else {
        return HashMap::new();
    };

    app_ids
        .iter()
        .filter_map(|app_id| {
            read_client_icon_from_vdf(&bytes, app_id)
                .map(|hash| (app_id.clone(), steam_community_icon_url(app_id, &hash)))
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

fn get_game_icon_from_steamcmd(app: &tauri::AppHandle, app_id: &str) -> Option<String> {
    let steamcmd = steamcmd_candidates(app)
        .into_iter()
        .find(|candidate| candidate.exists())?;
    let output = with_steamcmd_lock(|| silent_steamcmd_output(&steamcmd, app_id))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let hash = extract_client_icon_hash(&stdout)?;
    Some(steam_community_icon_url(app_id, &hash))
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
    let sort = get_string(&request, "sort");
    if let Some(sort) = sort.as_ref() {
        url.query_pairs_mut().append_pair("sort", &sort);
    }

    append_filter_params(&mut url, &request, "genres");
    append_filter_params(&mut url, &request, "tags");
    append_filter_params(&mut url, &request, "developers");
    append_filter_params(&mut url, &request, "publishers");
    append_filter_params(&mut url, &request, "years");

    let force_refresh = sort.as_deref() == Some("recentlyAdded");
    match catalogue_cache::fetch_json_with_cache(&app, url, force_refresh).await {
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
    let app_id: String = game_id.chars().filter(char::is_ascii_digit).collect();
    if app_id.is_empty() {
        return Ok(None);
    }

    let mut game = fetch_remote_game(&app, game_id, api_url)
        .await?
        .unwrap_or_else(|| steam_app_fallback_game(&app_id));

    let mut latest_cached_details = read_cached_steam_store_details(&app, &app_id);
    if let Some(cached_details) = latest_cached_details.as_ref() {
        merge_normalized_steam_details(&mut game, cached_details);
        if has_complete_steam_store_details(cached_details) {
            if is_steam_app_title_placeholder(&text(game.get("title")), &app_id) {
                if let Some(title) = fetch_steam_store_page_title(&app_id).await {
                    set_game_title(&mut game, title);
                }
            }
            return Ok(Some(game));
        }
    }

    if let Some(proxy_details) = fetch_steam_details_proxy(&app_id).await {
        let has_complete_proxy_details = has_complete_steam_store_details(&proxy_details);
        merge_normalized_steam_details(&mut game, &proxy_details);
        if should_write_steam_store_details_cache(&proxy_details, latest_cached_details.as_ref()) {
            write_cached_steam_store_details(&app, &app_id, &proxy_details);
            latest_cached_details = Some(proxy_details);
        }
        if has_complete_proxy_details {
            if is_steam_app_title_placeholder(&text(game.get("title")), &app_id) {
                if let Some(title) = fetch_steam_store_page_title(&app_id).await {
                    set_game_title(&mut game, title);
                }
            }
            return Ok(Some(game));
        }
    }

    if let Some(store_data) = fetch_steam_store_details(&app_id).await {
        let store_details = steam_store_details_from_store_data(&store_data);
        merge_steam_store_details(&mut game, &store_data);
        if should_write_steam_store_details_cache(&store_details, latest_cached_details.as_ref()) {
            write_cached_steam_store_details(&app, &app_id, &store_details);
        }
    }

    if is_steam_app_title_placeholder(&text(game.get("title")), &app_id) {
        if let Some(title) = fetch_steam_store_page_title(&app_id).await {
            set_game_title(&mut game, title);
        }
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
        .await?
        .unwrap_or_else(|| steam_app_fallback_game(&app_id));

    let (steam_path, _) = crate::resolve_steam_path(&app, None);
    let steam_path = steam_path.as_deref().unwrap_or_default();

    if game
        .get("achievementList")
        .and_then(|value| value.as_array())
        .map(|achievements| achievements.is_empty())
        .unwrap_or(true)
    {
        let achievements = fetch_steam_achievements(&app, &app_id, steam_path).await;
        merge_achievement_list(&mut game, achievements);
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
    let mut reviews = fetch_steam_game_reviews_with_fallbacks(&app_id, language, review_type)
        .await
        .unwrap_or_else(|| serde_json::json!({ "success": 0, "reviews": [] }));
    let histogram = if review_type == "all" {
        fetch_steam_review_histogram(&app_id).await
    } else {
        None
    };

    if let (Some(object), Some(histogram)) = (reviews.as_object_mut(), histogram) {
        object.insert("reviewHistogram".to_string(), histogram);
    }

    Ok(reviews)
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

    let cache = read_steam_icon_url_cache(&app);
    if let Some(icon_url) = cached_steam_icon_url(&cache, &app_id) {
        return Some(icon_url);
    }

    if let Some(icon_url) = get_game_icon_from_local_appinfo(&app, &app_id) {
        cache_steam_icon_url(&app, &app_id, &icon_url);
        return Some(icon_url);
    }

    let icon_url = get_game_icon_from_steamcmd(&app, &app_id)?;
    cache_steam_icon_url(&app, &app_id, &icon_url);
    Some(icon_url)
}

#[tauri::command]
pub async fn steam_get_game_icon_urls(
    app: tauri::AppHandle,
    app_ids: Vec<String>,
) -> HashMap<String, String> {
    let app_ids: Vec<String> = app_ids
        .into_iter()
        .map(|app_id| {
            app_id
                .chars()
                .filter(char::is_ascii_digit)
                .collect::<String>()
        })
        .filter(|app_id| !app_id.is_empty())
        .collect();
    if app_ids.is_empty() {
        return HashMap::new();
    }

    let mut cache = read_steam_icon_url_cache(&app);
    let mut resolved = HashMap::new();
    let mut missing = Vec::new();

    for app_id in app_ids {
        if resolved.contains_key(&app_id) {
            continue;
        }

        if let Some(icon_url) = cached_steam_icon_url(&cache, &app_id) {
            resolved.insert(app_id, icon_url);
        } else {
            missing.push(app_id);
        }
    }

    if missing.is_empty() {
        return resolved;
    }

    for (app_id, icon_url) in get_game_icons_from_local_appinfo(&app, &missing) {
        cache.insert(app_id.clone(), icon_url.clone());
        resolved.insert(app_id, icon_url);
    }

    write_steam_icon_url_cache(&app, &cache);
    resolved
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

#[tauri::command]
pub async fn cache_resolve_steam_library_asset(
    app: tauri::AppHandle,
    app_id: String,
    file_name: String,
) -> String {
    image_cache::resolve_steam_library_asset_url(&app, &app_id, &file_name).await
}
