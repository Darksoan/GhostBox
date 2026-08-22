//! Reads per-app playtime that the Steam client itself tracks locally in
//! `userdata/<accountId>/config/localconfig.vdf`. This is the only source of
//! playtime for games that are not real licenses on the account (e.g. titles
//! injected via OpenSteamTools/stplug-in), since those never appear in the
//! Web API's `GetOwnedGames` response.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct LocalAppPlaytime {
    pub minutes: u64,
    pub last_played: u64,
}

pub(crate) fn account_id_from_steam_id64(steam_id64: &str) -> Option<String> {
    let id: u64 = steam_id64.trim().parse().ok()?;
    Some((id & 0xFFFF_FFFF).to_string())
}

/// Read `Playtime` / `LastPlayed` for every app tracked by the local Steam
/// client. Prefers the given account id (from the signed-in profile); when
/// unknown, falls back to whichever `userdata/*` profile was touched most
/// recently.
pub(crate) fn read_steam_local_playtimes(
    steam_path: &str,
    account_id: Option<&str>,
) -> HashMap<String, LocalAppPlaytime> {
    let userdata = Path::new(steam_path).join("userdata");

    if let Some(account_id) = account_id {
        let path = userdata
            .join(account_id)
            .join("config")
            .join("localconfig.vdf");
        return parse_localconfig_playtimes(&path).unwrap_or_default();
    }

    let Ok(entries) = std::fs::read_dir(&userdata) else {
        return HashMap::new();
    };

    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in entries.flatten() {
        let path = entry.path().join("config").join("localconfig.vdf");
        let Ok(metadata) = std::fs::metadata(&path) else {
            continue;
        };
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        let is_better = match &best {
            Some((time, _)) => modified > *time,
            None => true,
        };
        if is_better {
            best = Some((modified, path));
        }
    }

    best.and_then(|(_, path)| parse_localconfig_playtimes(&path))
        .unwrap_or_default()
}

fn parse_localconfig_playtimes(path: &Path) -> Option<HashMap<String, LocalAppPlaytime>> {
    let contents = std::fs::read_to_string(path).ok()?;
    let parsed = parse_vdf_lenient(&contents)?;
    if !parsed.key.eq_ignore_ascii_case("UserLocalConfigStore") {
        return None;
    }
    let root = parsed.value.get_obj()?;
    let apps = ["Software", "Valve", "Steam", "apps"]
        .iter()
        .try_fold(root, |acc, key| get_vdf_child_obj(acc, key))?;

    let mut result = HashMap::new();
    for (app_id, values) in apps.0.iter() {
        let app_id = app_id.as_ref();
        if app_id.is_empty() || !app_id.chars().all(|ch| ch.is_ascii_digit()) {
            continue;
        }
        let Some(entry) = values.last().and_then(keyvalues_parser::Value::get_obj) else {
            continue;
        };
        let minutes = get_vdf_child_str(entry, "Playtime")
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0);
        let last_played = get_vdf_child_str(entry, "LastPlayed")
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0);
        if minutes == 0 && last_played == 0 {
            continue;
        }
        result.insert(
            app_id.to_string(),
            LocalAppPlaytime {
                minutes,
                last_played,
            },
        );
    }
    Some(result)
}

/// Steam escapes backslashes when it writes `localconfig.vdf`, so the default
/// (escaped) mode is the correct one. Unlike the hand-rolled parser this
/// replaced, though, this one is all-or-nothing: a single odd value — say a
/// path left with a literal trailing `\` before its closing quote — desyncs the
/// escaped parser for the whole document and would zero out every local
/// playtime. Retrying in literal mode keeps that from being silent data loss.
fn parse_vdf_lenient(contents: &str) -> Option<keyvalues_parser::PartialVdf<'_>> {
    keyvalues_parser::parse(contents).ok().or_else(|| {
        keyvalues_parser::Parser::new()
            .literal_special_chars(true)
            .parse(contents)
            .ok()
    })
}

/// VDF allows a key to repeat within a block. The parser keeps every
/// occurrence, so pick the last one — that is what the previous
/// insert-into-a-map parser effectively did.
fn get_vdf_child_obj<'a>(
    obj: &'a keyvalues_parser::Obj<'a>,
    key: &str,
) -> Option<&'a keyvalues_parser::Obj<'a>> {
    obj.0.iter().find_map(|(k, values)| {
        if k.eq_ignore_ascii_case(key) {
            values.last().and_then(keyvalues_parser::Value::get_obj)
        } else {
            None
        }
    })
}

fn get_vdf_child_str<'a>(obj: &'a keyvalues_parser::Obj<'_>, key: &str) -> Option<&'a str> {
    obj.0.iter().find_map(|(k, values)| {
        if k.eq_ignore_ascii_case(key) {
            values.last().and_then(keyvalues_parser::Value::get_str)
        } else {
            None
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_fixture(dir_name: &str, account_id: &str, contents: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir()
            .join("ghostbox-steam-localconfig-tests")
            .join(dir_name);
        let config_dir = root.join("userdata").join(account_id).join("config");
        std::fs::create_dir_all(&config_dir).unwrap();
        std::fs::write(config_dir.join("localconfig.vdf"), contents).unwrap();
        root
    }

    const FIXTURE: &str = r#"
"UserLocalConfigStore"
{
    "Software"
    {
        "Valve"
        {
            "Steam"
            {
                "apps"
                {
                    "999999"
                    {
                        "Playtime"      "137"
                        "LastPlayed"    "1700000000"
                        "cloud"
                        {
                            "last_sync_state"   "0"
                        }
                    }
                    "440"
                    {
                        "Playtime"      "0"
                        "LastPlayed"    "0"
                    }
                }
            }
        }
    }
}
"#;

    #[test]
    fn account_id_extracts_low_32_bits_of_steamid64() {
        // 76561198000000000 (a real-shaped SteamID64) & 0xFFFFFFFF
        assert_eq!(
            account_id_from_steam_id64("76561198000000000"),
            Some("39734272".to_string())
        );
        assert_eq!(account_id_from_steam_id64("not-a-number"), None);
    }

    #[test]
    fn parses_playtime_and_last_played_for_known_account() {
        let root = write_fixture("known-account", "123456", FIXTURE);
        let steam_path = root.to_string_lossy().to_string();

        let result = read_steam_local_playtimes(&steam_path, Some("123456"));

        let entry = result.get("999999").expect("appid 999999 present");
        assert_eq!(entry.minutes, 137);
        assert_eq!(entry.last_played, 1_700_000_000);

        // Both Playtime and LastPlayed are "0" — never launched locally, so
        // it must not show up as a false-positive local total.
        assert!(!result.contains_key("440"));

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn falls_back_to_most_recently_modified_userdata_profile() {
        let root = write_fixture("fallback-account", "654321", FIXTURE);
        let steam_path = root.to_string_lossy().to_string();

        // No account id known (e.g. never signed in through GhostBox) — must
        // still recover playtime by scanning userdata/*.
        let result = read_steam_local_playtimes(&steam_path, None);
        assert_eq!(result.get("999999").unwrap().minutes, 137);

        std::fs::remove_dir_all(&root).ok();
    }

    /// A value ending in a literal `\` makes the escaped parser read `\"` as an
    /// escaped quote and lose the rest of the document. Playtime must survive it.
    #[test]
    fn a_literal_trailing_backslash_does_not_wipe_every_playtime() {
        const TRAILING_BACKSLASH: &str = r#"
"UserLocalConfigStore"
{
    "LastInstallDir"    "D:\Games\"
    "Software"
    {
        "Valve"
        {
            "Steam"
            {
                "apps"
                {
                    "999999"
                    {
                        "Playtime"      "137"
                        "LastPlayed"    "1700000000"
                    }
                }
            }
        }
    }
}
"#;
        let root = write_fixture("literal-backslash", "123456", TRAILING_BACKSLASH);
        let steam_path = root.to_string_lossy().to_string();

        let result = read_steam_local_playtimes(&steam_path, Some("123456"));
        assert_eq!(result.get("999999").expect("appid 999999").minutes, 137);

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn missing_localconfig_yields_empty_map_not_a_panic() {
        let result =
            read_steam_local_playtimes("Z:\\definitely\\not\\a\\real\\steam\\path", Some("1"));
        assert!(result.is_empty());
    }
}
