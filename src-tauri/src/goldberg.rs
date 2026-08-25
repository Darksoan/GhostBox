//! Integração com o emulador Goldberg/GSE (gbe_fork).
//!
//! Prepara jogos baixados para reconhecer conquistas da Steam **sem o cliente
//! Steam aberto**: instala a `steam_api(64).dll` do emulador ao lado do
//! executável do jogo, grava a configuração mínima (`steam_appid.txt`,
//! `configs.user.ini`, `configs.overlay.ini`) e expõe a leitura do arquivo
//! `achievements.json` que o emulador mantém por jogo.
//!
//! Layout dos saves do emulador (confirmado na fonte do gbe_fork):
//! `<local_save_path>\<appid>\achievements.json`, onde `local_save_path`
//! aponta para `%LOCALAPPDATA%\GhostBox\gse-saves\`. O JSON tem a forma
//! `{ "<api_name>": { "earned": true, "earned_time": 1234567890 } }`.
//!
//! Tudo aqui é *melhor esforço*: se os binários do emulador não estiverem
//! presentes (ver `scripts/fetch-gbe-fork.ps1`, que instala em
//! `src-tauri/binaries/gbe_fork/{x86,x64}/`), o jogo continua lançando
//! normalmente, apenas sem suporte offline de conquistas.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

const GBE_PATH_ENV_VAR: &str = "GHOSTBOX_GBE_PATH";
/// Pasta base dos saves do emulador, dentro do perfil local do usuário.
const SAVES_SUBDIR: &str = r"GhostBox\gse-saves";
/// Nome da subpasta de cada arquitetura dentro de `binaries/gbe_fork/`.
const ARCH_DIRS: [(DllArch, &str); 2] = [(DllArch::X64, "x64"), (DllArch::X86, "x86")];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DllArch {
    X86,
    X64,
}

impl DllArch {
    fn dll_name(self) -> &'static str {
        match self {
            DllArch::X86 => "steam_api.dll",
            DllArch::X64 => "steam_api64.dll",
        }
    }

    /// Backup do DLL original do jogo (a `steam_api` oficial renomeada).
    fn original_backup_name(self) -> String {
        format!("{}.ghostbox-original", self.dll_name())
    }
}

/// Raiz onde o GhostBox guarda os saves do emulador, por app id.
pub fn saves_root() -> PathBuf {
    let local_appdata = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string());
    Path::new(&local_appdata).join(SAVES_SUBDIR)
}

/// Lê os nomes de API das conquistas desbloqueadas que o emulador persistiu
/// para o jogo. Vazio quando não há arquivo (jogo nunca rodou com GSE).
pub fn read_goldberg_unlocked_names(app_id: &str) -> HashSet<String> {
    let normalized = normalize_app_id(app_id);
    if normalized.is_empty() {
        return HashSet::new();
    }
    let file_path = saves_root().join(&normalized).join("achievements.json");
    let Ok(contents) = fs::read_to_string(file_path) else {
        return HashSet::new();
    };
    parse_unlocked_names(&contents)
}

/// Remove o progresso offline do jogo (pasta `<saves>/<appid>`). Chamado
/// quando o jogo é removido pelo GhostBox — best-effort, erro é ignorado.
pub fn remove_game_saves(app_id: &str) {
    let normalized = normalize_app_id(app_id);
    if normalized.is_empty() {
        return;
    }
    let _ = fs::remove_dir_all(saves_root().join(normalized));
}

fn normalize_app_id(app_id: &str) -> String {
    app_id.chars().filter(|c| c.is_ascii_digit()).collect()
}

fn parse_unlocked_names(json_contents: &str) -> HashSet<String> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(json_contents) else {
        return HashSet::new();
    };
    value
        .as_object()
        .map(|entries| {
            entries
                .iter()
                .filter(|(_, info)| info.get("earned").and_then(|v| v.as_bool()) == Some(true))
                .map(|(name, _)| name.clone())
                .collect()
        })
        .unwrap_or_default()
}

/// Localiza os binários do emulador. Ordem: variável de ambiente
/// `GHOSTBOX_GBE_PATH`, pasta ao lado do executável do GhostBox (instalador
/// empacota em `binaries/gbe_fork` via `resources`) e, por fim,
/// `src-tauri/binaries/gbe_fork` do repositório (desenvolvimento).
fn find_vendor_dir() -> Option<PathBuf> {
    if let Ok(custom) = std::env::var(GBE_PATH_ENV_VAR) {
        let candidate = PathBuf::from(custom.trim());
        if candidate.is_dir() {
            return Some(candidate);
        }
    }
    if let Ok(exe_dir) = std::env::current_exe() {
        if let Some(parent) = exe_dir.parent() {
            for candidate in [parent.join("gbe_fork"), parent.join("binaries/gbe_fork")] {
                if candidate.is_dir() {
                    return Some(candidate);
                }
            }
        }
    }
    let dev_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries/gbe_fork");
    if dev_dir.is_dir() {
        return Some(dev_dir);
    }
    None
}

/// O emulador está disponível para instalação? (uso futuro: Settings)
#[allow(dead_code)]
pub fn is_available() -> bool {
    find_vendor_dir().is_some()
}

/// Detecta a arquitetura de um executável/DLL Windows pelo header PE.
/// Retorna `None` para arquivos inválidos ou arquiteturas não suportadas.
fn detect_pe_arch(file_path: &Path) -> Option<DllArch> {
    const PE_HEADER_OFFSET: usize = 0x3C;
    const MACHINE_OFFSET: usize = 4;

    let contents = fs::read(file_path).ok()?;
    if contents.len() < PE_HEADER_OFFSET + MACHINE_OFFSET + 2 {
        return None;
    }
    if &contents[0..2] != b"MZ" {
        return None;
    }
    let pe_offset = u32::from_le_bytes([
        contents[PE_HEADER_OFFSET],
        contents[PE_HEADER_OFFSET + 1],
        contents[PE_HEADER_OFFSET + 2],
        contents[PE_HEADER_OFFSET + 3],
    ]) as usize;
    if contents.len() < pe_offset + MACHINE_OFFSET + 2
        || &contents[pe_offset..pe_offset + 4] != b"PE\0\0"
    {
        return None;
    }
    let machine = u16::from_le_bytes([
        contents[pe_offset + MACHINE_OFFSET],
        contents[pe_offset + MACHINE_OFFSET + 1],
    ]);
    match machine {
        0x8664 => Some(DllArch::X64),
        0x014C => Some(DllArch::X86),
        _ => None,
    }
}

/// Instala o DLL do emulador na pasta do jogo. Preserva uma única cópia do
/// DLL original como `*.ghostbox-original` para permitir restauração manual.
fn install_emulator_dll(game_dir: &Path, arch: DllArch) -> Result<(), String> {
    let vendor_dir = find_vendor_dir()
        .ok_or_else(|| "Binários do emulador Goldberg não encontrados.".to_string())?;
    let (_, vendor_subdir) = ARCH_DIRS
        .iter()
        .find(|(candidate, _)| *candidate == arch)
        .unwrap();
    let source = vendor_dir.join(vendor_subdir).join(arch.dll_name());
    if !source.is_file() {
        return Err(format!(
            "DLL do emulador ausente para {:?}: {}",
            arch,
            source.display()
        ));
    }

    let target = game_dir.join(arch.dll_name());
    let backup = game_dir.join(arch.original_backup_name());

    // Mesmo tamanho => já é a nossa cópia do emulador; nada a reinstalar.
    let source_len = fs::metadata(&source).map(|meta| meta.len()).unwrap_or(1);
    let already_installed =
        target.is_file() && fs::metadata(&target).map(|meta| meta.len()).unwrap_or(0) == source_len;

    if !already_installed {
        if target.is_file() && !backup.exists() {
            fs::rename(&target, &backup).map_err(|error| {
                format!("Failed to preserve original {}: {error}", arch.dll_name())
            })?;
        }
        fs::copy(&source, &target)
            .map_err(|error| format!("Failed to install {}: {error}", arch.dll_name()))?;
    }

    Ok(())
}

fn write_steam_settings(game_dir: &Path, app_id: &str) -> Result<(), String> {
    let settings_dir = game_dir.join("steam_settings");
    fs::create_dir_all(&settings_dir)
        .map_err(|error| format!("Failed to create steam_settings folder: {error}"))?;

    // App ID: lido pelo emulador em `parse_steam_app_id` (fallback após env var).
    fs::write(settings_dir.join("steam_appid.txt"), format!("{app_id}\n"))
        .map_err(|error| format!("Failed to write steam_appid.txt: {error}"))?;

    // Saves controlados pelo GhostBox: uma subpasta por app id, exatamente o
    // layout que `read_goldberg_unlocked_names` espera.
    let saves_root = saves_root();
    fs::create_dir_all(saves_root.join(app_id))
        .map_err(|error| format!("Failed to create emulator save folder: {error}"))?;
    let local_save_path = format!("{}\n", saves_root.display());
    fs::write(
        settings_dir.join("configs.user.ini"),
        format!("[user::saves]\nlocal_save_path={local_save_path}"),
    )
    .map_err(|error| format!("Failed to write configs.user.ini: {error}"))?;

    // Overlay do emulador é experimental e vem DESLIGADO por padrão; reforçamos
    // o silêncio para que a única notificação seja o badge nativo do GhostBox.
    fs::write(
        settings_dir.join("configs.overlay.ini"),
        "[overlay::general]\nenable_experimental_overlay=0\ndisable_achievement_notification=1\ndisable_achievement_progress=1\n",
    )
    .map_err(|error| format!("Failed to write configs.overlay.ini: {error}"))?;

    Ok(())
}

/// Prepara a pasta do jogo (derivada do executável principal) para rodar com o
/// emulador. Erros são retornados, mas quem chama deve tratá-los como aviso —
/// o lançamento do jogo NÃO deve ser bloqueado por falha aqui.
pub fn prepare_game_for_offline_launch(executable: &Path, app_id: &str) -> Result<(), String> {
    let app_id = normalize_app_id(app_id);
    if app_id.is_empty() {
        return Err("Goldberg setup requires a valid app ID.".to_string());
    }
    let game_dir = executable
        .parent()
        .ok_or_else(|| "Game executable has no parent folder.".to_string())?;
    let arch = detect_pe_arch(executable)
        .ok_or_else(|| "Could not determine executable architecture.".to_string())?;

    install_emulator_dll(game_dir, arch)?;
    write_steam_settings(game_dir, &app_id)?;
    Ok(())
}

/// Variáveis de ambiente que o emulador (e os jogos) esperam no processo.
pub fn process_env_vars(app_id: &str) -> [(&'static str, &str); 2] {
    [("SteamAppId", app_id), ("SteamGameId", app_id)]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_fake_pe(machine: u16) -> Vec<u8> {
        let mut bytes = vec![0u8; 0x40];
        bytes[0] = b'M';
        bytes[1] = b'Z';
        // e_lfanew aponta para o header PE logo depois do bloco inicial.
        bytes[0x3C..0x40].copy_from_slice(&0x40u32.to_le_bytes());
        bytes.extend_from_slice(b"PE\0\0");
        bytes.extend_from_slice(&machine.to_le_bytes());
        bytes
    }

    #[test]
    fn detects_x64_and_x86_executables() {
        let temp = std::env::temp_dir().join(format!("ghostbox-pe-test-{}", std::process::id()));
        fs::create_dir_all(&temp).unwrap();

        let x64_path = temp.join("game64.bin");
        fs::write(&x64_path, build_fake_pe(0x8664)).unwrap();
        assert_eq!(detect_pe_arch(&x64_path), Some(DllArch::X64));

        let x86_path = temp.join("game86.bin");
        fs::write(&x86_path, build_fake_pe(0x014C)).unwrap();
        assert_eq!(detect_pe_arch(&x86_path), Some(DllArch::X86));

        let invalid_path = temp.join("not-pe.bin");
        fs::write(&invalid_path, b"hello world").unwrap();
        assert_eq!(detect_pe_arch(&invalid_path), None);

        fs::remove_dir_all(&temp).ok();
    }

    #[test]
    fn parses_goldberg_achievements_json() {
        let json = r#"{
            "ACH_WIN_ONE_GAME": { "earned": true, "earned_time": 1700000000 },
            "ACH_TRAVEL_FAR": { "earned": false, "earned_time": 0 },
            "ACH_COLLECT": { "progress": 3, "max_progress": 10 }
        }"#;
        let unlocked = parse_unlocked_names(json);
        assert!(unlocked.contains("ACH_WIN_ONE_GAME"));
        assert!(!unlocked.contains("ACH_TRAVEL_FAR"));
        assert!(!unlocked.contains("ACH_COLLECT"));
        assert_eq!(unlocked.len(), 1);
    }

    #[test]
    fn tolerates_invalid_json_and_empty_ids() {
        assert!(parse_unlocked_names("not json").is_empty());
        assert!(read_goldberg_unlocked_names("").is_empty());
        assert!(process_env_vars("480").len() == 2);
    }

    /// Fluxo completo contra os binários reais vendoreados. Só roda quando
    /// `scripts/fetch-gbe-fork.ps1` já foi executado nesta máquina.
    #[test]
    fn prepares_a_fake_game_folder_end_to_end() {
        let vendor_dll =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries/gbe_fork/x64/steam_api64.dll");
        if !vendor_dll.is_file() {
            // Binários ausentes (ex.: CI sem o script): nada a validar aqui.
            return;
        }

        let game_dir = std::env::temp_dir().join(format!(
            "ghostbox-gbe-e2e-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_millis()
        ));
        fs::create_dir_all(&game_dir).unwrap();
        // A DLL vendoreada serve de "executável PE x64" para o teste.
        let fake_exe = game_dir.join("Game.exe");
        fs::copy(&vendor_dll, &fake_exe).unwrap();

        prepare_game_for_offline_launch(&fake_exe, "480").expect("setup should succeed");

        assert!(game_dir.join("steam_api64.dll").is_file());
        assert_eq!(
            fs::read_to_string(game_dir.join("steam_settings/steam_appid.txt")).unwrap()
                .trim(),
            "480"
        );
        let user_ini = fs::read_to_string(game_dir.join("steam_settings/configs.user.ini")).unwrap();
        assert!(user_ini.contains("[user::saves]"));
        assert!(user_ini.contains(&saves_root().display().to_string()));
        let overlay_ini =
            fs::read_to_string(game_dir.join("steam_settings/configs.overlay.ini")).unwrap();
        assert!(overlay_ini.contains("disable_achievement_notification=1"));
        assert!(saves_root().join("480").is_dir());

        fs::remove_dir_all(&game_dir).ok();
        // Limpa APENAS a subpasta criada pelo teste; nunca a pasta de saves
        // inteira, que pode conter progresso real de jogos.
        fs::remove_dir_all(saves_root().join("480")).ok();
    }
}




