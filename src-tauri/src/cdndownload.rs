use std::collections::{HashMap, HashSet};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime};
use tauri::{Emitter, Manager};

const POC_RELATIVE_PATH: &str = "../sidecars/steamkit-worker/steamkit-poc.exe";

/// Chunks baixados em paralelo por depot. Fixo no teto que o worker aceita
/// (`Math.Clamp(..., 1, 32)` em `SteamKitPocRunner`): deixar isto configurável
/// só dava ao usuário a chance de escolher errado, e o custo de disco que
/// justificava valores baixos foi resolvido marcando os arquivos como sparse.
const MAX_PARALLEL_CHUNKS: u32 = 32;
/// O GhostBox só faz o bootstrap. A Steam recebe o ACF parcial e baixa o resto.
const STEAM_BOOTSTRAP_BYTES: u64 = 1024 * 1024;
/// Quanto o arquivo admitido pode estourar o bootstrap para fechar inteiro.
/// Arquivo parcial em disco vira revalidação/falha na retomada — ou entra
/// inteiro ou não entra. O teto impede um arquivo gigante no início da fila
/// de transformar o bootstrap de 1 MiB num download de GB.
const STEAM_BOOTSTRAP_OVERSHOOT_BYTES: u64 = 64 * 1024 * 1024;

static ACTIVE_DOWNLOAD_PROCESSES: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();
static CANCELLED_DOWNLOADS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static DOWNLOAD_WORKER: OnceLock<Mutex<Option<DownloadWorker>>> = OnceLock::new();
static DEPOT_SIZE_CACHE: OnceLock<Mutex<HashMap<PathBuf, DepotSizeCacheEntry>>> = OnceLock::new();
// O protocolo do worker tem um único stdout: dois consumidores misturariam
// respostas de depots diferentes. Mantém a exclusão também durante o preparo.
static DOWNLOAD_GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

struct ActiveDownloadGuard(String);

// Se o IPC falhar no meio de um comando, não reutilize um worker que ainda
// pode estar emitindo a resposta anterior no stdout compartilhado.
struct WorkerCommandGuard(bool);

impl Drop for WorkerCommandGuard {
    fn drop(&mut self) {
        if self.0 {
            shutdown_download_worker();
        }
    }
}

impl Drop for ActiveDownloadGuard {
    fn drop(&mut self) {
        clear_active_download_process(&self.0);
        let _ = take_download_cancelled(&self.0);
    }
}

fn download_byte_budget(full_download: bool, downloaded: u64) -> Option<u64> {
    if full_download {
        None // Zero no protocolo significa sem limite, não download concluído.
    } else {
        Some(STEAM_BOOTSTRAP_BYTES.saturating_sub(downloaded))
    }
}

fn depot_failed(result: &serde_json::Value) -> bool {
    result.get("Type").and_then(|value| value.as_str()) == Some("error")
        || result.get("FailedFiles").and_then(|value| value.as_u64()).unwrap_or(0) > 0
}

#[derive(Clone)]
struct DepotSizeCacheEntry {
    file_len: u64,
    modified: SystemTime,
    total_bytes: u64,
}

fn depot_size_cache() -> &'static Mutex<HashMap<PathBuf, DepotSizeCacheEntry>> {
    DEPOT_SIZE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cached_depot_size(manifest_path: &Path) -> Option<u64> {
    let metadata = std::fs::metadata(manifest_path).ok()?;
    let modified = metadata.modified().ok()?;
    let mut cache = depot_size_cache().lock().ok()?;
    let entry = cache.get(manifest_path)?;
    if entry.file_len == metadata.len() && entry.modified == modified {
        return Some(entry.total_bytes);
    }
    cache.remove(manifest_path);
    None
}

fn store_depot_size(manifest_path: &Path, total_bytes: u64) {
    let Ok(metadata) = std::fs::metadata(manifest_path) else {
        return;
    };
    let Ok(modified) = metadata.modified() else {
        return;
    };
    if let Ok(mut cache) = depot_size_cache().lock() {
        cache.insert(
            manifest_path.to_path_buf(),
            DepotSizeCacheEntry {
                file_len: metadata.len(),
                modified,
                total_bytes,
            },
        );
    }
}

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

fn download_cancel_pending(app_id: &str) -> bool {
    cancelled_downloads()
        .lock()
        .map(|cancelled| cancelled.contains(app_id))
        .unwrap_or(false)
}

/// Prazo para o worker confirmar o cancelamento antes de ser considerado
/// travado. O `read_worker_event` bloqueia lendo o stdout: se o worker está
/// preso numa requisição de chunk que ignora o token, o loop nunca vê a flag
/// e o `download_game` nunca resolve — a UI fica em `paused` com a retomada
/// pendente para sempre ("não volta"). O watchdog derruba o processo; o loop
/// vê EOF e, com a flag ainda presente, resolve como `cancelled`.
const CANCEL_WATCHDOG_SECS: u64 = 8;

fn spawn_cancel_watchdog(app_id: String) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(CANCEL_WATCHDOG_SECS));
        // Só age se o cancelamento original continua pendente: se a flag sumiu,
        // o loop antigo já saiu (e uma retomada pode estar rodando sob o mesmo
        // app_id — derrubar o worker mataria o download novo).
        let stuck = active_download_processes()
            .lock()
            .map(|processes| processes.contains_key(&app_id))
            .unwrap_or(false)
            && download_cancel_pending(&app_id);
        if !stuck {
            return;
        }
        if let Ok(mut worker_guard) = download_worker().lock() {
            if let Some(mut worker) = worker_guard.take() {
                let _ = worker.child.kill();
                let _ = worker.child.wait();
            }
        }
    });
}

fn ensure_download_worker<'a>(
    app: &tauri::AppHandle,
    worker: &'a mut Option<DownloadWorker>,
) -> Result<&'a mut DownloadWorker, String> {
    let should_start = match worker.as_mut() {
        Some(existing) => existing
            .child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_some(),
        None => true,
    };

    if should_start {
        let poc_path = find_poc_binary(app)?;
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

fn find_poc_binary(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    if let Ok(path) = std::env::var("GHOSTBOX_POC_PATH") {
        let p = std::path::PathBuf::from(&path);
        if p.exists() {
            return Ok(p);
        }
        return Err(format!("GHOSTBOX_POC_PATH set but not found: {path}"));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir
            .join("steamkit-worker")
            .join("steamkit-poc.exe");
        if bundled.is_file() {
            return Ok(bundled);
        }
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
    /// O manifest do branch `public` nao estava em disco — fonte de pacote
    /// raw-lua (SteamTools, ManifestHub) nao embute `.manifest` — e foi buscado
    /// de um zip de pacote (Sushi/LuaTools) e gravado no `depotcache`. Build
    /// atual.
    PublicFromPackage,
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
            DepotTier::PublicFromPackage => "public-from-package",
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
        if cached
            .iter()
            .any(|(manifest_id, _)| *manifest_id == public_gid)
        {
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
            public.and_then(|app| app.depot(*depot_id))
                .is_none_or(crate::steam_pics::depot_matches_download_config)
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

/// Caminho do `.manifest` de um depot dentro do `depotcache` da Steam.
fn depot_manifest_path(steam_path: &str, depot_id: u32, manifest_id: u64) -> PathBuf {
    Path::new(steam_path)
        .join("depotcache")
        .join(format!("{depot_id}_{manifest_id}.manifest"))
}

/// Chaves de depot declaradas em TODOS os `.lua` do `config/stplug-in`.
///
/// O worker le as chaves do mesmo lugar (`OstKeyProvider` varre todos os luas):
/// depot compartilhado — os redistribuiveis do app 228980 — pode vir com a
/// chave no `.lua` de outro jogo que tambem o lista. A ordem dos arquivos nao
/// importa porque a chave de um depot e unica por natureza.
fn stplug_in_depot_keys(steam_path: &str) -> HashMap<u32, String> {
    let mut keys = HashMap::new();
    let Ok(entries) = std::fs::read_dir(Path::new(steam_path).join("config").join("stplug-in"))
    else {
        return keys;
    };

    let mut lua_paths: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("lua"))
        })
        .collect();
    lua_paths.sort();

    for path in lua_paths {
        let Ok(contents) = std::fs::read_to_string(&path) else {
            continue;
        };
        for (depot_id, key) in crate::manifest_sources::parse_add_app_id_keys(&contents) {
            keys.entry(depot_id).or_insert(key);
        }
    }
    keys
}

/// Manifests que valem ser buscados nas fontes de pacote, por depot.
///
/// Busca-se o gid publico quando o PICS o conhece — mesmo que haja um manifest
/// velho em disco, porque baixar a build atual e melhor do que dezenas de GB
/// atrasados. Sem PICS, so falta o que nao esta em disco.
fn manifest_fetch_targets(steam_path: &str, depots: &[ResolvedDepot]) -> Vec<(u32, u64)> {
    depots
        .iter()
        .filter(|depot| {
            let on_disk =
                depot_manifest_path(steam_path, depot.depot_id, depot.manifest_id).is_file();
            match depot.public_gid {
                Some(public_gid) => depot.manifest_id != public_gid || !on_disk,
                None => !on_disk,
            }
        })
        .map(|depot| {
            (
                depot.depot_id,
                depot.public_gid.unwrap_or(depot.manifest_id),
            )
        })
        .collect()
}

/// Troca o manifest resolvido de cada depot pelo que chegou das fontes.
///
/// O manifest buscado e sempre o alvo de `manifest_fetch_targets` (publico
/// quando conhecido); quando ele e o publico, o depot passa a ser `current` e o
/// aviso de build velha some junto.
fn apply_fetched_manifests(
    depots: &mut [ResolvedDepot],
    fetched: &std::collections::BTreeMap<u32, crate::manifest_sources::FetchedManifest>,
) {
    for depot in depots.iter_mut() {
        let Some(manifest) = fetched.get(&depot.depot_id) else {
            continue;
        };
        depot.manifest_id = manifest.manifest_id;
        if Some(manifest.manifest_id) == depot.public_gid {
            depot.tier = DepotTier::PublicFromPackage;
        }
    }
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
        let worker_guard = download_worker()
            .lock()
            .map_err(|error| error.to_string())?;
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

    spawn_cancel_watchdog(app_id);

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
/// Normaliza a raiz de downloads quando ela já vive dentro de uma Steam Library.
///
/// O layout do GhostBox é `<raiz>\steamapps\common\<jogo>`. Quando a raiz
/// escolhida já é `X\steamapps` ou `X\steamapps\common` — tipicamente a
/// biblioteca oficial, ex. `E:\SteamLibrary\steamapps\common` — anexar de novo
/// criava `...\steamapps\common\steamapps\common\<jogo>`, estrutura que a Steam
/// nunca escaneia, e o jogo ficava eternamente "instalável". A raiz vira `X`:
/// os arquivos caem exatamente onde a biblioteca oficial já os espera.
pub(crate) fn normalize_library_root(raw: &Path) -> PathBuf {
    let mut parts: Vec<std::ffi::OsString> = raw
        .components()
        .map(|component| component.as_os_str().to_os_string())
        .collect();
    while parts.len() >= 2 {
        let last = parts[parts.len() - 1].to_string_lossy().to_lowercase();
        let previous = parts[parts.len() - 2].to_string_lossy().to_lowercase();
        if last == "common" && previous == "steamapps" {
            parts.pop();
            parts.pop();
        } else if last == "steamapps" {
            parts.pop();
        } else {
            break;
        }
    }
    parts.iter().collect::<PathBuf>()
}

/// Sobe para a biblioteca de verdade uma instalação criada com a raiz aninhada.
///
/// Downloads feitos antes da normalização, com raiz tipo
/// `E:\SteamLibrary\steamapps\common`, geraram `steamapps\` DENTRO do `common`
/// da biblioteca oficial — ACF, jogos e depotcache num lugar que a Steam nunca
/// lê. Esta rotina move cada peça (best-effort, sem sobrescrever nada que já
/// exista no destino) e devolve quantos itens moveram.
fn migrate_nested_library(raw_root: &Path, library_root: &Path) -> usize {
    if raw_root == library_root {
        return 0;
    }
    let nested_steamapps = raw_root.join("steamapps");
    if !nested_steamapps.is_dir() {
        return 0;
    }
    let real_steamapps = crate::steam_appmanifest::steamapps_dir(library_root);
    if std::fs::create_dir_all(&real_steamapps).is_err() {
        return 0;
    }
    let mut moved = 0usize;

    // 1. ACFs: sem eles não há nada para o Steam reconhecer.
    if let Ok(entries) = std::fs::read_dir(&nested_steamapps) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if !name.starts_with("appmanifest_") || !name.ends_with(".acf") {
                continue;
            }
            let target = real_steamapps.join(entry.file_name());
            if target.exists() {
                continue;
            }
            if std::fs::rename(entry.path(), &target).is_ok() {
                moved += 1;
            }
        }
    }

    // 2. Os jogos: `<aninhado>\common\<jogo>` -> `<biblioteca>\steamapps\common\<jogo>`.
    let nested_common = nested_steamapps.join("common");
    if nested_common.is_dir() {
        let real_common = real_steamapps.join("common");
        if std::fs::create_dir_all(&real_common).is_ok() {
            if let Ok(entries) = std::fs::read_dir(&nested_common) {
                for entry in entries.flatten() {
                    let target = real_common.join(entry.file_name());
                    if target.exists() {
                        continue;
                    }
                    if move_dir_best_effort(&entry.path(), &target) {
                        moved += 1;
                    }
                }
            }
        }
    }

    // 3. depotcache: sem os manifestos, um "Verify Integrity" re-baixaria tudo.
    let nested_depotcache = nested_steamapps.join("depotcache");
    if nested_depotcache.is_dir() {
        let real_depotcache = real_steamapps.join("depotcache");
        if std::fs::create_dir_all(&real_depotcache).is_ok() {
            if let Ok(entries) = std::fs::read_dir(&nested_depotcache) {
                for entry in entries.flatten() {
                    let target = real_depotcache.join(entry.file_name());
                    if target.exists() {
                        continue;
                    }
                    if std::fs::rename(entry.path(), &target).is_ok() {
                        moved += 1;
                    }
                }
            }
        }
    }

    // 4. Stash de chunks da raiz antiga, se a nova não tiver um ainda.
    let nested_stash = raw_root.join(crate::chunk_index::STASH_DIR_NAME);
    let real_stash = library_root.join(crate::chunk_index::STASH_DIR_NAME);
    if nested_stash.is_dir()
        && !real_stash.exists()
        && move_dir_best_effort(&nested_stash, &real_stash)
    {
        moved += 1;
    }

    // 5. Casco vazio da estrutura aninhada, best-effort.
    let _ = std::fs::remove_dir(&nested_depotcache);
    let _ = std::fs::remove_dir(&nested_common);
    let _ = std::fs::remove_dir(&nested_steamapps);

    moved
}

/// Rename primeiro (mesmo volume, instantâneo); cruzando unidade, copia e apaga.
fn move_dir_best_effort(source: &Path, target: &Path) -> bool {
    if std::fs::rename(source, target).is_ok() {
        return true;
    }
    if copy_dir_recursive(source, target).is_ok() {
        let _ = std::fs::remove_dir_all(source);
        return true;
    }
    false
}

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
    // Emulador Goldberg/GSE: melhor esforço para suportar conquistas offline.
    // Falha aqui NÃO pode impedir o lançamento do jogo.
    if let Err(error) =
        crate::goldberg::prepare_game_for_offline_launch(&canonical_executable, app_id)
    {
        eprintln!("Goldberg setup skipped: {error}");
    }
    let mut launch_command = {
        let mut command = std::process::Command::new(&canonical_executable);
        command.current_dir(working_dir);
        for (key, value) in crate::goldberg::process_env_vars(app_id) {
            command.env(key, value);
        }
        command
    };
    launch_command
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
    if app_id.parse::<u32>().ok().filter(|id| *id > 0).is_none() || downloads_root.is_empty() {
        return Err("Download removal requires an app ID and a downloads root.".to_string());
    }

    // Remover uma instalação não autoriza apagar saves/conquistas do usuário.

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
    // A raiz e normalizada porque instalacoes antigas podem guardar saida no
    // caminho aninhado — que fica DENTRO da raiz normalizada, então a contencao
    // continua valendo.
    let canonical_root = normalize_library_root(root_path)
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
    let canonical_output = output_path
        .canonicalize()
        .map_err(|error| error.to_string())?;
    ensure_inside_downloads_root(&canonical_root, &canonical_output)?;

    // Contenção sozinha permitiria apagar `steamapps` ou `common` inteiros a
    // partir de uma tarefa antiga/corrompida. Só aceitamos UMA instalação.
    let common = canonical_root.join("steamapps").join("common").canonicalize().ok();
    let legacy = canonical_root.join(app_id).canonicalize().ok();
    let is_installation = common.as_deref().is_some_and(|path| canonical_output.parent() == Some(path))
        || legacy.as_deref() == Some(canonical_output.as_path());
    if !is_installation {
        return Err("Download removal requires a single game installation directory.".to_string());
    }

    std::fs::remove_dir_all(&canonical_output).map_err(|error| error.to_string())?;
    // Sem os arquivos, o ACF apontaria para uma instalacao inexistente e o Steam
    // mostraria o jogo instalado ate a proxima verificacao.
    let _ = crate::steam_appmanifest::remove_appmanifest(&canonical_root, app_id);
    // O indice descreve chunks que nao existem mais; guardado, so acumularia.
    crate::chunk_index::remove_app_stash(&canonical_root, app_id);
    Ok(true)
}

// ————————————————————————————————————————————————————————————————
// Manutenção de raízes de downloads (chamada no boot pelo frontend).
//
// Dois resíduos só existem fora do fluxo normal e por isso escapam dele:
// - `.ghostbox-chunks.json.tmp` órfão quando o processo morre no meio do
//   rename atômico do índice (o cleanup normal roda no fim do depot);
// - `appmanifest_<appid>.acf` apontando para pasta que o usuário apagou
//   manualmente no Explorer — a Steam continuaria exibindo o jogo.
// ————————————————————————————————————————————————————————————————

const CHUNK_TEMP_FILE_NAME: &str = ".ghostbox-chunks.json.tmp";
const SWEEP_STALE_AFTER_SECS: u64 = 24 * 60 * 60;
/// Profundidade máxima da varredura: `<root>\steamapps\common\<jogo>\sub\…`.
const SWEEP_MAX_DEPTH: u8 = 6;

fn sweep_chunks_temp_files(dir: &Path, depth: u8, cutoff: SystemTime) -> usize {
    if depth > SWEEP_MAX_DEPTH {
        return 0;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries.flatten().fold(0usize, |mut total, entry| {
        let path = entry.path();
        if path.is_dir() {
            total += sweep_chunks_temp_files(&path, depth + 1, cutoff);
        } else if path.file_name().and_then(|name| name.to_str()) == Some(CHUNK_TEMP_FILE_NAME) {
            let stale = entry
                .metadata()
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .is_some_and(|modified| modified <= cutoff);
            if stale && std::fs::remove_file(&path).is_ok() {
                total += 1;
            }
        }
        total
    })
}

/// Remove ACFs cujo `installdir` desapareceu da pasta `common`. ACF malformado
/// (sem installdir legível) é intocado — não é nosso e não sabemos julgá-lo.
fn sweep_orphan_appmanifests(root: &Path) -> Vec<String> {
    let steamapps = crate::steam_appmanifest::steamapps_dir(root);
    let common = steamapps.join("common");
    let Ok(entries) = std::fs::read_dir(&steamapps) else {
        return Vec::new();
    };

    entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            let app_id = name
                .strip_prefix("appmanifest_")?
                .strip_suffix(".acf")?
                .to_string();
            if app_id.is_empty() || !app_id.chars().all(|character| character.is_ascii_digit()) {
                return None;
            }
            let contents = std::fs::read_to_string(entry.path()).ok()?;
            let install_dir = contents
                .lines()
                .find_map(|line| crate::steam::parse_vdf_string_value(line, "installdir"))
                .unwrap_or_default();
            if install_dir.trim().is_empty() || common.join(&install_dir).is_dir() {
                return None;
            }
            // Sem pasta, o stash de chunks descreve arquivos inexistentes.
            crate::chunk_index::remove_app_stash(root, &app_id);
            match crate::steam_appmanifest::remove_appmanifest(root, &app_id) {
                Ok(true) => Some(app_id),
                _ => None,
            }
        })
        .collect()
}

pub(crate) fn sweep_downloads_root(root: &Path, cutoff: SystemTime) -> (usize, Vec<String>) {
    if !root.is_dir() {
        return (0, Vec::new());
    }
    let removed_chunk_temps = sweep_chunks_temp_files(root, 0, cutoff);
    let removed_orphan_acfs = sweep_orphan_appmanifests(root);
    (removed_chunk_temps, removed_orphan_acfs)
}

/// Varre as raízes de downloads conhecidas removendo temporários órfãos e ACFs
/// de jogos apagados manualmente. As raízes vêm do frontend (localStorage); a
/// raiz default do app entra sempre. Best-effort em cada raiz.
#[tauri::command]
pub fn cdndownload_sweep_roots(app: tauri::AppHandle, roots: Vec<String>) -> serde_json::Value {
    use tauri::Manager;

    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(SWEEP_STALE_AFTER_SECS))
        .unwrap_or(SystemTime::UNIX_EPOCH);

    let mut unique_roots: Vec<PathBuf> = Vec::new();
    for raw in roots {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let candidate = PathBuf::from(trimmed);
        if !unique_roots.contains(&candidate) {
            unique_roots.push(candidate);
        }
    }
    if let Ok(default_downloads) = app.path().app_data_dir().map(|dir| dir.join("downloads")) {
        if !unique_roots.contains(&default_downloads) {
            unique_roots.push(default_downloads);
        }
    }

    let mut removed_chunk_temps = 0usize;
    let mut removed_orphan_acfs: Vec<String> = Vec::new();
    for root in &unique_roots {
        let (temps, acfs) = sweep_downloads_root(root, cutoff);
        removed_chunk_temps += temps;
        for app_id in acfs {
            if !removed_orphan_acfs.contains(&app_id) {
                removed_orphan_acfs.push(app_id);
            }
        }
    }

    serde_json::json!({
        "removedChunkTemps": removed_chunk_temps,
        "removedOrphanAcfs": removed_orphan_acfs,
    })
}

/// Re-registra um download concluido na biblioteca Steam — o reparo automatico
/// do status "library-not-registered". O ACF ja esta em disco em
/// `<root>\steamapps`; aqui so falta a entrada em `libraryfolders.vdf`, que a
/// Steam pode ter descartado se saiu depois de uma escrita com o cliente aberto.
/// Idempotente: registro ja valido e um no-op sem escrita.
#[tauri::command]
pub fn cdndownload_register_library(
    app: tauri::AppHandle,
    app_id: String,
    downloads_root: String,
    steam_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let app_id = app_id.trim().to_string();
    let downloads_root = downloads_root.trim();
    if app_id.is_empty() || downloads_root.is_empty() {
        return Err("Library registration requires an app ID and a downloads root.".to_string());
    }

    let steam_path = match steam_path {
        Some(path) if !path.trim().is_empty() => path,
        _ => crate::resolve_steam_path(&app, None).0.ok_or_else(|| {
            "Steam path not found. Configure Steam path in Library settings.".to_string()
        })?,
    };

    // A raiz pode estar aninhada dentro de uma biblioteca oficial (downloads
    // antigos). Migra ACF/jogos/depotcache do `steamapps` aninhado para a
    // biblioteca de verdade antes de registrar — sem isto o Steam nunca lê.
    let raw_root = PathBuf::from(downloads_root.trim_end_matches(['\\', '/']));
    let library_root = normalize_library_root(&raw_root);
    migrate_nested_library(&raw_root, &library_root);

    if !crate::steam_appmanifest::appmanifest_path(&library_root, &app_id).is_file() {
        return Err(format!(
            "appmanifest_{app_id}.acf não existe em {} — o download não deixou uma instalação registrável.",
            crate::steam_appmanifest::steamapps_dir(&library_root).display()
        ));
    }

    let size_on_disk = crate::steam_appmanifest::read_size_on_disk(&library_root, &app_id);
    crate::steam_appmanifest::register_library_folder(
        &steam_path,
        &library_root,
        &app_id,
        size_on_disk,
    )?;

    // A tarefa no front-end guarda a raiz como o usuário digitou; devolve o
    // lugar de verdade para o histórico apontar para a instalação migrada.
    let install_dir = crate::steam_appmanifest::read_install_dir(&library_root, &app_id);
    Ok(serde_json::json!({
        "Status": "ok",
        "RequiresSteamRestart": crate::steam::steam_is_running(),
        "DownloadsRoot": library_root.to_string_lossy(),
        "OutputDir": crate::steam_appmanifest::install_dir_path(
            &library_root,
            &install_dir,
        ).to_string_lossy(),
    }))
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

    let old_root = normalize_library_root(Path::new(old_root_str));
    let new_root = normalize_library_root(Path::new(new_root_str));
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

fn install_library_for_app(steam_path: &str, app_id: &str) -> PathBuf {
    crate::steam::read_steam_library_paths(steam_path)
        .into_iter()
        .map(PathBuf::from)
        .find(|library| crate::steam_appmanifest::appmanifest_path(library, app_id).is_file())
        .unwrap_or_else(|| {
            PathBuf::from(crate::steam::resolve_default_install_library(steam_path))
        })
}

/// Resolve o `installdir` efetivo e, quando o ACF pendente diverge do canônico,
/// devolve a pasta menor para limpeza segura.
///
/// Tentativas com e sem `appinfo.vdf` em cache resolviam nomes diferentes (ex.
/// título de catálogo com mojibake `DARK SOULSõo_REMASTER` vs `installdir` real
/// `DARK SOULS REMASTER`), e cada uma criava sua pasta — a retentativa então
/// falhava ou a Steam montava a pasta errada. Regra: **fica a que tem mais
/// bytes**; a menor só é removida se for bootstrap parcial nosso (sem `.exe`,
/// com o índice `.ghostbox-chunks.json`), nunca um jogo real da Steam.
fn resolve_effective_install_dir(
    library_root: &Path,
    app_id: &str,
    app_info: Option<&crate::steam_appinfo::AppInfo>,
    fallback_title: &str,
) -> (String, Option<PathBuf>) {
    let canonical = crate::steam_appinfo::resolve_install_dir(app_info, fallback_title, app_id);
    let pending = crate::steam_appmanifest::read_install_dir(library_root, app_id);
    if pending.trim().is_empty() || pending == canonical {
        return (canonical, None);
    }
    let pending_path = crate::steam_appmanifest::install_dir_path(library_root, &pending);
    let canonical_path = crate::steam_appmanifest::install_dir_path(library_root, &canonical);
    let pending_exists = pending_path.is_dir();
    let canonical_exists = canonical_path.is_dir();
    // Só existe uma (ou nenhuma): usa a existente, sem criar a segunda pasta.
    if pending_exists && !canonical_exists {
        return (pending, None);
    }
    if canonical_exists && !pending_exists {
        return (canonical, None);
    }
    if !pending_exists && !canonical_exists {
        // Nenhuma existe ainda: prefere o canônico (ASCII determinístico) para
        // não perpetuar nome com mojibake do ACF pendente.
        return (canonical, None);
    }
    // Ambas existem: fica a que tem mais bytes em disco.
    let pending_size = crate::steam_appmanifest::installed_size_on_disk(library_root, &pending);
    let canonical_size =
        crate::steam_appmanifest::installed_size_on_disk(library_root, &canonical);
    if pending_size >= canonical_size {
        let orphan = if is_safe_bootstrap_orphan(&canonical_path) {
            Some(canonical_path)
        } else {
            None
        };
        (pending, orphan)
    } else {
        let orphan = if is_safe_bootstrap_orphan(&pending_path) {
            Some(pending_path)
        } else {
            None
        };
        (canonical, orphan)
    }
}

/// Pasta só é órfã removível se for claramente bootstrap parcial nosso: tem o
/// índice de chunks do worker e nenhum executável. Qualquer pasta com `.exe`
/// pode ser jogo real — nunca apagar, só deixar de lado.
fn is_safe_bootstrap_orphan(dir: &Path) -> bool {
    dir.join(".ghostbox-chunks.json").is_file() && !orphan_dir_has_executable(dir)
}

fn orphan_dir_has_executable(dir: &Path) -> bool {
    fn scan(directory: &Path, depth: u32) -> bool {
        if depth > 3 {
            return false;
        }
        let Ok(entries) = std::fs::read_dir(directory) else {
            return false;
        };
        let mut subdirectories = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // Nosso stash de índices não conta como conteúdo real.
                if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
                    if name == ".ghostbox" {
                        continue;
                    }
                }
                subdirectories.push(path);
            } else if path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
            {
                return true;
            }
        }
        subdirectories.into_iter().any(|path| scan(&path, depth + 1))
    }
    scan(dir, 0)
}

#[tauri::command]
pub async fn cdndownload_download_game(
    app: tauri::AppHandle,
    app_id: String,
    downloads_root: String,
    game_title: Option<String>,
    steam_path: Option<String>,
    allow_stale: Option<bool>,
    full_download: Option<bool>,
) -> Result<serde_json::Value, String> {
    let _download_gate = DOWNLOAD_GATE
        .try_lock()
        .map_err(|_| "Outro download ainda está em execução. Aguarde o encerramento.".to_string())?;
    if app_id.parse::<u32>().ok().filter(|id| *id > 0).is_none() {
        return Err("AppID inválido.".to_string());
    }
    if !Path::new(downloads_root.trim()).is_absolute() {
        return Err("Escolha uma pasta de downloads absoluta.".to_string());
    }
    let _ = take_download_cancelled(&app_id);
    let _active_guard = ActiveDownloadGuard(app_id.clone());
    let full_download = full_download.unwrap_or(false);
    let parallel_chunks = MAX_PARALLEL_CHUNKS;
    let steam_path = match steam_path {
        Some(path) => path,
        None => crate::resolve_steam_path(&app, None).0.ok_or_else(|| {
            "Steam path not found. Configure Steam path in Library settings.".to_string()
        })?,
    };

    let public = crate::steam_pics::resolve_public_app(&steam_path, &app_id).await;
    let mut resolved_depots = resolve_depots(&steam_path, &app_id, public.as_ref());

    // Depot sem chave em nenhum `.lua` do stplug-in nao tem como ser
    // descriptografado: sao os redistribuiveis compartilhados (ex.: depots do
    // app 228980) que os pacotes listam com `setManifestid` mas sem `addappid`
    // com chave. Antes eles derrubavam o download inteiro no worker
    // (`no-depot-key` / manifest ausente); agora saem do plano com aviso — o
    // jogo roda sem os instaladores que eles carregam.
    let depot_keys = stplug_in_depot_keys(&steam_path);
    let (keyed_depots, keyless_depots): (Vec<_>, Vec<_>) = resolved_depots
        .into_iter()
        .partition(|depot| depot_keys.contains_key(&depot.depot_id));
    resolved_depots = keyed_depots;
    if !keyless_depots.is_empty() {
        app.emit(
            "download-progress",
            serde_json::json!({
                "Type": "status",
                "Status": "skipped-keyless-depots",
                "AppId": app_id,
                "Depots": keyless_depots
                    .iter()
                    .map(|depot| depot.depot_id)
                    .collect::<Vec<_>>(),
            }),
        )
        .ok();
    }

    if resolved_depots.is_empty() {
        return Ok(serde_json::json!({
            "Type": "error",
            "Status": "no-depots",
            "Message": format!("No depots with a depot key were found for app {app_id} in the OST Lua files.")
        }));
    }

    // Manifest que falta em disco — ou cujo publico e mais novo que o de disco —
    // sai das mesmas fontes de pacote do fluxo de adicao. Sem isto, jogo
    // adicionado por fonte raw-lua (SteamTools, ManifestHub), que nao embute
    // `.manifest` nenhum, morria no `inspectDepot` com `FileNotFoundException`.
    let fetch_targets = manifest_fetch_targets(&steam_path, &resolved_depots);
    let mut fetch_errors: Vec<String> = Vec::new();
    if !fetch_targets.is_empty() {
        app.emit(
            "download-progress",
            serde_json::json!({
                "Type": "status",
                "Status": "fetching-manifests",
                "AppId": app_id,
                "Depots": fetch_targets.iter().map(|(depot_id, _)| depot_id).collect::<Vec<_>>(),
            }),
        )
        .ok();

        match crate::manifest_sources::fetch_manifest_files(
            &app_id,
            &fetch_targets,
            public.as_ref(),
        )
        .await
        {
            Ok((fetched, errors)) => {
                fetch_errors = errors;
                let mut installed: Vec<String> = Vec::new();
                let mut installed_manifests = std::collections::BTreeMap::new();
                for (depot_id, manifest) in fetched {
                    // Uma alternativa antiga do pacote não substitui um manifest
                    // já disponível em disco. A versão pública sempre tem prioridade.
                    if resolved_depots.iter().any(|depot| {
                        depot.depot_id == depot_id
                            && depot.public_gid != Some(manifest.manifest_id)
                            && depot_manifest_path(&steam_path, depot_id, depot.manifest_id).is_file()
                    }) {
                        continue;
                    }
                    let path = depot_manifest_path(&steam_path, depot_id, manifest.manifest_id);
                    if let Some(parent) = path.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    match std::fs::write(&path, &manifest.bytes) {
                        Ok(()) => {
                            installed.push(format!("{depot_id}_{}.manifest", manifest.manifest_id));
                            installed_manifests.insert(depot_id, manifest);
                        }
                        Err(error) => {
                            fetch_errors.push(format!("depot {depot_id}: {error}"));
                        }
                    }
                }
                apply_fetched_manifests(&mut resolved_depots, &installed_manifests);
                app.emit(
                    "download-progress",
                    serde_json::json!({
                        "Type": "status",
                        "Status": "manifests-fetched",
                        "AppId": app_id,
                        "Fetched": installed,
                        "Errors": fetch_errors,
                    }),
                )
                .ok();
            }
            Err(error) => {
                fetch_errors.push(error);
                app.emit(
                    "download-progress",
                    serde_json::json!({
                        "Type": "status",
                        "Status": "manifest-fetch-failed",
                        "AppId": app_id,
                        "Errors": fetch_errors,
                    }),
                )
                .ok();
            }
        }
    }

    // Depots sem manifest em disco depois da busca: ou o download falhava no
    // worker com um `FileNotFoundException` criptico, ou ficava pendurado
    // esperando evento que nao vinha. Melhor recusar aqui, com o diagnostico.
    let missing_manifests: Vec<u32> = resolved_depots
        .iter()
        .filter(|depot| {
            !depot_manifest_path(&steam_path, depot.depot_id, depot.manifest_id).is_file()
        })
        .map(|depot| depot.depot_id)
        .collect();
    if !missing_manifests.is_empty() {
        let mut message = String::from(
            "O manifest destes depots nao foi encontrado no depotcache nem nas fontes \
             de pacotes: ",
        );
        message.push_str(
            &missing_manifests
                .iter()
                .map(u32::to_string)
                .collect::<Vec<_>>()
                .join(", "),
        );
        message.push_str(
            ". Abra a Steam com o jogo adicionado para que ela baixe o manifest, \
             ou tente novamente mais tarde.",
        );
        if !fetch_errors.is_empty() {
            message.push_str(&format!(" Fontes: {}", fetch_errors.join("; ")));
        }
        return Ok(serde_json::json!({
            "Type": "error",
            "Status": "manifest-unavailable",
            "AppId": app_id,
            "Depots": missing_manifests,
            "Message": message,
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
                "O manifest mais novo disponivel em disco e anterior a build publica, \
                 e as fontes de pacote nao devolveram a build atual. Tente novamente \
                 mais tarde, ou confirme para baixar a build antiga mesmo assim."
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
    // Raiz dentro de uma biblioteca oficial e desfeita antes de montar o caminho.
    let library_root =
        normalize_library_root(&PathBuf::from(downloads_root.trim_end_matches(['\\', '/'])));
    let app_info = crate::steam_appinfo::read_app_info(&steam_path, &app_id);
    // Quando o ACF pendente diverge do canônico (ex. mojibake de uma tentativa
    // sem appinfo em cache), fica a pasta com mais bytes; a menor só volta
    // como órfã quando for bootstrap parcial nosso — nunca jogo real.
    let (install_dir, orphan_install_dir) = resolve_effective_install_dir(
        &library_root,
        &app_id,
        app_info.as_ref(),
        game_title.as_deref().unwrap_or_default(),
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
        let mut worker_guard = download_worker()
            .lock()
            .map_err(|error| error.to_string())?;
        let worker = ensure_download_worker(&app, &mut worker_guard)?;
        (
            worker.stdin.clone(),
            worker.stdout.clone(),
            worker.child.id(),
        )
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

        let manifest_path = depot_manifest_path(&steam_path, *depot_id, *manifest_id);
        if let Some(total_bytes) = cached_depot_size(&manifest_path) {
            depot_sizes.push(total_bytes);
            continue;
        }

        let mut worker_command = WorkerCommandGuard(true);
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

        let inspected = loop {
            let Some(value) = read_worker_event(&worker_stdout)? else {
                clear_active_download_process(&app_id);
                // O watchdog pode ter derrubado um worker travado no meio da
                // inspeção: com a flag presente, isto é um cancelamento.
                if take_download_cancelled(&app_id) {
                    return Ok(serde_json::json!({
                        "Type": "cancelled",
                        "Status": "cancelled",
                        "AppId": app_id,
                    }));
                }
                return Ok(serde_json::json!({
                    "Type": "error",
                    "Status": "worker-exited-during-inspection",
                    "Message": "steamkit worker exited while inspecting download manifests.",
                }));
            };
            match value.get("Type").and_then(|event_type| event_type.as_str()) {
                Some("depot-inspected") => {
                    worker_command.0 = false;
                    break value;
                }
                Some("error") | Some("cancelled") => {
                    worker_command.0 = false;
                    clear_active_download_process(&app_id);
                    return Ok(value);
                }
                _ => {
                    let _ = app.emit("download-progress", value);
                }
            }
        };
        let total_bytes = inspected
            .get("TotalBytes")
            .and_then(|value| value.as_u64())
            .unwrap_or(0);
        store_depot_size(&manifest_path, total_bytes);
        depot_sizes.push(total_bytes);
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

    let mut bootstrap_downloaded_bytes = 0u64;
    let mut bootstrap_is_partial = false;

    // Execucao anterior pode ter morrido antes de recolher o indice de chunks.
    // Ele fica no `install_dir` sem dizer de qual depot e — mas o `ManifestId`
    // dentro do arquivo diz, e os pares vieram de `resolve_depots`.
    crate::chunk_index::adopt_orphan(&library_root, &install_path, &app_id, &depots);

    for (depot_index, ((depot_id, manifest_id), depot_size)) in
        depots.iter().zip(depot_sizes.iter()).enumerate()
    {
        let byte_budget = download_byte_budget(full_download, bootstrap_downloaded_bytes);
        if byte_budget == Some(0) {
            bootstrap_is_partial = true;
            break;
        }
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
                "DepotIndex": depot_index + 1,
                "DepotTotal": depots.len(),
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
            "MaxDownloadBytes": byte_budget.unwrap_or(0),
            "MaxFileOvershootBytes": STEAM_BOOTSTRAP_OVERSHOOT_BYTES,
        });
        let mut worker_command = WorkerCommandGuard(true);
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

            value["AppId"] = serde_json::json!(app_id);
            value["DepotIndex"] = serde_json::json!(depot_index + 1);
            value["DepotTotal"] = serde_json::json!(depots.len());
            // O DTO do worker serializa TotalBytes=0 em status/cancelamento.
            // A partir do plano, todos os eventos carregam o total do JOGO.
            value["TotalBytes"] = serde_json::json!(total_download_bytes);
            if let Some(written) = value.get("BytesWritten").and_then(|bytes| bytes.as_u64()) {
                value["BytesWritten"] = serde_json::json!(bootstrap_downloaded_bytes.saturating_add(written));
            }

            if event_type == "progress" {
                let current_depot_bytes = value
                    .get("BytesDownloaded")
                    .and_then(|bytes| bytes.as_u64())
                    .unwrap_or(0);
                value["BytesDownloaded"] =
                    serde_json::json!(bootstrap_downloaded_bytes + current_depot_bytes);
                value["BytesTotal"] = serde_json::json!(total_download_bytes);
            } else if event_type == "status"
                && value.get("Status").and_then(|status| status.as_str()) == Some("manifest-loaded")
            {
                value["TotalBytes"] = serde_json::json!(total_download_bytes);
            }

            let _ = app.emit("download-progress", value.clone());
            if matches!(
                event_type.as_str(),
                "complete" | "partial-complete" | "error" | "cancelled"
            ) {
                worker_command.0 = false;
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

        let event_type = depot_result
            .get("Type")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        if event_type == "cancelled" {
            return Ok(serde_json::json!({ "Type": "cancelled", "AppId": app_id, "TotalBytes": total_download_bytes }));
        }
        let failed = depot_failed(&depot_result);
        bootstrap_downloaded_bytes = bootstrap_downloaded_bytes.saturating_add(
            depot_result
                .get("DownloadedBytes")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(*depot_size),
        );
        bootstrap_is_partial |= event_type == "partial-complete";
        all_results.push(depot_result);
        if bootstrap_is_partial || failed {
            break;
        }
    }

    clear_active_download_process(&app_id);

    // Um depot que falhou deixa a instalacao incompleta. Escrever o ACF aqui
    // faria o Steam anunciar "fully installed" sobre arquivos faltando.
    let any_depot_failed = all_results
        .iter()
        .any(depot_failed);

    bootstrap_is_partial |= all_results.len() < depots.len();

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
            bootstrap_is_partial.then_some((bootstrap_downloaded_bytes, total_download_bytes)),
        )
    };

    // A pasta perdedora da reconciliação sai de cena quando o ACF foi escrito
    // para a vencedora — best-effort e só se for bootstrap parcial nosso (sem
    // `.exe`), nunca um jogo real. Sem ACF válido, mantém tudo para retry.
    let integration_ok = steam_integration
        .get("Status")
        .and_then(serde_json::Value::as_str)
        == Some("ok");
    if integration_ok {
        if let Some(orphan) = orphan_install_dir {
            let _ = std::fs::remove_dir_all(&orphan);
        }
    }

    Ok(serde_json::json!({
        "Type": if any_depot_failed { "error" } else { "complete" },
        "Message": if any_depot_failed { "Um ou mais arquivos falharam. Tente retomar o download." } else { "" },
        "Depots": all_results,
        "DepotCount": all_results.len(),
        "InstallDir": install_dir,
        "OutputDir": install_path_text,
        "BootstrapBytes": bootstrap_downloaded_bytes,
        "Partial": bootstrap_is_partial,
        "TotalBytes": total_download_bytes,
        "BytesWritten": if !any_depot_failed && !bootstrap_is_partial { Some(total_download_bytes) } else { None },
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
    partial_progress: Option<(u64, u64)>,
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
    let size_on_disk = partial_progress
        .map(|(downloaded, _)| downloaded)
        .unwrap_or_else(|| {
            crate::steam_appmanifest::installed_size_on_disk(library_root, install_dir)
        });
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

    let manifest_result = match partial_progress {
        Some((downloaded, total)) => crate::steam_appmanifest::write_partial_appmanifest(
            library_root,
            app_id,
            name,
            install_dir,
            build_id,
            &installed_depots,
            downloaded,
            total,
            &last_owner,
        ),
        None => crate::steam_appmanifest::write_appmanifest(
            library_root,
            app_id,
            name,
            install_dir,
            build_id,
            &installed_depots,
            size_on_disk,
            &last_owner,
        ),
    };
    let manifest_path = match manifest_result {
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
        "Partial": partial_progress.is_some(),
        "BootstrapBytes": partial_progress.map(|(downloaded, _)| downloaded).unwrap_or(size_on_disk),
        "TotalBytes": partial_progress.map(|(_, total)| total).unwrap_or(size_on_disk),
        // Com a Steam aberta ela pode reescrever libraryfolders.vdf ao sair e
        // descartar a entrada — o reparo (`cdndownload_register_library`)
        // reaplica ate o registro ficar.
        "RequiresSteamRestart": crate::steam::steam_is_running(),
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn native_download_has_no_bootstrap_limit() {
        assert_eq!(super::download_byte_budget(true, 0), None);
        assert_eq!(super::download_byte_budget(true, 100 * 1024 * 1024), None);
        assert_eq!(super::download_byte_budget(false, 0), Some(super::STEAM_BOOTSTRAP_BYTES));
        assert_eq!(super::download_byte_budget(false, super::STEAM_BOOTSTRAP_BYTES), Some(0));
    }

    #[test]
    fn failed_files_prevent_installation_completion() {
        assert!(super::depot_failed(&serde_json::json!({ "Type": "error" })));
        assert!(super::depot_failed(&serde_json::json!({ "Type": "complete", "FailedFiles": 1 })));
        assert!(!super::depot_failed(&serde_json::json!({ "Type": "complete", "FailedFiles": 0 })));
    }

    #[test]
    fn deletion_refuses_library_containers_and_only_removes_one_installation() {
        let root = temp_root("single-install-removal");
        let install = make_game_dir(&root, "Target", 8, true);
        let neighbor = make_game_dir(&root, "Keep", 8, true);
        let root_text = root.to_string_lossy().into_owned();
        assert!(super::delete_output_dir_blocking("10", &root_text, &root.join("steamapps").to_string_lossy()).is_err());
        assert!(super::delete_output_dir_blocking("10", &root_text, &root.join("steamapps/common").to_string_lossy()).is_err());
        assert!(install.exists());
        assert!(super::delete_output_dir_blocking("10", &root_text, &install.to_string_lossy()).unwrap());
        assert!(!install.exists());
        assert!(neighbor.exists());
        let _ = std::fs::remove_dir_all(root);
    }

    use super::{
        cached_depot_size, ensure_inside_downloads_root, install_library_for_app,
        is_safe_bootstrap_orphan, migrate_nested_library, normalize_library_root,
        resolve_effective_install_dir, store_depot_size,
    };
    use std::path::{Path, PathBuf};

    fn write_pending_acf(library: &Path, app_id: &str, install_dir: &str) {
        let steamapps = library.join("steamapps");
        std::fs::create_dir_all(&steamapps).unwrap();
        std::fs::write(
            steamapps.join(format!("appmanifest_{app_id}.acf")),
            format!("\"AppState\"\n{{\n\t\"appid\"\t\t\"{app_id}\"\n\t\"installdir\"\t\t\"{install_dir}\"\n}}\n"),
        )
        .unwrap();
    }

    fn make_game_dir(library: &Path, install_dir: &str, bytes: usize, with_exe: bool) -> PathBuf {
        let dir = library.join("steamapps").join("common").join(install_dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("data.bin"), vec![0xABu8; bytes]).unwrap();
        if with_exe {
            std::fs::write(dir.join("game.exe"), b"fake").unwrap();
        }
        dir
    }

    fn temp_root(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "ghostbox-{tag}-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4().simple()
        ))
    }

    #[test]
    fn depot_size_cache_reuses_unchanged_manifests_and_invalidates_changes() {
        let root = temp_root("depot-size-cache");
        std::fs::create_dir_all(&root).unwrap();
        let manifest = root.join("123_456.manifest");
        std::fs::write(&manifest, b"manifest").unwrap();

        assert_eq!(cached_depot_size(&manifest), None);
        store_depot_size(&manifest, 72_600_000_000);
        assert_eq!(cached_depot_size(&manifest), Some(72_600_000_000));

        std::fs::write(&manifest, b"changed-manifest").unwrap();
        assert_eq!(cached_depot_size(&manifest), None);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn pending_appmanifest_selects_the_same_steam_library() {
        let root = temp_root("pending-library");
        let steam = root.join("Steam");
        let secondary = root.join("SteamLibrary");
        std::fs::create_dir_all(steam.join("steamapps")).unwrap();
        std::fs::create_dir_all(secondary.join("steamapps")).unwrap();
        let secondary_vdf = secondary.to_string_lossy().replace('\\', "\\\\");
        std::fs::write(
            steam.join("steamapps").join("libraryfolders.vdf"),
            format!(
                "\"libraryfolders\"\n{{\n\t\"1\"\n\t{{\n\t\t\"path\"\t\t\"{secondary_vdf}\"\n\t}}\n}}\n"
            ),
        )
        .unwrap();
        std::fs::write(
            secondary.join("steamapps").join("appmanifest_10.acf"),
            "\"AppState\"\n{\n\t\"appid\"\t\t\"10\"\n}\n",
        )
        .unwrap();

        assert_eq!(
            install_library_for_app(&steam.to_string_lossy(), "10"),
            secondary
        );
        // Sem ACF em nenhuma lib, cai na favorita (secundária), não na raiz
        // `C:\Program Files` — evita UAC e o `Pasta de instalacao nao encontrada`.
        assert_eq!(
            install_library_for_app(&steam.to_string_lossy(), "20"),
            secondary
        );
        std::fs::remove_dir_all(root).ok();
    }

    fn app_info_with_install_dir(install_dir: &str) -> crate::steam_appinfo::AppInfo {
        crate::steam_appinfo::AppInfo {
            install_dir: install_dir.to_string(),
            build_id: "1".to_string(),
            name: "Game".to_string(),
        }
    }

    #[test]
    fn effective_install_dir_prefers_appinfo_when_no_pending_acf() {
        let root = temp_root("eff-install-dir");
        let library = root.join("Lib");
        std::fs::create_dir_all(library.join("steamapps")).unwrap();
        let info = app_info_with_install_dir("DARK SOULS REMASTER");
        let (dir, orphan) =
            resolve_effective_install_dir(&library, "570940", Some(&info), "DARK SOULSõo REMASTER");
        assert_eq!(dir, "DARK SOULS REMASTER");
        assert!(orphan.is_none());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn effective_install_dir_reuses_existing_pending_folder() {
        let root = temp_root("eff-install-pending");
        let library = root.join("Lib");
        make_game_dir(&library, "Old Folder", 16, false);
        write_pending_acf(&library, "570940", "Old Folder");
        let info = app_info_with_install_dir("New Folder");
        let (dir, orphan) =
            resolve_effective_install_dir(&library, "570940", Some(&info), "New Folder");
        // Só a pendente existe: usa ela, sem criar segunda pasta.
        assert_eq!(dir, "Old Folder");
        assert!(orphan.is_none());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn effective_install_dir_keeps_the_larger_folder() {
        let root = temp_root("eff-install-larger");
        let library = root.join("Lib");
        // ACF pendente aponta para a pasta com mojibake (menor).
        make_game_dir(&library, "DARK SOULSoo_REMASTER", 16, false);
        std::fs::write(
            library
                .join("steamapps")
                .join("common")
                .join("DARK SOULSoo_REMASTER")
                .join(".ghostbox-chunks.json"),
            b"{}",
        )
        .unwrap();
        write_pending_acf(&library, "570940", "DARK SOULSoo_REMASTER");
        // Pasta canônica maior, com executável (jogo real).
        make_game_dir(&library, "DARK SOULS REMASTER", 4096, true);
        let info = app_info_with_install_dir("DARK SOULS REMASTER");
        let (dir, orphan) =
            resolve_effective_install_dir(&library, "570940", Some(&info), "Whatever");
        assert_eq!(dir, "DARK SOULS REMASTER");
        // A menor é bootstrap nosso: liberada para limpeza.
        assert!(orphan.is_some());

        // Cenário inverso: pendente maior vence.
        let root2 = temp_root("eff-install-larger2");
        let library2 = root2.join("Lib");
        make_game_dir(&library2, "Pending Big", 4096, false);
        write_pending_acf(&library2, "570940", "Pending Big");
        make_game_dir(&library2, "Canonical Small", 16, false);
        let info2 = app_info_with_install_dir("Canonical Small");
        let (dir2, orphan2) =
            resolve_effective_install_dir(&library2, "570940", Some(&info2), "Whatever");
        assert_eq!(dir2, "Pending Big");
        assert!(orphan2.is_none());
        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(root2);
    }

    #[test]
    fn bootstrap_orphan_never_covers_a_real_game() {
        let root = temp_root("eff-orphan");
        let real = make_game_dir(&root, "Real Game", 32, true);
        std::fs::write(real.join(".ghostbox-chunks.json"), b"{}").unwrap();
        // Mesmo com índice nosso, pasta com .exe não é removível.
        assert!(!is_safe_bootstrap_orphan(&real));
        let partial = make_game_dir(&root, "Partial", 32, false);
        std::fs::write(partial.join(".ghostbox-chunks.json"), b"{}").unwrap();
        assert!(is_safe_bootstrap_orphan(&partial));
        let plain = make_game_dir(&root, "Plain", 32, false);
        assert!(!is_safe_bootstrap_orphan(&plain));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn normalizes_a_root_inside_an_official_library() {        assert_eq!(
            normalize_library_root(Path::new("E:\\SteamLibrary\\steamapps\\common")),
            PathBuf::from("E:\\SteamLibrary")
        );
        assert_eq!(
            normalize_library_root(Path::new("E:\\SteamLibrary\\steamapps")),
            PathBuf::from("E:\\SteamLibrary")
        );
        // Case-insensitive e recorrente: aninhamento duplo some também.
        assert_eq!(
            normalize_library_root(Path::new("E:\\Lib\\SteamApps\\Common\\steamapps")),
            PathBuf::from("E:\\Lib")
        );
        // Raiz normal passa intocada.
        assert_eq!(
            normalize_library_root(Path::new("E:\\GhostBoxDownloads")),
            PathBuf::from("E:\\GhostBoxDownloads")
        );
    }

    #[test]
    fn migrates_a_nested_library_install_to_the_real_one() {
        let root = temp_root("migrate");
        let library = root.join("SteamLibrary");
        // Raiz antiga do usuário: o common da biblioteca oficial.
        let raw_root = library.join("steamapps").join("common");

        let nested_steamapps = raw_root.join("steamapps");
        let nested_game = nested_steamapps.join("common").join("Hollow Knight");
        std::fs::create_dir_all(&nested_game).unwrap();
        std::fs::write(nested_game.join("hollow_knight.exe"), b"fake").unwrap();
        crate::steam_appmanifest::write_appmanifest(
            &raw_root,
            "367520",
            "Hollow Knight",
            "Hollow Knight",
            "13214117",
            &[(367521, 8_912_243_411_281_072_000, 1_234)],
            9_999,
            "76561198000000000",
        )
        .unwrap();
        let nested_depotcache = nested_steamapps.join("depotcache");
        std::fs::create_dir_all(&nested_depotcache).unwrap();
        std::fs::write(nested_depotcache.join("367521_manifest.manifest"), b"fake").unwrap();
        let nested_stash = raw_root.join(".ghostbox");
        std::fs::create_dir_all(&nested_stash).unwrap();

        assert_eq!(migrate_nested_library(&raw_root, &library), 4);

        let real_steamapps = library.join("steamapps");
        assert!(real_steamapps.join("appmanifest_367520.acf").is_file());
        assert!(real_steamapps
            .join("common")
            .join("Hollow Knight")
            .join("hollow_knight.exe")
            .is_file());
        assert!(real_steamapps
            .join("depotcache")
            .join("367521_manifest.manifest")
            .is_file());
        assert!(library.join(".ghostbox").is_dir());
        // Casco aninhado saiu.
        assert!(!nested_steamapps.exists());

        // Sem nada a migrar na segunda passada.
        assert_eq!(migrate_nested_library(&raw_root, &library), 0);
    }

    /// Monta uma raiz fake com um `.tmp` de chunks órfão (antigo) e um recente,
    /// mais um ACF apontando para pasta que não existe e outro saudável.
    #[test]
    fn sweep_removes_stale_temps_and_orphan_acfs() {
        let root = std::env::temp_dir().join(format!(
            "ghostbox-sweep-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4().simple()
        ));
        let common = root.join("steamapps").join("common");
        let game_dir = common.join("Hollow Knight");
        std::fs::create_dir_all(&game_dir).unwrap();

        // Temporário antigo (>24h) e recente.
        let stale_cutoff = std::time::SystemTime::now()
            .checked_sub(std::time::Duration::from_secs(24 * 60 * 60))
            .unwrap();
        let stale_tmp = game_dir.join(".ghostbox-chunks.json.tmp");
        std::fs::write(&stale_tmp, b"{}").unwrap();
        {
            let file = std::fs::OpenOptions::new()
                .write(true)
                .open(&stale_tmp)
                .unwrap();
            file.set_modified(stale_cutoff - std::time::Duration::from_secs(60))
                .unwrap();
        }
        let fresh_tmp = game_dir.join("other").join(".ghostbox-chunks.json.tmp");
        std::fs::create_dir_all(fresh_tmp.parent().unwrap()).unwrap();
        std::fs::write(&fresh_tmp, b"{}").unwrap(); // mtime = agora

        // ACF órfão: installdir sem pasta em common/.
        std::fs::write(
            root.join("steamapps").join("appmanifest_999999.acf"),
            "\"AppState\"\n{\n\t\"installdir\"\t\t\"Jogo Apagado\"\n}\n",
        )
        .unwrap();
        // ACF saudável: pasta existe.
        std::fs::write(
            root.join("steamapps").join("appmanifest_367520.acf"),
            "\"AppState\"\n{\n\t\"installdir\"\t\t\"Hollow Knight\"\n}\n",
        )
        .unwrap();

        let (temps, orphans) = super::sweep_downloads_root(&root, stale_cutoff);

        assert_eq!(temps, 1, "apenas o .tmp antigo deve sair");
        assert!(fresh_tmp.is_file(), ".tmp recente deve permanecer");
        assert_eq!(orphans, vec!["999999".to_string()]);
        assert!(!root
            .join("steamapps")
            .join("appmanifest_999999.acf")
            .exists());
        assert!(root
            .join("steamapps")
            .join("appmanifest_367520.acf")
            .is_file());

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn sweep_tolerates_a_missing_root() {
        let (temps, acfs) = super::sweep_downloads_root(
            Path::new("Z:\\nao-existe-ghostbox-downloads"),
            std::time::SystemTime::now(),
        );
        assert_eq!(temps, 0);
        assert!(acfs.is_empty());
    }

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
        apply_fetched_manifests, manifest_fetch_targets, pick_depot_manifest, resolve_depots,
        resolve_installed_build_id, stplug_in_depot_keys, DepotTier, ResolvedDepot,
    };
    use crate::steam_pics::{PicsSource, PublicApp, PublicDepot};
    use std::collections::BTreeMap;

    const KEY_367521: &str = "de801b9b61e3385b333259cc0f04d2e5d976c4cb8f933cb859d75a4d0125a2a8";

    /// `<root>/config/stplug-in/<appid>.lua` + `<root>/depotcache/*.manifest`.
    /// `cached` traz `(depot, manifest)` na ordem de gravacao, entao o ultimo
    /// tem o `mtime` mais recente.
    fn fake_steam(app_id: &str, lua: &str, cached: &[(u32, u64)]) -> std::path::PathBuf {
        let root =
            std::env::temp_dir().join(format!("ghostbox-depots-{}", uuid::Uuid::new_v4().simple()));
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
            language: None,
            low_violence: false,
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
        let lua = format!("addappid(367521,1,\"ab\")\n--setManifestid(367521,\"{OLD_GID}\")\n");
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
        let app = public_app(vec![depot(
            367521,
            Some("windows"),
            &[("public", PUBLIC_GID), ("antiga", OLD_GID)],
        )]);

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
    fn left4dead2_plan_does_not_require_optional_language_or_low_violence_manifests() {
        let lua = (551..=559).map(|id| format!("setManifestid({id},\"1\")\n")).collect::<String>();
        let root = fake_steam("550", &lua, &[]);
        let mut depots = vec![
            depot(551, None, &[("public", 1)]),
            depot(552, None, &[("public", 1)]),
            depot(553, Some("macos"), &[("public", 1)]),
            depot(554, Some("linux"), &[("public", 1)]),
        ];
        let mut censored = depot(555, None, &[("public", 1)]);
        censored.low_violence = true;
        depots.push(censored);
        for (id, language) in [(556, "french"), (557, "german"), (558, "spanish"), (559, "russian")] {
            let mut localized = depot(id, None, &[("public", 1)]);
            localized.language = Some(language.to_string());
            depots.push(localized);
        }
        let app = public_app(depots);
        let resolved = resolve_depots(&root.to_string_lossy(), "550", Some(&app));
        let _ = std::fs::remove_dir_all(root);
        assert_eq!(resolved.iter().map(|depot| depot.depot_id).collect::<Vec<_>>(), vec![551, 552]);
    }

    #[test]
    fn an_available_package_fallback_remains_stale_until_explicitly_accepted() {
        let mut depots = vec![super::ResolvedDepot {
            depot_id: 367521, manifest_id: 1, public_gid: Some(PUBLIC_GID), tier: DepotTier::LuaPinned,
        }];
        let fetched = BTreeMap::from([(367521, crate::manifest_sources::FetchedManifest {
            manifest_id: OLD_GID, bytes: vec![1],
        })]);
        apply_fetched_manifests(&mut depots, &fetched);
        assert_eq!(depots[0].manifest_id, OLD_GID);
        assert!(!depots[0].is_current());
    }

    #[test]
    #[ignore = "depende das fontes reais; não instala nem baixa arquivos do jogo"]
    fn real_left4dead2_manifests_resolve_without_a_local_depotcache() {
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        runtime.block_on(async {
            let app = crate::steam_pics::fetch_steamcmd_app("550").await.expect("PICS indisponível");
            let lua = (551..=559).map(|id| format!("setManifestid({id},\"1\")\n")).collect::<String>();
            let root = fake_steam("550", &lua, &[]);
            let mut depots = resolve_depots(&root.to_string_lossy(), "550", Some(&app));
            let targets = manifest_fetch_targets(&root.to_string_lossy(), &depots);
            let _ = std::fs::remove_dir_all(root);
            assert_eq!(targets.iter().map(|(id, _)| *id).collect::<Vec<_>>(), vec![551, 552]);
            let (fetched, errors) = crate::manifest_sources::fetch_manifest_files("550", &targets, Some(&app)).await.unwrap();
            for (id, _) in &targets {
                assert!(fetched.get(id).is_some_and(|manifest| !manifest.bytes.is_empty()), "Depot {id} ausente: {errors:?}");
            }
            apply_fetched_manifests(&mut depots, &fetched);
            for depot in depots {
                println!("Depot {}: manifest {}, versão pública: {}", depot.depot_id, depot.manifest_id, depot.is_current());
            }
        });
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
    fn stplug_in_keys_come_from_every_lua_and_ignore_keyless_lines() {
        let lua = format!(
            "addappid(367520)\naddappid( 367521 , 0 , \"{KEY_367521}\" )\n\
             --addappid(367522,1,\"{KEY_367521}\")\naddappid(367523,1,\"deadbeef\")\n"
        );
        let root = fake_steam("367520", &lua, &[]);

        let keys = stplug_in_depot_keys(&root.to_string_lossy());
        let _ = std::fs::remove_dir_all(&root);

        // A linha do app, a comentada e o hex curto nao contam como chave.
        assert_eq!(keys.len(), 1);
        assert_eq!(keys.get(&367521).map(String::as_str), Some(KEY_367521));
    }

    #[test]
    fn manifest_targets_prefer_the_public_gid_and_skip_what_is_on_disk() {
        let lua = format!(
            "addappid(367521,1,\"{KEY_367521}\")\n--setManifestid(367521,\"{OLD_GID}\")\n\
             addappid(367524,1,\"{KEY_367521}\")\n--setManifestid(367524,\"7\")\n\
             addappid(367526,1,\"{KEY_367521}\")\n--setManifestid(367526,\"42\")\n"
        );
        let root = fake_steam("367520", &lua, &[(367521, OLD_GID), (367524, 7)]);
        let app = public_app(vec![
            depot(
                367521,
                Some("windows"),
                &[("public", PUBLIC_GID), ("antiga", OLD_GID)],
            ),
            depot(367524, Some("windows"), &[("public", 7)]),
            depot(367526, Some("windows"), &[("public", 0)]),
        ]);

        let depots = resolve_depots(&root.to_string_lossy(), "367520", Some(&app));
        let targets = manifest_fetch_targets(&root.to_string_lossy(), &depots);
        let _ = std::fs::remove_dir_all(&root);

        // 367521 tem build velha em disco: o alvo e o gid publico.
        // 367524 ja tem o publico em disco: nao busca nada.
        // 367526 nao tem nada em disco e o PICS nao o conhece: o alvo e o pin.
        assert_eq!(targets, vec![(367521, PUBLIC_GID), (367526, 42)]);
    }

    #[test]
    fn a_fetched_public_manifest_upgrades_the_depot_and_clears_the_stale_flag() {
        let mut depots = vec![ResolvedDepot {
            depot_id: 367521,
            manifest_id: OLD_GID,
            tier: DepotTier::NewestInCache,
            public_gid: Some(PUBLIC_GID),
        }];
        let mut fetched = BTreeMap::new();
        fetched.insert(
            367521u32,
            crate::manifest_sources::FetchedManifest {
                manifest_id: PUBLIC_GID,
                bytes: b"manifest".to_vec(),
            },
        );

        apply_fetched_manifests(&mut depots, &fetched);

        assert_eq!(depots[0].manifest_id, PUBLIC_GID);
        assert_eq!(depots[0].tier, DepotTier::PublicFromPackage);
        assert!(depots[0].is_current());
    }

    #[test]
    fn a_fetched_pinned_manifest_keeps_its_tier_when_pics_is_silent() {
        let mut depots = vec![ResolvedDepot {
            depot_id: 999,
            manifest_id: 42,
            tier: DepotTier::LuaPinned,
            public_gid: None,
        }];
        let mut fetched = BTreeMap::new();
        fetched.insert(
            999u32,
            crate::manifest_sources::FetchedManifest {
                manifest_id: 42,
                bytes: b"manifest".to_vec(),
            },
        );

        apply_fetched_manifests(&mut depots, &fetched);

        assert_eq!(depots[0].manifest_id, 42);
        assert_eq!(depots[0].tier, DepotTier::LuaPinned);
        assert!(depots[0].is_current());
    }

    #[test]
    fn the_installed_build_id_is_the_oldest_depot_not_the_public_branch() {
        let app = public_app(vec![
            depot(
                367521,
                Some("windows"),
                &[("public", PUBLIC_GID), ("antiga", OLD_GID)],
            ),
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
        assert_eq!(
            resolve_installed_build_id(Some(&app), &[(367521, 999)]),
            None
        );
        assert_eq!(
            resolve_installed_build_id(None, &[(367521, PUBLIC_GID)]),
            None
        );
    }
}
