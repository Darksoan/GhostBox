use crate::load_startup_settings;
use crate::playtime::{
    close_all_game_playtime_sessions, start_game_playtime_snapshot_emitter,
    start_steam_running_app_monitor,
};
use crate::settings::{
    apply_autostart_settings, is_startup_minimized_launch, is_startup_setting_enabled,
    startup_setting_enabled, STARTUP_MINIMIZED_ARG,
};

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_WINDOW_LABEL: &str = "tray-menu";
const WINDOW_HIDDEN_TO_TRAY_EVENT: &str = "window-hidden-to-tray";
const TRAY_NAVIGATE_EVENT: &str = "tray-navigate";
const TRAY_MENU_WIDTH: f64 = 300.0;
const TRAY_MENU_HEIGHT: f64 = 520.0;
const APP_USER_MODEL_ID: &str = "com.ghostbox.app";
const WINDOW_BACKGROUND: tauri::window::Color = tauri::window::Color(11, 11, 11, 255);
#[cfg(windows)]
const MAIN_WINDOW_ZOOM_FACTOR: f64 = 1.0;

static IS_QUITTING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static SHUTDOWN_STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static TRAY_LIBRARY_GAMES: std::sync::Mutex<Vec<serde_json::Value>> =
    std::sync::Mutex::new(Vec::new());

fn ghostbox_icon() -> Option<tauri::image::Image<'static>> {
    tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")).ok()
}

#[cfg(windows)]
fn primary_scale_factor(app: &tauri::AppHandle) -> f64 {
    app.primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| monitor.scale_factor())
        .unwrap_or(1.0)
}

#[cfg(windows)]
fn ghostbox_window_icon(_app: &tauri::AppHandle) -> Option<tauri::image::Image<'static>> {
    // A janela e a barra de tarefas usam a fonte de marca diretamente. Isso
    // impede que um derivado antigo continue embutido quando desktopicon.png
    // for substituído mantendo o mesmo nome.
    tauri::image::Image::from_bytes(include_bytes!("../../Icons/desktopicon.png")).ok()
}

#[cfg(not(windows))]
fn ghostbox_window_icon(_app: &tauri::AppHandle) -> Option<tauri::image::Image<'static>> {
    ghostbox_icon()
}

#[cfg(windows)]
fn ghostbox_tray_icon(
    app: &tauri::AppHandle,
    theme: tauri::Theme,
) -> Option<tauri::image::Image<'static>> {
    let physical_size = (16.0 * primary_scale_factor(app)).round() as u32;
    let light_theme = matches!(theme, tauri::Theme::Light);
    let bytes: &[u8] = match (light_theme, physical_size) {
        (true, 0..=18) => include_bytes!("../icons/tray-light/16x16.png"),
        (true, 19..=22) => include_bytes!("../icons/tray-light/20x20.png"),
        (true, 23..=26) => include_bytes!("../icons/tray-light/24x24.png"),
        (true, 27..=30) => include_bytes!("../icons/tray-light/28x28.png"),
        (true, 31..=34) => include_bytes!("../icons/tray-light/32x32.png"),
        (true, 35..=38) => include_bytes!("../icons/tray-light/36x36.png"),
        (true, 39..=44) => include_bytes!("../icons/tray-light/40x40.png"),
        (true, 45..=52) => include_bytes!("../icons/tray-light/48x48.png"),
        (true, 53..=60) => include_bytes!("../icons/tray-light/56x56.png"),
        (true, _) => include_bytes!("../icons/tray-light/64x64.png"),
        (false, 0..=18) => include_bytes!("../icons/tray-icon.png"),
        (false, 19..=22) => include_bytes!("../icons/tray-icon-20.png"),
        (false, 23..=26) => include_bytes!("../icons/tray-icon-24.png"),
        (false, 27..=30) => include_bytes!("../icons/tray-icon-28.png"),
        (false, 31..=34) => include_bytes!("../icons/tray-icon-32.png"),
        (false, 35..=38) => include_bytes!("../icons/tray-icon-36.png"),
        (false, 39..=44) => include_bytes!("../icons/tray-icon-40.png"),
        (false, 45..=52) => include_bytes!("../icons/tray-icon-48.png"),
        (false, 53..=60) => include_bytes!("../icons/tray-icon-56.png"),
        (false, _) => include_bytes!("../icons/tray-icon-64.png"),
    };

    tauri::image::Image::from_bytes(bytes).ok()
}

#[cfg(not(windows))]
fn ghostbox_tray_icon(
    _app: &tauri::AppHandle,
    _theme: tauri::Theme,
) -> Option<tauri::image::Image<'static>> {
    ghostbox_icon()
}

#[cfg(windows)]
fn windows_system_theme() -> Option<tauri::Theme> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};

    let key: Vec<u16> = "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize\0"
        .encode_utf16()
        .collect();
    let value: Vec<u16> = "SystemUsesLightTheme\0".encode_utf16().collect();
    let mut system_uses_light_theme = 0_u32;
    let mut size = std::mem::size_of_val(&system_uses_light_theme) as u32;

    // The taskbar follows the Windows app theme, which can differ from the
    // WebView's reported theme during startup.
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_DWORD,
            std::ptr::null_mut(),
            &mut system_uses_light_theme as *mut u32 as *mut _,
            &mut size,
        )
    };

    (status == 0).then(|| {
        if system_uses_light_theme == 0 {
            tauri::Theme::Dark
        } else {
            tauri::Theme::Light
        }
    })
}

fn system_theme(app: &tauri::AppHandle) -> tauri::Theme {
    #[cfg(windows)]
    if let Some(theme) = windows_system_theme() {
        return theme;
    }

    use tauri::Manager;

    app.get_webview_window(MAIN_WINDOW_LABEL)
        .and_then(|window| window.theme().ok())
        .unwrap_or(tauri::Theme::Dark)
}

fn update_tray_icon(app: &tauri::AppHandle, theme: tauri::Theme) {
    if let (Some(tray), Some(icon)) = (app.tray_by_id("main-tray"), ghostbox_tray_icon(app, theme))
    {
        let _ = tray.set_icon(Some(icon));
    }
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

#[cfg(windows)]
fn refresh_windows_shell_icons() {
    use std::ptr;
    use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};

    // O executável e o AppUserModelID não mudam entre versões, então o Explorer
    // pode manter o bitmap antigo mesmo após icon.ico ser substituído.
    unsafe {
        SHChangeNotify(
            SHCNE_ASSOCCHANGED as i32,
            SHCNF_IDLIST,
            ptr::null(),
            ptr::null(),
        );
    }
}

#[cfg(not(windows))]
fn refresh_windows_shell_icons() {}

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
    let should_start_minimized =
        is_startup_setting_enabled(app, "startMinimized") && is_startup_minimized_launch();
    if !should_start_minimized {
        show_main_window(app);
    }
}

pub(crate) fn show_main_window_for_launch_args(app: &tauri::AppHandle, args: &[String]) {
    let should_start_minimized = is_startup_setting_enabled(app, "startMinimized")
        && args.iter().any(|arg| arg == STARTUP_MINIMIZED_ARG);
    if !should_start_minimized {
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
                button,
                button_state,
                ..
            } if matches!(button_state, tauri::tray::MouseButtonState::Down) => match button {
                tauri::tray::MouseButton::Right => show_tray_menu(tray.app_handle(), position),
                tauri::tray::MouseButton::Left => show_main_window(tray.app_handle()),
                _ => {}
            },
            _ => {}
        });

    if let Some(icon) = ghostbox_tray_icon(app, system_theme(app))
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

    match game {
        Some(game) => {
            let result = crate::launch_game_from_value(app.clone(), game);
            if result
                .as_ref()
                .ok()
                .and_then(|value| value.get("success"))
                .and_then(|value| value.as_bool())
                == Some(true)
            {
                hide_tray_menu(&app);
            }
            result
        }
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
        // O plugin de estado pode restaurar dimensoes de uma versao anterior.
        // Use os mesmos limites logicos do config, respeitando o DPI do monitor.
        if let Some(config) = handle
            .config()
            .app
            .windows
            .iter()
            .find(|config| config.label == MAIN_WINDOW_LABEL)
        {
            if let (Some(min_width), Some(min_height)) = (config.min_width, config.min_height) {
                window.set_min_size(Some(tauri::LogicalSize::new(min_width, min_height)))?;
                if !window.is_maximized()? && !window.is_fullscreen()? {
                    let size = window.inner_size()?.to_logical::<f64>(window.scale_factor()?);
                    if size.width < min_width || size.height < min_height {
                        window.set_size(tauri::LogicalSize::new(
                            size.width.max(min_width),
                            size.height.max(min_height),
                        ))?;
                    }
                }
            }
        }
        // Restaura o zoom da página em 100% antes de exibir a janela,
        // sem alterar o DPI do monitor nem a escala do menu da bandeja.
        #[cfg(windows)]
        window.set_zoom(MAIN_WINDOW_ZOOM_FACTOR)?;

        let _ = window.set_background_color(Some(WINDOW_BACKGROUND));

        if let Some(icon) = ghostbox_window_icon(&handle) {
            let _ = window.set_icon(icon);
        }
        refresh_windows_shell_icons();

        let close_app = handle.clone();
        let close_window = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::ThemeChanged(_) = event {
                update_tray_icon(&close_app, system_theme(&close_app));
            }

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

        if startup_setting_enabled(&settings, "startMinimized") && is_startup_minimized_launch() {
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

/// Domínios que o app pode abrir no navegador. Cada entrada casa com o próprio
/// domínio e com seus subdomínios — `stripe.com` cobre `checkout.stripe.com` e
/// `billing.stripe.com`, que são os hosts que o Checkout e o portal devolvem.
///
/// A lista é curta de propósito: a URL de destino quase sempre vem de fora
/// (sessão da Stripe, OAuth do Discord, ação de uma notificação), então é ela
/// que define o que o usuário vê no navegador.
const ALLOWED_EXTERNAL_HOSTS: &[&str] = &[
    "discord.com",
    "discord.gg",
    "stripe.com",
    "steampowered.com",
    "steamcommunity.com",
    "github.com",
    // Workers do próprio projeto (subscriptions, feedback, catalogue...).
    "hella.workers.dev",
];

fn is_allowed_external_url(url: &str) -> bool {
    let trimmed = url.trim();
    // `steam://` é entregue ao cliente Steam local, não ao navegador.
    if trimmed.starts_with("steam://") {
        return true;
    }

    let Ok(parsed) = reqwest::Url::parse(trimmed) else {
        return false;
    };
    // Só https: barra `javascript:`, `file:`, `data:` e os esquemas de
    // configuração do Windows (`ms-settings:` e afins).
    if parsed.scheme() != "https" {
        return false;
    }

    let Some(host) = parsed.host_str() else {
        return false;
    };
    // O ponto final de um FQDN (`discord.com.`) resolve para o mesmo host, mas
    // não casaria na comparação literal.
    let host = host.trim_end_matches('.').to_ascii_lowercase();

    ALLOWED_EXTERNAL_HOSTS.iter().any(|allowed| {
        // O ponto no sufixo é o que impede `notdiscord.com` de passar por
        // `discord.com`.
        host == *allowed || host.ends_with(&format!(".{allowed}"))
    })
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

#[tauri::command]
pub fn shell_open_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Pasta de instalação não encontrada.".to_string());
    }
    if !std::path::Path::new(trimmed).exists() {
        return Err("Pasta de instalação não encontrada.".to_string());
    }
    app.opener()
        .open_path(trimmed, None::<&str>)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod external_url_tests {
    use super::is_allowed_external_url;

    #[test]
    fn allows_the_hosts_the_app_actually_opens() {
        for url in [
            "https://discord.gg/Y7XTy5rKBc",
            "https://discord.com/oauth2/authorize?client_id=1",
            "https://checkout.stripe.com/c/pay/cs_test_123",
            "https://billing.stripe.com/p/session/live_123",
            "https://store.steampowered.com/app/2713000",
            "https://steamcommunity.com/profiles/76561198000000000",
            "https://github.com/Darksoan/GhostBox/releases",
            "https://ghostbox-subscriptions.hella.workers.dev/oauth/callback",
            "steam://rungameid/2713000",
        ] {
            assert!(is_allowed_external_url(url), "deveria permitir {url}");
        }
    }

    #[test]
    fn rejects_dangerous_schemes() {
        for url in [
            "javascript:alert(1)",
            "file:///C:/Windows/System32/cmd.exe",
            "data:text/html,<script>alert(1)</script>",
            "ms-settings:windowsupdate",
            "http://discord.com/oauth2/authorize",
        ] {
            assert!(!is_allowed_external_url(url), "deveria bloquear {url}");
        }
    }

    #[test]
    fn rejects_lookalike_hosts() {
        // O sufixo precisa casar num limite de rótulo: um domínio que só
        // *termina* com o texto permitido continua sendo de outra pessoa.
        for url in [
            "https://notdiscord.com/",
            "https://discord.com.evil.example/",
            "https://evil-stripe.com/",
            "https://stripe.com.attacker.test/",
            "https://githubb.com/",
        ] {
            assert!(!is_allowed_external_url(url), "deveria bloquear {url}");
        }
    }

    #[test]
    fn ignores_case_and_trailing_dot_in_the_host() {
        assert!(is_allowed_external_url(
            "https://Checkout.Stripe.COM/c/pay/1"
        ));
        assert!(is_allowed_external_url(
            "https://discord.com./oauth2/authorize"
        ));
    }

    #[test]
    fn rejects_hosts_that_only_look_allowed_in_the_url_text() {
        for url in [
            // O host real é `evil.example`; `discord.com` aqui é userinfo.
            "https://discord.com@evil.example/",
            "https://discord.com:senha@evil.example/",
            // Domínio permitido só no path, na query ou no fragmento.
            "https://evil.example/discord.com",
            "https://evil.example/?next=https://discord.com",
            "https://evil.example/#discord.com",
        ] {
            assert!(!is_allowed_external_url(url), "deveria bloquear {url}");
        }
    }

    #[test]
    fn rejects_garbage_input() {
        for url in ["", "   ", "not a url", "https://"] {
            assert!(!is_allowed_external_url(url), "deveria bloquear {url:?}");
        }
    }
}
