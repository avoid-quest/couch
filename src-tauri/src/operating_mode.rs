use crate::{player, Host};
use serde::{Deserialize, Serialize};
use std::{
    net::{IpAddr, SocketAddr, ToSocketAddrs},
    path::PathBuf,
    sync::{atomic::Ordering, Mutex},
    time::Duration,
};
use tauri::{Manager, Url};

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
        })
    }
    fn current(&self) -> Choice {
        self.choice.lock().expect("mode lock poisoned").clone()
    }
    fn forget(&self, address: &str) -> Result<Choice, String> {
        let mut choice = self.current();
        choice.targets.retain(|target| target != address);
        if choice.address.as_deref() == Some(address) {
            choice.address = None;
            if choice.mode == Some(Mode::Remote) {
                choice.mode = None;
            }
        }
        self.save(choice)
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
    .map_err(|_| "Enter the LAN address shown on that Couch.")?;
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
            "Can't find that address. Check the current address on that Couch."
        })?
        .collect();
    if addresses.is_empty() || addresses.iter().any(|address| !lan(address.ip())) {
        return Err("App remote control is available only for LAN addresses. Custom domains must resolve to your LAN.".into());
    }
    Ok(addresses)
}

fn connection_client() -> reqwest::ClientBuilder {
    // Whichever of remote mode and now-playing artwork runs first installs the TLS provider.
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
}

async fn check_lan_address(url: &Url) -> Result<(), String> {
    // WebKit owns HTTP reachability; native DNS only enforces the LAN address policy.
    let resolve_url = url.clone();
    tokio::time::timeout(
        Duration::from_secs(4),
        tauri::async_runtime::spawn_blocking(move || addresses(&resolve_url)),
    )
    .await
    .map_err(|_| "Finding that Couch timed out.")?
    .map_err(error)??;
    Ok(())
}

pub(crate) fn interruption(details: &serde_json::Value) -> Result<Option<&'static str>, String> {
    let status = details["player"]
        .as_str()
        .ok_or("Can't check playback on this computer. Try again before switching.")?;
    let active = !matches!(status, "idle" | "stopped" | "ended" | "error" | "unavailable");
    let sharing = details["remoteControlEnabled"]
        .as_bool()
        .ok_or("Can't check remote control on this computer. Try again before switching.")?;
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
        .ok_or("Couch is still starting on this computer.")??;
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
                "Can't check playback on this computer. Try again, or confirm stopping this computer."
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
            .map_err(|_| "This computer has not finished saving. Try again after it stops; the remote has not opened.")?.map_err(error)?;
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
        modes.save(choice.clone())?;
    } else {
        stop_local(&app, true).await?;
        crate::start_local(&app)?;
        choice.mode = Some(mode);
        modes.save(choice.clone())?;
    }
    Ok(choice)
}

#[tauri::command]
pub async fn forget_playback_device(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    address: String,
) -> Result<Choice, String> {
    trusted(&window)?;
    let modes = app.state::<Modes>();
    let _guard = modes.operation.lock().await;
    modes.forget(&address)
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
            check_lan_address(&target(choice.address.as_deref().ok_or("Choose another Couch's address.")?)?).await
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
