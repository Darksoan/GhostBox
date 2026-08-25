use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Emitter};

pub const LOCAL_ACHIEVEMENTS_UNLOCKED_EVENT: &str = "local-achievements-unlocked";
const POLL_INTERVAL_MS: u64 = 2000;

struct RunningMonitor {
    stop: Arc<AtomicBool>,
}

static MONITORS: OnceLock<Mutex<HashMap<String, RunningMonitor>>> = OnceLock::new();
static SNAPSHOTS: OnceLock<Mutex<HashMap<String, HashSet<String>>>> = OnceLock::new();

fn monitors() -> &'static Mutex<HashMap<String, RunningMonitor>> {
    MONITORS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn snapshots() -> &'static Mutex<HashMap<String, HashSet<String>>> {
    SNAPSHOTS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn normalize_monitor_app_id(app_id: &str) -> String {
    app_id.chars().filter(|c| c.is_ascii_digit()).collect()
}

pub fn start_local_achievement_monitor(
    app: &AppHandle,
    app_id: &str,
    title: &str,
    steam_path: Option<&str>,
) {
    let key = normalize_monitor_app_id(app_id);
    if key.is_empty() {
        return;
    }

    {
        let guard = monitors().lock().unwrap_or_else(|error| error.into_inner());
        if guard.contains_key(&key) {
            return;
        }
    }

    {
        let mut initial = steam_path
            .map(|path| crate::steam_appcache::read_local_unlocked_achievement_titles(path, &key))
            .unwrap_or_default();
        // O emulador Goldberg/GSE grava desbloqueios num JSON próprio; incluí-los
        // no snapshot inicial evita notificações falsas de conquistas antigas.
        initial.extend(crate::goldberg::read_goldberg_unlocked_names(&key));
        snapshots()
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(key.clone(), initial);
    }

    let stop = Arc::new(AtomicBool::new(false));
    monitors()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .insert(key.clone(), RunningMonitor { stop: stop.clone() });

    let app_handle = app.clone();
    let title = title.to_string();
    let steam_path = steam_path.map(str::to_string);

    std::thread::spawn(move || {
        while !stop.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));
            if stop.load(Ordering::Relaxed) {
                break;
            }
            if !crate::playtime::is_playtime_session_active(&key) {
                break;
            }
            notify_new_unlocks(&app_handle, &key, &title, steam_path.as_deref());
        }

        monitors()
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&key);
        snapshots()
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&key);
    });
}

pub fn stop_local_achievement_monitor(app_id: &str) {
    let key = normalize_monitor_app_id(app_id);
    if key.is_empty() {
        return;
    }

    if let Some(monitor) = monitors()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .remove(&key)
    {
        monitor.stop.store(true, Ordering::Relaxed);
    }

    snapshots()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .remove(&key);
}

pub fn stop_all_local_achievement_monitors() {
    let entries = monitors()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .drain()
        .collect::<Vec<_>>();

    for (_, monitor) in entries {
        monitor.stop.store(true, Ordering::Relaxed);
    }

    snapshots()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clear();
}

fn notify_new_unlocks(app: &AppHandle, app_id: &str, title: &str, steam_path: Option<&str>) {
    let mut current = steam_path
        .map(|path| crate::steam_appcache::read_local_unlocked_achievement_titles(path, app_id))
        .unwrap_or_default();
    // Fonte offline: conquistas persistidas pelo emulador (nomes de API da
    // schema oficial da Steam).
    current.extend(crate::goldberg::read_goldberg_unlocked_names(app_id));
    let mut snapshots_guard = snapshots()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let previous = snapshots_guard.entry(app_id.to_string()).or_default();
    let new_unlocks: Vec<String> = current.difference(previous).cloned().collect();
    if new_unlocks.is_empty() {
        return;
    }
    *previous = current;
    drop(snapshots_guard);

    let _ = app.emit(
        LOCAL_ACHIEVEMENTS_UNLOCKED_EVENT,
        serde_json::json!({
            "appId": app_id,
            "title": title,
            "achievements": new_unlocks,
        }),
    );
}
