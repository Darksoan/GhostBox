//! Resolução de assets da Steam (capas, headers, ícone do jogo).
//!
//! Jogos publicados depois da migração de assets não existem mais no caminho
//! clássico sem hash; o asset real vive em
//! `store_item_assets/steam/apps/{appid}/{hash}/{arquivo}`. O hash é por asset,
//! não por jogo, e só a API `IStoreBrowseService/GetItems` entrega todos de uma
//! vez. Este módulo guarda esse manifesto e responde do cache mais barato
//! disponível: memória, disco e só então a rede.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tokio::time::sleep;

const STORE_ITEM_ASSETS_BASE: &str = "https://shared.fastly.steamstatic.com/store_item_assets/";
const COMMUNITY_IMAGES_BASE: &str =
    "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps";
const GET_ITEMS_URL: &str = "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/";
const GET_ITEMS_BATCH_SIZE: usize = 120;
const GET_ITEMS_MIN_INTERVAL_MS: u64 = 250;
const GET_ITEMS_TIMEOUT_SECS: u64 = 12;
const MANIFEST_MAX_AGE_MS: u128 = 30 * 24 * 60 * 60 * 1000;
const NEGATIVE_CACHE_TTL_SECS: u64 = 3_600;
const MANIFEST_FILE_NAME: &str = "library-asset-manifest.json";

static MANIFEST_MEMORY: OnceLock<Mutex<HashMap<String, AssetManifest>>> = OnceLock::new();
static MANIFEST_DISK_LOADED: OnceLock<()> = OnceLock::new();
static MANIFEST_NEGATIVE: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
static FETCH_GATE: OnceLock<tauri::async_runtime::Mutex<Option<Instant>>> = OnceLock::new();

/// Manifesto de assets de um appId, como devolvido pela `GetItems` e persistido
/// em disco. `url_format` já vem com o cache-buster `?t=` da Steam.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct AssetManifest {
    /// `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/{appid}/${FILENAME}?t=…`
    #[serde(default)]
    pub url_format: String,
    /// Campo da API (`library_capsule`, `header`, …) para caminho relativo, que
    /// inclui o hash quando o jogo já migrou.
    #[serde(default)]
    pub assets: HashMap<String, String>,
    /// Hash do ícone de comunidade. Só resolve como `.jpg`.
    #[serde(default)]
    pub community_icon: String,
    #[serde(default)]
    pub fetched_at_ms: u128,
}

impl AssetManifest {
    pub fn is_expired(&self) -> bool {
        current_millis().saturating_sub(self.fetched_at_ms) > MANIFEST_MAX_AGE_MS
    }

    /// URL final de um asset a partir do nome de arquivo clássico.
    pub fn asset_url(&self, file_name: &str) -> Option<String> {
        let field = asset_field_for_file_name(file_name)?;
        let value = self
            .assets
            .get(field)
            .map(String::as_str)
            .filter(|value| !value.is_empty())?;
        if self.url_format.is_empty() {
            return None;
        }
        Some(self.url_format.replace("${FILENAME}", value))
    }

    pub fn community_icon_url(&self, app_id: &str) -> Option<String> {
        is_hex_hash(&self.community_icon)
            .then(|| format!("{COMMUNITY_IMAGES_BASE}/{app_id}/{}.jpg", self.community_icon))
    }
}

fn current_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn is_hex_hash(value: &str) -> bool {
    value.len() >= 20 && value.chars().all(|character| character.is_ascii_hexdigit())
}

/// Nome de arquivo clássico para o campo equivalente na `GetItems`.
///
/// `library_capsule*` são os nomes antigos dos mesmos arquivos `library_600x900*`.
fn asset_field_for_file_name(file_name: &str) -> Option<&'static str> {
    Some(match file_name.to_ascii_lowercase().as_str() {
        "library_600x900.jpg" | "library_capsule.jpg" => "library_capsule",
        "library_600x900_2x.jpg" | "library_capsule_2x.jpg" => "library_capsule_2x",
        "header.jpg" => "header",
        "header_2x.jpg" => "header_2x",
        "capsule_616x353.jpg" => "main_capsule",
        "capsule_616x353_2x.jpg" => "main_capsule_2x",
        "capsule_231x87.jpg" => "small_capsule",
        "capsule_231x87_2x.jpg" => "small_capsule_2x",
        "hero_capsule.jpg" => "hero_capsule",
        "hero_capsule_2x.jpg" => "hero_capsule_2x",
        "library_hero.jpg" => "library_hero",
        "library_hero_2x.jpg" => "library_hero_2x",
        _ => return None,
    })
}

fn manifest_memory() -> &'static Mutex<HashMap<String, AssetManifest>> {
    MANIFEST_MEMORY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn manifest_negative() -> &'static Mutex<HashMap<String, Instant>> {
    MANIFEST_NEGATIVE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn fetch_gate() -> &'static tauri::async_runtime::Mutex<Option<Instant>> {
    FETCH_GATE.get_or_init(|| tauri::async_runtime::Mutex::new(None))
}

fn manifest_cache_path(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_data_dir().ok()?.join(MANIFEST_FILE_NAME))
}

fn load_disk_manifests(app: &AppHandle) {
    if MANIFEST_DISK_LOADED.set(()).is_err() {
        return;
    }

    let Some(path) = manifest_cache_path(app) else {
        return;
    };
    let Some(disk) = std::fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str::<HashMap<String, AssetManifest>>(&contents).ok())
    else {
        return;
    };

    if let Ok(mut memory) = manifest_memory().lock() {
        for (app_id, manifest) in disk {
            memory.entry(app_id).or_insert(manifest);
        }
    }
}

fn write_disk_manifests(app: &AppHandle) {
    let Some(path) = manifest_cache_path(app) else {
        return;
    };
    let Ok(memory) = manifest_memory().lock() else {
        return;
    };
    let Ok(contents) = serde_json::to_string(&*memory) else {
        return;
    };
    drop(memory);

    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(path, contents);
}

fn cached_manifest(app_id: &str) -> Option<AssetManifest> {
    manifest_memory()
        .lock()
        .ok()?
        .get(app_id)
        .filter(|manifest| !manifest.is_expired())
        .cloned()
}

fn is_negative(app_id: &str) -> bool {
    let Ok(mut negative) = manifest_negative().lock() else {
        return false;
    };
    let Some(stored_at) = negative.get(app_id).copied() else {
        return false;
    };
    if stored_at.elapsed() > Duration::from_secs(NEGATIVE_CACHE_TTL_SECS) {
        negative.remove(app_id);
        return false;
    }
    true
}

fn mark_negative(app_id: &str) {
    if let Ok(mut negative) = manifest_negative().lock() {
        negative.insert(app_id.to_string(), Instant::now());
    }
}

pub fn normalize_app_ids(app_ids: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    app_ids
        .iter()
        .map(|app_id| app_id.chars().filter(char::is_ascii_digit).collect::<String>())
        .filter(|app_id| !app_id.is_empty() && seen.insert(app_id.clone()))
        .collect()
}

/// `asset_url_format` só é aceito se apontar para o appId pedido e conter o
/// placeholder — a URL final é montada por substituição de texto, então um
/// formato inesperado viraria uma URL arbitrária.
fn sanitize_url_format(raw_format: &str, app_id: &str) -> Option<String> {
    let format = raw_format.trim();
    if !format.contains("${FILENAME}") {
        return None;
    }
    let expected_prefix = format!("steam/apps/{app_id}/");
    if !format.starts_with(&expected_prefix) {
        return None;
    }
    Some(format!("{STORE_ITEM_ASSETS_BASE}{format}"))
}

/// Caminho relativo do asset. Aceita `hash/arquivo.jpg` e `arquivo.jpg`.
fn sanitize_asset_value(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 128 {
        return None;
    }
    let is_valid = value.split('/').all(|segment| {
        !segment.is_empty()
            && segment != "."
            && segment != ".."
            && segment.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '_' | '.' | '-')
            })
    }) && value.split('/').count() <= 2;

    is_valid.then(|| value.to_string())
}

fn manifest_from_store_item(item: &serde_json::Value, app_id: &str) -> Option<AssetManifest> {
    let assets = item.get("assets")?.as_object()?;
    let url_format = sanitize_url_format(assets.get("asset_url_format")?.as_str()?, app_id)?;

    let resolved = assets
        .iter()
        .filter(|(field, _)| asset_field_names().contains(&field.as_str()))
        .filter_map(|(field, value)| {
            sanitize_asset_value(value.as_str()?).map(|value| (field.clone(), value))
        })
        .collect::<HashMap<_, _>>();

    let community_icon = assets
        .get("community_icon")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| is_hex_hash(value))
        .unwrap_or_default()
        .to_string();

    Some(AssetManifest {
        url_format,
        assets: resolved,
        community_icon,
        fetched_at_ms: current_millis(),
    })
}

fn asset_field_names() -> &'static [&'static str] {
    &[
        "library_capsule",
        "library_capsule_2x",
        "header",
        "header_2x",
        "main_capsule",
        "main_capsule_2x",
        "small_capsule",
        "small_capsule_2x",
        "hero_capsule",
        "hero_capsule_2x",
        "library_hero",
        "library_hero_2x",
    ]
}

fn build_input_json(app_ids: &[String]) -> String {
    let ids = app_ids
        .iter()
        .map(|app_id| format!("{{\"appid\":{app_id}}}"))
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"ids\":[{ids}],\"context\":{{\"language\":\"english\",\"country_code\":\"US\"}},\
         \"data_request\":{{\"include_assets\":true}}}}"
    )
}

fn parse_get_items_response(body: &serde_json::Value) -> HashMap<String, AssetManifest> {
    let Some(items) = body
        .get("response")
        .and_then(|response| response.get("store_items"))
        .and_then(|items| items.as_array())
    else {
        return HashMap::new();
    };

    items
        .iter()
        .filter_map(|item| {
            let app_id = item
                .get("appid")
                .or_else(|| item.get("id"))
                .and_then(|value| value.as_u64())?
                .to_string();
            if item.get("success").and_then(|value| value.as_u64()) != Some(1) {
                return None;
            }
            manifest_from_store_item(item, &app_id).map(|manifest| (app_id, manifest))
        })
        .collect()
}

/// Uma chamada `GetItems` por vez, com intervalo mínimo entre elas. A Steam não
/// documenta o limite e um catálogo grande dispararia dezenas de lotes juntos.
async fn fetch_batch(
    client: &reqwest::Client,
    app_ids: &[String],
) -> Option<HashMap<String, AssetManifest>> {
    let mut gate = fetch_gate().lock().await;
    if let Some(last_call) = *gate {
        let elapsed = last_call.elapsed();
        let min_interval = Duration::from_millis(GET_ITEMS_MIN_INTERVAL_MS);
        if elapsed < min_interval {
            sleep(min_interval - elapsed).await;
        }
    }
    *gate = Some(Instant::now());
    drop(gate);

    let response = client
        .get(GET_ITEMS_URL)
        .query(&[("input_json", build_input_json(app_ids))])
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let body = response.json::<serde_json::Value>().await.ok()?;
    Some(parse_get_items_response(&body))
}

/// Manifestos dos appIds pedidos. Memória e disco primeiro; só o que faltar vai
/// para a rede.
pub async fn manifests(app: &AppHandle, app_ids: &[String]) -> HashMap<String, AssetManifest> {
    load_disk_manifests(app);

    let app_ids = normalize_app_ids(app_ids);
    let mut resolved = HashMap::new();
    let mut missing = Vec::new();

    for app_id in app_ids {
        if let Some(manifest) = cached_manifest(&app_id) {
            resolved.insert(app_id, manifest);
        } else if !is_negative(&app_id) {
            missing.push(app_id);
        }
    }

    if missing.is_empty() {
        return resolved;
    }

    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(GET_ITEMS_TIMEOUT_SECS))
        .build()
    else {
        return resolved;
    };

    let mut fetched_any = false;
    for chunk in missing.chunks(GET_ITEMS_BATCH_SIZE) {
        let Some(batch) = fetch_batch(&client, chunk).await else {
            // Falha de rede não é ausência de asset: sem cache negativo, para
            // que a próxima tentativa reconsulte.
            continue;
        };

        if let Ok(mut memory) = manifest_memory().lock() {
            for (app_id, manifest) in &batch {
                memory.insert(app_id.clone(), manifest.clone());
            }
        }
        for app_id in chunk {
            match batch.get(app_id) {
                Some(manifest) => {
                    resolved.insert(app_id.clone(), manifest.clone());
                }
                None => mark_negative(app_id),
            }
        }
        fetched_any = fetched_any || !batch.is_empty();
    }

    if fetched_any {
        write_disk_manifests(app);
    }

    resolved
}

/// URL final de um asset, ou `None` quando o manifesto não resolve o arquivo.
pub async fn asset_url(app: &AppHandle, app_id: &str, file_name: &str) -> Option<String> {
    if asset_field_for_file_name(file_name).is_none() {
        return None;
    }

    let app_id = app_id.trim().to_string();
    manifests(app, &[app_id.clone()])
        .await
        .get(&app_id)?
        .asset_url(file_name)
}

/// Ícone de comunidade dos appIds pedidos. Sai da mesma chamada que resolve as
/// capas, então não custa request extra quando o manifesto já foi buscado.
pub async fn community_icon_urls(app: &AppHandle, app_ids: &[String]) -> HashMap<String, String> {
    manifests(app, app_ids)
        .await
        .into_iter()
        .filter_map(|(app_id, manifest)| {
            let url = manifest.community_icon_url(&app_id)?;
            Some((app_id, url))
        })
        .collect()
}

/// Manifestos já em memória/disco, sem tocar a rede. Serve o primeiro paint.
pub fn cached_manifests(app: &AppHandle, app_ids: &[String]) -> HashMap<String, AssetManifest> {
    load_disk_manifests(app);
    normalize_app_ids(app_ids)
        .into_iter()
        .filter_map(|app_id| cached_manifest(&app_id).map(|manifest| (app_id, manifest)))
        .collect()
}

/// Nomes de arquivo clássicos que o frontend pede. A resposta é achatada em
/// `arquivo -> URL` para o frontend não precisar conhecer os campos da API.
fn exposed_file_names() -> &'static [&'static str] {
    &[
        "library_600x900.jpg",
        "library_600x900_2x.jpg",
        "header.jpg",
        "header_2x.jpg",
        "capsule_616x353.jpg",
        "hero_capsule.jpg",
        "library_hero.jpg",
        "library_hero_2x.jpg",
    ]
}

fn flatten_manifests(
    manifests: HashMap<String, AssetManifest>,
) -> HashMap<String, HashMap<String, String>> {
    manifests
        .into_iter()
        .map(|(app_id, manifest)| {
            let mut urls = exposed_file_names()
                .iter()
                .filter_map(|file_name| {
                    manifest
                        .asset_url(file_name)
                        .map(|url| ((*file_name).to_string(), url))
                })
                .collect::<HashMap<_, _>>();
            if let Some(icon_url) = manifest.community_icon_url(&app_id) {
                urls.insert("community_icon.jpg".to_string(), icon_url);
            }
            (app_id, urls)
        })
        .filter(|(_, urls)| !urls.is_empty())
        .collect()
}

#[tauri::command]
pub async fn steam_get_asset_manifests(
    app: AppHandle,
    app_ids: Vec<String>,
) -> HashMap<String, HashMap<String, String>> {
    flatten_manifests(manifests(&app, &app_ids).await)
}

#[tauri::command]
pub fn steam_get_cached_asset_manifests(
    app: AppHandle,
    app_ids: Vec<String>,
) -> HashMap<String, HashMap<String, String>> {
    flatten_manifests(cached_manifests(&app, &app_ids))
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIGRATED: &str = r#"{
        "appid": 3602290,
        "success": 1,
        "assets": {
            "asset_url_format": "steam/apps/3602290/${FILENAME}?t=1781268305",
            "library_capsule": "b7838add8b2550e27a915cbbf9e37567b1e771d4/library_600x900.jpg",
            "library_capsule_2x": "b7838add8b2550e27a915cbbf9e37567b1e771d4/library_600x900_2x.jpg",
            "header": "6385a10d2c3f15d06559ee06a59891960483708d/header.jpg",
            "community_icon": "4cc8c99722309845b2c4775902ace66f468303ec"
        }
    }"#;

    const LEGACY: &str = r#"{
        "appid": 413150,
        "success": 1,
        "assets": {
            "asset_url_format": "steam/apps/413150/${FILENAME}?t=1754692865",
            "library_capsule": "library_600x900.jpg",
            "header": "header.jpg"
        }
    }"#;

    fn parse(raw: &str, app_id: &str) -> AssetManifest {
        let item = serde_json::from_str::<serde_json::Value>(raw).unwrap();
        manifest_from_store_item(&item, app_id).unwrap()
    }

    #[test]
    fn builds_hashed_url_for_migrated_app() {
        let manifest = parse(MIGRATED, "3602290");
        assert_eq!(
            manifest.asset_url("library_600x900_2x.jpg").unwrap(),
            "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/3602290/\
             b7838add8b2550e27a915cbbf9e37567b1e771d4/library_600x900_2x.jpg?t=1781268305"
        );
    }

    #[test]
    fn builds_hashless_url_for_legacy_app() {
        let manifest = parse(LEGACY, "413150");
        assert_eq!(
            manifest.asset_url("header.jpg").unwrap(),
            "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/413150/header.jpg?t=1754692865"
        );
    }

    #[test]
    fn maps_legacy_library_capsule_alias() {
        let manifest = parse(MIGRATED, "3602290");
        assert_eq!(
            manifest.asset_url("library_capsule.jpg"),
            manifest.asset_url("library_600x900.jpg")
        );
    }

    #[test]
    fn returns_none_for_missing_asset_field() {
        let manifest = parse(LEGACY, "413150");
        assert!(manifest.asset_url("library_hero_2x.jpg").is_none());
        assert!(manifest.asset_url("nao_existe.jpg").is_none());
    }

    #[test]
    fn community_icon_resolves_only_as_jpg() {
        let manifest = parse(MIGRATED, "3602290");
        assert_eq!(
            manifest.community_icon_url("3602290").unwrap(),
            "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/3602290/\
             4cc8c99722309845b2c4775902ace66f468303ec.jpg"
        );
        assert!(parse(LEGACY, "413150").community_icon_url("413150").is_none());
    }

    #[test]
    fn rejects_url_format_for_another_app() {
        let item = serde_json::from_str::<serde_json::Value>(MIGRATED).unwrap();
        assert!(manifest_from_store_item(&item, "413150").is_none());
    }

    #[test]
    fn rejects_traversal_in_asset_value() {
        assert!(sanitize_asset_value("../../etc/passwd").is_none());
        assert!(sanitize_asset_value("a/b/c.jpg").is_none());
        assert!(sanitize_asset_value("hash/library_600x900.jpg").is_some());
    }

    #[test]
    fn skips_items_without_success() {
        let body = serde_json::json!({
            "response": { "store_items": [{ "id": 999999999, "success": 15, "visible": false }] }
        });
        assert!(parse_get_items_response(&body).is_empty());
    }

    #[test]
    fn parses_batch_response() {
        let body = serde_json::json!({
            "response": {
                "store_items": [
                    serde_json::from_str::<serde_json::Value>(MIGRATED).unwrap(),
                    serde_json::from_str::<serde_json::Value>(LEGACY).unwrap()
                ]
            }
        });
        let parsed = parse_get_items_response(&body);
        assert_eq!(parsed.len(), 2);
        assert!(parsed.contains_key("3602290"));
        assert!(parsed.contains_key("413150"));
    }
}
