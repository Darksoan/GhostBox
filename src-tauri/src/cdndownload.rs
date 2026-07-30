use std::io::BufRead;
use std::path::Path;
use std::process::Stdio;
use tauri::Emitter;

const POC_RELATIVE_PATH: &str = "../sidecars/steamkit-poc/bin/Debug/net8.0/steamkit-poc.exe";

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
pub async fn cdndownload_download_game(
    app: tauri::AppHandle,
    app_id: String,
    output_dir: String,
    steam_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let poc_path = find_poc_binary()?;

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

    for (depot_id, manifest_id) in &depots {
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

        let mut cmd = crate::util::silent_command(&poc_path);
        cmd.arg("--download")
            .arg("--app-id")
            .arg(&app_id)
            .arg("--depot-id")
            .arg(depot_id.to_string())
            .arg("--manifest-id")
            .arg(manifest_id.to_string())
            .arg("--steam-path")
            .arg(&steam_path)
            .arg("--output-dir")
            .arg(&depot_output)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn steamkit-poc for depot {depot_id}: {e}"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture stdout from steamkit-poc".to_string())?;

        let app_clone = app.clone();
        let reader_handle = std::thread::spawn(move || -> Option<serde_json::Value> {
            let reader = std::io::BufReader::new(stdout);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
                    continue;
                };
                let event_type = value
                    .get("Type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let _ = app_clone.emit("download-progress", value.clone());
                if event_type == "complete" || event_type == "error" {
                    return Some(value);
                }
            }
            None
        });

        let status = child
            .wait()
            .map_err(|e| format!("Process wait error for depot {depot_id}: {e}"))?;

        // Sem linha `complete`/`error` o processo morreu antes de reportar. Antes isso
        // virava um `"Type": "complete"` sintético e a UI mostrava o download como
        // concluído com 0 byte; agora o código de saída decide o tipo.
        let depot_result = reader_handle
            .join()
            .map_err(|_| "Reader thread panic".to_string())?
            .unwrap_or_else(|| {
                serde_json::json!({
                    "Type": if status.success() { "complete" } else { "error" },
                    "Status": "sidecar-exited-without-result",
                    "Message": format!(
                        "steamkit-poc encerrou sem reportar resultado do depot {depot_id} (exit {:?}).",
                        status.code()
                    ),
                    "DepotId": depot_id,
                    "success": status.success(),
                    "exitCode": status.code(),
                })
            });

        all_results.push(depot_result);
    }

    Ok(serde_json::json!({
        "Type": "complete",
        "Depots": all_results,
        "DepotCount": all_results.len(),
    }))
}
