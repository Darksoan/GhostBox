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
// v5: payload passa a incluir `drmNotice` (Steam `data.drm_notice`),
// exibido como selo de DRM no banner do modal. Bump invalida o disco
// antigo, que não tinha o campo. (v4 trouxe `appType` para excluir demos.)
const STEAM_STORE_DETAILS_CACHE_VERSION: u64 = 5;
const STEAM_STORE_DETAILS_CACHE_MAX_AGE_DAYS: i64 = 30;
const DEFAULT_STEAM_DETAILS_PROXY_URL: &str = "https://piratebox-steam-details.hella.workers.dev";
const STEAM_DETAILS_PROXY_URL_ENV: &str = "GHOSTBOX_STEAM_DETAILS_PROXY_URL";
const LEGACY_EDEN_STEAM_DETAILS_PROXY_URL_ENV: &str = "EDEN_STEAM_DETAILS_PROXY_URL";
const LEGACY_STEAM_DETAILS_PROXY_URL_ENV: &str = "PIRATEBOX_STEAM_DETAILS_PROXY_URL";
const STEAM_APP_TYPE_CACHE_VERSION: u64 = 1;
const STEAM_APP_TYPE_CACHE_MAX_IDS: usize = 50;
const STEAM_APP_TYPE_CACHE_FILE: &str = "steam-app-type-cache.json";
const CATALOGUE_APP_TYPE_VERSION: &str = "1";
const GAME_ICON_URLS_RESOLVED_EVENT: &str = "game-icon-urls-resolved";
const STEAM_APPINFO_ICON_SEARCH_WINDOW: usize = 65_536;
const STEAMCMD_DOWNLOAD_URL: &str = "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip";
const STEAM_ICON_NEGATIVE_CACHE_TTL_SECS: u64 = 3_600;
/// Contagem de jogadores é dado vivo: dois minutos é o bastante para uma
/// prateleira inteira reaproveitar a mesma amostra sem o número parecer travado.
const STEAM_PLAYER_COUNT_TTL_SECS: u64 = 120;
/// Teto de requisições simultâneas ao endpoint da Steam. Uma prateleira pede
/// poucos jogos, mas a Home pode pedir várias de uma vez.
const STEAM_PLAYER_COUNT_CONCURRENCY: usize = 6;
const MAX_SHORTCUT_ICON_BYTES: usize = 8 * 1024 * 1024;
static STEAM_STORE_DETAILS_CACHE_WRITE_LOCK: Mutex<()> = Mutex::new(());
static STEAM_PLAYER_COUNT_CACHE: OnceLock<Mutex<HashMap<String, (Instant, u64)>>> = OnceLock::new();
static STEAM_ICON_URL_MEMORY: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
static STEAM_ICON_NEGATIVE_CACHE: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
static STEAM_APPINFO_BYTES_CACHE: OnceLock<Mutex<Option<AppinfoBytesCache>>> = OnceLock::new();
static STEAM_APP_TYPE_CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
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
    source: Option<&'static str>,
}

fn text(value: Option<&Value>) -> String {
    value
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_default()
}

fn normalize_steam_app_type(value: Option<&Value>) -> String {
    let raw = text(value).to_ascii_lowercase();
    if raw.is_empty() || raw.len() > 32 {
        return String::new();
    }
    if raw
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
    {
        raw
    } else {
        String::new()
    }
}

fn steam_app_type_of(value: &Value) -> String {
    let object = match value.as_object() {
        Some(object) => object,
        None => return String::new(),
    };
    for key in ["appType", "app_type", "type"] {
        let normalized = normalize_steam_app_type(object.get(key));
        if !normalized.is_empty() {
            return normalized;
        }
    }
    String::new()
}

fn is_steam_demo(value: &Value) -> bool {
    steam_app_type_of(value) == "demo"
}

fn is_known_demo_from_disk_cache(app: &tauri::AppHandle, app_id: &str) -> bool {
    for language in ["portuguese", "english"] {
        if let Some(details) = read_cached_steam_store_details(app, app_id, language) {
            if steam_app_type_of(&details) == "demo" {
                return true;
            }
        }
    }
    false
}

fn filter_demo_games_with_disk_cache(app: &tauri::AppHandle, games: Vec<Value>) -> Vec<Value> {
    games
        .into_iter()
        .filter(|game| {
            if is_steam_demo(game) {
                return false;
            }
            let app_id = text(game.get("appId")).if_empty_then(|| text(game.get("app_id")));
            if app_id.is_empty() {
                return true;
            }
            !is_known_demo_from_disk_cache(app, &app_id)
        })
        .collect()
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

// Steam marca suporte a controle com o campo `controller_support` ("full" |
// "partial") ou, quando ausente, pelas categorias 28 (total) e 18 (parcial).
fn steam_controller_support(store_data: &Value) -> Option<String> {
    let direct = store_data
        .get("controller_support")
        .and_then(|value| value.as_str())
        .map(str::trim);
    if matches!(direct, Some("full") | Some("partial")) {
        return direct.map(str::to_string);
    }

    let categories = store_data
        .get("categories")
        .and_then(|value| value.as_array())?;
    let has_category = |id: u64| {
        categories
            .iter()
            .any(|category| category.get("id").and_then(|value| value.as_u64()) == Some(id))
    };
    if has_category(28) {
        return Some("full".to_string());
    }
    if has_category(18) {
        return Some("partial".to_string());
    }
    None
}

fn merge_steam_store_details(game: &mut Value, store_data: &Value) {
    let Some(object) = game.as_object_mut() else {
        return;
    };

    let app_type = steam_app_type_of(store_data);
    if !app_type.is_empty() {
        object.insert("appType".to_string(), Value::String(app_type));
    }

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

    if let Some(support) = steam_controller_support(store_data) {
        object.insert("controllerSupport".to_string(), Value::String(support));
    }
    let supported_languages = text(store_data.get("supported_languages"));
    if !supported_languages.is_empty() {
        object.insert(
            "supportedLanguages".to_string(),
            Value::String(supported_languages),
        );
    }

    object.insert(
        "drmNotice".to_string(),
        Value::String(text(store_data.get("drm_notice"))),
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
    let app_type = steam_app_type_of(store_data);

    let mut details = serde_json::json!({
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
        "controllerSupport": steam_controller_support(store_data)
            .unwrap_or_else(|| "none".to_string()),
        "supportedLanguages": text(store_data.get("supported_languages")),
        "drmNotice": text(store_data.get("drm_notice")),
    });
    if !app_type.is_empty() {
        if let Some(object) = details.as_object_mut() {
            object.insert("appType".to_string(), Value::String(app_type));
        }
    }
    details
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

    let about_the_game =
        text(details.get("aboutTheGame")).if_empty_then(|| text(details.get("about_the_game")));
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

    let controller_support = text(details.get("controllerSupport"))
        .if_empty_then(|| text(details.get("controller_support")));
    if matches!(controller_support.as_str(), "full" | "partial") {
        object.insert(
            "controllerSupport".to_string(),
            Value::String(controller_support),
        );
    }

    let supported_languages = text(details.get("supportedLanguages"))
        .if_empty_then(|| text(details.get("supported_languages")));
    if !supported_languages.is_empty() {
        object.insert(
            "supportedLanguages".to_string(),
            Value::String(supported_languages),
        );
    }

    let app_type = steam_app_type_of(details);
    if !app_type.is_empty() {
        object.insert("appType".to_string(), Value::String(app_type));
    }

    if details.get("drmNotice").is_some() || details.get("drm_notice").is_some() {
        let drm_notice = text(details.get("drmNotice"))
            .if_empty_then(|| text(details.get("drm_notice")));
        object.insert("drmNotice".to_string(), Value::String(drm_notice));
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

// Idiomas que a Steam aceita no parâmetro `l=`/`lang=` das rotas de detalhes.
// "portuguese" continua sendo o fallback: era o valor fixo de antes, então
// qualquer chamador que ainda não informa idioma preserva o comportamento
// atual em vez de trocar silenciosamente para inglês.
fn steam_ui_language(language: Option<&str>) -> &'static str {
    match language {
        Some("en") => "english",
        _ => "portuguese",
    }
}

fn steam_store_details_cache_path(
    app: &tauri::AppHandle,
    app_id: &str,
    language: &str,
) -> Option<PathBuf> {
    if !app_id.chars().all(|character| character.is_ascii_digit()) {
        return None;
    }

    let directory = app
        .path()
        .app_data_dir()
        .ok()?
        .join("cache")
        .join("steam-store-details");
    // O idioma faz parte do nome do arquivo: descrição, requisitos e gêneros
    // vêm localizados pela Steam, então um cache compartilhado entre pt/en
    // serviria o texto do idioma errado depois de trocar a preferência na UI.
    Some(directory.join(format!("{app_id}-{language}.json")))
}

fn read_cached_steam_store_details(
    app: &tauri::AppHandle,
    app_id: &str,
    language: &str,
) -> Option<Value> {
    let path = steam_store_details_cache_path(app, app_id, language)?;
    let contents = fs::read_to_string(path).ok()?;
    let cached = serde_json::from_str::<Value>(&contents).ok()?;
    // v4 descriptions remain useful while the missing DRM field is refreshed.
    let version = cached.get("version").and_then(Value::as_u64);
    if version != Some(4) && version != Some(STEAM_STORE_DETAILS_CACHE_VERSION) {
        return None;
    }
    cached.get("data").cloned()
}

fn cached_steam_store_details_is_fresh(
    app: &tauri::AppHandle,
    app_id: &str,
    language: &str,
) -> bool {
    let Some(path) = steam_store_details_cache_path(app, app_id, language) else {
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
    // O título não depende do idioma pedido pela UI no momento da chamada;
    // aceita qualquer variante já cacheada em vez de exigir uma específica.
    for language in ["portuguese", "english"] {
        if let Some(details) = read_cached_steam_store_details(app, app_id, language) {
            let title = text(details.get("name"));
            if !title.is_empty() {
                return Some(title);
            }
        }
    }
    None
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

fn write_cached_steam_store_details(
    app: &tauri::AppHandle,
    app_id: &str,
    language: &str,
    details: &Value,
) {
    let Ok(_guard) = STEAM_STORE_DETAILS_CACHE_WRITE_LOCK.lock() else {
        return;
    };
    let Some(path) = steam_store_details_cache_path(app, app_id, language) else {
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
        // A ausência do aviso de DRM é um valor conhecido: não retenha um
        // aviso antigo quando a Steam passar a devolver uma string vazia.
        if key == "drmNotice" {
            if let Some(notice) = value.as_str() {
                merged.insert(key.clone(), Value::String(notice.trim().to_string()));
            }
            continue;
        }
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

fn steam_details_proxy_url(app_id: &str, language: &str) -> Option<reqwest::Url> {
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
    url.query_pairs_mut().clear().append_pair("lang", language);
    Some(url)
}

fn steam_details_proxy_base_url() -> Option<reqwest::Url> {
    let base = std::env::var(STEAM_DETAILS_PROXY_URL_ENV)
        .or_else(|_| std::env::var(LEGACY_EDEN_STEAM_DETAILS_PROXY_URL_ENV))
        .or_else(|_| std::env::var(LEGACY_STEAM_DETAILS_PROXY_URL_ENV))
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_STEAM_DETAILS_PROXY_URL.to_string());
    let url = reqwest::Url::parse(&base).ok()?;
    let is_localhost = matches!(url.host_str(), Some("localhost" | "127.0.0.1"));
    if url.scheme() != "https" && !is_localhost {
        return None;
    }
    Some(url)
}

fn steam_app_type_cache_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    Some(
        app.path()
            .app_data_dir()
            .ok()?
            .join(STEAM_APP_TYPE_CACHE_FILE),
    )
}

fn steam_app_type_cache_memory() -> &'static Mutex<HashMap<String, String>> {
    STEAM_APP_TYPE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn read_steam_app_type_cache(app: &tauri::AppHandle) -> HashMap<String, String> {
    if let Ok(memory) = steam_app_type_cache_memory().lock() {
        if !memory.is_empty() {
            return memory.clone();
        }
    }

    let cache = steam_app_type_cache_path(app)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|contents| serde_json::from_str::<Value>(&contents).ok())
        .filter(|value| {
            value.get("version").and_then(Value::as_u64) == Some(STEAM_APP_TYPE_CACHE_VERSION)
        })
        .and_then(|value| value.get("types").cloned())
        .and_then(|value| serde_json::from_value::<HashMap<String, String>>(value).ok())
        .unwrap_or_default();

    if let Ok(mut memory) = steam_app_type_cache_memory().lock() {
        *memory = cache.clone();
    }
    cache
}

fn write_steam_app_type_cache(app: &tauri::AppHandle, cache: &HashMap<String, String>) {
    if let Ok(mut memory) = steam_app_type_cache_memory().lock() {
        *memory = cache.clone();
    }
    let Some(path) = steam_app_type_cache_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        if fs::create_dir_all(parent).is_err() {
            return;
        }
    }
    let body = serde_json::json!({
        "version": STEAM_APP_TYPE_CACHE_VERSION,
        "types": cache,
    });
    let Ok(contents) = serde_json::to_string(&body) else {
        return;
    };
    let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
    if fs::write(&temporary, contents).is_err() {
        return;
    }
    if path.exists() && fs::remove_file(&path).is_err() {
        let _ = fs::remove_file(&temporary);
        return;
    }
    if fs::rename(&temporary, &path).is_err() {
        let _ = fs::remove_file(&temporary);
    }
}

fn app_type_map_from_payload(value: &Value) -> HashMap<String, String> {
    value
        .get("types")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let app_id = text(entry.get("appId")).if_empty_then(|| text(entry.get("app_id")));
            let app_type = steam_app_type_of(entry);
            if app_id.is_empty() || app_type.is_empty() {
                None
            } else {
                Some((app_id, app_type))
            }
        })
        .collect()
}

async fn fetch_steam_app_types_from_proxy(app_ids: &[String]) -> Option<HashMap<String, String>> {
    let mut url = steam_details_proxy_base_url()?;
    let base_path = url.path().trim_end_matches('/');
    url.set_path(&format!("{base_path}/v2/games/types"));
    url.query_pairs_mut()
        .clear()
        .append_pair("appids", &app_ids.join(","));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .ok()?;
    let value = client
        .get(url)
        .header(reqwest::header::USER_AGENT, STEAM_STORE_USER_AGENT)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json::<Value>()
        .await
        .ok()?;
    Some(app_type_map_from_payload(&value))
}

async fn fetch_steam_app_types_direct(app_ids: &[String]) -> Option<HashMap<String, String>> {
    let mut url = reqwest::Url::parse("https://store.steampowered.com/api/appdetails").ok()?;
    url.query_pairs_mut()
        .append_pair("appids", &app_ids.join(","))
        .append_pair("l", "english");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .ok()?;
    let payload = client
        .get(url)
        .header(reqwest::header::USER_AGENT, STEAM_STORE_USER_AGENT)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json::<Value>()
        .await
        .ok()?;
    let mut result = HashMap::new();
    for app_id in app_ids {
        let Some(entry) = payload.get(app_id) else {
            continue;
        };
        if entry.get("success").and_then(Value::as_bool) != Some(true) {
            continue;
        }
        let Some(data) = entry.get("data") else {
            continue;
        };
        let app_type = steam_app_type_of(data);
        if !app_type.is_empty() {
            result.insert(app_id.clone(), app_type);
        }
    }
    Some(result)
}

async fn resolve_steam_app_types(
    app: &tauri::AppHandle,
    requested: &[String],
) -> HashMap<String, String> {
    let app_ids: Vec<String> = requested
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| value.chars().all(|c| c.is_ascii_digit()) && !value.is_empty())
        .take(STEAM_APP_TYPE_CACHE_MAX_IDS)
        .collect();
    let mut cache = read_steam_app_type_cache(app);
    let missing: Vec<String> = app_ids
        .iter()
        .filter(|app_id| !cache.contains_key(*app_id))
        .cloned()
        .collect();
    if !missing.is_empty() {
        let mut fetched = fetch_steam_app_types_from_proxy(&missing)
            .await
            .unwrap_or_default();
        let still_missing: Vec<String> = missing
            .iter()
            .filter(|app_id| !fetched.contains_key(*app_id))
            .cloned()
            .collect();
        if !still_missing.is_empty() {
            if let Some(direct) = fetch_steam_app_types_direct(&still_missing).await {
                fetched.extend(direct);
            }
        }
        cache.extend(fetched);
        write_steam_app_type_cache(app, &cache);
    }
    app_ids
        .into_iter()
        .filter_map(|app_id| {
            cache
                .get(&app_id)
                .cloned()
                .map(|app_type| (app_id, app_type))
        })
        .collect()
}

async fn filter_featured_demos(app: &tauri::AppHandle, value: &mut Value) {
    let keys = ["topSellers", "newReleases", "comingSoon"];
    let ids: Vec<String> = keys
        .iter()
        .flat_map(|key| {
            value
                .get(*key)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|entry| {
                    let app_id =
                        text(entry.get("appId")).if_empty_then(|| text(entry.get("app_id")));
                    (!app_id.is_empty()).then_some(app_id)
                })
        })
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    if ids.is_empty() {
        return;
    }
    let types = resolve_steam_app_types(app, &ids).await;
    let Some(object) = value.as_object_mut() else {
        return;
    };
    for key in keys {
        let Some(items) = object.get_mut(key).and_then(Value::as_array_mut) else {
            continue;
        };
        items.retain_mut(|entry| {
            let app_id = text(entry.get("appId")).if_empty_then(|| text(entry.get("app_id")));
            let Some(app_type) = types.get(&app_id) else {
                // Sem classificação não há garantia de que o card não seja
                // demo; a Home prefere uma rail menor a exibir o app errado.
                return false;
            };
            if app_type == "demo" {
                return false;
            }
            if let Some(entry) = entry.as_object_mut() {
                entry.insert("appType".to_string(), Value::String(app_type.clone()));
            }
            true
        });
    }
}

async fn fetch_steam_details_proxy(app_id: &str, language: &str) -> Option<Value> {
    let url = steam_details_proxy_url(app_id, language)?;
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

async fn fetch_steam_store_details(app_id: &str, language: &str) -> Option<Value> {
    let url = format!(
        "https://store.steampowered.com/api/appdetails?appids={}&l={}",
        app_id, language
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
    steam_app_data(&response, app_id).cloned()
}

fn steam_app_data<'a>(payload: &'a Value, app_id: &str) -> Option<&'a Value> {
    let entries = payload.as_object()?;
    let matching_data = |key: &str, entry: &'a Value| {
        if entry.get("success").and_then(Value::as_bool) != Some(true) {
            return None;
        }
        let data = entry.get("data").filter(|data| data.is_object())?;
        match data.get("steam_appid") {
            Some(value) if !value.is_null() => {
                let embedded_id = value.as_u64().map(|id| id.to_string())
                    .unwrap_or_else(|| text(Some(value)));
                if embedded_id != app_id {
                    return None;
                }
            }
            _ if key != app_id => return None,
            _ => {}
        }
        Some(data)
    };
    if let Some(data) = entries.get(app_id).and_then(|entry| matching_data(app_id, entry)) {
        return Some(data);
    }
    entries.iter().find_map(|(key, entry)| matching_data(key, entry))
}

fn steam_details_have_about(details: &Value) -> bool {
    !text(details.get("aboutTheGame"))
        .if_empty_then(|| text(details.get("about_the_game")))
        .is_empty()
}

// Campos novos do modal (suporte a controle + idiomas). "none" é um valor
// válido e definitivo para controle — significa que a Steam foi consultada e
// não há suporte; ausente/vazio significa que ainda não buscamos esse dado.
fn steam_details_have_metric_fields(details: &Value) -> bool {
    let controller_support = text(details.get("controllerSupport"))
        .if_empty_then(|| text(details.get("controller_support")));
    let has_controller = matches!(controller_support.as_str(), "full" | "partial" | "none");
    let has_languages = !text(details.get("supportedLanguages"))
        .if_empty_then(|| text(details.get("supported_languages")))
        .is_empty();
    has_controller && has_languages
}

fn steam_details_have_drm_field(details: &Value) -> bool {
    details.get("drmNotice").and_then(Value::as_str).is_some()
        || details.get("drm_notice").and_then(Value::as_str).is_some()
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
    let filter = if review_type == "all" {
        "recent"
    } else {
        "all"
    };
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

/// Ícones de conquista migraram para `community_assets`, mas o schema ainda
/// devolve o host legado `steamcommunity/public/images/apps/...`, que dá 404
/// para jogos novos (ex. Aniimo 4126040). O arquivo (hash + extensão) é o
/// mesmo nos dois endereços.
fn normalize_achievement_image_url(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let Some(path_start) = trimmed.find("steamcommunity/public/images/apps/") else {
        return trimmed.to_string();
    };
    let remainder = &trimmed[path_start + "steamcommunity/public/images/apps/".len()..];
    let mut parts = remainder.splitn(2, '/');
    let app_id = parts.next().unwrap_or_default();
    let file = parts.next().unwrap_or_default().split(['?', '#']).next().unwrap_or_default();
    if app_id.is_empty()
        || !app_id.chars().all(|c| c.is_ascii_digit())
        || file.len() < 24
        || !file.chars().take_while(|c| *c != '.').all(|c| c.is_ascii_hexdigit())
        || !(file.ends_with(".jpg")
            || file.ends_with(".jpeg")
            || file.ends_with(".png")
            || file.ends_with(".ico"))
    {
        return trimmed.to_string();
    }
    format!("https://shared.fastly.steamstatic.com/community_assets/images/apps/{app_id}/{file}")
}

fn normalize_achievement(achievement: &Value) -> Option<Value> {
    let name = text(achievement.get("name"));
    let title = text(achievement.get("displayName"))
        .if_empty_then(|| text(achievement.get("title")))
        .if_empty_then(|| name.clone());
    let icon = normalize_achievement_image_url(&text(achievement.get("icon")));
    let icon_gray = normalize_achievement_image_url(
        &text(achievement.get("icongray")).if_empty_then(|| text(achievement.get("iconGray"))),
    );
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
        source: None,
    }
}

async fn fetch_steam_achievements_with_user_key(
    app: &tauri::AppHandle,
    app_id: &str,
    language: &str,
) -> Option<AchievementFetchResult> {
    let api_key = crate::settings::load_steam_web_api_key(app);
    if api_key.is_empty() {
        return None;
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .ok()?;
    let value = client
        .get("https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/")
        .query(&[("key", api_key.as_str()), ("appid", app_id), ("l", language)])
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json::<Value>()
        .await
        .ok()?;
    let achievements: Vec<Value> = value
        .pointer("/game/availableGameStats/achievements")?
        .as_array()?
        .iter()
        .filter_map(normalize_achievement)
        .collect();
    if achievements.is_empty() {
        return None;
    }

    Some(AchievementFetchResult {
        status: "ready".to_string(),
        achievements,
        ..Default::default()
    })
}

async fn fetch_steam_achievements(
    app: &tauri::AppHandle,
    app_id: &str,
    steam_path: &str,
    ui_language: Option<&str>,
) -> AchievementFetchResult {
    let proxy_url = crate::settings::load_steam_stats_proxy_url();
    let mut failed_proxy_result = None;
    if !proxy_url.is_empty() {
        // Tenta primeiro o idioma da UI; os demais ficam como fallback caso o
        // schema não exista naquele idioma (comportamento antigo preservado
        // para quem está em português).
        let languages: &[&str] = if ui_language == Some("en") {
            &["english", "brazilian", "portuguese"]
        } else {
            &["brazilian", "portuguese", "english"]
        };
        let mut last_result = AchievementFetchResult::default();
        for &language in languages {
            let result = fetch_steam_achievements_from_proxy(&proxy_url, app_id, language).await;
            if !result.achievements.is_empty() {
                return result;
            }
            last_result = result;
            if matches!(last_result.status.as_str(), "rate-limited" | "unavailable") {
                break;
            }
        }
        if !last_result.status.is_empty() {
            failed_proxy_result = Some(last_result);
        }
    }

    // A falha do proxy não deve impedir o uso do schema já instalado pela
    // Steam. Consultá-lo primeiro evita outra espera de rede no modal.
    let achievements =
        crate::steam_appcache::read_local_achievement_definitions(steam_path, app_id);
    if !achievements.is_empty() {
        return AchievementFetchResult {
            status: "ready".to_string(),
            achievements,
            source: Some("local"),
            ..Default::default()
        };
    }

    if failed_proxy_result
        .as_ref()
        .is_some_and(|result| result.status == "no-achievements")
    {
        return failed_proxy_result.unwrap();
    }

    // Para jogos sem schema local, a chave pessoal pode recuperar a lista
    // diretamente da Steam quando o proxy compartilhado falha.
    let language = if ui_language == Some("en") {
        "english"
    } else {
        "brazilian"
    };
    if let Some(result) = fetch_steam_achievements_with_user_key(app, app_id, language).await {
        return result;
    }

    failed_proxy_result.unwrap_or(AchievementFetchResult {
        status: "no-achievements".to_string(),
        ..Default::default()
    })
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
            read_icon_hash_from_vdf(&bytes, app_id, b"icon\0").map(|hash| {
                (
                    app_id.clone(),
                    steam_community_image_url(app_id, &hash, "jpg"),
                )
            })
        })
        .collect()
}

fn get_game_icon_from_local_files(app: &tauri::AppHandle, app_id: &str) -> Option<String> {
    let (steam_path, _) = crate::resolve_steam_path(app, None);
    let steam_path = steam_path?;
    let steam_root = Path::new(&steam_path);
    let candidates = [
        steam_root
            .join("steam")
            .join("games")
            .join(format!("{app_id}.ico")),
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

fn is_ico_icon_url(app_id: &str, url: &str) -> bool {
    let url = url.trim();
    let base = url.split(['?', '#']).next().unwrap_or_default();
    url.starts_with("https://")
        && url.contains(&format!("steamcommunity/public/images/apps/{app_id}/"))
        && base.to_ascii_lowercase().ends_with(".ico")
}

/// Caminho `.ico` local do jogo para uso como `IconLocation` do atalho.
/// Só `.ico` serve ao `WScript.Shell`: os `icon.jpg/png` do `librarycache`
/// são ignorados de propósito.
pub(crate) fn local_game_ico_path(app: &tauri::AppHandle, app_id: &str) -> Option<PathBuf> {
    let normalized: String = app_id.chars().filter(char::is_ascii_digit).collect();
    if normalized.is_empty() {
        return None;
    }
    get_game_icon_from_local_files(app, &normalized)
        .filter(|path| path.to_ascii_lowercase().ends_with(".ico"))
        .map(PathBuf::from)
        .filter(|path| path.is_file())
}

fn shortcut_ico_cache_path(app: &tauri::AppHandle, app_id: &str) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("game-icons");
    Some(dir.join(format!("{app_id}.ico")))
}

fn is_valid_ico_bytes(bytes: &[u8]) -> bool {
    bytes.len() > 22 && bytes[0] == 0 && bytes[1] == 0 && bytes[2] == 1 && bytes[3] == 0
}

async fn download_ico_to_cache(app: &tauri::AppHandle, app_id: &str, url: &str) -> Option<PathBuf> {
    let url = url.trim();
    if url.is_empty() || !is_ico_icon_url(app_id, url) {
        return None;
    }
    let destination = shortcut_ico_cache_path(app, app_id)?;
    if destination.is_file() {
        return Some(destination);
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .ok()?;
    let bytes = client
        .get(url)
        .header(reqwest::header::USER_AGENT, STEAM_STORE_USER_AGENT)
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .bytes()
        .await
        .ok()?;
    if bytes.len() > MAX_SHORTCUT_ICON_BYTES || !is_valid_ico_bytes(&bytes) {
        return None;
    }
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).ok()?;
    }
    let temp_path = destination.with_extension("ico.tmp");
    std::fs::write(&temp_path, &bytes).ok()?;
    std::fs::rename(&temp_path, &destination).ok()?;
    destination.is_file().then_some(destination)
}

/// Resolve o `.ico` do jogo para o atalho: prefere o arquivo local da Steam,
/// reaproveita um `.ico` já baixado e, por último, baixa o `clienticon`
/// (único hash que existe como `.ico` no CDN) para o cache do app.
pub(crate) async fn game_ico_for_shortcut(app: &tauri::AppHandle, app_id: &str) -> Option<PathBuf> {
    let app_id: String = app_id.chars().filter(char::is_ascii_digit).collect();
    if app_id.is_empty() {
        return None;
    }
    if let Some(local) = local_game_ico_path(app, &app_id) {
        return Some(local);
    }
    if let Some(cached) = shortcut_ico_cache_path(app, &app_id).filter(|path| path.is_file()) {
        return Some(cached);
    }
    let mut candidates = Vec::new();
    if let Some(url) = memory_steam_icon_url(&app_id).filter(|url| is_ico_icon_url(&app_id, url)) {
        candidates.push(url);
    }
    if candidates.is_empty() {
        let cache = read_steam_icon_url_cache(app);
        if let Some(url) =
            cached_steam_icon_url(&cache, &app_id).filter(|url| is_ico_icon_url(&app_id, url))
        {
            candidates.push(url);
        }
    }
    if candidates.is_empty() {
        let app_ids = std::slice::from_ref(&app_id);
        for (_, url) in get_game_icons_from_local_appinfo(app, app_ids) {
            if is_ico_icon_url(&app_id, &url) {
                candidates.push(url);
            }
        }
    }
    for url in candidates {
        if let Some(path) = download_ico_to_cache(app, &app_id, &url).await {
            return Some(path);
        }
    }
    None
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
    let mut url = url;
    url.query_pairs_mut()
        .append_pair("appTypeVersion", CATALOGUE_APP_TYPE_VERSION);
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
        .append_pair("appTypeVersion", CATALOGUE_APP_TYPE_VERSION)
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
            // Rede de segurança client-side: worker já filtra demos, mas cache
            // em disco antigo pode conter payloads com demos.
            if let Some(object) = value.as_object_mut() {
                if let Some(games) = object.get("games").and_then(|v| v.as_array()).cloned() {
                    let filtered = filter_demo_games_with_disk_cache(&app, games);
                    object.insert("games".to_string(), Value::Array(filtered));
                }
            }
            catalogue_cache::prepare_cached_response(&mut value, updated_at, from_cache);
            Ok(value)
        }
        // Um catálogo vazio é indistinguível de "nenhum resultado" na UI. O
        // fallback offline já acontece dentro de `fetch_json_with_cache` (stale
        // cache); chegar aqui significa que não há nada utilizável.
        Err(error) => Err(error),
    }
}

fn validate_steam_store_search(query: &str, limit: u64) -> Result<(String, usize), String> {
    let query = query.trim();
    let is_app_id = !query.is_empty()
        && query.len() <= 10
        && query.chars().all(|character| character.is_ascii_digit());
    if !is_app_id && query.chars().count() < 3 {
        return Err("Steam Store search requires at least 3 characters".to_string());
    }
    Ok((query.to_string(), limit.clamp(1, 20) as usize))
}

fn steam_store_search_games(payload: &Value, limit: usize) -> Vec<Value> {
    payload
        .get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("app"))
        .filter_map(|item| {
            let app_id = item.get("id")?.as_u64()?.to_string();
            let title = text(item.get("name"));
            if title.is_empty() {
                return None;
            }

            let mut game = steam_app_fallback_game(&app_id);
            let object = game.as_object_mut()?;
            let portrait = format!(
                "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/{app_id}/library_600x900.jpg"
            );
            let header = format!(
                "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/{app_id}/header.jpg"
            );
            let tiny_image = text(item.get("tiny_image"));
            // `tiny_image` da storesearch é a small capsule exata
            // (`capsule_231x87.jpg`, pode vir com `?t=`); o frontend usa como
            // primeira opção do preview do dropdown antes das URLs previsíveis.
            let small_capsule = if tiny_image.is_empty() {
                format!(
                    "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/{app_id}/capsule_231x87.jpg"
                )
            } else {
                tiny_image.clone()
            };
            let fallbacks = vec![
                Value::String(header),
                Value::String(small_capsule.clone()),
            ];
            object.insert("title".to_string(), Value::String(title));
            object.insert("cover".to_string(), Value::String(portrait.clone()));
            object.insert("coverUrl".to_string(), Value::String(portrait));
            object.insert("coverFallbacks".to_string(), Value::Array(fallbacks));
            object.insert(
                "smallCapsuleUrl".to_string(),
                Value::String(small_capsule),
            );
            Some(game)
        })
        .take(limit)
        .collect()
}

#[tauri::command]
pub async fn database_search_steam_store(
    app: tauri::AppHandle,
    query: String,
    limit: Option<u64>,
    language: Option<String>,
) -> Result<Vec<Value>, String> {
    let (query, limit) = validate_steam_store_search(&query, limit.unwrap_or(20))?;
    let language = steam_ui_language(language.as_deref());
    let country = if language == "english" { "US" } else { "BR" };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .user_agent(STEAM_STORE_USER_AGENT)
        .build()
        .map_err(|error| error.to_string())?;
    let payload = client
        .get("https://store.steampowered.com/api/storesearch/")
        .query(&[("term", query.as_str()), ("l", language), ("cc", country)])
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<Value>()
        .await
        .map_err(|error| error.to_string())?;

    // `storesearch` retorna `type: "app"` tanto para jogos quanto para demos;
    // a classificação definitiva vem do cache de detalhes. Filtra o que já é
    // sabidamente demo; o restante é filtrado no frontend após enriquecimento.
    let games = steam_store_search_games(&payload, limit);
    Ok(filter_demo_games_with_disk_cache(&app, games))
}

#[tauri::command]
pub async fn database_get_game_details(
    app: tauri::AppHandle,
    game_id: String,
    api_url: Option<String>,
) -> Result<Option<serde_json::Value>, String> {
    let game = fetch_remote_game(&app, game_id, api_url).await?;
    if let Some(ref game) = game {
        if is_steam_demo(game) {
            return Ok(None);
        }
    }
    Ok(game)
}

#[tauri::command]
pub async fn database_get_game_store_details(
    app: tauri::AppHandle,
    game_id: String,
    api_url: Option<String>,
    language: Option<String>,
    base_game: Option<Value>,
) -> Result<Option<serde_json::Value>, String> {
    let app_id: String = game_id.chars().filter(char::is_ascii_digit).collect();
    if app_id.is_empty() {
        return Ok(None);
    }
    // Vem da preferência de idioma da UI (`appearance.language`, "pt"/"en");
    // sem isso a descrição, os requisitos e os gêneros vinham sempre em
    // português da Steam, ignorando o idioma escolhido no app.
    let steam_language = steam_ui_language(language.as_deref());

    // The modal already has the catalogue result. Fetching /games/:id before
    // even reading the local Steam details used to put an optional network
    // request on the critical path for every first open.
    let supplied_game = base_game.filter(|game| text(game.get("appId")) == app_id);
    let mut game = if let Some(game) = supplied_game {
        game
    } else {
        fetch_remote_game(&app, game_id, api_url)
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| steam_app_fallback_game(&app_id))
    };
    if is_steam_demo(&game) {
        return Ok(None);
    }

    let mut latest_cached_details = read_cached_steam_store_details(&app, &app_id, steam_language);
    if let Some(cached_details) = latest_cached_details.as_ref() {
        if steam_app_type_of(cached_details) == "demo" {
            return Ok(None);
        }
        merge_normalized_steam_details(&mut game, cached_details);
        if is_steam_demo(&game) {
            return Ok(None);
        }
        if cached_steam_store_details_is_fresh(&app, &app_id, steam_language)
            && steam_details_have_about(cached_details)
            // Cache escrito por proxy antigo pode não ter os campos novos
            // (controle/idiomas/DRM); complete com a busca direta.
            && steam_details_have_metric_fields(cached_details)
            && steam_details_have_drm_field(cached_details)
        {
            return Ok(Some(game));
        }
    }

    if let Some(proxy_details) = fetch_steam_details_proxy(&app_id, steam_language).await {
        if steam_app_type_of(&proxy_details) == "demo" {
            return Ok(None);
        }
        let merged_details =
            merge_cached_steam_store_details(latest_cached_details.as_ref(), &proxy_details);
        if steam_app_type_of(&merged_details) == "demo" {
            return Ok(None);
        }
        merge_normalized_steam_details(&mut game, &merged_details);
        if is_steam_demo(&game) {
            return Ok(None);
        }
        write_cached_steam_store_details(&app, &app_id, steam_language, &merged_details);
        if steam_details_have_about(&merged_details)
            && steam_details_have_metric_fields(&merged_details)
            && steam_details_have_drm_field(&merged_details)
        {
            return Ok(Some(game));
        }
        latest_cached_details = Some(merged_details);
    }

    // O proxy pode estar online mas ainda não fornecer todos os campos do modal
    // (inclusive o aviso de DRM). Complete com a Steam quando algum faltar.
    if let Some(store_data) = fetch_steam_store_details(&app_id, steam_language).await {
        if steam_app_type_of(&store_data) == "demo" {
            return Ok(None);
        }
        let store_details = steam_store_details_from_store_data(&store_data);
        if steam_app_type_of(&store_details) == "demo" {
            return Ok(None);
        }
        merge_steam_store_details(&mut game, &store_data);
        if is_steam_demo(&game) {
            return Ok(None);
        }
        let merged_details =
            merge_cached_steam_store_details(latest_cached_details.as_ref(), &store_details);
        write_cached_steam_store_details(&app, &app_id, steam_language, &merged_details);
    }

    if is_steam_demo(&game) {
        return Ok(None);
    }
    Ok(Some(game))
}

#[tauri::command]
pub async fn database_get_game_achievement_details(
    app: tauri::AppHandle,
    game_id: String,
    api_url: Option<String>,
    language: Option<String>,
    base_game: Option<Value>,
) -> Result<Option<serde_json::Value>, String> {
    let app_id: String = game_id.chars().filter(char::is_ascii_digit).collect();
    if app_id.is_empty() {
        return Ok(None);
    }

    // The modal can supply the catalogue record here as well, so opening it
    // never launches two duplicate /games/:id requests just for enrichment.
    let supplied_game = base_game.filter(|game| text(game.get("appId")) == app_id);
    let mut game = if let Some(game) = supplied_game {
        game
    } else {
        fetch_remote_game(&app, game_id, api_url)
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| steam_app_fallback_game(&app_id))
    };
    if is_steam_demo(&game) {
        return Ok(None);
    }

    let (steam_path, _) = crate::resolve_steam_path(&app, None);
    let steam_path = steam_path.as_deref().unwrap_or_default();

    // Payloads antigos em disco/DB guardam o host legado dos ícones; corrige
    // em voo para não servir 404 até o próximo refetch do schema.
    if let Some(list) = game
        .get_mut("achievementList")
        .and_then(|value| value.as_array_mut())
    {
        for achievement in list.iter_mut() {
            let icon = normalize_achievement_image_url(&text(achievement.get("icon")));
            let icon_gray =
                normalize_achievement_image_url(&text(achievement.get("iconGray")));
            if let Some(object) = achievement.as_object_mut() {
                object.insert("icon".to_string(), Value::String(icon));
                object.insert("iconGray".to_string(), Value::String(icon_gray));
            }
        }
    }

    let achievement_list = game
        .get("achievementList")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    let has_percentages = achievement_list
        .iter()
        .any(|ach| ach.get("globalPercent").is_some());
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
        let achievement_result =
            fetch_steam_achievements(&app, &app_id, steam_path, language.as_deref()).await;
        if let Some(object) = game.as_object_mut() {
            object.insert(
                "achievementMetadata".to_string(),
                serde_json::json!({
                    "status": achievement_result.status,
                    "retryAfter": achievement_result.retry_after,
                    "source": achievement_result.source.unwrap_or("steam-schema"),
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
pub async fn steam_get_featured(
    app: tauri::AppHandle,
    cc: Option<String>,
) -> Result<serde_json::Value, String> {
    let proxy_url = crate::settings::load_steam_stats_proxy_url();
    let cc = if cc.as_deref() == Some("us") {
        "us"
    } else {
        "br"
    };
    let mut url = reqwest::Url::parse(&format!("{proxy_url}/steam/featured"))
        .map_err(|error| error.to_string())?;
    url.query_pairs_mut().append_pair("cc", cc);
    // Reuses the catalogue disk cache so a featured shelf still has something
    // to show offline, same stale-while-error behavior as the other catalogue
    // endpoints — this path just isn't one `is_valid_catalogue_response`
    // recognizes, so it takes the permissive `_ => true` arm unchanged.
    let (mut value, _updated_at, _from_cache) =
        catalogue_cache::fetch_json_with_cache(&app, url, false).await?;
    filter_featured_demos(&app, &mut value).await;
    Ok(value)
}

#[tauri::command]
pub async fn catalogue_get_home(
    app: tauri::AppHandle,
    api_url: Option<String>,
) -> Result<serde_json::Value, String> {
    let url = remote_url(api_url, "home")?;
    let mut url = url;
    url.query_pairs_mut()
        .append_pair("appTypeVersion", CATALOGUE_APP_TYPE_VERSION);
    let (mut value, updated_at, from_cache) =
        catalogue_cache::fetch_json_with_cache(&app, url, false).await?;
    if let Some(object) = value.as_object_mut() {
        for key in ["popular", "recentlyAdded"] {
            if let Some(games) = object.get(key).and_then(|v| v.as_array()).cloned() {
                object.insert(
                    key.to_string(),
                    Value::Array(filter_demo_games_with_disk_cache(&app, games)),
                );
            }
        }
    }
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

/// Contagem de jogadores de um app, direto do endpoint público da Steam.
///
/// `None` quando a Steam não conhece o app (`result` 42) ou a chamada falha —
/// quem chama omite o jogo do mapa em vez de gravar um zero, que no card seria
/// lido como "ninguém jogando" em vez de "sem dado".
async fn fetch_steam_player_count(client: &reqwest::Client, app_id: &str) -> Option<u64> {
    let response = client
        .get(format!(
            "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid={app_id}"
        ))
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .ok()?
        .json::<Value>()
        .await
        .ok()?;
    let body = response.get("response")?;
    if body.get("result").and_then(Value::as_u64) != Some(1) {
        return None;
    }
    body.get("player_count").and_then(Value::as_u64)
}

/// Jogadores online agora, por app id.
///
/// Existe em vez de reaproveitar o `playingNow` do catálogo porque aquele
/// caminho passa pelo cache em disco de 30 minutos do `catalogue_cache` — bom
/// para dado de catálogo, mas serve contagem de jogadores velha. Aqui o cache
/// é próprio e curto (ver `STEAM_PLAYER_COUNT_TTL_SECS`).
///
/// App ids sem resposta ficam **fora** do mapa: o card distingue "sem dado" de
/// "zero jogadores".
#[tauri::command]
pub async fn steam_get_player_counts(app_ids: Vec<String>) -> HashMap<String, u64> {
    let app_ids: Vec<String> = app_ids
        .into_iter()
        .map(|app_id| {
            app_id
                .chars()
                .filter(char::is_ascii_digit)
                .collect::<String>()
        })
        .filter(|app_id| !app_id.is_empty())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    if app_ids.is_empty() {
        return HashMap::new();
    }

    let cache = STEAM_PLAYER_COUNT_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let ttl = Duration::from_secs(STEAM_PLAYER_COUNT_TTL_SECS);
    let mut counts = HashMap::new();
    let mut missing = Vec::new();
    {
        let entries = cache.lock().ok();
        for app_id in app_ids {
            let cached = entries
                .as_ref()
                .and_then(|entries| entries.get(&app_id))
                .filter(|(sampled_at, _)| sampled_at.elapsed() < ttl)
                .map(|(_, count)| *count);
            match cached {
                Some(count) => {
                    counts.insert(app_id, count);
                }
                None => missing.push(app_id),
            }
        }
    }
    if missing.is_empty() {
        return counts;
    }

    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .build()
    else {
        return counts;
    };

    // Em blocos, não tudo de uma vez: uma Home cheia dispararia dezenas de
    // conexões simultâneas contra o mesmo host.
    for chunk in missing.chunks(STEAM_PLAYER_COUNT_CONCURRENCY) {
        let handles: Vec<_> = chunk
            .iter()
            .map(|app_id| {
                let client = client.clone();
                let app_id = app_id.clone();
                tauri::async_runtime::spawn(async move {
                    let count = fetch_steam_player_count(&client, &app_id).await;
                    (app_id, count)
                })
            })
            .collect();

        let mut fetched = Vec::with_capacity(handles.len());
        for handle in handles {
            if let Ok((app_id, Some(count))) = handle.await {
                fetched.push((app_id, count));
            }
        }

        let sampled_at = Instant::now();
        if let Ok(mut entries) = cache.lock() {
            for (app_id, count) in fetched {
                entries.insert(app_id.clone(), (sampled_at, count));
                counts.insert(app_id, count);
            }
        }
    }

    counts
}

/// Resolve os tipos de apps Steam em lote. A ausência de um app no mapa não é
/// tratada como `game`: callers que exigem exclusão segura devem mantê-lo
/// oculto até uma classificação válida chegar.
#[tauri::command]
pub async fn steam_get_app_types(
    app: tauri::AppHandle,
    app_ids: Vec<String>,
) -> HashMap<String, String> {
    resolve_steam_app_types(&app, &app_ids).await
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
pub async fn cache_get_images(
    app: tauri::AppHandle,
    urls: Vec<String>,
) -> std::collections::HashMap<String, String> {
    use std::collections::{HashMap, HashSet};
    use std::sync::Arc;

    let mut unique_urls = Vec::new();
    let mut seen = HashSet::new();
    for url in urls {
        let trimmed = url.trim().to_string();
        if trimmed.is_empty() || !seen.insert(trimmed.clone()) {
            continue;
        }
        unique_urls.push(trimmed);
    }

    let semaphore = Arc::new(tokio::sync::Semaphore::new(4));
    let mut jobs = tokio::task::JoinSet::new();
    for url in unique_urls {
        let permit = semaphore.clone().acquire_owned().await;
        let app = app.clone();
        jobs.spawn(async move {
            let _permit = permit.ok();
            let resolved = image_cache::cache_image_url(&app, &url).await;
            (url, resolved)
        });
    }

    let mut out = HashMap::new();
    while let Some(result) = jobs.join_next().await {
        if let Ok((url, resolved)) = result {
            out.insert(url, resolved);
        }
    }
    out
}

#[tauri::command]
pub fn cache_lookup_images(
    app: tauri::AppHandle,
    urls: Vec<String>,
) -> std::collections::HashMap<String, String> {
    urls.into_iter()
        .filter_map(|url| {
            let resolved = image_cache::lookup_cached_image(&app, &url);
            (!resolved.is_empty()).then_some((url, resolved))
        })
        .collect()
}

#[tauri::command]
pub async fn cache_resolve_steam_library_asset(
    app: tauri::AppHandle,
    app_id: String,
    file_name: String,
) -> String {
    image_cache::resolve_steam_library_asset_url(&app, &app_id, &file_name).await
}

/// Resolve em um único IPC os hashes de capa SteamTool (portrait/library) para
/// vários jogos de uma vez. Cada request é `{ appId, fileName }`; a resposta é
/// um mapa `"appId|fileName" -> url resolvida`. Substitui o padrão de um
/// `invoke(cache_resolve_steam_library_asset)` por card visível, multiplicando
/// I/O síncrono e IPCs no primeiro paint da biblioteca.
#[tauri::command]
pub async fn cache_resolve_steam_library_assets_batch(
    app: tauri::AppHandle,
    requests: Vec<serde_json::Value>,
) -> std::collections::HashMap<String, String> {
    use std::collections::HashMap;
    let mut out = HashMap::new();
    for request in requests {
        let app_id = request
            .get("appId")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let file_name = request
            .get("fileName")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if app_id.is_empty() || file_name.is_empty() {
            continue;
        }
        let url = image_cache::resolve_steam_library_asset_url(&app, &app_id, &file_name).await;
        out.insert(format!("{app_id}|{file_name}"), url);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{
        is_cached_icon_source, is_ico_icon_url, is_valid_ico_bytes,
        merge_cached_steam_store_details, merge_normalized_steam_details,
        merge_steam_store_details, normalize_achievement,
        normalize_achievement_image_url, read_client_icon_from_vdf, steam_details_have_about,
        steam_app_data, steam_details_have_drm_field, steam_reviews_response_is_usable,
        steam_store_details_from_store_data, steam_store_search_games, validate_steam_store_search,
    };

    #[test]
    fn legacy_achievement_host_rewrites_to_community_assets() {
        assert_eq!(
            normalize_achievement_image_url(
                "https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/4126040/6fb538bf162c55ef259d472e3997029312fba58a.jpg"
            ),
            "https://shared.fastly.steamstatic.com/community_assets/images/apps/4126040/6fb538bf162c55ef259d472e3997029312fba58a.jpg"
        );
        assert_eq!(
            normalize_achievement_image_url(
                "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/4126040/57549aa3549c240d4533b896b32cc9a7e0e8a202.jpg"
            ),
            "https://shared.fastly.steamstatic.com/community_assets/images/apps/4126040/57549aa3549c240d4533b896b32cc9a7e0e8a202.jpg"
        );
        assert_eq!(normalize_achievement_image_url(""), "");
        assert_eq!(
            normalize_achievement_image_url("https://example.com/a.jpg"),
            "https://example.com/a.jpg"
        );
    }

    #[test]
    fn normalize_achievement_rewrites_legacy_icon_hosts() {
        let achievement = serde_json::json!({
            "name": "NEW_ACHIEVEMENT_1",
            "displayName": "First Step into a New World",
            "icon": "https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/4126040/6fb538bf162c55ef259d472e3997029312fba58a.jpg",
            "icongray": "https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/4126040/f73bf6e5f6b7557553c8296736d738e874e77360.jpg"
        });
        let normalized = normalize_achievement(&achievement).unwrap();
        assert_eq!(
            normalized["icon"],
            "https://shared.fastly.steamstatic.com/community_assets/images/apps/4126040/6fb538bf162c55ef259d472e3997029312fba58a.jpg"
        );
        assert_eq!(
            normalized["iconGray"],
            "https://shared.fastly.steamstatic.com/community_assets/images/apps/4126040/f73bf6e5f6b7557553c8296736d738e874e77360.jpg"
        );
    }

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
        assert_eq!(
            merged["pcRequirements"]["minimum"],
            previous["pcRequirements"]["minimum"]
        );
        assert_eq!(
            merged["pcRequirements"]["recommended"],
            next["pcRequirements"]["recommended"]
        );
    }

    #[test]
    fn alternate_store_key_preserves_about_and_drm_only_for_matching_app() {
        let payload = serde_json::json!({"4460240": {"success": true, "data": {
            "steam_appid": 3764200,
            "about_the_game": "Resident Evil Requiem description",
            "drm_notice": "Denuvo Anti-tamper<br>5 activations"
        }}});
        let data = steam_app_data(&payload, "3764200").unwrap();
        let mut game = serde_json::json!({"appId": "3764200"});
        merge_steam_store_details(&mut game, data);
        assert_eq!(game["aboutTheGame"], data["about_the_game"]);
        assert_eq!(game["drmNotice"], data["drm_notice"]);
        assert!(steam_app_data(&payload, "4460240").is_none());
        assert!(steam_app_data(&serde_json::json!({"2": {"success": true, "data": {}}}), "1").is_none());
        assert!(steam_app_data(&serde_json::json!({"2": {"success": false, "data": {"steam_appid": 1}}}), "1").is_none());
    }

    #[test]
    fn drm_notice_survives_proxy_and_direct_store_paths_and_can_be_cleared() {
        let with_drm = serde_json::json!({
            "drm_notice": "  Incorporates 3rd-party DRM: Denuvo  "
        });
        let mut direct_game = serde_json::json!({"appId": "1"});
        merge_steam_store_details(&mut direct_game, &with_drm);
        assert_eq!(direct_game["drmNotice"], "Incorporates 3rd-party DRM: Denuvo");

        let normalized = steam_store_details_from_store_data(&with_drm);
        let mut proxy_game = serde_json::json!({"appId": "1"});
        merge_normalized_steam_details(&mut proxy_game, &normalized);
        assert_eq!(proxy_game["drmNotice"], direct_game["drmNotice"]);

        let cleared = merge_cached_steam_store_details(
            Some(&normalized),
            &serde_json::json!({"drmNotice": ""}),
        );
        assert!(steam_details_have_drm_field(&cleared));
        assert_eq!(cleared["drmNotice"], "");
        merge_normalized_steam_details(&mut proxy_game, &cleared);
        assert_eq!(proxy_game["drmNotice"], "");

        merge_steam_store_details(&mut direct_game, &serde_json::json!({}));
        assert_eq!(direct_game["drmNotice"], "");
    }

    #[test]
    fn old_proxy_without_drm_field_requires_direct_store_fallback() {
        let old_proxy = serde_json::json!({
            "aboutTheGame": "About",
            "controllerSupport": "none",
            "supportedLanguages": "English",
        });
        assert!(!steam_details_have_drm_field(&old_proxy));
        let no_drm = steam_store_details_from_store_data(&serde_json::json!({}));
        assert!(steam_details_have_drm_field(&no_drm));
        assert_eq!(no_drm["drmNotice"], "");
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

        assert_eq!(
            read_client_icon_from_vdf(&bytes, "2138720"),
            Some(hash.to_string())
        );
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
        assert!(!is_cached_icon_source(
            "3602290",
            &format!("https://example.com/{hash}.jpg")
        ));
    }

    #[test]
    fn shortcut_icon_accepts_only_community_ico_urls() {
        let hash = "4cc8c99722309845b2c4775902ace66f468303ec";
        assert!(is_ico_icon_url(
            "3602290",
            &format!("https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/3602290/{hash}.ico"),
        ));
        assert!(!is_ico_icon_url(
            "3602290",
            &format!("https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/3602290/{hash}.jpg"),
        ));
        assert!(!is_ico_icon_url(
            "3602290",
            "C:\\Steam\\steam\\games\\3602290.ico",
        ));
    }

    #[test]
    fn shortcut_icon_validates_ico_magic() {
        assert!(is_valid_ico_bytes(&[
            0, 0, 1, 0, 1, 0, 32, 32, 0, 0, 1, 0, 24, 0, 0, 0, 0, 0, 22, 0, 0, 0, 1
        ]));
        assert!(!is_valid_ico_bytes(&[0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 1, 0]));
        assert!(!is_valid_ico_bytes(&[]));
    }

    #[test]
    fn steam_store_search_validates_query_and_limit() {
        assert!(validate_steam_store_search("ab", 20).is_err());
        assert_eq!(
            validate_steam_store_search("10", 100).unwrap(),
            ("10".into(), 20)
        );
        assert_eq!(
            validate_steam_store_search(" FragPunk ", 0).unwrap(),
            ("FragPunk".into(), 1)
        );
    }

    #[test]
    fn steam_store_search_maps_only_apps_to_catalogue_games() {
        let games = steam_store_search_games(
            &serde_json::json!({
                "items": [
                    { "type": "app", "id": 2943650, "name": "FragPunk" },
                    { "type": "bundle", "id": 1, "name": "Bundle" }
                ]
            }),
            20,
        );
        assert_eq!(games.len(), 1);
        assert_eq!(games[0]["appId"], "2943650");
        assert_eq!(games[0]["title"], "FragPunk");
    }
}
