use crate::{player, Host};
use serde::{Deserialize, Serialize};
use std::{
    net::{IpAddr, SocketAddr, ToSocketAddrs},
    path::PathBuf,
    sync::{atomic::Ordering, Mutex},
    time::{Duration, Instant},
};
use tauri::{Manager, Url};

const DESKTOP_CLIENT_PROTOCOL: u64 = 1;
const IDLE_WINDOW: Duration = Duration::from_secs(600);

pub(crate) fn local_playback_unavailable() -> bool {
    !cfg!(feature = "desktop-playback")
        || (cfg!(target_os = "windows") && crate::appimage_update::build()["clientOnly"].as_bool() == Some(true))
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    mode: Option<Mode>,
    address: Option<String>,
    #[serde(default)]
    targets: Vec<String>,
    #[serde(default)]
    local_setup_complete: bool,
}

#[derive(Clone, Copy, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Local,
    Remote,
}

pub struct Modes {
    path: PathBuf,
    choice: Mutex<Choice>,
    operation: tokio::sync::Mutex<()>,
    last_input: Mutex<Instant>,
}

impl Modes {
    pub fn load(path: PathBuf) -> Result<Self, Box<dyn std::error::Error>> {
        let choice = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Choice::default(),
            Err(error) => return Err(error.into()),
        };
        Ok(Self {
            path,
            choice: Mutex::new(choice),
            operation: tokio::sync::Mutex::new(()),
            last_input: Mutex::new(Instant::now()),
        })
    }
    fn saved(&self) -> Choice {
        self.choice.lock().expect("mode lock poisoned").clone()
    }
    fn current(&self) -> Choice {
        let mut choice = self.saved();
        if local_playback_unavailable() && choice.mode == Some(Mode::Local) {
            choice.mode = None;
        }
        choice
    }
    fn save(&self, mut choice: Choice) -> Result<Choice, String> {
        if let Some(address) = &choice.address {
            if !choice.targets.contains(address) {
                choice.targets.push(address.clone());
            }
        }
        let mut seen = std::collections::HashSet::new();
        choice
            .targets
            .retain(|address| seen.insert(address.clone()));
        let temporary = self.path.with_extension("json.tmp");
        std::fs::write(&temporary, serde_json::to_vec(&choice).map_err(error)?).map_err(error)?;
        std::fs::rename(temporary, &self.path).map_err(error)?;
        *self.choice.lock().expect("mode lock poisoned") = choice.clone();
        Ok(choice)
    }
}

fn error(value: impl std::fmt::Display) -> String {
    value.to_string()
}
pub fn bundled_origin(url: &Url) -> bool {
    url.scheme() == "tauri" && url.host_str() == Some("localhost")
        || matches!(url.scheme(), "http" | "https")
            && url.host_str() == Some("tauri.localhost")
            && url.port().is_none()
}
pub fn app_origin(config: &tauri::Config, url: &Url) -> bool {
    if cfg!(dev)
        && config
            .build
            .dev_url
            .as_ref()
            .is_some_and(|dev| dev.origin() == url.origin())
    {
        return true;
    }
    bundled_origin(url)
}
pub(crate) fn trusted(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" && app_origin(window.config(), &window.url().map_err(error)?) {
        Ok(())
    } else {
        Err("Playback device controls belong to the bundled app.".into())
    }
}

pub(crate) fn remote_selected(app: &tauri::AppHandle) -> bool {
    app.state::<Modes>().current().mode == Some(Mode::Remote)
}

pub(crate) fn window_opened(app: &tauri::AppHandle) {
    if remote_selected(app) {
        *app.state::<Modes>().last_input.lock().expect("input lock poisoned") = Instant::now();
    }
}

fn remote_busy(visible: bool, focused: bool, since: Duration) -> bool {
    visible && focused && since < IDLE_WINDOW
}

fn recent_remote_input(selected: bool, since: Duration) -> bool {
    selected && since < IDLE_WINDOW
}

pub(crate) fn recent_input(app: &tauri::AppHandle) -> bool {
    let modes = app.state::<Modes>();
    let selected = modes.current().mode == Some(Mode::Remote);
    let since = modes.last_input.lock().expect("input lock poisoned").elapsed();
    recent_remote_input(selected, since)
}

pub(crate) fn idle_blocked(app: &tauri::AppHandle) -> Result<bool, String> {
    if !remote_selected(app) { return Ok(false); }
    let Some(main) = app.get_webview_window("main") else { return Ok(false); };
    let visible = main.is_visible().map_err(error)? && !main.is_minimized().map_err(error)?;
    if !visible { return Ok(false); }
    let focused = main.is_focused().map_err(error)?;
    let since = app.state::<Modes>().last_input.lock().expect("input lock poisoned").elapsed();
    Ok(remote_busy(visible, focused, since))
}

pub(crate) const IDLE_WAIT: &str = "Waiting for this app to be idle before automatic installation.";

pub(crate) async fn resume_idle_quiesce(app: &tauri::AppHandle, nonce: &str) -> Result<(), String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let host = app.state::<crate::Host>();
    *host.update_checkpoint.lock().expect("checkpoint lock poisoned") = Some((nonce.to_owned(), sender));
    host.report_message(serde_json::json!({"type":"appimageResume","nonce":nonce}));
    let (closed, result) = tokio::time::timeout(Duration::from_secs(10), receiver).await
        .map_err(|_| "Resuming local maintenance timed out.")?.map_err(error)?;
    if closed { return Err("Local maintenance remained closed after deferring the update.".into()); }
    result
}

pub(crate) async fn defer_after_checkpoint(app: &tauri::AppHandle, when_idle: bool, nonce: &str) -> Result<bool, String> {
    // The input timestamp precedes its HTTP relay, even if focus has since moved away.
    if !when_idle || !recent_input(app) { return Ok(false); }
    resume_idle_quiesce(app, nonce).await?;
    Ok(true)
}

#[tauri::command]
pub async fn local_update_activity(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    trusted(&window)?;
    if !remote_selected(&app) { return Ok(()); }
    *app.state::<Modes>().last_input.lock().expect("input lock poisoned") = Instant::now();
    let connection = app.state::<crate::Host>().connection.borrow().clone();
    if let Some(Ok(info)) = connection {
        connection_client().timeout(Duration::from_secs(2)).build().map_err(error)?
            .post(format!("{}/api/activity", info.origin))
            .bearer_auth(info.token)
            .json(&serde_json::json!({"activity": true}))
            .send().await.map_err(error)?.error_for_status().map_err(error)?;
    }
    Ok(())
}

pub(crate) fn local_authority(window: &tauri::WebviewWindow) -> Result<(), String> {
    trusted(window)?;
    if window.app_handle().state::<Modes>().current().mode == Some(Mode::Local) {
        Ok(())
    } else {
        Err("Local playback commands require This computer.".into())
    }
}

#[tauri::command]
pub fn desktop_interface_size(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    size: Option<f64>,
) -> Result<f64, String> {
    let modes = app.state::<Modes>();
    trusted(&window)?;
    let path = modes.path.with_file_name("desktop-interface-size");
    if let Some(size) = size {
        if ![1.0, 1.15, 1.3].contains(&size) {
            return Err("Choose a supported interface size.".into());
        }
        let temporary = path.with_extension("tmp");
        std::fs::write(&temporary, size.to_string()).map_err(error)?;
        std::fs::rename(temporary, &path).map_err(error)?;
        return Ok(size);
    }
    Ok(std::fs::read_to_string(path)
        .ok()
        .and_then(|value| value.parse().ok())
        .filter(|size| [1.0, 1.15, 1.3].contains(size))
        .unwrap_or(1.0))
}

fn target(input: &str) -> Result<Url, String> {
    let input = input.trim();
    let url = Url::parse(&if input.contains("://") {
        input.to_owned()
    } else {
        format!("http://{input}")
    })
    .map_err(|_| "Enter the LAN address shown on the playback computer.")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || bundled_origin(&url)
    {
        return Err("Use a Couch LAN address without a path, password or query.".into());
    }
    Ok(url)
}
fn lan(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ip.is_private() || ip.is_loopback() || ip.is_link_local(),
        IpAddr::V6(ip) => ip.to_ipv4_mapped().map_or(
            ip.is_loopback() || ip.is_unique_local() || ip.is_unicast_link_local(),
            |ip| lan(IpAddr::V4(ip)),
        ),
    }
}
fn addresses(url: &Url) -> Result<Vec<SocketAddr>, String> {
    let host = url
        .host_str()
        .ok_or("Enter a Couch LAN address.")?
        .trim_matches(['[', ']']);
    let addresses: Vec<_> = (
        host,
        url.port_or_known_default()
            .ok_or("Use an HTTP or HTTPS address.")?,
    )
        .to_socket_addrs()
        .map_err(|_| {
            "Cannot find that address. Check the current address on the playback computer."
        })?
        .collect();
    if addresses.is_empty() || addresses.iter().any(|address| !lan(address.ip())) {
        return Err("App remote control is available only for LAN addresses. Custom domains must resolve to your LAN.".into());
    }
    Ok(addresses)
}

fn connection_client() -> reqwest::ClientBuilder {
    // Remote mode can make its first request before the updater initializes TLS.
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
}

async fn preflight(url: &Url) -> Result<(), String> {
    let resolve_url = url.clone();
    let addresses = tokio::time::timeout(
        Duration::from_secs(4),
        tauri::async_runtime::spawn_blocking(move || addresses(&resolve_url)),
    )
    .await
    .map_err(|_| "Finding the playback computer timed out.")?
    .map_err(error)??;
    let client = connection_client()
        .timeout(Duration::from_secs(5))
        .resolve_to_addrs(url.host_str().ok_or("Missing host")?, &addresses)
        .build()
        .map_err(error)?;
    let mut response = client
        .get(url.join("/api/connection").map_err(error)?)
        .send()
        .await
        .map_err(|_| {
            "Cannot reach that Couch. Check its current address and Allow remote control setting."
        })?;
    if !response.status().is_success() {
        return Err(
            "That Couch is unavailable or redirected the request. Use its current LAN address."
                .into(),
        );
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(error)? {
        if body.len() + chunk.len() > 64 * 1024 {
            return Err("That address did not return a supported Couch connection.".into());
        }
        body.extend_from_slice(&chunk);
    }
    let value: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|_| "That address did not return a Couch connection.")?;
    if value["desktopClientProtocol"].as_u64() != Some(DESKTOP_CLIENT_PROTOCOL) {
        return Err("This Couch uses an incompatible desktop client protocol. Update this app or the playback computer, then retry or choose another address.".into());
    }
    if value["remoteControlEnabled"] == false {
        return Err("Remote control is off. Enable Allow remote control on the playback computer, then retry.".into());
    }
    Ok(())
}

pub(crate) fn interruption(details: &serde_json::Value) -> Result<Option<&'static str>, String> {
    let status = details["player"]
        .as_str()
        .ok_or("Cannot check local playback. Retry before switching.")?;
    let active = !matches!(status, "idle" | "stopped" | "ended" | "error" | "unavailable");
    let sharing = details["remoteControlEnabled"]
        .as_bool()
        .ok_or("Cannot check local remote control. Retry before switching.")?;
    Ok(match (active, sharing) {
        (true, true) => Some("playback,sharing"),
        (true, false) => Some("playback"),
        (false, true) => Some("sharing"),
        (false, false) => None,
    })
}

pub(crate) async fn quit_interruption(
    app: &tauri::AppHandle,
) -> Result<Option<&'static str>, String> {
    let host = app.state::<Host>();
    if !host.local_running.load(Ordering::Relaxed) {
        return Ok(None);
    }
    let connection = host
        .connection
        .borrow()
        .clone()
        .ok_or("The local host is still starting.")??;
    let details: serde_json::Value = connection_client()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(error)?
        .get(format!("{}/api/connection", connection.origin))
        .send()
        .await
        .map_err(error)?
        .json()
        .await
        .map_err(error)?;
    interruption(&details)
}

async fn stop_local(app: &tauri::AppHandle, confirm: bool) -> Result<(), String> {
    let host = app.state::<Host>();
    if host
        .update_busy
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err(
            "Wait for the local update or restart to finish before changing playback device."
                .into(),
        );
    }
    struct Release<'a>(&'a std::sync::atomic::AtomicBool);
    impl Drop for Release<'_> {
        fn drop(&mut self) {
            self.0.store(false, Ordering::SeqCst);
        }
    }
    let _release = Release(&host.update_busy);
    update_allows_mode_change(&crate::local_update_status(app, None, "mode-check"))?;
    if host.workers.lock().expect("worker lock poisoned").is_some()
        && host.child.lock().expect("sidecar lock poisoned").is_none()
    {
        return Ok(());
    }
    if !confirm && host.local_running.load(Ordering::Relaxed) {
        let connection = host
            .connection
            .borrow()
            .clone()
            .ok_or("Wait for this computer to finish starting.")??;
        let response = connection_client()
            .timeout(Duration::from_secs(3))
            .build()
            .map_err(error)?
            .get(format!("{}/api/connection", connection.origin))
            .send()
            .await
            .map_err(|_| {
                "Cannot check local playback. Retry, or confirm stopping this computer."
            })?;
        let details: serde_json::Value = response.json().await.map_err(error)?;
        if let Some(reason) = interruption(&details)? {
            return Err(format!("confirmation-required:{reason}"));
        }
    }
    host.local_running.store(false, Ordering::Relaxed);
    host.bluetooth.close();
    let mut exited = host.child_exited.subscribe();
    if let Some(child) = host.child.lock().expect("sidecar lock poisoned").as_mut() {
        child.write(b"{\"type\":\"shutdown\"}\n").map_err(error)?;
    }
    if host.child.lock().expect("sidecar lock poisoned").is_some() {
        tokio::time::timeout(Duration::from_secs(10), exited.wait_for(|done| *done)).await
            .map_err(|_| "This computer has not finished saving. Retry after it stops; the remote has not opened.")?.map_err(error)?;
    }
    if host.workers.lock().expect("worker lock poisoned").is_none() {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        host.player
            .send(player::Request::Stop(sender))
            .map_err(error)?;
        tokio::time::timeout(Duration::from_secs(5), receiver)
            .await
            .map_err(|_| "Native playback has not stopped. Restart Couch before changing device.")?
            .map_err(error)??;
    }
    host.connection.send_replace(None);
    Ok(())
}

fn update_allows_mode_change(status: &serde_json::Value) -> Result<(), String> {
    if status["ok"] != true {
        return Err(format!(
            "Cannot check this computer's update before changing playback device: {}",
            status["error"].as_str().unwrap_or("Unknown update status.")
        ));
    }
    if status["transaction"]["phase"] == "trial" {
        return Err("Finish this computer's update checks before changing playback device.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn playback_device(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Choice, String> {
    trusted(&window)?;
    Ok(app.state::<Modes>().current())
}

#[tauri::command]
pub async fn select_playback_device(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    mode: Mode,
    address: Option<String>,
    confirm_interrupt: bool,
) -> Result<Choice, String> {
    trusted(&window)?;
    if mode == Mode::Local && local_playback_unavailable() {
        return Err("Local playback is unavailable in this Client-only build. Connect to another Couch.".into());
    }
    let modes = app.state::<Modes>();
    let _guard = modes.operation.lock().await;
    let mut choice = modes.current();
    if mode == Mode::Remote {
        let address = target(
            address
                .as_deref()
                .ok_or("Enter another Couch's LAN address.")?,
        )?
        .origin()
        .ascii_serialization();
        stop_local(&app, confirm_interrupt).await?;
        choice.mode = Some(mode);
        choice.address = Some(address);
        // Remember the deliberate choice even when the target is unavailable. Never fall back to local.
        modes.save(choice.clone())?;
        *modes.last_input.lock().expect("input lock poisoned") = Instant::now();
    } else {
        stop_local(&app, true).await?;
        crate::start_local(&app)?;
        choice.mode = Some(mode);
        modes.save(choice.clone())?;
    }
    Ok(choice)
}

#[tauri::command]
pub async fn retry_playback_device(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<(), String> {
    trusted(&window)?;
    let modes = app.state::<Modes>();
    let _guard = modes.operation.lock().await;
    let choice = modes.saved();
    match choice.mode {
        Some(Mode::Local) => crate::start_local(&app),
        Some(Mode::Remote) => {
            crate::start_coordinator(&app, false)?;
            preflight(&target(choice.address.as_deref().ok_or("Choose another Couch's address.")?)?).await
        }
        None => Ok(()),
    }
}

#[tauri::command]
pub async fn complete_local_setup(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Choice, String> {
    trusted(&window)?;
    let modes = app.state::<Modes>();
    let _guard = modes.operation.lock().await;
    let mut choice = modes.current();
    if choice.mode != Some(Mode::Local) {
        return Err("Choose This computer first.".into());
    }
    choice.local_setup_complete = true;
    modes.save(choice)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_install_waits_for_recent_input_in_a_visible_focused_window() {
        let recent = Duration::from_secs(599);
        assert!(remote_busy(true, true, recent));
        assert!(!remote_busy(false, true, recent));
        assert!(!remote_busy(true, false, recent));
        assert!(!remote_busy(true, true, Duration::from_secs(600)));
        // Input between the early updater check and the stopped-writer reply changes the final decision.
        assert!(!remote_busy(true, true, Duration::from_secs(601)));
        assert!(remote_busy(true, true, Duration::ZERO));
    }

    #[test]
    fn final_checkpoint_keeps_input_after_focus_moves_away() {
        let quiet = Duration::from_secs(601);
        assert!(!remote_busy(true, true, quiet));
        assert!(!recent_remote_input(true, quiet));
        // The native command records input before its HTTP relay completes, then the window loses focus.
        let fresh = Duration::ZERO;
        assert!(!remote_busy(true, false, fresh));
        assert!(recent_remote_input(true, fresh));
        assert!(!recent_remote_input(true, Duration::from_secs(600)));
        assert!(!recent_remote_input(false, fresh));
    }

    #[test]
    fn mode_change_waits_for_trial_or_unreadable_update_status() {
        assert!(update_allows_mode_change(&serde_json::json!({"ok":true,"transaction":{"phase":"trial"}})).is_err());
        assert!(update_allows_mode_change(&serde_json::json!({"error":"journal unreadable"})).is_err());
        assert!(update_allows_mode_change(&serde_json::json!({"ok":true,"transaction":{"phase":"succeeded"}})).is_ok());
    }

    #[test]
    fn main_navigation_accepts_only_packaged_or_exact_development_origin() {
        let mut config = tauri::Config::default();
        config.build.dev_url = Some(Url::parse("http://localhost:1420").unwrap());
        assert!(app_origin(
            &config,
            &Url::parse("tauri://localhost/settings").unwrap()
        ));
        assert_eq!(
            app_origin(
                &config,
                &Url::parse("http://localhost:1420/settings").unwrap()
            ),
            cfg!(dev)
        );
        for url in [
            "http://localhost:1421",
            "https://localhost:1420",
            "http://localhost.evil:1420",
            "http://192.168.1.10:4100",
        ] {
            assert!(!app_origin(&config, &Url::parse(url).unwrap()), "{url}");
        }
    }

    #[test]
    fn remote_addresses_are_root_origins_without_credentials() {
        assert_eq!(
            target("192.168.1.10:4100")
                .unwrap()
                .origin()
                .ascii_serialization(),
            "http://192.168.1.10:4100"
        );
        assert!(target("http://couch.example:4100").is_ok());
        for input in [
            "file:///tmp/a",
            "tauri://localhost",
            "http://tauri.localhost",
            "http://name:secret@192.168.1.1",
            "http://192.168.1.1/path",
            "http://192.168.1.1/?token=x",
            "http://192.168.1.1/#pair=123",
        ] {
            assert!(target(input).is_err(), "{input}");
        }
    }

    #[test]
    fn only_private_loopback_and_link_local_addresses_are_accepted() {
        for ip in [
            "192.168.1.1",
            "10.0.0.1",
            "172.16.1.1",
            "127.0.0.1",
            "169.254.1.1",
            "::1",
            "fd00::1",
            "fe80::1",
            "::ffff:192.168.1.1",
        ] {
            assert!(lan(ip.parse().unwrap()), "{ip}");
        }
        for ip in [
            "8.8.8.8",
            "172.15.1.1",
            "0.0.0.0",
            "224.0.0.1",
            "2001:4860:4860::8888",
            "::",
            "::ffff:8.8.8.8",
        ] {
            assert!(!lan(ip.parse().unwrap()), "{ip}");
        }
    }
    #[test]
    fn interruption_uses_the_public_player_phase_and_sharing_setting() {
        assert_eq!(
            interruption(&serde_json::json!({"player":"playing","remoteControlEnabled":false}))
                .unwrap(),
            Some("playback")
        );
        assert_eq!(
            interruption(&serde_json::json!({"player":"paused","remoteControlEnabled":true}))
                .unwrap(),
            Some("playback,sharing")
        );
        assert_eq!(
            interruption(&serde_json::json!({"player":"idle","remoteControlEnabled":true}))
                .unwrap(),
            Some("sharing")
        );
        assert_eq!(
            interruption(&serde_json::json!({"player":"idle","remoteControlEnabled":false}))
                .unwrap(),
            None
        );
        assert_eq!(
            interruption(&serde_json::json!({"player":"unavailable","remoteControlEnabled":false}))
                .unwrap(),
            None
        );
        assert_eq!(
            interruption(&serde_json::json!({"player":"unavailable","remoteControlEnabled":true}))
                .unwrap(),
            Some("sharing")
        );
        assert!(interruption(&serde_json::json!({})).is_err());
    }

    #[tokio::test]
    async fn entry_check_rejects_unsupported_ui_redirects_and_disabled_sharing() {
        const ISOLATED: &str = "COUCH_TEST_MODE_TLS_ISOLATED";
        if std::env::var_os(ISOLATED).is_none() {
            // Updater tests install a process-wide provider and can hide missing mode initialization.
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "operating_mode::tests::entry_check_rejects_unsupported_ui_redirects_and_disabled_sharing", "--nocapture"])
                .env(ISOLATED, "1")
                .output().unwrap();
            assert!(
                output.status.success(),
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }
        assert!(rustls::crypto::CryptoProvider::get_default().is_none());
        async fn response(status: &str, body: &str) -> Result<(), String> {
            use std::io::{Read, Write};
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let url = Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
            let response = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nLocation: http://8.8.8.8/\r\nConnection: close\r\n\r\n{body}", body.len());
            let server = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut request = [0; 4096];
                let size = stream.read(&mut request).unwrap();
                assert!(!String::from_utf8_lossy(&request[..size])
                    .to_ascii_lowercase()
                    .contains("authorization:"));
                stream.write_all(response.as_bytes()).unwrap();
            });
            let result = preflight(&url).await;
            server.join().unwrap();
            result
        }
        assert!(response(
            "200 OK",
            r#"{"desktopClientProtocol":1,"remoteControlEnabled":true}"#
        )
        .await
        .is_ok());
        assert!(response("200 OK", r#"{"desktopClientProtocol":2}"#)
            .await
            .unwrap_err()
            .contains("incompatible desktop client protocol"));
        assert!(response("200 OK", r#"{}"#)
            .await
            .unwrap_err()
            .contains("incompatible desktop client protocol"));
        assert!(response(
            "200 OK",
            r#"{"desktopClientProtocol":1,"remoteControlEnabled":false}"#
        )
        .await
        .unwrap_err()
        .contains("Remote control is off"));
        assert!(response("302 Found", "")
            .await
            .unwrap_err()
            .contains("redirected"));
    }

    #[test]
    fn remembered_targets_are_deduplicated_and_old_choices_default_to_an_empty_list() {
        let old: Choice =
            serde_json::from_str(r#"{"mode":"remote","address":"http://192.168.1.1:4100"}"#)
                .unwrap();
        assert!(old.targets.is_empty());
        let path =
            std::env::temp_dir().join(format!("couch-targets-{}.json", uuid::Uuid::new_v4()));
        let modes = Modes::load(path.clone()).unwrap();
        let mut choice = modes.save(old).unwrap();
        choice.address = Some("http://192.168.1.2:4100".into());
        choice.targets.push("http://192.168.1.1:4100".into());
        modes.save(choice).unwrap();
        assert_eq!(
            Modes::load(path.clone()).unwrap().current().targets,
            vec!["http://192.168.1.1:4100", "http://192.168.1.2:4100"]
        );
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn choice_survives_restart_without_merging_installation_state() {
        let path = std::env::temp_dir().join(format!("couch-mode-{}.json", uuid::Uuid::new_v4()));
        let modes = Modes::load(path.clone()).unwrap();
        assert!(modes.current().mode.is_none());
        modes
            .save(Choice {
                mode: Some(Mode::Remote),
                address: Some("http://192.168.1.10:4100".into()),
                targets: vec!["http://192.168.1.10:4100".into()],
                local_setup_complete: true,
            })
            .unwrap();
        let remembered = Modes::load(path.clone()).unwrap().current();
        assert!(remembered.mode == Some(Mode::Remote));
        assert!(remembered.local_setup_complete);
        assert_eq!(remembered.targets, vec!["http://192.168.1.10:4100"]);
        assert_eq!(
            remembered.address.as_deref(),
            Some("http://192.168.1.10:4100")
        );
        std::fs::remove_file(path).unwrap();
    }

    #[cfg(not(feature = "desktop-playback"))]
    #[test]
    fn client_only_ignores_remembered_local_mode_without_erasing_it() {
        let path = std::env::temp_dir().join(format!("couch-mode-{}.json", uuid::Uuid::new_v4()));
        let saved = r#"{"mode":"local","localSetupComplete":true}"#;
        std::fs::write(&path, saved).unwrap();
        assert!(Modes::load(path.clone()).unwrap().current().mode.is_none());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), saved);
        std::fs::remove_file(path).unwrap();
    }
}
