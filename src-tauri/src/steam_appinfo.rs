//! Leitura de `<steam>/appcache/appinfo.vdf` para os tres campos que o
//! `appmanifest_<appid>.acf` nao pode inventar: `installdir`, `buildid` e `name`.
//!
//! O plano original resolvia isso pedindo um comando `appInfo` novo ao worker
//! SteamKit (PICS, dado fresco). Nao da: o `steamkit-poc` so existe pre-compilado
//! neste repositorio (ver `sidecars/README.md`), entao a leitura acontece aqui.
//!
//! O formato e KV binario com cabecalho proprio. Tres versoes circulam em
//! instalacoes reais e a v29 trocou as chaves inline por indices numa tabela de
//! strings no fim do arquivo — por isso o parser daqui e separado do de
//! `steam_appcache.rs`, que so ve KV binario simples.

use std::collections::BTreeMap;
use std::path::Path;

const MAGIC_V27: u32 = 0x0756_4427;
const MAGIC_V28: u32 = 0x0756_4428;
const MAGIC_V29: u32 = 0x0756_4429;

/// Bytes do cabecalho de cada app depois do campo `size`, sem o sha1 binario.
const APP_HEADER_AFTER_SIZE: u32 = 40;
/// sha1 binario extra, presente a partir da v28.
const APP_HEADER_SHA1_BINARY: u32 = 20;

/// Caracteres proibidos em nome de pasta no Windows. O Steam sanitiza o
/// `installdir` do appinfo do mesmo jeito antes de criar o diretorio.
const INVALID_PATH_CHARS: [char; 9] = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppInfo {
    pub install_dir: String,
    pub build_id: String,
    pub name: String,
}

#[derive(Debug, Clone)]
enum KvValue {
    Object(BTreeMap<String, KvValue>),
    Text(String),
}

fn kv_object<'a>(value: &'a KvValue) -> Option<&'a BTreeMap<String, KvValue>> {
    match value {
        KvValue::Object(object) => Some(object),
        KvValue::Text(_) => None,
    }
}

fn kv_text(value: &KvValue) -> Option<&str> {
    match value {
        KvValue::Text(text) => Some(text.as_str()),
        KvValue::Object(_) => None,
    }
}

/// Busca `a/b/c` na arvore, aceitando chave em qualquer caixa — o appinfo mistura
/// `installdir` e `installDir` conforme o app.
fn lookup<'a>(root: &'a BTreeMap<String, KvValue>, path: &[&str]) -> Option<&'a KvValue> {
    let mut current = root;
    for (index, segment) in path.iter().enumerate() {
        let entry = current
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(segment))
            .map(|(_, value)| value)?;
        if index + 1 == path.len() {
            return Some(entry);
        }
        current = kv_object(entry)?;
    }
    None
}

fn read_u32(data: &[u8], offset: &mut usize) -> Option<u32> {
    let end = offset.checked_add(4)?;
    if end > data.len() {
        return None;
    }
    let value = u32::from_le_bytes(data[*offset..end].try_into().ok()?);
    *offset = end;
    Some(value)
}

fn read_i64(data: &[u8], offset: &mut usize) -> Option<i64> {
    let end = offset.checked_add(8)?;
    if end > data.len() {
        return None;
    }
    let value = i64::from_le_bytes(data[*offset..end].try_into().ok()?);
    *offset = end;
    Some(value)
}

/// String terminada em NUL. Lossy de proposito: alguns `name` trazem bytes que
/// nao sao UTF-8 valido, e perder um acento e melhor que perder o app inteiro.
fn read_cstring(data: &[u8], offset: &mut usize) -> Option<String> {
    let start = *offset;
    let mut end = start;
    while end < data.len() && data[end] != 0 {
        end += 1;
    }
    if end >= data.len() {
        return None;
    }
    let value = String::from_utf8_lossy(&data[start..end]).into_owned();
    *offset = end + 1;
    Some(value)
}

fn read_string_table(data: &[u8], table_offset: i64) -> Option<Vec<String>> {
    if table_offset <= 0 {
        return None;
    }
    let mut offset = usize::try_from(table_offset).ok()?;
    if offset >= data.len() {
        return None;
    }
    let count = read_u32(data, &mut offset)? as usize;
    let mut table = Vec::with_capacity(count.min(1 << 16));
    for _ in 0..count {
        table.push(read_cstring(data, &mut offset)?);
    }
    Some(table)
}

/// Um no do KV binario. `string_table` presente ⇒ chaves sao indices u32 (v29).
fn parse_kv_object(
    data: &[u8],
    offset: &mut usize,
    string_table: Option<&[String]>,
    depth: u32,
) -> Option<BTreeMap<String, KvValue>> {
    // Guarda contra arquivo corrompido virar recursao infinita.
    if depth > 32 {
        return None;
    }
    let mut result = BTreeMap::new();

    loop {
        if *offset >= data.len() {
            // No raiz o fim do blob delimita o objeto: o arquivo nao grava um
            // terminador extra depois do `8` que fecha o no `appinfo`. Mais
            // fundo, acabar os bytes significa blob truncado.
            if depth == 0 {
                break;
            }
            return None;
        }
        let value_type = data[*offset];
        *offset += 1;
        if value_type == 8 {
            break;
        }

        let key = match string_table {
            Some(table) => {
                let index = read_u32(data, offset)? as usize;
                table.get(index)?.clone()
            }
            None => read_cstring(data, offset)?,
        };

        match value_type {
            // Objeto aninhado.
            0 => {
                let child = parse_kv_object(data, offset, string_table, depth + 1)?;
                result.insert(key, KvValue::Object(child));
            }
            // String.
            1 => {
                let text = read_cstring(data, offset)?;
                result.insert(key, KvValue::Text(text));
            }
            // int32 / float32 / pointer / color: todos 4 bytes. `buildid` chega
            // como int32 em parte dos apps, por isso o valor e guardado como texto.
            2 | 3 | 4 | 6 => {
                let raw = read_u32(data, offset)?;
                result.insert(key, KvValue::Text((raw as i32).to_string()));
            }
            // wstring UTF-16: nenhum campo que interessa usa, mas precisa ser
            // consumido para nao desalinhar o resto do blob.
            5 => {
                let mut end = *offset;
                while end + 1 < data.len() && !(data[end] == 0 && data[end + 1] == 0) {
                    end += 2;
                }
                if end + 1 >= data.len() {
                    return None;
                }
                *offset = end + 2;
                result.insert(key, KvValue::Text(String::new()));
            }
            // uint64 / int64.
            7 | 10 => {
                let end = offset.checked_add(8)?;
                if end > data.len() {
                    return None;
                }
                let raw = u64::from_le_bytes(data[*offset..end].try_into().ok()?);
                *offset = end;
                result.insert(key, KvValue::Text(raw.to_string()));
            }
            _ => return None,
        }
    }

    Some(result)
}

/// Percorre as entradas de app ate achar `app_id` e devolve so o blob KV dele.
/// O arquivo passa de 100 MB em instalacoes grandes — parsear tudo seria
/// desperdicio, entao o loop pula pelo campo `size` de cada entrada.
fn find_app_blob(data: &[u8], app_id: u32) -> Option<(BTreeMap<String, KvValue>, Option<Vec<String>>)> {
    let mut offset = 0usize;
    let magic = read_u32(data, &mut offset)?;
    if magic != MAGIC_V27 && magic != MAGIC_V28 && magic != MAGIC_V29 {
        return None;
    }
    let _universe = read_u32(data, &mut offset)?;

    let string_table = if magic >= MAGIC_V29 {
        let table_offset = read_i64(data, &mut offset)?;
        Some(read_string_table(data, table_offset)?)
    } else {
        None
    };

    let header_after_size = if magic >= MAGIC_V28 {
        APP_HEADER_AFTER_SIZE + APP_HEADER_SHA1_BINARY
    } else {
        APP_HEADER_AFTER_SIZE
    };

    loop {
        let entry_app_id = read_u32(data, &mut offset)?;
        if entry_app_id == 0 {
            return None;
        }
        let size = read_u32(data, &mut offset)?;
        let blob_size = size.checked_sub(header_after_size)? as usize;
        let blob_start = offset.checked_add(header_after_size as usize)?;
        let blob_end = blob_start.checked_add(blob_size)?;
        if blob_end > data.len() {
            return None;
        }

        if entry_app_id == app_id {
            // Fatiar em vez de passar o arquivo inteiro: assim um blob truncado
            // para no limite da propria entrada e nao sai lendo a entrada seguinte.
            let mut blob_offset = 0usize;
            let parsed = parse_kv_object(
                &data[blob_start..blob_end],
                &mut blob_offset,
                string_table.as_deref(),
                0,
            )?;
            return Some((parsed, string_table));
        }

        offset = blob_end;
    }
}

/// Remove o que o Windows nao aceita em nome de pasta e apara pontos/espacos
/// finais, que o explorer descarta silenciosamente e quebrariam o `installdir`.
pub fn sanitize_install_dir(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|character| {
            if INVALID_PATH_CHARS.contains(&character) || (character as u32) < 0x20 {
                '_'
            } else {
                character
            }
        })
        .collect();
    cleaned.trim().trim_end_matches(['.', ' ']).trim().to_string()
}

/// Le o appinfo local. `None` quando o arquivo nao existe, a versao do formato
/// mudou, ou o app nao esta em cache — todos os casos em que o chamador precisa
/// cair no fallback pelo titulo do catalogo.
pub fn read_app_info(steam_path: &str, app_id: &str) -> Option<AppInfo> {
    let app_id_number: u32 = app_id.trim().parse().ok()?;
    let path = Path::new(steam_path).join("appcache").join("appinfo.vdf");
    let data = std::fs::read(path).ok()?;
    let (blob, _table) = find_app_blob(&data, app_id_number)?;
    // O blob de cada app vem embrulhado num unico no raiz chamado `appinfo`.
    // Alguns dumps de terceiros omitem esse embrulho, entao os dois casos valem.
    let blob = match lookup(&blob, &["appinfo"]).and_then(kv_object) {
        Some(inner) => inner.clone(),
        None => blob,
    };

    let install_dir = lookup(&blob, &["config", "installdir"])
        .and_then(kv_text)
        .map(sanitize_install_dir)
        .unwrap_or_default();
    let build_id = lookup(&blob, &["depots", "branches", "public", "buildid"])
        .and_then(kv_text)
        .unwrap_or_default()
        .to_string();
    let name = lookup(&blob, &["common", "name"])
        .and_then(kv_text)
        .unwrap_or_default()
        .to_string();

    if install_dir.is_empty() && build_id.is_empty() && name.is_empty() {
        return None;
    }

    Some(AppInfo {
        install_dir,
        build_id,
        name,
    })
}

/// Resolve o `installdir` com o fallback do plano: appinfo primeiro, titulo do
/// catalogo sanitizado depois. Nunca devolve string vazia — um `installdir` vazio
/// faria o ACF apontar para a raiz de `steamapps\common`.
pub fn resolve_install_dir(app_info: Option<&AppInfo>, fallback_title: &str, app_id: &str) -> String {
    if let Some(info) = app_info {
        if !info.install_dir.is_empty() {
            return info.install_dir.clone();
        }
    }
    let sanitized = sanitize_install_dir(fallback_title);
    if sanitized.is_empty() {
        format!("app_{app_id}")
    } else {
        sanitized
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Monta um appinfo.vdf minimo em memoria. Testar contra o arquivo real da
    /// maquina tornaria o teste dependente da biblioteca instalada.
    fn build_appinfo_v28(app_id: u32, install_dir: &str, build_id: &str, name: &str) -> Vec<u8> {
        fn cstr(out: &mut Vec<u8>, text: &str) {
            out.extend_from_slice(text.as_bytes());
            out.push(0);
        }

        let mut blob = Vec::new();
        blob.push(0); // objeto: appinfo
        cstr(&mut blob, "appinfo");
        {
            blob.push(0); // objeto: common
            cstr(&mut blob, "common");
            blob.push(1);
            cstr(&mut blob, "name");
            cstr(&mut blob, name);
            blob.push(8);

            blob.push(0); // objeto: config
            cstr(&mut blob, "config");
            blob.push(1);
            cstr(&mut blob, "installdir");
            cstr(&mut blob, install_dir);
            blob.push(8);

            blob.push(0); // objeto: depots
            cstr(&mut blob, "depots");
            blob.push(0);
            cstr(&mut blob, "branches");
            blob.push(0);
            cstr(&mut blob, "public");
            blob.push(1);
            cstr(&mut blob, "buildid");
            cstr(&mut blob, build_id);
            blob.push(8); // fecha public
            blob.push(8); // fecha branches
            blob.push(8); // fecha depots
        }
        blob.push(8); // fecha appinfo

        let mut out = Vec::new();
        out.extend_from_slice(&MAGIC_V28.to_le_bytes());
        out.extend_from_slice(&1u32.to_le_bytes()); // universe

        // Uma entrada de app anterior, para provar que o skip pelo `size` funciona.
        let filler = vec![0xAAu8; 12];
        out.extend_from_slice(&(app_id + 1).to_le_bytes());
        out.extend_from_slice(
            &((APP_HEADER_AFTER_SIZE + APP_HEADER_SHA1_BINARY) + filler.len() as u32).to_le_bytes(),
        );
        out.extend_from_slice(&[0u8; 60]);
        out.extend_from_slice(&filler);

        out.extend_from_slice(&app_id.to_le_bytes());
        out.extend_from_slice(
            &((APP_HEADER_AFTER_SIZE + APP_HEADER_SHA1_BINARY) + blob.len() as u32).to_le_bytes(),
        );
        out.extend_from_slice(&[0u8; 60]);
        out.extend_from_slice(&blob);

        out.extend_from_slice(&0u32.to_le_bytes()); // fim da lista
        out
    }

    #[test]
    fn reads_installdir_buildid_and_name_skipping_earlier_apps() {
        let data = build_appinfo_v28(367520, "Hollow Knight", "13214117", "Hollow Knight");
        let (blob, _) = find_app_blob(&data, 367520).expect("app deve ser encontrado");
        let appinfo = lookup(&blob, &["appinfo"]).and_then(kv_object).unwrap();

        assert_eq!(
            lookup(appinfo, &["config", "installdir"]).and_then(kv_text),
            Some("Hollow Knight")
        );
        assert_eq!(
            lookup(appinfo, &["depots", "branches", "public", "buildid"]).and_then(kv_text),
            Some("13214117")
        );
        assert_eq!(
            lookup(appinfo, &["common", "name"]).and_then(kv_text),
            Some("Hollow Knight")
        );
    }

    #[test]
    fn missing_app_returns_none_instead_of_scanning_past_the_terminator() {
        let data = build_appinfo_v28(367520, "Hollow Knight", "13214117", "Hollow Knight");
        assert!(find_app_blob(&data, 999999).is_none());
    }

    #[test]
    fn unknown_magic_is_rejected() {
        let mut data = vec![0u8; 64];
        data[..4].copy_from_slice(&0xDEAD_BEEFu32.to_le_bytes());
        assert!(find_app_blob(&data, 367520).is_none());
    }

    #[test]
    fn sanitize_strips_invalid_chars_and_trailing_dots() {
        assert_eq!(sanitize_install_dir("Portal 2"), "Portal 2");
        assert_eq!(sanitize_install_dir("S.T.A.L.K.E.R.: CoP"), "S.T.A.L.K.E.R._ CoP");
        assert_eq!(sanitize_install_dir("Game/Name"), "Game_Name");
        assert_eq!(sanitize_install_dir("trailing..."), "trailing");
    }

    #[test]
    fn resolve_install_dir_falls_back_to_catalogue_title_then_appid() {
        let info = AppInfo {
            install_dir: String::new(),
            build_id: "1".into(),
            name: "N".into(),
        };
        assert_eq!(resolve_install_dir(Some(&info), "Hollow Knight", "367520"), "Hollow Knight");
        assert_eq!(resolve_install_dir(None, "Hollow Knight", "367520"), "Hollow Knight");
        assert_eq!(resolve_install_dir(None, "...", "367520"), "app_367520");
    }
}
