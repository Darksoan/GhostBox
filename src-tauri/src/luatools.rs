use crate::ghostbox_library;
use crate::ludusavi::resolved_game_title;
use crate::util::{text_value, EmptyVecExt};
use crate::{extract_app_id, resolve_steam_path, save_steam_path, steam_asset_url};
use std::time::Duration;
use tauri::Manager;

const LUA_TOOLS_USER_AGENT: &str = "discord(dot)gg/luatools";
const MAX_LUA_TOOLS_PACKAGE_BYTES: usize = 64 * 1024 * 1024;
const LUA_TOOLS_CONNECT_TIMEOUT_SECS: u64 = 5;
const LUA_TOOLS_REQUEST_TIMEOUT_SECS: u64 = 12;

struct LuaToolsApi {
    name: &'static str,
    url: &'static str,
    success_code: u16,
    unavailable_code: u16,
}

const DEFAULT_LUA_TOOLS_APIS: &[LuaToolsApi] = &[
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
                || (cfg!(test)
                    && url.scheme() == "http"
                    && url.host_str() == Some("127.0.0.1"))
        })
        .unwrap_or(false)
}

async fn download_lua_tools_package_from_apis(
    app_id: &str,
    apis: &[LuaToolsApi],
) -> Result<(String, Vec<u8>), String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(LUA_TOOLS_CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(LUA_TOOLS_REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|error| error.to_string())?;
    let mut errors = Vec::new();

    for api in apis {
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
                    errors.push(format!("{}: jogo indisponível", api.name));
                    continue;
                }
                if status != api.success_code {
                    if matches!(status, 522 | 523 | 524) {
                        errors.push(format!("{}: serviço indisponível (HTTP {status})", api.name));
                    } else {
                        errors.push(format!("{}: HTTP {status}", api.name));
                    }
                    continue;
                }

                let bytes = match response.bytes().await {
                    Ok(bytes) => bytes,
                    Err(error) => {
                        if error.is_timeout() {
                            errors.push(format!(
                                "{}: tempo limite excedido durante o download",
                                api.name
                            ));
                        } else {
                            errors.push(format!(
                                "{}: falha ao receber o pacote ({error})",
                                api.name
                            ));
                        }
                        continue;
                    }
                };
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
            Err(error) => {
                if error.is_timeout() {
                    errors.push(format!("{}: tempo limite excedido", api.name));
                } else {
                    errors.push(format!("{}: {error}", api.name));
                }
            }
        }
    }

    Err(errors
        .if_empty(vec!["Jogo indisponível nas APIs configuradas.".to_string()])
        .join("; "))
}

async fn download_lua_tools_package(app_id: &str) -> Result<(String, Vec<u8>), String> {
    download_lua_tools_package_from_apis(app_id, DEFAULT_LUA_TOOLS_APIS).await
}

fn package_hashes_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join("luatools-package-hashes.json"))
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::Digest;
    let mut hasher = sha2::Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// Persiste o SHA-256 do pacote LuaTools por `app_id`. Se o hash mudou desde a
/// última instalação, emite um evento `luatools-package-hash-changed` para a UI
/// alertar — a fonte HTTPS é um repositório de terceiro, então uma mudança
/// inesperada pode indicar comprometimento do repo.
fn record_package_hash_and_warn(
    app: &tauri::AppHandle,
    app_id: &str,
    api_name: &str,
    package_bytes: &[u8],
) {
    use tauri::Emitter;
    let Some(path) = package_hashes_path(app) else {
        return;
    };
    let next_hash = sha256_hex(package_bytes);
    let mut map: serde_json::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|contents| serde_json::from_str(&contents).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if !map.is_object() {
        map = serde_json::json!({});
    }
    let previous = map
        .get(app_id)
        .and_then(|value| value.get("sha256"))
        .and_then(|value| value.as_str())
        .map(str::to_owned);
    map[app_id] = serde_json::json!({
        "sha256": next_hash,
        "api": api_name,
        "updatedAt": chrono::Utc::now().to_rfc3339(),
    });
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(contents) = serde_json::to_string(&map) {
        let _ = std::fs::write(&path, contents);
    }
    if let Some(previous_hash) = previous {
        if previous_hash != next_hash {
            let _ = app.emit(
                "luatools-package-hash-changed",
                serde_json::json!({
                    "appId": app_id,
                    "api": api_name,
                    "previousSha256": previous_hash,
                    "sha256": next_hash,
                }),
            );
        }
    }
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

const MAX_LUA_SCRIPT_BYTES: usize = 1024 * 1024;
const LUA_SCRIPT_TOKENS: &[&str] = &[
    "setManifestid",
    "addManifest",
    "addmanifestid",
    "function",
    "local ",
    "if ",
    "return",
    "--",
    "for ",
    "while ",
];

fn validate_lua_script(app_id: &str, content: &str) -> Result<(), String> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err(format!("Script Lua para {app_id} está vazio."));
    }
    if content.bytes().len() > MAX_LUA_SCRIPT_BYTES {
        return Err(format!(
            "Script Lua para {app_id} excede {MAX_LUA_SCRIPT_BYTES} bytes."
        ));
    }
    if content.contains('\0') {
        return Err(format!("Script Lua para {app_id} contém bytes nulos."));
    }
    let looks_like_lua = content
        .lines()
        .take(64)
        .any(|line| LUA_SCRIPT_TOKENS.iter().any(|token| line.contains(token)));
    if !looks_like_lua {
        return Err(format!(
            "Script Lua para {app_id} não parece um script SteamTool válido; gravação recusada."
        ));
    }
    Ok(())
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

    validate_lua_script(app_id, &processed_lua)?;

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

fn library_game_from_luatools_add(
    app_id: &str,
    input: &serde_json::Value,
    title: &str,
) -> serde_json::Value {
    let cover_url = steam_asset_url(app_id, "header.jpg");
    let hero_url = steam_asset_url(app_id, "library_hero.jpg");
    let mut library_game = serde_json::json!({
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
    });

    if let Some(input_object) = input.as_object() {
        for (key, value) in input_object {
            if !value.is_null() {
                library_game[key] = value.clone();
            }
        }
    }

    library_game["appId"] = serde_json::json!(app_id);
    if text_value(library_game.get("id")).is_empty() {
        library_game["id"] = serde_json::json!(format!("steam-{app_id}"));
    }
    if text_value(library_game.get("title")).is_empty() {
        library_game["title"] = serde_json::json!(title);
    }

    library_game
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
    let title = resolved_game_title(&app, &game, &app_id);
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

    let (api_name, zip_bytes) = match download_lua_tools_package(&app_id).await {
        Ok(result) => result,
        Err(error) => {
            return Ok(serde_json::json!({
                "success": false,
                "error": error
            }));
        }
    };
    record_package_hash_and_warn(&app, &app_id, &api_name, &zip_bytes);
    let mut library_game = library_game_from_luatools_add(&app_id, &game, &title);

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

#[cfg(test)]
mod tests {
    use super::{download_lua_tools_package_from_apis, LuaToolsApi};
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn falls_back_when_successful_response_body_is_truncated() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            listener.set_nonblocking(true).unwrap();
            let responses = [
                b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: close\r\n\r\nPK".as_slice(),
                b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\nPK\x03\x04"
                    .as_slice(),
            ];
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            let mut response_index = 0;
            while response_index < responses.len() && std::time::Instant::now() < deadline {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let mut request = [0_u8; 1024];
                        let _ = stream.read(&mut request);
                        stream.write_all(responses[response_index]).unwrap();
                        response_index += 1;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(std::time::Duration::from_millis(10));
                    }
                    Err(error) => panic!("test server failed: {error}"),
                }
            }
        });

        let broken_url = Box::leak(format!("http://{address}/broken").into_boxed_str());
        let fallback_url = Box::leak(format!("http://{address}/fallback").into_boxed_str());
        let apis = [
            LuaToolsApi {
                name: "Broken",
                url: broken_url,
                success_code: 200,
                unavailable_code: 404,
            },
            LuaToolsApi {
                name: "Fallback",
                url: fallback_url,
                success_code: 200,
                unavailable_code: 404,
            },
        ];

        let result = tauri::async_runtime::block_on(download_lua_tools_package_from_apis(
            "1332010",
            &apis,
        ));
        server.join().unwrap();

        let (api, bytes) = result.unwrap();
        assert_eq!(api, "Fallback");
        assert_eq!(bytes, b"PK\x03\x04");
    }
}
