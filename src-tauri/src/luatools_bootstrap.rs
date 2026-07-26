use crate::util::silent_command;
use crate::{resolve_steam_path, save_steam_path};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const EVENT_NAME: &str = "luatools-dependencies-finished";
const USER_AGENT: &str = "GhostBox LuaTools Bootstrap";
const MAX_LUATOOLS_PACKAGE_BYTES: usize = 64 * 1024 * 1024;
const MAX_OPENSTEAMTOOL_PACKAGE_BYTES: usize = 16 * 1024 * 1024;
const LUATOOLS_REPO: &str = "madoiscool/LuaTools";
const OPENSTEAMTOOL_REPO: &str = "OpenSteam001/OpenSteamTool";
const OPENSTEAMTOOL_FILES: &[&str] = &["OpenSteamTool.dll", "dwmapi.dll", "xinput1_4.dll"];
const OPENSTEAMTOOL_CONFIG: &str = "opensteamtool.toml";

static BOOTSTRAP_RUNNING: OnceLock<Mutex<bool>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct InstalledFileRecord {
    path: String,
    sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BootstrapState {
    lua_tools_version: Option<String>,
    open_steam_tool_version: Option<String>,
    installed_files: HashMap<String, InstalledFileRecord>,
    last_status: Option<String>,
    last_error: Option<String>,
    updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
    digest: Option<String>,
}

#[derive(Debug, Clone)]
struct AssetDownload {
    asset: GithubAsset,
    bytes: Vec<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DependencyStatus {
    steam_found: bool,
    steam_path: String,
    lua_tools_installed: bool,
    lua_tools_path: String,
    st_plugin_folder_found: bool,
    better_steam_tools_installed: bool,
    open_steam_tool_files: Vec<String>,
    open_steam_tool_configured: bool,
    ready: bool,
    checked_paths: Vec<String>,
    last_status: Option<String>,
    last_error: Option<String>,
}

fn running_guard() -> &'static Mutex<bool> {
    BOOTSTRAP_RUNNING.get_or_init(|| Mutex::new(false))
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn bootstrap_state_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join("luatools-dependencies.json"))
}

fn read_state(app: &AppHandle) -> BootstrapState {
    let Some(path) = bootstrap_state_path(app) else {
        return BootstrapState::default();
    };
    let Ok(contents) = std::fs::read_to_string(path) else {
        return BootstrapState::default();
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

fn write_state(app: &AppHandle, state: &BootstrapState) -> Result<(), String> {
    let path = bootstrap_state_path(app)
        .ok_or_else(|| "Não foi possível localizar o AppData do GhostBox.".to_string())?;
    let contents = serde_json::to_string_pretty(state).map_err(|error| error.to_string())?;
    std::fs::write(path, contents).map_err(|error| error.to_string())
}

fn local_app_data_dir(app: &AppHandle) -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| app.path().app_local_data_dir().ok())
}

fn lua_tools_current_dir(app: &AppHandle) -> Option<PathBuf> {
    Some(local_app_data_dir(app)?.join("LuaTools").join("current"))
}

fn lua_tools_exe_path(app: &AppHandle) -> Option<PathBuf> {
    Some(lua_tools_current_dir(app)?.join("LuaTools.exe"))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn file_sha256(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    Some(sha256_hex(&bytes))
}

fn expected_digest(asset: &GithubAsset) -> Option<String> {
    asset
        .digest
        .as_deref()
        .and_then(|digest| digest.strip_prefix("sha256:"))
        .map(str::to_ascii_lowercase)
}

fn validate_github_asset(asset: &GithubAsset, repo: &str, max_bytes: usize) -> Result<(), String> {
    if asset.size == 0 || asset.size as usize > max_bytes {
        return Err(format!("Asset {} tem tamanho inválido.", asset.name));
    }
    let expected_prefix = format!("https://github.com/{repo}/releases/download/");
    if !asset.browser_download_url.starts_with(&expected_prefix) {
        return Err(format!("Asset {} veio de uma URL inesperada.", asset.name));
    }
    if expected_digest(asset).is_none() {
        return Err(format!("Asset {} não informa SHA-256.", asset.name));
    }
    Ok(())
}

async fn fetch_latest_release(repo: &str) -> Result<GithubRelease, String> {
    let url = format!("https://api.github.com/repos/{repo}/releases/latest");
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?
        .get(url)
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<GithubRelease>()
        .await
        .map_err(|error| error.to_string())
}

async fn download_asset(asset: GithubAsset, repo: &str, max_bytes: usize) -> Result<AssetDownload, String> {
    validate_github_asset(&asset, repo, max_bytes)?;
    let bytes = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|error| error.to_string())?
        .get(&asset.browser_download_url)
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .bytes()
        .await
        .map_err(|error| error.to_string())?;

    if bytes.len() > max_bytes {
        return Err(format!("Asset {} excede o tamanho permitido.", asset.name));
    }

    let bytes = bytes.to_vec();
    let sha256 = sha256_hex(&bytes);
    if Some(sha256.as_str()) != expected_digest(&asset).as_deref() {
        return Err(format!("Falha ao validar SHA-256 de {}.", asset.name));
    }

    Ok(AssetDownload { asset, bytes })
}

fn select_luatools_asset(release: &GithubRelease) -> Option<GithubAsset> {
    release
        .assets
        .iter()
        .find(|asset| {
            asset.name.starts_with("LuaTools-")
                && asset.name.ends_with("-full.nupkg")
        })
        .cloned()
        .or_else(|| {
            release
                .assets
                .iter()
                .find(|asset| asset.name.eq_ignore_ascii_case("LuaTools-win-Portable.zip"))
                .cloned()
        })
}

fn select_opensteamtool_asset(release: &GithubRelease) -> Option<GithubAsset> {
    release
        .assets
        .iter()
        .find(|asset| {
            asset.name.starts_with("OpenSteamTool-")
                && asset.name.ends_with("-Release.zip")
                && !asset.name.contains("Debug")
        })
        .cloned()
}

fn zip_file_name(name: &str) -> Option<String> {
    name.replace('\\', "/")
        .rsplit('/')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "." && *value != "..")
        .map(ToOwned::to_owned)
}

fn install_luatools_package(app: &AppHandle, download: &AssetDownload) -> Result<(), String> {
    let target_dir = lua_tools_current_dir(app)
        .ok_or_else(|| "Não foi possível localizar LOCALAPPDATA para instalar LuaTools.".to_string())?;
    let temp_dir = target_dir.with_extension("ghostbox-tmp");
    if temp_dir.exists() {
        std::fs::remove_dir_all(&temp_dir).map_err(|error| error.to_string())?;
    }
    std::fs::create_dir_all(&temp_dir).map_err(|error| error.to_string())?;

    let mut archive = zip::ZipArchive::new(Cursor::new(download.bytes.clone()))
        .map_err(|error| error.to_string())?;
    let mut installed_files = 0usize;

    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|error| error.to_string())?;
        if !file.is_file() {
            continue;
        }
        let Some(enclosed) = file.enclosed_name().map(|path| path.to_path_buf()) else {
            continue;
        };
        let parts = enclosed.components().map(|part| part.as_os_str().to_owned()).collect::<Vec<_>>();
        let relative = if parts.len() >= 3
            && parts[0].to_string_lossy().eq_ignore_ascii_case("lib")
            && parts[1].to_string_lossy().eq_ignore_ascii_case("app")
        {
            parts[2..].iter().collect::<PathBuf>()
        } else if download.asset.name.eq_ignore_ascii_case("LuaTools-win-Portable.zip") {
            enclosed
        } else {
            continue;
        };

        let target = temp_dir.join(relative);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut output = std::fs::File::create(target).map_err(|error| error.to_string())?;
        std::io::copy(&mut file, &mut output).map_err(|error| error.to_string())?;
        installed_files += 1;
    }

    if !temp_dir.join("LuaTools.exe").is_file() || installed_files == 0 {
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Err("O pacote LuaTools não continha LuaTools.exe.".to_string());
    }

    let backup_dir = target_dir.with_extension("ghostbox-backup");
    if backup_dir.exists() {
        let _ = std::fs::remove_dir_all(&backup_dir);
    }
    if target_dir.exists() {
        std::fs::rename(&target_dir, &backup_dir).map_err(|error| error.to_string())?;
    }
    match std::fs::rename(&temp_dir, &target_dir) {
        Ok(_) => {
            let _ = std::fs::remove_dir_all(&backup_dir);
            Ok(())
        }
        Err(error) => {
            if backup_dir.exists() {
                let _ = std::fs::rename(&backup_dir, &target_dir);
            }
            Err(error.to_string())
        }
    }
}

fn extract_opensteamtool_files(bytes: &[u8]) -> Result<HashMap<String, Vec<u8>>, String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes.to_vec()))
        .map_err(|error| error.to_string())?;
    let mut files = HashMap::new();

    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|error| error.to_string())?;
        if !file.is_file() {
            continue;
        }
        let Some(file_name) = zip_file_name(file.name()) else {
            continue;
        };
        if !OPENSTEAMTOOL_FILES
            .iter()
            .any(|allowed| file_name.eq_ignore_ascii_case(allowed))
        {
            continue;
        }
        let mut content = Vec::new();
        file.read_to_end(&mut content).map_err(|error| error.to_string())?;
        files.insert(file_name, content);
    }

    for required in OPENSTEAMTOOL_FILES {
        if !files.keys().any(|name| name.eq_ignore_ascii_case(required)) {
            return Err(format!("O pacote BetterSteamTools não continha {required}."));
        }
    }

    Ok(files)
}

fn backup_existing_file(app: &AppHandle, path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let backup_root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("luatools-dependencies-backups")
        .join(chrono::Utc::now().format("%Y%m%d%H%M%S").to_string());
    std::fs::create_dir_all(&backup_root).map_err(|error| error.to_string())?;
    let file_name = path
        .file_name()
        .ok_or_else(|| "Caminho inválido para backup.".to_string())?;
    std::fs::copy(path, backup_root.join(file_name)).map_err(|error| error.to_string())?;
    Ok(())
}

fn validate_opensteamtool_targets(
    steam_root: &Path,
    files: &HashMap<String, Vec<u8>>,
    state: &BootstrapState,
) -> Result<(), String> {
    let conflicts = OPENSTEAMTOOL_FILES
        .iter()
        .filter_map(|required| {
            let (_, bytes) = files
                .iter()
                .find(|(name, _)| name.eq_ignore_ascii_case(required))?;
            let target = steam_root.join(required);
            let current_hash = file_sha256(&target)?;
            let next_hash = sha256_hex(bytes);
            let known_previous = state
                .installed_files
                .get(*required)
                .is_some_and(|record| record.sha256 == current_hash);

            (current_hash != next_hash && !known_previous).then(|| (*required).to_string())
        })
        .collect::<Vec<_>>();

    if conflicts.is_empty() {
        return Ok(());
    }

    Err(format!(
        "Conflito com outro loader na pasta da Steam: {}. Faça backup e remova ou restaure esses arquivos antes de tentar novamente.",
        conflicts.join(", ")
    ))
}

fn install_opensteamtool(
    app: &AppHandle,
    steam_path: &str,
    download: &AssetDownload,
    state: &mut BootstrapState,
) -> Result<(), String> {
    let steam_root = PathBuf::from(steam_path);
    std::fs::create_dir_all(steam_root.join("config").join("stplug-in"))
        .map_err(|error| error.to_string())?;

    let files = extract_opensteamtool_files(&download.bytes)?;
    validate_opensteamtool_targets(&steam_root, &files, state)?;

    for required in OPENSTEAMTOOL_FILES {
        let (file_name, bytes) = files
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case(required))
            .ok_or_else(|| format!("Arquivo {required} ausente no pacote."))?;
        let target = steam_root.join(required);
        let next_hash = sha256_hex(bytes);

        if target.exists() {
            let current_hash = file_sha256(&target).unwrap_or_default();
            if current_hash == next_hash {
                state.installed_files.insert(
                    required.to_string(),
                    InstalledFileRecord {
                        path: target.to_string_lossy().to_string(),
                        sha256: current_hash,
                    },
                );
                continue;
            }

            backup_existing_file(app, &target)?;
            std::fs::remove_file(&target).map_err(|error| error.to_string())?;
        }

        let temp_target = target.with_extension("ghostbox-tmp");
        std::fs::write(&temp_target, bytes).map_err(|error| error.to_string())?;
        std::fs::rename(&temp_target, &target).map_err(|error| error.to_string())?;
        state.installed_files.insert(
            required.to_string(),
            InstalledFileRecord {
                path: target.to_string_lossy().to_string(),
                sha256: next_hash,
            },
        );
        let _ = file_name;
    }

    let config_path = steam_root.join(OPENSTEAMTOOL_CONFIG);
    let config = std::fs::read_to_string(&config_path).unwrap_or_default();
    let next_config = ensure_opensteamtool_lua_path(&config)?;
    if next_config != config {
        if config_path.exists() {
            backup_existing_file(app, &config_path)?;
        }
        std::fs::write(&config_path, next_config).map_err(|error| error.to_string())?;
    }

    state.installed_files.insert(
        OPENSTEAMTOOL_CONFIG.to_string(),
        InstalledFileRecord {
            path: config_path.to_string_lossy().to_string(),
            sha256: file_sha256(&config_path).unwrap_or_default(),
        },
    );
    Ok(())
}

fn normalize_config_path(value: &str) -> String {
    value.replace('\\', "/").to_ascii_lowercase()
}

fn lua_section_bounds(lines: &[&str]) -> Option<(usize, usize)> {
    let start = lines.iter().position(|line| line.trim().eq_ignore_ascii_case("[lua]"))?;
    let end = lines
        .iter()
        .enumerate()
        .skip(start + 1)
        .find_map(|(index, line)| {
            let trimmed = line.trim();
            (trimmed.starts_with('[') && trimmed.ends_with(']')).then_some(index)
        })
        .unwrap_or(lines.len());
    Some((start, end))
}

fn opensteamtool_config_has_lua_path(config: &str) -> bool {
    let lines = config.lines().collect::<Vec<_>>();
    let Some((start, end)) = lua_section_bounds(&lines) else {
        return false;
    };
    lines[start + 1..end].iter().any(|line| {
        let trimmed = line.trim();
        trimmed.starts_with("paths") && normalize_config_path(trimmed).contains("config/stplug-in")
    })
}

fn ensure_opensteamtool_lua_path(config: &str) -> Result<String, String> {
    if opensteamtool_config_has_lua_path(config) {
        return Ok(config.to_string());
    }

    if config.trim().is_empty() {
        return Ok("[lua]\npaths = [\"config/stplug-in\"]\n".to_string());
    }

    let mut lines = config.lines().map(ToOwned::to_owned).collect::<Vec<_>>();
    if let Some((start, end)) = lua_section_bounds(&lines.iter().map(String::as_str).collect::<Vec<_>>()) {
        if let Some(relative_index) = lines[start + 1..end]
            .iter()
            .position(|line| line.trim_start().starts_with("paths"))
        {
            let index = start + 1 + relative_index;
            let line = &lines[index];
            let close = line
                .rfind(']')
                .ok_or_else(|| "opensteamtool.toml tem lua.paths em formato não suportado.".to_string())?;
            let (left, right) = line.split_at(close);
            let separator = if left.trim_end().ends_with('[') { "" } else { ", " };
            lines[index] = format!("{left}{separator}\"config/stplug-in\"{right}");
        } else {
            lines.insert(start + 1, "paths = [\"config/stplug-in\"]".to_string());
        }
    } else {
        if !lines.last().is_some_and(|line| line.trim().is_empty()) {
            lines.push(String::new());
        }
        lines.push("[lua]".to_string());
        lines.push("paths = [\"config/stplug-in\"]".to_string());
    }

    let mut next = lines.join("\n");
    next.push('\n');
    Ok(next)
}

fn opensteamtool_status(steam_path: &str, state: &BootstrapState) -> (bool, Vec<String>, bool) {
    let steam_root = PathBuf::from(steam_path);
    let files = OPENSTEAMTOOL_FILES
        .iter()
        .filter_map(|file_name| {
            let path = steam_root.join(file_name);
            path.is_file().then(|| path.to_string_lossy().to_string())
        })
        .collect::<Vec<_>>();
    let files_verified = OPENSTEAMTOOL_FILES.iter().all(|file_name| {
        let path = steam_root.join(file_name);
        let Some(current_hash) = file_sha256(&path) else {
            return false;
        };
        state
            .installed_files
            .get(*file_name)
            .is_some_and(|record| record.sha256 == current_hash)
    });
    let config_path = steam_root.join(OPENSTEAMTOOL_CONFIG);
    let configured = std::fs::read_to_string(config_path)
        .map(|contents| opensteamtool_config_has_lua_path(&contents))
        .unwrap_or(false);
    (files_verified && configured, files, configured)
}

fn dependency_status(app: &AppHandle) -> DependencyStatus {
    let state = read_state(app);
    let (steam_path, checked_paths) = resolve_steam_path(app, None);
    let steam_path_text = steam_path.clone().unwrap_or_default();
    let lua_tools_path = lua_tools_exe_path(app)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let lua_tools_installed = !lua_tools_path.is_empty() && Path::new(&lua_tools_path).is_file();
    let st_plugin_folder_found = steam_path
        .as_ref()
        .map(|path| Path::new(path).join("config").join("stplug-in").is_dir())
        .unwrap_or(false);
    let (better_steam_tools_installed, open_steam_tool_files, open_steam_tool_configured) = steam_path
        .as_ref()
        .map(|path| opensteamtool_status(path, &state))
        .unwrap_or_else(|| (false, Vec::new(), false));
    let ready = steam_path.is_some()
        && lua_tools_installed
        && st_plugin_folder_found
        && better_steam_tools_installed;

    DependencyStatus {
        steam_found: steam_path.is_some(),
        steam_path: steam_path_text,
        lua_tools_installed,
        lua_tools_path,
        st_plugin_folder_found,
        better_steam_tools_installed,
        open_steam_tool_files,
        open_steam_tool_configured,
        ready,
        checked_paths,
        last_status: state.last_status,
        last_error: state.last_error,
    }
}

#[cfg(windows)]
fn steam_is_running() -> bool {
    let output = silent_command("tasklist")
        .args(["/FI", "IMAGENAME eq steam.exe", "/NH"])
        .output();
    match output {
        Ok(output) if output.status.success() => {
            String::from_utf8_lossy(&output.stdout)
                .to_ascii_lowercase()
                .contains("steam.exe")
        }
        _ => false,
    }
}

#[cfg(not(windows))]
fn steam_is_running() -> bool {
    false
}

fn finish_payload(success: bool, status: &str, message: &str, error: Option<String>) -> Value {
    json!({
        "success": success,
        "status": status,
        "title": if success { "Dependências preparadas" } else { "Não foi possível preparar o LuaTools" },
        "message": message,
        "error": error,
    })
}

async fn run_bootstrap(app: AppHandle) -> Value {
    #[cfg(not(windows))]
    {
        let message = "A instalação automática do LuaTools está disponível apenas no Windows.";
        return finish_payload(false, "unsupported", message, Some(message.to_string()));
    }

    let mut state = read_state(&app);
    let (steam_path, checked_paths) = resolve_steam_path(&app, None);
    let Some(steam_path) = steam_path else {
        let error = format!(
            "Steam não foi encontrada. Caminhos verificados: {}",
            checked_paths.join(", ")
        );
        state.last_status = Some("failed".to_string());
        state.last_error = Some(error.clone());
        state.updated_at = Some(now_rfc3339());
        let _ = write_state(&app, &state);
        return finish_payload(false, "failed", "A instalação será tentada novamente na próxima inicialização.", Some(error));
    };

    let _ = save_steam_path(&app, &steam_path);
    let before = dependency_status(&app);
    if before.ready {
        return finish_payload(true, "ready", "LuaTools e BetterSteamTools já estão prontos.", None);
    }

    let result = async {
        if !before.lua_tools_installed {
            let release = fetch_latest_release(LUATOOLS_REPO).await?;
            let asset = select_luatools_asset(&release)
                .ok_or_else(|| "Release do LuaTools não contém pacote instalável.".to_string())?;
            let download = download_asset(asset, LUATOOLS_REPO, MAX_LUATOOLS_PACKAGE_BYTES).await?;
            install_luatools_package(&app, &download)?;
            state.lua_tools_version = Some(release.tag_name);
        }

        let after_luatools = dependency_status(&app);
        if !after_luatools.better_steam_tools_installed {
            let release = fetch_latest_release(OPENSTEAMTOOL_REPO).await?;
            let asset = select_opensteamtool_asset(&release)
                .ok_or_else(|| "Release do BetterSteamTools não contém pacote Release.".to_string())?;
            let download = download_asset(asset, OPENSTEAMTOOL_REPO, MAX_OPENSTEAMTOOL_PACKAGE_BYTES).await?;
            install_opensteamtool(&app, &steam_path, &download, &mut state)?;
            state.open_steam_tool_version = Some(release.tag_name);
        }

        // Persist file hashes before final verification; dependency_status only
        // trusts BetterSteamTools files recorded in this state file.
        let _ = write_state(&app, &state);
        let status = dependency_status(&app);
        if !status.ready {
            return Err("A verificação final das dependências não passou.".to_string());
        }
        Ok::<_, String>(())
    }
    .await;

    match result {
        Ok(()) => {
            state.last_status = Some("ready".to_string());
            state.last_error = None;
            state.updated_at = Some(now_rfc3339());
            let _ = write_state(&app, &state);
            let restart_note = if steam_is_running() {
                " Reinicie a Steam para carregar o loader."
            } else {
                " Abra a Steam para carregar o loader."
            };
            finish_payload(
                true,
                "ready",
                &format!("LuaTools e BetterSteamTools foram instalados com sucesso.{restart_note}"),
                None,
            )
        }
        Err(error) => {
            state.last_status = Some("failed".to_string());
            state.last_error = Some(error.clone());
            state.updated_at = Some(now_rfc3339());
            let _ = write_state(&app, &state);
            finish_payload(
                false,
                "failed",
                "A instalação será tentada novamente na próxima inicialização.",
                Some(error),
            )
        }
    }
}

#[tauri::command]
pub fn luatools_dependencies_status(app: AppHandle) -> Value {
    serde_json::to_value(dependency_status(&app)).unwrap_or_else(|_| json!({ "ready": false }))
}

#[tauri::command]
pub fn luatools_dependencies_ensure(app: AppHandle) -> Value {
    let status = dependency_status(&app);
    if status.ready {
        return json!({ "status": "ready", "started": false, "ready": true });
    }

    {
        let mut running = running_guard().lock().unwrap_or_else(|error| error.into_inner());
        if *running {
            return json!({ "status": "running", "started": false, "ready": false });
        }
        *running = true;
    }

    let app_for_task = app.clone();
    tauri::async_runtime::spawn(async move {
        let payload = run_bootstrap(app_for_task.clone()).await;
        let _ = app_for_task.emit(EVENT_NAME, payload);
        let mut running = running_guard().lock().unwrap_or_else(|error| error.into_inner());
        *running = false;
    });

    json!({ "status": "started", "started": true, "ready": false })
}

#[cfg(test)]
mod tests {
    use super::{
        ensure_opensteamtool_lua_path, opensteamtool_config_has_lua_path,
        validate_opensteamtool_targets, BootstrapState, OPENSTEAMTOOL_FILES,
    };
    use std::collections::HashMap;

    #[test]
    fn opensteamtool_preflight_reports_all_unowned_conflicts() {
        let root = std::env::temp_dir().join(format!(
            "ghostbox-opensteamtool-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let files = OPENSTEAMTOOL_FILES
            .iter()
            .map(|name| ((*name).to_string(), format!("new-{name}").into_bytes()))
            .collect::<HashMap<_, _>>();
        std::fs::write(root.join("dwmapi.dll"), b"foreign-dwmapi").unwrap();
        std::fs::write(root.join("xinput1_4.dll"), b"foreign-xinput").unwrap();

        let error = validate_opensteamtool_targets(&root, &files, &BootstrapState::default())
            .unwrap_err();
        assert!(error.contains("dwmapi.dll"));
        assert!(error.contains("xinput1_4.dll"));
        assert_eq!(std::fs::read(root.join("dwmapi.dll")).unwrap(), b"foreign-dwmapi");
        assert_eq!(std::fs::read(root.join("xinput1_4.dll")).unwrap(), b"foreign-xinput");

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn opensteamtool_config_adds_plugin_path_once() {
        let config = "[lua]\npaths = [\"config/lua\"]\n";
        let updated = ensure_opensteamtool_lua_path(config).unwrap();
        assert!(opensteamtool_config_has_lua_path(&updated));
        assert_eq!(ensure_opensteamtool_lua_path(&updated).unwrap(), updated);
    }
}
