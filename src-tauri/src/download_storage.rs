use std::path::{Path, PathBuf};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadDestination {
    path: String,
    drive: String,
    label: String,
    kind: String,
    is_library: bool,
    free_bytes: u64,
    total_bytes: u64,
    available: bool,
}

fn path_key(path: &str) -> String {
    path.replace('/', "\\").trim_end_matches('\\').to_lowercase()
}

fn destination_paths(libraries: Vec<String>, drives: Vec<String>, selected: Option<String>) -> Vec<(String, bool)> {
    let mut paths: Vec<(String, bool)> = Vec::new();
    for library in libraries {
        if !paths.iter().any(|(path, _)| path_key(path) == path_key(&library)) {
            paths.push((library, true));
        }
    }
    for drive in drives {
        if !paths.iter().any(|(path, _)| path_key(path).starts_with(&format!("{}\\", path_key(&drive)))) {
            paths.push((format!("{}GhostBoxLibrary", drive), false));
        }
    }
    if let Some(path) = selected.filter(|path| !path.trim().is_empty() && Path::new(path).is_absolute()) {
        if !paths.iter().any(|(existing, _)| path_key(existing) == path_key(&path)) {
            paths.push((path, false));
        }
    }
    paths
}

#[cfg(windows)]
fn logical_drives() -> Vec<String> {
    use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};
    let mask = unsafe { GetLogicalDrives() };
    (0..26).filter_map(|index| {
        if mask & (1 << index) == 0 { return None; }
        let root = format!("{}:\\", (b'A' + index as u8) as char);
        let wide: Vec<u16> = root.encode_utf16().chain(Some(0)).collect();
        match unsafe { GetDriveTypeW(wide.as_ptr()) } {
            2 | 3 | 4 => Some(root), // Removível, fixo e unidade de rede mapeada.
            _ => None,
        }
    }).collect()
}

#[cfg(not(windows))]
fn logical_drives() -> Vec<String> { Vec::new() }

fn describe_destination(path: String, is_library: bool) -> DownloadDestination {
    let mut info = DownloadDestination {
        path, drive: String::new(), label: String::new(), kind: "unknown".into(),
        is_library, free_bytes: 0, total_bytes: 0, available: false,
    };
    // O destino de um disco novo ainda não existe. Consulta o ancestral mais
    // próximo sem criar diretórios só para mostrar capacidade nos Ajustes.
    let mut ancestor = PathBuf::from(&info.path);
    while !ancestor.exists() {
        if !ancestor.pop() { return info; }
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Storage::FileSystem::{
            GetDiskFreeSpaceExW, GetDriveTypeW, GetVolumeInformationW, GetVolumePathNameW,
        };
        let wide: Vec<u16> = ancestor.to_string_lossy().encode_utf16().chain(Some(0)).collect();
        let mut root = [0u16; 32768];
        if unsafe { GetVolumePathNameW(wide.as_ptr(), root.as_mut_ptr(), root.len() as u32) } == 0 {
            return info;
        }
        let length = root.iter().position(|unit| *unit == 0).unwrap_or(0);
        info.drive = String::from_utf16_lossy(&root[..length]).trim_end_matches('\\').to_string();
        info.kind = match unsafe { GetDriveTypeW(root.as_ptr()) } {
            2 => "removable", 3 => "fixed", 4 => "network", _ => "unknown",
        }.into();
        let mut label = [0u16; 261];
        if unsafe { GetVolumeInformationW(root.as_ptr(), label.as_mut_ptr(), label.len() as u32,
            std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), 0) } != 0 {
            let length = label.iter().position(|unit| *unit == 0).unwrap_or(0);
            info.label = String::from_utf16_lossy(&label[..length]);
        }
        // Espaço disponível PARA ESTE USUÁRIO (considera quotas do volume).
        info.available = unsafe {
            GetDiskFreeSpaceExW(root.as_ptr(), &mut info.free_bytes, &mut info.total_bytes, std::ptr::null_mut())
        } != 0;
    }
    #[cfg(not(windows))]
    { info.available = ancestor.is_dir(); }
    info
}

#[tauri::command]
pub async fn downloads_list_destinations(
    app: tauri::AppHandle,
    steam_path: Option<String>,
    selected_path: Option<String>,
) -> Result<Vec<DownloadDestination>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let libraries = crate::resolve_steam_path(&app, steam_path).0
            .map(|path| crate::steam::read_registered_steam_library_paths(&path)).unwrap_or_default();
        destination_paths(libraries, logical_drives(), selected_path).into_iter()
            .map(|(path, is_library)| describe_destination(path, is_library)).collect()
    }).await.map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn libraries_win_over_default_disk_folders_and_duplicates_are_removed() {
        let paths = super::destination_paths(vec!["E:\\SteamLibrary".into(), "e:/SteamLibrary/".into()],
            vec!["C:\\".into(), "E:\\".into()], Some("F:\\Custom".into()));
        assert_eq!(paths, vec![("E:\\SteamLibrary".into(), true), ("C:\\GhostBoxLibrary".into(), false), ("F:\\Custom".into(), false)]);
    }

    #[test]
    fn selected_library_is_not_duplicated() {
        let paths = super::destination_paths(vec!["E:\\Games".into()], vec![], Some("e:/Games/".into()));
        assert_eq!(paths.len(), 1);
    }

    #[test]
    fn reports_capacity_without_creating_the_destination() {
        let path = std::env::temp_dir().join(format!("ghostbox-capacity-test-{}", uuid::Uuid::new_v4()));
        let info = super::describe_destination(path.to_string_lossy().into_owned(), false);
        assert!(info.available);
        assert!(!path.exists());
        #[cfg(windows)]
        assert!(info.total_bytes > 0);
    }
}
