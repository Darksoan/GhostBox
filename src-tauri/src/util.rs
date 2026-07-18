pub(crate) fn silent_command(program: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    let mut command = std::process::Command::new(program);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW alone. Do NOT combine with DETACHED_PROCESS —
        // Microsoft docs: CREATE_NO_WINDOW is ignored when used with
        // DETACHED_PROCESS, so steamcmd (and other console tools) would flash
        // a visible console while resolving icons / library assets.
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
}

/// Run steamcmd with no visible console and stdout capture.
/// Sets the working directory to steamcmd's folder (required by steamcmd) and
/// uses quiet flags so it does not prompt or linger.
pub(crate) fn silent_steamcmd_output(
    steamcmd: &std::path::Path,
    app_id: &str,
) -> Option<std::process::Output> {
    silent_steamcmd_output_many(steamcmd, std::slice::from_ref(&app_id))
}

/// Run steamcmd once for multiple app_info_print commands.
/// This avoids the expensive login/update/quit cycle per app when resolving
/// many Steam client icon hashes for visible game lists.
pub(crate) fn silent_steamcmd_output_many(
    steamcmd: &std::path::Path,
    app_ids: &[&str],
) -> Option<std::process::Output> {
    use std::io::Read;
    use wait_timeout::ChildExt;

    if app_ids.is_empty() {
        return None;
    }

    let mut command = silent_command(steamcmd);
    if let Some(dir) = steamcmd.parent() {
        command.current_dir(dir);
    }

    command.args([
        "+@ShutdownOnFailedCommand",
        "1",
        "+@NoPromptForPassword",
        "1",
        "+login",
        "anonymous",
    ]);

    for app_id in app_ids {
        command.args(["+app_info_print", app_id]);
    }

    let mut child = command
        .arg("+quit")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    // Drain stdout while SteamCMD runs; app_info_print output can exceed the
    // OS pipe buffer and deadlock if it is only read after process exit.
    let output_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.read_to_end(&mut bytes);
        bytes
    });
    let status = match child
        .wait_timeout(std::time::Duration::from_secs(30))
        .ok()?
    {
        Some(status) => status,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = output_reader.join();
            return None;
        }
    };
    let stdout = output_reader.join().ok()?;
    Some(std::process::Output {
        status,
        stdout,
        stderr: Vec::new(),
    })
}

pub(crate) fn with_steamcmd_lock<T>(operation: impl FnOnce() -> T) -> T {
    static STEAMCMD_LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    let lock = STEAMCMD_LOCK.get_or_init(|| std::sync::Mutex::new(()));

    match lock.lock() {
        Ok(_guard) => operation(),
        Err(_) => operation(),
    }
}

pub(crate) fn text_value(value: Option<&serde_json::Value>) -> String {
    value
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string()
}

pub(crate) fn merge_object_defaults(
    defaults: serde_json::Value,
    overrides: serde_json::Value,
) -> serde_json::Value {
    let mut merged = defaults;
    if let (Some(merged), Some(overrides)) = (merged.as_object_mut(), overrides.as_object()) {
        for (key, value) in overrides {
            merged.insert(key.clone(), value.clone());
        }
    }
    merged
}

pub(crate) fn object_or_empty(value: Option<&serde_json::Value>) -> serde_json::Value {
    value
        .and_then(|value| value.as_object())
        .map(|object| serde_json::Value::Object(object.clone()))
        .unwrap_or_else(|| serde_json::json!({}))
}

pub(crate) fn decode_basic_html_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

pub(crate) fn xml_text(xml: &str, tag_name: &str) -> String {
    let open = format!("<{tag_name}>");
    let close = format!("</{tag_name}>");
    let Some(start) = xml.find(&open).map(|index| index + open.len()) else {
        return String::new();
    };
    let Some(end) = xml[start..].find(&close).map(|index| start + index) else {
        return String::new();
    };

    decode_basic_html_entities(
        xml[start..end]
            .trim()
            .trim_start_matches("<![CDATA[")
            .trim_end_matches("]]>")
            .trim(),
    )
}

pub(crate) fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

pub(crate) trait EmptyStringExt {
    fn if_empty(self, fallback: String) -> String;
}

impl EmptyStringExt for String {
    fn if_empty(self, fallback: String) -> String {
        if self.is_empty() {
            fallback
        } else {
            self
        }
    }
}

pub(crate) trait EmptyVecExt<T> {
    fn if_empty(self, fallback: Vec<T>) -> Vec<T>;
}

impl<T> EmptyVecExt<T> for Vec<T> {
    fn if_empty(self, fallback: Vec<T>) -> Vec<T> {
        if self.is_empty() {
            fallback
        } else {
            self
        }
    }
}
