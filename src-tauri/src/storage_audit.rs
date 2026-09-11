//! Auditoria e limpeza do armazenamento que o GhostBox usa em disco.
//!
//! Tudo que o app persiste cai em categorias conhecidas; este módulo expõe o
//! tamanho de cada uma (`storage_usage`), a limpeza seletiva
//! (`clear_storage_category` / `clear_app_caches`) e uma varredura de
//! temporários órfãos na inicialização (`startup_temp_sweep`).
//!
//! Nunca toca em: configurações do usuário, saves/backups de jogos
//! (`GhostBoxBackups`), playtime ou status de assinatura — só em dados
//! re-deriváveis (caches, ferramentas baixadas) e no progresso offline do
//! emulador quando o usuário pede explicitamente.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Ids das categorias reportadas ao frontend. Ordem = ordem de exibição.
pub const CATEGORY_IDS: [&str; 6] = [
    "images",
    "catalogueCache",
    "steamcmd",
    "webviewCache",
    "goldbergSaves",
    "ludusaviConfig",
];

/// Categorias que são cache puro: apagar não perde NADA de valor para o
/// usuário (tudo é re-baixado/re-derivado sozinho). Usado por `clear_app_caches`.
const PURE_CACHE_CATEGORIES: [&str; 3] = ["images", "catalogueCache", "steamcmd"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageCategory {
    id: &'static str,
    bytes: u64,
    present: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageUsage {
    categories: Vec<StorageCategory>,
    total_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearOutcome {
    cleared: Vec<String>,
    failed: Vec<ClearFailure>,
    freed_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearFailure {
    id: String,
    reason: String,
}

/// Caminho raiz de cada categoria. `None` = categoria indisponível neste
/// ambiente (não aparece como presente no relatório).
fn category_path(app: &AppHandle, id: &str) -> Option<PathBuf> {
    let app_data = app.path().app_data_dir().ok()?;
    match id {
        "images" => Some(app_data.join("cache").join("images")),
        "catalogueCache" => Some(app_data.join("cache").join("catalogue")),
        "steamcmd" => Some(app_data.join("steamcmd")),
        // Cache do WebView2 vive em app_local_data (não roaming).
        "webviewCache" => Some(app.path().app_local_data_dir().ok()?.join("EBWebView")),
        "goldbergSaves" => Some(crate::goldberg::saves_root()),
        "ludusaviConfig" => Some(app_data.join("ludusavi")),
        _ => None,
    }
}

/// Tamanho recursivo de uma pasta. Falhas de leitura individual são ignoradas
/// (arquivos travados por outro processo não derrubam o relatório).
fn directory_size(path: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    entries.flatten().fold(0u64, |total, entry| {
        let Ok(metadata) = entry.metadata() else {
            return total;
        };
        if metadata.is_dir() {
            total + directory_size(&entry.path())
        } else {
            total + metadata.len()
        }
    })
}

/// Apaga o CONTEÚDO da pasta preservando a própria pasta (evita recriar
/// estruturas e evita erro se algum arquivo estiver preso).
fn clear_directory_contents(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let entries =
        std::fs::read_dir(path).map_err(|error| format!("{}: {error}", path.display()))?;
    for entry in entries.flatten() {
        let entry_path = entry.path();
        let result = if entry_path.is_dir() {
            std::fs::remove_dir_all(&entry_path)
        } else {
            std::fs::remove_file(&entry_path)
        };
        result.map_err(|error| format!("{}: {error}", entry_path.display()))?;
    }
    Ok(())
}

fn clear_category(app: &AppHandle, id: &str) -> Result<u64, String> {
    // goldbergSaves é progresso real do jogador: só sai sob pedido explícito
    // (chamada direta à categoria), nunca junto com os caches puros.
    let path = category_path(app, id).ok_or_else(|| format!("Categoria desconhecida: {id}"))?;

    // WebView2: apagar o EBWebView inteiro falha (arquivos travados) e
    // destruiria localStorage/cookies. Limpa só as subpastas de cache puro e
    // deixa flag para o próximo boot completar antes do webview existir.
    if id == "webviewCache" {
        let freed = webview_cache_usage(&path);
        webview_cache_wipe_safe_subdirs(&path)?;
        if let Some(local_root) = app.path().app_local_data_dir().ok() {
            let _ = std::fs::write(local_root.join(WEBVIEW_CLEANUP_FLAG_FILE), b"");
        }
        return Ok(freed);
    }

    let freed = directory_size(&path);
    clear_directory_contents(&path)?;
    if id == "images" {
        Ok(freed + crate::image_cache::clear_image_cache_metadata(app))
    } else {
        Ok(freed)
    }
}

#[tauri::command]
pub fn storage_usage(app: AppHandle) -> StorageUsage {
    let categories = CATEGORY_IDS
        .iter()
        .map(|id| match category_path(&app, id) {
            Some(path) => {
                let present = path.exists();
                StorageCategory {
                    id,
                    present,
                    bytes: if present { directory_size(&path) } else { 0 },
                }
            }
            None => StorageCategory {
                id,
                bytes: 0,
                present: false,
            },
        })
        .collect::<Vec<_>>();
    let total_bytes = categories.iter().map(|category| category.bytes).sum();
    StorageUsage {
        categories,
        total_bytes,
    }
}

#[tauri::command]
pub fn clear_app_caches(app: AppHandle) -> ClearOutcome {
    let mut outcome = ClearOutcome {
        cleared: Vec::new(),
        failed: Vec::new(),
        freed_bytes: 0,
    };
    for id in PURE_CACHE_CATEGORIES {
        match clear_category(&app, id) {
            Ok(freed) => {
                outcome.freed_bytes += freed;
                outcome.cleared.push(id.to_string());
            }
            Err(reason) => outcome.failed.push(ClearFailure {
                id: id.to_string(),
                reason,
            }),
        }
    }
    outcome
}

#[tauri::command]
pub fn clear_storage_category(app: AppHandle, id: String) -> Result<ClearOutcome, String> {
    if !CATEGORY_IDS.contains(&id.as_str()) {
        return Err(format!("Categoria desconhecida: {id}"));
    }
    let mut outcome = ClearOutcome {
        cleared: Vec::new(),
        failed: Vec::new(),
        freed_bytes: 0,
    };
    match clear_category(&app, &id) {
        Ok(freed) => {
            outcome.freed_bytes += freed;
            outcome.cleared.push(id);
        }
        Err(reason) => outcome.failed.push(ClearFailure { id, reason }),
    }
    Ok(outcome)
}

// ————————————————————————————————————————————————————————————————
// Cache do WebView2 (categoria `webviewCache`)
//
// O EBWebView não pode ser apagado inteiro: enquanto o app roda o SO mantém
// arquivos travados, e a pasta também guarda dados do usuário (localStorage,
// cookies, IndexedDB). A limpeza segura atinge apenas as subpastas de cache
// puro e, quando feita com o app aberto, deixa um "pedido pendente" para o
// próximo boot completar o serviço antes do webview existir.
// ————————————————————————————————————————————————————————————————

/// Subpastas do perfil WebView2 que são cache puro e recriáveis.
pub(crate) const WEBVIEW_CACHE_SUBDIRS: [&str; 4] =
    ["Cache", "Code Cache", "GPUCache", "ShaderCache"];

/// Acima disso, o boot limpa o cache do WebView2 por conta própria.
const WEBVIEW_AUTO_CLEAN_THRESHOLD_BYTES: u64 = 512 * 1024 * 1024;

/// Espelha `identifier` do tauri.conf.json — necessário porque a manutenção
/// roda ANTES do Builder/Tauri existirem. Se um dia o identifier mudar,
/// atualize aqui também.
const APP_IDENTIFIER: &str = "com.ghostbox.app";

const WEBVIEW_CLEANUP_FLAG_FILE: &str = "webview-cache-cleanup.pending";

fn app_local_root() -> Option<PathBuf> {
    Some(PathBuf::from(std::env::var("LOCALAPPDATA").ok()?).join(APP_IDENTIFIER))
}

/// Tamanho ocupado apenas pelas subpastas de cache puro do perfil.
fn webview_cache_usage(webview_root: &Path) -> u64 {
    WEBVIEW_CACHE_SUBDIRS
        .iter()
        .map(|subdir| directory_size(&webview_root.join(subdir)))
        .sum()
}

/// Apaga as subpastas de cache puro preservando dados do usuário
/// (Local Storage, IndexedDB, Cookies etc.). Best-effort por arquivo.
fn webview_cache_wipe_safe_subdirs(webview_root: &Path) -> Result<(), String> {
    for subdir in WEBVIEW_CACHE_SUBDIRS {
        clear_directory_contents(&webview_root.join(subdir))?;
    }
    Ok(())
}

/// Manutenção executada no boot, ANTES do Builder criar o webview:
/// - se existe flag pendente de uma limpeza manual com app aberto, completa;
/// - se o cache passou do teto automático, poda sem esperar o usuário.
pub fn webview_cache_boot_maintenance() {
    let Some(local_root) = app_local_root() else {
        return;
    };
    let flag_path = local_root.join(WEBVIEW_CLEANUP_FLAG_FILE);
    let forced = flag_path.is_file();
    let webview_root = local_root.join("EBWebView");

    if !webview_root.exists() {
        if forced {
            let _ = std::fs::remove_file(&flag_path);
        }
        return;
    }

    if forced || webview_cache_usage(&webview_root) > WEBVIEW_AUTO_CLEAN_THRESHOLD_BYTES {
        let _ = webview_cache_wipe_safe_subdirs(&webview_root);
        let _ = std::fs::remove_file(&flag_path);
    }
}

/// Varredura leve na inicialização: temporários órfãos de escritas atômicas
/// interrompidas por crash. Só arquivos soltos na raiz do app data com mais
/// de 24h — nada recursivo, nada recente (evita brigar com escrita em andamento).
pub fn startup_temp_sweep(app: &AppHandle) {
    let Ok(app_data) = app.path().app_data_dir() else {
        return;
    };
    const STALE_AFTER: std::time::Duration = std::time::Duration::from_secs(24 * 60 * 60);
    let cutoff = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|now| now.saturating_sub(STALE_AFTER))
        .unwrap_or_default();

    let Ok(entries) = std::fs::read_dir(&app_data) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_temp = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.ends_with(".tmp"));
        if !is_temp || !path.is_file() {
            continue;
        }
        let stale = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
            .is_some_and(|modified| modified <= cutoff);
        if stale {
            let _ = std::fs::remove_file(&path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pure_cache_categories_never_include_user_progress() {
        // goldbergSaves é progresso do jogador: JAMAIS pode sair no botão
        // "Limpar caches", que promete não perder nada.
        assert!(!PURE_CACHE_CATEGORIES.contains(&"goldbergSaves"));
        assert!(!PURE_CACHE_CATEGORIES.contains(&"ludusaviConfig"));
    }

    #[test]
    fn directory_size_sums_files_recursively() {
        let root = std::env::temp_dir().join(format!(
            "ghostbox-storage-size-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let nested = root.join("sub").join("deeper");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(root.join("a.bin"), vec![0u8; 100]).unwrap();
        std::fs::write(nested.join("b.bin"), vec![0u8; 50]).unwrap();

        assert_eq!(directory_size(&root), 150);

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn directory_size_tolerates_missing_paths() {
        assert_eq!(directory_size(Path::new("Z:\\nao-existe-ghostbox")), 0);
    }

    #[test]
    fn clearing_a_missing_directory_is_success() {
        let missing =
            std::env::temp_dir().join(format!("ghostbox-clear-{}", uuid::Uuid::new_v4().simple()));
        // Não existe: clear é no-op de sucesso.
        clear_directory_contents(&missing).unwrap();
    }

    #[test]
    fn clearing_keeps_the_folder_but_removes_contents() {
        let root = std::env::temp_dir().join(format!(
            "ghostbox-clear-keep-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let nested = root.join("entries");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("x.json"), b"{}").unwrap();
        std::fs::write(root.join("meta.json"), b"{}").unwrap();

        clear_directory_contents(&root).unwrap();

        assert!(root.is_dir(), "a pasta em si deve permanecer");
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn category_ids_are_unique_and_cover_the_frontend_contract() {
        let mut sorted = CATEGORY_IDS.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), CATEGORY_IDS.len(), "ids duplicados");
        for id in CATEGORY_IDS {
            assert!(!id.is_empty());
        }
    }

    #[test]
    fn webview_usage_counts_only_cache_subdirs() {
        let root = std::env::temp_dir().join(format!(
            "ghostbox-webview-usage-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(root.join("Cache")).unwrap();
        std::fs::create_dir_all(root.join("Local Storage")).unwrap();
        std::fs::write(root.join("Cache").join("f.bin"), vec![0u8; 30]).unwrap();
        std::fs::write(root.join("Local Storage").join("db"), b"user-data").unwrap();

        assert_eq!(webview_cache_usage(&root), 30);

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn webview_wipe_removes_caches_but_keeps_user_data() {
        let root = std::env::temp_dir().join(format!(
            "ghostbox-webview-wipe-{}",
            uuid::Uuid::new_v4().simple()
        ));
        for subdir in WEBVIEW_CACHE_SUBDIRS {
            std::fs::create_dir_all(root.join(subdir)).unwrap();
            std::fs::write(root.join(subdir).join("blob.bin"), vec![0u8; 10]).unwrap();
        }
        // Dados que NUNCA podem sair.
        std::fs::create_dir_all(root.join("Local Storage")).unwrap();
        std::fs::create_dir_all(root.join("IndexedDB")).unwrap();
        std::fs::write(root.join("Local Storage").join("leveldb"), b"session").unwrap();

        webview_cache_wipe_safe_subdirs(&root).expect("wipe deve ter sucesso");

        for subdir in WEBVIEW_CACHE_SUBDIRS {
            let remaining = std::fs::read_dir(root.join(subdir)).unwrap().count();
            assert_eq!(remaining, 0, "{subdir} deveria estar vazia");
        }
        assert!(
            root.join("Local Storage").join("leveldb").is_file(),
            "localStorage é dado do usuário: intocado"
        );
        assert!(root.join("IndexedDB").is_dir());

        std::fs::remove_dir_all(&root).ok();
    }
}
