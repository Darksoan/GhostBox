use crate::ghostbox_library;
use crate::ludusavi::resolved_game_title;
use crate::util::text_value;
use crate::{extract_app_id, resolve_steam_path, save_steam_path, steam_asset_url};
use tauri::Manager;

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
    // A chave inclui a fonte: com varias fontes concorrendo, a vencedora muda de
    // uma instalacao para outra por frescor, e comparar hash entre fontes
    // diferentes dispararia alerta em cima de um pacote legitimo.
    let key = format!("{app_id}@{api_name}");
    let previous = map
        .get(&key)
        .and_then(|value| value.get("sha256"))
        .and_then(|value| value.as_str())
        .map(str::to_owned);
    map[&key] = serde_json::json!({
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

/// Nomes `<depot>_<manifest>.manifest` declarados pelo `.lua`.
///
/// Le tambem as linhas comentadas: `install_lua_tools_package` comenta todo
/// `setManifestid` antes de gravar, entao ignora-las deixaria a remocao sem
/// saber quais arquivos apagar.
fn parse_lua_manifest_file_names(lua_content: &str) -> Vec<String> {
    crate::manifest_sources::parse_set_manifest_ids(lua_content)
        .into_iter()
        .map(|(depot_id, manifest_id)| format!("{depot_id}_{manifest_id}.manifest"))
        .collect()
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
    // Depois do merge com o input: a provenência é do GhostBox, não do
    // catálogo que originou o pedido.
    library_game["librarySource"] = serde_json::json!("ghostbox");

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

    // O PICS decide qual pacote vence: sem ele todas as fontes parecem
    // igualmente boas e a escolha volta a ser "a primeira que responder".
    let public = crate::steam_pics::resolve_public_app(&steam_path, &app_id).await;
    let candidate = match crate::manifest_sources::best_package(&app_id, public.as_ref()).await {
        Ok(candidate) => candidate,
        Err(error) => {
            return Ok(serde_json::json!({
                "success": false,
                "error": error
            }));
        }
    };
    let api_name = candidate.source.clone();
    let manifest_score = candidate.score;
    let zip_bytes = candidate.zip;
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
                // Quantos depots do pacote batem com o branch `public`. Zero com
                // PICS disponivel significa pacote de build antiga — a UI usa
                // isso para avisar antes de o download comecar.
                "publicMatches": manifest_score,
                "publicBuildId": public
                    .as_ref()
                    .map(|app| app.build_id.clone())
                    .unwrap_or_default(),
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
    use super::parse_lua_manifest_file_names;

    #[test]
    fn manifest_file_names_survive_the_comment_added_at_install_time() {
        // `install_lua_tools_package` prefixa `--` em todo `setManifestid` para a
        // Steam resolver o manifest publico sozinha. A remocao do jogo ainda
        // precisa achar os arquivos, entao a linha comentada tem que ser lida.
        let installed = concat!(
            "addappid(367520)\n",
            "addappid(367521,1,\"deadbeef\")\n",
            "--setManifestid(367521,\"257781644874438846\",5231995691)\n",
        );
        assert_eq!(
            parse_lua_manifest_file_names(installed),
            vec!["367521_257781644874438846.manifest".to_string()]
        );
    }

    #[test]
    fn a_lua_without_manifest_lines_yields_no_files() {
        assert!(parse_lua_manifest_file_names("addappid(367520)\n").is_empty());
    }
}
