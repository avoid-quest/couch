use crate::{player, Host};
use serde::{Deserialize, Serialize};
use std::{
    net::{IpAddr, SocketAddr, ToSocketAddrs},
    path::PathBuf,
    sync::{atomic::Ordering, Mutex},
    time::Duration,
};
use tauri::{Manager, Url, WebviewUrl, WebviewWindowBuilder};

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
    remote_closed: tokio::sync::watch::Sender<bool>,
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
            remote_closed: tokio::sync::watch::channel(true).0,
        })
    }
    pub fn remote_destroyed(&self) {
        self.remote_closed.send_replace(true);
    }
    fn current(&self) -> Choice {
        self.choice.lock().expect("mode lock poisoned").clone()
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
fn trusted(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" && bundled_origin(&window.url().map_err(error)?) {
        Ok(())
    } else {
        Err("Playback device controls belong to the bundled app.".into())
    }
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

async fn preflight(url: &Url) -> Result<(), String> {
    let resolve_url = url.clone();
    let addresses = tokio::time::timeout(
        Duration::from_secs(4),
        tauri::async_runtime::spawn_blocking(move || addresses(&resolve_url)),
    )
    .await
    .map_err(|_| "Finding the playback computer timed out.")?
    .map_err(error)??;
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
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
    if value["desktopRemoteUi"].as_u64() != Some(1) {
        return Err("This Couch does not support app remote mode. Update the playback computer, or open its address in a browser.".into());
    }
    if value["remoteControlEnabled"] == false {
        return Err("Remote control is off. Enable Allow remote control on the playback computer, then retry.".into());
    }
    Ok(())
}

fn interruption(details: &serde_json::Value) -> Result<Option<&'static str>, String> {
    let status = details["player"]
        .as_str()
        .ok_or("Cannot check local playback. Retry before switching.")?;
    let active = !matches!(status, "idle" | "stopped" | "ended" | "error");
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

async fn stop_local(app: &tauri::AppHandle, confirm: bool) -> Result<(), String> {
    let host = app.state::<Host>();
    if host.workers.lock().expect("worker lock poisoned").is_some() {
        return Ok(());
    }
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
    let update = crate::appimage_update::status(app, None, "mode-check");
    if update["transaction"]["phase"] == "trial" {
        return Err("Finish this computer's update checks before changing playback device.".into());
    }
    if !confirm && host.local_running.load(Ordering::Relaxed) {
        let connection = host
            .connection
            .borrow()
            .clone()
            .ok_or("Wait for this computer to finish starting.")??;
        let response = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
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
    let (sender, receiver) = tokio::sync::oneshot::channel();
    host.player
        .send(player::Request::Stop(sender))
        .map_err(error)?;
    tokio::time::timeout(Duration::from_secs(5), receiver)
        .await
        .map_err(|_| "Native playback has not stopped. Restart Couch before changing device.")?
        .map_err(error)??;
    host.connection.send_replace(None);
    Ok(())
}

async fn close_remote(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("remote") {
        let modes = app.state::<Modes>();
        modes.remote_closed.send_replace(false);
        let mut closed = modes.remote_closed.subscribe();
        window.close().map_err(error)?;
        // App-level Destroyed is delivered after Tauri removes the old window label.
        tokio::time::timeout(Duration::from_secs(3), closed.wait_for(|done| *done))
            .await
            .map_err(|_| "The remote window has not closed yet. Retry changing playback device.")?
            .map_err(error)?;
    }
    Ok(())
}

async fn open_remote(app: &tauri::AppHandle, address: &str) -> Result<(), String> {
    let url = target(address)?;
    if crate::appimage_update::status(app, None, "mode-check")["transaction"]["phase"] == "trial" {
        return Err("This computer still needs its local update checks. Choose Use this computer to finish them before returning to remote mode.".into());
    }
    preflight(&url).await?;
    if let Some(remote) = app.get_webview_window("remote") {
        if remote.url().map_err(error)?.origin() == url.origin() {
            remote.navigate(url).map_err(error)?;
            return remote.set_focus().map_err(error);
        }
    }
    close_remote(app).await?;
    let main = app
        .get_webview_window("main")
        .ok_or("Playback device controls are unavailable.")?;
    let position = main.outer_position().map_err(error)?;
    let size = main.inner_size().map_err(error)?;
    let scale = main.scale_factor().map_err(error)?;
    let origin = url.origin();
    let handle = app.clone();
    let device = tauri::menu::MenuItem::with_id(
        app,
        "playback-device",
        "Playback device",
        true,
        Some("CmdOrCtrl+Shift+P"),
    )
    .map_err(error)?;
    let menu = tauri::menu::Menu::with_items(app, &[&device]).map_err(error)?;
    // The bundled window's 88 px recovery bar stays exposed even if target JavaScript hangs.
    let remote = WebviewWindowBuilder::new(app, "remote", WebviewUrl::External(url))
        .title("Couch remote")
        .menu(menu)
        .on_menu_event(|window, event| {
            if event.id().as_ref() == "playback-device" {
                let app = window.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    let modes = app.state::<Modes>();
                    let _guard = modes.operation.lock().await;
                    let _ = close_remote(&app).await;
                    if let Some(main) = app.get_webview_window("main") {
                        let _ = main.set_focus();
                    }
                });
            }
        })
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .fullscreen(false)
        .position(position.x as f64 / scale, position.y as f64 / scale + 88.0)
        .inner_size(
            size.width as f64 / scale,
            (size.height as f64 / scale - 88.0).max(200.0),
        )
        .always_on_top(true)
        .on_navigation(move |url| url.origin() == origin)
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .on_download(|_, _| false)
        .build()
        .map_err(error)?;
    remote.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
            if let Some(main) = handle.get_webview_window("main") {
                let _ = main.set_focus();
            }
        }
    });
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
        close_remote(&app).await?;
        modes.save(choice.clone())?;
    } else {
        close_remote(&app).await?;
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
    let choice = modes.current();
    match choice.mode {
        Some(Mode::Local) => crate::start_local(&app),
        Some(Mode::Remote) => {
            open_remote(
                &app,
                choice
                    .address
                    .as_deref()
                    .ok_or("Choose another Couch's address.")?,
            )
            .await
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

#[tauri::command]
pub async fn show_playback_device(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<(), String> {
    trusted(&window)?;
    let modes = app.state::<Modes>();
    let _guard = modes.operation.lock().await;
    close_remote(&app).await?;
    window.set_focus().map_err(error)
}

#[cfg(test)]
mod tests {
    use super::*;
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
        assert!(interruption(&serde_json::json!({})).is_err());
    }

    #[tokio::test]
    async fn entry_check_rejects_unsupported_ui_redirects_and_disabled_sharing() {
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
            r#"{"desktopRemoteUi":1,"remoteControlEnabled":true}"#
        )
        .await
        .is_ok());
        assert!(response("200 OK", r#"{"desktopRemoteUi":2}"#)
            .await
            .unwrap_err()
            .contains("does not support"));
        assert!(response("200 OK", r#"{}"#)
            .await
            .unwrap_err()
            .contains("does not support"));
        assert!(response(
            "200 OK",
            r#"{"desktopRemoteUi":1,"remoteControlEnabled":false}"#
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
}
