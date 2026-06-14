use crate::catalogue::fetch_remote_game;
use crate::ghostbox_library;
use crate::ludusavi::game_title;
use crate::util::{text_value, EmptyVecExt};
use crate::{extract_app_id, resolve_steam_path, save_steam_path, steam_asset_url};

const LUA_TOOLS_USER_AGENT: &str = "discord(dot)gg/luatools";
const MAX_LUA_TOOLS_PACKAGE_BYTES: usize = 64 * 1024 * 1024;

struct LuaToolsApi {
    name: &'static str,
    url: &'static str,
    success_code: u16,
    unavailable_code: u16,
}

const DEFAULT_LUA_TOOLS_APIS: &[LuaToolsApi] = &[
    LuaToolsApi {
        name: "TwentyTwo Cloud",
        url: "https://api.twentytwocloud.com/download?appid=<appid>",
        success_code: 200,
        unavailable_code: 404,
    },
    LuaToolsApi {
        name: "Sushi",
        url: "https://raw.githubusercontent.com/sushi-dev55-alt/sushitools-games-repo-alt/refs/heads/main/<appid>.zip",
        success_code: 200,
        unavailable_code: 404,
    },
];

fn lua_tools_url(api: &LuaToolsApi, app_id: &str) -> String {
    api.url.replace("<appid>", app_id)
}

fn validate_lua_tools_url(url: &str) -> bool {
    reqwest::Url::parse(url)
        .map(|url| {
            url.scheme() == "https"
                || (url.scheme() == "http" && url.host_str() == Some("167.235.229.108"))
        })
        .unwrap_or(false)
}

async fn download_lua_tools_package(app_id: &str) -> Result<(String, Vec<u8>), String> {
    let client = reqwest::Client::new();
    let mut errors = Vec::new();

    for api in DEFAULT_LUA_TOOLS_APIS {
        let url = lua_tools_url(api, app_id);
        if !validate_lua_tools_url(&url) {
            errors.push(format!("{}: URL insegura", api.name));
            continue;
        }

        match client
            .get(&url)
            .header(reqwest::header::USER_AGENT, LUA_TOOLS_USER_AGENT)
            .send()
            .await
        {
            Ok(response) => {
                let status = response.status().as_u16();
                if status == api.unavailable_code {
                    continue;
                }
                if status != api.success_code {
                    errors.push(format!("{}: HTTP {status}", api.name));
                    continue;
                }

                let bytes = response.bytes().await.map_err(|error| error.to_string())?;
                if bytes.len() > MAX_LUA_TOOLS_PACKAGE_BYTES {
                    errors.push(format!("{}: pacote excede 64 MB", api.name));
                    continue;
                }
                if bytes.len() < 4 || &bytes[..2] != b"PK" {
                    errors.push(format!("{}: resposta não é zip", api.name));
                    continue;
                }

                return Ok((api.name.to_string(), bytes.to_vec()));
            }
            Err(error) => errors.push(format!("{}: {error}", api.name)),
        }
    }

    Err(errors
        .if_empty(vec!["Jogo indisponível nas APIs configuradas.".to_string()])
        .join("; "))
}

fn zip_entry_file_name(name: &str) -> Option<String> {
    name.replace('\\', "/")
        .rsplit('/')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "." && *value != "..")
        .map(ToOwned::to_owned)
}

fn parse_lua_manifest_file_names(lua_content: &str) -> Vec<String> {
    let mut names = Vec::new();
    for line in lua_content.lines() {
        if line.trim_start().starts_with("--") || !line.contains("setManifestid") {
            continue;
        }
        let digits = line
            .split(|ch: char| !ch.is_ascii_digit())
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>();
        if digits.len() >= 2 {
            let name = format!("{}_{}.manifest", digits[0], digits[1]);
            if !names.iter().any(|item| item == &name) {
                names.push(name);
            }
        }
    }
    names
}

fn install_lua_tools_package(
    app_id: &str,
    zip_bytes: &[u8],
    steam_path: &str,
) -> Result<(String, usize, Vec<String>), String> {
    let reader = std::io::Cursor::new(zip_bytes);
    let mut zip = zip::ZipArchive::new(reader).map_err(|error| error.to_string())?;
    let depotcache_path = std::path::PathBuf::from(steam_path).join("depotcache");
    let lua_target_path = std::path::PathBuf::from(steam_path)
        .join("config")
        .join("stplug-in");
    std::fs::create_dir_all(&depotcache_path).map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&lua_target_path).map_err(|error| error.to_string())?;

    let mut manifest_files = Vec::new();
    let mut lua_candidates: Vec<(String, String)> = Vec::new();

    for index in 0..zip.len() {
        let mut file = zip.by_index(index).map_err(|error| error.to_string())?;
        let Some(file_name) = zip_entry_file_name(file.name()) else {
            continue;
        };

        if file_name.to_lowercase().ends_with(".manifest") {
            let target = depotcache_path.join(&file_name);
            let mut output = std::fs::File::create(target).map_err(|error| error.to_string())?;
            std::io::copy(&mut file, &mut output).map_err(|error| error.to_string())?;
            if !manifest_files.iter().any(|item| item == &file_name) {
                manifest_files.push(file_name);
            }
            continue;
        }

        if file_name.to_lowercase().ends_with(".lua")
            && file_name
                .trim_end_matches(".lua")
                .chars()
                .all(|ch| ch.is_ascii_digit())
        {
            let mut lua = String::new();
            std::io::Read::read_to_string(&mut file, &mut lua)
                .map_err(|error| error.to_string())?;
            lua_candidates.push((file_name, lua));
        }
    }

    let selected_lua = lua_candidates
        .iter()
        .find(|(name, _)| name == &format!("{app_id}.lua"))
        .or_else(|| lua_candidates.first())
        .ok_or_else(|| "Nenhum arquivo Lua numérico encontrado no pacote.".to_string())?;

    let processed_lua = selected_lua
        .1
        .lines()
        .map(|line| {
            if line.trim_start().starts_with("setManifestid(") {
                format!("--{line}")
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    for name in parse_lua_manifest_file_names(&processed_lua) {
        if !manifest_files.iter().any(|item| item == &name) {
            manifest_files.push(name);
        }
    }

    let installed_path = lua_target_path.join(format!("{app_id}.lua"));
    std::fs::write(&installed_path, processed_lua).map_err(|error| error.to_string())?;

    Ok((
        installed_path.to_string_lossy().to_string(),
        manifest_files.len(),
        manifest_files,
    ))
}

fn lua_tools_manifest_file_names(steam_path: &str, app_id: &str, stored: &[String]) -> Vec<String> {
    let mut names = stored.to_vec();
    let lua_target_path = std::path::PathBuf::from(steam_path)
        .join("config")
        .join("stplug-in");
    for suffix in ["lua", "lua.disabled"] {
        let path = lua_target_path.join(format!("{app_id}.{suffix}"));
        if let Ok(contents) = std::fs::read_to_string(path) {
            for name in parse_lua_manifest_file_names(&contents) {
                if !names.iter().any(|item| item == &name) {
                    names.push(name);
                }
            }
        }
    }
    names
}

fn remove_lua_tools_manifest_files(steam_path: &str, manifest_files: &[String]) -> Vec<String> {
    let mut removed = Vec::new();
    let candidates = [
        std::path::PathBuf::from(steam_path).join("depotcache"),
        std::path::PathBuf::from(steam_path)
            .join("config")
            .join("depotcache"),
    ];

    for file_name in manifest_files {
        let Some(file_name) = zip_entry_file_name(file_name) else {
            continue;
        };
        if !file_name.to_lowercase().ends_with(".manifest") {
            continue;
        }
        for base in &candidates {
            let path = base.join(&file_name);
            if path.exists() && std::fs::remove_file(&path).is_ok() {
                removed.push(path.to_string_lossy().to_string());
            }
        }
    }

    removed
}

async fn library_game_from_luatools_add(
    app: &tauri::AppHandle,
    app_id: &str,
    input: &serde_json::Value,
) -> serde_json::Value {
    if let Ok(Some(remote_game)) = fetch_remote_game(app, app_id.to_string(), None).await {
        return remote_game;
    }

    let title = game_title(input, app_id);
    let cover_url = steam_asset_url(app_id, "header.jpg");
    let hero_url = steam_asset_url(app_id, "library_hero.jpg");
    serde_json::json!({
        "appId": app_id,
        "id": format!("steam-{app_id}"),
        "title": title,
        "subtitle": "Adicionado pelo GhostBox",
        "status": "discover",
        "hours": 0,
        "rating": 0,
        "size": "Adicionado",
        "release": "",
        "progress": 0,
        "accent": "#66c0f4",
        "cover": cover_url,
        "hero": hero_url,
        "coverUrl": cover_url,
        "heroUrl": hero_url,
        "coverFallbacks": [steam_asset_url(app_id, "library_600x900.jpg")],
        "heroFallbacks": [steam_asset_url(app_id, "header.jpg")],
        "logo": steam_asset_url(app_id, "logo.png"),
        "tags": [],
        "genres": [],
        "developers": [],
        "publishers": [],
        "screenshots": [hero_url],
        "achievements": { "unlocked": 0, "total": 0, "progress": 0 },
        "achievementList": []
    })
}

#[tauri::command]
pub async fn luatools_add_game(
    app: tauri::AppHandle,
    game: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let app_id = extract_app_id(&game);
    if app_id.is_empty() {
        return Ok(serde_json::json!({
            "success": false,
            "error": "AppID inválido para adicionar o jogo."
        }));
    }
    let title = game_title(&game, &app_id);
    if ghostbox_library::is_library_app_blocked(&app_id, &title) {
        return Ok(serde_json::json!({
            "success": false,
            "error": "Este item não é um jogo e foi bloqueado da Biblioteca."
        }));
    }

    let (steam_path, checked_paths) = resolve_steam_path(&app, None);
    let Some(steam_path) = steam_path else {
        return Ok(serde_json::json!({
            "success": false,
            "error": format!(
                "Steam não foi encontrado. Configure a pasta da Steam em Biblioteca. Caminhos verificados: {}",
                checked_paths.join(", ")
            )
        }));
    };

    let mut library_game = library_game_from_luatools_add(&app, &app_id, &game).await;
    let (api_name, zip_bytes) = match download_lua_tools_package(&app_id).await {
        Ok(result) => result,
        Err(error) => {
            return Ok(serde_json::json!({
                "success": false,
                "error": error
            }));
        }
    };

    match install_lua_tools_package(&app_id, &zip_bytes, &steam_path) {
        Ok((installed_path, manifest_count, manifest_files)) => {
            library_game["status"] = serde_json::json!("discover");
            if text_value(library_game.get("size")).is_empty() {
                library_game["size"] = serde_json::json!("Adicionado");
            }
            library_game["luaToolsManifests"] = serde_json::json!(manifest_files);
            let _ = save_steam_path(&app, &steam_path);
            let _ = ghostbox_library::upsert_ghostbox_library_game(&app, library_game.clone());

            Ok(serde_json::json!({
                "success": true,
                "api": api_name,
                "installedPath": installed_path,
                "manifestCount": manifest_count,
                "libraryGame": library_game
            }))
        }
        Err(error) => Ok(serde_json::json!({
            "success": false,
            "error": error
        })),
    }
}

#[tauri::command]
pub fn luatools_remove_game(app: tauri::AppHandle, game: serde_json::Value) -> serde_json::Value {
    let app_id = extract_app_id(&game);
    if app_id.is_empty() {
        return serde_json::json!({
            "success": false,
            "error": "AppID inválido para remover o jogo."
        });
    }

    let mut removed_files = Vec::new();
    let (steam_path, _) = resolve_steam_path(&app, None);
    if let Some(steam_path) = steam_path {
        let stored_manifests = game
            .get("luaToolsManifests")
            .and_then(|value| value.as_array())
            .map(|values| {
                values
                    .iter()
                    .filter_map(|value| value.as_str().map(ToOwned::to_owned))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let manifest_files = lua_tools_manifest_file_names(&steam_path, &app_id, &stored_manifests);
        removed_files.extend(remove_lua_tools_manifest_files(
            &steam_path,
            &manifest_files,
        ));

        let lua_target_path = std::path::PathBuf::from(&steam_path)
            .join("config")
            .join("stplug-in");
        for suffix in ["lua", "lua.disabled"] {
            let path = lua_target_path.join(format!("{app_id}.{suffix}"));
            if path.exists() && std::fs::remove_file(&path).is_ok() {
                removed_files.push(path.to_string_lossy().to_string());
            }
        }
    }

    let _ = ghostbox_library::remove_ghostbox_library_game(&app, &app_id);

    serde_json::json!({
        "success": true,
        "appId": app_id,
        "removedFiles": removed_files
    })
}
