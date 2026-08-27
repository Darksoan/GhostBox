//! Shared loopback receiver for browser-handoff sign-in flows.
//!
//! Steam OpenID and Discord OAuth both send the user to the system browser and
//! need the answer back in the app. Neither can talk to the app directly, so a
//! throwaway `127.0.0.1` listener stands in for a redirect target: it accepts
//! exactly one matching callback, hands the caller the parsed URL plus the
//! still-open socket, and the caller writes the page the user ends up looking
//! at.

use crate::util::escape_html;

/// The page rendered in the user's browser once the callback lands. Kept
/// deliberately plain — it is the last thing shown before they switch back to
/// the app.
pub(crate) fn callback_page_html(success: bool, message: &str) -> String {
    let text = if message.trim().is_empty() {
        if success {
            "Connected."
        } else {
            "Not connected."
        }
    } else {
        message.trim()
    };

    format!(
        "<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\" /><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" /><title>GhostBox</title><style>:root {{ color-scheme: dark; }} body {{ min-height: 100vh; margin: 0; display: grid; place-items: center; background: #0b0b0b; color: #d3d3d3; font: 500 24px \"Segoe UI\", system-ui, sans-serif; user-select: none; }} p {{ margin: 0; }}</style></head><body><p>{}</p></body></html>",
        escape_html(text)
    )
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
        let mut injected = get(port, "/oauth/callback?ticket=attacker_ticket&state=wrong_nonce");
        let mut response = String::new();
        let _ = injected.read_to_string(&mut response);
        assert!(response.starts_with("HTTP/1.1 404"), "got: {response}");

        // The genuine callback, arriving after, still gets through.
        let _real = get(port, "/oauth/callback?ticket=real_ticket&state=expected_nonce");

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
