use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

pub const CATALOGUE_CACHE_UPDATED_EVENT: &str = "catalogue-cache-updated";
const CATALOGUE_META_FILE: &str = "meta.json";
const SCHEDULER_POLL_MS: u64 = 30 * 60 * 1000;
const STARTUP_REFRESH_DELAY_MS: u64 = 5_000;

static SCHEDULER_STARTED: OnceLock<()> = OnceLock::new();

#[derive(Debug, serde::Serialize, serde::Deserialize, Default)]
struct CatalogueCacheMeta {
    last_refresh_at: u64,
    last_updated_at: Option<String>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct CatalogueCacheEntry {
    cached_at: u64,
    updated_at: Option<String>,
    body: serde_json::Value,
}

fn current_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn hash_cache_key(value: &str) -> String {
    Sha256::digest(value.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub fn cache_key_for_url(url: &str) -> String {
    hash_cache_key(url)
}

fn catalogue_cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("cache")
        .join("catalogue");
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn cache_entry_path(app: &AppHandle, cache_key: &str) -> Result<PathBuf, String> {
    Ok(catalogue_cache_root(app)?
        .join("entries")
        .join(format!("{cache_key}.json")))
}

fn meta_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(catalogue_cache_root(app)?.join(CATALOGUE_META_FILE))
}

fn read_meta(app: &AppHandle) -> CatalogueCacheMeta {
    let Ok(path) = meta_path(app) else {
        return CatalogueCacheMeta::default();
    };
    let Ok(contents) = std::fs::read_to_string(path) else {
        return CatalogueCacheMeta::default();
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

fn write_meta(app: &AppHandle, meta: &CatalogueCacheMeta) -> Result<(), String> {
    let path = meta_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(
        &path,
        serde_json::to_string_pretty(meta).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

fn read_cache_entry(app: &AppHandle, cache_key: &str) -> Option<CatalogueCacheEntry> {
    let path = cache_entry_path(app, cache_key).ok()?;
    let contents = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&contents).ok()
}

fn write_cache_entry(
    app: &AppHandle,
    cache_key: &str,
    updated_at: Option<String>,
    body: &serde_json::Value,
) -> Result<(), String> {
    let path = cache_entry_path(app, cache_key)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let entry = CatalogueCacheEntry {
        cached_at: current_millis(),
        updated_at,
        body: body.clone(),
    };
    std::fs::write(
        path,
        serde_json::to_string(&entry).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

pub fn normalize_update_interval_hours(value: Option<u64>) -> u64 {
    match value {
        Some(24 | 72 | 168 | 288 | 720) => value.unwrap(),
        _ => 24,
    }
}

pub fn update_interval_from_settings(settings: &serde_json::Value) -> u64 {
    normalize_update_interval_hours(
        settings
            .get("gameDatabaseUpdateIntervalHours")
            .and_then(|value| value.as_u64()),
    )
}

async fn fetch_json_from_network(
    url: reqwest::Url,
) -> Result<(serde_json::Value, Option<String>), String> {
    let response = reqwest::Client::new()
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    let updated_at = response
        .headers()
        .get("x-piratebox-updated-at")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let body = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| error.to_string())?;
    Ok((body, updated_at))
}

pub async fn fetch_json_with_cache(
    app: &AppHandle,
    url: reqwest::Url,
    force_refresh: bool,
) -> Result<(serde_json::Value, Option<String>, bool), String> {
    let cache_key = cache_key_for_url(url.as_str());

    if !force_refresh {
        if let Some(entry) = read_cache_entry(app, &cache_key) {
            return Ok((entry.body, entry.updated_at, true));
        }
    }

    match fetch_json_from_network(url.clone()).await {
        Ok((body, updated_at)) => {
            let _ = write_cache_entry(app, &cache_key, updated_at.clone(), &body);
            Ok((body, updated_at, false))
        }
        Err(error) => {
            if let Some(entry) = read_cache_entry(app, &cache_key) {
                return Ok((entry.body, entry.updated_at, true));
            }
            Err(error)
        }
    }
}

fn inject_updated_at(value: &mut serde_json::Value, updated_at: Option<String>) {
    if updated_at.is_none() {
        return;
    }
    if let Some(object) = value.as_object_mut() {
        if object.get("updatedAt").is_none() {
            object.insert("updatedAt".to_string(), serde_json::json!(updated_at));
        }
    }
}

pub fn apply_cached_source(value: &mut serde_json::Value, from_cache: bool) {
    if !from_cache {
        return;
    }
    if let Some(object) = value.as_object_mut() {
        object.insert("source".to_string(), serde_json::json!("cached"));
    }
}

pub async fn refresh_warm_catalogue_endpoints(
    app: &AppHandle,
    api_url: Option<String>,
) -> Option<String> {
    let base = crate::normalize_api_url(api_url);
    let mut latest_updated_at: Option<String> = None;

    let home_url = format!("{base}/home");
    if let Ok(url) = reqwest::Url::parse(&home_url) {
        if let Ok((_, updated_at, _)) = fetch_json_with_cache(app, url, true).await {
            if updated_at.is_some() {
                latest_updated_at = updated_at;
            }
        }
    }

    let search_url = format!(
        "{base}/catalogue/search?limit=200&offset=0&sort=popular&includeFacets=1&facetsVersion={}&rankingVersion={}",
        crate::FACETS_VERSION,
        crate::RANKING_VERSION
    );
    if let Ok(url) = reqwest::Url::parse(&search_url) {
        if let Ok((_, updated_at, _)) = fetch_json_with_cache(app, url, true).await {
            latest_updated_at = updated_at.or(latest_updated_at);
        }
    }

    let now = current_millis();
    let meta = CatalogueCacheMeta {
        last_refresh_at: now,
        last_updated_at: latest_updated_at.clone(),
    };
    let _ = write_meta(app, &meta);

    if let Some(updated_at) = latest_updated_at.clone() {
        let _ = app.emit(
            CATALOGUE_CACHE_UPDATED_EVENT,
            serde_json::json!({ "updatedAt": updated_at }),
        );
    }

    latest_updated_at
}

fn should_refresh(meta: &CatalogueCacheMeta, interval_hours: u64) -> bool {
    if meta.last_refresh_at == 0 {
        return true;
    }
    let interval_ms = interval_hours.saturating_mul(60 * 60 * 1000);
    current_millis().saturating_sub(meta.last_refresh_at) >= interval_ms
}

pub fn start_catalogue_refresh_scheduler(app: AppHandle) {
    if SCHEDULER_STARTED.set(()).is_err() {
        return;
    }

    let startup_app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(STARTUP_REFRESH_DELAY_MS));
        let settings = crate::load_startup_settings(&startup_app);
        let interval_hours = update_interval_from_settings(&settings);
        let meta = read_meta(&startup_app);
        if should_refresh(&meta, interval_hours) {
            let handle = startup_app.clone();
            tauri::async_runtime::spawn(async move {
                refresh_warm_catalogue_endpoints(&handle, None).await;
            });
        }
    });

    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(SCHEDULER_POLL_MS));

        let settings = crate::load_startup_settings(&app);
        let interval_hours = update_interval_from_settings(&settings);
        let meta = read_meta(&app);
        if !should_refresh(&meta, interval_hours) {
            continue;
        }

        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            refresh_warm_catalogue_endpoints(&handle, None).await;
        });
    });
}

pub fn prepare_cached_response(
    value: &mut serde_json::Value,
    updated_at: Option<String>,
    from_cache: bool,
) {
    inject_updated_at(value, updated_at);
    apply_cached_source(value, from_cache);
}
