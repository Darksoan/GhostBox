//! Guarda-roupa do indice de validacao de chunks do worker SteamKit.
//!
//! O worker mantem um indice (`.ghostbox-chunks.json`) que registra quais chunks
//! ja estao validos em disco — e o que torna retomar um download barato, em vez
//! de reler e re-hashear tudo. Duas caracteristicas dele mandam neste modulo:
//!
//! - o caminho e fixo, `<OutputDir>/.ghostbox-chunks.json`
//!   (`SteamKitPocRunner.cs:686`);
//! - o indice vale para **um unico** `manifestid`; carregar com manifest
//!   diferente descarta o arquivo (`LoadValidationIndex`, `:687`).
//!
//! Enquanto cada depot baixava para `depot_<id>` isso funcionava sozinho: um
//! `OutputDir` por depot, um indice por depot. Depois que os depots passaram a
//! mesclar num destino unico — necessario para a Steam montar o jogo — todos
//! dividem o mesmo caminho e cada depot destroi o indice do anterior.
//!
//! O worker nao pode ser corrigido: o `depotdownloader-mod` nunca foi commitado
//! e o C# nao recompila daqui (ver `sidecars/README.md`). Entao quem arruma e o
//! Rust, trocando o arquivo de lugar em volta de cada comando `downloadDepot`.
//! O worker continua enxergando o unico caminho que conhece; este modulo garante
//! que o que esta la seja o indice do depot certo.

use std::path::{Path, PathBuf};

/// Nome que o worker le e escreve. Fixo do lado C#, nao negociavel.
const LIVE_FILE_NAME: &str = ".ghostbox-chunks.json";
/// `SaveValidationIndex` grava neste sufixo antes do rename atomico. Se o
/// processo morre no meio, o `.tmp` fica para tras dentro da pasta do jogo.
const LIVE_TEMP_FILE_NAME: &str = ".ghostbox-chunks.json.tmp";
/// Fora de `steamapps\`, entao a Steam nunca ve estes arquivos — vale mesmo
/// quando a raiz de downloads e uma biblioteca registrada.
const STASH_DIR_NAME: &str = ".ghostbox";

pub fn stash_dir(downloads_root: &Path) -> PathBuf {
    downloads_root.join(STASH_DIR_NAME)
}

pub fn stash_path(downloads_root: &Path, app_id: &str, depot_id: u32) -> PathBuf {
    stash_dir(downloads_root).join(format!("chunks-{app_id}-{depot_id}.json"))
}

pub fn live_path(install_dir: &Path) -> PathBuf {
    install_dir.join(LIVE_FILE_NAME)
}

fn live_temp_path(install_dir: &Path) -> PathBuf {
    install_dir.join(LIVE_TEMP_FILE_NAME)
}

/// Le o `ManifestId` do indice. O JSON e serializado por `System.Text.Json` sem
/// politica de nomes, entao as chaves sao PascalCase:
/// `{"Version":1,"ManifestId":<u64>,"Files":{…}}` (`SteamKitPocRunner.cs:1455`).
///
/// `None` em arquivo ausente, ilegivel, truncado ou sem o campo — todos casos em
/// que o chamador trata o indice como descartavel.
pub fn read_manifest_id(path: &Path) -> Option<u64> {
    let contents = std::fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&contents).ok()?;
    let manifest_id = value.get("ManifestId")?;
    // O campo passa de 2^53, entao um `manifestid` grande chega como numero fora
    // do alcance de f64 ou ja como string, dependendo de quem escreveu.
    manifest_id
        .as_u64()
        .or_else(|| manifest_id.as_str()?.parse().ok())
        .filter(|id| *id > 0)
}

/// Move um arquivo entre volumes possivelmente diferentes. `rename` falha entre
/// volumes no Windows; a raiz de downloads e a pasta do jogo estao sempre no
/// mesmo disco hoje, mas copiar e apagar custa nada e remove a suposicao.
fn move_file(from: &Path, to: &Path) -> std::io::Result<()> {
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)?;
    }
    match std::fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(_) => {
            std::fs::copy(from, to)?;
            std::fs::remove_file(from)
        }
    }
}

/// Devolve ao stash um indice deixado no `install_dir` por uma execucao que
/// morreu antes do swap-out.
///
/// Descartar perderia trabalho valido; adotar as cegas entregaria o indice de um
/// depot ao proximo, que e justamente o defeito sendo corrigido. O proprio
/// arquivo resolve: o `ManifestId` identifica o dono entre os pares que
/// `resolve_depots` devolveu. Sem correspondencia, o indice e de um manifest que
/// nao faz mais parte deste download e pode sair.
pub fn adopt_orphan(
    downloads_root: &Path,
    install_dir: &Path,
    app_id: &str,
    depots: &[(u32, u64)],
) {
    let _ = std::fs::remove_file(live_temp_path(install_dir));

    let live = live_path(install_dir);
    if !live.is_file() {
        return;
    }

    let owner = read_manifest_id(&live).and_then(|manifest_id| {
        depots
            .iter()
            .find(|(_, depot_manifest_id)| *depot_manifest_id == manifest_id)
            .map(|(depot_id, _)| *depot_id)
    });

    match owner {
        Some(depot_id) => {
            let _ = move_file(&live, &stash_path(downloads_root, app_id, depot_id));
        }
        None => {
            let _ = std::fs::remove_file(&live);
        }
    }
}

/// Poe o indice do depot no caminho que o worker le. Stash ausente e o caso
/// normal do primeiro download: `LoadValidationIndex` devolve indice novo quando
/// o arquivo nao existe.
pub fn swap_in(downloads_root: &Path, install_dir: &Path, app_id: &str, depot_id: u32) {
    let stash = stash_path(downloads_root, app_id, depot_id);
    if !stash.is_file() {
        return;
    }
    let _ = move_file(&stash, &live_path(install_dir));
}

/// Recolhe o indice que o worker acabou de gravar e limpa o `.tmp` que ele possa
/// ter deixado. Roda em toda saida do depot — sucesso, erro ou cancelamento —
/// porque `SaveValidationIndex` esta num `finally` e grava nos tres casos.
pub fn swap_out(downloads_root: &Path, install_dir: &Path, app_id: &str, depot_id: u32) {
    let _ = std::fs::remove_file(live_temp_path(install_dir));

    let live = live_path(install_dir);
    if !live.is_file() {
        return;
    }
    let _ = move_file(&live, &stash_path(downloads_root, app_id, depot_id));
}

/// Apaga os indices de um app. Chamado junto da remocao dos arquivos do jogo,
/// senao o stash cresce indefinidamente com indices de jogos desinstalados.
pub fn remove_app_stash(downloads_root: &Path, app_id: &str) {
    let prefix = format!("chunks-{app_id}-");
    let Ok(entries) = std::fs::read_dir(stash_dir(downloads_root)) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if name.starts_with(&prefix) && name.ends_with(".json") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_root(name: &str) -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir()
            .join("ghostbox-chunk-index-tests")
            .join(name);
        let _ = std::fs::remove_dir_all(&root);
        let downloads_root = root.join("GhostBoxDownloads");
        let install_dir = downloads_root
            .join("steamapps")
            .join("common")
            .join("Hollow Knight");
        std::fs::create_dir_all(&install_dir).unwrap();
        (downloads_root, install_dir)
    }

    fn index_json(manifest_id: u64) -> String {
        format!("{{\"Version\":1,\"ManifestId\":{manifest_id},\"Files\":{{}}}}")
    }

    #[test]
    fn swap_in_without_a_stash_leaves_the_install_dir_untouched() {
        let (downloads_root, install_dir) = fixture_root("swap-in-empty");
        swap_in(&downloads_root, &install_dir, "367520", 367521);
        assert!(!live_path(&install_dir).exists());
    }

    #[test]
    fn swap_out_moves_the_worker_index_into_the_stash() {
        let (downloads_root, install_dir) = fixture_root("swap-out");
        std::fs::write(live_path(&install_dir), index_json(111)).unwrap();

        swap_out(&downloads_root, &install_dir, "367520", 367521);

        assert!(!live_path(&install_dir).exists());
        let stashed = stash_path(&downloads_root, "367520", 367521);
        assert_eq!(read_manifest_id(&stashed), Some(111));
    }

    /// A regressao em si: com os depots dividindo o mesmo `OutputDir`, o indice
    /// de um sobrescrevia o do outro. Alternando os dois, cada um tem que
    /// reencontrar o proprio conteudo.
    #[test]
    fn two_depots_keep_separate_indexes_across_alternating_cycles() {
        let (downloads_root, install_dir) = fixture_root("round-trip");

        for (depot_id, manifest_id) in [(367521u32, 111u64), (367522, 222)] {
            swap_in(&downloads_root, &install_dir, "367520", depot_id);
            std::fs::write(live_path(&install_dir), index_json(manifest_id)).unwrap();
            swap_out(&downloads_root, &install_dir, "367520", depot_id);
        }

        // Segunda passada: cada depot recebe de volta o indice que gravou.
        swap_in(&downloads_root, &install_dir, "367520", 367521);
        assert_eq!(read_manifest_id(&live_path(&install_dir)), Some(111));
        swap_out(&downloads_root, &install_dir, "367520", 367521);

        swap_in(&downloads_root, &install_dir, "367520", 367522);
        assert_eq!(read_manifest_id(&live_path(&install_dir)), Some(222));
        swap_out(&downloads_root, &install_dir, "367520", 367522);

        assert!(!live_path(&install_dir).exists());
    }

    #[test]
    fn read_manifest_id_rejects_missing_corrupt_and_fieldless_files() {
        let (_, install_dir) = fixture_root("read-manifest");
        let path = install_dir.join("index.json");

        assert_eq!(read_manifest_id(&path), None);

        std::fs::write(&path, "").unwrap();
        assert_eq!(read_manifest_id(&path), None);

        std::fs::write(&path, "{\"Version\":1,\"ManifestId\":").unwrap();
        assert_eq!(read_manifest_id(&path), None);

        std::fs::write(&path, "{\"Version\":1,\"Files\":{}}").unwrap();
        assert_eq!(read_manifest_id(&path), None);

        // Manifest ids reais passam de 2^53 e podem chegar como string.
        std::fs::write(&path, "{\"ManifestId\":\"8912243411281072000\"}").unwrap();
        assert_eq!(read_manifest_id(&path), Some(8_912_243_411_281_072_000));
    }

    #[test]
    fn adopt_orphan_routes_the_index_to_the_depot_that_owns_the_manifest() {
        let (downloads_root, install_dir) = fixture_root("adopt-owner");
        std::fs::write(live_path(&install_dir), index_json(222)).unwrap();

        adopt_orphan(
            &downloads_root,
            &install_dir,
            "367520",
            &[(367521, 111), (367522, 222)],
        );

        assert!(!live_path(&install_dir).exists());
        assert_eq!(
            read_manifest_id(&stash_path(&downloads_root, "367520", 367522)),
            Some(222)
        );
        assert!(!stash_path(&downloads_root, "367520", 367521).exists());
    }

    #[test]
    fn adopt_orphan_discards_an_index_from_a_manifest_no_longer_in_the_download() {
        let (downloads_root, install_dir) = fixture_root("adopt-stale");
        std::fs::write(live_path(&install_dir), index_json(999)).unwrap();

        adopt_orphan(&downloads_root, &install_dir, "367520", &[(367521, 111)]);

        assert!(!live_path(&install_dir).exists());
        assert!(!stash_path(&downloads_root, "367520", 367521).exists());
    }

    #[test]
    fn stray_temp_files_are_swept_from_the_game_folder() {
        let (downloads_root, install_dir) = fixture_root("temp-sweep");
        let temporary = install_dir.join(LIVE_TEMP_FILE_NAME);

        std::fs::write(&temporary, "partial").unwrap();
        swap_out(&downloads_root, &install_dir, "367520", 367521);
        assert!(!temporary.exists());

        std::fs::write(&temporary, "partial").unwrap();
        adopt_orphan(&downloads_root, &install_dir, "367520", &[(367521, 111)]);
        assert!(!temporary.exists());
    }

    #[test]
    fn remove_app_stash_only_touches_the_requested_app() {
        let (downloads_root, install_dir) = fixture_root("stash-cleanup");
        for (app_id, depot_id) in [("367520", 367521u32), ("367520", 367522), ("730", 731)] {
            std::fs::write(live_path(&install_dir), index_json(1)).unwrap();
            swap_out(&downloads_root, &install_dir, app_id, depot_id);
        }

        remove_app_stash(&downloads_root, "367520");

        assert!(!stash_path(&downloads_root, "367520", 367521).exists());
        assert!(!stash_path(&downloads_root, "367520", 367522).exists());
        assert!(stash_path(&downloads_root, "730", 731).exists());
    }
}
