use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const MAX_CACHED_IMAGE_BYTES: usize = 8 * 1024 * 1024;
const IMAGE_CACHE_MAX_AGE_MS: u128 = 30 * 24 * 60 * 60 * 1000;
const IMAGE_CACHE_MAX_TOTAL_BYTES: u64 = 512 * 1024 * 1024;
const IMAGE_CACHE_CLEANUP_INTERVAL_MS: u64 = 6 * 60 * 60 * 1000;

static CLEANUP_STARTED: OnceLock<()> = OnceLock::new();

fn image_cache_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("cache")
        .join("images");
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn current_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn is_private_or_local_hostname(hostname: &str) -> bool {
    let host = hostname.to_ascii_lowercase();
    if ["localhost", "0.0.0.0", "127.0.0.1", "::1"].contains(&host.as_str()) {
        return true;
    }
    if host.ends_with(".local") || host.ends_with(".localhost") {
        return true;
    }

    let octets = host
        .split('.')
        .map(|part| part.parse::<u16>().ok())
        .collect::<Option<Vec<_>>>();
    let Some(octets) = octets else {
        return false;
    };
    if octets.len() != 4 {
        return false;
    }

    let [first, second, _, _] = [octets[0], octets[1], octets[2], octets[3]];
    if first == 10 || first == 127 || first == 0 {
        return true;
    }
    if first == 172 && (16..=31).contains(&second) {
        return true;
    }
    if first == 192 && second == 168 {
        return true;
    }
    first == 169 && second == 254
}

pub fn is_safe_remote_https_url(url_value: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url_value.trim()) else {
        return false;
    };
    parsed.scheme() == "https"
        && parsed
            .host_str()
            .is_some_and(|host| !is_private_or_local_hostname(host))
}

fn hash_url(url: &str) -> String {
    Sha256::digest(url.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn image_extension(url: &str, content_type: &str) -> &'static str {
    let content_type = content_type.to_ascii_lowercase();
    if content_type.contains("png") {
        return ".png";
    }
    if content_type.contains("webp") {
        return ".webp";
    }
    if content_type.contains("jpeg") || content_type.contains("jpg") {
        return ".jpg";
    }

    let pathname = reqwest::Url::parse(url)
        .map(|parsed| parsed.path().to_ascii_lowercase())
        .unwrap_or_default();
    if pathname.ends_with(".png") {
        return ".png";
    }
    if pathname.ends_with(".webp") {
        return ".webp";
    }
    if pathname.ends_with(".jpeg") || pathname.ends_with(".jpg") {
        return ".jpg";
    }

    ".img"
}

fn existing_cached_file(directory: &Path, url: &str) -> Option<PathBuf> {
    let hash = hash_url(url);
    for extension in [".jpg", ".png", ".webp", ".img"] {
        let candidate = directory.join(format!("{hash}{extension}"));
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn steam_asset_fallback_request(url: &str) -> Option<(String, String)> {
    let parsed = reqwest::Url::parse(url).ok()?;
    if !parsed.host_str()?.ends_with("steamstatic.com") {
        return None;
    }

    let parts = parsed
        .path_segments()
        .map(|segments| segments.collect::<Vec<_>>())
        .unwrap_or_default();
    let apps_index = parts
        .windows(2)
        .position(|window| window[0] == "steam" && window[1] == "apps")?;
    let app_id = parts.get(apps_index + 2)?.to_string();
    let file_name = parts.get(apps_index + 3)?.to_string();
    if !app_id.chars().all(|character| character.is_ascii_digit()) {
        return None;
    }
    if !file_name
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '.' | '-'))
    {
        return None;
    }
    Some((app_id, file_name))
}

async fn fetch_and_cache_image(
    client: &reqwest::Client,
    directory: &Path,
    source_url: &str,
) -> Option<PathBuf> {
    if !is_safe_remote_https_url(source_url) {
        return None;
    }

    if let Some(existing) = existing_cached_file(directory, source_url) {
        return Some(existing);
    }

    let response = client
        .get(source_url)
        .header(
            reqwest::header::ACCEPT,
            "image/avif,image/webp,image/png,image/jpeg,image/*,*/*",
        )
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    if !content_type.is_empty() && !content_type.to_ascii_lowercase().starts_with("image/") {
        return None;
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_CACHED_IMAGE_BYTES as u64)
    {
        return None;
    }

    let bytes = response.bytes().await.ok()?;
    if bytes.len() > MAX_CACHED_IMAGE_BYTES {
        return None;
    }

    let hash = hash_url(source_url);
    let file_path = directory.join(format!(
        "{hash}{}",
        image_extension(source_url, &content_type)
    ));
    std::fs::write(&file_path, bytes).ok()?;
    Some(file_path)
}

pub fn cleanup_image_cache(app: &AppHandle) {
    let Ok(directory) = image_cache_directory(app) else {
        return;
    };
    let Ok(entries) = std::fs::read_dir(&directory) else {
        return;
    };

    let now = current_millis();
    let mut files = Vec::new();
    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        files.push((entry.path(), metadata.len(), modified));
    }

    files.retain(|(path, _, modified)| {
        if now.saturating_sub(*modified) <= IMAGE_CACHE_MAX_AGE_MS {
            return true;
        }
        std::fs::remove_file(path).is_ok()
    });

    let mut total_bytes = files.iter().map(|(_, size, _)| *size).sum::<u64>();
    if total_bytes <= IMAGE_CACHE_MAX_TOTAL_BYTES {
        return;
    }

    files.sort_by_key(|(_, _, modified)| *modified);
    for (path, size, _) in files {
        if total_bytes <= IMAGE_CACHE_MAX_TOTAL_BYTES {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total_bytes = total_bytes.saturating_sub(size);
        }
    }
}

pub fn start_image_cache_cleanup(app: AppHandle) {
    if CLEANUP_STARTED.set(()).is_err() {
        return;
    }

    cleanup_image_cache(&app);
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(IMAGE_CACHE_CLEANUP_INTERVAL_MS));
        cleanup_image_cache(&app);
    });
}

pub async fn cache_image_url(app: &AppHandle, url_value: &str) -> String {
    let url = url_value.trim();
    if url.is_empty() || !is_safe_remote_https_url(url) {
        return String::new();
    }

    let directory = match image_cache_directory(app) {
        Ok(directory) => directory,
        Err(_) => return String::new(),
    };

    if let Some(existing) = existing_cached_file(&directory, url) {
        return existing.to_string_lossy().into_owned();
    }

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(client) => client,
        Err(_) => return String::new(),
    };

    if let Some(path) = fetch_and_cache_image(&client, &directory, url).await {
        return path.to_string_lossy().into_owned();
    }

    if let Some((app_id, file_name)) = steam_asset_fallback_request(url) {
        let fallback_url = crate::steam_asset_url(&app_id, &file_name);
        if fallback_url != url {
            if let Some(path) = fetch_and_cache_image(&client, &directory, &fallback_url).await {
                return path.to_string_lossy().into_owned();
            }
        }
    }

    String::new()
}
