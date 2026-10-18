//! Escolha do pacote LuaTools mais atual entre varias fontes.
//!
//! O comportamento antigo era "primeira fonte que responder 200 vence", com uma
//! unica fonte cadastrada. Como cada fonte fixa um `setManifestid` proprio e
//! nenhuma promete estar em dia, isso entregava build de 2022 com frequencia.
//!
//! Aqui todas as fontes sao consultadas e o pacote e pontuado contra os gids do
//! branch `public` vindos de `crate::steam_pics` — quem mais bater, vence.
//!
//! # Fonte sem TLS
//!
//! O proxy do LuaTools (`http://167.235.229.108/<appid>`) e a unica fonte
//! confirmada que entrega a build atual, e nao tem variante HTTPS (a porta 443
//! desse host responde com o certificado default do Traefik). O conteudo dele
//! acaba em `<steam>/config/stplug-in/` e `<steam>/depotcache/`, entao aceita-lo
//! as cegas abriria espaco para troca de pacote por quem estiver na rota.
//!
//! A trava e `score > 0`: um pacote sem TLS so entra se pelo menos um dos gids
//! que ele declara bater com o PICS obtido por HTTPS. Substituir o manifest
//! passa a exigir tambem controlar a resposta do `api.steamcmd.net`. A chave do
//! depot nao da para conferir assim — chave errada apenas faz a descriptografia
//! do chunk falhar, sem execucao de nada — e o `.lua` continua passando por
//! `crate::luatools::validate_lua_script` antes de ser gravado.
//!
//! # Fontes que ficaram de fora
//!
//! `GET http://167.235.229.108/check_apis?appid=<id>` lista `Luie`, `Ryuu` e
//! `Sushi`, mas o download por fonte do LuaTools (`/api/manifest/download`) mora
//! em `https://lua.tools` atras de `Bearer` de conta lua.tools. Sem conta, so
//! Sushi tem URL direta publica; o proxy acima entrega o pacote agregado. Por
//! isso `check_apis` nao e consultado: ele nao mudaria a decisao, ja que todas
//! as fontes alcancaveis sao baixadas de qualquer jeito.
//!
//! # Fontes cruas (.lua sem zip)
//!
//! SteamTools.games (`/api/files/<appid>/lua`) e os mirrors ManifestHub3
//! (`steamtools-games/ManifestHub3`) e ManifestHub2 (`youxiya/ManifestHub2`,
//! branch por AppID no GitHub) servem o `.lua` direto, sem zip — todos
//! validados com HTTP 200 para o AppID 367520 em 21/08/2026. `PackageFormat::RawLua`
//! marca essas fontes: o payload passa por uma checagem minima de script e e
//! embrulhado em um zip em memoria antes de entrar na selecao, entao nada a
//! jusante (`Selection`, `lua_from_zip`, instalacao) muda. As tres incluem as
//! chaves de depot inline (`addappid(depot, 0, "hex")`) e sao HTTPS.

use crate::steam_pics::PublicApp;
use crate::util::EmptyVecExt;
use std::collections::BTreeMap;
use std::time::Duration;

const USER_AGENT: &str = "discord(dot)gg/luatools";
const MAX_PACKAGE_BYTES: usize = 64 * 1024 * 1024;
const CONNECT_TIMEOUT_SECS: u64 = 5;
const REQUEST_TIMEOUT_SECS: u64 = 12;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PackageFormat {
    /// A resposta e um zip contendo o `<appid>.lua` (e, opcionalmente,
    /// arquivos `.manifest`).
    Zip,
    /// A resposta e o proprio `.lua` cru. Ele e embrulhado em um zip em
    /// memoria antes de entrar na selecao — veja `wrap_raw_lua_in_zip`.
    RawLua,
}

pub struct ManifestSource {
    pub name: &'static str,
    pub url: &'static str,
    /// `false` marca fonte sem TLS, que so e aceita com `score > 0`.
    pub requires_tls: bool,
    pub success_code: u16,
    pub unavailable_code: u16,
    pub format: PackageFormat,
}

/// Ordem importa: com pontuacao empatada vence a primeira, entao as fontes com
/// TLS vem antes. Todas as cinco sao TLS; o proxy do LuaTools fica por ultimo
/// porque e a unica sem TLS (e, portanto, a unica sujeita a trava do score).
pub const DEFAULT_SOURCES: &[ManifestSource] = &[
    ManifestSource {
        name: "Sushi",
        url: "https://raw.githubusercontent.com/sushi-dev55-alt/sushitools-games-repo-alt/refs/heads/main/<appid>.zip",
        requires_tls: true,
        success_code: 200,
        unavailable_code: 404,
        format: PackageFormat::Zip,
    },
    // Validada em 21/08/2026 (HTTP 200, AppID 367520): retorna o `.lua` com
    // chaves de depot inline e `setManifestid` por depot.
    ManifestSource {
        name: "SteamTools",
        url: "https://steamtools.games/api/files/<appid>/lua",
        requires_tls: true,
        success_code: 200,
        unavailable_code: 404,
        format: PackageFormat::RawLua,
    },
    // Branch nomeada pelo AppID no repositorio oficial do SteamTools.games;
    // ausente para jogos obscuros (404), o que apenas rejeita a candidata.
    ManifestSource {
        name: "ManifestHub3",
        url: "https://raw.githubusercontent.com/steamtools-games/ManifestHub3/<appid>/<appid>.lua",
        requires_tls: true,
        success_code: 200,
        unavailable_code: 404,
        format: PackageFormat::RawLua,
    },
    // Mirror ativo do antigo SSMGAlt/ManifestHub2 (removido do GitHub),
    // mesmo layout de branch por AppID.
    ManifestSource {
        name: "ManifestHub2",
        url: "https://raw.githubusercontent.com/youxiya/ManifestHub2/<appid>/<appid>.lua",
        requires_tls: true,
        success_code: 200,
        unavailable_code: 404,
        format: PackageFormat::RawLua,
    },
    ManifestSource {
        name: "LuaTools",
        url: "http://167.235.229.108/<appid>",
        requires_tls: false,
        success_code: 200,
        unavailable_code: 404,
        format: PackageFormat::Zip,
    },
];

#[derive(Debug, Clone)]
pub struct Candidate {
    pub source: String,
    pub zip: Vec<u8>,
    /// Quantos depots do `.lua` batem com o gid publico do PICS. Zero com PICS
    /// disponivel = pacote de build antiga.
    pub score: usize,
}

fn source_url(source: &ManifestSource, app_id: &str) -> String {
    source.url.replace("<appid>", app_id)
}

/// Aceita a URL da fonte. Fonte marcada como TLS precisa mesmo ser `https`; a
/// sem TLS aceita `http`, e a trava dela e a pontuacao contra o PICS, nao o
/// esquema. Qualquer outro esquema e recusado.
pub fn validate_source_url(source: &ManifestSource, url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    match parsed.scheme() {
        "https" => true,
        "http" => !source.requires_tls,
        _ => false,
    }
}

const MAX_RAW_LUA_BYTES: usize = 1024 * 1024;

/// Tokens que identificam um `.lua` de SteamTools. Espelho reduzido dos tokens
/// de `crate::luatools::validate_lua_script`: aqui so serve para recusar
/// resposta que claramente nao e script (HTML de erro, JSON, pagina em branco);
/// a validacao completa volta a acontecer na instalacao.
const RAW_LUA_TOKENS: &[&str] = &["addappid", "setManifestid", "addManifest"];

fn looks_like_lua_script(lua: &str) -> bool {
    lua.lines()
        .take(64)
        .any(|line| RAW_LUA_TOKENS.iter().any(|token| line.contains(token)))
}

/// Embrulha o `.lua` cru de uma fonte `PackageFormat::RawLua` em um zip em
/// memoria com a unica entrada `<appid>.lua`.
///
/// O pipeline a jusante (`Selection::offer`, `lua_from_zip`,
/// `install_lua_tools_package`) so conhece zip; com o embrulho aqui, nenhuma
/// dessas pecas precisa saber que a fonte servia outro formato. A checagem
/// minima recusa payload vazio, binario, gigante ou sem pinta de script — o
/// mesmo espírito da trava de zip (`PK`) da fonte comum.
fn wrap_raw_lua_in_zip(source_name: &str, app_id: &str, lua: &[u8]) -> Result<Vec<u8>, String> {
    if lua.is_empty() {
        return Err(format!("{}: script vazio", source_name));
    }
    if lua.len() > MAX_RAW_LUA_BYTES {
        return Err(format!(
            "{}: script excede {MAX_RAW_LUA_BYTES} bytes",
            source_name
        ));
    }
    if lua.contains(&0) {
        return Err(format!("{}: script contem bytes nulos", source_name));
    }
    let text = std::str::from_utf8(lua)
        .map_err(|_| format!("{}: script nao e UTF-8 valido", source_name))?;
    if !looks_like_lua_script(text) {
        return Err(format!(
            "{}: resposta nao parece um script SteamTools",
            source_name
        ));
    }

    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    writer
        .start_file::<_, ()>(
            format!("{app_id}.lua"),
            zip::write::SimpleFileOptions::default(),
        )
        .map_err(|error| format!("{}: falha ao empacotar o script ({error})", source_name))?;
    std::io::Write::write_all(&mut writer, lua).map_err(|error| {
        format!(
            "{}: falha ao gravar o script no pacote ({error})",
            source_name
        )
    })?;
    let cursor = writer
        .finish()
        .map_err(|error| format!("{}: falha ao fechar o pacote ({error})", source_name))?;
    Ok(cursor.into_inner())
}

/// Pares `(depot, manifest)` de um `.lua` do SteamTools.
///
/// Aceita a linha comentada (`--setManifestid(...)`) porque e assim que
/// `crate::luatools::install_lua_tools_package` grava o arquivo instalado: o
/// comentario tira o pin da Steam, mas o valor original segue legivel.
pub fn parse_set_manifest_ids(lua: &str) -> BTreeMap<u32, u64> {
    let mut manifests = BTreeMap::new();
    for line in lua.lines() {
        let line = line.trim_start().trim_start_matches('-').trim_start();
        let Some(rest) = line.strip_prefix("setManifestid(") else {
            continue;
        };
        let Some(end) = rest.find(')') else {
            continue;
        };
        let mut arguments = rest[..end].split(',');
        let Some(depot) = arguments
            .next()
            .and_then(|value| value.trim().parse::<u32>().ok())
        else {
            continue;
        };
        let Some(manifest) = arguments
            .next()
            .and_then(|value| value.trim().trim_matches('"').trim().parse::<u64>().ok())
        else {
            continue;
        };
        if depot > 0 && manifest > 0 {
            manifests.insert(depot, manifest);
        }
    }
    manifests
}

/// Chaves de depot declaradas por `addappid(depot, flag, "hex")` em um `.lua`.
///
/// Espelho do regex do `OstKeyProvider` do worker: 64 hex, tres argumentos. A
/// linha `addappid(appid)` (sem chave) e linhas comentadas nao contam. Quem usa
/// isto decide se um depot tem como ser descriptografado — um depot so de
/// `setManifestid` (tipicamente os redistribuiveis compartilhados do app 228980)
/// nunca tem chave em lugar nenhum.
pub fn parse_add_app_id_keys(lua: &str) -> BTreeMap<u32, String> {
    let mut keys = BTreeMap::new();
    for line in lua.lines() {
        let line = line.trim();
        if line.starts_with('-') {
            continue;
        }
        let Some(rest) = line.strip_prefix("addappid(") else {
            continue;
        };
        let Some(end) = rest.find(')') else {
            continue;
        };
        let mut arguments = rest[..end].split(',');
        let Some(depot) = arguments
            .next()
            .and_then(|value| value.trim().parse::<u32>().ok())
        else {
            continue;
        };
        let Some(key) = arguments.next_back() else {
            continue;
        };
        let key = key.trim().trim_matches('"').trim().to_ascii_lowercase();
        if depot > 0 && key.len() == 64 && key.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            keys.insert(depot, key);
        }
    }
    keys
}

/// Le o `<appid>.lua` do zip; sem ele, o primeiro `.lua` de nome numerico.
///
/// Mesmo criterio de selecao de `crate::luatools::install_lua_tools_package`,
/// para a pontuacao ser feita sobre o arquivo que sera de fato instalado.
pub fn lua_from_zip(app_id: &str, zip_bytes: &[u8]) -> Option<String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(zip_bytes)).ok()?;
    let mut fallback = None;

    for index in 0..archive.len() {
        let mut file = archive.by_index(index).ok()?;
        let name = file
            .name()
            .replace('\\', "/")
            .rsplit('/')
            .next()
            .unwrap_or_default()
            .to_string();
        let Some(stem) = name.strip_suffix(".lua") else {
            continue;
        };
        if stem.is_empty() || !stem.chars().all(|character| character.is_ascii_digit()) {
            continue;
        }
        let mut contents = String::new();
        if std::io::Read::read_to_string(&mut file, &mut contents).is_err() {
            continue;
        }
        if stem == app_id {
            return Some(contents);
        }
        if fallback.is_none() {
            fallback = Some(contents);
        }
    }

    fallback
}

fn score_against_public(manifests: &BTreeMap<u32, u64>, public: Option<&PublicApp>) -> usize {
    let Some(public) = public else {
        return 0;
    };
    manifests
        .iter()
        .filter(|(depot_id, manifest_id)| public.public_gid(**depot_id) == Some(**manifest_id))
        .count()
}

/// Quantos depots do PICS um pacote perfeito conseguiria acertar.
///
/// Serve de criterio de parada: quando uma fonte ja bate em todos eles, nao ha
/// pacote melhor a procurar e as fontes seguintes nem sao contatadas.
fn perfect_score(public: Option<&PublicApp>) -> Option<usize> {
    let public = public?;
    let total = public
        .depots
        .iter()
        .filter(|depot| depot.manifest_gid > 0)
        .filter(|depot| crate::steam_pics::depot_runs_on_windows(depot.oslist.as_deref()))
        .count();
    (total > 0).then_some(total)
}

/// Decisao de qual pacote vence, separada do transporte.
///
/// Esta e a parte que importa — pontuacao, trava da fonte sem TLS e criterio de
/// parada — e nao depende de rede, entao os testes a exercitam direto com zips
/// em memoria em vez de subirem um servidor HTTP.
struct Selection<'a> {
    app_id: &'a str,
    public: Option<&'a PublicApp>,
    /// Pontuacao que um pacote perfeito teria; `None` sem PICS.
    target: Option<usize>,
    best: Option<Candidate>,
    errors: Vec<String>,
}

impl<'a> Selection<'a> {
    fn new(app_id: &'a str, public: Option<&'a PublicApp>) -> Self {
        Self {
            app_id,
            public,
            target: perfect_score(public),
            best: None,
            errors: Vec::new(),
        }
    }

    fn reject(&mut self, error: String) {
        self.errors.push(error);
    }

    fn offer(&mut self, source: &ManifestSource, zip: Vec<u8>) {
        let manifests = lua_from_zip(self.app_id, &zip)
            .map(|lua| parse_set_manifest_ids(&lua))
            .unwrap_or_default();
        let score = score_against_public(&manifests, self.public);

        // Sem TLS a pontuacao e a unica prova de que o pacote nao foi trocado na
        // rota; zero acertos contra o PICS significa que nao ha o que conferir.
        if !source.requires_tls && score == 0 {
            self.reject(format!(
                "{}: pacote sem TLS nao confere com o manifest publico; recusado",
                source.name
            ));
            return;
        }

        // Empate mantem o vencedor atual, e por isso a ordem da tabela de fontes
        // decide: as com TLS vem antes.
        if self.best.as_ref().is_none_or(|best| score > best.score) {
            self.best = Some(Candidate {
                source: source.name.to_string(),
                zip,
                score,
            });
        }
    }

    /// `true` quando ja existe pacote batendo em todos os depots publicos: nao
    /// ha o que melhorar e as fontes restantes nem chegam a ser contatadas.
    fn is_settled(&self) -> bool {
        let (Some(target), Some(best)) = (self.target, self.best.as_ref()) else {
            return false;
        };
        best.score >= target
    }

    fn finish(self) -> Result<Candidate, String> {
        let errors = self.errors;
        self.best.ok_or_else(|| {
            errors
                .if_empty(vec![
                    "Jogo indisponivel nas fontes configuradas.".to_string()
                ])
                .join("; ")
        })
    }
}

pub async fn best_package(app_id: &str, public: Option<&PublicApp>) -> Result<Candidate, String> {
    best_package_from(app_id, DEFAULT_SOURCES, public).await
}

/// Um `.manifest` obtido de uma fonte de pacote.
pub struct FetchedManifest {
    pub manifest_id: u64,
    pub bytes: Vec<u8>,
}

/// Tamanho aceitavel para um `.manifest` de dentro de um pacote. Manifest real
/// gira em torno de 1 MB; o teto so existe para um zip hostil nao encher a
/// memoria declarando entracoes gigantes.
const MAX_MANIFEST_ENTRY_BYTES: usize = 16 * 1024 * 1024;

/// Busca, entre as fontes de pacote, os `.manifest` pedidos.
///
/// As fontes raw-lua (SteamTools, ManifestHub) vencem a selecao do
/// `best_package` com frequencia — e nao trazem nenhum `.manifest`. Sem esta
/// busca, o download desses jogos morria no worker com `FileNotFoundException`
/// antes do primeiro chunk. Cada fonte util e consultada ate faltar nada,
/// porque os zips carregam subconjuntos diferentes do catalogue de depots.
///
/// A fonte sem TLS continua sujeita a trava do `Selection`: pins que nao batem
/// com o PICS (HTTPS) rejeitam o pacote inteiro. Um manifest trocado na rota
/// nao executa nada — o pior caso e uma lista de chunks errada, e todo chunk
/// baixado e conferido por Adler-32 antes de chegar ao disco.
///
/// Volta o mapa `depot -> manifest` do que foi achado e os erros por fonte,
/// para o chamador poder dizer ao usuario por que algo faltou.
pub async fn fetch_manifest_files(
    app_id: &str,
    wanted: &[(u32, u64)],
    public: Option<&PublicApp>,
) -> Result<(BTreeMap<u32, FetchedManifest>, Vec<String>), String> {
    fetch_manifest_files_from(app_id, wanted, DEFAULT_SOURCES, public).await
}

pub async fn fetch_manifest_files_from(
    app_id: &str,
    wanted: &[(u32, u64)],
    sources: &[ManifestSource],
    public: Option<&PublicApp>,
) -> Result<(BTreeMap<u32, FetchedManifest>, Vec<String>), String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|error| error.to_string())?;

    let wanted_names: std::collections::HashMap<String, (u32, u64)> = wanted
        .iter()
        .map(|(depot_id, manifest_id)| {
            (
                format!("{depot_id}_{manifest_id}.manifest"),
                (*depot_id, *manifest_id),
            )
        })
        .collect();

    let mut found: BTreeMap<u32, FetchedManifest> = BTreeMap::new();
    let mut fallback: BTreeMap<u32, FetchedManifest> = BTreeMap::new();
    let mut errors: Vec<String> = Vec::new();

    for source in sources {
        if wanted
            .iter()
            .all(|(depot_id, _)| found.contains_key(depot_id))
        {
            break;
        }
        // Fonte raw-lua nao tem `.manifest` dentro; contacta-la seria custo puro.
        if matches!(source.format, PackageFormat::RawLua) {
            continue;
        }

        let url = source_url(source, app_id);
        if !validate_source_url(source, &url) {
            errors.push(format!("{}: URL insegura", source.name));
            continue;
        }

        let zip = match fetch_package(&client, source, &url, app_id).await {
            Ok(zip) => zip,
            Err(error) => {
                errors.push(error);
                continue;
            }
        };

        // Mesma trava do `Selection`: fonte sem TLS so entra batendo com o PICS.
        if !source.requires_tls && package_score(&zip, app_id, public) == 0 {
            errors.push(format!(
                "{}: pacote sem TLS nao confere com o manifest publico; recusado",
                source.name
            ));
            continue;
        }

        harvest_manifests_from_zip(&zip, &wanted_names, &mut found, &mut errors, source.name);
        // A fonte pode conter uma build anterior à pública. Guarde apenas os
        // manifests declarados pelo próprio Lua do pacote, sem interromper a
        // busca da versão atual nas outras fontes. O chamador mantém a recusa
        // stale-manifest até o usuário optar explicitamente pela versão antiga.
        let fallback_names = fallback_manifest_names(app_id, &zip, wanted, public);
        harvest_manifests_from_zip(&zip, &fallback_names, &mut fallback, &mut errors, source.name);
    }

    for (depot_id, manifest) in fallback {
        found.entry(depot_id).or_insert(manifest);
    }
    Ok((found, errors))
}

fn fallback_manifest_names(
    app_id: &str,
    zip: &[u8],
    wanted: &[(u32, u64)],
    public: Option<&PublicApp>,
) -> std::collections::HashMap<String, (u32, u64)> {
    let pins = lua_from_zip(app_id, zip)
        .map(|lua| parse_set_manifest_ids(&lua))
        .unwrap_or_default();
    wanted.iter().filter_map(|(depot_id, wanted_gid)| {
        // Sem referência pública não podemos classificar uma alternativa como
        // antiga; nesse caso continue exigindo exatamente o manifest solicitado.
        public?.public_gid(*depot_id)?;
        let manifest_id = *pins.get(depot_id)?;
        (manifest_id != *wanted_gid).then(|| (
            format!("{depot_id}_{manifest_id}.manifest"), (*depot_id, manifest_id),
        ))
    }).collect()
}

/// Quantos pins do `.lua` dentro do pacote batem com o gid publico do PICS.
fn package_score(zip: &[u8], app_id: &str, public: Option<&PublicApp>) -> usize {
    lua_from_zip(app_id, zip)
        .map(|lua| score_against_public(&parse_set_manifest_ids(&lua), public))
        .unwrap_or(0)
}

/// Extrai de um zip de pacote os `.manifest` pedidos que ainda faltam.
fn harvest_manifests_from_zip(
    zip: &[u8],
    wanted_names: &std::collections::HashMap<String, (u32, u64)>,
    found: &mut BTreeMap<u32, FetchedManifest>,
    errors: &mut Vec<String>,
    source_name: &str,
) {
    let Ok(mut archive) = zip::ZipArchive::new(std::io::Cursor::new(zip)) else {
        errors.push(format!("{source_name}: resposta nao e um zip valido"));
        return;
    };

    for index in 0..archive.len() {
        let Ok(mut file) = archive.by_index(index) else {
            continue;
        };
        let name = file
            .name()
            .replace('\\', "/")
            .rsplit('/')
            .next()
            .unwrap_or_default()
            .to_string();
        let Some((depot_id, manifest_id)) = wanted_names.get(&name).copied() else {
            continue;
        };
        if found.contains_key(&depot_id) {
            continue;
        }

        let mut bytes = Vec::new();
        let mut limited =
            std::io::Read::take(&mut file, MAX_MANIFEST_ENTRY_BYTES.saturating_add(1) as u64);
        let read = std::io::Read::read_to_end(&mut limited, &mut bytes);
        if read.is_err() || bytes.len() > MAX_MANIFEST_ENTRY_BYTES {
            errors.push(format!(
                "{source_name}: manifest {name} ilegivel ou maior que {} MB",
                MAX_MANIFEST_ENTRY_BYTES / (1024 * 1024)
            ));
            continue;
        }
        found.insert(depot_id, FetchedManifest { manifest_id, bytes });
    }
}

pub async fn best_package_from(
    app_id: &str,
    sources: &[ManifestSource],
    public: Option<&PublicApp>,
) -> Result<Candidate, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|error| error.to_string())?;

    let mut selection = Selection::new(app_id, public);

    for source in sources {
        let url = source_url(source, app_id);
        if !validate_source_url(source, &url) {
            selection.reject(format!("{}: URL insegura", source.name));
            continue;
        }

        match fetch_package(&client, source, &url, app_id).await {
            Ok(zip) => selection.offer(source, zip),
            Err(error) => selection.reject(error),
        }

        if selection.is_settled() {
            break;
        }
    }

    selection.finish()
}

/// Mensagem de erro do reqwest com a causa real anexada.
///
/// O `Display` de `reqwest::Error` para em "error sending request for url
/// (...)", que nao diz se foi DNS, recusa de conexao ou TLS. A cadeia de
/// `source()` tem essa informacao, e sem ela tanto o log quanto o aviso na tela
/// ficam sem diagnostico.
fn describe_request_error(error: &reqwest::Error) -> String {
    let mut message = error.to_string();
    let mut cause: Option<&(dyn std::error::Error + 'static)> = std::error::Error::source(error);
    while let Some(current) = cause {
        message.push_str(": ");
        message.push_str(&current.to_string());
        cause = current.source();
    }
    message
}

async fn fetch_package(
    client: &reqwest::Client,
    source: &ManifestSource,
    url: &str,
    app_id: &str,
) -> Result<Vec<u8>, String> {
    for attempt in 0..3 {
        match fetch_package_once(client, source, url, app_id).await {
            Err(error) if error.1 && attempt < 2 => {
                tokio::time::sleep(Duration::from_millis(500 * (attempt + 1))).await;
            }
            result => return result.map_err(|error| error.0),
        }
    }
    unreachable!()
}

async fn fetch_package_once(
    client: &reqwest::Client,
    source: &ManifestSource,
    url: &str,
    app_id: &str,
) -> Result<Vec<u8>, (String, bool)> {
    let response = client
        .get(url)
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                format!("{}: tempo limite excedido", source.name)
            } else {
                format!("{}: {}", source.name, describe_request_error(&error))
            }
        }).map_err(|message| (message, true))?;

    let status = response.status().as_u16();
    if status == source.unavailable_code {
        return Err((format!("{}: pacote não encontrado nesta fonte", source.name), false));
    }
    if status != source.success_code {
        return Err((if status >= 500 {
            format!("{}: falha temporária do serviço (HTTP {status}); tente novamente mais tarde", source.name)
        } else {
            format!("{}: HTTP {status}", source.name)
        }, status >= 500));
    }

    let bytes = response.bytes().await.map_err(|error| {
        if error.is_timeout() {
            format!("{}: tempo limite excedido durante o download", source.name)
        } else {
            format!("{}: falha ao receber o pacote ({error})", source.name)
        }
    }).map_err(|message| (message, true))?;

    if bytes.len() > MAX_PACKAGE_BYTES {
        return Err((format!("{}: pacote excede 64 MB", source.name), false));
    }

    match source.format {
        PackageFormat::Zip => {
            if bytes.len() < 4 || &bytes[..2] != b"PK" {
                return Err((format!("{}: resposta nao e zip", source.name), false));
            }
            Ok(bytes.to_vec())
        }
        PackageFormat::RawLua => wrap_raw_lua_in_zip(source.name, app_id, &bytes)
            .map_err(|message| (message, false)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::steam_pics::{PicsSource, PublicApp, PublicDepot};
    use std::io::Write;

    const PUBLIC_GID: u64 = 257781644874438846;
    const OLD_GID: u64 = 3820178394837330515;
    const APP_ID: &str = "367520";

    /// Um depot windows publicado e um macOS, para o alvo de pontuacao contar
    /// so o que roda em Windows.
    fn public_app() -> PublicApp {
        PublicApp {
            build_id: "22529139".into(),
            branch_build_ids: BTreeMap::from([("public".to_string(), "22529139".to_string())]),
            depots: vec![
                PublicDepot {
                    depot_id: 367521,
                    manifest_gid: PUBLIC_GID,
                    size: 5231995691,
                    oslist: Some("windows".into()),
                    language: None,
                    low_violence: false,
                    branch_manifests: BTreeMap::from([("public".to_string(), PUBLIC_GID)]),
                },
                PublicDepot {
                    depot_id: 367522,
                    manifest_gid: 6809616861563627670,
                    size: 5284750173,
                    oslist: Some("macos".into()),
                    language: None,
                    low_violence: false,
                    branch_manifests: BTreeMap::from([("public".to_string(), 6809616861563627670)]),
                },
            ],
            source: PicsSource::SteamCmdApi,
        }
    }

    fn zip_with_lua(app_id: &str, lua: &str) -> Vec<u8> {
        let mut buffer = Vec::new();
        {
            let mut writer = zip::ZipWriter::new(std::io::Cursor::new(&mut buffer));
            writer
                .start_file::<_, ()>(
                    format!("{app_id}.lua"),
                    zip::write::SimpleFileOptions::default(),
                )
                .unwrap();
            writer.write_all(lua.as_bytes()).unwrap();
            writer.finish().unwrap();
        }
        buffer
    }

    fn stale_zip() -> Vec<u8> {
        zip_with_lua(APP_ID, &format!("setManifestid(367521,\"{OLD_GID}\")"))
    }

    fn current_zip() -> Vec<u8> {
        zip_with_lua(APP_ID, &format!("setManifestid(367521,\"{PUBLIC_GID}\")"))
    }

    fn source(name: &'static str, requires_tls: bool) -> ManifestSource {
        ManifestSource {
            name,
            url: "https://example.test/<appid>.zip",
            requires_tls,
            success_code: 200,
            unavailable_code: 404,
            format: PackageFormat::Zip,
        }
    }

    fn raw_lua_source(name: &'static str) -> ManifestSource {
        ManifestSource {
            url: "https://example.test/<appid>.lua",
            format: PackageFormat::RawLua,
            ..source(name, true)
        }
    }

    #[test]
    fn a_raw_lua_payload_is_wrapped_into_a_readable_zip() {
        let lua = format!("addappid({APP_ID})\nsetManifestid(367521,\"{PUBLIC_GID}\")\n");

        let zip = wrap_raw_lua_in_zip("Teste", APP_ID, lua.as_bytes()).unwrap();
        assert_eq!(&zip[..2], b"PK", "o embrulho precisa produzir um zip real");

        let parsed = lua_from_zip(APP_ID, &zip).unwrap();
        assert_eq!(
            parse_set_manifest_ids(&parsed).get(&367521),
            Some(&PUBLIC_GID)
        );
    }

    #[test]
    fn an_invalid_raw_lua_payload_is_refused() {
        let empty: &[u8] = b"";
        assert!(wrap_raw_lua_in_zip("Teste", APP_ID, empty).is_err());

        let html = b"<html><body>404 not found</body></html>";
        let error = wrap_raw_lua_in_zip("Teste", APP_ID, html).unwrap_err();
        assert!(error.contains("nao parece um script SteamTools"), "{error}");

        let binary: &[u8] = &[0x50, 0x4b, 0x00, 0x03, 0x04];
        assert!(wrap_raw_lua_in_zip("Teste", APP_ID, binary).is_err());

        let oversized = vec![b'a'; MAX_RAW_LUA_BYTES + 1];
        assert!(wrap_raw_lua_in_zip("Teste", APP_ID, &oversized).is_err());
    }

    #[test]
    fn a_raw_lua_source_scores_like_a_zip_one() {
        let app = public_app();
        let mut selection = Selection::new(APP_ID, Some(&app));

        let lua = format!("addappid({APP_ID})\nsetManifestid(367521,\"{PUBLIC_GID}\")\n");
        let wrapped = wrap_raw_lua_in_zip("Cru", APP_ID, lua.as_bytes()).unwrap();
        selection.offer(&raw_lua_source("Cru"), wrapped);

        let winner = selection.finish().unwrap();
        assert_eq!(winner.source, "Cru");
        assert_eq!(winner.score, 1);
    }

    #[test]
    fn parses_manifest_ids_from_pinned_and_commented_lines() {
        let lua = concat!(
            "addappid(367520)\n",
            "addappid(367521,1,\"deadbeef\")\n",
            "--setManifestid(367521,\"3820178394837330515\",7972875944)\n",
            "setManifestid(367522,\"6809616861563627670\")\n",
            "-- comentario solto sem manifest\n",
        );
        let manifests = parse_set_manifest_ids(lua);
        assert_eq!(manifests.get(&367521), Some(&3820178394837330515));
        assert_eq!(manifests.get(&367522), Some(&6809616861563627670));
        assert_eq!(manifests.len(), 2);
    }

    const KEY_367521: &str = "de801b9b61e3385b333259cc0f04d2e5d976c4cb8f933cb859d75a4d0125a2a8";

    #[test]
    fn parses_depot_keys_from_addappid_lines() {
        let lua = concat!(
            "addappid(367520)\n",
            "addappid( 367521 , 0 , \"{KEY_PLACEHOLDER}\" )\n",
            "--addappid(367522,1,\"{KEY_PLACEHOLDER}\")\n",
            "addappid(367523,1,\"deadbeef\")\n",
            "addappid(367524,1)\n",
        )
        .replace("{KEY_PLACEHOLDER}", KEY_367521);

        let keys = parse_add_app_id_keys(&lua);
        // A linha do app em si (sem chave), a comentada e o hex curto nao contam.
        assert_eq!(keys.len(), 1);
        assert_eq!(keys.get(&367521).map(String::as_str), Some(KEY_367521));
    }

    fn wanted_names(pairs: &[(u32, u64)]) -> std::collections::HashMap<String, (u32, u64)> {
        pairs
            .iter()
            .map(|(depot, manifest)| (format!("{depot}_{manifest}.manifest"), (*depot, *manifest)))
            .collect()
    }

    fn zip_with_lua_and_manifests(lua: &str, manifests: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buffer = Vec::new();
        {
            let mut writer = zip::ZipWriter::new(std::io::Cursor::new(&mut buffer));
            let options = zip::write::SimpleFileOptions::default();
            writer
                .start_file::<_, ()>(format!("{APP_ID}.lua"), options)
                .unwrap();
            writer.write_all(lua.as_bytes()).unwrap();
            for (name, bytes) in manifests {
                writer.start_file::<_, ()>(*name, options).unwrap();
                writer.write_all(bytes).unwrap();
            }
            writer.finish().unwrap();
        }
        buffer
    }

    #[test]
    fn harvests_only_the_requested_manifest_entries() {
        let zip = zip_with_lua_and_manifests(
            &format!("setManifestid(367521,\"{PUBLIC_GID}\")"),
            &[
                (
                    format!("367521_{PUBLIC_GID}.manifest").as_str(),
                    b"manifesto",
                ),
                ("367521_111.manifest", b"build velha"),
                ("9_9.manifest", b"outro app"),
            ],
        );

        let mut found = BTreeMap::new();
        let mut errors = Vec::new();
        harvest_manifests_from_zip(
            &zip,
            &wanted_names(&[(367521, PUBLIC_GID)]),
            &mut found,
            &mut errors,
            "Sushi",
        );

        assert_eq!(found.len(), 1);
        let entry = found.get(&367521).unwrap();
        assert_eq!(entry.manifest_id, PUBLIC_GID);
        assert_eq!(entry.bytes, b"manifesto");
        assert!(errors.is_empty());
    }

    #[test]
    fn a_plain_package_with_matching_pins_scores_against_the_public_gid() {
        let app = public_app();
        let current =
            zip_with_lua_and_manifests(&format!("setManifestid(367521,\"{PUBLIC_GID}\")"), &[]);
        let stale =
            zip_with_lua_and_manifests(&format!("setManifestid(367521,\"{OLD_GID}\")"), &[]);

        assert_eq!(package_score(&current, APP_ID, Some(&app)), 1);
        assert_eq!(package_score(&stale, APP_ID, Some(&app)), 0);
    }

    #[test]
    fn unavailable_public_manifest_can_use_the_version_declared_in_the_package() {
        let app = public_app();
        let zip = zip_with_lua_and_manifests(
            &format!("setManifestid(367521,\"{OLD_GID}\")"),
            &[
                (&format!("367521_{OLD_GID}.manifest"), b"available build"),
                ("367521_111.manifest", b"unrelated build"),
                ("9_9.manifest", b"other depot"),
            ],
        );
        let names = fallback_manifest_names(APP_ID, &zip, &[(367521, PUBLIC_GID)], Some(&app));
        let mut found = BTreeMap::new();
        let mut errors = Vec::new();
        harvest_manifests_from_zip(&zip, &names, &mut found, &mut errors, "Sushi");
        assert_eq!(found.len(), 1);
        assert_eq!(found[&367521].manifest_id, OLD_GID);
        assert_eq!(found[&367521].bytes, b"available build");
        assert!(errors.is_empty());
    }

    #[test]
    fn fallback_requires_public_reference_and_a_pin_for_the_requested_depot() {
        let app = public_app();
        assert!(fallback_manifest_names(APP_ID, &stale_zip(), &[(367521, PUBLIC_GID)], None).is_empty());
        assert!(fallback_manifest_names(APP_ID, &stale_zip(), &[(999, PUBLIC_GID)], Some(&app)).is_empty());
        assert!(fallback_manifest_names(APP_ID, &current_zip(), &[(367521, PUBLIC_GID)], Some(&app)).is_empty());
        let unpinned = zip_with_lua_and_manifests("addappid(367521)", &[("367521_111.manifest", b"unlisted")]);
        assert!(fallback_manifest_names(APP_ID, &unpinned, &[(367521, PUBLIC_GID)], Some(&app)).is_empty());
    }

    #[test]
    fn lua_from_zip_prefers_the_file_named_after_the_app() {
        let mut buffer = Vec::new();
        {
            let mut writer = zip::ZipWriter::new(std::io::Cursor::new(&mut buffer));
            let options = zip::write::SimpleFileOptions::default();
            writer.start_file::<_, ()>("999.lua", options).unwrap();
            writer.write_all(b"setManifestid(1,\"1\")").unwrap();
            writer
                .start_file::<_, ()>(format!("{APP_ID}.lua"), options)
                .unwrap();
            writer.write_all(b"setManifestid(2,\"2\")").unwrap();
            writer.finish().unwrap();
        }

        let lua = lua_from_zip(APP_ID, &buffer).unwrap();
        assert_eq!(parse_set_manifest_ids(&lua).get(&2), Some(&2));
    }

    #[test]
    fn the_package_matching_the_public_gid_wins_even_coming_last() {
        let app = public_app();
        let mut selection = Selection::new(APP_ID, Some(&app));

        selection.offer(&source("Stale", true), stale_zip());
        assert_eq!(selection.best.as_ref().unwrap().source, "Stale");

        selection.offer(&source("Current", true), current_zip());

        let winner = selection.finish().unwrap();
        assert_eq!(winner.source, "Current");
        assert_eq!(winner.score, 1);
    }

    #[test]
    fn a_tie_keeps_the_earlier_source_so_the_tls_one_wins() {
        let app = public_app();
        let mut selection = Selection::new(APP_ID, Some(&app));

        selection.offer(&source("Tls", true), current_zip());
        selection.offer(&source("Plain", false), current_zip());

        assert_eq!(selection.finish().unwrap().source, "Tls");
    }

    #[test]
    fn a_source_without_tls_is_refused_when_nothing_matches_the_public_manifest() {
        let app = public_app();
        let mut selection = Selection::new(APP_ID, Some(&app));

        selection.offer(&source("Plain", false), stale_zip());

        let error = selection.finish().unwrap_err();
        assert!(
            error.contains("nao confere com o manifest publico"),
            "{error}"
        );
    }

    #[test]
    fn a_source_without_tls_is_accepted_once_it_matches_the_public_manifest() {
        let app = public_app();
        let mut selection = Selection::new(APP_ID, Some(&app));

        selection.offer(&source("Plain", false), current_zip());

        let winner = selection.finish().unwrap();
        assert_eq!(winner.source, "Plain");
        assert_eq!(winner.score, 1);
    }

    #[test]
    fn without_pics_a_stale_package_is_still_accepted_from_a_tls_source() {
        // Sem PICS nao ha como pontuar nada; recusar aqui deixaria o usuario sem
        // download nenhum quando o `api.steamcmd.net` estivesse fora.
        let mut selection = Selection::new(APP_ID, None);

        selection.offer(&source("Tls", true), stale_zip());

        let winner = selection.finish().unwrap();
        assert_eq!(winner.source, "Tls");
        assert_eq!(winner.score, 0);
    }

    #[test]
    fn without_pics_a_source_without_tls_is_never_accepted() {
        let mut selection = Selection::new(APP_ID, None);

        selection.offer(&source("Plain", false), current_zip());

        assert!(selection.finish().is_err());
    }

    #[test]
    fn the_search_stops_once_every_windows_depot_matches() {
        let app = public_app();
        let mut selection = Selection::new(APP_ID, Some(&app));
        // O depot macOS do PICS nao entra no alvo; exigir os dois faria a busca
        // nunca se dar por satisfeita e sempre contatar a fonte sem TLS.
        assert_eq!(selection.target, Some(1));
        assert!(!selection.is_settled());

        selection.offer(&source("Stale", true), stale_zip());
        assert!(!selection.is_settled());

        selection.offer(&source("Current", true), current_zip());
        assert!(selection.is_settled());
    }

    #[test]
    fn without_pics_the_search_never_settles_early() {
        let mut selection = Selection::new(APP_ID, None);
        selection.offer(&source("Tls", true), current_zip());
        assert!(!selection.is_settled());
    }

    #[test]
    fn an_https_url_is_accepted_and_a_plain_one_only_for_a_source_without_tls() {
        let tls = source("Tls", true);
        let plain = source("Plain", false);

        assert!(validate_source_url(&tls, "https://example.test/1.zip"));
        assert!(!validate_source_url(&tls, "http://198.51.100.7/1"));
        assert!(validate_source_url(&plain, "http://198.51.100.7/1"));
        assert!(!validate_source_url(&plain, "ftp://example.test/1.zip"));
        assert!(!validate_source_url(&plain, "nao e uma url"));
    }

    /// Smoke test contra as fontes reais. `#[ignore]` porque depende de rede e
    /// de servicos de terceiros; roda com
    /// `cargo test --lib -- --ignored real_sources`.
    ///
    /// Existe porque a feature inteira depende de endpoints vivos
    /// (`api.steamcmd.net`, Sushi, SteamTools.games, os mirrors ManifestHub e o
    /// proxy do LuaTools). Quando um deles sair do ar ou mudar de formato, os
    /// testes offline continuam verdes e so este acusa.
    #[test]
    #[ignore = "depende de rede"]
    fn real_sources_still_deliver_the_current_public_build() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();

        // Um app de depot unico e um de muitos depots com varios SO.
        for app_id in ["367520", "1091500"] {
            let public = runtime
                .block_on(crate::steam_pics::fetch_steamcmd_app(app_id))
                .unwrap_or_else(|| panic!("api.steamcmd.net deve responder para {app_id}"));

            let winner = runtime
                .block_on(best_package(app_id, Some(&public)))
                .unwrap_or_else(|error| panic!("nenhuma fonte serviu {app_id}: {error}"));
            let manifests = parse_set_manifest_ids(
                &lua_from_zip(app_id, &winner.zip)
                    .unwrap_or_else(|| panic!("pacote de {app_id} deve conter o .lua")),
            );

            let checked = manifests
                .iter()
                .filter(|(depot_id, _)| public.public_gid(**depot_id).is_some())
                .inspect(|(depot_id, manifest_id)| {
                    assert_eq!(
                        public.public_gid(**depot_id),
                        Some(**manifest_id),
                        "app {app_id}, fonte '{}': depot {depot_id} veio de build antiga",
                        winner.source
                    );
                })
                .count();
            assert!(
                checked > 0,
                "app {app_id}: nenhum depot do pacote existe no PICS, nada foi verificado"
            );
        }
    }
}
