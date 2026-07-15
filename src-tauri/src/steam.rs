use crate::ghostbox_library;
use crate::playtime;
use crate::settings::{
    load_steam_stats_proxy_url, load_steam_web_api_key, read_json_file, remove_data_file,
    write_json_file,
};
use crate::util::{escape_html, silent_command, text_value, xml_text, EmptyStringExt};
use crate::{
    enrich_game_with_local_achievement_stats, extract_app_id, load_saved_steam_path,
    merge_playtime_into_game, normalize_steam_root_path, resolve_steam_path, save_steam_path,
    steam_asset_url, steamapps_path,
};
use std::collections::{HashMap, HashSet};
use tauri::Emitter;

const STEAM_PROFILE_FILE: &str = "steam-profile.json";
const STEAM_ACCOUNT_STATS_CACHE_FILE: &str = "steam-account-stats-cache.json";
const STEAM_ACCOUNT_STATS_UPDATED_EVENT: &str = "steam-account-stats-updated";
const STEAM_ACHIEVEMENT_SCAN_CONCURRENCY: usize = 8;
const STEAM_ACHIEVEMENT_CACHE_MAX_AGE_SECONDS: u64 = 7 * 24 * 60 * 60;
const STEAM_NO_STATS_CACHE_MAX_AGE_SECONDS: u64 = 30 * 24 * 60 * 60;
const MAX_PROFILE_AVATAR_BYTES: usize = 512 * 1024;
const STEAM_OPENID_ENDPOINT: &str = "https://steamcommunity.com/openid/login";
const STEAM_WISHLIST_USER_AGENT: &str = "Mozilla/5.0 GhostBox/0.1";

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

async fn fetch_steam_profile(steam_id: &str) -> Result<serde_json::Value, String> {
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

    let max_age = if entry.last_error.as_deref() == Some("no_stats") {
        STEAM_NO_STATS_CACHE_MAX_AGE_SECONDS
    } else {
        STEAM_ACHIEVEMENT_CACHE_MAX_AGE_SECONDS
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

/// Resolve owned games for playtime only via Cloudflare proxy (Steam Web API key on worker).
async fn resolve_steam_owned_games_for_playtime(
    _app: &tauri::AppHandle,
    steam_id: &str,
) -> Result<Vec<SteamOwnedGameStats>, String> {
    let proxy_url = load_steam_stats_proxy_url();
    if proxy_url.is_empty() {
        return Err("Steam stats proxy URL is not configured".to_string());
    }
    fetch_steam_owned_games_from_proxy(&proxy_url, steam_id).await
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
) -> (String, SteamAchievementCacheEntry) {
    let app_id = game.appid.to_string();
    let now = steam_unix_timestamp();
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
        return (
            app_id,
            SteamAchievementCacheEntry {
                playtime_forever: game.playtime_forever,
                last_fetched_at: now,
                last_error: Some("request_failed".to_string()),
                ..Default::default()
            },
        );
    };

    if !response.status().is_success() {
        let last_error = if response.status().as_u16() == 400 {
            "no_stats"
        } else {
            "http_error"
        };
        return (
            app_id,
            SteamAchievementCacheEntry {
                playtime_forever: game.playtime_forever,
                has_achievements: false,
                last_fetched_at: now,
                last_error: Some(last_error.to_string()),
                ..Default::default()
            },
        );
    }

    let value = match response.json::<serde_json::Value>().await {
        Ok(value) => value,
        Err(_) => {
            return (
                app_id,
                SteamAchievementCacheEntry {
                    playtime_forever: game.playtime_forever,
                    last_fetched_at: now,
                    last_error: Some("invalid_json".to_string()),
                    ..Default::default()
                },
            )
        }
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
                handles.push(tauri::async_runtime::spawn(
                    fetch_steam_game_achievement_counts(
                        client.clone(),
                        steam_id.clone(),
                        api_key.clone(),
                        game,
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

async fn validate_steam_openid(callback_url: &reqwest::Url) -> Result<bool, String> {
    let mut params = callback_url
        .query_pairs()
        .filter(|(key, _)| key.starts_with("openid."))
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect::<Vec<_>>();
    params.retain(|(key, _)| key != "openid.mode");
    params.push((
        "openid.mode".to_string(),
        "check_authentication".to_string(),
    ));

    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?
        .post(STEAM_OPENID_ENDPOINT)
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .form(&params)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        return Ok(false);
    }

    Ok(response
        .text()
        .await
        .map_err(|error| error.to_string())?
        .contains("is_valid:true"))
}

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
    let text = if message.trim().is_empty() {
        if success {
            "Connected."
        } else {
            "Not connected."
        }
    } else {
        message.trim()
    };

    format!(
        "<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\" /><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" /><title>GhostBox</title><style>:root {{ color-scheme: dark; }} body {{ min-height: 100vh; margin: 0; display: grid; place-items: center; background: #0b0b0b; color: #d3d3d3; font: 500 24px \"Segoe UI\", system-ui, sans-serif; user-select: none; }} p {{ margin: 0; }}</style></head><body><p>{}</p></body></html>",
        escape_html(text)
    )
}

fn write_http_response(stream: &mut std::net::TcpStream, status: &str, body: &str) {
    use std::io::Write;

    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store, max-age=0\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.as_bytes().len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn accept_steam_login_callback(
    listener: std::net::TcpListener,
    port: u16,
    state: String,
) -> Result<(reqwest::Url, std::net::TcpStream), String> {
    use std::io::Read;

    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);

    while std::time::Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buffer = [0_u8; 8192];
                let length = stream
                    .read(&mut buffer)
                    .map_err(|error| error.to_string())?;
                let request = String::from_utf8_lossy(&buffer[..length]);
                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or("/");
                let callback_url = reqwest::Url::parse(&format!("http://127.0.0.1:{port}{path}"))
                    .map_err(|error| error.to_string())?;

                if callback_url.path() != "/steam/callback"
                    || callback_url
                        .query_pairs()
                        .find(|(key, _)| key == "state")
                        .map(|(_, value)| value.to_string())
                        != Some(state.clone())
                {
                    write_http_response(
                        &mut stream,
                        "404 Not Found",
                        &steam_login_page_html(false, "Not found."),
                    );
                    continue;
                }

                return Ok((callback_url, stream));
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(error) => return Err(error.to_string()),
        }
    }

    Err("Steam login timed out".to_string())
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

async fn sign_in_with_steam(app: &tauri::AppHandle) -> Result<serde_json::Value, String> {
    use tauri_plugin_opener::OpenerExt;

    let _guard = begin_steam_sign_in()?;
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let state = uuid::Uuid::new_v4().to_string();
    let callback_url = format!("http://127.0.0.1:{port}/steam/callback?state={state}");
    let mut login_url =
        reqwest::Url::parse(STEAM_OPENID_ENDPOINT).map_err(|error| error.to_string())?;
    login_url
        .query_pairs_mut()
        .append_pair("openid.ns", "http://specs.openid.net/auth/2.0")
        .append_pair("openid.mode", "checkid_setup")
        .append_pair("openid.return_to", &callback_url)
        .append_pair("openid.realm", &format!("http://127.0.0.1:{port}"))
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

    let profile = match fetch_steam_profile(&steam_id).await {
        Ok(profile) => profile,
        Err(error) => {
            write_http_response(
                &mut stream,
                "400 Bad Request",
                &steam_login_page_html(false, "Not connected."),
            );
            return Err(error);
        }
    };

    let display_name = text_value(profile.get("displayName"));
    let success_message = if display_name.is_empty() {
        "Connected.".to_string()
    } else {
        format!("Connected as {display_name}.")
    };
    write_http_response(
        &mut stream,
        "200 OK",
        &steam_login_page_html(true, &success_message),
    );

    let cloud_session =
        crate::cloud_save::cloud_authenticate_steam_callback(app, callback.as_str(), &profile)
            .await
            .ok();
    if cloud_session.is_none() && !validate_steam_openid(&callback).await? {
        return Err("Steam OpenID validation failed".to_string());
    }

    let mut saved_profile = save_steam_profile(app, profile)?;
    if let Some(session) = cloud_session {
        saved_profile["cloudSession"] = session;
    }
    Ok(saved_profile)
}

#[tauri::command]
pub fn steam_get_profile(app: tauri::AppHandle) -> Option<serde_json::Value> {
    load_steam_profile(&app)
}

/// Rebuild playtime snapshot exclusively from Steam GetOwnedGames data.
/// Drops legacy local accumulators (e.g. 56s session fakes).
fn seed_playtimes_from_steam_owned_games(
    app: &tauri::AppHandle,
    owned_games: &[SteamOwnedGameStats],
) {
    if owned_games.is_empty() {
        return;
    }

    let mut snapshot = serde_json::Map::new();

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
        snapshot.insert(app_id, entry);
    }

    let value = serde_json::Value::Object(snapshot);
    let _ = playtime::replace_playtimes_from_steam(app, &value);
}

/// Sync playtime totals from Steam (proxy Web API key or local Web API key).
/// Always rebuilds `steam-owned-playtimes.json` from GetOwnedGames data.
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

fn parse_steam_level_from_profile_html(html: &str) -> Option<u32> {
    let class_index = html.find("friendPlayerLevelNum")?;
    let after_class = &html[class_index..];
    let content_start = after_class.find('>')? + 1;
    let after_tag = after_class[content_start..].trim_start();
    let digits: String = after_tag
        .chars()
        .take_while(|ch| ch.is_ascii_digit())
        .collect();
    if digits.is_empty() {
        return None;
    }
    digits.parse::<u32>().ok()
}

async fn fetch_steam_level_from_profile_page(
    client: &reqwest::Client,
    steam_id: &str,
) -> Result<u32, String> {
    let html = client
        .get(format!("https://steamcommunity.com/profiles/{steam_id}"))
        .header(reqwest::header::ACCEPT, "text/html,application/xhtml+xml")
        .header(reqwest::header::USER_AGENT, STEAM_WISHLIST_USER_AGENT)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .text()
        .await
        .map_err(|error| error.to_string())?;

    parse_steam_level_from_profile_html(&html)
        .ok_or_else(|| "Steam player level missing from profile page".to_string())
}

/// Get Steam player level via official Web API first, then proxy/profile fallbacks.
#[tauri::command]
pub async fn steam_get_player_level(
    app: tauri::AppHandle,
    steam_id: String,
) -> Result<u32, String> {
    let steam_id = steam_id.trim().to_string();
    if steam_id.is_empty() || !steam_id.chars().all(|ch| ch.is_ascii_digit()) {
        return Err("Steam ID is required".to_string());
    }

    let api_key = load_steam_web_api_key(&app);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?;

    if !api_key.is_empty() {
        if let Ok(level) = fetch_steam_level(&client, &steam_id, &api_key).await {
            return Ok(level);
        }
    }

    let proxy_url = load_steam_stats_proxy_url();
    if !proxy_url.is_empty() {
        if let Ok(level) = fetch_steam_level_from_proxy(&proxy_url, &steam_id).await {
            return Ok(level);
        }
    }

    fetch_steam_level_from_profile_page(&client, &steam_id).await
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

    // Always refresh playtimes from Steam owned-games (proxy or API key).
    if let Ok(owned_games) = resolve_steam_owned_games_for_playtime(&app, &steam_id).await {
        seed_playtimes_from_steam_owned_games(&app, &owned_games);
    }

    let proxy_url = load_steam_stats_proxy_url();
    if !proxy_url.is_empty() {
        if let Ok(stats) = fetch_steam_account_stats_from_proxy(&proxy_url, &steam_id).await {
            return Ok(stats);
        }
    }

    let api_key = load_steam_web_api_key(&app);
    let cache = load_steam_account_stats_cache(&app, &steam_id);
    if api_key.is_empty() {
        return Ok(build_steam_account_stats(
            &steam_id,
            &[],
            &cache,
            false,
            false,
            false,
        ));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?;
    let owned_games = match fetch_steam_owned_games(&client, &steam_id, &api_key).await {
        Ok(games) => games,
        Err(_) => {
            return Ok(build_steam_account_stats(
                &steam_id,
                &[],
                &cache,
                true,
                true,
                false,
            ));
        }
    };

    seed_playtimes_from_steam_owned_games(&app, &owned_games);

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

async fn fetch_steam_wishlist_titles(steam_id: &str) -> HashMap<String, String> {
    let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    else {
        return HashMap::new();
    };

    let mut titles = HashMap::new();
    for page in 0..10 {
        let url = format!(
            "https://store.steampowered.com/wishlist/profiles/{steam_id}/wishlistdata/?p={page}"
        );
        let Ok(response) = client
            .get(url)
            .header(reqwest::header::USER_AGENT, STEAM_WISHLIST_USER_AGENT)
            .header(reqwest::header::ACCEPT, "application/json,text/plain,*/*")
            .send()
            .await
        else {
            break;
        };
        if !response.status().is_success() {
            break;
        }
        let Ok(payload) = response.json::<serde_json::Value>().await else {
            break;
        };
        let Some(items) = payload.as_object() else {
            break;
        };
        if items.is_empty() {
            break;
        }

        for (key, item) in items {
            let app_id = item
                .get("appid")
                .and_then(|value| value.as_u64())
                .map(|value| value.to_string())
                .unwrap_or_else(|| key.to_string());
            let title = text_value(item.get("name"));
            if !app_id.is_empty() && !title.is_empty() {
                titles.insert(app_id, title);
            }
        }

        if items.len() < 100 {
            break;
        }
    }

    titles
}

#[tauri::command]
pub async fn steam_get_wishlist(steam_id: String) -> Result<Vec<serde_json::Value>, String> {
    let steam_id = steam_id.trim();
    if steam_id.is_empty() || !steam_id.chars().all(|ch| ch.is_ascii_digit()) {
        return Ok(Vec::new());
    }

    let url =
        format!("https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid={steam_id}");
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|error| error.to_string())?
        .get(url)
        .header(reqwest::header::USER_AGENT, STEAM_WISHLIST_USER_AGENT)
        .header(reqwest::header::ACCEPT, "application/json,text/plain,*/*")
        .send()
        .await;

    let Ok(response) = response else {
        return Ok(Vec::new());
    };
    if !response.status().is_success() {
        return Ok(Vec::new());
    }

    let Ok(payload) = response.json::<serde_json::Value>().await else {
        return Ok(Vec::new());
    };
    let Some(items) = payload
        .get("response")
        .and_then(|response| response.get("items"))
        .and_then(|items| items.as_array())
    else {
        return Ok(Vec::new());
    };

    let wishlist_titles = fetch_steam_wishlist_titles(steam_id).await;

    let mut wishlist = items
        .iter()
        .filter_map(|item| {
            let app_id = item.get("appid")?.as_u64()?.to_string();
            let priority = item
                .get("priority")
                .and_then(|value| value.as_i64())
                .unwrap_or(0);
            let date_added = item
                .get("date_added")
                .and_then(|value| value.as_i64())
                .unwrap_or(0);

            let mut wishlist_item = serde_json::json!({
                "appId": app_id,
                "priority": priority,
                "dateAdded": date_added
            });
            if let Some(title) = wishlist_titles.get(
                wishlist_item
                    .get("appId")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default(),
            ) {
                wishlist_item["title"] = serde_json::Value::String(title.clone());
            }

            Some(wishlist_item)
        })
        .collect::<Vec<_>>();

    wishlist.sort_by(|left, right| {
        let left_priority = left
            .get("priority")
            .and_then(|value| value.as_i64())
            .unwrap_or(0);
        let right_priority = right
            .get("priority")
            .and_then(|value| value.as_i64())
            .unwrap_or(0);
        let left_date = left
            .get("dateAdded")
            .and_then(|value| value.as_i64())
            .unwrap_or(0);
        let right_date = right
            .get("dateAdded")
            .and_then(|value| value.as_i64())
            .unwrap_or(0);

        match (left_priority > 0, right_priority > 0) {
            (true, true) => left_priority.cmp(&right_priority),
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            (false, false) => right_date.cmp(&left_date),
        }
    });

    Ok(wishlist)
}

#[tauri::command]
pub async fn steam_get_recommended_tags_for_user(
    steam_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let steam_id = steam_id.trim();
    if steam_id.is_empty() || !steam_id.chars().all(|ch| ch.is_ascii_digit()) {
        return Ok(Vec::new());
    }

    let url = format!(
        "https://api.steampowered.com/IStoreService/GetRecommendedTagsForUser/v1/?steamid={steam_id}"
    );
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|error| error.to_string())?
        .get(url)
        .header(reqwest::header::USER_AGENT, STEAM_WISHLIST_USER_AGENT)
        .header(reqwest::header::ACCEPT, "application/json,text/plain,*/*")
        .send()
        .await;

    let Ok(response) = response else {
        return Ok(Vec::new());
    };
    if !response.status().is_success() {
        return Ok(Vec::new());
    }

    let Ok(payload) = response.json::<serde_json::Value>().await else {
        return Ok(Vec::new());
    };
    let tags = payload
        .get("response")
        .and_then(|response| response.get("tags"))
        .or_else(|| payload.get("tags"))
        .and_then(|tags| tags.as_array())
        .map(|tags| tags.to_vec())
        .unwrap_or_default();

    Ok(tags)
}

fn parse_steam_similar_app_ids(html: &str, source_app_id: &str) -> Vec<String> {
    let marker = "data-ds-appid=\"";
    let mut rest = html;
    let mut seen = HashSet::new();
    let mut app_ids = Vec::new();

    while let Some(marker_index) = rest.find(marker) {
        let value_start = marker_index + marker.len();
        let value = &rest[value_start..];
        let Some(value_end) = value.find('"') else {
            break;
        };

        let app_id = &value[..value_end];
        if app_id != source_app_id
            && app_id.chars().all(|ch| ch.is_ascii_digit())
            && seen.insert(app_id.to_string())
        {
            app_ids.push(app_id.to_string());
            if app_ids.len() >= 30 {
                break;
            }
        }

        rest = &value[value_end + 1..];
    }

    app_ids
}

#[tauri::command]
pub async fn steam_get_similar_app_ids(app_id: String) -> Result<Vec<String>, String> {
    let app_id = app_id.trim();
    if app_id.is_empty() || !app_id.chars().all(|ch| ch.is_ascii_digit()) {
        return Ok(Vec::new());
    }

    let url = format!(
        "https://store.steampowered.com/recommended/morelike/app/{app_id}/?l=english&cc=br"
    );
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|error| error.to_string())?
        .get(url)
        .header(reqwest::header::USER_AGENT, STEAM_WISHLIST_USER_AGENT)
        .header(reqwest::header::ACCEPT, "text/html,*/*")
        .send()
        .await;

    let Ok(response) = response else {
        return Ok(Vec::new());
    };
    if !response.status().is_success() {
        return Ok(Vec::new());
    }

    let Ok(html) = response.text().await else {
        return Ok(Vec::new());
    };

    Ok(parse_steam_similar_app_ids(&html, app_id))
}

#[tauri::command]
pub fn steam_save_profile(
    app: tauri::AppHandle,
    profile: serde_json::Value,
) -> Result<serde_json::Value, String> {
    save_steam_profile(&app, profile)
}

#[tauri::command]
pub async fn steam_sign_in(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    sign_in_with_steam(&app).await
}

#[tauri::command]
pub fn steam_sign_out(app: tauri::AppHandle) -> Result<(), String> {
    let _ = crate::cloud_save::cloud_sign_out(app.clone());
    remove_data_file(&app, STEAM_PROFILE_FILE)
}

fn parse_vdf_string_value(line: &str, key: &str) -> Option<String> {
    let mut parts = line.split('"').filter(|part| !part.trim().is_empty());
    let found_key = parts.next()?.trim();
    let value = parts.next()?.trim();
    if found_key.eq_ignore_ascii_case(key) {
        Some(value.replace("\\\\", "\\"))
    } else {
        None
    }
}

fn read_steam_library_paths(steam_path: &str) -> Vec<String> {
    let mut paths = vec![steam_path.to_string()];
    let libraryfolders_path =
        steamapps_path(std::path::Path::new(steam_path)).join("libraryfolders.vdf");
    let Ok(contents) = std::fs::read_to_string(libraryfolders_path) else {
        return paths;
    };

    for line in contents.lines() {
        if let Some(path) = parse_vdf_string_value(line, "path") {
            if normalize_steam_root_path(&path).is_some() && !paths.iter().any(|item| item == &path)
            {
                paths.push(path);
            }
        }
    }

    paths
}

fn parse_app_manifest(path: &std::path::Path) -> Option<serde_json::Value> {
    let contents = std::fs::read_to_string(path).ok()?;
    let mut app_id = String::new();
    let mut name = String::new();
    let mut install_dir = String::new();
    let mut size_on_disk = String::new();

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

    Some(serde_json::json!({
        "appId": app_id,
        "id": format!("steam-{app_id}"),
        "title": name,
        "subtitle": "Instalado via Steam",
        "status": "installed",
        "hours": 0,
        "playTimeInMilliseconds": 0,
        "lastTimePlayed": null,
        "rating": 0,
        "size": size,
        "release": "",
        "progress": 100,
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

fn scan_installed_steam_games(library_paths: &[String]) -> Vec<serde_json::Value> {
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
            .map(|game| merge_playtime_into_game(game, &playtimes))
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
