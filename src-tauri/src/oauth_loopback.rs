//! Shared loopback receiver for browser-handoff sign-in flows.
//!
//! Steam OpenID and Discord OAuth both send the user to the system browser and
//! need the answer back in the app. Neither can talk to the app directly, so a
//! throwaway `127.0.0.1` listener stands in for a redirect target: it accepts
//! exactly one matching callback, hands the caller the parsed URL plus the
//! still-open socket, and the caller writes the page the user ends up looking
//! at.

use crate::util::escape_html;

/// The page rendered in the user's browser once the callback lands.
/// Matches the Figma card: #0A0A0A backdrop, 520×348 #101010 card, 58px
/// #1D2827 pill with `user-round-check` vector in #2FA06A.
pub(crate) fn callback_page_html(success: bool, message: &str) -> String {
    let raw = message.trim();
    let mut title = if raw.is_empty() {
        if success {
            "Conectado com sucesso!"
        } else {
            "Não conectado."
        }
    } else {
        raw
    };
    // Normaliza mensagens padrão de sucesso para o copy do Figma
    if success {
        match title {
            "Autorizado. Volte ao GhostBox."
            | "Signed in. Back to GhostBox."
            | "Verified. Back to GhostBox."
            | "Connected." => title = "Conectado com sucesso!",
            _ => {}
        }
    }
    let title_escaped = escape_html(title);
    let (badge_class, icon_color, badge_style) = if success {
        ("success", "#2FA06A", "background: #1D2827;")
    } else {
        ("error", "#A3A3A3", "background: #262626; box-shadow: none;")
    };
    // lucide `user-round-check` — 3 nodes, check path gets draw animation
    let icon_svg = format!(
        r##"<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="{icon_color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 21a8 8 0 0 1 13.292-6"/><circle cx="10" cy="8" r="5"/><path class="gb-check" d="m16 19 2 2 4-4"/></svg>"##
    );

    format!(
        r##"<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>GhostBox — {title_escaped}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600&display=swap" rel="stylesheet"><style>
:root{{color-scheme:dark}}
*{{box-sizing:border-box}}
html,body{{height:100%}}
body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#0A0A0A;color:#FAFAFA;font-family:"Inter",Inter,"Segoe UI",system-ui,-apple-system,sans-serif;font-weight:500;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;user-select:none}}
.wrap{{width:100%;min-height:100vh;display:grid;place-items:center;padding:24px}}
.card{{width:520px;max-width:100%;height:348px;max-height:90vh;background:#101010;border-radius:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 24px 36px;text-align:center;will-change:transform,opacity;animation:gb-cardIn 360ms cubic-bezier(0.4,0,0.2,1) both}}
.badge{{width:58px;height:58px;border-radius:50px;display:grid;place-items:center;flex-shrink:0;{badge_style} will-change:transform,opacity}}
.badge.success{{animation:gb-badgePop 420ms cubic-bezier(0.175,0.885,0.32,1.275) 80ms both}}
.badge.error{{animation:gb-badgePop 320ms cubic-bezier(0.4,0,0.2,1) 80ms both}}
.badge.success .gb-check{{stroke-dasharray:22;stroke-dashoffset:22;animation:gb-checkDraw 340ms cubic-bezier(0.4,0,0.2,1) 340ms forwards}}
.title{{margin:18px 0 0;color:#FAFAFA;font-size:24px;font-weight:500;line-height:1.25;word-wrap:break-word;overflow-wrap:break-word;max-width:100%;animation:gb-textIn 300ms cubic-bezier(0.4,0,0.2,1) 140ms both}}
.subtitle{{margin:10px 0 0;font-size:16px;line-height:1.4;animation:gb-textIn 300ms cubic-bezier(0.4,0,0.2,1) 200ms both}}
.subtitle .muted{{color:#A3A3A3;font-weight:500}}
.subtitle .brand{{color:#FAFAFA;font-weight:600}}
.subtitle .sep{{color:#FAFAFA}}
@keyframes gb-cardIn{{from{{opacity:0;transform:translateY(16px) scale(0.96)}} to{{opacity:1;transform:translateY(0) scale(1)}}}}
@keyframes gb-badgePop{{0%{{opacity:0;transform:scale(0.72)}} 60%{{opacity:1;transform:scale(1.06)}} 100%{{opacity:1;transform:scale(1)}}}}
@keyframes gb-textIn{{from{{opacity:0;transform:translateY(8px)}} to{{opacity:1;transform:translateY(0)}}}}
@keyframes gb-checkDraw{{to{{stroke-dashoffset:0}}}}
@media(max-width:560px){{.card{{height:auto;min-height:320px;padding:36px 20px}}}}
@media(prefers-reduced-motion:reduce){{.card,.badge,.title,.subtitle{{animation:none !important;opacity:1 !important;transform:none !important}}.gb-check{{stroke-dasharray:none !important;stroke-dashoffset:0 !important;animation:none !important}}}}
</style></head><body><div class="wrap"><div class="card" role="status" aria-live="polite"><div class="badge {badge_class}" aria-hidden="true">{icon_svg}</div><h1 class="title">{title_escaped}</h1><p class="subtitle"><span class="muted">Retorne ao</span><span class="sep"> </span><span class="brand">GhostBox</span></p></div></div></body></html>"##
    )
}

/// Complete only after the session has been validated and saved. A 204 cannot
/// execute JavaScript, so return an empty document that requests tab closure.
/// External-browser tabs may not be script-closable; focus the launcher either way.
pub(crate) fn complete_browser_login(
    app: &tauri::AppHandle,
    stream: &mut std::net::TcpStream,
) {
    write_http_response(
        stream,
        "200 OK",
        r#"<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>GhostBox</title><meta name="referrer" content="no-referrer"><style>:root{color-scheme:dark}body{margin:0;background:#0a0a0a}</style></head><body><script>window.close();</script></body></html>"#,
    );
    crate::window_lifecycle::show_main_window(app);
}

pub(crate) fn write_http_response(stream: &mut std::net::TcpStream, status: &str, body: &str) {
    use std::io::Write;

    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store, max-age=0\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.as_bytes().len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

/// Waits for a callback on `listener` whose path is `expected_path`. When
/// `expected_state` is set, the request must also carry that exact `state`
/// query parameter — anything else gets a 404 and the wait continues, so a
/// stray probe on the port cannot end the flow.
pub(crate) fn accept_loopback_callback(
    listener: std::net::TcpListener,
    port: u16,
    expected_path: &str,
    expected_state: Option<&str>,
    timeout: std::time::Duration,
    timeout_message: &str,
) -> Result<(reqwest::Url, std::net::TcpStream), String> {
    use std::io::Read;

    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let deadline = std::time::Instant::now() + timeout;

    while std::time::Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buffer = [0_u8; 8192];
                let length = stream
                    .read(&mut buffer)
                    .map_err(|error| error.to_string())?;
                let request = String::from_utf8_lossy(&buffer[..length]);
                let path = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or("/");
                let callback_url = reqwest::Url::parse(&format!("http://127.0.0.1:{port}{path}"))
                    .map_err(|error| error.to_string())?;

                let state_matches = match expected_state {
                    None => true,
                    Some(expected) => {
                        callback_url
                            .query_pairs()
                            .find(|(key, _)| key == "state")
                            .map(|(_, value)| value.to_string())
                            .as_deref()
                            == Some(expected)
                    }
                };

                if callback_url.path() != expected_path || !state_matches {
                    write_http_response(
                        &mut stream,
                        "404 Not Found",
                        &callback_page_html(false, "Not found."),
                    );
                    continue;
                }

                return Ok((callback_url, stream));
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(error) => return Err(error.to_string()),
        }
    }

    Err(timeout_message.to_string())
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};

    fn get(port: u16, path: &str) -> std::net::TcpStream {
        let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .write_all(format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").as_bytes())
            .unwrap();
        stream
    }

    /// The sign-in hand-off is only safe because of this check. Without it any
    /// local process could reach the listener first and hand the app a ticket
    /// for an account the user does not own — the app would sign in as
    /// somebody else and start uploading saves there. A callback carrying the
    /// wrong state has to be turned away *without* ending the wait, so the
    /// real one still lands.
    #[test]
    fn ignores_a_callback_that_does_not_carry_the_expected_state() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let waiter = std::thread::spawn(move || {
            super::accept_loopback_callback(
                listener,
                port,
                "/oauth/callback",
                Some("expected_nonce"),
                std::time::Duration::from_secs(5),
                "timed out",
            )
        });

        // An injected ticket with a guessed (wrong) state.
        let mut injected = get(
            port,
            "/oauth/callback?ticket=attacker_ticket&state=wrong_nonce",
        );
        let mut response = String::new();
        let _ = injected.read_to_string(&mut response);
        assert!(response.starts_with("HTTP/1.1 404"), "got: {response}");

        // The genuine callback, arriving after, still gets through.
        let _real = get(
            port,
            "/oauth/callback?ticket=real_ticket&state=expected_nonce",
        );

        let (url, _stream) = waiter.join().unwrap().unwrap();
        let ticket = url
            .query_pairs()
            .find(|(key, _)| key == "ticket")
            .map(|(_, value)| value.to_string())
            .unwrap();
        assert_eq!(ticket, "real_ticket");
    }

    #[test]
    fn ignores_a_callback_on_the_wrong_path() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let waiter = std::thread::spawn(move || {
            super::accept_loopback_callback(
                listener,
                port,
                "/oauth/callback",
                None,
                std::time::Duration::from_millis(700),
                "timed out",
            )
        });

        let mut probe = get(port, "/");
        let mut response = String::new();
        let _ = probe.read_to_string(&mut response);
        assert!(response.starts_with("HTTP/1.1 404"), "got: {response}");

        assert_eq!(waiter.join().unwrap().unwrap_err(), "timed out");
    }
}
