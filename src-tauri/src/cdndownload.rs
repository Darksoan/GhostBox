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

/// Read OST .lua file for the given app_id and return all (depotId, manifestId) pairs.
fn resolve_depots(steam_path: &str, app_id: &str) -> Vec<(u32, u64)> {
    let lua_path = Path::new(steam_path)
        .join("config")
        .join("stplug-in")
        .join(format!("{app_id}.lua"));

    let content = match std::fs::read_to_string(&lua_path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let mut depots: Vec<(u32, u64)> = vec![];

    // Parse --setManifestid(depotId, "manifestId")
    let search_str = "--setManifestid(";
    let mut pos = 0;
    while let Some(start) = content[pos..].find(search_str) {
        let from = pos + start + search_str.len();
        if let Some(end_paren) = content[from..].find(')') {
            let args = &content[from..from + end_paren];
            if let Some((d_str, rest)) = args.split_once(',') {
                let d_str = d_str.trim();
                let m_str = rest.trim().trim_matches('"').trim();
                if let (Ok(d), Ok(m)) = (d_str.parse::<u32>(), m_str.parse::<u64>()) {
                    if d > 0 && m > 0 {
                        depots.push((d, m));
                    }
                }
            }
            pos = from + end_paren;
        } else {
            break;
        }
    }

    // If no --setManifestid, try reading depotcache filenames
    if depots.is_empty() {
        let depotcache = Path::new(steam_path).join("depotcache");
        if let Ok(entries) = std::fs::read_dir(&depotcache) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                // {depotId}_{manifestId}.manifest
                if let Some((d_str, rest)) = name.split_once('_') {
                    if let Some((m_str, _)) = rest.split_once(".manifest") {
                        if let (Ok(d), Ok(m)) = (d_str.parse::<u32>(), m_str.parse::<u64>()) {
                            // Only include depot IDs mentioned in addappid for this app
                            let add_pattern = format!("addappid({d},");
                            if content.contains(&add_pattern) {
                                depots.push((d, m));
                            }
                        }
                    }
                }
            }
        }
    }

    depots.sort();
    depots.dedup();
    depots
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

#[tauri::command]
pub fn cdndownload_delete_output_dir(
    app_id: String,
    downloads_root: String,
    output_dir: String,
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

#[tauri::command]
pub async fn cdndownload_download_game(
    app: tauri::AppHandle,
    app_id: String,
    downloads_root: String,
    game_title: Option<String>,
    steam_path: Option<String>,
    parallel_chunks: Option<u32>,
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

    let depots = resolve_depots(&steam_path, &app_id);
    if depots.is_empty() {
        return Ok(serde_json::json!({
            "Type": "error",
            "Status": "no-depots",
            "Message": format!("No depots found for app {app_id} in OST Lua or depotcache.")
        }));
    }

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
    let build_id = app_info.map(|info| info.build_id.as_str()).unwrap_or("");
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
}
