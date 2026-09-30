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

pub(crate) fn save_cloud_session(
    app: &tauri::AppHandle,
    session: &serde_json::Value,
) -> Result<(), String> {
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

fn session_user_id(app: &tauri::AppHandle) -> Option<String> {
    load_cloud_session(app)?
        .get("account")?
        .get("userId")?
        .as_str()
        .map(str::to_string)
}

fn is_same_cloud_account(app: &tauri::AppHandle, token: &str, user_id: Option<&str>) -> bool {
    match (user_id, session_user_id(app)) {
        (Some(original), Some(current)) => original == current,
        _ => session_token(app).is_ok_and(|current| current == token),
    }
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
    if !crate::subscription::has_premium_access(&app).await {
        return Err("Backup em nuvem requer GhostBox Premium.".to_string());
    }
    let token = session_token(&app)?;
    let user_id = session_user_id(&app);
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
        let zip_path_for_task = zip_path.clone();
        let backup_dir_for_task = backup_dir.clone();
        let (sha256, bytes) = tauri::async_runtime::spawn_blocking(move || {
            zip_directory(&backup_dir_for_task, &zip_path_for_task)?;
            let sha = sha256_file(&zip_path_for_task)?;
            let bytes = std::fs::read(&zip_path_for_task)
                .map_err(|error| error.to_string())?;
            Ok::<_, String>((sha, bytes))
        })
        .await
        .map_err(|error| error.to_string())??;
        if bytes.is_empty() {
            return Err("Nenhum save encontrado para backup em nuvem.".to_string());
        }
        if !is_same_cloud_account(&app, &token, user_id.as_deref()) {
            return Err("A conta mudou durante o backup. Tente novamente.".to_string());
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
            .bearer_auth(&token)
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
                        "achievementCount": profile_progress.achievement_count,
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
                    "achievementCount": profile_progress.achievement_count,
                    "playtime": profile_progress.has_playtime,
                    "saves": ludusavi_error.is_none()
                }),
            );
            if let Some(warning) = ludusavi_error {
                object.insert("warning".to_string(), serde_json::json!(warning));
            }
        }
        if is_same_cloud_account(&app, &token, user_id.as_deref()) {
            let _ = crate::save_cloud_backup_success_record(&app, &app_id, &title, backup_size_bytes);
        }
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
            "not_found" | "Not found" => {
                "Backup não encontrado na nuvem. Atualize a lista e tente novamente.".to_string()
            }
            "storage_upload_failed" => "Falha ao enviar o backup para a nuvem.".to_string(),
            "cloud_save_busy" => {
                "Outro backup deste jogo está em andamento. Aguarde e tente novamente.".to_string()
            }
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
    if !crate::subscription::has_premium_access(&app).await {
        return Err("Restauração em nuvem requer GhostBox Premium.".to_string());
    }
    let token = session_token(&app)?;
    let user_id = session_user_id(&app);
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
            .bearer_auth(&token)
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
        let restore_dir = temp_root.join("restore");
        let zip_path_for_task = zip_path.clone();
        let bytes_for_task = bytes.clone();
        let actual_sha256 = tauri::async_runtime::spawn_blocking(move || {
            std::fs::write(&zip_path_for_task, &bytes_for_task)
                .map_err(|error| error.to_string())?;
            sha256_file(&zip_path_for_task)
        })
        .await
        .map_err(|error| error.to_string())??;
        if expected_sha256
            .as_deref()
            .is_some_and(|expected| expected != actual_sha256)
        {
            return Err("Backup em nuvem corrompido: checksum inválido.".to_string());
        }
        let zip_path_for_task = zip_path.clone();
        let restore_dir_for_task = restore_dir.clone();
        tauri::async_runtime::spawn_blocking(move || {
            std::fs::create_dir_all(&restore_dir_for_task).map_err(|error| error.to_string())?;
            unzip_to_directory(&zip_path_for_task, &restore_dir_for_task)
        })
        .await
        .map_err(|error| error.to_string())??;
        if !is_same_cloud_account(&app, &token, user_id.as_deref()) {
            return Err("A conta mudou durante a restauração. Tente novamente.".to_string());
        }
        let restore_path = restore_dir.to_string_lossy().to_string();
        // Restore saves when present; always restore profile progress (achievements + playtime).
        let ludusavi_error = match resolve_ludusavi_game_name(&app, &app_id, &title) {
            Some(game_name) => {
                let args = ludusavi_args("restore", &game_name, Some(&restore_path), false);
                run_ludusavi(&app, &args).err()
            }
            None => Some(format!("Ludusavi não conhece saves para {title}.")),
        };
        let profile_progress = crate::import_game_profile_progress(&app, &app_id, &restore_dir);
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
                "achievementCount": profile_progress.achievement_count,
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
pub async fn cloud_delete_game_saves(
    app: tauri::AppHandle,
    app_id: String,
) -> Result<serde_json::Value, String> {
    let token = session_token(&app)?;
    let app_id = app_id.trim();
    if app_id.is_empty() || app_id.len() > 12 || !app_id.chars().all(|ch| ch.is_ascii_digit()) {
        return Err("Jogo inválido para excluir o backup em nuvem.".to_string());
    }

    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?
        .delete(format!("{}/cloud-saves/game/{}", cloud_api_url(), app_id))
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
pub async fn cloud_get_profile_avatar(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let token = session_token(&app)?;
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?
        .get(format!("{}/cloud-profile/avatar", cloud_api_url()))
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
pub async fn cloud_put_profile_avatar(
    app: tauri::AppHandle,
    avatar_url: String,
) -> Result<serde_json::Value, String> {
    let token = session_token(&app)?;
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?
        .put(format!("{}/cloud-profile/avatar", cloud_api_url()))
        .bearer_auth(token)
        .json(&serde_json::json!({ "avatarUrl": avatar_url }))
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
            "password_auth_removed" => password_auth_removed_message(),
            "terms_required" => "É preciso aceitar os termos para criar a conta.".to_string(),
            "reauth_required" => {
                "Por segurança, entre novamente pelo provedor antes de continuar.".to_string()
            }
            "username_taken" => "Esse nome de usuário já está em uso.".to_string(),
            "provider_already_linked" => {
                "Este provedor já está vinculado a uma conta GhostBox. Use a opção de unir contas.".to_string()
            }
            "signup_required" => {
                "Nenhuma conta GhostBox está vinculada a este provedor ainda.".to_string()
            }
            "too_many_attempts" => {
                "Muitas tentativas. Aguarde antes de tentar novamente.".to_string()
            }
            "account_not_found" => "Conta não encontrada.".to_string(),
            "unauthorized" | "session_expired" | "session_mismatch" => {
                "Sessão expirada. Faça login novamente.".to_string()
            }
            "steam_already_linked" => {
                "Esta conta Steam já está conectada a outro usuário GhostBox.".to_string()
            }
            "invalid_steam_login" => "Não foi possível validar o login da Steam.".to_string(),
            "missing_refresh_token" => "Sessão inválida. Faça login novamente.".to_string(),
            "invalid_username" => {
                "Nome de usuário inválido. Use de 3 a 20 letras, números ou _.".to_string()
            }
            "invalid_ticket" => {
                "A autorização do provedor expirou. Tente entrar novamente.".to_string()
            }
            "steam_not_linked" => {
                "Nenhuma conta GhostBox está vinculada a esta Steam ainda. Crie sua conta pela Steam para continuar.".to_string()
            }
            "last_connection" => {
                "Este é o único vínculo da conta e não pode ser removido: ele é o seu acesso ao GhostBox.".to_string()
            }
            "merge_conflict" => {
                "Essas contas não podem ser unidas automaticamente. Fale com o suporte.".to_string()
            }
            "merge_same_account" => "As duas provas pertencem à mesma conta.".to_string(),
            "confirmation_required" => "Confirme explicitamente para continuar.".to_string(),
            "subscription_active" => {
                "Cancele a assinatura no portal de cobrança antes de excluir a conta.".to_string()
            }
            "invalid_proof" => "Não foi possível confirmar a outra conta. Tente novamente.".to_string(),
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

/// Email/password and every recovery flow around it were removed: Discord
/// and Steam are the only ways in. The retired commands stay registered so
/// old frontend builds fail with a readable message instead of
/// "unknown command".
pub(crate) fn password_auth_removed_message() -> String {
    "O acesso por e-mail/senha foi desativado. Entre com Discord ou Steam.".to_string()
}

#[tauri::command]
pub async fn cloud_register(
    app: tauri::AppHandle,
    email: String,
    username: String,
    password: String,
    display_name: Option<String>,
) -> Result<serde_json::Value, String> {
    let _ = (&app, email, username, password, display_name);
    Err(password_auth_removed_message())
}

#[tauri::command]
pub async fn cloud_login(
    app: tauri::AppHandle,
    identifier: String,
    password: String,
) -> Result<serde_json::Value, String> {
    let _ = (&app, identifier, password);
    Err(password_auth_removed_message())
}

/// Providers whose sign-in goes out through the system browser.
fn validate_oauth_provider(provider: &str) -> Result<&str, String> {
    match provider {
        "discord" => Ok(provider),
        _ => Err(format!("Provedor desconhecido: {provider}")),
    }
}

/// Runs the browser hand-off and returns the single-use ticket the Worker
/// bounced back.
///
/// Providers only redirect to the one URI registered for the app, so the
/// browser lands on the Worker, not here. The Worker redirects a ticket to the
/// loopback listener opened below; the ticket is then traded for a real
/// session over HTTPS, so the browser never carries a session token.
///
/// The nonce is what makes this safe on a shared machine. Without it the
/// listener accepted whatever reached its port, and any local process could
/// hand the app a ticket for its own account — the user would silently end up
/// signed in as someone else, uploading their saves there. The Worker echoes
/// the nonce back as `state` and the listener refuses anything else.
async fn run_oauth_browser_flow(
    app: &tauri::AppHandle,
    provider: &str,
    purpose: &str,
) -> Result<String, String> {
    use tauri_plugin_opener::OpenerExt;

    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();

    // Hex of 16 random bytes: 32 chars, and every one of them safe inside the
    // Worker's dot-delimited signed state.
    let nonce = uuid::Uuid::new_v4().simple().to_string();

    let start = auth_json_request(auth_client(15)?.get(format!(
        "{}/auth/oauth/{provider}/start?port={port}&nonce={nonce}&purpose={purpose}",
        cloud_api_url()
    )))
    .await?;
    let authorize_url = start
        .get("url")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "O servidor não devolveu a URL de autorização.".to_string())?;

    app.opener()
        .open_url(authorize_url, None::<&str>)
        .map_err(|error| format!("Não foi possível abrir o navegador: {error}"))?;

    let (callback, mut stream) = crate::oauth_loopback::accept_loopback_callback(
        listener,
        port,
        "/oauth/callback",
        Some(&nonce),
        std::time::Duration::from_secs(180),
        "A entrada pelo provedor expirou.",
    )?;

    let ticket = callback
        .query_pairs()
        .find(|(key, _)| key == "ticket")
        .map(|(_, value)| value.to_string())
        .unwrap_or_default();

    if ticket.is_empty() {
        crate::oauth_loopback::write_http_response(
            &mut stream,
            "400 Bad Request",
            &crate::oauth_loopback::callback_page_html(false, "Não conectado."),
        );
        return Err("A autorização foi recusada.".to_string());
    }

    crate::oauth_loopback::write_http_response(
        &mut stream,
        "200 OK",
        &crate::oauth_loopback::callback_page_html(true, "Autorizado. Volte ao GhostBox."),
    );

    Ok(ticket)
}

/// Signs in through an OAuth provider. The Worker creates the provider-only
/// account when needed, then returns the session for local persistence.
#[tauri::command]
pub async fn cloud_oauth_login(
    app: tauri::AppHandle,
    provider: String,
) -> Result<serde_json::Value, String> {
    let provider = validate_oauth_provider(&provider)?;
    let ticket = run_oauth_browser_flow(&app, provider, "login").await?;

    let result = auth_json_request(
        auth_client(20)?
            .post(format!("{}/auth/oauth/exchange", cloud_api_url()))
            .json(&serde_json::json!({ "ticket": ticket })),
    )
    .await?;

    save_cloud_session(&app, &result)?;
    Ok(result)
}

/// Retired with email/password: there is no password to recover. The
/// provider account itself is the way back in.
#[tauri::command]
pub async fn cloud_discord_recover_start(identifier: String) -> Result<serde_json::Value, String> {
    let _ = identifier;
    Err(password_auth_removed_message())
}

/// Retired with email/password.
#[tauri::command]
pub async fn cloud_discord_recover_confirm(
    identifier: String,
    code: String,
) -> Result<serde_json::Value, String> {
    let _ = (identifier, code);
    Err(password_auth_removed_message())
}

/// Retired with email/password.
#[tauri::command]
pub async fn cloud_recover_set_password(
    app: tauri::AppHandle,
    recovery_token: String,
    new_password: String,
) -> Result<serde_json::Value, String> {
    let _ = (&app, recovery_token, new_password);
    Err(password_auth_removed_message())
}

/// Retired with email verification: there is no email to verify anymore.
#[tauri::command]
pub async fn cloud_discord_send_code(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let _ = app;
    Err(password_auth_removed_message())
}

/// Retired with email verification.
#[tauri::command]
pub async fn cloud_discord_confirm_code(
    app: tauri::AppHandle,
    code: String,
) -> Result<serde_json::Value, String> {
    let _ = (&app, code);
    Err(password_auth_removed_message())
}

/// Trades a validated Steam OpenID callback for a session. Called from
/// `steam::cloud_steam_login`; the Worker re-validates the callback against
/// Steam itself, so nothing here has to be trusted.
///
/// The Worker creates the provider-only account when needed and returns the
/// resulting session.
pub(crate) async fn cloud_steam_login_callback(
    callback_url: &str,
    profile: Option<&serde_json::Value>,
) -> Result<serde_json::Value, String> {
    auth_json_request(
        auth_client(20)?
            .post(format!("{}/auth/steam/login", cloud_api_url()))
            .json(&serde_json::json!({
                "callbackUrl": callback_url,
                "displayName": profile.map(|value| text_value(value.get("displayName"))),
                "avatarUrl": profile.map(|value| text_value(value.get("avatarUrl"))),
            })),
    )
    .await
}

/// Retired with email/password: there is no password to change.
#[tauri::command]
pub async fn cloud_change_password(
    app: tauri::AppHandle,
    current_password: String,
    new_password: String,
) -> Result<(), String> {
    let _ = (&app, current_password, new_password);
    Err(password_auth_removed_message())
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

    let me = serde_json::from_str::<serde_json::Value>(&body).map_err(|error| error.to_string())?;

    // The worker slides the session forward once it is past half its life. It
    // only reaches us here, so persisting it is what actually keeps a
    // day-to-day user signed in past the seventh day.
    if let Some(renewed) = me.get("token").and_then(|value| value.as_str()) {
        if let Some(mut session) = load_cloud_session(&app) {
            if let Some(object) = session.as_object_mut() {
                object.insert("token".to_string(), serde_json::json!(renewed));
                if let Some(account) = me.get("account") {
                    object.insert("account".to_string(), account.clone());
                }
            }
            let _ = save_cloud_session(&app, &session);
        }
    }

    Ok(Some(me))
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
    // The Worker refuses to remove the account's last connection on its own:
    // the provider account IS the login now, so at least one stays. There is
    // no client flag that talks past the refusal. Unlinking rotates the
    // session, so the replacement token is stored back.
    let result = auth_json_request(
        auth_client(15)?
            .delete(format!("{}/auth/connections/{}", cloud_api_url(), provider))
            .bearer_auth(token),
    )
    .await?;
    if let Some(mut session) = load_cloud_session(&app) {
        if let Some(object) = session.as_object_mut() {
            if let Some(replacement) = result.get("token").and_then(|value| value.as_str()) {
                object.insert("token".to_string(), serde_json::json!(replacement));
            }
            if provider == "steam" {
                object.remove("steamId");
            }
        }
        save_cloud_session(&app, &session)?;
    }
    Ok(())
}
