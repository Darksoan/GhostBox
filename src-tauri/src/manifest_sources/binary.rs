//! Validacao estrutural do formato protobuf de DepotManifest (SteamKit2).
//! Isto confere os IDs internos, nao autentica a assinatura da Valve.

const PAYLOAD: u32 = 0x71F617D0;
const METADATA: u32 = 0x1F4812BE;
const SIGNATURE: u32 = 0x1B81B817;
const END: u32 = 0x32C415AB;

fn take<'a>(input: &mut &'a [u8], len: usize) -> Result<&'a [u8], &'static str> {
    let value = input.get(..len).ok_or("dados truncados")?;
    *input = &input[len..];
    Ok(value)
}

fn word(input: &mut &[u8]) -> Result<u32, &'static str> {
    Ok(u32::from_le_bytes(take(input, 4)?.try_into().unwrap()))
}

fn varint(input: &mut &[u8]) -> Result<u64, &'static str> {
    let mut value = 0;
    for shift in (0..70).step_by(7) {
        let byte = take(input, 1)?[0];
        if shift == 63 && byte > 1 {
            return Err("varint excede u64");
        }
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Ok(value);
        }
    }
    Err("varint invalido")
}

fn metadata_ids(mut input: &[u8]) -> Result<(u64, u64), &'static str> {
    let (mut depot, mut gid) = (None, None);
    while !input.is_empty() {
        let tag = varint(&mut input)?;
        let field = tag >> 3;
        let wire = tag & 7;
        if field == 0 || field > 0x1fff_ffff {
            return Err("campo protobuf invalido");
        }
        if field == 1 || field == 2 {
            if wire != 0 {
                return Err("tipo de ID invalido");
            }
            let target = if field == 1 { &mut depot } else { &mut gid };
            if target.replace(varint(&mut input)?).is_some() {
                return Err("ID duplicado");
            }
        } else {
            match wire {
                0 => {
                    varint(&mut input)?;
                }
                1 => {
                    take(&mut input, 8)?;
                }
                2 => {
                    let len =
                        usize::try_from(varint(&mut input)?).map_err(|_| "tamanho invalido")?;
                    take(&mut input, len)?;
                }
                5 => {
                    take(&mut input, 4)?;
                }
                _ => return Err("tipo protobuf invalido"),
            }
        }
    }
    Ok((depot.ok_or("depot ausente")?, gid.ok_or("GID ausente")?))
}

pub(super) fn validate(bytes: &[u8], depot_id: u32, manifest_id: u64) -> Result<(), &'static str> {
    let mut input = bytes;
    // Ordem emitida pela Steam/SteamKit; comprimentos limitados pelo buffer.
    for magic in [PAYLOAD, METADATA, SIGNATURE] {
        if word(&mut input)? != magic {
            return Err("secao de manifest invalida");
        }
        let len = word(&mut input)? as usize;
        let section = take(&mut input, len)?;
        if magic == METADATA && metadata_ids(section)? != (u64::from(depot_id), manifest_id) {
            return Err("depot ou GID difere do solicitado");
        }
    }
    if word(&mut input)? != END || !input.is_empty() {
        return Err("fim de manifest invalido");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(metadata: &[u8]) -> Vec<u8> {
        let mut bytes = Vec::new();
        for (magic, section) in [
            (PAYLOAD, &[][..]),
            (METADATA, metadata),
            (SIGNATURE, &[][..]),
        ] {
            bytes.extend(magic.to_le_bytes());
            bytes.extend((section.len() as u32).to_le_bytes());
            bytes.extend(section);
        }
        bytes.extend(END.to_le_bytes());
        bytes
    }

    #[test]
    fn accepts_matching_ids_and_unknown_metadata_fields() {
        let bytes = manifest(&[8, 42, 16, 123, 26, 2, 1, 2, 37, 0, 0, 0, 0]);
        assert!(validate(&bytes, 42, 123).is_ok());
    }

    #[test]
    fn rejects_wrong_or_missing_ids() {
        assert!(validate(&manifest(&[8, 42, 16, 123]), 43, 123).is_err());
        assert!(validate(&manifest(&[8, 42, 16, 123]), 42, 124).is_err());
        assert!(validate(&manifest(&[8, 42]), 42, 123).is_err());
        assert!(validate(&manifest(&[8, 42, 8, 42, 16, 123]), 42, 123).is_err());
    }

    #[test]
    fn rejects_html_truncation_and_trailing_bytes() {
        assert!(validate(b"<html>not found</html>", 42, 123).is_err());
        let bytes = manifest(&[8, 42, 16, 123]);
        for len in 0..bytes.len() {
            assert!(validate(&bytes[..len], 42, 123).is_err());
        }
        let mut trailing = bytes;
        trailing.push(0);
        assert!(validate(&trailing, 42, 123).is_err());
    }

    #[test]
    fn rejects_overflows_and_invalid_wire_types() {
        assert!(
            metadata_ids(&[8, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 2]).is_err()
        );
        assert!(metadata_ids(&[10, 1, 42, 16, 123]).is_err());
        assert!(metadata_ids(&[0]).is_err());
    }
}
