//! Estado publico de um app na Steam: qual manifest cada depot esta usando em
//! cada branch, e qual `buildid` corresponde a cada branch.
//!
//! Isso existe porque o pacote LuaTools fixa um `setManifestid` que envelhece —
//! ver `crate::cdndownload::resolve_depots`. Sem saber o gid publico atual nao da
//! para dizer se o manifest em maos e o de hoje ou o de 2022, nem para gravar um
//! `buildid` honesto no `appmanifest_<appid>.acf`.
//!
//! Duas fontes, nessa ordem:
//!
//! 1. `<steam>/appcache/appinfo.vdf` — de graca, offline, mas so tem o app se a
//!    Steam local ja o viu alguma vez.
//! 2. `https://api.steamcmd.net/v1/info/<appid>` — PICS publico, sem auth, cobre
//!    qualquer app. E HTTPS de proposito: `crate::manifest_sources` usa os gids
//!    daqui para autorizar (ou recusar) pacote vindo de fonte sem TLS.

use std::collections::BTreeMap;
use std::time::Duration;

const STEAMCMD_API_URL: &str = "https://api.steamcmd.net/v1/info/";
const STEAMCMD_CONNECT_TIMEOUT_SECS: u64 = 5;
const STEAMCMD_REQUEST_TIMEOUT_SECS: u64 = 12;
/// Um app grande (Cyberpunk, CS2) passa de 200 KB de JSON; 8 MB e folga larga
/// sem deixar uma resposta hostil ocupar memoria a vontade.
const MAX_STEAMCMD_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

pub const PUBLIC_BRANCH: &str = "public";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PicsSource {
    LocalAppinfo,
    SteamCmdApi,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicDepot {
    pub depot_id: u32,
    /// gid do branch `public`. Zero quando o depot nao publica nesse branch —
    /// acontece com depot de DLC nao lancada.
    pub manifest_gid: u64,
    pub size: u64,
    /// `config.oslist` do PICS. `None` = depot compartilhado, serve em qualquer
    /// SO; e por isso que ausencia nunca pode ser tratada como "nao e windows".
    pub oslist: Option<String>,
    /// branch -> gid. Guardado inteiro porque `build_id_for_manifest` precisa
    /// achar o branch de um manifest que pode nao ser o publico.
    pub branch_manifests: BTreeMap<String, u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicApp {
    /// `buildid` do branch `public`.
    pub build_id: String,
    pub branch_build_ids: BTreeMap<String, String>,
    pub depots: Vec<PublicDepot>,
    pub source: PicsSource,
}

impl PublicApp {
    pub fn depot(&self, depot_id: u32) -> Option<&PublicDepot> {
        self.depots.iter().find(|depot| depot.depot_id == depot_id)
    }

    /// gid publico do depot, ou `None` quando o depot nao existe no PICS ou nao
    /// publica no branch `public`.
    pub fn public_gid(&self, depot_id: u32) -> Option<u64> {
        self.depot(depot_id)
            .map(|depot| depot.manifest_gid)
            .filter(|gid| *gid > 0)
    }
}

/// `true` quando o depot pode ser instalado em Windows.
///
/// Depot sem `oslist` e compartilhado (conteudo comum, audio, dados) e entra;
/// recusa-lo quebraria a instalacao. So sai quem declara SO e nao inclui
/// windows — sao os depots macOS/Linux que o pacote Lua traz junto e que hoje
/// o GhostBox baixa a toa.
pub fn depot_runs_on_windows(oslist: Option<&str>) -> bool {
    match oslist {
        None => true,
        Some(list) => {
            let list = list.trim();
            list.is_empty()
                || list
                    .split(|character: char| character == ',' || character.is_whitespace())
                    .any(|entry| entry.eq_ignore_ascii_case("windows"))
        }
    }
}

/// `buildid` do branch em que `manifest_gid` foi publicado para `depot_id`.
///
/// Usado ao escrever o ACF: gravar o `buildid` do publico sobre arquivos de uma
/// build antiga faz a Steam anunciar "atualizado" e nunca corrigir o jogo.
pub fn build_id_for_manifest(app: &PublicApp, depot_id: u32, manifest_gid: u64) -> Option<String> {
    let depot = app.depot(depot_id)?;
    // `public` primeiro: varios branches compartilham o mesmo gid
    // (`public-beta` costuma espelhar `public`) e o publico e a resposta certa
    // quando ha empate.
    if depot
        .branch_manifests
        .get(PUBLIC_BRANCH)
        .is_some_and(|gid| *gid == manifest_gid)
    {
        return app.branch_build_ids.get(PUBLIC_BRANCH).cloned();
    }
    depot
        .branch_manifests
        .iter()
        .find(|(_, gid)| **gid == manifest_gid)
        .and_then(|(branch, _)| app.branch_build_ids.get(branch))
        .cloned()
}

/// O estado publico mais recente entre o appinfo local e o PICS remoto.
///
/// Nenhuma das duas fontes e confiavelmente a mais nova: o appinfo local so se
/// atualiza quando a Steam roda e conversa com a PICS, e o `api.steamcmd.net`
/// serve de cache proprio. Escolher uma por preferencia fixa produziria falso
/// alarme de build velha na hora errada, entao as duas sao consultadas e vence
/// o maior `buildid` do branch `public`.
///
/// Sem rede, o local responde sozinho; sem o app no cache local, o remoto.
pub async fn resolve_public_app(steam_path: &str, app_id: &str) -> Option<PublicApp> {
    let local = crate::steam_appinfo::read_public_depots(steam_path, app_id)
        .filter(|app| !app.depots.is_empty());
    let remote = fetch_steamcmd_app(app_id).await;

    match (local, remote) {
        (Some(local), Some(remote)) => {
            Some(if public_build_number(&remote) > public_build_number(&local) {
                remote
            } else {
                local
            })
        }
        (local, remote) => local.or(remote),
    }
}

fn public_build_number(app: &PublicApp) -> u64 {
    app.build_id.trim().parse().unwrap_or(0)
}

pub async fn fetch_steamcmd_app(app_id: &str) -> Option<PublicApp> {
    let app_id = app_id.trim();
    if app_id.is_empty() || !app_id.chars().all(|character| character.is_ascii_digit()) {
        return None;
    }

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(STEAMCMD_CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(STEAMCMD_REQUEST_TIMEOUT_SECS))
        .build()
        .ok()?;
    let response = client
        .get(format!("{STEAMCMD_API_URL}{app_id}"))
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let bytes = response.bytes().await.ok()?;
    if bytes.len() > MAX_STEAMCMD_RESPONSE_BYTES {
        return None;
    }
    let payload: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    parse_steamcmd_payload(&payload, app_id)
}

/// `{"status":"success","data":{"<appid>":{"depots":{...}}}}`.
///
/// Separado de `fetch_steamcmd_app` para poder ser testado sem rede.
pub fn parse_steamcmd_payload(payload: &serde_json::Value, app_id: &str) -> Option<PublicApp> {
    if payload
        .get("status")
        .and_then(|status| status.as_str())
        .is_some_and(|status| !status.eq_ignore_ascii_case("success"))
    {
        return None;
    }
    let depots = payload.get("data")?.get(app_id)?.get("depots")?;
    parse_depots_json(depots, PicsSource::SteamCmdApi)
}

/// `text_number` e `text_value` nao servem aqui: o appinfo binario devolve
/// numero como string e o JSON do steamcmd tambem, mas um dump alternativo pode
/// trazer numero cru. Aceitar os dois evita perder o app por detalhe de formato.
fn json_u64(value: Option<&serde_json::Value>) -> u64 {
    match value {
        Some(serde_json::Value::String(text)) => text.trim().parse().unwrap_or(0),
        Some(serde_json::Value::Number(number)) => number.as_u64().unwrap_or(0),
        _ => 0,
    }
}

fn json_text(value: Option<&serde_json::Value>) -> Option<String> {
    match value {
        Some(serde_json::Value::String(text)) => Some(text.clone()),
        Some(serde_json::Value::Number(number)) => Some(number.to_string()),
        _ => None,
    }
}

/// O no `depots` mistura filhos numericos (os depots de verdade) com chaves
/// especiais — `branches`, `baselanguages`, `overridescddb`. So os numericos
/// viram depot; `branches` vira a tabela de `buildid`.
pub fn parse_depots_json(depots: &serde_json::Value, source: PicsSource) -> Option<PublicApp> {
    let depots = depots.as_object()?;

    let mut branch_build_ids = BTreeMap::new();
    if let Some(branches) = depots.get("branches").and_then(|value| value.as_object()) {
        for (branch, data) in branches {
            if let Some(build_id) = json_text(data.get("buildid")) {
                branch_build_ids.insert(branch.clone(), build_id);
            }
        }
    }

    let mut parsed_depots = Vec::new();
    for (key, value) in depots {
        let Ok(depot_id) = key.trim().parse::<u32>() else {
            continue;
        };
        let Some(depot) = value.as_object() else {
            continue;
        };

        let oslist = depot
            .get("config")
            .and_then(|config| config.get("oslist"))
            .and_then(|value| json_text(Some(value)))
            .filter(|list| !list.trim().is_empty());

        let mut branch_manifests = BTreeMap::new();
        if let Some(manifests) = depot.get("manifests").and_then(|value| value.as_object()) {
            for (branch, data) in manifests {
                let gid = json_u64(data.get("gid"));
                if gid > 0 {
                    branch_manifests.insert(branch.clone(), gid);
                }
            }
        }

        let manifest_gid = branch_manifests
            .get(PUBLIC_BRANCH)
            .copied()
            .unwrap_or_default();
        let size = depot
            .get("manifests")
            .and_then(|manifests| manifests.get(PUBLIC_BRANCH))
            .map(|public| json_u64(public.get("size")))
            .unwrap_or_default();

        parsed_depots.push(PublicDepot {
            depot_id,
            manifest_gid,
            size,
            oslist,
            branch_manifests,
        });
    }

    if parsed_depots.is_empty() && branch_build_ids.is_empty() {
        return None;
    }

    parsed_depots.sort_by_key(|depot| depot.depot_id);

    Some(PublicApp {
        build_id: branch_build_ids
            .get(PUBLIC_BRANCH)
            .cloned()
            .unwrap_or_default(),
        branch_build_ids,
        depots: parsed_depots,
        source,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_payload() -> serde_json::Value {
        serde_json::json!({
            "status": "success",
            "data": {
                "367520": {
                    "depots": {
                        "baselanguages": "english",
                        "367521": {
                            "config": { "oslist": "windows" },
                            "manifests": {
                                "public": { "gid": "257781644874438846", "size": "5231995691" },
                                "1.5.78.11833": { "gid": "4539921744901848404", "size": "7972880344" }
                            }
                        },
                        "367522": {
                            "config": { "oslist": "macos" },
                            "manifests": {
                                "public": { "gid": "6809616861563627670", "size": "5284750173" }
                            }
                        },
                        "999999": {
                            "manifests": {
                                "public": { "gid": "111", "size": "222" }
                            }
                        },
                        "branches": {
                            "public": { "buildid": "22529139" },
                            "1.5.78.11833": { "buildid": "20231655" }
                        }
                    }
                }
            }
        })
    }

    #[test]
    fn parses_public_gids_oslist_and_build_ids() {
        let app = parse_steamcmd_payload(&sample_payload(), "367520").expect("app deve parsear");
        assert_eq!(app.source, PicsSource::SteamCmdApi);
        assert_eq!(app.build_id, "22529139");
        assert_eq!(app.depots.len(), 3);

        let windows = app.depot(367521).unwrap();
        assert_eq!(windows.manifest_gid, 257781644874438846);
        assert_eq!(windows.size, 5231995691);
        assert_eq!(windows.oslist.as_deref(), Some("windows"));
        assert_eq!(app.public_gid(367521), Some(257781644874438846));
    }

    #[test]
    fn ignores_non_numeric_keys_next_to_the_depots() {
        let app = parse_steamcmd_payload(&sample_payload(), "367520").unwrap();
        assert!(app.depot(367521).is_some());
        // `baselanguages` e `branches` moram no mesmo objeto e nao sao depots.
        assert!(app.depots.iter().all(|depot| depot.depot_id != 0));
    }

    #[test]
    fn build_id_follows_the_branch_that_published_the_manifest() {
        let app = parse_steamcmd_payload(&sample_payload(), "367520").unwrap();
        // O manifest velho que o pacote Lua fixa nao pode carimbar o buildid do
        // publico: e exatamente isso que fazia a Steam nunca atualizar o jogo.
        assert_eq!(
            build_id_for_manifest(&app, 367521, 4539921744901848404),
            Some("20231655".to_string())
        );
        assert_eq!(
            build_id_for_manifest(&app, 367521, 257781644874438846),
            Some("22529139".to_string())
        );
        assert_eq!(build_id_for_manifest(&app, 367521, 42), None);
    }

    #[test]
    fn depot_without_oslist_is_kept_for_windows() {
        assert!(depot_runs_on_windows(None));
        assert!(depot_runs_on_windows(Some("")));
        assert!(depot_runs_on_windows(Some("windows")));
        assert!(depot_runs_on_windows(Some("windows,macos")));
        assert!(!depot_runs_on_windows(Some("macos")));
        assert!(!depot_runs_on_windows(Some("linux macos")));
    }

    #[test]
    fn rejects_a_payload_whose_status_is_not_success() {
        let payload = serde_json::json!({ "status": "error", "data": {} });
        assert!(parse_steamcmd_payload(&payload, "367520").is_none());
    }

    #[test]
    fn missing_app_in_the_payload_is_none_instead_of_an_empty_app() {
        let payload = sample_payload();
        assert!(parse_steamcmd_payload(&payload, "999").is_none());
    }
}
