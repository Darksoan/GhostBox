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

#[tauri::command]
pub fn cdndownload_delete_output_dir(
    app_id: String,
    downloads_root: String,
    output_dir: String,
) -> Result<bool, String> {
    let app_id = app_id.trim();
    let downloads_root = downloads_root.trim();
    let output_dir = output_dir.trim();
    if app_id.is_empty() || downloads_root.is_empty() || output_dir.is_empty() {
        return Err(
            "Download removal requires an app ID, downloads root, and output path."
                .to_string(),
        );
    }

    let root_path = Path::new(downloads_root);
    let output_path = Path::new(output_dir);
    if output_path.file_name().and_then(|name| name.to_str()) != Some(app_id) {
        return Err("Download output folder does not match the requested app ID.".to_string());
    }
    if output_path.parent() != Some(root_path) {
        return Err("Download output folder must be a direct child of the downloads root.".to_string());
    }
    if !output_path.exists() {
        return Ok(true);
    }
    if !output_path.is_dir() {
        return Err("Download output path is not a directory.".to_string());
    }

    let canonical_root = root_path.canonicalize().map_err(|error| error.to_string())?;
    let canonical_output = output_path.canonicalize().map_err(|error| error.to_string())?;
    if canonical_output.parent() != Some(canonical_root.as_path()) {
        return Err("Download output folder resolves outside the downloads root.".to_string());
    }

    std::fs::remove_dir_all(canonical_output).map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn cdndownload_download_game(
    app: tauri::AppHandle,
    app_id: String,
    output_dir: String,
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

    app.emit(
        "download-progress",
        serde_json::json!({
            "Type": "status",
            "Status": "depot-plan",
            "AppId": app_id,
            "DepotTotal": depots.len(),
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
        }),
    )
    .ok();

    let mut completed_depot_bytes = 0u64;

    for ((depot_id, manifest_id), depot_size) in depots.iter().zip(depot_sizes.iter()) {
        if take_download_cancelled(&app_id) {
            clear_active_download_process(&app_id);
            return Ok(serde_json::json!({
                "Type": "cancelled",
                "Status": "cancelled",
                "AppId": app_id,
            }));
        }

        let depot_output = format!("{}\\depot_{}", output_dir.trim_end_matches('\\'), depot_id);

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

    Ok(serde_json::json!({
        "Type": "complete",
        "Depots": all_results,
        "DepotCount": all_results.len(),
    }))
}
