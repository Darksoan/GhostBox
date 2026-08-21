use std::collections::{HashMap, HashSet};
use std::io::{BufRead, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::Emitter;

const POC_RELATIVE_PATH: &str = "../sidecars/steamkit-poc/bin/Debug/net8.0/steamkit-poc.exe";

static ACTIVE_DOWNLOAD_PROCESSES: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();
static CANCELLED_DOWNLOADS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static DOWNLOAD_WORKER: OnceLock<Mutex<Option<DownloadWorker>>> = OnceLock::new();

struct DownloadWorker {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    stdout: Arc<Mutex<std::io::BufReader<ChildStdout>>>,
}

fn download_worker() -> &'static Mutex<Option<DownloadWorker>> {
    DOWNLOAD_WORKER.get_or_init(|| Mutex::new(None))
}

pub fn shutdown_download_worker() {
    let Ok(mut worker_guard) = download_worker().lock() else {
        return;
    };
    let Some(mut worker) = worker_guard.take() else {
        return;
    };

    if let Ok(mut stdin) = worker.stdin.lock() {
        let _ = stdin.write_all(b"{\"Type\":\"shutdown\"}\n");
        let _ = stdin.flush();
    }
    let _ = worker.child.kill();
    let _ = worker.child.wait();
}

fn active_download_processes() -> &'static Mutex<HashMap<String, u32>> {
    ACTIVE_DOWNLOAD_PROCESSES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cancelled_downloads() -> &'static Mutex<HashSet<String>> {
    CANCELLED_DOWNLOADS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn take_download_cancelled(app_id: &str) -> bool {
    cancelled_downloads()
        .lock()
        .map(|mut cancelled| cancelled.remove(app_id))
        .unwrap_or(false)
}

fn clear_active_download_process(app_id: &str) {
    let _ = active_download_processes()
        .lock()
        .map(|mut processes| processes.remove(app_id));
}

fn ensure_download_worker(worker: &mut Option<DownloadWorker>) -> Result<&mut DownloadWorker, String> {
    let should_start = match worker.as_mut() {
        Some(existing) => existing.child.try_wait().map_err(|error| error.to_string())?.is_some(),
        None => true,
    };

    if should_start {
        let poc_path = find_poc_binary()?;
        let mut child = crate::util::silent_command(&poc_path)
            .arg("--worker")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("Failed to spawn steamkit worker: {error}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to capture stdin from steamkit worker".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture stdout from steamkit worker".to_string())?;

        *worker = Some(DownloadWorker {
            child,
            stdin: Arc::new(Mutex::new(stdin)),
            stdout: Arc::new(Mutex::new(std::io::BufReader::new(stdout))),
        });
    }

    worker
        .as_mut()
        .ok_or_else(|| "SteamKit worker is unavailable".to_string())
}

fn write_worker_command(
    worker_stdin: &Arc<Mutex<ChildStdin>>,
    command: &serde_json::Value,
) -> Result<(), String> {
    let command_line = serde_json::to_string(command).map_err(|error| error.to_string())?;
    let mut stdin = worker_stdin.lock().map_err(|error| error.to_string())?;
    stdin
        .write_all(command_line.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|error| format!("Failed to write command to steamkit worker: {error}"))
}

fn read_worker_event(
    worker_stdout: &Arc<Mutex<std::io::BufReader<ChildStdout>>>,
) -> Result<Option<serde_json::Value>, String> {
    loop {
        let mut line = String::new();
        let mut stdout = worker_stdout.lock().map_err(|error| error.to_string())?;
        let bytes_read = stdout
            .read_line(&mut line)
            .map_err(|error| format!("Failed to read from steamkit worker: {error}"))?;
        drop(stdout);
        if bytes_read == 0 {
            return Ok(None);
        }
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
            return Ok(Some(value));
        }
    }
}

fn find_poc_binary() -> Result<std::path::PathBuf, String> {
    if let Ok(path) = std::env::var("GHOSTBOX_POC_PATH") {
        let p = std::path::PathBuf::from(&path);
        if p.exists() {
            return Ok(p);
        }
        return Err(format!("GHOSTBOX_POC_PATH set but not found: {path}"));
    }

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));
    if let Some(ref dir) = exe_dir {
        let bundled = dir.join("steamkit-poc.exe");
        if bundled.exists() {
            return Ok(bundled);
        }
    }

    let dev_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(POC_RELATIVE_PATH);
    if dev_path.exists() {
        return Ok(dev_path);
    }

    Err(format!(
        "steamkit-poc.exe not found. Tried: exe dir {:?}, dev path {:?}. Set GHOSTBOX_POC_PATH env var.",
        exe_dir.unwrap_or_default(),
        dev_path
    ))
}

/// De onde saiu o manifest escolhido para um depot, da melhor para a pior opcao.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DepotTier {
    /// O manifest do branch `public` ja esta no `depotcache`. Build atual.
    PublicFromCache,
    /// Nenhum manifest publico em disco; venceu o de maior `buildid` entre os
    /// que estao no `depotcache`.
    NewestInCache,
    /// Nada em disco: sobrou o valor fixado pelo `.lua`. Era o unico
    /// comportamento antigo, e e o que entregava build de 2022.
    LuaPinned,
}

impl DepotTier {
    fn as_str(self) -> &'static str {
        match self {
            DepotTier::PublicFromCache => "public-from-cache",
            DepotTier::NewestInCache => "newest-in-cache",
            DepotTier::LuaPinned => "lua-pinned",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ResolvedDepot {
    pub depot_id: u32,
    pub manifest_id: u64,
    pub tier: DepotTier,
    /// gid do branch `public` segundo o PICS, quando conhecido.
    pub public_gid: Option<u64>,
}

impl ResolvedDepot {
    /// `true` quando o manifest escolhido e o publico — ou quando o PICS nao
    /// respondeu e nao ha com o que comparar.
    pub fn is_current(&self) -> bool {
        self.public_gid
            .is_none_or(|public_gid| public_gid == self.manifest_id)
    }
}

/// Manifests presentes no `depotcache` para um depot, como `(manifest_id, mtime)`.
fn cached_manifests(steam_path: &str, depot_id: u32) -> Vec<(u64, std::time::SystemTime)> {
    let prefix = format!("{depot_id}_");
    let Ok(entries) = std::fs::read_dir(Path::new(steam_path).join("depotcache")) else {
        return vec![];
    };

    entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            let manifest_id = name
                .strip_prefix(&prefix)?
                .strip_suffix(".manifest")?
                .parse::<u64>()
                .ok()?;
            let modified = entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .unwrap_or(std::time::UNIX_EPOCH);
            Some((manifest_id, modified))
        })
        .collect()
}

/// Escolhe o manifest de um depot entre o que ha em disco e o que o `.lua` fixa.
///
/// O `.lua` instalado tem os `setManifestid` comentados de proposito
/// (`crate::luatools::install_lua_tools_package`), para a Steam resolver o
/// manifest publico sozinha. Ler esse valor comentado como pin — o que o codigo
/// antigo fazia — anulava aquela decisao e prendia o download na build velha.
fn pick_depot_manifest(
    steam_path: &str,
    depot_id: u32,
    lua_pinned: Option<u64>,
    public: Option<&crate::steam_pics::PublicApp>,
) -> Option<ResolvedDepot> {
    let public_gid = public.and_then(|app| app.public_gid(depot_id));
    let cached = cached_manifests(steam_path, depot_id);

    let resolved = |manifest_id: u64, tier: DepotTier| ResolvedDepot {
        depot_id,
        manifest_id,
        tier,
        public_gid,
    };

    if let Some(public_gid) = public_gid {
        if cached.iter().any(|(manifest_id, _)| *manifest_id == public_gid) {
            return Some(resolved(public_gid, DepotTier::PublicFromCache));
        }
    }

    // `mtime` sozinho nao serve de criterio: o pacote LuaTools grava um manifest
    // de 2022 com data de hoje. O `buildid` do branch que publicou cada gid e a
    // ordem real; o `mtime` so desempata o que o PICS nao conhece.
    let newest = cached.iter().max_by_key(|(manifest_id, modified)| {
        let build_id = public
            .and_then(|app| crate::steam_pics::build_id_for_manifest(app, depot_id, *manifest_id))
            .and_then(|build_id| build_id.trim().parse::<u64>().ok())
            .unwrap_or(0);
        (build_id, *modified)
    });
    if let Some((manifest_id, _)) = newest {
        return Some(resolved(*manifest_id, DepotTier::NewestInCache));
    }

    lua_pinned.map(|manifest_id| resolved(manifest_id, DepotTier::LuaPinned))
}

/// Depots a baixar para o app, ja com o manifest mais novo que der para usar.
///
/// Fonte dos depots: o `.lua` do SteamTools em `config/stplug-in`. Depot que o
/// PICS marca como exclusivo de outro SO sai fora — sao os depots macOS/Linux
/// que o pacote traz junto e que so inflavam o download.
fn resolve_depots(
    steam_path: &str,
    app_id: &str,
    public: Option<&crate::steam_pics::PublicApp>,
) -> Vec<ResolvedDepot> {
    let lua_path = Path::new(steam_path)
        .join("config")
        .join("stplug-in")
        .join(format!("{app_id}.lua"));

    let Ok(content) = std::fs::read_to_string(&lua_path) else {
        return vec![];
    };

    let pinned = crate::manifest_sources::parse_set_manifest_ids(&content);
    let mut candidates: Vec<u32> = pinned.keys().copied().collect();

    // Depot declarado so por `addappid` (sem linha de manifest) tambem conta: e
    // assim que parte dos pacotes lista os depots de idioma.
    for depot_id in cached_depot_ids(steam_path) {
        if !candidates.contains(&depot_id) && content.contains(&format!("addappid({depot_id},")) {
            candidates.push(depot_id);
        }
    }

    let mut depots: Vec<ResolvedDepot> = candidates
        .into_iter()
        .filter(|depot_id| {
            let oslist = public
                .and_then(|app| app.depot(*depot_id))
                .and_then(|depot| depot.oslist.as_deref());
            crate::steam_pics::depot_runs_on_windows(oslist)
        })
        .filter_map(|depot_id| {
            pick_depot_manifest(steam_path, depot_id, pinned.get(&depot_id).copied(), public)
        })
        .collect();

    depots.sort_by_key(|depot| depot.depot_id);
    depots.dedup_by_key(|depot| depot.depot_id);
    depots
}

/// IDs de depot com algum `.manifest` no `depotcache`.
fn cached_depot_ids(steam_path: &str) -> Vec<u32> {
    let Ok(entries) = std::fs::read_dir(Path::new(steam_path).join("depotcache")) else {
        return vec![];
    };

    let mut ids: Vec<u32> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            let (depot_id, rest) = name.split_once('_')?;
            rest.strip_suffix(".manifest")?;
            depot_id.parse::<u32>().ok()
        })
        .collect();
    ids.sort_unstable();
    ids.dedup();
    ids
}

/// Pasta padrão de downloads: sempre gravável, ao contrário de um caminho derivado
/// da instalação da Steam (que em instalação padrão fica dentro de Program Files).
#[tauri::command]
pub fn cdndownload_default_dir(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;

    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("downloads");

    Ok(directory.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn cdndownload_cancel_game(app_id: String) -> Result<bool, String> {
    cancelled_downloads()
        .lock()
        .map_err(|error| error.to_string())?
        .insert(app_id.clone());

    let worker_stdin = {
        let worker_guard = download_worker().lock().map_err(|error| error.to_string())?;
        let Some(worker) = worker_guard.as_ref() else {
            return Ok(false);
        };
        worker.stdin.clone()
    };

    let command = serde_json::json!({
        "Type": "cancelDownload",
        "AppId": app_id.parse::<u32>().unwrap_or_default(),
    });
    let command_line = serde_json::to_string(&command).map_err(|error| error.to_string())?;
    let mut stdin = worker_stdin.lock().map_err(|error| error.to_string())?;
    stdin
        .write_all(command_line.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|error| format!("Failed to write cancel command to steamkit worker: {error}"))?;

    Ok(true)
}

/// Mantem o indice de validacao de chunks do depot no lugar durante o comando
/// `downloadDepot` e o recolhe ao fim da iteracao.
///
/// E um guard, e nao duas chamadas soltas, porque o laco de depots sai por
/// varios caminhos — cancelamento, worker morto, erro de depot. O worker grava o
/// indice num `finally`, entao ele existe em todos esses casos e recolher
/// tambem precisa acontecer em todos eles.
struct ChunkIndexGuard<'a> {
    downloads_root: &'a Path,
    install_dir: &'a Path,
    app_id: &'a str,
    depot_id: u32,
}

impl<'a> ChunkIndexGuard<'a> {
    fn new(
        downloads_root: &'a Path,
        install_dir: &'a Path,
        app_id: &'a str,
        depot_id: u32,
    ) -> Self {
        crate::chunk_index::swap_in(downloads_root, install_dir, app_id, depot_id);
        Self {
            downloads_root,
            install_dir,
            app_id,
            depot_id,
        }
    }
}

impl Drop for ChunkIndexGuard<'_> {
    fn drop(&mut self) {
        crate::chunk_index::swap_out(
            self.downloads_root,
            self.install_dir,
            self.app_id,
            self.depot_id,
        );
    }
}

/// Barreira para operacoes em uma instalacao: o alvo tem que estar ESTRITAMENTE
/// dentro da raiz de downloads. Recebe caminhos ja canonicalizados, para que
/// `..` tenha sido resolvido antes da comparacao.
fn ensure_inside_downloads_root(
    canonical_root: &Path,
    canonical_output: &Path,
) -> Result<(), String> {
    if canonical_output == canonical_root {
        return Err("The output folder cannot be the downloads root itself.".to_string());
    }
    if !canonical_output.starts_with(canonical_root) {
        return Err("Download output folder resolves outside the downloads root.".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn cdndownload_launch_game(
    app: tauri::AppHandle,
    app_id: String,
    title: String,
    downloads_root: String,
    output_dir: String,
    install_dir: Option<String>,
) -> Result<String, String> {
    let app_id = app_id.trim();
    if app_id.is_empty() || !app_id.chars().all(|character| character.is_ascii_digit()) {
        return Err("Download launch requires a valid app ID.".to_string());
    }

    let root_path = Path::new(downloads_root.trim());
    let output_path = Path::new(output_dir.trim());
    if downloads_root.trim().is_empty() || output_dir.trim().is_empty() {
        return Err("Download launch requires an installation folder.".to_string());
    }

    let canonical_root = root_path
        .canonicalize()
        .map_err(|error| format!("Downloads root is unavailable: {error}"))?;
    let canonical_output = output_path
        .canonicalize()
        .map_err(|error| format!("Installation folder is unavailable: {error}"))?;
    if !canonical_output.is_dir() {
        return Err("Download output path is not a directory.".to_string());
    }
    ensure_inside_downloads_root(&canonical_root, &canonical_output)?;

    let game = serde_json::json!({
        "id": format!("steam-{app_id}"),
        "appId": app_id,
        "title": title.trim(),
        "installDir": install_dir.unwrap_or_default(),
        "installPath": canonical_output.to_string_lossy(),
    });
    let executable = crate::playtime::find_likely_game_executable(&game)
        .ok_or_else(|| "No game executable was found in the installation folder.".to_string())?;
    let canonical_executable = executable
        .canonicalize()
        .map_err(|error| format!("Game executable is unavailable: {error}"))?;
    if !canonical_executable.starts_with(&canonical_output)
        || !canonical_executable.is_file()
        || !canonical_executable
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
    {
        return Err("Detected executable is outside the installation folder.".to_string());
    }

    let working_dir = canonical_executable
        .parent()
        .ok_or_else(|| "Game executable has no parent folder.".to_string())?;
    std::process::Command::new(&canonical_executable)
        .current_dir(working_dir)
        .spawn()
        .map_err(|error| format!("Could not launch game executable: {error}"))?;

    if crate::playtime::mark_process_fallback_started(app_id) {
        crate::playtime::monitor_game_process(
            app,
            game,
            app_id.to_string(),
            canonical_executable.clone(),
        );
    }

    Ok(canonical_executable.to_string_lossy().into_owned())
}

/// `remove_dir_all` sobre uma instalacao inteira leva segundos ou minutos. Um
/// comando sincrono do Tauri roda na thread principal, entao a janela congelava
/// ate o ultimo arquivo sair — o comando so agenda o trabalho, a remocao real
/// mora aqui e roda fora da thread da UI.
#[tauri::command]
pub async fn cdndownload_delete_output_dir(
    app_id: String,
    downloads_root: String,
    output_dir: String,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        delete_output_dir_blocking(&app_id, &downloads_root, &output_dir)
    })
    .await
    .map_err(|error| format!("Download removal failed: {error}"))?
}

fn delete_output_dir_blocking(
    app_id: &str,
    downloads_root: &str,
    output_dir: &str,
) -> Result<bool, String> {
    let app_id = app_id.trim();
    let downloads_root = downloads_root.trim();
    let output_dir = output_dir.trim();
    if app_id.is_empty() || downloads_root.is_empty() {
        return Err("Download removal requires an app ID and a downloads root.".to_string());
    }

    let root_path = Path::new(downloads_root);
    if output_dir.is_empty() {
        // Cancelado antes de o destino ser resolvido: nao ha pasta a remover,
        // mas um ACF de tentativa anterior ainda pode estar apontando para nada.
        let _ = crate::steam_appmanifest::remove_appmanifest(root_path, app_id);
        crate::chunk_index::remove_app_stash(root_path, app_id);
        return Ok(true);
    }
    let output_path = Path::new(output_dir);

    // O guard antigo exigia que o destino fosse `<root>\<appid>`. Com os depots
    // mesclados o destino virou `<root>\steamapps\common\<installdir>`, que o
    // usuario nunca digita — vem do appinfo. Entao a checagem passa a ser de
    // CONTENCAO: qualquer pasta estritamente dentro da raiz de downloads serve,
    // e a raiz em si nunca. Cobre os dois formatos e continua barrando `..`.
    let canonical_root = root_path
        .canonicalize()
        .map_err(|error| format!("Downloads root is unavailable: {error}"))?;
    if !output_path.exists() {
        // Removida por fora (ou nunca criada): o resultado desejado ja vale.
        // Ainda assim o ACF orfao precisa sair.
        let _ = crate::steam_appmanifest::remove_appmanifest(&canonical_root, app_id);
        crate::chunk_index::remove_app_stash(&canonical_root, app_id);
        return Ok(true);
    }
    if !output_path.is_dir() {
        return Err("Download output path is not a directory.".to_string());
    }
    let canonical_output = output_path.canonicalize().map_err(|error| error.to_string())?;
    ensure_inside_downloads_root(&canonical_root, &canonical_output)?;

    std::fs::remove_dir_all(&canonical_output).map_err(|error| error.to_string())?;
    // Sem os arquivos, o ACF apontaria para uma instalacao inexistente e o Steam
    // mostraria o jogo instalado ate a proxima verificacao.
    let _ = crate::steam_appmanifest::remove_appmanifest(&canonical_root, app_id);
    // O indice descreve chunks que nao existem mais; guardado, so acumularia.
    crate::chunk_index::remove_app_stash(&canonical_root, app_id);
    Ok(true)
}

/// Copia recursiva de diretorio para outro volume (fallback quando
/// `std::fs::rename` nao consegue cruzar unidade). Nao e a operacao normal de
/// instalacao, so roda em "mover instalacao" entre discos diferentes.
fn copy_dir_recursive(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(destination)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let path = entry.path();
        let target = destination.join(entry.file_name());
        if path.is_dir() {
            copy_dir_recursive(&path, &target)?;
        } else {
            std::fs::copy(&path, &target)?;
        }
    }
    Ok(())
}

/// Move uma instalacao baixada pelo GhostBox CDN de uma raiz de downloads para
/// outra. Espelha o layout `<root>\steamapps\common\<installDir>` e replica o
/// ACF verbatim: o `installdir` no ACF e relativo, entao o mesmo conteudo serve
/// em qualquer raiz. O indice de chunks do depot e limpo no destino antigo
/// porque descreve chunks em um caminho que deixou de existir; o Steam re-cria
/// na proxima verificacao se o usuario pedir Verify Integrity.
#[tauri::command]
pub fn cdndownload_move_install_dir(
    app_id: String,
    old_downloads_root: String,
    old_output_dir: String,
    new_downloads_root: String,
) -> Result<String, String> {
    let app_id = app_id.trim();
    let old_root_str = old_downloads_root.trim();
    let new_root_str = new_downloads_root.trim();
    if app_id.is_empty() {
        return Err("Move requires a valid app ID.".into());
    }
    if old_root_str.is_empty() || new_root_str.is_empty() {
        return Err("Move requires both old and new downloads roots.".into());
    }

    let old_root = Path::new(old_root_str);
    let new_root = Path::new(new_root_str);
    let canonical_old_root = old_root
        .canonicalize()
        .map_err(|error| format!("Old downloads root is unavailable: {error}"))?;
    let canonical_new_root = new_root
        .canonicalize()
        .map_err(|error| format!("New downloads root is unavailable: {error}"))?;
    if canonical_new_root == canonical_old_root {
        return Err("New location is the same as the current one.".into());
    }

    let old_output_path = Path::new(old_output_dir.trim());
    if !old_output_path.is_dir() {
        return Err("Installation folder is unavailable.".into());
    }
    let canonical_old_output = old_output_path
        .canonicalize()
        .map_err(|error| error.to_string())?;
    ensure_inside_downloads_root(&canonical_old_root, &canonical_old_output)?;

    let install_dir = canonical_old_output
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Could not resolve the install folder name.".to_string())?
        .to_string();

    let new_steamapps = crate::steam_appmanifest::steamapps_dir(&canonical_new_root);
    let new_output_path =
        crate::steam_appmanifest::install_dir_path(&canonical_new_root, &install_dir);

    if new_output_path.exists() {
        return Err(format!(
            "Target folder already exists at {}. Move aborted to avoid clobbering data.",
            new_output_path.display()
        ));
    }
    std::fs::create_dir_all(&new_steamapps).map_err(|error| error.to_string())?;
    if let Some(parent) = new_output_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    if std::fs::rename(&canonical_old_output, &new_output_path).is_err() {
        copy_dir_recursive(&canonical_old_output, &new_output_path)
            .map_err(|error| format!("Could not copy the installation folder: {error}"))?;
        std::fs::remove_dir_all(&canonical_old_output)
            .map_err(|error| format!("Old folder removed partially: {error}"))?;
    }

    let old_acf = crate::steam_appmanifest::appmanifest_path(&canonical_old_root, app_id);
    let new_acf = crate::steam_appmanifest::appmanifest_path(&canonical_new_root, app_id);
    if old_acf.is_file() {
        if let Ok(contents) = std::fs::read_to_string(&old_acf) {
            let _ = std::fs::write(&new_acf, contents);
        }
        let _ = std::fs::remove_file(&old_acf);
    }

    crate::chunk_index::remove_app_stash(&canonical_old_root, app_id);

    Ok(new_output_path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn cdndownload_download_game(
    app: tauri::AppHandle,
    app_id: String,
    downloads_root: String,
    game_title: Option<String>,
    steam_path: Option<String>,
    parallel_chunks: Option<u32>,
    allow_stale: Option<bool>,
) -> Result<serde_json::Value, String> {
    let _ = take_download_cancelled(&app_id);
    let parallel_chunks = parallel_chunks.unwrap_or(24).clamp(1, 32);
    let steam_path = match steam_path {
        Some(path) => path,
        None => crate::resolve_steam_path(&app, None)
            .0
            .ok_or_else(|| {
                "Steam path not found. Configure Steam path in Library settings.".to_string()
            })?,
    };

    let public = crate::steam_pics::resolve_public_app(&steam_path, &app_id).await;
    let resolved_depots = resolve_depots(&steam_path, &app_id, public.as_ref());
    if resolved_depots.is_empty() {
        return Ok(serde_json::json!({
            "Type": "error",
            "Status": "no-depots",
            "Message": format!("No depots found for app {app_id} in OST Lua or depotcache.")
        }));
    }

    // Antes de qualquer byte: se algum depot vai baixar uma build que nao e a
    // publica, o usuario decide. Baixar dezenas de GB de uma versao velha e o
    // desperdicio que esta correcao existe para evitar.
    let stale: Vec<&ResolvedDepot> = resolved_depots
        .iter()
        .filter(|depot| !depot.is_current())
        .collect();
    if !stale.is_empty() {
        let detail = serde_json::json!({
            "Type": "status",
            "Status": "stale-manifest",
            "AppId": app_id,
            "PublicBuildId": public.as_ref().map(|app| app.build_id.clone()).unwrap_or_default(),
            "Depots": stale
                .iter()
                .map(|depot| serde_json::json!({
                    "DepotId": depot.depot_id,
                    "ManifestId": depot.manifest_id.to_string(),
                    "PublicGid": depot.public_gid.map(|gid| gid.to_string()),
                    "Tier": depot.tier.as_str(),
                }))
                .collect::<Vec<_>>(),
        });
        app.emit("download-progress", detail.clone()).ok();

        if !allow_stale.unwrap_or(false) {
            let mut refusal = detail;
            refusal["Type"] = serde_json::json!("error");
            refusal["Message"] = serde_json::json!(
                "O manifest mais novo disponivel em disco e anterior a build publica. \
                 Abra a Steam com o jogo adicionado para ela baixar o manifest atual \
                 para o depotcache, ou confirme para baixar a build antiga mesmo assim."
            );
            return Ok(refusal);
        }
    }

    let depots: Vec<(u32, u64)> = resolved_depots
        .iter()
        .map(|depot| (depot.depot_id, depot.manifest_id))
        .collect();

    // O destino precisa ser resolvido ANTES do loop: todos os depots gravam na
    // mesma pasta `steamapps\common\<installdir>`, que e como o Steam monta um
    // app. Gravar cada depot em `depot_<id>` separado — o comportamento antigo —
    // deixava o executavel enterrado e o Steam nunca reconhecia a instalacao.
    let library_root = std::path::PathBuf::from(downloads_root.trim_end_matches(['\\', '/']));
    let app_info = crate::steam_appinfo::read_app_info(&steam_path, &app_id);
    let install_dir = crate::steam_appinfo::resolve_install_dir(
        app_info.as_ref(),
        game_title.as_deref().unwrap_or_default(),
        &app_id,
    );
    let install_path = crate::steam_appmanifest::install_dir_path(&library_root, &install_dir);
    let install_path_text = install_path.to_string_lossy().into_owned();

    if let Some(conflict) =
        crate::steam_appmanifest::conflicting_library(&steam_path, &library_root, &app_id)
    {
        return Ok(serde_json::json!({
            "Type": "error",
            "Status": "already-installed",
            "AppId": app_id,
            "Message": format!(
                "Este jogo ja esta instalado na biblioteca Steam em {conflict}. Desinstale por la antes de baixar pelo GhostBox."
            )
        }));
    }

    app.emit(
        "download-progress",
        serde_json::json!({
            "Type": "status",
            "Status": "depot-plan",
            "AppId": app_id,
            "DepotTotal": depots.len(),
            "InstallDir": install_dir,
            "OutputDir": install_path_text,
        }),
    )
    .ok();

    let mut all_results = Vec::new();
    let (worker_stdin, worker_stdout, worker_process_id) = {
        let mut worker_guard = download_worker().lock().map_err(|error| error.to_string())?;
        let worker = ensure_download_worker(&mut worker_guard)?;
        (worker.stdin.clone(), worker.stdout.clone(), worker.child.id())
    };
    active_download_processes()
        .lock()
        .map_err(|error| error.to_string())?
        .insert(app_id.clone(), worker_process_id);

    let mut depot_sizes = Vec::with_capacity(depots.len());
    for (depot_id, manifest_id) in &depots {
        if take_download_cancelled(&app_id) {
            clear_active_download_process(&app_id);
            return Ok(serde_json::json!({
                "Type": "cancelled",
                "Status": "cancelled",
                "AppId": app_id,
            }));
        }

        write_worker_command(
            &worker_stdin,
            &serde_json::json!({
                "Type": "inspectDepot",
                "AppId": app_id.parse::<u32>().unwrap_or_default(),
                "DepotId": depot_id,
                "ManifestId": manifest_id,
                "SteamPath": steam_path,
            }),
        )?;

        let Some(inspected) = read_worker_event(&worker_stdout)? else {
            clear_active_download_process(&app_id);
            return Ok(serde_json::json!({
                "Type": "error",
                "Status": "worker-exited-during-inspection",
                "Message": "steamkit worker exited while inspecting download manifests.",
            }));
        };
        if inspected.get("Type").and_then(|value| value.as_str()) != Some("depot-inspected") {
            clear_active_download_process(&app_id);
            return Ok(inspected);
        }
        depot_sizes.push(
            inspected
                .get("TotalBytes")
                .and_then(|value| value.as_u64())
                .unwrap_or(0),
        );
    }

    let total_download_bytes: u64 = depot_sizes.iter().sum();
    app.emit(
        "download-progress",
        serde_json::json!({
            "Type": "status",
            "Status": "depot-plan",
            "AppId": app_id,
            "DepotTotal": depots.len(),
            "TotalBytes": total_download_bytes,
            "InstallDir": install_dir,
            "OutputDir": install_path_text,
        }),
    )
    .ok();

    let mut completed_depot_bytes = 0u64;

    // Execucao anterior pode ter morrido antes de recolher o indice de chunks.
    // Ele fica no `install_dir` sem dizer de qual depot e — mas o `ManifestId`
    // dentro do arquivo diz, e os pares vieram de `resolve_depots`.
    crate::chunk_index::adopt_orphan(&library_root, &install_path, &app_id, &depots);

    for ((depot_id, manifest_id), depot_size) in depots.iter().zip(depot_sizes.iter()) {
        if take_download_cancelled(&app_id) {
            clear_active_download_process(&app_id);
            return Ok(serde_json::json!({
                "Type": "cancelled",
                "Status": "cancelled",
                "AppId": app_id,
            }));
        }

        // O worker le e escreve o indice num caminho fixo dentro do `OutputDir`,
        // e o indice so vale para um manifest. Com os depots dividindo o mesmo
        // destino, cada um destruia o do anterior; o guard poe o indice certo
        // antes do comando e o recolhe ao fim da iteracao, por qualquer saida.
        let _chunk_index = ChunkIndexGuard::new(&library_root, &install_path, &app_id, *depot_id);

        // Destino unico para todos os depots. Depots do mesmo app tem caminhos
        // relativos disjuntos; onde colidem, vence quem grava por ultimo — o
        // mesmo criterio do proprio Steam.
        let depot_output = install_path_text.clone();

        app.emit(
            "download-progress",
            serde_json::json!({
                "Type": "status",
                "Status": "starting-depot",
                "AppId": app_id,
                "DepotId": depot_id,
                "ManifestId": manifest_id,
                "OutputDir": depot_output,
            }),
        )
        .ok();

        let command = serde_json::json!({
            "Type": "downloadDepot",
            "AppId": app_id.parse::<u32>().unwrap_or_default(),
            "DepotId": depot_id,
            "ManifestId": manifest_id,
            "SteamPath": steam_path,
            "OutputDir": depot_output,
            "ParallelChunks": parallel_chunks,
        });
        write_worker_command(&worker_stdin, &command)?;

        let depot_result = loop {
            let Some(mut value) = read_worker_event(&worker_stdout)? else {
                let _ = download_worker().lock().map(|mut worker| *worker = None);
                if take_download_cancelled(&app_id) {
                    clear_active_download_process(&app_id);
                    return Ok(serde_json::json!({
                        "Type": "cancelled",
                        "Status": "cancelled",
                        "AppId": app_id,
                        "DepotId": depot_id,
                    }));
                }
                clear_active_download_process(&app_id);
                return Ok(serde_json::json!({
                    "Type": "error",
                    "Status": "worker-exited",
                    "Message": "steamkit worker exited before reporting a result.",
                    "DepotId": depot_id,
                }));
            };
            let event_type = value
                .get("Type")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            if event_type == "progress" {
                let current_depot_bytes = value
                    .get("BytesDownloaded")
                    .and_then(|bytes| bytes.as_u64())
                    .unwrap_or(0);
                value["BytesDownloaded"] =
                    serde_json::json!(completed_depot_bytes + current_depot_bytes);
                value["BytesTotal"] = serde_json::json!(total_download_bytes);
            } else if event_type == "status"
                && value.get("Status").and_then(|status| status.as_str())
                    == Some("manifest-loaded")
            {
                value["TotalBytes"] = serde_json::json!(total_download_bytes);
            }

            let _ = app.emit("download-progress", value.clone());
            if event_type == "complete" || event_type == "error" || event_type == "cancelled" {
                break value;
            }
        };

        if take_download_cancelled(&app_id) {
            clear_active_download_process(&app_id);
            return Ok(serde_json::json!({
                "Type": "cancelled",
                "Status": "cancelled",
                "AppId": app_id,
                "DepotId": depot_id,
            }));
        }

        all_results.push(depot_result);
        completed_depot_bytes += *depot_size;
    }

    clear_active_download_process(&app_id);

    // Um depot que falhou deixa a instalacao incompleta. Escrever o ACF aqui
    // faria o Steam anunciar "fully installed" sobre arquivos faltando.
    let any_depot_failed = all_results
        .iter()
        .any(|result| result.get("Type").and_then(|value| value.as_str()) == Some("error"));

    let steam_integration = if any_depot_failed {
        serde_json::json!({
            "Status": "skipped",
            "Message": "Um ou mais depots falharam; o appmanifest nao foi escrito."
        })
    } else {
        finalize_steam_integration(
            &app,
            &app_id,
            &steam_path,
            &library_root,
            &install_dir,
            app_info.as_ref(),
            game_title.as_deref().unwrap_or_default(),
            &depots,
            &depot_sizes,
            public.as_ref(),
        )
    };

    Ok(serde_json::json!({
        "Type": "complete",
        "Depots": all_results,
        "DepotCount": all_results.len(),
        "InstallDir": install_dir,
        "OutputDir": install_path_text,
        "SteamIntegration": steam_integration,
    }))
}

/// `buildid` que os arquivos em disco de fato representam.
///
/// Um app so esta na build N se **todos** os seus depots estiverem, entao vence
/// o menor `buildid` entre os depots baixados. Depot cujo manifest nao aparece
/// em nenhum branch do PICS nao tem opiniao e e ignorado; se nenhum depot
/// resolver, o chamador volta ao `buildid` do appinfo.
fn resolve_installed_build_id(
    public: Option<&crate::steam_pics::PublicApp>,
    depots: &[(u32, u64)],
) -> Option<String> {
    let public = public?;
    depots
        .iter()
        .filter_map(|(depot_id, manifest_id)| {
            crate::steam_pics::build_id_for_manifest(public, *depot_id, *manifest_id)
        })
        .filter_map(|build_id| build_id.trim().parse::<u64>().ok())
        .min()
        .map(|build_id| build_id.to_string())
}

/// Passo final: depotcache, `appmanifest_<appid>.acf` e registro da biblioteca.
///
/// Falhas aqui **nao** invalidam o download — os bytes ja estao em disco e sao
/// reaproveitaveis. Elas voltam como aviso para o usuario poder agir (tipicamente
/// fechar a Steam e repetir), em vez de descartar dezenas de GB baixados.
#[allow(clippy::too_many_arguments)]
fn finalize_steam_integration(
    app: &tauri::AppHandle,
    app_id: &str,
    steam_path: &str,
    library_root: &Path,
    install_dir: &str,
    app_info: Option<&crate::steam_appinfo::AppInfo>,
    fallback_title: &str,
    depots: &[(u32, u64)],
    depot_sizes: &[u64],
    public: Option<&crate::steam_pics::PublicApp>,
) -> serde_json::Value {
    let emit = |status: &str| {
        app.emit(
            "download-progress",
            serde_json::json!({
                "Type": "status",
                "Status": status,
                "AppId": app_id,
            }),
        )
        .ok();
    };

    emit("copying-depotcache");
    let copied_manifests =
        crate::steam_appmanifest::copy_depot_manifests(Path::new(steam_path), library_root, depots);

    emit("writing-manifest");
    let installed_depots: Vec<crate::steam_appmanifest::InstalledDepot> = depots
        .iter()
        .zip(depot_sizes.iter())
        .map(|((depot_id, manifest_id), size)| (*depot_id, *manifest_id, *size))
        .collect();
    let size_on_disk = crate::steam_appmanifest::installed_size_on_disk(library_root, install_dir);
    let name = app_info
        .map(|info| info.name.as_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(fallback_title);
    // O `buildid` tem que ser o da build que os arquivos em disco representam.
    // Carimbar o do branch publico sobre uma build antiga faz a Steam anunciar
    // "fully installed" e nunca oferecer atualizacao — era exatamente por isso
    // que os jogos ficavam presos numa versao velha.
    let installed_build_id = resolve_installed_build_id(public, depots);
    let build_id = installed_build_id
        .as_deref()
        .or_else(|| app_info.map(|info| info.build_id.as_str()))
        .unwrap_or("");
    let last_owner = crate::steam_appmanifest::resolve_last_owner(steam_path);

    let manifest_path = match crate::steam_appmanifest::write_appmanifest(
        library_root,
        app_id,
        name,
        install_dir,
        build_id,
        &installed_depots,
        size_on_disk,
        &last_owner,
    ) {
        Ok(path) => path.to_string_lossy().into_owned(),
        Err(error) => {
            return serde_json::json!({
                "Status": "manifest-failed",
                "Message": error,
                "CopiedManifests": copied_manifests,
            });
        }
    };

    emit("registering-library");
    if let Err(error) = crate::steam_appmanifest::register_library_folder(
        steam_path,
        library_root,
        app_id,
        size_on_disk,
    ) {
        return serde_json::json!({
            "Status": "library-not-registered",
            "Message": error,
            "ManifestPath": manifest_path,
            "CopiedManifests": copied_manifests,
            "SizeOnDisk": size_on_disk,
        });
    }

    serde_json::json!({
        "Status": "ok",
        "ManifestPath": manifest_path,
        "CopiedManifests": copied_manifests,
        "SizeOnDisk": size_on_disk,
        "BuildId": build_id,
        "RequiresSteamRestart": true,
    })
}

#[cfg(test)]
mod tests {
    use super::ensure_inside_downloads_root;
    use std::path::Path;

    #[test]
    fn accepts_the_merged_install_dir_under_the_root() {
        assert!(ensure_inside_downloads_root(
            Path::new(r"E:\GhostBoxDownloads"),
            Path::new(r"E:\GhostBoxDownloads\steamapps\common\Hollow Knight"),
        )
        .is_ok());
    }

    #[test]
    fn accepts_the_legacy_per_appid_layout() {
        // Tasks persistidas antes da mudanca de layout ainda apontam para
        // `<root>\<appid>`; recusa-las deixaria o download preso na lista.
        assert!(ensure_inside_downloads_root(
            Path::new(r"E:\GhostBoxDownloads"),
            Path::new(r"E:\GhostBoxDownloads\367520"),
        )
        .is_ok());
    }

    #[test]
    fn refuses_to_delete_the_downloads_root_itself() {
        let error = ensure_inside_downloads_root(
            Path::new(r"E:\GhostBoxDownloads"),
            Path::new(r"E:\GhostBoxDownloads"),
        )
        .unwrap_err();
        assert!(error.contains("downloads root itself"));
    }

    #[test]
    fn refuses_a_sibling_directory_outside_the_root() {
        assert!(ensure_inside_downloads_root(
            Path::new(r"E:\GhostBoxDownloads"),
            Path::new(r"E:\Windows\System32"),
        )
        .is_err());
    }

    #[test]
    fn refuses_a_prefix_lookalike_that_is_not_a_real_child() {
        // `starts_with` de `Path` compara componentes, nao texto: sem isso
        // `...Downloads-old` passaria por ser prefixo de string.
        assert!(ensure_inside_downloads_root(
            Path::new(r"E:\GhostBoxDownloads"),
            Path::new(r"E:\GhostBoxDownloads-old\steamapps"),
        )
        .is_err());
    }

    // --- Escolha do manifest por depot ---------------------------------------

    use super::{
        pick_depot_manifest, resolve_depots, resolve_installed_build_id, DepotTier,
    };
    use crate::steam_pics::{PicsSource, PublicApp, PublicDepot};
    use std::collections::BTreeMap;

    /// `<root>/config/stplug-in/<appid>.lua` + `<root>/depotcache/*.manifest`.
    /// `cached` traz `(depot, manifest)` na ordem de gravacao, entao o ultimo
    /// tem o `mtime` mais recente.
    fn fake_steam(app_id: &str, lua: &str, cached: &[(u32, u64)]) -> std::path::PathBuf {
        let root = std::env::temp_dir()
            .join(format!("ghostbox-depots-{}", uuid::Uuid::new_v4().simple()));
        let plugins = root.join("config").join("stplug-in");
        let depotcache = root.join("depotcache");
        std::fs::create_dir_all(&plugins).unwrap();
        std::fs::create_dir_all(&depotcache).unwrap();
        std::fs::write(plugins.join(format!("{app_id}.lua")), lua).unwrap();
        for (depot_id, manifest_id) in cached {
            std::fs::write(
                depotcache.join(format!("{depot_id}_{manifest_id}.manifest")),
                b"manifest",
            )
            .unwrap();
            // O `mtime` do NTFS tem resolucao grossa; sem a pausa dois arquivos
            // gravados em sequencia empatam e o desempate por data some.
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        root
    }

    fn depot(depot_id: u32, oslist: Option<&str>, branches: &[(&str, u64)]) -> PublicDepot {
        let branch_manifests: BTreeMap<String, u64> = branches
            .iter()
            .map(|(branch, gid)| ((*branch).to_string(), *gid))
            .collect();
        PublicDepot {
            depot_id,
            manifest_gid: branch_manifests.get("public").copied().unwrap_or_default(),
            size: 0,
            oslist: oslist.map(str::to_string),
            branch_manifests,
        }
    }

    fn public_app(depots: Vec<PublicDepot>) -> PublicApp {
        PublicApp {
            build_id: "22529139".into(),
            branch_build_ids: BTreeMap::from([
                ("public".to_string(), "22529139".to_string()),
                ("antiga".to_string(), "20231655".to_string()),
            ]),
            depots,
            source: PicsSource::SteamCmdApi,
        }
    }

    const PUBLIC_GID: u64 = 257781644874438846;
    const OLD_GID: u64 = 4539921744901848404;

    #[test]
    fn the_public_manifest_in_the_cache_beats_the_pin_written_in_the_lua() {
        let lua = format!(
            "addappid(367521,1,\"ab\")\n--setManifestid(367521,\"{OLD_GID}\")\n"
        );
        let root = fake_steam("367520", &lua, &[(367521, OLD_GID), (367521, PUBLIC_GID)]);
        let app = public_app(vec![depot(
            367521,
            Some("windows"),
            &[("public", PUBLIC_GID), ("antiga", OLD_GID)],
        )]);

        let depots = resolve_depots(&root.to_string_lossy(), "367520", Some(&app));
        let _ = std::fs::remove_dir_all(&root);

        assert_eq!(depots.len(), 1);
        assert_eq!(depots[0].manifest_id, PUBLIC_GID);
        assert_eq!(depots[0].tier, DepotTier::PublicFromCache);
        assert!(depots[0].is_current());
    }

    #[test]
    fn without_the_public_manifest_the_highest_build_id_in_the_cache_wins() {
        // O pacote LuaTools grava o manifest de 2022 com data de hoje, entao o
        // `mtime` aponta para o lado errado de proposito neste teste.
        let lua = format!("addappid(367521,1,\"ab\")\n--setManifestid(367521,\"{OLD_GID}\")\n");
        let root = fake_steam("367520", &lua, &[(367521, 111), (367521, OLD_GID)]);
        let app = public_app(vec![depot(367521, Some("windows"), &[
            ("public", PUBLIC_GID),
            ("antiga", OLD_GID),
        ])]);

        let depots = resolve_depots(&root.to_string_lossy(), "367520", Some(&app));
        let _ = std::fs::remove_dir_all(&root);

        assert_eq!(depots[0].manifest_id, OLD_GID);
        assert_eq!(depots[0].tier, DepotTier::NewestInCache);
        assert!(!depots[0].is_current());
    }

    #[test]
    fn an_empty_cache_falls_back_to_the_pin_in_the_lua() {
        let lua = format!("addappid(367521,1,\"ab\")\n--setManifestid(367521,\"{OLD_GID}\")\n");
        let root = fake_steam("367520", &lua, &[]);

        let depots = resolve_depots(&root.to_string_lossy(), "367520", None);
        let _ = std::fs::remove_dir_all(&root);

        assert_eq!(depots[0].manifest_id, OLD_GID);
        assert_eq!(depots[0].tier, DepotTier::LuaPinned);
        // Sem PICS nao ha com o que comparar, entao nada de aviso de build velha.
        assert!(depots[0].is_current());
    }

    #[test]
    fn depots_of_another_os_are_dropped_and_shared_depots_are_kept() {
        let lua = concat!(
            "addappid(367521,1,\"ab\")\n--setManifestid(367521,\"1\")\n",
            "addappid(367522,1,\"cd\")\n--setManifestid(367522,\"2\")\n",
            "addappid(367524,1,\"ef\")\n--setManifestid(367524,\"3\")\n",
        );
        let root = fake_steam("367520", lua, &[]);
        let app = public_app(vec![
            depot(367521, Some("windows"), &[("public", 1)]),
            depot(367522, Some("macos"), &[("public", 2)]),
            // Depot compartilhado: sem `oslist`, precisa entrar.
            depot(367524, None, &[("public", 3)]),
        ]);

        let depots = resolve_depots(&root.to_string_lossy(), "367520", Some(&app));
        let _ = std::fs::remove_dir_all(&root);

        let ids: Vec<u32> = depots.iter().map(|depot| depot.depot_id).collect();
        assert_eq!(ids, vec![367521, 367524]);
    }

    #[test]
    fn a_depot_the_pics_does_not_know_still_resolves_from_the_lua() {
        // PICS indisponivel ou depot removido do app: recusar aqui deixaria o
        // download impossivel em vez de apenas sem aviso de frescor.
        let lua = "addappid(999,1,\"ab\")\n--setManifestid(999,\"42\")\n";
        let root = fake_steam("367520", lua, &[]);
        let app = public_app(vec![depot(367521, Some("windows"), &[("public", 1)])]);

        let resolved = pick_depot_manifest(&root.to_string_lossy(), 999, Some(42), Some(&app));
        let _ = std::fs::remove_dir_all(&root);

        let resolved = resolved.unwrap();
        assert_eq!(resolved.manifest_id, 42);
        assert_eq!(resolved.public_gid, None);
        assert!(resolved.is_current());
    }

    #[test]
    fn the_installed_build_id_is_the_oldest_depot_not_the_public_branch() {
        let app = public_app(vec![
            depot(367521, Some("windows"), &[("public", PUBLIC_GID), ("antiga", OLD_GID)]),
            depot(367524, None, &[("public", 7), ("antiga", 8)]),
        ]);

        // Um depot atual e outro atrasado: a instalacao vale pela build antiga.
        assert_eq!(
            resolve_installed_build_id(Some(&app), &[(367521, PUBLIC_GID), (367524, 8)]),
            Some("20231655".to_string())
        );
        assert_eq!(
            resolve_installed_build_id(Some(&app), &[(367521, PUBLIC_GID), (367524, 7)]),
            Some("22529139".to_string())
        );
        // Nenhum manifest conhecido: o chamador cai no buildid do appinfo.
        assert_eq!(resolve_installed_build_id(Some(&app), &[(367521, 999)]), None);
        assert_eq!(resolve_installed_build_id(None, &[(367521, PUBLIC_GID)]), None);
    }
}
