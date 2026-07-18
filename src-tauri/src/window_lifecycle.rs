use crate::playtime::{
    close_all_game_playtime_sessions, start_game_playtime_snapshot_emitter,
    start_steam_running_app_monitor,
};
use crate::settings::{
    apply_autostart_settings, is_startup_setting_enabled, startup_setting_enabled,
};
use crate::load_startup_settings;

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_WINDOW_LABEL: &str = "tray-menu";
const WINDOW_HIDDEN_TO_TRAY_EVENT: &str = "window-hidden-to-tray";
const TRAY_NAVIGATE_EVENT: &str = "tray-navigate";
const TRAY_LIBRARY_LIMIT: usize = 20;
const TRAY_MENU_WIDTH: f64 = 248.0;
const TRAY_MENU_HEIGHT: f64 = 360.0;
const APP_USER_MODEL_ID: &str = "com.ghostbox.app";
const WINDOW_BACKGROUND: tauri::window::Color = tauri::window::Color(11, 11, 11, 255);

static IS_QUITTING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static SHUTDOWN_STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static TRAY_LIBRARY_GAMES: std::sync::Mutex<Vec<serde_json::Value>> =
    std::sync::Mutex::new(Vec::new());

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
}

fn hide_main_window_to_tray(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    use tauri::Emitter;

    let _ = window.hide();
    let _ = app.emit(WINDOW_HIDDEN_TO_TRAY_EVENT, ());
}

fn request_close_main_window(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    if IS_QUITTING.load(std::sync::atomic::Ordering::SeqCst) {
        quit_application(app);
        return;
    }

    if is_startup_setting_enabled(app, "minimizeToTray") {
        hide_main_window_to_tray(app, window);
        return;
    }

    quit_application(app);
}

fn quit_application(app: &tauri::AppHandle) {
    if IS_QUITTING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
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

pub(crate) fn show_main_window_when_ready(app: &tauri::AppHandle) {
    if !is_startup_setting_enabled(app, "startMinimized") {
        show_main_window(app);
    }
}

fn hide_tray_menu(app: &tauri::AppHandle) {
    use tauri::Manager;

    if let Some(window) = app.get_webview_window(TRAY_WINDOW_LABEL) {
        let _ = window.hide();
    }
}

fn tray_game_app_id(game: &serde_json::Value) -> String {
    game.get("appId")
        .or_else(|| game.get("app_id"))
        .or_else(|| game.get("id"))
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn tray_text_value(value: Option<&serde_json::Value>) -> String {
    value
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string()
}

fn is_tray_title_placeholder(title: &str, app_id: &str) -> bool {
    let normalized_title = title
        .chars()
        .filter(|character| !character.is_whitespace() && *character != '-' && *character != '_')
        .collect::<String>()
        .to_ascii_lowercase();
    let normalized_app_id = app_id.trim().to_ascii_lowercase();

    normalized_title.is_empty()
        || normalized_title == normalized_app_id
        || normalized_title == format!("steamapp{normalized_app_id}")
        || normalized_title == format!("steamappid{normalized_app_id}")
        || normalized_title == format!("steam{normalized_app_id}")
}

fn normalize_tray_game_title(
    app: &tauri::AppHandle,
    mut game: serde_json::Value,
) -> serde_json::Value {
    let app_id = tray_game_app_id(&game);
    let title = tray_text_value(game.get("title"));

    if app_id.is_empty() || !is_tray_title_placeholder(&title, &app_id) {
        return game;
    }

    if let Some(title) = crate::catalogue::read_cached_steam_store_title(app, &app_id)
        .or_else(|| crate::catalogue::read_local_steam_app_title(app, &app_id))
    {
        if let Some(object) = game.as_object_mut() {
            object.insert("title".to_string(), serde_json::Value::String(title));
        }
    }

    game
}

fn normalize_tray_library_games(
    app: &tauri::AppHandle,
    games: Vec<serde_json::Value>,
) -> Vec<serde_json::Value> {
    let mut deduped = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for game in games {
        let app_id = tray_game_app_id(&game);
        if app_id.is_empty() || !seen.insert(app_id) {
            continue;
        }
        deduped.push(normalize_tray_game_title(app, game));
        if deduped.len() >= TRAY_LIBRARY_LIMIT {
            break;
        }
    }

    deduped
}

fn cached_tray_library_games(app: &tauri::AppHandle) -> Vec<serde_json::Value> {
    let cached_games = TRAY_LIBRARY_GAMES
        .lock()
        .map(|games| games.clone())
        .unwrap_or_default();

    if !cached_games.is_empty() {
        return cached_games;
    }

    let persisted_games = normalize_tray_library_games(
        app,
        crate::ghostbox_library::read_ghostbox_library_games(app),
    );
    if let Ok(mut tray_games) = TRAY_LIBRARY_GAMES.lock() {
        *tray_games = persisted_games.clone();
    }

    persisted_games
}

fn tray_menu_position(position: tauri::PhysicalPosition<f64>) -> (f64, f64) {
    let x = (position.x - TRAY_MENU_WIDTH + 18.0).max(8.0);
    let y = (position.y - TRAY_MENU_HEIGHT - 8.0).max(8.0);
    (x, y)
}

fn build_tray_menu_window(app: &tauri::AppHandle, x: f64, y: f64, visible: bool) {
    use tauri::Manager;

    if let Some(window) = app.get_webview_window(TRAY_WINDOW_LABEL) {
        let _ = window.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
        if visible {
            let _ = window.show();
            let _ = window.set_focus();
        }
        return;
    }

    let Ok(window) = tauri::WebviewWindowBuilder::new(
        app,
        TRAY_WINDOW_LABEL,
        tauri::WebviewUrl::App("index.html?tray=1".into()),
    )
    .title("GhostBox")
    .decorations(false)
    .resizable(false)
    .maximizable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .focused(visible)
    .visible(visible)
    .shadow(false)
    .background_color(WINDOW_BACKGROUND)
    .additional_browser_args(
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --enable-smooth-scrolling",
    )
    .inner_size(TRAY_MENU_WIDTH, TRAY_MENU_HEIGHT)
    .position(x, y)
    .build() else {
        return;
    };

    let app_handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Focused(false)) {
            hide_tray_menu(&app_handle);
        }
    });
}

fn show_tray_menu(app: &tauri::AppHandle, position: tauri::PhysicalPosition<f64>) {
    let (x, y) = tray_menu_position(position);
    build_tray_menu_window(app, x, y, true);
}

fn preload_tray_menu(app: &tauri::AppHandle) {
    build_tray_menu_window(app, 0.0, 0.0, false);
}

fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::tray::{TrayIconBuilder, TrayIconEvent};

    let mut tray = TrayIconBuilder::with_id("main-tray")
        .tooltip("GhostBox")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                position,
                button_state,
                ..
            } if matches!(button_state, tauri::tray::MouseButtonState::Down) => {
                show_tray_menu(tray.app_handle(), position);
            }
            TrayIconEvent::DoubleClick { position, .. } => {
                show_tray_menu(tray.app_handle(), position);
            }
            _ => {}
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

#[tauri::command]
pub fn tray_set_library_games(
    app: tauri::AppHandle,
    games: Vec<serde_json::Value>,
) -> Result<(), String> {
    let deduped = normalize_tray_library_games(&app, games);

    if let Ok(mut tray_games) = TRAY_LIBRARY_GAMES.lock() {
        *tray_games = deduped;
    }

    Ok(())
}

#[tauri::command]
pub fn tray_get_library_games(app: tauri::AppHandle) -> Vec<serde_json::Value> {
    cached_tray_library_games(&app)
}

#[tauri::command]
pub fn tray_launch_game(
    app: tauri::AppHandle,
    app_id: String,
) -> Result<serde_json::Value, String> {
    let game = cached_tray_library_games(&app)
        .into_iter()
        .find(|game| tray_game_app_id(game) == app_id.trim());

    hide_tray_menu(&app);
    match game {
        Some(game) => crate::launch_game_from_value(app, game),
        None => Ok(serde_json::json!({
            "success": false,
            "appId": app_id,
            "error": "Jogo não encontrado na biblioteca."
        })),
    }
}

#[tauri::command]
pub fn tray_show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    hide_tray_menu(&app);
    show_main_window(&app);
    Ok(())
}

#[tauri::command]
pub fn tray_navigate(app: tauri::AppHandle, page: String) -> Result<(), String> {
    use tauri::Emitter;

    let page = page.trim();
    if !matches!(page, "home" | "catalogue" | "library" | "profile") {
        return Err("Página inválida.".to_string());
    }

    hide_tray_menu(&app);
    show_main_window(&app);
    app.emit(TRAY_NAVIGATE_EVENT, serde_json::json!({ "page": page }))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn tray_hide_menu(app: tauri::AppHandle) -> Result<(), String> {
    hide_tray_menu(&app);
    Ok(())
}

#[tauri::command]
pub fn tray_quit_application(app: tauri::AppHandle) -> Result<(), String> {
    quit_application(&app);
    Ok(())
}

pub(crate) fn setup_window_lifecycle(app: &mut tauri::App) -> tauri::Result<()> {
    use tauri::Manager;

    configure_windows_app_identity();

    let handle = app.handle().clone();
    let settings = load_startup_settings(&handle);
    let _ = apply_autostart_settings(&handle, &settings);

    setup_tray(&handle)?;
    preload_tray_menu(&handle);
    start_steam_running_app_monitor(handle.clone());
    start_game_playtime_snapshot_emitter(handle.clone());

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.set_background_color(Some(WINDOW_BACKGROUND));
        let _ = window.set_resizable(false);
        let _ = window.set_maximizable(false);

        if let Some(icon) = ghostbox_icon() {
            let _ = window.set_icon(icon);
        }

        let close_app = handle.clone();
        let close_window = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Always handle close ourselves so a leftover tray-menu window
                // cannot keep the process alive after the main UI is gone.
                api.prevent_close();

                if IS_QUITTING.load(std::sync::atomic::Ordering::SeqCst) {
                    quit_application(&close_app);
                    return;
                }

                if is_startup_setting_enabled(&close_app, "minimizeToTray") {
                    hide_main_window_to_tray(&close_app, &close_window);
                    return;
                }

                quit_application(&close_app);
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
    request_close_main_window(&app, &window);
    Ok(())
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
