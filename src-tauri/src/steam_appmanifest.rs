//! Faz o Steam reconhecer um download do GhostBox como instalacao oficial.
//!
//! Tres coisas precisam existir, nessa ordem:
//!
//! 1. os depots mesclados em `<library>\steamapps\common\<installdir>`
//!    (responsabilidade de `cdndownload.rs`);
//! 2. `<library>\steamapps\appmanifest_<appid>.acf` — este modulo;
//! 3. a raiz registrada como Steam Library em `libraryfolders.vdf` — este modulo.
//!
//! O ACF faz o Steam **montar** o jogo; nao faz ele ser **owned**. A licenca
//! continua vindo de `luatools_add_game`.

use std::path::{Path, PathBuf};

/// `StateFlags 4` = fully installed. Qualquer outro valor coloca o app em
/// "update required"/"validating" e o Steam re-baixa por cima do que ja esta la.
const STATE_FLAG_FULLY_INSTALLED: &str = "4";
/// `AutoUpdateBehavior 1` = so atualiza quando o jogo e iniciado. Com `0` o
/// cliente dispara update sozinho e sobrescreve o conteudo baixado.
const AUTO_UPDATE_ONLY_ON_LAUNCH: &str = "1";

/// `(depot_id, manifest_id, bytes)`.
pub type InstalledDepot = (u32, u64, u64);

pub fn steamapps_dir(library_root: &Path) -> PathBuf {
    library_root.join("steamapps")
}

pub fn install_dir_path(library_root: &Path, install_dir: &str) -> PathBuf {
    steamapps_dir(library_root).join("common").join(install_dir)
}

pub fn appmanifest_path(library_root: &Path, app_id: &str) -> PathBuf {
    steamapps_dir(library_root).join(format!("appmanifest_{app_id}.acf"))
}

fn escape_vdf(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

/// O campo com maior custo de erro e o `installdir`: se estiver errado o Steam
/// mostra o jogo instalado e falha ao iniciar, porque resolve o executavel por
/// esse caminho. Um `.exe` em qualquer nivel da pasta e o sinal mais barato de
/// que os depots caíram onde deviam.
fn contains_executable(directory: &Path, depth: u32) -> bool {
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
            subdirectories.push(path);
        } else if path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
        {
            return true;
        }
    }
    subdirectories
        .into_iter()
        .any(|path| contains_executable(&path, depth + 1))
}

fn directory_size(directory: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| {
            let path = entry.path();
            if path.is_dir() {
                directory_size(&path)
            } else {
                std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0)
            }
        })
        .sum()
}

/// Bytes reais em disco do conteudo instalado, para `SizeOnDisk`. Preferido
/// sobre a soma dos tamanhos de depot: depots do mesmo app podem sobrescrever
/// arquivos entre si (last-write-wins, igual ao Steam) e a soma inflaria.
pub fn installed_size_on_disk(library_root: &Path, install_dir: &str) -> u64 {
    directory_size(&install_dir_path(library_root, install_dir))
}

fn render_appmanifest(
    app_id: &str,
    name: &str,
    install_dir: &str,
    build_id: &str,
    depots: &[InstalledDepot],
    size_on_disk: u64,
    last_owner: &str,
) -> String {
    let mut out = String::new();
    out.push_str("\"AppState\"\n{\n");
    let mut field = |key: &str, value: &str| {
        out.push_str(&format!("\t\"{}\"\t\t\"{}\"\n", key, escape_vdf(value)));
    };

    field("appid", app_id);
    field("Universe", "1");
    field("name", name);
    field("StateFlags", STATE_FLAG_FULLY_INSTALLED);
    field("installdir", install_dir);
    field("LastUpdated", &now_unix().to_string());
    field("SizeOnDisk", &size_on_disk.to_string());
    field("StagingSize", "0");
    field("buildid", build_id);
    field("LastOwner", last_owner);
    field("UpdateResult", "0");
    field("BytesToDownload", "0");
    field("BytesDownloaded", "0");
    field("BytesToStage", "0");
    field("BytesStaged", "0");
    // Igual ao `buildid`: se o alvo for maior que o instalado, o Steam marca
    // update pendente e re-baixa tudo no proximo launch.
    field("TargetBuildID", build_id);
    field("AutoUpdateBehavior", AUTO_UPDATE_ONLY_ON_LAUNCH);
    field("AllowOtherDownloadsWhileRunning", "0");
    field("ScheduledAutoUpdate", "0");

    out.push_str("\t\"InstalledDepots\"\n\t{\n");
    for (depot_id, manifest_id, size) in depots {
        out.push_str(&format!("\t\t\"{depot_id}\"\n\t\t{{\n"));
        out.push_str(&format!("\t\t\t\"manifest\"\t\t\"{manifest_id}\"\n"));
        out.push_str(&format!("\t\t\t\"size\"\t\t\"{size}\"\n"));
        out.push_str("\t\t}\n");
    }
    out.push_str("\t}\n");

    out.push_str("\t\"UserConfig\"\n\t{\n\t\t\"language\"\t\t\"english\"\n\t}\n");
    out.push_str("\t\"MountedConfig\"\n\t{\n\t\t\"language\"\t\t\"english\"\n\t}\n");
    out.push_str("}\n");
    out
}

/// Escreve o ACF de forma atomica (`.tmp` + rename) para o Steam nunca ler um
/// arquivo pela metade. Chamar **somente** quando todos os depots completaram —
/// download parcial ou cancelado nao pode deixar ACF para tras.
#[allow(clippy::too_many_arguments)]
pub fn write_appmanifest(
    library_root: &Path,
    app_id: &str,
    name: &str,
    install_dir: &str,
    build_id: &str,
    depots: &[InstalledDepot],
    size_on_disk: u64,
    last_owner: &str,
) -> Result<PathBuf, String> {
    if app_id.trim().is_empty() {
        return Err("AppID vazio ao escrever o appmanifest.".to_string());
    }
    if install_dir.trim().is_empty() {
        return Err("installdir vazio ao escrever o appmanifest.".to_string());
    }

    let installed = install_dir_path(library_root, install_dir);
    if !installed.is_dir() {
        return Err(format!(
            "Pasta de instalacao nao encontrada: {}",
            installed.display()
        ));
    }
    if !contains_executable(&installed, 0) {
        return Err(format!(
            "Nenhum executavel encontrado em {} — o installdir provavelmente esta errado e o Steam mostraria o jogo instalado sem conseguir inicia-lo.",
            installed.display()
        ));
    }

    let steamapps = steamapps_dir(library_root);
    std::fs::create_dir_all(&steamapps).map_err(|error| error.to_string())?;

    let contents = render_appmanifest(
        app_id,
        name,
        install_dir,
        build_id,
        depots,
        size_on_disk,
        last_owner,
    );

    let target = appmanifest_path(library_root, app_id);
    let temporary = steamapps.join(format!("appmanifest_{app_id}.acf.tmp"));
    std::fs::write(&temporary, contents).map_err(|error| error.to_string())?;
    std::fs::rename(&temporary, &target).map_err(|error| {
        let _ = std::fs::remove_file(&temporary);
        error.to_string()
    })?;

    Ok(target)
}

pub fn remove_appmanifest(library_root: &Path, app_id: &str) -> Result<bool, String> {
    let target = appmanifest_path(library_root, app_id);
    if !target.exists() {
        return Ok(false);
    }
    std::fs::remove_file(&target).map_err(|error| error.to_string())?;
    Ok(true)
}

/// Copia os `.manifest` usados para o `depotcache` da biblioteca de destino.
/// Nao e obrigatorio para o jogo abrir, mas sem isso um "Verify integrity of
/// game files" no Steam forca re-download completo.
///
/// Os arquivos ja existem em `<steam>\depotcache` porque o worker so baixa um
/// depot cujo manifest esteja em disco — e ai que `luatools_add_game` os poe.
pub fn copy_depot_manifests(
    steam_path: &Path,
    library_root: &Path,
    depots: &[(u32, u64)],
) -> usize {
    let destination = steamapps_dir(library_root).join("depotcache");
    if std::fs::create_dir_all(&destination).is_err() {
        return 0;
    }

    let source_root = steam_path.join("depotcache");
    depots
        .iter()
        .filter(|(depot_id, manifest_id)| {
            let file_name = format!("{depot_id}_{manifest_id}.manifest");
            let source = source_root.join(&file_name);
            source.is_file() && std::fs::copy(&source, destination.join(&file_name)).is_ok()
        })
        .count()
}

/// SteamID64 do usuario logado, para o campo `LastOwner`. Sem ele o Steam ainda
/// monta o jogo, mas a UI marca o app como "nao e seu".
///
/// A fonte e `config/loginusers.vdf`, e nao o perfil salvo no GhostBox: o ACF
/// precisa do dono da *instalacao da Steam*, que pode nao ser a conta que o
/// usuario configurou no app.
pub fn resolve_last_owner(steam_path: &str) -> String {
    let path = Path::new(steam_path).join("config").join("loginusers.vdf");
    let Ok(contents) = std::fs::read_to_string(path) else {
        return String::new();
    };

    let mut first_id = String::new();
    let mut current_id = String::new();
    for line in contents.lines() {
        let trimmed = line.trim();
        if let Some(candidate) = trimmed
            .strip_prefix('"')
            .and_then(|rest| rest.strip_suffix('"'))
            .filter(|candidate| candidate.len() == 17 && candidate.bytes().all(|b| b.is_ascii_digit()))
        {
            current_id = candidate.to_string();
            if first_id.is_empty() {
                first_id = current_id.clone();
            }
            continue;
        }
        if crate::steam::parse_vdf_string_value(trimmed, "MostRecent").as_deref() == Some("1")
            && !current_id.is_empty()
        {
            return current_id;
        }
    }

    first_id
}

/// Se o jogo ja estiver instalado de verdade em outra biblioteca, escrever um
/// segundo ACF cria dois donos para o mesmo appid e o Steam passa a alternar
/// entre eles. Devolve o caminho conflitante, quando existe.
pub fn conflicting_library(steam_path: &str, library_root: &Path, app_id: &str) -> Option<String> {
    let root_key = normalized_path_key(&library_root.to_string_lossy());
    crate::steam::read_steam_library_paths(steam_path)
        .into_iter()
        .find(|library| {
            normalized_path_key(library) != root_key
                && appmanifest_path(Path::new(library), app_id).is_file()
        })
}

fn normalized_path_key(value: &str) -> String {
    value
        .trim()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

/// Registra `library_root` como Steam Library em `libraryfolders.vdf` e garante
/// que `app_id` conste no bloco `apps` dessa entrada.
///
/// **Falha de proposito com a Steam aberta.** O cliente mantem o arquivo em
/// memoria e o reescreve ao sair, entao qualquer alteracao feita com ele rodando
/// e perdida silenciosamente — o pior modo de falha possivel aqui.
pub fn register_library_folder(
    steam_path: &str,
    library_root: &Path,
    app_id: &str,
    size_on_disk: u64,
) -> Result<(), String> {
    if crate::steam::steam_is_running() {
        return Err(
            "Feche a Steam antes de concluir o download: com o cliente aberto, a alteracao em libraryfolders.vdf e descartada ao sair."
                .to_string(),
        );
    }

    let libraryfolders = Path::new(steam_path)
        .join("steamapps")
        .join("libraryfolders.vdf");
    let contents = std::fs::read_to_string(&libraryfolders)
        .map_err(|error| format!("Falha ao ler libraryfolders.vdf: {error}"))?;

    let root_display = library_root.to_string_lossy().to_string();
    let root_key = normalized_path_key(&root_display);

    let already_registered = contents.lines().any(|line| {
        crate::steam::parse_vdf_string_value(line, "path")
            .is_some_and(|path| normalized_path_key(&path) == root_key)
    });

    let updated = if already_registered {
        match ensure_app_in_library_block(&contents, &root_key, app_id, size_on_disk) {
            Some(updated) => updated,
            // Ja registrado e o app ja consta: nada a escrever, nada a fazer backup.
            None => return Ok(()),
        }
    } else {
        append_library_block(&contents, &root_display, app_id, size_on_disk)?
    };

    // Backup antes de escrever: libraryfolders.vdf lista TODAS as bibliotecas do
    // usuario, e um erro aqui esconderia jogos legitimos da Steam.
    let backup = libraryfolders.with_extension(format!("vdf.ghostbox-{}.bak", now_unix()));
    std::fs::copy(&libraryfolders, &backup)
        .map_err(|error| format!("Falha ao fazer backup de libraryfolders.vdf: {error}"))?;

    let temporary = libraryfolders.with_extension("vdf.tmp");
    std::fs::write(&temporary, updated).map_err(|error| error.to_string())?;
    std::fs::rename(&temporary, &libraryfolders).map_err(|error| {
        let _ = std::fs::remove_file(&temporary);
        error.to_string()
    })?;

    Ok(())
}

/// Insere `"<app_id>" "<size>"` no bloco `apps` da entrada cujo `path` bate com
/// `root_key`. Devolve `None` quando o app ja esta la (nada a escrever).
fn ensure_app_in_library_block(
    contents: &str,
    root_key: &str,
    app_id: &str,
    size_on_disk: u64,
) -> Option<String> {
    let lines: Vec<&str> = contents.lines().collect();

    let path_line = lines.iter().position(|line| {
        crate::steam::parse_vdf_string_value(line, "path")
            .is_some_and(|path| normalized_path_key(&path) == root_key)
    })?;

    // A partir do `path`, o proximo `"apps"` pertence a esta entrada — o bloco
    // fecha antes que outro `path` apareca.
    let mut apps_line = None;
    for (index, line) in lines.iter().enumerate().skip(path_line + 1) {
        if crate::steam::parse_vdf_string_value(line, "path").is_some() {
            break;
        }
        if line.trim().eq_ignore_ascii_case("\"apps\"") {
            apps_line = Some(index);
            break;
        }
    }
    let apps_line = apps_line?;
    let open_brace = lines
        .iter()
        .enumerate()
        .skip(apps_line + 1)
        .find(|(_, line)| line.trim() == "{")
        .map(|(index, _)| index)?;

    let needle = format!("\"{app_id}\"");
    for line in lines.iter().skip(open_brace + 1) {
        if line.trim() == "}" {
            break;
        }
        if line.trim().starts_with(&needle) {
            return None;
        }
    }

    let indent = lines
        .get(open_brace + 1)
        .map(|line| line.len() - line.trim_start().len())
        .filter(|width| *width > 0)
        .unwrap_or(4);

    let mut out: Vec<String> = lines.iter().map(|line| line.to_string()).collect();
    out.insert(
        open_brace + 1,
        format!(
            "{}\"{}\"\t\t\"{}\"",
            " ".repeat(indent),
            app_id,
            size_on_disk
        ),
    );
    Some(format!("{}\n", out.join("\n")))
}

/// Acrescenta uma entrada nova antes do `}` que fecha `"libraryfolders"`.
fn append_library_block(
    contents: &str,
    library_root: &str,
    app_id: &str,
    size_on_disk: u64,
) -> Result<String, String> {
    let closing = contents
        .rfind('}')
        .ok_or_else(|| "libraryfolders.vdf malformado: nao achei o fecha-chaves final.".to_string())?;

    // Indices das entradas sao strings numericas sequenciais; a nova vai depois
    // da maior existente para nao colidir com nenhuma biblioteca do usuario.
    let next_index = contents
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            let inner = trimmed.strip_prefix('"')?.strip_suffix('"')?;
            inner.parse::<u32>().ok()
        })
        .max()
        .map(|highest| highest + 1)
        .unwrap_or(1);

    let block = format!(
        "\t\"{next_index}\"\n\t{{\n\t\t\"path\"\t\t\"{path}\"\n\t\t\"label\"\t\t\"\"\n\t\t\"contentid\"\t\t\"0\"\n\t\t\"totalsize\"\t\t\"0\"\n\t\t\"update_clean_bytes_tally\"\t\t\"0\"\n\t\t\"time_last_update_verified\"\t\t\"0\"\n\t\t\"apps\"\n\t\t{{\n\t\t\t\"{app_id}\"\t\t\"{size_on_disk}\"\n\t\t}}\n\t}}\n",
        path = escape_vdf(library_root)
    );

    let mut out = String::with_capacity(contents.len() + block.len());
    out.push_str(&contents[..closing]);
    out.push_str(&block);
    out.push_str(&contents[closing..]);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_manifest() -> String {
        render_appmanifest(
            "367520",
            "Hollow Knight",
            "Hollow Knight",
            "13214117",
            &[(367521, 8_912_243_411_281_072_000, 1_234), (367522, 42, 99)],
            9_999,
            "76561198000000000",
        )
    }

    #[test]
    fn manifest_marks_the_app_as_fully_installed_and_pins_the_build() {
        let acf = sample_manifest();
        assert!(acf.contains("\"StateFlags\"\t\t\"4\""));
        assert!(acf.contains("\"AutoUpdateBehavior\"\t\t\"1\""));
        assert!(acf.contains("\"buildid\"\t\t\"13214117\""));
        assert!(acf.contains("\"TargetBuildID\"\t\t\"13214117\""));
    }

    #[test]
    fn manifest_lists_every_installed_depot_with_manifest_and_size() {
        let acf = sample_manifest();
        assert!(acf.contains("\"367521\""));
        assert!(acf.contains("\"manifest\"\t\t\"8912243411281072000\""));
        assert!(acf.contains("\"size\"\t\t\"1234\""));
        assert!(acf.contains("\"367522\""));
        assert!(acf.contains("\"manifest\"\t\t\"42\""));
    }

    #[test]
    fn manifest_escapes_backslashes_so_the_parser_does_not_see_an_escape() {
        let acf = render_appmanifest("1", "A\\B", "A\\B", "2", &[], 0, "3");
        assert!(acf.contains("\"installdir\"\t\t\"A\\\\B\""));
    }

    const LIBRARYFOLDERS: &str = "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"C:\\\\Steam\"\n\t\t\"apps\"\n\t\t{\n\t\t\t\"440\"\t\t\"100\"\n\t\t}\n\t}\n}\n";

    #[test]
    fn appends_a_new_entry_with_the_next_free_index() {
        let updated = append_library_block(LIBRARYFOLDERS, "E:\\GhostBoxDownloads", "367520", 4096)
            .expect("deve inserir");
        assert!(updated.contains("\"1\""));
        assert!(updated.contains("\"path\"\t\t\"E:\\\\GhostBoxDownloads\""));
        assert!(updated.contains("\"367520\"\t\t\"4096\""));
        // A biblioteca existente do usuario continua intacta.
        assert!(updated.contains("\"path\"\t\t\"C:\\\\Steam\""));
        assert!(updated.contains("\"440\"\t\t\"100\""));
    }

    #[test]
    fn adds_the_app_to_an_already_registered_library() {
        let updated = ensure_app_in_library_block(LIBRARYFOLDERS, "c:\\steam", "367520", 4096)
            .expect("deve inserir o app");
        assert!(updated.contains("\"367520\"\t\t\"4096\""));
        assert!(updated.contains("\"440\"\t\t\"100\""));
    }

    #[test]
    fn does_not_rewrite_when_the_app_is_already_listed() {
        assert!(ensure_app_in_library_block(LIBRARYFOLDERS, "c:\\steam", "440", 100).is_none());
    }

    #[test]
    fn path_matching_ignores_case_separator_and_trailing_slash() {
        assert_eq!(normalized_path_key("E:/Games/"), normalized_path_key("e:\\games"));
    }
}
