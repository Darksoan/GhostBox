use crate::playtime::{
    close_all_game_playtime_sessions, start_game_playtime_snapshot_emitter,
    start_steam_running_app_monitor,
};
use crate::settings::{
    apply_autostart_settings, is_startup_setting_enabled, startup_setting_enabled,
};
use crate::{load_startup_settings, stop_ghostbox_achievement_server};

const MAIN_WINDOW_LABEL: &str = "main";
const WINDOW_HIDDEN_TO_TRAY_EVENT: &str = "window-hidden-to-tray";
const TRAY_SHOW_ID: &str = "show";
const TRAY_HIDE_ID: &str = "hide";
const TRAY_QUIT_ID: &str = "quit";
const APP_USER_MODEL_ID: &str = "com.ghostbox.app";

static IS_QUITTING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static SHUTDOWN_STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn ghostbox_icon() -> Option<tauri::image::Image<'static>> {
    tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")).ok()
}

fn ghostbox_tray_icon() -> Option<tauri::image::Image<'static>> {
    tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png")).ok()
}

#[cfg(windows)]
fn configure_windows_app_identity() {
    use std::os::windows::ffi::OsStrExt;

    let app_id: Vec<u16> = std::ffi::OsStr::new(APP_USER_MODEL_ID)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(app_id.as_ptr());
    }
}

#[cfg(not(windows))]
fn configure_windows_app_identity() {}

pub(crate) fn shutdown_app_services(app: &tauri::AppHandle) {
    if SHUTDOWN_STARTED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }

    close_all_game_playtime_sessions(app);
    crate::achievement_monitor::stop_all_local_achievement_monitors();
    stop_ghostbox_achievement_server();
}

fn hide_main_window_to_tray(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    use tauri::Emitter;

    let _ = window.hide();
    let _ = app.emit(WINDOW_HIDDEN_TO_TRAY_EVENT, ());
}

fn request_close_main_window(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
) -> Result<(), String> {
    if IS_QUITTING.load(std::sync::atomic::Ordering::SeqCst) {
        return window.close().map_err(|error| error.to_string());
    }

    if is_startup_setting_enabled(app, "minimizeToTray") {
        hide_main_window_to_tray(app, window);
        return Ok(());
    }

    IS_QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
    shutdown_app_services(app);
    window.close().map_err(|error| error.to_string())
}

fn quit_application(app: &tauri::AppHandle) {
    IS_QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
    shutdown_app_services(app);
    app.exit(0);
}

pub(crate) fn show_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn hide_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.hide();
    }
}

fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{TrayIconBuilder, TrayIconEvent};

    let show = MenuItem::with_id(app, TRAY_SHOW_ID, "Abrir GhostBox", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, TRAY_HIDE_ID, "Ocultar", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, TRAY_QUIT_ID, "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .tooltip("GhostBox")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_SHOW_ID => show_main_window(app),
            TRAY_HIDE_ID => hide_main_window(app),
            TRAY_QUIT_ID => quit_application(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(event, TrayIconEvent::DoubleClick { .. }) {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = ghostbox_tray_icon()
        .or_else(ghostbox_icon)
        .or_else(|| app.default_window_icon().cloned())
    {
        tray = tray.icon(icon);
    }

    tray.build(app)?;
    Ok(())
}

pub(crate) fn setup_window_lifecycle(app: &mut tauri::App) -> tauri::Result<()> {
    use tauri::Manager;

    configure_windows_app_identity();

    let handle = app.handle().clone();
    let settings = load_startup_settings(&handle);
    let _ = apply_autostart_settings(&handle, &settings);

    setup_tray(&handle)?;
    start_steam_running_app_monitor(handle.clone());
    start_game_playtime_snapshot_emitter(handle.clone());

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if let Some(icon) = ghostbox_icon() {
            let _ = window.set_icon(icon);
        }

        let close_app = handle.clone();
        let close_window = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if IS_QUITTING.load(std::sync::atomic::Ordering::SeqCst) {
                    return;
                }

                if is_startup_setting_enabled(&close_app, "minimizeToTray") {
                    api.prevent_close();
                    hide_main_window_to_tray(&close_app, &close_window);
                    return;
                }

                IS_QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
                shutdown_app_services(&close_app);
            }
        });

        if startup_setting_enabled(&settings, "startMinimized") {
            let _ = window.hide();
        }
    }

    Ok(())
}

#[tauri::command]
pub fn window_minimize(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn window_close(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    request_close_main_window(&app, &window)
}

fn is_allowed_external_url(url: &str) -> bool {
    let trimmed = url.trim();
    if trimmed.starts_with("steam://") {
        return true;
    }

    let Ok(parsed) = reqwest::Url::parse(trimmed) else {
        return false;
    };
    if parsed.scheme() != "https" {
        return false;
    }

    matches!(parsed.host_str(), Some("discord.gg" | "discord.com"))
}

#[tauri::command]
pub fn shell_open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if !is_allowed_external_url(&url) {
        return Err("URL externa não permitida.".to_string());
    }

    app.opener()
        .open_url(url.trim(), None::<&str>)
        .map_err(|error| error.to_string())
}
