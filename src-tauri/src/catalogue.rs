use crate::catalogue_cache;
use crate::image_cache;
use crate::{FACETS_VERSION, RANKING_VERSION};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

const STEAM_STORE_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

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

async fn fetch_steam_store_details(app_id: &str) -> Option<Value> {
    let url = format!(
        "https://store.steampowered.com/api/appdetails?appids={}&l=portuguese",
        app_id
    );
    let response = reqwest::Client::new()
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

fn normalize_achievement(achievement: &Value) -> Option<Value> {
    let name = text(achievement.get("name"));
    let title = text(achievement.get("displayName")).if_empty_then(|| name.clone());
    let icon = text(achievement.get("icon"));
    let icon_gray = text(achievement.get("icongray"));
    if name.is_empty() || title.is_empty() || (icon.is_empty() && icon_gray.is_empty()) {
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

async fn fetch_steam_achievements(app_id: &str) -> Vec<Value> {
    let url = format!(
        "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?appid={}&l=portuguese",
        app_id
    );
    let Ok(response) = reqwest::get(url).await else {
        return fetch_steam_achievements_from_community(app_id).await;
    };
    let Ok(value) = response.json::<Value>().await else {
        return fetch_steam_achievements_from_community(app_id).await;
    };

    let achievements: Vec<Value> = value
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
        .unwrap_or_default();

    if achievements.is_empty() {
        fetch_steam_achievements_from_community(app_id).await
    } else {
        achievements
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

fn steamcmd_candidates(app: &tauri::AppHandle) -> Vec<PathBuf> {
    use tauri::Manager;

    let mut candidates = Vec::new();
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        candidates.push(app_data_dir.join("steamcmd").join("steamcmd.exe"));
    }
    if let Some(app_data) = std::env::var_os("APPDATA") {
        let app_data = PathBuf::from(app_data);
        candidates.push(app_data.join("piratebox").join("steamcmd").join("steamcmd.exe"));
        candidates.push(app_data.join("PirateBox").join("steamcmd").join("steamcmd.exe"));
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("tools").join("steamcmd").join("steamcmd.exe"));
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
    let output = Command::new(steamcmd)
        .args([
            "+login",
            "anonymous",
            "+app_info_update",
            "1",
            "+app_info_print",
            app_id,
            "+quit",
        ])
        .output()
        .ok()?;
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
    let app_id: String = game_id.chars().filter(char::is_ascii_digit).collect();
    if app_id.is_empty() {
        return Ok(None);
    }

    let remote_game = fetch_remote_game(&app, game_id, api_url).await?;
    let Some(mut game) = remote_game else {
        return Ok(None);
    };

    if let Some(store_data) = fetch_steam_store_details(&app_id).await {
        merge_steam_store_details(&mut game, &store_data);
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

    let remote_game = fetch_remote_game(&app, game_id, api_url).await?;
    let Some(mut game) = remote_game else {
        return Ok(None);
    };

    if game
        .get("achievementList")
        .and_then(|value| value.as_array())
        .map(|achievements| achievements.is_empty())
        .unwrap_or(true)
    {
        let achievements = fetch_steam_achievements(&app_id).await;
        merge_achievement_list(&mut game, achievements);
    }

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
pub async fn steam_get_game_icon_url(app: tauri::AppHandle, app_id: String) -> Option<String> {
    let app_id: String = app_id.chars().filter(char::is_ascii_digit).collect();
    if app_id.is_empty() {
        return None;
    }

    if let Some(icon_url) = get_game_icon_from_local_appinfo(&app, &app_id) {
        return Some(icon_url);
    }

    get_game_icon_from_steamcmd(&app, &app_id)
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
