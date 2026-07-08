use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

use chrono::{TimeZone, Utc};
use serde_json::{json, Value};

#[derive(Debug, Clone)]
enum VdfValue {
    Object(BTreeMap<String, VdfValue>),
    String(String),
    Int32(i32),
    UInt64(u64),
}

type VdfObject = BTreeMap<String, VdfValue>;

fn read_binary_vdf_string(data: &[u8], offset: &mut usize) -> Option<String> {
    let start = *offset;
    while *offset < data.len() && data[*offset] != 0 {
        *offset += 1;
    }
    if *offset >= data.len() {
        return None;
    }
    let value = std::str::from_utf8(&data[start..*offset]).ok()?.to_string();
    *offset += 1;
    Some(value)
}

fn parse_binary_vdf(data: &[u8]) -> VdfObject {
    let mut offset = 0;
    parse_binary_vdf_object(data, &mut offset)
}

fn parse_binary_vdf_object(data: &[u8], offset: &mut usize) -> VdfObject {
    let mut result = BTreeMap::new();

    while *offset < data.len() {
        let value_type = data[*offset];
        *offset += 1;
        if value_type == 8 {
            break;
        }

        let Some(key) = read_binary_vdf_string(data, offset) else {
            break;
        };

        let value = match value_type {
            0 => VdfValue::Object(parse_binary_vdf_object(data, offset)),
            1 => VdfValue::String(read_binary_vdf_string(data, offset).unwrap_or_default()),
            2 => {
                if *offset + 4 > data.len() {
                    break;
                }
                let value = i32::from_le_bytes(data[*offset..*offset + 4].try_into().unwrap());
                *offset += 4;
                VdfValue::Int32(value)
            }
            7 => {
                if *offset + 8 > data.len() {
                    break;
                }
                let value = u64::from_le_bytes(data[*offset..*offset + 8].try_into().unwrap());
                *offset += 8;
                VdfValue::UInt64(value)
            }
            _ => break,
        };

        result.insert(key, value);
    }

    result
}

fn vdf_object(value: &VdfValue) -> Option<&VdfObject> {
    match value {
        VdfValue::Object(object) => Some(object),
        _ => None,
    }
}

fn vdf_string(value: &VdfValue) -> String {
    match value {
        VdfValue::String(text) => text.clone(),
        VdfValue::Int32(number) => number.to_string(),
        VdfValue::UInt64(number) => number.to_string(),
        _ => String::new(),
    }
}

fn vdf_i64(value: &VdfValue) -> Option<i64> {
    match value {
        VdfValue::Int32(number) => Some(*number as i64),
        VdfValue::UInt64(number) => Some(*number as i64),
        _ => None,
    }
}

pub fn stats_directory(steam_path: &str) -> PathBuf {
    Path::new(steam_path).join("appcache").join("stats")
}

fn user_stats_files(stats_path: &Path, app_id: &str) -> Vec<PathBuf> {
    let suffix = format!("_{app_id}.bin");
    let Ok(entries) = std::fs::read_dir(stats_path) else {
        return Vec::new();
    };

    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with("UserGameStats_") && name.ends_with(&suffix))
                .unwrap_or(false)
        })
        .collect()
}

// Achievements are grouped under numeric stat ids in the appcache (for example
// stat "4" and stat "25" for The Forest). Each group keeps its own bit indices
// starting at 0, so bit "1" in one group is a different achievement than bit "1"
// in another group. These helpers preserve the stat -> bit association so that
// names can be resolved against the matching stat group in the schema. Losing
// this association causes a bit index to match multiple stat groups and inflates
// the unlocked count.
fn collect_local_unlocked_achievement_bits(stats: &VdfObject) -> HashMap<String, HashSet<String>> {
    let mut unlocked_bits: HashMap<String, HashSet<String>> = HashMap::new();
    let Some(cache) = stats.get("cache").and_then(vdf_object) else {
        return unlocked_bits;
    };

    for (stat_id, value) in cache {
        let Some(entry) = vdf_object(value) else {
            continue;
        };
        let Some(times) = entry.get("AchievementTimes").and_then(vdf_object) else {
            continue;
        };
        let group = unlocked_bits.entry(stat_id.clone()).or_default();
        for bit in times.keys() {
            group.insert(bit.clone());
        }
    }

    unlocked_bits
}

fn collect_local_achievement_times(stats: &VdfObject) -> HashMap<String, HashMap<String, i64>> {
    let mut achievement_times: HashMap<String, HashMap<String, i64>> = HashMap::new();
    let Some(cache) = stats.get("cache").and_then(vdf_object) else {
        return achievement_times;
    };

    for (stat_id, value) in cache {
        let Some(entry) = vdf_object(value) else {
            continue;
        };
        let Some(times) = entry.get("AchievementTimes").and_then(vdf_object) else {
            continue;
        };
        let group = achievement_times.entry(stat_id.clone()).or_default();
        for (bit, unlocked_at) in times {
            if let Some(timestamp) = vdf_i64(unlocked_at) {
                group.insert(bit.clone(), timestamp);
            }
        }
    }

    achievement_times
}

fn local_achievement_total_from_schema(schema: &VdfObject, app_id: &str) -> u32 {
    let Some(app_schema) = schema.get(app_id).and_then(vdf_object) else {
        return 0;
    };
    let Some(stats) = app_schema.get("stats").and_then(vdf_object) else {
        return 0;
    };

    let mut total = 0u32;
    for stat in stats.values() {
        let Some(stat_object) = vdf_object(stat) else {
            continue;
        };
        let Some(bits) = stat_object.get("bits").and_then(vdf_object) else {
            continue;
        };
        total += bits
            .values()
            .filter(|achievement| {
                vdf_object(achievement)
                    .and_then(|entry| entry.get("name"))
                    .map(vdf_string)
                    .filter(|name| !name.is_empty())
                    .is_some()
            })
            .count() as u32;
    }

    total
}

fn local_achievement_display_title(achievement: &VdfObject) -> String {
    let fallback = achievement.get("name").map(vdf_string).unwrap_or_default();
    let Some(display) = achievement.get("display").and_then(vdf_object) else {
        return fallback;
    };
    let Some(name) = display.get("name").and_then(vdf_object) else {
        return fallback;
    };

    for key in ["brazilian", "portuguese", "english"] {
        if let Some(value) = name.get(key) {
            let text = vdf_string(value);
            if !text.is_empty() {
                return text;
            }
        }
    }

    fallback
}

fn local_achievement_unlocks_from_schema(
    schema: &VdfObject,
    app_id: &str,
    achievement_times: &HashMap<String, HashMap<String, i64>>,
) -> Vec<Value> {
    let mut unlocked = Vec::new();
    let Some(app_schema) = schema.get(app_id).and_then(vdf_object) else {
        return unlocked;
    };
    let Some(stats) = app_schema.get("stats").and_then(vdf_object) else {
        return unlocked;
    };

    for (stat_id, times) in achievement_times {
        let Some(bits) = stats
            .get(stat_id)
            .and_then(vdf_object)
            .and_then(|stat_object| stat_object.get("bits"))
            .and_then(vdf_object)
        else {
            continue;
        };

        for (bit, unlocked_at) in times {
            let Some(achievement) = bits.get(bit).and_then(vdf_object) else {
                continue;
            };
            let name = achievement.get("name").map(vdf_string).unwrap_or_default();
            if name.is_empty() {
                continue;
            }

            unlocked.push(json!({
                "name": name,
                "title": local_achievement_display_title(achievement),
                "unlockedAt": if *unlocked_at > 0 {
                    Utc.timestamp_opt(*unlocked_at, 0)
                        .single()
                        .map(|value| value.to_rfc3339())
                } else {
                    None
                }
            }));
        }
    }

    unlocked.sort_by(|left, right| {
        left.get("name")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .cmp(
                right
                    .get("name")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default(),
            )
    });
    unlocked
}

// Resolves the unlocked bits (grouped per stat id) into pairs of
// (api name, display title) using the schema. Each bit is only looked up within
// its own stat group so a bit index cannot leak into a different achievement
// group.
fn resolve_local_unlocked_achievements(
    schema: &VdfObject,
    app_id: &str,
    unlocked_bits: &HashMap<String, HashSet<String>>,
) -> Vec<(String, String)> {
    let mut resolved = Vec::new();
    let stats = schema
        .get(app_id)
        .and_then(vdf_object)
        .and_then(|app_schema| app_schema.get("stats"))
        .and_then(vdf_object);

    for (stat_id, bits_unlocked) in unlocked_bits {
        let group_bits = stats
            .and_then(|stats| stats.get(stat_id))
            .and_then(vdf_object)
            .and_then(|stat_object| stat_object.get("bits"))
            .and_then(vdf_object);

        for bit in bits_unlocked {
            match group_bits.and_then(|bits| bits.get(bit)).and_then(vdf_object) {
                Some(achievement) => {
                    let name = achievement.get("name").map(vdf_string).unwrap_or_default();
                    let title = local_achievement_display_title(achievement);
                    resolved.push((name, title));
                }
                // Some emulator save formats key AchievementTimes by the
                // achievement API name itself instead of a numeric bit index.
                // In that case treat the key as the achievement name directly.
                None if !bit.is_empty() => resolved.push((bit.clone(), String::new())),
                None => {}
            }
        }
    }

    resolved
}

// Returns the set of match keys (both API names and localized display titles)
// for unlocked achievements. Used to flag entries in an achievement list that
// may expose either the API name or the display title.
fn local_achievement_names_from_schema(
    schema: &VdfObject,
    app_id: &str,
    unlocked_bits: &HashMap<String, HashSet<String>>,
) -> HashSet<String> {
    let mut unlocked_names = HashSet::new();
    for (name, title) in resolve_local_unlocked_achievements(schema, app_id, unlocked_bits) {
        if !name.is_empty() {
            unlocked_names.insert(name);
        }
        if !title.is_empty() {
            unlocked_names.insert(title);
        }
    }
    unlocked_names
}

pub fn read_steam_local_achievement_backup_file(
    steam_path: &str,
    app_id: &str,
    title: &str,
) -> Option<Value> {
    let stats_path = stats_directory(steam_path);
    if !stats_path.is_dir() {
        return None;
    }

    let schema_buffer =
        std::fs::read(stats_path.join(format!("UserGameStatsSchema_{app_id}.bin"))).ok()?;
    let user_stats_files = user_stats_files(&stats_path, app_id);
    if user_stats_files.is_empty() {
        return None;
    }

    let mut achievement_times: HashMap<String, HashMap<String, i64>> = HashMap::new();
    for file_path in user_stats_files {
        let buffer = std::fs::read(file_path).ok()?;
        for (stat_id, times) in collect_local_achievement_times(&parse_binary_vdf(&buffer)) {
            achievement_times.entry(stat_id).or_default().extend(times);
        }
    }

    if achievement_times.is_empty() {
        return None;
    }

    let schema = parse_binary_vdf(&schema_buffer);
    let total = local_achievement_total_from_schema(&schema, app_id);
    let unlocked = local_achievement_unlocks_from_schema(&schema, app_id, &achievement_times);
    if unlocked.is_empty() {
        return None;
    }

    Some(json!({
        "version": 1,
        "appId": app_id,
        "title": title,
        "updatedAt": chrono::Utc::now().to_rfc3339(),
        "source": "steam-appcache-stats",
        "total": total,
        "unlocked": unlocked
    }))
}

pub fn read_local_unlocked_achievement_names(steam_path: &str, app_id: &str) -> HashSet<String> {
    let stats_path = stats_directory(steam_path);
    if !stats_path.is_dir() {
        return HashSet::new();
    }

    let user_stats_files = user_stats_files(&stats_path, app_id);
    if user_stats_files.is_empty() {
        return HashSet::new();
    }

    let unlocked_bits = read_local_unlocked_bits_by_stat(&stats_path, app_id, &user_stats_files);
    if unlocked_bits.is_empty() {
        return HashSet::new();
    }

    let schema_buffer =
        std::fs::read(stats_path.join(format!("UserGameStatsSchema_{app_id}.bin"))).ok();
    let Some(schema_buffer) = schema_buffer else {
        return HashSet::new();
    };

    local_achievement_names_from_schema(&parse_binary_vdf(&schema_buffer), app_id, &unlocked_bits)
}

// Reads all user stats files and merges the unlocked achievement bits keyed by
// their stat group id.
fn read_local_unlocked_bits_by_stat(
    _stats_path: &Path,
    _app_id: &str,
    user_stats_files: &[PathBuf],
) -> HashMap<String, HashSet<String>> {
    let mut unlocked_bits: HashMap<String, HashSet<String>> = HashMap::new();
    for file_path in user_stats_files {
        let Some(buffer) = std::fs::read(file_path).ok() else {
            continue;
        };
        for (stat_id, bits) in collect_local_unlocked_achievement_bits(&parse_binary_vdf(&buffer)) {
            unlocked_bits.entry(stat_id).or_default().extend(bits);
        }
    }
    unlocked_bits
}

// Returns the localized display titles (falling back to the API name) of the
// unlocked achievements. This is used for user-facing unlock notifications so
// they stay human-readable instead of exposing raw API identifiers.
pub fn read_local_unlocked_achievement_titles(steam_path: &str, app_id: &str) -> HashSet<String> {
    let stats_path = stats_directory(steam_path);
    if !stats_path.is_dir() {
        return HashSet::new();
    }

    let user_stats_files = user_stats_files(&stats_path, app_id);
    if user_stats_files.is_empty() {
        return HashSet::new();
    }

    let unlocked_bits = read_local_unlocked_bits_by_stat(&stats_path, app_id, &user_stats_files);
    if unlocked_bits.is_empty() {
        return HashSet::new();
    }

    let schema_buffer =
        std::fs::read(stats_path.join(format!("UserGameStatsSchema_{app_id}.bin"))).ok();
    let Some(schema_buffer) = schema_buffer else {
        return HashSet::new();
    };

    resolve_local_unlocked_achievements(&parse_binary_vdf(&schema_buffer), app_id, &unlocked_bits)
        .into_iter()
        .map(|(name, title)| if title.is_empty() { name } else { title })
        .filter(|value| !value.is_empty())
        .collect()
}

pub fn read_local_achievement_stats(steam_path: &str, app_id: &str, persisted: &Value) -> Value {
    let persisted_total = persisted
        .get("total")
        .and_then(|value| value.as_u64())
        .unwrap_or(0) as u32;
    let persisted_unlocked = persisted
        .get("unlocked")
        .and_then(|value| value.as_u64())
        .unwrap_or(0) as u32;

    if steam_path.is_empty() {
        return json!({
            "unlocked": persisted_unlocked,
            "total": persisted_total,
            "progress": if persisted_total > 0 {
                ((persisted_unlocked as f64 / persisted_total as f64) * 100.0).round() as u32
            } else {
                0
            }
        });
    }

    let stats_path = stats_directory(steam_path);
    if !stats_path.is_dir() {
        return json!({
            "unlocked": persisted_unlocked,
            "total": persisted_total,
            "progress": if persisted_total > 0 {
                ((persisted_unlocked as f64 / persisted_total as f64) * 100.0).round() as u32
            } else {
                0
            }
        });
    }

    let schema_buffer =
        std::fs::read(stats_path.join(format!("UserGameStatsSchema_{app_id}.bin"))).ok();
    let Some(schema_buffer) = schema_buffer else {
        return json!({
            "unlocked": persisted_unlocked,
            "total": persisted_total,
            "progress": if persisted_total > 0 {
                ((persisted_unlocked as f64 / persisted_total as f64) * 100.0).round() as u32
            } else {
                0
            }
        });
    };

    let schema = parse_binary_vdf(&schema_buffer);
    let total = local_achievement_total_from_schema(&schema, app_id);
    if total == 0 {
        return json!({
            "unlocked": persisted_unlocked,
            "total": persisted_total,
            "progress": if persisted_total > 0 {
                ((persisted_unlocked as f64 / persisted_total as f64) * 100.0).round() as u32
            } else {
                0
            }
        });
    }

    let unlocked_bits =
        read_local_unlocked_bits_by_stat(&stats_path, app_id, &user_stats_files(&stats_path, app_id));
    let unlocked_count: usize = unlocked_bits.values().map(|bits| bits.len()).sum();

    let unlocked = unlocked_count
        .max(persisted_unlocked as usize)
        .min(total as usize) as u32;
    json!({
        "unlocked": unlocked,
        "total": total,
        "progress": ((unlocked as f64 / total as f64) * 100.0).round() as u32
    })
}

pub const STEAM_ACHIEVEMENTS_BACKUP_FOLDER: &str = "ghostbox-steam-achievements";
const LEGACY_EDEN_STEAM_ACHIEVEMENTS_BACKUP_FOLDER: &str = "eden-steam-achievements";
const LEGACY_STEAM_ACHIEVEMENTS_BACKUP_FOLDER: &str = "piratebox-steam-achievements";

fn is_steam_achievement_stats_file(file_name: &str, app_id: &str) -> bool {
    file_name == format!("UserGameStatsSchema_{app_id}.bin")
        || (file_name.starts_with("UserGameStats_")
            && file_name.ends_with(&format!("_{app_id}.bin")))
}

fn steam_achievement_stats_file_names(stats_path: &Path, app_id: &str) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(stats_path) else {
        return Vec::new();
    };

    entries
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|file_name| is_steam_achievement_stats_file(file_name, app_id))
        .collect()
}

pub fn backup_steam_achievement_files(steam_path: &str, app_id: &str, backup_path: &Path) {
    if steam_path.is_empty() || app_id.is_empty() {
        return;
    }

    let stats_path = stats_directory(steam_path);
    if !stats_path.is_dir() {
        return;
    }

    let file_names = steam_achievement_stats_file_names(&stats_path, app_id);
    if file_names.is_empty() {
        return;
    }

    let target_path = backup_path.join(STEAM_ACHIEVEMENTS_BACKUP_FOLDER);
    if std::fs::create_dir_all(&target_path).is_err() {
        return;
    }

    for file_name in file_names {
        let source = stats_path.join(&file_name);
        let destination = target_path.join(&file_name);
        let _ = std::fs::copy(source, destination);
    }
}

pub fn restore_steam_achievement_files(steam_path: &str, app_id: &str, backup_path: &Path) {
    if steam_path.is_empty() || app_id.is_empty() {
        return;
    }

    let source_path = [
        STEAM_ACHIEVEMENTS_BACKUP_FOLDER,
        LEGACY_EDEN_STEAM_ACHIEVEMENTS_BACKUP_FOLDER,
        LEGACY_STEAM_ACHIEVEMENTS_BACKUP_FOLDER,
    ]
    .into_iter()
    .map(|folder| backup_path.join(folder))
    .find(|path| path.is_dir())
    .unwrap_or_else(|| backup_path.join(STEAM_ACHIEVEMENTS_BACKUP_FOLDER));
    if !source_path.is_dir() {
        return;
    }

    let file_names = steam_achievement_stats_file_names(&source_path, app_id);
    if file_names.is_empty() {
        return;
    }

    let stats_path = stats_directory(steam_path);
    if std::fs::create_dir_all(&stats_path).is_err() {
        return;
    }

    for file_name in file_names {
        let source = source_path.join(&file_name);
        let destination = stats_path.join(&file_name);
        let _ = std::fs::copy(source, destination);
    }
}
