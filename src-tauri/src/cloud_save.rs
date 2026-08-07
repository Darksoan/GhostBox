use crate::extract_app_id;
use crate::ludusavi::{
    ludusavi_args, resolve_ludusavi_game_name, resolved_game_title, run_ludusavi,
};
use crate::settings::{
    decrypt_secret_for_current_user, encrypt_secret_for_current_user, read_binary_file,
    remove_data_file, write_binary_file,
};
use crate::util::text_value;
use base64::Engine;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};

const CLOUD_SESSION_FILE: &str = "cloud-session.bin";
const DEFAULT_CLOUD_API_URL: &str = "https://ghostbox-subscriptions.hella.workers.dev";

fn cloud_api_url() -> String {
    for key in ["GHOSTBOX_CLOUD_API_URL", "GHOSTBOX_SUBSCRIPTION_API_URL"] {
        if let Ok(value) = std::env::var(key) {
            let value = value.trim().trim_end_matches('/').to_string();
            if value.starts_with("https://") {
                return value;
            }
        }
    }
    for value in [
        option_env!("GHOSTBOX_CLOUD_API_URL"),
        option_env!("GHOSTBOX_SUBSCRIPTION_API_URL"),
    ]
    .into_iter()
    .flatten()
    {
        let value = value.trim().trim_end_matches('/').to_string();
        if value.starts_with("https://") {
            return value;
        }
    }
    DEFAULT_CLOUD_API_URL.to_string()
}

fn cloud_temp_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;

    let path = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("cloud-save");
    std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn save_cloud_session(app: &tauri::AppHandle, session: &serde_json::Value) -> Result<(), String> {
    let payload = serde_json::to_string(session).map_err(|error| error.to_string())?;
    let encrypted = encrypt_secret_for_current_user(&payload)?;
    write_binary_file(app, CLOUD_SESSION_FILE, &encrypted)
}

fn load_cloud_session(app: &tauri::AppHandle) -> Option<serde_json::Value> {
    let bytes = read_binary_file(app, CLOUD_SESSION_FILE).ok()?;
    let payload = decrypt_secret_for_current_user(&bytes).ok()?;
    serde_json::from_str(&payload).ok()
}

/// Links a Steam OpenID callback to the caller's already-authenticated
/// GhostBox account, absorbing any legacy Steam-only account's premium
/// subscription, cloud saves and profile into it. Requires an active
/// GhostBox session — connecting Steam is a settings action now, not a way
/// to sign in.
pub(crate) async fn cloud_claim_steam_callback(
    app: &tauri::AppHandle,
    callback_url: &str,
    profile: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let token = session_token(app)?;
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?
        .post(format!("{}/auth/claim-steam", cloud_api_url()))
        .bearer_auth(token)
        .json(&serde_json::json!({
            "callbackUrl": callback_url,
            "displayName": text_value(profile.get("displayName")),
            "avatarUrl": text_value(profile.get("avatarUrl")),
        }))
        .send()
        .await
        .map_err(|error| error.to_string())?;

    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format_auth_api_error(&body, status.as_u16()));
    }
    let claim =
        serde_json::from_str::<serde_json::Value>(&body).map_err(|error| error.to_string())?;

    // Merge the claimed steamId into the existing GhostBox session instead of
    // replacing it: claim-steam only links an existing account, it doesn't
    // issue a new session.
    if let Some(mut session) = load_cloud_session(app) {
        if let (Some(object), Some(steam_id)) = (session.as_object_mut(), claim.get("steamId")) {
            object.insert("steamId".to_string(), steam_id.clone());
        }
        save_cloud_session(app, &session)?;
        return Ok(session);
    }
    Ok(claim)
}

#[tauri::command]
pub fn cloud_get_session(app: tauri::AppHandle) -> Option<serde_json::Value> {
    load_cloud_session(&app)
}

#[tauri::command]
pub fn cloud_sign_out(app: tauri::AppHandle) -> Result<(), String> {
    remove_data_file(&app, CLOUD_SESSION_FILE)
}

pub(crate) fn session_token(app: &tauri::AppHandle) -> Result<String, String> {
    load_cloud_session(app)
        .and_then(|session| {
            session
                .get("token")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        })
        .filter(|token| !token.trim().is_empty())
        .ok_or_else(|| "Faça login antes de usar backup em nuvem.".to_string())
}

fn firebase_refresh_token(app: &tauri::AppHandle) -> Result<String, String> {
    load_cloud_session(app)
        .and_then(|session| {
            session
                .get("firebaseRefreshToken")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        })
        .filter(|token| !token.trim().is_empty())
        .ok_or_else(|| "Sessão inválida. Faça login novamente.".to_string())
}

fn zip_directory(source: &std::path::Path, destination: &std::path::Path) -> Result<(), String> {
    let file = std::fs::File::create(destination).map_err(|error| error.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mut stack = vec![source.to_path_buf()];
    let mut buffer = Vec::new();

    while let Some(path) = stack.pop() {
        for entry in std::fs::read_dir(&path).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let relative = path
                .strip_prefix(source)
                .map_err(|error| error.to_string())?;
            let name = relative.to_string_lossy().replace('\\', "/");
            zip.start_file(name, options)
                .map_err(|error| error.to_string())?;
            let mut input = std::fs::File::open(&path).map_err(|error| error.to_string())?;
            buffer.clear();
            input
                .read_to_end(&mut buffer)
                .map_err(|error| error.to_string())?;
            zip.write_all(&buffer).map_err(|error| error.to_string())?;
        }
    }
    zip.finish().map_err(|error| error.to_string())?;
    Ok(())
}

fn unzip_to_directory(
    zip_path: &std::path::Path,
    destination: &std::path::Path,
) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|error| error.to_string())?;
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|error| error.to_string())?;
        let Some(enclosed) = file.enclosed_name().map(|path| path.to_path_buf()) else {
            continue;
        };
        let output = destination.join(enclosed);
        if file.is_dir() {
            std::fs::create_dir_all(&output).map_err(|error| error.to_string())?;
            continue;
        }
        if let Some(parent) = output.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut output_file = std::fs::File::create(&output).map_err(|error| error.to_string())?;
        std::io::copy(&mut file, &mut output_file).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn sha256_file(path: &std::path::Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[tauri::command]
pub async fn cloud_backup_game(
    app: tauri::AppHandle,
    game: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let token = session_token(&app)?;
    let app_id = extract_app_id(&game);
    let title = resolved_game_title(&app, &game, &app_id);
    if app_id.is_empty() {
        return Err("Jogo inválido para backup em nuvem.".to_string());
    }

    let temp_root = cloud_temp_dir(&app)?.join(uuid::Uuid::new_v4().to_string());
    let backup_dir = temp_root.join("backup");
    std::fs::create_dir_all(&backup_dir).map_err(|error| error.to_string())?;
    let backup_path = backup_dir.to_string_lossy().to_string();
    let cleanup_path = temp_root.clone();

    let result = async {
        // Saves first; profile progress (achievements + playtime) is always layered on top.
        let ludusavi_error = match resolve_ludusavi_game_name(&app, &app_id, &title) {
            Some(game_name) => {
                let args = ludusavi_args("backup", &game_name, Some(&backup_path), false);
                run_ludusavi(&app, &args).err()
            }
            None => Some(format!(
                "Ludusavi não conhece saves para {title}; apenas conquistas e tempo de jogo foram salvos."
            )),
        };
        let profile_progress =
            crate::export_game_profile_progress(&app, &app_id, &title, &backup_dir);
        if !crate::directory_has_content(&backup_dir) {
            return Err(ludusavi_error.unwrap_or_else(|| {
                "Nenhum save, conquista ou tempo de jogo encontrado para backup em nuvem."
                    .to_string()
            }));
        }
        let zip_path = temp_root.join("backup.zip");
        zip_directory(&backup_dir, &zip_path)?;
        let sha256 = sha256_file(&zip_path)?;
        let bytes = std::fs::read(&zip_path).map_err(|error| error.to_string())?;
        if bytes.is_empty() {
            return Err("Nenhum save encontrado para backup em nuvem.".to_string());
        }
        let backup_size_bytes = bytes.len() as u64;
        let device_name = std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_default();
        let response = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|error| error.to_string())?
            .post(format!("{}/cloud-saves", cloud_api_url()))
            .bearer_auth(token)
            .header("content-type", "application/zip")
            .header("x-ghostbox-app-id", &app_id)
            .header("x-ghostbox-game-title", &title)
            .header("x-ghostbox-sha256", &sha256)
            .header("x-ghostbox-device-name", device_name)
            .header(
                "x-ghostbox-manifest",
                serde_json::json!({
                    "backupFormat": 2,
                    "source": "ludusavi",
                    "profileProgress": {
                        "achievements": profile_progress.has_achievements,
                        "playtime": profile_progress.has_playtime,
                        "saves": ludusavi_error.is_none()
                    }
                })
                .to_string(),
            )
            .body(bytes)
            .send()
            .await
            .map_err(|error| error.to_string())?;
        let status = response.status();
        let body = response.text().await.map_err(|error| error.to_string())?;
        if !status.is_success() {
            return Err(format_cloud_api_error(&body, status.as_u16()));
        }
        let mut parsed =
            serde_json::from_str::<serde_json::Value>(&body).map_err(|error| error.to_string())?;
        if let Some(object) = parsed.as_object_mut() {
            object.insert(
                "profileProgress".to_string(),
                serde_json::json!({
                    "achievements": profile_progress.has_achievements,
                    "playtime": profile_progress.has_playtime,
                    "saves": ludusavi_error.is_none()
                }),
            );
            if let Some(warning) = ludusavi_error {
                object.insert("warning".to_string(), serde_json::json!(warning));
            }
        }
        let _ = crate::save_cloud_backup_success_record(&app, &app_id, &title, backup_size_bytes);
        Ok(parsed)
    }
    .await;

    let _ = std::fs::remove_dir_all(cleanup_path);
    result
}

fn format_cloud_api_error(body: &str, status: u16) -> String {
    let trimmed = body.trim();
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        let code = value
            .get("error")
            .and_then(|item| item.as_str())
            .unwrap_or_default();
        return match code {
            "premium_required" => "Backup em nuvem requer GhostBox Premium.".to_string(),
            "unauthorized" | "invalid_token" => {
                "Sessão expirada. Faça login novamente.".to_string()
            }
            "backup_too_large" => "Backup em nuvem excede o limite de 50 MB.".to_string(),
            "empty_backup" => "Nenhum save encontrado para backup em nuvem.".to_string(),
            "storage_upload_failed" => "Falha ao enviar o backup para a nuvem.".to_string(),
            "invalid_profile_image_type" => "A imagem deve estar em JPEG, PNG ou WebP.".to_string(),
            "empty_profile_image" => "A imagem selecionada está vazia.".to_string(),
            "profile_image_too_large" => {
                "A imagem de perfil excede o tamanho permitido.".to_string()
            }
            "profile_image_upload_failed" => {
                "O armazenamento de imagens recusou o envio. Tente novamente.".to_string()
            }
            "profile_image_delete_failed" => {
                "O armazenamento de imagens não confirmou a remoção da capa.".to_string()
            }
            other if !other.is_empty() => format!("Erro no backup em nuvem ({other})."),
            _ => format!("Erro no backup em nuvem (HTTP {status})."),
        };
    }
    if trimmed.is_empty() {
        format!("Erro no backup em nuvem (HTTP {status}).")
    } else {
        trimmed.to_string()
    }
}

#[tauri::command]
pub async fn cloud_list_saves(
    app: tauri::AppHandle,
    app_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let token = session_token(&app)?;
    let mut url = reqwest::Url::parse(&format!("{}/cloud-saves", cloud_api_url()))
        .map_err(|error| error.to_string())?;
    if let Some(app_id) = app_id.filter(|value| !value.trim().is_empty()) {
        url.query_pairs_mut().append_pair("appId", app_id.trim());
    }
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?
        .get(url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format_cloud_api_error(&body, status.as_u16()));
    }
    serde_json::from_str::<serde_json::Value>(&body).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn cloud_restore_save(
    app: tauri::AppHandle,
    game: serde_json::Value,
    save_id: String,
) -> Result<serde_json::Value, String> {
    let token = session_token(&app)?;
    let app_id = extract_app_id(&game);
    let title = resolved_game_title(&app, &game, &app_id);
    let temp_root = cloud_temp_dir(&app)?.join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&temp_root).map_err(|error| error.to_string())?;
    let cleanup_path = temp_root.clone();

    let result = async {
        let response = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .map_err(|error| error.to_string())?
            .get(format!(
                "{}/cloud-saves/{}/download",
                cloud_api_url(),
                save_id.trim()
            ))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|error| error.to_string())?;
        let expected_sha256 = response
            .headers()
            .get("x-ghostbox-sha256")
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        let status = response.status();
        let bytes = response.bytes().await.map_err(|error| error.to_string())?;
        if !status.is_success() {
            return Err(String::from_utf8_lossy(&bytes).to_string());
        }
        let zip_path = temp_root.join("restore.zip");
        std::fs::write(&zip_path, &bytes).map_err(|error| error.to_string())?;
        let actual_sha256 = sha256_file(&zip_path)?;
        if expected_sha256
            .as_deref()
            .is_some_and(|expected| expected != actual_sha256)
        {
            return Err("Backup em nuvem corrompido: checksum inválido.".to_string());
        }
        let restore_dir = temp_root.join("restore");
        std::fs::create_dir_all(&restore_dir).map_err(|error| error.to_string())?;
        unzip_to_directory(&zip_path, &restore_dir)?;
        let restore_path = restore_dir.to_string_lossy().to_string();
        // Restore saves when present; always restore profile progress (achievements + playtime).
        let ludusavi_error = match resolve_ludusavi_game_name(&app, &app_id, &title) {
            Some(game_name) => {
                let args = ludusavi_args("restore", &game_name, Some(&restore_path), false);
                run_ludusavi(&app, &args).err()
            }
            None => Some(format!("Ludusavi não conhece saves para {title}.")),
        };
        let profile_progress =
            crate::import_game_profile_progress(&app, &app_id, &title, &restore_dir);
        if ludusavi_error.is_some() && !profile_progress.has_any() {
            return Err(ludusavi_error.unwrap_or_else(|| {
                "Nenhum save ou progresso de perfil encontrado para restaurar da nuvem.".to_string()
            }));
        }
        Ok(serde_json::json!({
            "success": true,
            "appId": app_id,
            "title": title,
            "saveId": save_id,
            "backupSizeBytes": bytes.len(),
            "profileProgress": {
                "achievements": profile_progress.has_achievements,
                "playtime": profile_progress.has_playtime,
                "saves": ludusavi_error.is_none()
            },
            "warning": ludusavi_error
        }))
    }
    .await;

    let _ = std::fs::remove_dir_all(cleanup_path);
    result
}

#[tauri::command]
pub async fn cloud_delete_save(
    app: tauri::AppHandle,
    save_id: String,
) -> Result<serde_json::Value, String> {
    let token = session_token(&app)?;
    let save_id = save_id.trim().to_string();
    if save_id.is_empty() {
        return Err("Backup em nuvem inválido.".to_string());
    }

    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?
        .delete(format!("{}/cloud-saves/{}", cloud_api_url(), save_id))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format_cloud_api_error(&body, status.as_u16()));
    }
    serde_json::from_str(&body).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn cloud_set_save_pinned(
    app: tauri::AppHandle,
    save_id: String,
    pinned: bool,
) -> Result<serde_json::Value, String> {
    let token = session_token(&app)?;
    let save_id = save_id.trim().to_string();
    if save_id.is_empty() {
        return Err("Backup em nuvem inválido.".to_string());
    }

    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?
        .patch(format!(
            "{}/cloud-saves/{}/pinned",
            cloud_api_url(),
            save_id
        ))
        .bearer_auth(token)
        .json(&serde_json::json!({ "pinned": pinned }))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format_cloud_api_error(&body, status.as_u16()));
    }
    serde_json::from_str(&body).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn cloud_get_profile_snapshot(
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    let token = session_token(&app)?;
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?
        .get(format!("{}/cloud-profile", cloud_api_url()))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format_cloud_api_error(&body, status.as_u16()));
    }
    serde_json::from_str(&body).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn cloud_put_profile_snapshot(
    app: tauri::AppHandle,
    snapshot: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let token = session_token(&app)?;
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?
        .put(format!("{}/cloud-profile", cloud_api_url()))
        .bearer_auth(token)
        .json(&snapshot)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format_cloud_api_error(&body, status.as_u16()));
    }
    serde_json::from_str(&body).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn cloud_upload_profile_image(
    app: tauri::AppHandle,
    image_data: String,
    kind: String,
) -> Result<serde_json::Value, String> {
    let token = load_cloud_session(&app)
        .and_then(|session| {
            session
                .get("token")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        })
        .ok_or_else(|| "Cloud session unavailable".to_string())?;
    let (mime, encoded) = image_data
        .split_once(",")
        .ok_or_else(|| "Invalid image data".to_string())?;
    let mime = mime
        .strip_prefix("data:")
        .and_then(|value| value.strip_suffix(";base64"))
        .ok_or_else(|| "Invalid image data".to_string())?;
    if !matches!(mime, "image/jpeg" | "image/png" | "image/webp") {
        return Err("Unsupported profile image type".to_string());
    }
    if !matches!(kind.as_str(), "avatar" | "banner") {
        return Err("Invalid profile image kind".to_string());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| error.to_string())?;
    let response = reqwest::Client::new()
        .post(format!("{}/cloud-profile/{}", cloud_api_url(), kind))
        .bearer_auth(token)
        .header("content-type", mime)
        .body(bytes)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format_cloud_api_error(&body, status.as_u16()));
    }
    serde_json::from_str(&body).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn cloud_delete_profile_banner(
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    let token = load_cloud_session(&app)
        .and_then(|session| {
            session
                .get("token")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        })
        .ok_or_else(|| "Cloud session unavailable".to_string())?;
    let response = reqwest::Client::new()
        .delete(format!("{}/cloud-profile/banner", cloud_api_url()))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format_cloud_api_error(&body, status.as_u16()));
    }
    serde_json::from_str(&body).map_err(|error| error.to_string())
}

fn format_auth_api_error(body: &str, status: u16) -> String {
    let trimmed = body.trim();
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        let code = value
            .get("error")
            .and_then(|item| item.as_str())
            .unwrap_or_default();
        return match code {
            "invalid_email" => "E-mail inválido.".to_string(),
            "invalid_username" => {
                "Nome de usuário inválido. Use de 3 a 20 letras, números ou _.".to_string()
            }
            "weak_password" => "Senha muito curta. Use ao menos 8 caracteres.".to_string(),
            "username_taken" => "Esse nome de usuário já está em uso.".to_string(),
            "email_already_registered" => "Já existe uma conta com esse e-mail.".to_string(),
            "invalid_credentials" => "Usuário/e-mail ou senha incorretos.".to_string(),
            "too_many_attempts" => {
                "Muitas tentativas. Aguarde antes de tentar novamente.".to_string()
            }
            "account_disabled" => "Esta conta foi desativada.".to_string(),
            "account_not_found" => "Conta não encontrada.".to_string(),
            "unauthorized" | "session_expired" | "session_mismatch" => {
                "Sessão expirada. Faça login novamente.".to_string()
            }
            "steam_already_linked" => {
                "Esta conta Steam já está conectada a outro usuário GhostBox.".to_string()
            }
            "invalid_steam_login" => "Não foi possível validar o login da Steam.".to_string(),
            "missing_refresh_token" => "Sessão inválida. Faça login novamente.".to_string(),
            other if !other.is_empty() => format!("Erro de autenticação ({other})."),
            _ => format!("Erro de autenticação (HTTP {status})."),
        };
    }
    if trimmed.is_empty() {
        format!("Erro de autenticação (HTTP {status}).")
    } else {
        trimmed.to_string()
    }
}

async fn auth_json_request(request: reqwest::RequestBuilder) -> Result<serde_json::Value, String> {
    let response = request.send().await.map_err(|error| error.to_string())?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format_auth_api_error(&body, status.as_u16()));
    }
    serde_json::from_str(&body).map_err(|error| error.to_string())
}

fn auth_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn cloud_register(
    app: tauri::AppHandle,
    email: String,
    username: String,
    password: String,
    display_name: Option<String>,
) -> Result<serde_json::Value, String> {
    let session = auth_json_request(
        auth_client(20)?
            .post(format!("{}/auth/register", cloud_api_url()))
            .json(&serde_json::json!({
                "email": email,
                "username": username,
                "password": password,
                "displayName": display_name,
            })),
    )
    .await?;
    save_cloud_session(&app, &session)?;
    Ok(session)
}

#[tauri::command]
pub async fn cloud_login(
    app: tauri::AppHandle,
    identifier: String,
    password: String,
) -> Result<serde_json::Value, String> {
    let session = auth_json_request(
        auth_client(20)?
            .post(format!("{}/auth/login", cloud_api_url()))
            .json(&serde_json::json!({
                "identifier": identifier,
                "password": password,
            })),
    )
    .await?;
    save_cloud_session(&app, &session)?;
    Ok(session)
}

#[tauri::command]
pub async fn cloud_request_password_reset(identifier: String) -> Result<(), String> {
    auth_json_request(
        auth_client(15)?
            .post(format!("{}/auth/password-reset", cloud_api_url()))
            .json(&serde_json::json!({ "identifier": identifier })),
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn cloud_resend_verification(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let token = session_token(&app)?;
    let refresh_token = firebase_refresh_token(&app)?;
    let result = auth_json_request(
        auth_client(15)?
            .post(format!("{}/auth/resend-verification", cloud_api_url()))
            .bearer_auth(token)
            .json(&serde_json::json!({ "firebaseRefreshToken": refresh_token })),
    )
    .await?;

    if let Some(new_refresh_token) = result.get("firebaseRefreshToken").and_then(|v| v.as_str()) {
        if let Some(mut session) = load_cloud_session(&app) {
            if let Some(object) = session.as_object_mut() {
                object.insert(
                    "firebaseRefreshToken".to_string(),
                    serde_json::json!(new_refresh_token),
                );
            }
            let _ = save_cloud_session(&app, &session);
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn cloud_change_password(
    app: tauri::AppHandle,
    current_password: String,
    new_password: String,
) -> Result<(), String> {
    let token = session_token(&app)?;
    auth_json_request(
        auth_client(15)?
            .post(format!("{}/auth/change-password", cloud_api_url()))
            .bearer_auth(token)
            .json(&serde_json::json!({
                "currentPassword": current_password,
                "newPassword": new_password,
            })),
    )
    .await?;
    Ok(())
}

/// `Ok(None)` means the worker rejected the session (it is genuinely dead and
/// the caller should sign out). `Err` means the request never got an answer —
/// offline, DNS failure, worker down — and the caller must keep the stored
/// session rather than logging the user out over a network blip.
#[tauri::command]
pub async fn cloud_get_account(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let token = session_token(&app)?;
    let response = auth_client(15)?
        .get(format!("{}/auth/me", cloud_api_url()))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if status.as_u16() == 401 || status.as_u16() == 404 {
        return Ok(None);
    }
    if !status.is_success() {
        return Err(format_auth_api_error(&body, status.as_u16()));
    }
    serde_json::from_str(&body)
        .map(Some)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn cloud_disconnect_connection(
    app: tauri::AppHandle,
    provider: String,
) -> Result<(), String> {
    if provider != "steam" && provider != "discord" {
        return Err("Conexão inválida.".to_string());
    }
    let token = session_token(&app)?;
    auth_json_request(
        auth_client(15)?
            .delete(format!("{}/auth/connections/{}", cloud_api_url(), provider))
            .bearer_auth(token),
    )
    .await?;
    Ok(())
}
