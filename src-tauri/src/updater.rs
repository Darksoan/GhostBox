#[derive(serde::Deserialize)]
pub struct DownloadUpdateRequest {
    #[serde(rename = "installerUrl")]
    installer_url: String,
}

fn update_file_name(url: &str) -> String {
    url.split('?')
        .next()
        .and_then(|value| value.rsplit('/').next())
        .filter(|value| value.to_ascii_lowercase().ends_with(".exe"))
        .map(|value| {
            value
                .chars()
                .map(|character| match character {
                    'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '-' | '_' => character,
                    _ => '-',
                })
                .collect::<String>()
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "GhostBox-update-setup.exe".to_string())
}

#[tauri::command]
pub async fn app_download_and_run_update(
    request: DownloadUpdateRequest,
) -> Result<serde_json::Value, String> {
    let installer_url = request.installer_url.trim().to_string();

    if !installer_url.starts_with("https://") {
        return Err("Update installer URL must use HTTPS.".to_string());
    }

    let response = reqwest::get(&installer_url)
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "Update installer download failed with status {}.",
            response.status()
        ));
    }

    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.is_empty() {
        return Err("Update installer download returned an empty file.".to_string());
    }

    let updates_dir = std::env::temp_dir().join("GhostBoxUpdates");
    std::fs::create_dir_all(&updates_dir).map_err(|error| error.to_string())?;
    let installer_path = updates_dir.join(update_file_name(&installer_url));
    std::fs::write(&installer_path, &bytes).map_err(|error| error.to_string())?;

    std::process::Command::new(&installer_path)
        .spawn()
        .map_err(|error| error.to_string())?;

    Ok(serde_json::json!({
        "success": true,
        "installerPath": installer_path.to_string_lossy()
    }))
}
