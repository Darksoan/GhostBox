use crate::ghostbox_library;
use crate::playtime;
use crate::settings::{
    load_steam_stats_proxy_url, load_steam_web_api_key, read_json_file, remove_data_file,
    write_json_file,
};
use crate::steam_localconfig;
use crate::util::{silent_command, text_value, xml_text, EmptyStringExt};
use crate::{
    enrich_game_with_local_achievement_stats, extract_app_id, load_saved_steam_path,
    merge_playtime_into_game, normalize_steam_root_path, resolve_steam_path, save_steam_path,
    steam_asset_url, steamapps_path,
};
use std::collections::{HashMap, HashSet};
use tauri::Emitter;

const STEAM_PROFILE_FILE: &str = "steam-profile.json";
const STEAM_ACCOUNT_STATS_CACHE_FILE: &str = "steam-account-stats-cache.json";
const STEAM_MORELIKE_CACHE_FILE: &str = "steam-morelike-cache.json";
const STEAM_ACCOUNT_STATS_UPDATED_EVENT: &str = "steam-account-stats-updated";
const STEAM_ACHIEVEMENT_SCAN_CONCURRENCY: usize = 8;
const STEAM_ACHIEVEMENT_CACHE_MAX_AGE_SECONDS: u64 = 7 * 24 * 60 * 60;
const STEAM_NO_STATS_CACHE_MAX_AGE_SECONDS: u64 = 30 * 24 * 60 * 60;
const STEAM_MORELIKE_CACHE_MAX_AGE_SECONDS: u64 = 14 * 24 * 60 * 60;
const STEAM_MORELIKE_MAX_RESULTS: usize = 12;
const MAX_PROFILE_AVATAR_BYTES: usize = 512 * 1024;
const STEAM_OPENID_ENDPOINT: &str = "https://steamcommunity.com/openid/login";

static STEAM_SIGN_IN_ACTIVE: std::sync::Mutex<bool> = std::sync::Mutex::new(false);
static STEAM_STATS_SCAN_ACTIVE: std::sync::OnceLock<std::sync::Mutex<HashSet<String>>> =
    std::sync::OnceLock::new();

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
struct SteamOwnedGameStats {
    appid: u64,
    name: Option<String>,
    playtime_forever: u64,
    rtime_last_played: u64,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SteamAchievementCacheEntry {
    playtime_forever: u64,
    unlocked_achievements: u64,
    total_achievements: u64,
    has_achievements: bool,
    last_fetched_at: u64,
    last_error: Option<String>,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SteamAccountStatsCache {
    steam_id: String,
    games: HashMap<String, SteamAchievementCacheEntry>,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub(crate) struct SteamShowcaseAchievement {
    id: String,
    title: String,
    game_title: String,
    icon: String,
    app_id: String,
    unlocked_at: u64,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub(crate) struct SteamOwnedPlaytime {
    app_id: String,
    name: Option<String>,
    playtime_forever: u64,
    rtime_last_played: u64,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub(crate) struct SteamRemoteAchievement {
    name: String,
    title: String,
    description: String,
    icon: String,
    icon_gray: String,
    unlocked: bool,
    unlocked_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    global_percent: Option<f64>,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub(crate) struct SteamGameAchievementSummary {
    app_id: String,
    game_title: String,
    achievements: Vec<SteamRemoteAchievement>,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub(crate) struct SteamAccountStats {
    steam_id: String,
    games_count: u64,
    total_playtime_minutes: u64,
    unlocked_achievements: u64,
    total_achievements: u64,
    perfect_games: u64,
    average_progress: u64,
    scanned_games: u64,
    pending_games: u64,
    failed_games: u64,
    fetched_at: u64,
    private: bool,
    has_api_key: bool,
    scan_in_progress: bool,
    next_poll_after: u64,
    recent_achievements: Vec<SteamShowcaseAchievement>,
    /// Per-game Steam playtimes used to sync local playtime snapshot.
    owned_playtimes: Vec<SteamOwnedPlaytime>,
    /// Per-game Steam achievement state forwarded by the stats proxy.
    achievements: Vec<SteamGameAchievementSummary>,
}

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

async fn fetch_steam_profile_from_proxy(
    proxy_url: &str,
    steam_id: &str,
) -> Result<serde_json::Value, String> {
    let value = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?
        .get(format!("{proxy_url}/steam/player-summary"))
        .query(&[("steamId", steam_id)])
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|error| error.to_string())?;

    if value.get("steamId").and_then(|value| value.as_str()) != Some(steam_id) {
        return Err("Steam profile ID mismatch in proxy response".to_string());
    }

    let display_name = value
        .get("displayName")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let avatar_source = value
        .get("avatarUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let profile_url = value
        .get("profileUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if display_name.is_empty() && avatar_source.is_empty() {
        return Err("Steam profile missing from proxy response".to_string());
    }
    let avatar_source = reqwest::Url::parse(&avatar_source)
        .ok()
        .filter(|url| {
            url.scheme() == "https"
                && url.host_str().is_some_and(|host| {
                    host == "steamstatic.com" || host.ends_with(".steamstatic.com")
                })
        })
        .map(|url| url.to_string())
        .unwrap_or_default();
    let profile_url = reqwest::Url::parse(&profile_url)
        .ok()
        .filter(|url| {
            url.scheme() == "https"
                && url.host_str().is_some_and(|host| {
                    host == "steamcommunity.com" || host.ends_with(".steamcommunity.com")
                })
        })
        .map(|url| url.to_string())
        .unwrap_or_default();
    let avatar_url = resolve_steam_profile_avatar_url(&avatar_source).await;
    Ok(serde_json::json!({
        "steamId": steam_id,
        "displayName": if display_name.is_empty() {
            format!("Steam {steam_id}")
        } else {
            display_name
        },
        "avatarUrl": avatar_url,
        "profileUrl": if profile_url.is_empty() {
            format!("https://steamcommunity.com/profiles/{steam_id}")
        } else {
            profile_url
        }
    }))
}

async fn fetch_steam_profile(steam_id: &str) -> Result<serde_json::Value, String> {
    let proxy_url = load_steam_stats_proxy_url();
    if !proxy_url.is_empty() {
        if let Ok(profile) = fetch_steam_profile_from_proxy(&proxy_url, steam_id).await {
            return Ok(profile);
        }
    }

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

fn steam_unix_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

fn load_steam_account_stats_cache(
    app: &tauri::AppHandle,
    steam_id: &str,
) -> SteamAccountStatsCache {
    let mut cache: SteamAccountStatsCache = read_json_file(app, STEAM_ACCOUNT_STATS_CACHE_FILE)
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default();
    if cache.steam_id != steam_id {
        cache = SteamAccountStatsCache {
            steam_id: steam_id.to_string(),
            games: HashMap::new(),
        };
    }
    cache
}

fn save_steam_account_stats_cache(
    app: &tauri::AppHandle,
    cache: &SteamAccountStatsCache,
) -> Result<(), String> {
    let value = serde_json::to_value(cache).map_err(|error| error.to_string())?;
    write_json_file(app, STEAM_ACCOUNT_STATS_CACHE_FILE, &value)
}

fn should_refresh_achievement_entry(
    entry: Option<&SteamAchievementCacheEntry>,
    playtime_forever: u64,
    now: u64,
) -> bool {
    let Some(entry) = entry else {
        return true;
    };
    if entry.playtime_forever != playtime_forever {
        return true;
    }

    let max_age = match entry.last_error.as_deref() {
        Some("no_stats") => STEAM_NO_STATS_CACHE_MAX_AGE_SECONDS,
        Some(_) => 15 * 60,
        None => STEAM_ACHIEVEMENT_CACHE_MAX_AGE_SECONDS,
    };
    now.saturating_sub(entry.last_fetched_at) > max_age
}

fn build_steam_account_stats(
    steam_id: &str,
    owned_games: &[SteamOwnedGameStats],
    cache: &SteamAccountStatsCache,
    has_api_key: bool,
    private: bool,
    scan_in_progress: bool,
) -> SteamAccountStats {
    let now = steam_unix_timestamp();
    let owned_app_ids = owned_games
        .iter()
        .map(|game| game.appid.to_string())
        .collect::<HashSet<_>>();
    let unlocked_achievements = owned_app_ids
        .iter()
        .filter_map(|app_id| cache.games.get(app_id))
        .map(|entry| entry.unlocked_achievements)
        .sum();
    let total_achievements = owned_app_ids
        .iter()
        .filter_map(|app_id| cache.games.get(app_id))
        .map(|entry| entry.total_achievements)
        .sum();
    let achievement_entries = owned_app_ids
        .iter()
        .filter_map(|app_id| cache.games.get(app_id))
        .filter(|entry| entry.total_achievements > 0)
        .collect::<Vec<_>>();
    let perfect_games = achievement_entries
        .iter()
        .filter(|entry| entry.unlocked_achievements >= entry.total_achievements)
        .count() as u64;
    let average_progress = if achievement_entries.is_empty() {
        0
    } else {
        ((achievement_entries
            .iter()
            .map(|entry| entry.unlocked_achievements as f64 / entry.total_achievements as f64)
            .sum::<f64>()
            / achievement_entries.len() as f64)
            * 100.0)
            .round() as u64
    };
    let scanned_games = owned_app_ids
        .iter()
        .filter(|app_id| {
            cache
                .games
                .get(*app_id)
                .is_some_and(|entry| entry.last_fetched_at > 0)
        })
        .count() as u64;
    let failed_games = owned_app_ids
        .iter()
        .filter(|app_id| {
            cache
                .games
                .get(*app_id)
                .and_then(|entry| entry.last_error.as_deref())
                .is_some_and(|error| error != "no_stats")
        })
        .count() as u64;
    let total_playtime_minutes = owned_games
        .iter()
        .map(|game| game.playtime_forever)
        .sum::<u64>();

    let owned_playtimes = owned_games
        .iter()
        .map(|game| SteamOwnedPlaytime {
            app_id: game.appid.to_string(),
            name: game.name.clone(),
            playtime_forever: game.playtime_forever,
            rtime_last_played: game.rtime_last_played,
        })
        .collect();

    SteamAccountStats {
        steam_id: steam_id.to_string(),
        games_count: owned_games.len() as u64,
        total_playtime_minutes,
        unlocked_achievements,
        total_achievements,
        perfect_games,
        average_progress,
        scanned_games,
        pending_games: owned_games.len().saturating_sub(scanned_games as usize) as u64,
        failed_games,
        fetched_at: now,
        private,
        has_api_key,
        scan_in_progress,
        next_poll_after: if scan_in_progress {
            60
        } else if failed_games > 0 {
            15 * 60
        } else {
            0
        },
        recent_achievements: Vec::new(),
        owned_playtimes,
        achievements: Vec::new(),
    }
}

fn parse_owned_game_entry(game: &serde_json::Value) -> Option<SteamOwnedGameStats> {
    let appid = game
        .get("appid")
        .or_else(|| game.get("appId"))
        .and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
        })?;
    let playtime_forever = game
        .get("playtime_forever")
        .or_else(|| game.get("playtimeForever"))
        .and_then(|value| value.as_u64())
        .unwrap_or_default();
    let rtime_last_played = game
        .get("rtime_last_played")
        .or_else(|| game.get("rtimeLastPlayed"))
        .and_then(|value| value.as_u64())
        .unwrap_or_default();
    Some(SteamOwnedGameStats {
        appid,
        name: game
            .get("name")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        playtime_forever,
        rtime_last_played,
    })
}

fn parse_owned_games_payload(value: &serde_json::Value) -> Vec<SteamOwnedGameStats> {
    let games = value
        .get("response")
        .and_then(|response| response.get("games"))
        .or_else(|| value.get("games"))
        .or_else(|| value.as_array().map(|_| value))
        .and_then(|games| games.as_array());

    games
        .map(|games| games.iter().filter_map(parse_owned_game_entry).collect())
        .unwrap_or_default()
}

async fn fetch_steam_owned_games(
    client: &reqwest::Client,
    steam_id: &str,
    api_key: &str,
) -> Result<Vec<SteamOwnedGameStats>, String> {
    let value = client
        .get("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/")
        .query(&[
            ("key", api_key),
            ("steamid", steam_id),
            ("include_appinfo", "1"),
            ("include_played_free_games", "1"),
        ])
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|error| error.to_string())?;

    Ok(parse_owned_games_payload(&value))
}

/// Fetch owned games + playtime via GhostBox Steam stats proxy (uses server API key).
async fn fetch_steam_owned_games_from_proxy(
    proxy_url: &str,
    steam_id: &str,
) -> Result<Vec<SteamOwnedGameStats>, String> {
    let value = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .map_err(|error| error.to_string())?
        .get(format!("{proxy_url}/steam/owned-games"))
        .query(&[("steamId", steam_id)])
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|error| error.to_string())?;

    let games = parse_owned_games_payload(&value);
    if games.is_empty() {
        return Err("Steam owned-games proxy returned no games".to_string());
    }
    Ok(games)
}

/// Resolve owned games for playtime: prefer the Cloudflare proxy (shared Web API key),
/// falling back to the user's own local Steam Web API key when the proxy is not
/// configured, unreachable, slow/cold-starting, or returns an error. This mirrors the
/// fallback already used by `steam_get_account_stats` / `steam_get_player_level` — without
/// it, playtime sync had no recovery path and silently left every game at 0.
async fn resolve_steam_owned_games_for_playtime(
    app: &tauri::AppHandle,
    steam_id: &str,
) -> Result<Vec<SteamOwnedGameStats>, String> {
    let proxy_url = load_steam_stats_proxy_url();
    let proxy_error = if proxy_url.is_empty() {
        "Steam stats proxy URL is not configured".to_string()
    } else {
        match fetch_steam_owned_games_from_proxy(&proxy_url, steam_id).await {
            Ok(games) => return Ok(games),
            Err(error) => error,
        }
    };

    let api_key = load_steam_web_api_key(app);
    if api_key.is_empty() {
        return Err(format!(
            "Steam stats proxy failed ({proxy_error}) and no local Steam Web API key is configured"
        ));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;
    fetch_steam_owned_games(&client, steam_id, &api_key)
        .await
        .map_err(|error| {
            format!(
                "Steam stats proxy failed ({proxy_error}); direct Steam API also failed ({error})"
            )
        })
}

async fn fetch_steam_account_stats_from_proxy(
    proxy_url: &str,
    steam_id: &str,
) -> Result<SteamAccountStats, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?
        .get(format!("{proxy_url}/steam/account-stats"))
        .query(&[("steamId", steam_id)])
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<SteamAccountStats>()
        .await
        .map_err(|error| error.to_string())
}

async fn fetch_steam_game_achievement_counts(
    client: reqwest::Client,
    steam_id: String,
    api_key: String,
    game: SteamOwnedGameStats,
    previous: Option<SteamAchievementCacheEntry>,
) -> (String, SteamAchievementCacheEntry) {
    let app_id = game.appid.to_string();
    let now = steam_unix_timestamp();
    let stale_entry = |last_error: &str| {
        let mut entry = previous.clone().unwrap_or_default();
        entry.playtime_forever = game.playtime_forever;
        entry.last_fetched_at = now;
        entry.last_error = Some(last_error.to_string());
        entry
    };
    let response = client
        .get("https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/")
        .query(&[
            ("key", api_key.as_str()),
            ("steamid", steam_id.as_str()),
            ("appid", app_id.as_str()),
        ])
        .send()
        .await;

    let Ok(response) = response else {
        return (app_id, stale_entry("request_failed"));
    };

    if !response.status().is_success() {
        let last_error = if response.status().as_u16() == 400 {
            "no_stats"
        } else {
            "http_error"
        };
        let entry = if last_error == "no_stats" {
            SteamAchievementCacheEntry {
                playtime_forever: game.playtime_forever,
                has_achievements: false,
                last_fetched_at: now,
                last_error: Some(last_error.to_string()),
                ..Default::default()
            }
        } else {
            stale_entry(last_error)
        };
        return (app_id, entry);
    }

    let value = match response.json::<serde_json::Value>().await {
        Ok(value) => value,
        Err(_) => return (app_id, stale_entry("invalid_json")),
    };

    let achievements = value
        .get("playerstats")
        .and_then(|stats| stats.get("achievements"))
        .and_then(|achievements| achievements.as_array())
        .cloned()
        .unwrap_or_default();
    let total_achievements = achievements.len() as u64;
    let unlocked_achievements = achievements
        .iter()
        .filter(|achievement| {
            achievement
                .get("achieved")
                .and_then(|value| value.as_u64())
                .unwrap_or_default()
                == 1
        })
        .count() as u64;

    (
        app_id,
        SteamAchievementCacheEntry {
            playtime_forever: game.playtime_forever,
            unlocked_achievements,
            total_achievements,
            has_achievements: total_achievements > 0,
            last_fetched_at: now,
            last_error: None,
        },
    )
}

fn begin_steam_stats_scan(steam_id: &str) -> bool {
    let lock = STEAM_STATS_SCAN_ACTIVE.get_or_init(|| std::sync::Mutex::new(HashSet::new()));
    let Ok(mut active) = lock.lock() else {
        return false;
    };
    active.insert(steam_id.to_string())
}

fn end_steam_stats_scan(steam_id: &str) {
    let lock = STEAM_STATS_SCAN_ACTIVE.get_or_init(|| std::sync::Mutex::new(HashSet::new()));
    if let Ok(mut active) = lock.lock() {
        active.remove(steam_id);
    }
}

fn emit_steam_account_stats(app: &tauri::AppHandle, stats: &SteamAccountStats) {
    let _ = app.emit(STEAM_ACCOUNT_STATS_UPDATED_EVENT, stats.clone());
}

fn start_steam_achievement_stats_scan(
    app: tauri::AppHandle,
    steam_id: String,
    api_key: String,
    owned_games: Vec<SteamOwnedGameStats>,
) {
    if !begin_steam_stats_scan(&steam_id) {
        return;
    }

    tauri::async_runtime::spawn(async move {
        let client = match reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(12))
            .build()
        {
            Ok(client) => client,
            Err(_) => {
                end_steam_stats_scan(&steam_id);
                return;
            }
        };

        let now = steam_unix_timestamp();
        let mut cache = load_steam_account_stats_cache(&app, &steam_id);
        let mut pending = owned_games
            .iter()
            .filter(|game| {
                should_refresh_achievement_entry(
                    cache.games.get(&game.appid.to_string()),
                    game.playtime_forever,
                    now,
                )
            })
            .cloned()
            .collect::<Vec<_>>();
        pending.sort_by(|left, right| right.playtime_forever.cmp(&left.playtime_forever));

        for chunk in pending.chunks(STEAM_ACHIEVEMENT_SCAN_CONCURRENCY) {
            let mut handles = Vec::new();
            for game in chunk.iter().cloned() {
                let previous = cache.games.get(&game.appid.to_string()).cloned();
                handles.push(tauri::async_runtime::spawn(
                    fetch_steam_game_achievement_counts(
                        client.clone(),
                        steam_id.clone(),
                        api_key.clone(),
                        game,
                        previous,
                    ),
                ));
            }
            for handle in handles {
                if let Ok((app_id, entry)) = handle.await {
                    cache.games.insert(app_id, entry);
                }
            }

            let _ = save_steam_account_stats_cache(&app, &cache);
            let stats =
                build_steam_account_stats(&steam_id, &owned_games, &cache, true, false, true);
            emit_steam_account_stats(&app, &stats);
        }

        let _ = save_steam_account_stats_cache(&app, &cache);
        let stats = build_steam_account_stats(&steam_id, &owned_games, &cache, true, false, false);
        emit_steam_account_stats(&app, &stats);
        end_steam_stats_scan(&steam_id);
    });
}

/// Steam assertions are validated authoritatively by the Worker
/// (`validateSteamOpenId`: op_endpoint, return_to, claimed identity, nonce
/// freshness and single-use, plus `check_authentication` against Steam). The
/// local `check_authentication` call that used to live here was removed so
/// there is exactly one validator to keep correct.

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
    crate::oauth_loopback::callback_page_html(success, message)
}

fn write_http_response(stream: &mut std::net::TcpStream, status: &str, body: &str) {
    crate::oauth_loopback::write_http_response(stream, status, body)
}

fn accept_steam_login_callback(
    listener: std::net::TcpListener,
    port: u16,
    state: String,
) -> Result<(reqwest::Url, std::net::TcpStream), String> {
    crate::oauth_loopback::accept_loopback_callback(
        listener,
        port,
        "/steam/callback",
        Some(&state),
        std::time::Duration::from_secs(120),
        "Steam login timed out",
    )
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

/// What a completed Steam OpenID hand-off yields: the callback URL to send the
/// Worker for validation (never the SteamID on its own — only Steam can vouch
/// for that) and the still-open socket, so the caller decides what page the
/// user is left looking at.
struct SteamCallback {
    url: reqwest::Url,
    stream: std::net::TcpStream,
    steam_id: String,
}

/// Opens Steam's OpenID page in the system browser and waits for the callback.
///
/// Steam, unlike Discord, accepts an arbitrary `return_to`, so the
/// loopback port *is* the redirect target and nothing has to be bounced
/// through the Worker.
async fn run_steam_openid_flow(app: &tauri::AppHandle) -> Result<SteamCallback, String> {
    use tauri_plugin_opener::OpenerExt;

    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let state = uuid::Uuid::new_v4().to_string();
    let callback_url = format!("http://localhost:{port}/steam/callback?state={state}");
    let mut login_url =
        reqwest::Url::parse(STEAM_OPENID_ENDPOINT).map_err(|error| error.to_string())?;
    login_url
        .query_pairs_mut()
        .append_pair("openid.ns", "http://specs.openid.net/auth/2.0")
        .append_pair("openid.mode", "checkid_setup")
        .append_pair("openid.return_to", &callback_url)
        .append_pair("openid.realm", &format!("http://localhost:{port}"))
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

    let steam_id = steam_id_from_openid(&callback);
    if steam_id.is_empty() {
        write_http_response(
            &mut stream,
            "400 Bad Request",
            &steam_login_page_html(false, "Not connected."),
        );
        return Err("Steam OpenID validation failed".to_string());
    }

    Ok(SteamCallback {
        url: callback,
        stream,
        steam_id,
    })
}

/// Signs in through Steam, with no GhostBox session required up front.
///
/// The Worker re-validates the callback against Steam and creates the
/// provider-only account when needed.
#[tauri::command]
pub async fn cloud_steam_login(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let _guard = begin_steam_sign_in()?;
    let mut callback = run_steam_openid_flow(&app).await?;

    let profile = match fetch_steam_profile(&callback.steam_id).await {
        Ok(profile) => profile,
        Err(error) => {
            write_http_response(
                &mut callback.stream,
                "400 Bad Request",
                &steam_login_page_html(false, "Not signed in."),
            );
            return Err(error);
        }
    };
    let result =
        crate::cloud_save::cloud_steam_login_callback(callback.url.as_str(), Some(&profile)).await;

    match result {
        Ok(session) => {
            if let Err(error) = crate::cloud_save::save_cloud_session(&app, &session) {
                write_http_response(
                    &mut callback.stream,
                    "400 Bad Request",
                    &steam_login_page_html(false, "Not signed in."),
                );
                return Err(error);
            }
            crate::oauth_loopback::complete_browser_login(&app, &mut callback.stream);
            // The worker login is already complete; a local cache write must
            // not turn that successful account session into a reported failure.
            let _ = save_steam_profile(&app, profile);
            Ok(session)
        }
        Err(error) => {
            write_http_response(
                &mut callback.stream,
                "400 Bad Request",
                &steam_login_page_html(false, "Not signed in."),
            );
            Err(error)
        }
    }
}

/// Retired with email/password: Steam proves the account directly now, so
/// there is no recovery session to hand out.
#[tauri::command]
pub async fn cloud_steam_recover(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let _ = app;
    Err(crate::cloud_save::password_auth_removed_message())
}

async fn connect_steam_account(app: &tauri::AppHandle) -> Result<serde_json::Value, String> {
    // Connecting Steam links it to the caller's GhostBox account; it no
    // longer signs anyone in on its own. `cloud_steam_login` is the signed-out
    // path, and it shares the OpenID hand-off below.
    crate::cloud_save::session_token(app)?;

    let _guard = begin_steam_sign_in()?;
    let mut callback = run_steam_openid_flow(app).await?;

    let profile = match fetch_steam_profile(&callback.steam_id).await {
        Ok(profile) => profile,
        Err(error) => {
            write_http_response(
                &mut callback.stream,
                "400 Bad Request",
                &steam_login_page_html(false, "Not connected."),
            );
            return Err(error);
        }
    };

    let display_name = text_value(profile.get("displayName"));

    // The Worker is the authority on whether the link landed: its answer is
    // propagated, never swallowed. Claiming "connected" on a failed link used
    // to leave users believing Steam was their way back in when only a local
    // profile existed.
    match crate::cloud_save::cloud_claim_steam_callback(app, callback.url.as_str(), &profile).await
    {
        Ok(cloud_session) => {
            let success_message = if display_name.is_empty() {
                "Steam account connected.".to_string()
            } else {
                format!("Steam account connected as {display_name}.")
            };
            write_http_response(
                &mut callback.stream,
                "200 OK",
                &steam_login_page_html(true, &success_message),
            );
            let mut saved_profile = save_steam_profile(app, profile)?;
            saved_profile["cloudSession"] = cloud_session;
            Ok(saved_profile)
        }
        Err(error) => {
            write_http_response(
                &mut callback.stream,
                "400 Bad Request",
                &steam_login_page_html(false, "Not connected."),
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub fn steam_get_profile(app: tauri::AppHandle) -> Option<serde_json::Value> {
    load_steam_profile(&app)
}

#[tauri::command]
pub async fn steam_restore_account(
    app: tauri::AppHandle,
    steam_id: String,
) -> Result<serde_json::Value, String> {
    let steam_id = steam_id.trim();
    if steam_id.is_empty() || !steam_id.chars().all(|ch| ch.is_ascii_digit()) {
        return Err("Steam ID is required".to_string());
    }

    let profile = fetch_steam_profile(steam_id).await?;
    save_steam_profile(&app, profile)
}

/// Layer Steam GetOwnedGames totals into the playtime snapshot. This is
/// authoritative for any appid it covers — a real Steam license — so it
/// always overwrites that appid's entry, but it never touches entries for
/// appids Steam doesn't own (e.g. OpenSteamTools titles), which are seeded
/// separately by [`seed_playtimes_from_steam_local_config`] or accumulated
/// locally by GhostBox itself.
fn seed_playtimes_from_steam_owned_games(
    app: &tauri::AppHandle,
    owned_games: &[SteamOwnedGameStats],
) {
    if owned_games.is_empty() {
        return;
    }

    let mut snapshot = playtime::load_game_playtimes(app)
        .as_object()
        .cloned()
        .unwrap_or_default();

    for game in owned_games {
        let steam_playtime_ms = game.playtime_forever.saturating_mul(60_000);
        if steam_playtime_ms == 0 && game.rtime_last_played == 0 {
            continue;
        }

        let app_id = game.appid.to_string();
        let mut entry = serde_json::json!({
            "appId": app_id,
            "playTimeInMilliseconds": steam_playtime_ms,
            "source": "steam",
        });
        if game.rtime_last_played > 0 {
            entry["lastTimePlayed"] =
                serde_json::json!(playtime::unix_seconds_to_iso(game.rtime_last_played));
        }
        let merged = snapshot
            .get(&app_id)
            .map(|existing| merge_playtime_entries(existing, &entry))
            .unwrap_or(entry);
        snapshot.insert(app_id, merged);
    }

    let value = serde_json::Value::Object(snapshot);
    let _ = playtime::persist_playtime_snapshot(app, &value);
}

/// Layer the Steam client's own local playtime tracking (`localconfig.vdf`)
/// into the snapshot, for appids the Web API doesn't own — this is how
/// OpenSteamTools/stplug-in titles get real playtime instead of being stuck
/// at 0s, since Steam's own overlay tracks them locally even though they're
/// not real licenses on the account.
fn seed_playtimes_from_steam_local_config(
    app: &tauri::AppHandle,
    local_playtimes: &HashMap<String, steam_localconfig::LocalAppPlaytime>,
    owned_app_ids: &HashSet<String>,
) {
    if local_playtimes.is_empty() {
        return;
    }

    let mut snapshot = playtime::load_game_playtimes(app)
        .as_object()
        .cloned()
        .unwrap_or_default();
    let mut changed = false;

    for (app_id, local) in local_playtimes {
        // A real Steam license always wins over the client's local tracking.
        if owned_app_ids.contains(app_id) {
            continue;
        }

        let existing_source = snapshot
            .get(app_id)
            .and_then(|entry| entry.get("source"))
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string();
        // GhostBox's own accumulator already owns this total once it starts
        // tracking a game locally — never clobber it with a (possibly stale)
        // localconfig.vdf read.
        if existing_source == "ghostbox" {
            continue;
        }

        let playtime_ms = local.minutes.saturating_mul(60_000);
        if playtime_ms == 0 && local.last_played == 0 {
            continue;
        }

        let mut entry = serde_json::json!({
            "appId": app_id,
            "playTimeInMilliseconds": playtime_ms,
            "source": "steam_local",
        });
        if local.last_played > 0 {
            entry["lastTimePlayed"] =
                serde_json::json!(playtime::unix_seconds_to_iso(local.last_played));
        }
        let merged = snapshot
            .get(app_id)
            .map(|existing| merge_playtime_entries(existing, &entry))
            .unwrap_or(entry);
        snapshot.insert(app_id.clone(), merged);
        changed = true;
    }

    if changed {
        let value = serde_json::Value::Object(snapshot);
        let _ = playtime::persist_playtime_snapshot(app, &value);
    }
}

/// Read the Steam client's local playtime cache for every appid not covered
/// by `owned_app_ids` and layer it into the snapshot. Best-effort: silently
/// does nothing if Steam isn't installed where expected.
fn apply_local_steam_playtimes(
    app: &tauri::AppHandle,
    steam_id: &str,
    owned_app_ids: &HashSet<String>,
) {
    let (steam_path, _) = resolve_steam_path(app, None);
    let Some(steam_path) = steam_path else {
        return;
    };
    let account_id = steam_localconfig::account_id_from_steam_id64(steam_id);
    let local_playtimes =
        steam_localconfig::read_steam_local_playtimes(&steam_path, account_id.as_deref());
    seed_playtimes_from_steam_local_config(app, &local_playtimes, owned_app_ids);
}

fn owned_app_ids_from_stats(owned_games: &[SteamOwnedGameStats]) -> HashSet<String> {
    owned_games
        .iter()
        .map(|game| game.appid.to_string())
        .collect()
}

/// Sync playtime totals from Steam (proxy Web API key or local Web API key).
/// Layers GetOwnedGames totals, then the local Steam client's own tracking
/// for anything outside the account's licenses (e.g. OpenSteamTools titles).
#[tauri::command]
pub async fn steam_sync_playtimes(
    app: tauri::AppHandle,
    steam_id: String,
) -> Result<serde_json::Value, String> {
    let steam_id = steam_id.trim().to_string();
    if steam_id.is_empty() || !steam_id.chars().all(|ch| ch.is_ascii_digit()) {
        return Err("Steam ID is required".to_string());
    }

    let owned_games = resolve_steam_owned_games_for_playtime(&app, &steam_id).await?;
    seed_playtimes_from_steam_owned_games(&app, &owned_games);
    apply_local_steam_playtimes(&app, &steam_id, &owned_app_ids_from_stats(&owned_games));
    Ok(playtime::load_game_playtimes(&app))
}

async fn fetch_steam_level_from_proxy(proxy_url: &str, steam_id: &str) -> Result<u32, String> {
    let value = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?
        .get(format!("{proxy_url}/steam/player-level"))
        .query(&[("steamId", steam_id)])
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|error| error.to_string())?;

    value
        .get("playerLevel")
        .or_else(|| value.get("player_level"))
        .or_else(|| value.get("level"))
        .and_then(|value| value.as_u64())
        .map(|value| value as u32)
        .ok_or_else(|| "Steam player level missing from proxy response".to_string())
}

async fn fetch_steam_level(
    client: &reqwest::Client,
    steam_id: &str,
    api_key: &str,
) -> Result<u32, String> {
    let value = client
        .get("https://api.steampowered.com/IPlayerService/GetSteamLevel/v1/")
        .query(&[("key", api_key), ("steamid", steam_id)])
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|error| error.to_string())?;

    value
        .get("response")
        .and_then(|response| response.get("player_level"))
        .or_else(|| value.get("playerLevel"))
        .or_else(|| value.get("player_level"))
        .or_else(|| value.get("level"))
        .and_then(|value| value.as_u64())
        .map(|value| value as u32)
        .ok_or_else(|| "Steam player level missing from response".to_string())
}

/// Get Steam player level through the shared proxy, then a configured local key.
#[tauri::command]
pub async fn steam_get_player_level(
    app: tauri::AppHandle,
    steam_id: String,
) -> Result<u32, String> {
    let steam_id = steam_id.trim().to_string();
    if steam_id.is_empty() || !steam_id.chars().all(|ch| ch.is_ascii_digit()) {
        return Err("Steam ID is required".to_string());
    }

    let proxy_url = load_steam_stats_proxy_url();
    let proxy_error = if proxy_url.is_empty() {
        None
    } else {
        match fetch_steam_level_from_proxy(&proxy_url, &steam_id).await {
            Ok(level) => return Ok(level),
            Err(error) => Some(error),
        }
    };

    let api_key = load_steam_web_api_key(&app);
    if api_key.is_empty() {
        return Err(proxy_error.unwrap_or_else(|| {
            "Steam player level unavailable without Web API or stats proxy".to_string()
        }));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?;
    fetch_steam_level(&client, &steam_id, &api_key).await
}

#[tauri::command]
pub async fn steam_get_account_stats(
    app: tauri::AppHandle,
    steam_id: String,
) -> Result<SteamAccountStats, String> {
    let steam_id = steam_id.trim().to_string();
    if steam_id.is_empty() {
        return Err("Steam ID is required".to_string());
    }

    let proxy_url = load_steam_stats_proxy_url();
    // Prefer the shared Worker; never fan-out GetPlayerAchievements from the desktop
    // when a proxy is configured (avoids N× Steam API rate-limit spikes on proxy blips).
    if !proxy_url.is_empty() {
        match fetch_steam_account_stats_from_proxy(&proxy_url, &steam_id).await {
            Ok(stats) => {
                let owned_games = stats
                    .owned_playtimes
                    .iter()
                    .filter_map(|playtime| {
                        Some(SteamOwnedGameStats {
                            appid: playtime.app_id.parse().ok()?,
                            name: playtime.name.clone(),
                            playtime_forever: playtime.playtime_forever,
                            rtime_last_played: playtime.rtime_last_played,
                        })
                    })
                    .collect::<Vec<_>>();
                seed_playtimes_from_steam_owned_games(&app, &owned_games);
                apply_local_steam_playtimes(
                    &app,
                    &steam_id,
                    &owned_app_ids_from_stats(&owned_games),
                );
                return Ok(stats);
            }
            Err(proxy_error) => {
                // Proxy falhou (cold start, rate-limit, 502): tenta ao menos o
                // GetOwnedGames local (1 request, sem fan-out de conquistas)
                // para não deixar login/conexão nova com tempo zerado quando
                // o usuário tem API key local. Sem key, mantém o Err para o
                // frontend preservar o cache em vez de sobrescrever com zero.
                let fallback_api_key = load_steam_web_api_key(&app);
                if !fallback_api_key.is_empty() {
                    let direct_result = match reqwest::Client::builder()
                        .timeout(std::time::Duration::from_secs(15))
                        .build()
                    {
                        Ok(client) => {
                            fetch_steam_owned_games(&client, &steam_id, &fallback_api_key).await
                        }
                        Err(error) => Err(error.to_string()),
                    };
                    match direct_result {
                        Ok(owned_games) => {
                            seed_playtimes_from_steam_owned_games(&app, &owned_games);
                            apply_local_steam_playtimes(
                                &app,
                                &steam_id,
                                &owned_app_ids_from_stats(&owned_games),
                            );
                            let fallback_cache = load_steam_account_stats_cache(&app, &steam_id);
                            return Ok(build_steam_account_stats(
                                &steam_id,
                                &owned_games,
                                &fallback_cache,
                                true,
                                false,
                                false,
                            ));
                        }
                        Err(direct_error) => {
                            return Err(format!(
                                "Steam stats proxy failed ({proxy_error}); direct Steam API also failed ({direct_error})"
                            ));
                        }
                    }
                }
                return Err(format!(
                    "Steam stats proxy is temporarily unavailable: {proxy_error}"
                ));
            }
        }
    }

    let api_key = load_steam_web_api_key(&app);
    let cache = load_steam_account_stats_cache(&app, &steam_id);
    if api_key.is_empty() {
        // Sem fonte de dados (proxy desconfigurado + sem chave local): preserva
        // o cache em vez de fabricar zeros com `fetchedAt` fresco — zeros
        // sobrescreveriam totais válidos e, pelo guarda de `fetchedAt` no
        // frontend, bloqueariam respostas boas posteriores (login novo travado
        // em zero conquistas). Mesmo princípio do caminho de proxy falho acima.
        return Err("Steam stats unavailable without Web API key or stats proxy".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?;
    let owned_games = match fetch_steam_owned_games(&client, &steam_id, &api_key).await {
        Ok(games) => games,
        Err(error) => return Err(error),
    };

    seed_playtimes_from_steam_owned_games(&app, &owned_games);
    apply_local_steam_playtimes(&app, &steam_id, &owned_app_ids_from_stats(&owned_games));

    let now = steam_unix_timestamp();
    let scan_needed = owned_games.iter().any(|game| {
        should_refresh_achievement_entry(
            cache.games.get(&game.appid.to_string()),
            game.playtime_forever,
            now,
        )
    });
    if scan_needed {
        start_steam_achievement_stats_scan(
            app.clone(),
            steam_id.clone(),
            api_key,
            owned_games.clone(),
        );
    }

    Ok(build_steam_account_stats(
        &steam_id,
        &owned_games,
        &cache,
        true,
        false,
        scan_needed,
    ))
}

async fn fetch_steam_wishlist_from_proxy(
    proxy_url: &str,
    steam_id: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let value = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?
        .get(format!("{proxy_url}/steam/wishlist"))
        .query(&[("steamId", steam_id)])
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|error| error.to_string())?;

    let items = value
        .get("items")
        .and_then(|items| items.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(items)
}

#[tauri::command]
pub async fn steam_get_wishlist(steam_id: String) -> Result<Vec<serde_json::Value>, String> {
    let steam_id = steam_id.trim();
    if steam_id.is_empty() || !steam_id.chars().all(|ch| ch.is_ascii_digit()) {
        return Ok(Vec::new());
    }

    let proxy_url = load_steam_stats_proxy_url();
    if proxy_url.is_empty() {
        return Ok(Vec::new());
    }
    fetch_steam_wishlist_from_proxy(&proxy_url, steam_id).await
}

async fn fetch_steam_recommended_tags_from_proxy(
    proxy_url: &str,
    steam_id: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let value = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?
        .get(format!("{proxy_url}/steam/recommended-tags"))
        .query(&[("steamId", steam_id)])
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|error| error.to_string())?;

    let tags = value
        .get("tags")
        .and_then(|tags| tags.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(tags)
}

#[tauri::command]
pub async fn steam_get_recommended_tags_for_user(
    steam_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let steam_id = steam_id.trim();
    if steam_id.is_empty() || !steam_id.chars().all(|ch| ch.is_ascii_digit()) {
        return Ok(Vec::new());
    }

    let proxy_url = load_steam_stats_proxy_url();
    if proxy_url.is_empty() {
        return Ok(Vec::new());
    }
    match fetch_steam_recommended_tags_from_proxy(&proxy_url, steam_id).await {
        Ok(tags) => Ok(tags),
        Err(_) => Ok(Vec::new()),
    }
}

fn unix_timestamp_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn read_morelike_cache(app: &tauri::AppHandle) -> serde_json::Map<String, serde_json::Value> {
    read_json_file(app, STEAM_MORELIKE_CACHE_FILE)
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

fn write_morelike_cache(
    app: &tauri::AppHandle,
    cache: &serde_json::Map<String, serde_json::Value>,
) {
    let _ = write_json_file(
        app,
        STEAM_MORELIKE_CACHE_FILE,
        &serde_json::Value::Object(cache.clone()),
    );
}

fn cached_morelike_app_ids(app: &tauri::AppHandle, app_id: &str) -> Option<Vec<String>> {
    let cache = read_morelike_cache(app);
    let entry = cache.get(app_id)?;
    let fetched_at = entry.get("fetchedAt").and_then(|value| value.as_u64())?;
    let now = unix_timestamp_seconds();
    if now.saturating_sub(fetched_at) > STEAM_MORELIKE_CACHE_MAX_AGE_SECONDS {
        return None;
    }

    let app_ids = entry
        .get("appIds")
        .and_then(|value| value.as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str())
                .filter(|value| value.chars().all(|ch| ch.is_ascii_digit()))
                .map(ToOwned::to_owned)
                .take(STEAM_MORELIKE_MAX_RESULTS)
                .collect::<Vec<_>>()
        })?;

    Some(app_ids)
}

fn store_morelike_app_ids(app: &tauri::AppHandle, app_id: &str, app_ids: &[String]) {
    let mut cache = read_morelike_cache(app);
    cache.insert(
        app_id.to_string(),
        serde_json::json!({
            "appIds": app_ids,
            "fetchedAt": unix_timestamp_seconds(),
        }),
    );
    write_morelike_cache(app, &cache);
}

async fn fetch_steam_similar_app_ids_from_proxy(
    proxy_url: &str,
    app_id: &str,
) -> Result<Vec<String>, String> {
    let value = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?
        .get(format!("{proxy_url}/steam/similar"))
        .query(&[("appId", app_id)])
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|error| error.to_string())?;

    let app_ids = value
        .get("appIds")
        .and_then(|value| value.as_array())
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str())
                .filter(|value| value.chars().all(|ch| ch.is_ascii_digit()))
                .map(ToOwned::to_owned)
                .take(STEAM_MORELIKE_MAX_RESULTS)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(app_ids)
}

#[tauri::command]
pub async fn steam_get_similar_app_ids(
    app: tauri::AppHandle,
    app_id: String,
) -> Result<Vec<String>, String> {
    let app_id = app_id.trim().to_string();
    if app_id.is_empty() || !app_id.chars().all(|ch| ch.is_ascii_digit()) {
        return Ok(Vec::new());
    }

    if let Some(cached) = cached_morelike_app_ids(&app, &app_id) {
        return Ok(cached);
    }

    let proxy_url = load_steam_stats_proxy_url();
    if proxy_url.is_empty() {
        return Ok(Vec::new());
    }

    match fetch_steam_similar_app_ids_from_proxy(&proxy_url, &app_id).await {
        Ok(app_ids) => {
            if !app_ids.is_empty() {
                store_morelike_app_ids(&app, &app_id, &app_ids);
            }
            Ok(app_ids)
        }
        Err(_) => Ok(Vec::new()),
    }
}

#[tauri::command]
pub fn steam_save_profile(
    app: tauri::AppHandle,
    profile: serde_json::Value,
) -> Result<serde_json::Value, String> {
    save_steam_profile(&app, profile)
}

#[tauri::command]
pub async fn steam_connect_account(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    connect_steam_account(&app).await
}

/// Disconnects Steam from the current GhostBox account. Unlike signing out
/// of GhostBox entirely, this must not touch `cloud-session.bin` — the
/// account session stays active, only the Steam connection (and the local
/// profile cache used to unlock metrics) goes away.
#[tauri::command]
pub async fn steam_disconnect_account(app: tauri::AppHandle) -> Result<(), String> {
    // The Worker enforces the at-least-one-linked-provider rule and refuses
    // with `last_connection` when Steam is the only one. The error propagates
    // so the UI can explain it, and the local profile cache stays: the cloud
    // link this cache mirrors is still in place.
    crate::cloud_save::cloud_disconnect_connection(app.clone(), "steam".to_string()).await?;
    remove_data_file(&app, STEAM_PROFILE_FILE)
}

fn playtime_entry_timestamp(entry: &serde_json::Value) -> i64 {
    entry
        .get("lastTimePlayed")
        .and_then(serde_json::Value::as_str)
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.timestamp_millis())
        .unwrap_or(0)
}

fn merge_playtime_entries(
    existing: &serde_json::Value,
    incoming: &serde_json::Value,
) -> serde_json::Value {
    let existing_time = playtime_entry_timestamp(existing);
    let incoming_time = playtime_entry_timestamp(incoming);
    let mut merged = if incoming_time >= existing_time {
        incoming.clone()
    } else {
        existing.clone()
    };

    let max_playtime = existing
        .get("playTimeInMilliseconds")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0)
        .max(
            incoming
                .get("playTimeInMilliseconds")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(0),
        );
    merged["playTimeInMilliseconds"] = serde_json::json!(max_playtime);
    merged
}

#[tauri::command]
pub fn steam_clear_local_profile(app: tauri::AppHandle) -> Result<(), String> {
    remove_data_file(&app, STEAM_PROFILE_FILE)
}

pub(crate) fn parse_vdf_string_value(line: &str, key: &str) -> Option<String> {
    let mut parts = line.split('"').filter(|part| !part.trim().is_empty());
    let found_key = parts.next()?.trim();
    let value = parts.next()?.trim();
    if found_key.eq_ignore_ascii_case(key) {
        Some(value.replace("\\\\", "\\"))
    } else {
        None
    }
}

pub(crate) fn read_steam_library_paths(steam_path: &str) -> Vec<String> {
    // Mantém compatibilidade: raiz primeiro, depois secundárias na ordem do VDF.
    let mut ordered = read_steam_library_paths_ordered(steam_path);
    ordered.sort_by_key(|(index, _)| *index);
    let mut paths = vec![steam_path.to_string()];
    let key_for = |value: &str| {
        value
            .to_lowercase()
            .trim_end_matches(['\\', '/'])
            .to_string()
    };
    for (_, path) in ordered {
        let key = key_for(&path);
        let already_listed = paths.iter().any(|item| key_for(item) == key);
        if !already_listed {
            paths.push(path);
        }
    }
    paths
}

/// Seleção de destino: somente caminhos declarados no VDF, sem inventar a
/// raiz da Steam como fallback. A cópia de config é autoritativa quando existe.
pub(crate) fn read_registered_steam_library_paths(steam_path: &str) -> Vec<String> {
    let root = std::path::Path::new(steam_path);
    for candidate in [root.join("config/libraryfolders.vdf"), steamapps_path(root).join("libraryfolders.vdf")] {
        let Ok(contents) = std::fs::read_to_string(candidate) else { continue; };
        let mut paths: Vec<String> = Vec::new();
        for (_, path) in parse_libraryfolders_indexed(&contents) {
            let Some(valid) = normalize_steam_root_path(&path) else { continue; };
            let key = |value: &str| value.replace('/', "\\").trim_end_matches('\\').to_lowercase();
            if !paths.iter().any(|existing| key(existing) == key(&valid)) { paths.push(valid); }
        }
        return paths;
    }
    Vec::new()
}

/// `(indice do VDF, path)` na ordem declarada. Lê `config/libraryfolders.vdf`
/// (autoritativo) primeiro e faz merge com `steamapps/libraryfolders.vdf`.
pub(crate) fn read_steam_library_paths_ordered(steam_path: &str) -> Vec<(i64, String)> {
    let steam_root = std::path::Path::new(steam_path);
    let candidates = [
        steam_root.join("config").join("libraryfolders.vdf"),
        steamapps_path(steam_root).join("libraryfolders.vdf"),
    ];
    let key_for = |value: &str| {
        value
            .to_lowercase()
            .trim_end_matches(['\\', '/'])
            .to_string()
    };
    let mut merged: Vec<(i64, String)> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for candidate in candidates {
        let Ok(contents) = std::fs::read_to_string(&candidate) else {
            continue;
        };
        for (index, path) in parse_libraryfolders_indexed(&contents) {
            // Só bibliotecas que existem de verdade — evita fallback para
            // `C:\Program Files` fantasma ou secundária desplugada.
            let Some(valid) = normalize_steam_root_path(&path) else {
                continue;
            };
            let key = key_for(&valid);
            if seen.iter().any(|item| *item == key) {
                continue;
            }
            seen.push(key);
            merged.push((index, valid));
        }
    }
    // Garante a raiz mesmo quando nenhum VDF existe/parseia.
    if merged.is_empty() {
        return vec![(0, steam_path.to_string())];
    }
    merged.sort_by_key(|(index, _)| *index);
    merged
}

fn parse_libraryfolders_indexed(contents: &str) -> Vec<(i64, String)> {
    let mut out: Vec<(i64, String)> = Vec::new();
    let mut pending_index: Option<i64> = None;
    for line in contents.lines() {
        if let Some(path) = parse_vdf_string_value(line, "path") {
            let index = pending_index.take().unwrap_or(i64::MAX);
            out.push((index, path));
            continue;
        }
        // Bloco de biblioteca começa com `"N"` sozinho na linha.
        let trimmed = line.trim();
        if trimmed.chars().filter(|c| *c == '"').count() == 2
            && trimmed.starts_with('"')
            && trimmed.ends_with('"')
        {
            if let Some(inner) = trimmed
                .strip_prefix('"')
                .and_then(|s| s.strip_suffix('"'))
            {
                if let Ok(index) = inner.trim().parse::<i64>() {
                    pending_index = Some(index);
                }
            }
        }
    }
    out.sort_by_key(|(index, _)| *index);
    out
}

/// `LastInstallFolderIndex` de `userdata/*/config/localconfig.vdf` — é o que a
/// Steam atualiza quando o usuário estrela uma biblioteca como padrão em
/// `Configurações > Armazenamento` ou instala nela. `0` = raiz, `N` = índice
/// do `libraryfolders.vdf`. Usa o perfil mais recente quando há vários.
pub(crate) fn read_last_install_folder_index(steam_path: &str) -> Option<i64> {
    let userdata = std::path::Path::new(steam_path).join("userdata");
    let Ok(entries) = std::fs::read_dir(&userdata) else {
        return None;
    };
    let mut best: Option<(std::time::SystemTime, i64)> = None;
    let mut fallback: Option<i64> = None;
    for entry in entries.flatten() {
        let path = entry.path().join("config").join("localconfig.vdf");
        let Ok(contents) = std::fs::read_to_string(&path) else {
            continue;
        };
        let mut found: Option<i64> = None;
        for line in contents.lines() {
            if let Some(value) = parse_vdf_string_value(line, "LastInstallFolderIndex") {
                if let Ok(index) = value.trim().parse::<i64>() {
                    found = Some(index);
                    break;
                }
            }
        }
        let Some(index) = found else {
            continue;
        };
        if fallback.is_none() {
            fallback = Some(index);
        }
        let modified = std::fs::metadata(&path).and_then(|m| m.modified()).ok();
        if let Some(modified) = modified {
            let is_better = match &best {
                Some((time, _)) => modified > *time,
                None => true,
            };
            if is_better {
                best = Some((modified, index));
            }
        }
    }
    best.map(|(_, index)| index).or(fallback)
}

/// Biblioteca predefinida para jogos novos: a favorita da Steam, não a raiz.
/// Prioridade: `LastInstallFolderIndex` válido e não-zero > primeira secundária
/// válida (ex. `E:\SteamLibrary`) > raiz `0`. `C:\Program Files` só é usado
/// quando não há nenhuma secundária válida — ele exige admin e era o fallback
/// que gerava `Pasta de instalacao nao encontrada`.
pub(crate) fn resolve_default_install_library(steam_path: &str) -> String {
    let ordered = read_steam_library_paths_ordered(steam_path);
    if let Some(wanted) = read_last_install_folder_index(steam_path) {
        // `0` = raiz: trata como "sem preferência" para não prender no `C:`
        // quando existe secundária. `C:` só volta no fallback final.
        if wanted != 0 {
            if let Some((_, path)) = ordered.iter().find(|(index, _)| *index == wanted) {
                return path.clone();
            }
        }
    }
    let root_key = steam_path
        .to_lowercase()
        .trim_end_matches(['\\', '/'])
        .to_string();
    // Prefere secundária: a raiz `C:\Program Files (x86)\Steam` exige admin e
    // quase nunca é a favorita do usuário.
    if let Some((_, path)) = ordered.iter().find(|(_, path)| {
        path.to_lowercase().trim_end_matches(['\\', '/']).to_string() != root_key
    }) {
        return path.clone();
    }
    ordered
        .first()
        .map(|(_, path)| path.clone())
        .unwrap_or_else(|| steam_path.to_string())
}

fn parse_app_manifest(path: &std::path::Path) -> Option<serde_json::Value> {
    let contents = std::fs::read_to_string(path).ok()?;
    let mut app_id = String::new();
    let mut name = String::new();
    let mut install_dir = String::new();
    let mut size_on_disk = String::new();
    let mut state_flags = String::new();
    let mut bytes_to_download = String::new();
    let mut bytes_downloaded = String::new();

    for line in contents.lines() {
        if app_id.is_empty() {
            app_id = parse_vdf_string_value(line, "appid").unwrap_or_default();
        }
        if name.is_empty() {
            name = parse_vdf_string_value(line, "name").unwrap_or_default();
        }
        if install_dir.is_empty() {
            install_dir = parse_vdf_string_value(line, "installdir").unwrap_or_default();
        }
        if size_on_disk.is_empty() {
            size_on_disk = parse_vdf_string_value(line, "SizeOnDisk").unwrap_or_default();
        }
        if state_flags.is_empty() {
            state_flags = parse_vdf_string_value(line, "StateFlags").unwrap_or_default();
        }
        if bytes_to_download.is_empty() {
            bytes_to_download = parse_vdf_string_value(line, "BytesToDownload").unwrap_or_default();
        }
        if bytes_downloaded.is_empty() {
            bytes_downloaded = parse_vdf_string_value(line, "BytesDownloaded").unwrap_or_default();
        }
    }

    if app_id.is_empty() || name.is_empty() {
        return None;
    }

    let library_path = path.parent()?.parent()?.to_string_lossy().to_string();
    let install_path = path
        .parent()?
        .join("common")
        .join(if install_dir.is_empty() {
            &name
        } else {
            &install_dir
        })
        .to_string_lossy()
        .to_string();
    let cover_url = steam_asset_url(&app_id, "header.jpg");
    let hero_url = steam_asset_url(&app_id, "library_hero.jpg");
    let size_bytes = size_on_disk.parse::<u64>().ok().unwrap_or(0);
    let size = if size_bytes > 0 {
        format!("{:.1} GB", size_bytes as f64 / 1_073_741_824.0)
    } else {
        String::new()
    };
    let fully_installed = state_flags == "4";
    let total_download_bytes = bytes_to_download.parse::<u64>().unwrap_or(0);
    let downloaded_bytes = bytes_downloaded.parse::<u64>().unwrap_or(0);
    let progress = if fully_installed {
        100
    } else if total_download_bytes > 0 {
        (downloaded_bytes.saturating_mul(100) / total_download_bytes).min(100)
    } else {
        0
    };

    Some(serde_json::json!({
        "appId": app_id,
        "id": format!("steam-{app_id}"),
        "librarySource": "steam-installed",
        "title": name,
        "subtitle": if fully_installed { "Instalado via Steam" } else { "Download pendente na Steam" },
        "status": if fully_installed { "installed" } else { "queued" },
        "steamDownloadPending": !fully_installed,
        "hours": 0,
        "playTimeInMilliseconds": 0,
        "lastTimePlayed": null,
        "rating": 0,
        "size": size,
        "release": "",
        "progress": progress,
        "accent": "#66c0f4",
        "cover": cover_url,
        "hero": hero_url,
        "coverUrl": cover_url,
        "heroUrl": hero_url,
        "coverFallbacks": [steam_asset_url(&app_id, "library_600x900.jpg"), steam_asset_url(&app_id, "capsule_616x353.jpg")],
        "heroFallbacks": [steam_asset_url(&app_id, "library_hero.jpg"), steam_asset_url(&app_id, "header.jpg")],
        "logo": steam_asset_url(&app_id, "logo.png"),
        "tags": [],
        "genres": [],
        "developers": [],
        "publishers": [],
        "screenshots": [hero_url],
        "achievements": { "unlocked": 0, "total": 0, "progress": 0 },
        "achievementList": [],
        "installDir": install_dir,
        "installPath": install_path,
        "libraryPath": library_path
    }))
}

pub(crate) fn scan_installed_steam_games(library_paths: &[String]) -> Vec<serde_json::Value> {
    let mut games = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for library_path in library_paths {
        let steamapps = steamapps_path(std::path::Path::new(library_path));
        let Ok(entries) = std::fs::read_dir(steamapps) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if !file_name.starts_with("appmanifest_") || !file_name.ends_with(".acf") {
                continue;
            }

            if let Some(game) = parse_app_manifest(&path) {
                let app_id = text_value(game.get("appId"));
                if seen.insert(app_id) {
                    games.push(game);
                }
            }
        }
    }

    games.sort_by(|a, b| text_value(a.get("title")).cmp(&text_value(b.get("title"))));
    games
}

#[tauri::command]
pub fn steam_select_path(
    app: tauri::AppHandle,
    steam_path: String,
) -> Result<serde_json::Value, String> {
    let selected_path = steam_path.trim();
    let Some(normalized_path) = normalize_steam_root_path(selected_path) else {
        if let Err(error) = std::fs::read_dir(selected_path) {
            if error.kind() == std::io::ErrorKind::PermissionDenied {
                return Ok(serde_json::json!({
                    "status": "invalid",
                    "selectedPath": selected_path,
                    "missingEntries": Vec::<String>::new(),
                    "message": "Sem permissão para ler essa pasta. Escolha uma pasta acessível ou ajuste as permissões do Windows."
                }));
            }
        }
        let missing_entries = vec![steamapps_path(std::path::Path::new(selected_path))
            .join("libraryfolders.vdf")
            .to_string_lossy()
            .to_string()];
        return Ok(serde_json::json!({
            "status": "invalid",
            "selectedPath": selected_path,
            "missingEntries": missing_entries,
            "message": "A pasta selecionada não parece conter uma instalação válida da Steam."
        }));
    };

    save_steam_path(&app, &normalized_path)?;
    Ok(serde_json::json!({
        "status": "ok",
        "steamPath": normalized_path
    }))
}

#[tauri::command]
pub fn steam_is_game_installed(app: tauri::AppHandle, app_id: String) -> Result<bool, String> {
    if app_id.is_empty() || !app_id.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("AppID inválido para verificar a instalação.".to_string());
    }
    let (steam_path, _) = resolve_steam_path(&app, None);
    let steam_path = steam_path.ok_or("Não foi possível localizar a instalação da Steam.")?;
    Ok(read_steam_library_paths(&steam_path).iter().any(|library| {
        crate::steam_appmanifest::appmanifest_path(std::path::Path::new(library), &app_id).is_file()
    }))
}

#[tauri::command]
pub fn steam_scan_library(
    app: tauri::AppHandle,
    steam_path: Option<String>,
    _force_refresh_owned_games: Option<bool>,
    _include_owned_games: Option<bool>,
) -> Result<serde_json::Value, String> {
    let ghostbox_library_games = ghostbox_library::read_ghostbox_library_games(&app);
    let (resolved_path, checked_paths) = resolve_steam_path(&app, steam_path);

    let Some(steam_path) = resolved_path else {
        if ghostbox_library_games.is_empty() {
            return Ok(serde_json::json!({
                "status": "missing",
                "checkedPaths": checked_paths,
                "message": "Não foi possível localizar a instalação da Steam."
            }));
        }

        let stored_path = load_saved_steam_path(&app);
        let playtimes = playtime::load_game_playtimes(&app);
        let added_app_ids = ghostbox_library_games
            .iter()
            .map(extract_app_id)
            .filter(|app_id| !app_id.is_empty())
            .collect::<Vec<_>>();
        let steam_path_ref = stored_path.as_str();
        let games = ghostbox_library_games
            .into_iter()
            .map(|mut game| {
                // Mesmo critério do caminho com scan: jogo do registry sem
                // fonte declarada (adds LuaTools antigos) é jogo do GhostBox.
                if let Some(object) = game.as_object_mut() {
                    object
                        .entry("librarySource".to_string())
                        .or_insert_with(|| serde_json::json!("ghostbox"));
                }
                merge_playtime_into_game(game, &playtimes)
            })
            .map(|game| enrich_game_with_local_achievement_stats(&app, game, steam_path_ref))
            .collect::<Vec<_>>();

        return Ok(serde_json::json!({
            "status": "ok",
            "steamPath": stored_path,
            "libraryPaths": [],
            "appIds": added_app_ids,
            "addedAppIds": added_app_ids,
            "games": games
        }));
    };

    save_steam_path(&app, &steam_path)?;
    let library_paths = read_steam_library_paths(&steam_path);
    let installed_games = scan_installed_steam_games(&library_paths);
    let plugin_app_ids = ghostbox_library::read_plugin_added_steam_app_ids(&steam_path);
    let (added_app_ids, merged_games) = ghostbox_library::build_scan_games_with_plugins(
        installed_games,
        &plugin_app_ids,
        ghostbox_library_games,
    );
    let added_app_id_set = added_app_ids
        .iter()
        .cloned()
        .collect::<std::collections::HashSet<_>>();
    let playtimes = playtime::load_game_playtimes(&app);
    let games = merged_games
        .into_iter()
        .map(|game| merge_playtime_into_game(game, &playtimes))
        .map(|game| {
            if added_app_id_set.contains(&extract_app_id(&game)) {
                enrich_game_with_local_achievement_stats(&app, game, &steam_path)
            } else {
                game
            }
        })
        .collect::<Vec<_>>();

    Ok(serde_json::json!({
        "status": "ok",
        "steamPath": steam_path,
        "libraryPaths": library_paths,
        "appIds": added_app_ids,
        "addedAppIds": added_app_ids,
        "games": games
    }))
}

#[tauri::command]
pub fn steam_restart(app: tauri::AppHandle) -> serde_json::Value {
    use tauri_plugin_opener::OpenerExt;

    let (resolved_path, checked_paths) = resolve_steam_path(&app, None);
    if let Some(steam_path) = resolved_path {
        let steam_exe = std::path::PathBuf::from(&steam_path).join("steam.exe");
        if steam_exe.is_file() {
            terminate_steam_processes();
            std::thread::sleep(std::time::Duration::from_millis(1200));

            let mut command = silent_command(&steam_exe);
            command.current_dir(&steam_path);
            return match command.spawn() {
                Ok(_) => serde_json::json!({
                    "success": true,
                    "status": "restarted",
                    "steamPath": steam_path,
                    "message": "Steam foi encerrada completamente e aberta novamente."
                }),
                Err(error) => serde_json::json!({
                    "success": false,
                    "status": "failed",
                    "steamPath": steam_path,
                    "error": error.to_string()
                }),
            };
        }
    }

    match app.opener().open_url("steam://open/main", None::<&str>) {
        Ok(_) => serde_json::json!({
            "success": true,
            "status": "opened-url",
            "checkedPaths": checked_paths,
            "message": "Steam foi solicitada via protocolo steam://. Não foi possível encerrar processos sem localizar a instalação."
        }),
        Err(error) => serde_json::json!({
            "success": false,
            "status": "missing",
            "checkedPaths": checked_paths,
            "error": error.to_string()
        }),
    }
}

#[cfg(windows)]
fn terminate_steam_processes() {
    for process_name in [
        "steam.exe",
        "steamwebhelper.exe",
        "GameOverlayUI.exe",
        "steamerrorreporter.exe",
        "steamerrorreporter64.exe",
    ] {
        let _ = silent_command("taskkill")
            .args(["/F", "/T", "/IM", process_name])
            .status();
    }
}

#[cfg(not(windows))]
fn terminate_steam_processes() {
    for process_name in ["steam", "steamwebhelper"] {
        let _ = silent_command("pkill")
            .args(["-TERM", process_name])
            .status();
    }
}

#[cfg(windows)]
fn is_steam_process_running() -> bool {
    let output = silent_command("tasklist")
        .args(["/FI", "IMAGENAME eq steam.exe", "/NH"])
        .output();
    match output {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
            stdout.contains("steam.exe")
        }
        _ => false,
    }
}

#[cfg(not(windows))]
fn is_steam_process_running() -> bool {
    silent_command("pgrep")
        .args(["-x", "steam"])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Whether the local Steam client process is running.
#[tauri::command]
pub fn steam_is_running() -> bool {
    is_steam_process_running()
}

#[cfg(test)]
mod appmanifest_scan_tests {
    use super::parse_app_manifest;

    #[test]
    fn partial_appmanifest_is_not_reported_as_locally_installed() {
        let root = std::env::temp_dir().join(format!(
            "ghostbox-steam-scan-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4().simple()
        ));
        let steamapps = root.join("steamapps");
        std::fs::create_dir_all(&steamapps).unwrap();
        let manifest = steamapps.join("appmanifest_10.acf");
        std::fs::write(
            &manifest,
            "\"AppState\"\n{\n\t\"appid\"\t\t\"10\"\n\t\"name\"\t\t\"Pending Game\"\n\t\"StateFlags\"\t\t\"2\"\n\t\"installdir\"\t\t\"Pending Game\"\n\t\"SizeOnDisk\"\t\t\"10485760\"\n\t\"BytesToDownload\"\t\t\"50000000\"\n\t\"BytesDownloaded\"\t\t\"10485760\"\n}\n",
        )
        .unwrap();

        let game = parse_app_manifest(&manifest).unwrap();
        assert_eq!(game["status"], "queued");
        assert_eq!(game["steamDownloadPending"], true);
        assert_ne!(game["progress"], 100);
        std::fs::remove_dir_all(root).ok();
    }
}

#[cfg(test)]
mod default_library_tests {
    use super::{
        parse_libraryfolders_indexed, read_last_install_folder_index,
        resolve_default_install_library,
    };

    fn unique_root(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "ghostbox-default-lib-{}-{}-{}",
            name,
            std::process::id(),
            uuid::Uuid::new_v4().simple()
        ))
    }

    fn escape(path: &std::path::Path) -> String {
        path.to_string_lossy().replace('\\', "\\\\")
    }

    fn write_libraries(
        steam_root: &std::path::Path,
        secondary: &std::path::Path,
        with_config_copy: bool,
    ) {
        // Secundária precisa existir com `steamapps/` para passar em
        // `normalize_steam_root_path`.
        std::fs::create_dir_all(steam_root.join("steamapps")).unwrap();
        std::fs::create_dir_all(secondary.join("steamapps")).unwrap();
        // Raiz também precisa de `steamapps/` para ser considerada válida.
        let vdf = format!(
            "\"libraryfolders\"\n{{\n\t\"0\"\n\t{{\n\t\t\"path\"\t\t\"{}\"\n\t}}\n\t\"1\"\n\t{{\n\t\t\"path\"\t\t\"{}\"\n\t}}\n}}\n",
            escape(steam_root),
            escape(secondary),
        );
        std::fs::write(steam_root.join("steamapps").join("libraryfolders.vdf"), &vdf).unwrap();
        if with_config_copy {
            std::fs::create_dir_all(steam_root.join("config")).unwrap();
            std::fs::write(steam_root.join("config").join("libraryfolders.vdf"), &vdf).unwrap();
        }
    }

    fn write_last_index(steam_root: &std::path::Path, index: &str) {
        let dir = steam_root.join("userdata").join("1").join("config");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("localconfig.vdf"),
            format!(
                "\"UserLocalConfigStore\"\n{{\n\t\"Software\"\n\t{{\n\t\t\"Valve\"\n\t\t{{\n\t\t\t\"Steam\"\n\t\t{{\n\t\t\t\"LastInstallFolderIndex\"\t\t\"{index}\"\n\t\t}}\n\t\t}}\n\t}}\n}}\n"
            ),
        )
        .unwrap();
    }

    #[test]
    fn parses_indexed_paths_in_order() {
        let parsed = parse_libraryfolders_indexed(
            "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"C:\\\\Steam\"\n\t}\n\t\"1\"\n\t{\n\t\t\"path\"\t\t\"E:\\\\SteamLibrary\"\n\t}\n}\n",
        );
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].0, 0);
        assert_eq!(parsed[1].0, 1);
        assert!(parsed[1].1.contains("SteamLibrary"));
    }

    #[test]
    fn registered_libraries_do_not_invent_a_steam_root_without_a_vdf() {
        let steam = unique_root("registered-no-vdf");
        std::fs::create_dir_all(steam.join("steamapps")).unwrap();
        assert!(super::read_registered_steam_library_paths(&steam.to_string_lossy()).is_empty());
        // Outros fluxos continuam com o fallback legado; só a seleção é estrita.
        assert!(!super::read_steam_library_paths(&steam.to_string_lossy()).is_empty());
        std::fs::remove_dir_all(steam).unwrap();
    }

    #[test]
    fn registered_libraries_use_the_authoritative_vdf_without_adding_unlisted_paths() {
        let steam = unique_root("registered-authoritative");
        let secondary = steam.join("Secondary");
        write_libraries(&steam, &secondary, false);
        std::fs::create_dir_all(steam.join("config")).unwrap();
        let vdf = format!("\"libraryfolders\"\n{{\n\t\"1\"\n\t{{\n\t\t\"path\"\t\t\"{}\"\n\t}}\n}}\n", escape(&secondary));
        std::fs::write(steam.join("config/libraryfolders.vdf"), vdf).unwrap();
        let paths = super::read_registered_steam_library_paths(&steam.to_string_lossy());
        assert_eq!(paths, vec![secondary.to_string_lossy().to_string()]);
        std::fs::remove_dir_all(steam).unwrap();
    }

    #[test]
    fn registered_libraries_support_the_steamapps_vdf_and_empty_config_does_not_fall_back() {
        let steam = unique_root("registered-steamapps");
        let secondary = steam.join("Secondary");
        write_libraries(&steam, &secondary, false);
        assert_eq!(super::read_registered_steam_library_paths(&steam.to_string_lossy()).len(), 2);
        std::fs::create_dir_all(steam.join("config")).unwrap();
        std::fs::write(steam.join("config/libraryfolders.vdf"), "\"libraryfolders\"\n{\n}\n").unwrap();
        assert!(super::read_registered_steam_library_paths(&steam.to_string_lossy()).is_empty());
        std::fs::remove_dir_all(steam).unwrap();
    }

    #[test]
    fn prefers_last_install_folder_index() {
        let steam = unique_root("fav-index");
        let secondary = steam.parent().unwrap().join(format!(
            "ghostbox-secondary-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4().simple()
        ));
        write_libraries(&steam, &secondary, true);
        write_last_index(&steam, "1");

        assert_eq!(read_last_install_folder_index(&steam.to_string_lossy()), Some(1));
        assert_eq!(
            resolve_default_install_library(&steam.to_string_lossy()),
            secondary.to_string_lossy().to_string()
        );
        std::fs::remove_dir_all(&steam).ok();
        std::fs::remove_dir_all(&secondary).ok();
    }

    #[test]
    fn prefers_secondary_when_no_localconfig() {
        let steam = unique_root("fav-secondary");
        let secondary = steam.parent().unwrap().join(format!(
            "ghostbox-secondary-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4().simple()
        ));
        write_libraries(&steam, &secondary, false);

        // Sem `LastInstallFolderIndex`, a favorita é a primeira secundária —
        // nunca `C:\Program Files` com UAC.
        assert_eq!(
            resolve_default_install_library(&steam.to_string_lossy()),
            secondary.to_string_lossy().to_string()
        );
        std::fs::remove_dir_all(&steam).ok();
        std::fs::remove_dir_all(&secondary).ok();
    }

    #[test]
    fn falls_back_to_root_when_only_root() {
        let steam = unique_root("fav-root");
        std::fs::create_dir_all(steam.join("steamapps")).unwrap();
        let vdf = format!(
            "\"libraryfolders\"\n{{\n\t\"0\"\n\t{{\n\t\t\"path\"\t\t\"{}\"\n\t}}\n}}\n",
            escape(&steam),
        );
        std::fs::write(steam.join("steamapps").join("libraryfolders.vdf"), &vdf).unwrap();
        assert_eq!(
            resolve_default_install_library(&steam.to_string_lossy()),
            steam.to_string_lossy().to_string()
        );
        std::fs::remove_dir_all(&steam).ok();
    }

    #[test]
    fn zero_index_still_prefers_secondary() {
        let steam = unique_root("fav-zero");
        let secondary = steam.parent().unwrap().join(format!(
            "ghostbox-secondary-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4().simple()
        ));
        write_libraries(&steam, &secondary, false);
        write_last_index(&steam, "0");

        // `0` = raiz: C: só quando não houver secundária válida.
        assert_eq!(
            resolve_default_install_library(&steam.to_string_lossy()),
            secondary.to_string_lossy().to_string()
        );
        std::fs::remove_dir_all(&steam).ok();
        std::fs::remove_dir_all(&secondary).ok();
    }
}
