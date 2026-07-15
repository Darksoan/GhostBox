use crate::util::{silent_steamcmd_output, with_steamcmd_lock};
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
    let first_asset_part = parts.get(apps_index + 3)?.to_string();
    let second_asset_part = parts.get(apps_index + 4).copied().unwrap_or_default();
    let file_name = steam_asset_file_name(&first_asset_part, second_asset_part)?;
    if !app_id.chars().all(|character| character.is_ascii_digit()) {
        return None;
    }
    Some((app_id, file_name))
}

fn steam_asset_file_name(first_asset_part: &str, second_asset_part: &str) -> Option<String> {
    let first_asset_part = percent_decode(first_asset_part)?;
    let second_asset_part = percent_decode(second_asset_part)?;

    let dotted_asset = first_asset_part
        .split_once('.')
        .and_then(|(hash, asset)| is_hex_hash(hash).then_some(asset.to_string()));
    let asset = dotted_asset.unwrap_or_else(|| {
        if is_hex_hash(&first_asset_part) {
            second_asset_part
        } else {
            first_asset_part
        }
    });

    is_safe_library_asset_file_name(&asset).then_some(normalize_library_asset_name(&asset))
}

fn percent_decode(value: &str) -> Option<String> {
    let mut output = String::new();
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = std::str::from_utf8(bytes.get(index + 1..index + 3)?).ok()?;
            let byte = u8::from_str_radix(hex, 16).ok()?;
            output.push(byte as char);
            index += 3;
        } else {
            output.push(bytes[index] as char);
            index += 1;
        }
    }
    Some(output)
}

fn is_hex_hash(value: &str) -> bool {
    value.len() >= 20 && value.chars().all(|character| character.is_ascii_hexdigit())
}

fn is_safe_library_asset_file_name(value: &str) -> bool {
    value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '.' | '-'))
        && value.contains('.')
}

fn normalize_library_asset_name(file_name: &str) -> String {
    match file_name.to_ascii_lowercase().as_str() {
        "library_capsule.jpg" => "library_600x900.jpg".to_string(),
        "library_capsule_2x.jpg" => "library_600x900_2x.jpg".to_string(),
        _ => file_name.to_string(),
    }
}

fn legacy_library_capsule_alias(file_name: &str) -> Option<&'static str> {
    match file_name.to_ascii_lowercase().as_str() {
        "library_600x900.jpg" => Some("library_capsule.jpg"),
        "library_600x900_2x.jpg" => Some("library_capsule_2x.jpg"),
        _ => None,
    }
}

fn library_asset_file_candidates(file_name: &str) -> Vec<&'static str> {
    match file_name.to_ascii_lowercase().as_str() {
        "header.jpg" => vec!["header.jpg", "capsule_616x353.jpg"],
        "capsule_616x353.jpg" => vec!["capsule_616x353.jpg", "header.jpg"],
        "hero_capsule.jpg" => vec![
            "hero_capsule.jpg",
            "library_600x900.jpg",
            "library_capsule.jpg",
            "library_600x900_2x.jpg",
            "library_capsule_2x.jpg",
        ],
        "library_600x900.jpg" => vec![
            "library_600x900.jpg",
            "library_capsule.jpg",
            "library_600x900_2x.jpg",
            "library_capsule_2x.jpg",
        ],
        "library_600x900_2x.jpg" => vec![
            "library_600x900.jpg",
            "library_capsule.jpg",
            "library_600x900_2x.jpg",
            "library_capsule_2x.jpg",
        ],
        "library_capsule.jpg" => vec![
            "library_capsule.jpg",
            "library_600x900.jpg",
            "library_capsule_2x.jpg",
            "library_600x900_2x.jpg",
        ],
        "library_capsule_2x.jpg" => vec![
            "library_capsule.jpg",
            "library_600x900.jpg",
            "library_capsule_2x.jpg",
            "library_600x900_2x.jpg",
        ],
        "library_logo.png" => vec!["library_logo.png", "logo.png"],
        _ => Vec::new(),
    }
}

fn standard_library_asset_url(source_url: &str) -> Option<String> {
    let replacements = [
        ("library_600x900_2x.jpg", "library_600x900.jpg"),
        ("library_capsule_2x.jpg", "library_capsule.jpg"),
    ];

    for (from, to) in replacements {
        if source_url.to_ascii_lowercase().ends_with(from) {
            let prefix = &source_url[..source_url.len() - from.len()];
            return Some(format!("{prefix}{to}"));
        }
    }

    None
}

fn library_asset_cache_paths(app: &AppHandle) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        paths.push(app_data_dir.join("steamcmd-library-asset-cache.json"));
    }
    if let Some(app_data) = std::env::var_os("APPDATA") {
        let app_data = PathBuf::from(app_data);
        paths.push(
            app_data
                .join("GhostBox")
                .join("steamcmd-library-asset-cache.json"),
        );
        paths.push(
            app_data
                .join("Eden")
                .join("steamcmd-library-asset-cache.json"),
        );
        paths.push(
            app_data
                .join("piratebox")
                .join("steamcmd-library-asset-cache.json"),
        );
    }
    paths
}

fn read_library_asset_cache_url(app: &AppHandle, app_id: &str, file_name: &str) -> Option<String> {
    for path in library_asset_cache_paths(app) {
        let Some(contents) = std::fs::read_to_string(path).ok() else {
            continue;
        };
        let Some(cache) = serde_json::from_str::<serde_json::Value>(&contents).ok() else {
            continue;
        };
        let Some(url) = cache
            .get(app_id)
            .and_then(|entry| entry.get(file_name))
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        return Some(url.to_string());
    }
    None
}

fn write_library_asset_cache_url(app: &AppHandle, app_id: &str, file_name: &str, url: &str) {
    let Ok(app_data_dir) = app.path().app_data_dir() else {
        return;
    };
    let path = app_data_dir.join("steamcmd-library-asset-cache.json");
    let mut cache = std::fs::read_to_string(&path)
        .ok()
        .and_then(|contents| serde_json::from_str::<serde_json::Value>(&contents).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    if !cache.is_object() {
        cache = serde_json::json!({});
    }
    if cache.get(app_id).is_none() {
        cache[app_id] = serde_json::json!({});
    }
    cache[app_id][file_name] = serde_json::json!(url);

    if let Some(alias) = legacy_library_capsule_alias(file_name) {
        cache[app_id][alias] = serde_json::json!(url);
    }

    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(contents) = serde_json::to_string(&cache) {
        let _ = std::fs::write(path, contents);
    }
}

fn sanitize_library_asset_reference(value: &str, app_id: &str) -> Option<String> {
    let mut normalized = value
        .trim()
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_string();
    if normalized.is_empty() {
        return None;
    }

    if let Ok(url) = reqwest::Url::parse(&normalized) {
        let parts = url.path_segments()?.collect::<Vec<_>>();
        let apps_index = parts
            .windows(2)
            .position(|window| window[0] == "steam" && window[1] == "apps")?;
        if parts.get(apps_index + 2)? != &app_id {
            return None;
        }
        normalized = parts[apps_index + 3..].join("/");
    } else {
        normalized = normalized
            .split(['?', '#'])
            .next()
            .unwrap_or_default()
            .to_string();
    }

    normalized = percent_decode(&normalized)?;
    let parts = normalized.split('/').collect::<Vec<_>>();
    let is_valid_reference = parts.iter().all(|part| {
        part.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '.' | '-')
        })
    }) && (is_hex_hash(&normalized) || parts.len() <= 2);

    is_valid_reference.then_some(normalized)
}

fn extract_library_asset_reference(value: &str, app_id: &str) -> Option<String> {
    if let Some(reference) = sanitize_library_asset_reference(value, app_id) {
        return Some(reference);
    }

    for token in value.split(|character: char| {
        !(character.is_ascii_alphanumeric() || matches!(character, '_' | '.' | '-' | '/' | '\\'))
    }) {
        if let Some(reference) = sanitize_library_asset_reference(token, app_id) {
            return Some(reference);
        }
    }

    None
}

fn library_asset_path_candidates(asset_reference: &str, file_name: &str) -> Vec<String> {
    let Some(reference) = sanitize_library_asset_reference(asset_reference, "") else {
        return Vec::new();
    };

    if is_hex_hash(&reference) {
        let alias = legacy_library_capsule_alias(file_name);
        return [
            alias.map(|alias| format!("{reference}.{alias}")),
            Some(format!("{reference}.{file_name}")),
            Some(format!("{reference}/{file_name}")),
            alias.map(|alias| format!("{reference}/{alias}")),
        ]
        .into_iter()
        .flatten()
        .collect();
    }

    vec![reference]
}

fn build_library_asset_url(app_id: &str, asset_path: &str) -> String {
    format!(
        "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/{app_id}/{asset_path}"
    )
}

fn read_library_asset_hash_from_vdf(data: &[u8], app_id: &str, asset_name: &str) -> Option<String> {
    let app_id = app_id.parse::<u32>().ok()?;
    let app_id_bytes = app_id.to_le_bytes();
    let key = format!("{asset_name}\0").into_bytes();
    let mut pos = 0usize;

    while pos + app_id_bytes.len() < data.len() {
        let Some(relative_index) = data[pos..]
            .windows(app_id_bytes.len())
            .position(|window| window == app_id_bytes)
        else {
            break;
        };
        let index = pos + relative_index;
        let section_end = (index + 65536).min(data.len());
        let section = &data[index..section_end];

        if let Some(key_index) = section.windows(key.len()).position(|window| window == key) {
            let value_start = key_index + key.len();
            if let Some(value_end) = section[value_start..].iter().position(|byte| *byte == 0) {
                let value = String::from_utf8_lossy(&section[value_start..value_start + value_end]);
                if let Some(reference) =
                    extract_library_asset_reference(&value, &app_id.to_string())
                {
                    return Some(reference);
                }
            }
        }

        pos = index + app_id_bytes.len();
    }

    None
}

fn get_library_asset_hash_from_vdf(
    app: &AppHandle,
    app_id: &str,
    asset_name: &str,
) -> Option<String> {
    let (steam_path, _) = crate::resolve_steam_path(app, None);
    let steam_path = steam_path?;
    let vdf_path = Path::new(&steam_path).join("appcache").join("appinfo.vdf");
    let bytes = std::fs::read(vdf_path).ok()?;
    read_library_asset_hash_from_vdf(&bytes, app_id, asset_name)
}

fn steamcmd_candidates(app: &AppHandle) -> Vec<PathBuf> {
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

fn quoted_field_value(value: &str, field_name: &str) -> Option<String> {
    let marker = format!("\"{field_name}\"");
    let marker_index = value.find(&marker)?;
    let after_marker = &value[marker_index + marker.len()..];
    let value_start = after_marker.find('"')? + 1;
    let after_quote = &after_marker[value_start..];
    let value_end = after_quote.find('"')?;
    Some(after_quote[..value_end].to_string())
}

fn get_library_asset_hash_from_steamcmd(
    app: &AppHandle,
    app_id: &str,
    file_name: &str,
) -> Option<String> {
    let steamcmd = steamcmd_candidates(app)
        .into_iter()
        .find(|candidate| candidate.exists())?;
    let output = with_steamcmd_lock(|| silent_steamcmd_output(&steamcmd, app_id))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let asset_name = file_name
        .rsplit_once('.')
        .map(|(name, _)| name)
        .unwrap_or(file_name);
    let field_reference = quoted_field_value(&stdout, asset_name)
        .and_then(|value| extract_library_asset_reference(&value, app_id));
    if field_reference.is_some() {
        return field_reference;
    }

    stdout
        .lines()
        .find(|line| line.contains(file_name))
        .and_then(|line| extract_library_asset_reference(line, app_id))
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

async fn request_image_url_available(
    client: &reqwest::Client,
    source_url: &str,
    method: reqwest::Method,
) -> bool {
    let mut request = client.request(method.clone(), source_url).header(
        reqwest::header::ACCEPT,
        "image/avif,image/webp,image/png,image/jpeg,image/*,*/*",
    );
    if method == reqwest::Method::GET {
        request = request.header(reqwest::header::RANGE, "bytes=0-0");
    }

    request
        .send()
        .await
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}

async fn is_image_url_available(client: &reqwest::Client, source_url: &str) -> bool {
    request_image_url_available(client, source_url, reqwest::Method::HEAD).await
        || request_image_url_available(client, source_url, reqwest::Method::GET).await
}

async fn available_library_asset_url(client: &reqwest::Client, source_url: &str) -> Option<String> {
    if let Some(standard_url) = standard_library_asset_url(source_url) {
        if is_image_url_available(client, &standard_url).await {
            return Some(standard_url);
        }
    }

    if is_image_url_available(client, source_url).await {
        return Some(source_url.to_string());
    }

    None
}

async fn resolve_library_asset_url(
    app: &AppHandle,
    client: &reqwest::Client,
    app_id: &str,
    file_name: &str,
) -> Option<String> {
    for candidate_file_name in library_asset_file_candidates(file_name) {
        if let Some(cached_url) = read_library_asset_cache_url(app, app_id, candidate_file_name) {
            if let Some(available_url) = available_library_asset_url(client, &cached_url).await {
                write_library_asset_cache_url(app, app_id, file_name, &available_url);
                write_library_asset_cache_url(app, app_id, candidate_file_name, &available_url);
                return Some(available_url);
            }
        }

        let asset_name = candidate_file_name
            .rsplit_once('.')
            .map(|(name, _)| name)
            .unwrap_or(candidate_file_name);
        let asset_reference = get_library_asset_hash_from_vdf(app, app_id, asset_name)
            .or_else(|| get_library_asset_hash_from_steamcmd(app, app_id, candidate_file_name));
        let Some(asset_reference) = asset_reference else {
            continue;
        };

        for asset_path in library_asset_path_candidates(&asset_reference, candidate_file_name) {
            let candidate_url = build_library_asset_url(app_id, &asset_path);
            if let Some(available_url) = available_library_asset_url(client, &candidate_url).await {
                write_library_asset_cache_url(app, app_id, file_name, &available_url);
                write_library_asset_cache_url(app, app_id, candidate_file_name, &available_url);
                return Some(available_url);
            }
        }
    }

    None
}

pub async fn resolve_steam_library_asset_url(
    app: &AppHandle,
    app_id: &str,
    file_name: &str,
) -> String {
    let app_id = app_id.trim();
    let file_name = file_name.trim();
    if !app_id.chars().all(|character| character.is_ascii_digit())
        || !is_safe_library_asset_file_name(file_name)
    {
        return String::new();
    }

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(client) => client,
        Err(_) => return String::new(),
    };

    resolve_library_asset_url(app, &client, app_id, file_name)
        .await
        .unwrap_or_default()
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
    let steam_asset_request = steam_asset_fallback_request(url);

    if let Some((app_id, file_name)) = steam_asset_request.as_ref() {
        if let Some(cached_url) = read_library_asset_cache_url(app, app_id, file_name) {
            if let Some(available_url) = available_library_asset_url(&client, &cached_url).await {
                write_library_asset_cache_url(app, app_id, file_name, &available_url);
                return available_url;
            }
        }
    }

    if let Some(path) = fetch_and_cache_image(&client, &directory, url).await {
        return path.to_string_lossy().into_owned();
    }

    if let Some((app_id, file_name)) = steam_asset_request {
        let fallback_url = crate::steam_asset_url(&app_id, &file_name);
        if fallback_url != url {
            if let Some(path) = fetch_and_cache_image(&client, &directory, &fallback_url).await {
                return path.to_string_lossy().into_owned();
            }
        }

        if let Some(alias) = legacy_library_capsule_alias(&file_name) {
            let fallback_url = crate::steam_asset_url(&app_id, alias);
            if fallback_url != url {
                if let Some(path) = fetch_and_cache_image(&client, &directory, &fallback_url).await
                {
                    return path.to_string_lossy().into_owned();
                }
            }
        }

        if let Some(fallback_url) =
            resolve_library_asset_url(app, &client, &app_id, &file_name).await
        {
            return fallback_url;
        }
    }

    String::new()
}
