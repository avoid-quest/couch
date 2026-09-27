mod appimage_update;
mod bluetooth;
mod deb_update;
mod desktop_update;
mod desktop_lifecycle;
mod diagnostics;
mod diagnostics_export;
mod display;
mod file_export;
mod metadata_export;
mod native_cursor;
mod native_receiver;
mod native_window_title;
mod now_playing;
mod operating_mode;
mod player;
mod protocol;
mod sound;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Mutex,
};
use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};
use tokio::sync::watch;

use protocol::{ConnectionInfo, PlayerState, SidecarMessage, VideoRect};

struct Host {
    #[cfg(windows)]
    player_worker: Mutex<Option<std::thread::JoinHandle<()>>>,
    data_dir: std::path::PathBuf,
    local_running: AtomicBool,
    switching_library: AtomicBool,
    renderer_owner: Mutex<RendererOwner>,
    audio_output: Mutex<Option<AudioOutputLease>>,
    player_state: Mutex<PlayerState>,
    workers: Mutex<
        Option<(
            mpsc::Receiver<player::Request>,
            mpsc::Receiver<display::Request>,
        )>,
    >,
    bluetooth: bluetooth::Bluetooth,
    connection: watch::Sender<Option<Result<ConnectionInfo, String>>>,
    child: Mutex<Option<CommandChild>>,
    player: mpsc::Sender<player::Request>,
    layouts: Mutex<player::LayoutQueue>,
    display: mpsc::Sender<display::Request>,
    updates: tokio::sync::mpsc::Sender<appimage_update::Request>,
    update_busy: AtomicBool,
    deb_updates: tokio::sync::mpsc::Sender<deb_update::Request>,
    deb_busy: AtomicBool,
    update_checkpoint: Mutex<
        Option<(
            String,
            tokio::sync::oneshot::Sender<(bool, Result<(), String>)>,
        )>,
    >,
    shutting_down: AtomicBool,
    window_closed: AtomicBool,
    quit_pending: AtomicBool,
    quit_confirmed: AtomicBool,
    child_exited: watch::Sender<bool>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum RendererOwner {
    LocalCore,
    Remote(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum AudioAuthority {
    External,
    LocalCore,
    Remote(String),
}

#[derive(Clone, Debug)]
struct AudioOutputLease {
    generation: String,
    authority: AudioAuthority,
    playback_owner: Option<String>,
}

impl AudioOutputLease {
    fn permits_load(&self, playback_owner: Option<&str>, video_only: bool) -> bool {
        video_only && playback_owner.is_some() && playback_owner == self.playback_owner.as_deref()
    }
}

impl AudioAuthority {
    fn permits(&self, owner: &RendererOwner) -> bool {
        match (self, owner) {
            (Self::LocalCore, RendererOwner::LocalCore) => true,
            (Self::Remote(expected), RendererOwner::Remote(current)) => expected == current,
            _ => false,
        }
    }
}

#[cfg(test)]
mod audio_authority_tests {
    use super::*;

    #[test]
    fn managed_audio_allows_only_its_cores_decoder_and_external_audio_allows_none() {
        let local = RendererOwner::LocalCore;
        let one = RendererOwner::Remote("one".into());
        let two = RendererOwner::Remote("two".into());
        assert!(AudioAuthority::LocalCore.permits(&local));
        assert!(!AudioAuthority::LocalCore.permits(&one));
        assert!(AudioAuthority::Remote("one".into()).permits(&one));
        assert!(!AudioAuthority::Remote("one".into()).permits(&two));
        assert!(!AudioAuthority::Remote("one".into()).permits(&local));
        assert!(!AudioAuthority::External.permits(&local));
        assert!(!AudioAuthority::External.permits(&one));
    }
}

impl Host {
    fn report(&self, app: &tauri::AppHandle, state: &PlayerState) {
        *self.player_state.lock().expect("player state lock poisoned") = state.clone();
        match self.renderer_owner.lock().expect("renderer owner lock poisoned").clone() {
            RendererOwner::LocalCore => {
                if state.status == "idle" && self.audio_output.lock().expect("audio output lock poisoned").as_ref().is_some_and(|lease| !lease.authority.permits(&RendererOwner::LocalCore)) {
                    self.report_unavailable("This computer is playing shared audio.");
                } else {
                    self.report_message(serde_json::json!({ "type": "player", "state": state }));
                }
            }
            RendererOwner::Remote(generation) => native_receiver::report(app, &generation, state),
        }
        if state.status == "idle"
            && *self.renderer_owner.lock().expect("renderer owner lock poisoned") == RendererOwner::LocalCore
            && self.audio_output.lock().expect("audio output lock poisoned").is_none()
        {
            let _ = app.emit_to("main", "native-output-available", ());
        }
    }

    fn report_message(&self, message: serde_json::Value) {
        if self.shutting_down.load(Ordering::Relaxed) {
            return;
        }
        let mut child = self.child.lock().expect("sidecar lock poisoned");
        if let Some(child) = child.as_mut() {
            let mut line = serde_json::to_vec(&message).expect("serializable player state");
            line.push(b'\n');
            if let Err(error) = child.write(&line) {
                log::error!("Cannot report playback: {error}");
            }
        }
    }

    fn idle(&self) -> bool {
        let state = self.player_state.lock().expect("player state lock poisoned");
        state.playback_id.is_none() && state.status == "idle"
    }

    fn report_unavailable(&self, reason: &str) {
        self.report_message(serde_json::json!({ "type": "player", "state": PlayerState { status: "unavailable", error: Some(reason.to_owned()), ..PlayerState::default() } }));
    }

    fn claim_remote(&self, generation: &str) -> Result<bool, String> {
        let mut owner = self.renderer_owner.lock().expect("renderer owner lock poisoned");
        if self.switching_library.load(Ordering::SeqCst) { return Err("Wait for this computer to finish switching libraries.".into()); }
        if self.audio_output.lock().expect("audio output lock poisoned").as_ref().is_some_and(|lease| !lease.authority.permits(&RendererOwner::Remote(generation.to_owned()))) {
            return Err("This computer is playing audio from another library.".into());
        }
        match &*owner {
            RendererOwner::Remote(current) if current == generation => return Ok(false),
            RendererOwner::LocalCore if self.idle() => *owner = RendererOwner::Remote(generation.to_owned()),
            RendererOwner::LocalCore => return Err("This computer is already playing from its own library.".into()),
            _ => return Err("This computer's player is already in use.".into()),
        }
        drop(owner);
        self.report_unavailable("This computer is playing another library.");
        Ok(true)
    }

    fn claim_audio(&self, generation: &str, authority: AudioAuthority, playback_owner: Option<&str>, retiring_playback_id: Option<&str>) -> Result<(), String> {
        if authority != AudioAuthority::External && playback_owner.is_none_or(str::is_empty) {
            return Err("The audio reservation has no playback owner.".into());
        }
        let owner = self.renderer_owner.lock().expect("renderer owner lock poisoned");
        if self.switching_library.load(Ordering::SeqCst) { return Err("Wait for this computer to finish switching libraries.".into()); }
        let state = self.player_state.lock().expect("player state lock poisoned");
        let idle = state.playback_id.is_none() && state.status == "idle";
        let same_authority = authority.permits(&owner);
        let retiring = same_authority && matches!(state.status, "playing" | "paused") && retiring_playback_id.is_some_and(|id| state.playback_id.as_deref() == Some(id));
        let idle_for_authority = idle && match (&*owner, &authority) {
            (RendererOwner::LocalCore, _) => true,
            (RendererOwner::Remote(current), AudioAuthority::Remote(requested)) => current == requested,
            _ => false,
        };
        if !idle_for_authority && !retiring {
            return Err("This computer's player is already in use.".into());
        }
        let mut output = self.audio_output.lock().expect("audio output lock poisoned");
        if output.is_some() { return Err("This computer's audio is already in use.".into()); }
        *output = Some(AudioOutputLease { generation: generation.to_owned(), authority: authority.clone(), playback_owner: playback_owner.map(str::to_owned) });
        drop(output);
        drop(state);
        if idle_for_authority && *owner == RendererOwner::LocalCore && authority != AudioAuthority::LocalCore {
            self.report_unavailable("This computer is playing audio from another library.");
        }
        Ok(())
    }

    fn release_renderer(&self, app: &tauri::AppHandle, expected: &RendererOwner) {
        let mut owner = self.renderer_owner.lock().expect("renderer owner lock poisoned");
        if &*owner != expected { return; }
        *owner = RendererOwner::LocalCore;
        drop(owner);
        let state = PlayerState { volume: self.player_state.lock().expect("player state lock poisoned").volume, ..PlayerState::default() };
        *self.player_state.lock().expect("player state lock poisoned") = state.clone();
        if self.audio_output.lock().expect("audio output lock poisoned").as_ref().is_some_and(|lease| !lease.authority.permits(&RendererOwner::LocalCore)) {
            self.report_unavailable("This computer is playing shared audio.");
        } else {
            self.report_message(serde_json::json!({ "type": "player", "state": state }));
        }
        if self.audio_output.lock().expect("audio output lock poisoned").is_none() {
            let _ = app.emit_to("main", "native-output-available", ());
        }
    }

    fn release_audio(&self, app: &tauri::AppHandle, generation: &str) {
        let owner = self.renderer_owner.lock().expect("renderer owner lock poisoned");
        let mut output = self.audio_output.lock().expect("audio output lock poisoned");
        if output.as_ref().is_none_or(|lease| lease.generation != generation) { return; }
        *output = None;
        drop(output);
        let available = *owner == RendererOwner::LocalCore && self.idle();
        if available {
            let state = PlayerState { volume: self.player_state.lock().expect("player state lock poisoned").volume, ..PlayerState::default() };
            self.report_message(serde_json::json!({ "type": "player", "state": state }));
        }
        drop(owner);
        if available { let _ = app.emit_to("main", "native-output-available", ()); }
    }
}

fn prepare_data_dir(path: &std::path::Path) -> std::io::Result<()> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        // Migrated data can belong to the administrator and grant us access by ACL.
        if std::fs::metadata(path)?.uid() == unsafe { libc::geteuid() } {
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn connection_info(
    window: tauri::WebviewWindow,
    _app: tauri::AppHandle,
    host: tauri::State<'_, Host>,
) -> Result<ConnectionInfo, String> {
    operating_mode::trusted(&window)?;
    let mut connection = host.connection.subscribe();
    tokio::time::timeout(Duration::from_secs(15), async move {
        loop {
            if let Some(result) = connection.borrow().clone() {
                // The local player uses Vite's fixed proxy; maintenance has its own ephemeral port.
                #[cfg(dev)]
                let result = result.map(|info| frontend_connection(info, host.local_running.load(Ordering::Relaxed), _app.config().build.dev_url.as_ref()));
                return result;
            }
            connection
                .changed()
                .await
                .map_err(|_| "Media server stopped".to_string())?;
        }
    })
    .await
    .map_err(|_| "Media server did not become ready within 15 seconds".to_string())?
}

#[cfg(dev)]
fn frontend_connection(mut info: ConnectionInfo, local_running: bool, dev_url: Option<&tauri::Url>) -> ConnectionInfo {
    if local_running {
        if let Some(url) = dev_url {
            info.origin = url.origin().ascii_serialization();
        }
    }
    info
}

#[cfg(all(test, dev))]
mod connection_tests {
    use super::*;

    #[test]
    fn local_dev_uses_vite_while_maintenance_keeps_its_ephemeral_origin() {
        let info = ConnectionInfo { origin: "http://127.0.0.1:52345".into(), token: "local-secret".into(), pairing_code: String::new(), urls: Vec::new() };
        let dev_url = tauri::Url::parse("http://localhost:1420").unwrap();
        assert_eq!(frontend_connection(info.clone(), true, Some(&dev_url)).origin, "http://localhost:1420");
        let maintenance = frontend_connection(info, false, Some(&dev_url));
        assert_eq!(maintenance.origin, "http://127.0.0.1:52345");
        assert_eq!(maintenance.token, "local-secret");
    }
}

#[tauri::command]
fn set_video_rect(window: tauri::WebviewWindow, rect: VideoRect, host: tauri::State<'_, Host>) -> Result<(), String> {
    operating_mode::trusted(&window)?;
    if operating_mode::local_authority(&window).is_err() && !native_receiver::active(window.app_handle()) { return Err("No local receiver owns this video surface.".into()); }
    if ![rect.x, rect.y, rect.width, rect.height]
        .iter()
        .all(|value| value.is_finite())
        || rect.width < 0.0
        || rect.height < 0.0
    {
        return Err("Invalid video rectangle".into());
    }
    if !host
        .layouts
        .lock()
        .expect("layout queue poisoned")
        .push(rect)
    {
        return Ok(());
    }
    host.player.send(player::Request::Layout).map_err(|_| {
        host.layouts.lock().expect("layout queue poisoned").cancel();
        "Native player stopped".into()
    })
}

#[derive(Serialize)]
struct PickedMedia {
    source: String,
    title: String,
}

#[tauri::command]
async fn choose_media(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Option<PickedMedia>, String> {
    operating_mode::local_authority(&window)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Open media on this player")
        .pick_file(move |path| {
            let _ = sender.send(path);
        });
    let Some(file) = receiver
        .await
        .map_err(|_| "File picker closed unexpectedly".to_string())?
    else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|error| error.to_string())?;
    let title = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let source = tauri::Url::from_file_path(path)
        .map_err(|_| "Cannot convert the selected path".to_string())?;
    Ok(Some(PickedMedia {
        source: source.into(),
        title,
    }))
}

#[tauri::command]
async fn choose_folder(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Option<String>, String> {
    operating_mode::local_authority(&window)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Add a media folder on this player")
        .pick_folder(move |path| {
            let _ = sender.send(path);
        });
    let Some(folder) = receiver
        .await
        .map_err(|_| "Folder picker closed unexpectedly".to_string())?
    else {
        return Ok(None);
    };
    let path = folder.into_path().map_err(|error| error.to_string())?;
    let path = std::fs::canonicalize(path).map_err(|error| error.to_string())?;
    if !path.is_dir() {
        return Err("The selected path is not a folder".into());
    }
    path.into_os_string()
        .into_string()
        .map(Some)
        .map_err(|_| "The selected folder name is not valid Unicode".into())
}

fn start_local(app: &tauri::AppHandle) -> Result<(), String> {
    start_coordinator(app, true)
}

pub(crate) fn local_update_status(
    app: &tauri::AppHandle,
    saved_id: Option<&str>,
    request_id: &str,
) -> serde_json::Value {
    if desktop_update::running(app) {
        desktop_update::status(app, saved_id, request_id)
    } else {
        appimage_update::status(app, saved_id, request_id)
    }
}

fn start_player(app: &tauri::AppHandle) -> Result<(), String> {
    let host = app.state::<Host>();
    if let Some((player_receiver, display_receiver)) =
        host.workers.lock().expect("worker lock poisoned").take()
    {
        let handle = app.clone();
        let display_path = host.data_dir.join("display-output");
        std::thread::Builder::new()
            .name("display".into())
            .spawn(move || display::run(handle, display_path, display_receiver))
            .map_err(|error| error.to_string())?;
        let handle = app.clone();
        let worker = std::thread::Builder::new()
            .name("native-player".into())
            .spawn(move || player::run(handle, player_receiver))
            .map_err(|error| error.to_string())?;
        #[cfg(windows)]
        host.player_worker.lock().expect("player worker lock poisoned").replace(worker);
        #[cfg(not(windows))]
        drop(worker);
    }
    Ok(())
}

fn start_coordinator(app: &tauri::AppHandle, playback: bool) -> Result<(), String> {
    let host = app.state::<Host>();
    if host.child.lock().expect("sidecar lock poisoned").is_some() {
        return Ok(());
    }
    if playback { start_player(app)?; }
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    #[cfg(dev)]
    let sidecar = app
        .shell()
        .command(
            std::env::var_os("COUCH_DEV_BUN")
                .ok_or("Start development with bun run desktop so Couch can locate Bun.")?,
        )
        .args(["run", "src/main.ts"])
        .current_dir(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap(),
        );
    #[cfg(not(dev))]
    let sidecar = app
        .shell()
        .sidecar("couch-server")
        .map_err(|error| error.to_string())?;
    let mut sidecar = sidecar
        .env("COUCH_NATIVE", "1")
        .env("COUCH_MAINTENANCE_ONLY", if playback { "0" } else { "1" })
        .env(
            "COUCH_BUNDLED_TOOLS",
            app.path()
                .resource_dir()
                .map_err(|error| error.to_string())?
                .join("tools"),
        )
        .env(
            "COUCH_APPIMAGE",
            if appimage_update::tv_running(app) {
                "1"
            } else {
                "0"
            },
        )
        .env(
            "COUCH_PACKAGE_UPDATE",
            if deb_update::running(app) { "1" } else { "0" },
        )
        .env(
            "COUCH_DESKTOP_UPDATE",
            if desktop_update::running(app) { "1" } else { "0" },
        )
        .env("COUCH_HOST_TOKEN", token)
        .env("COUCH_DATA_DIR", &host.data_dir)
        .env(
            "COUCH_PORT",
            std::env::var("COUCH_PORT").unwrap_or_else(|_| "4100".into()),
        );
    #[cfg(dev)]
    if let Some(url) = &app.config().build.dev_url {
        sidecar = sidecar.env("COUCH_DEV_ORIGIN", url.origin().ascii_serialization());
    }
    if let Some(urls) = std::env::var_os("COUCH_ADVERTISE_URLS") {
        sidecar = sidecar.env("COUCH_ADVERTISE_URLS", urls);
    }
    if let Some(proxy) = std::env::var_os("COUCH_PREVIEW_PROXY_LAN") {
        sidecar = sidecar.env("COUCH_PREVIEW_PROXY_LAN", proxy);
    }
    for (variable, name) in [
        ("COUCH_YT_DLP", "yt-dlp"),
        ("COUCH_DENO", "deno"),
        ("COUCH_FFPROBE", "ffprobe"),
        #[cfg(target_os = "macos")]
        ("COUCH_MPV", "mpv"),
    ] {
        let filename = format!("{name}{}", if cfg!(windows) { ".exe" } else { "" });
        let bundled = app
            .path()
            .resource_dir()
            .map_err(|error| error.to_string())?
            .join("tools")
            .join(&filename);
        if !cfg!(debug_assertions) {
            if !bundled.is_file() && playback {
                return Err(format!(
                    "This Couch bundle is missing {name}. Reinstall a verified complete package."
                ));
            }
            if bundled.is_file() {
                sidecar = sidecar.env(variable, bundled);
            }
            continue;
        }
        let path = if bundled.is_file() {
            bundled
        } else {
            host.data_dir.join("tools").join(filename)
        };
        if std::env::var_os(variable).is_none() && path.is_file() {
            sidecar = sidecar.env(variable, path);
        }
    }
    let (mut events, child) = sidecar.spawn().map_err(|error| error.to_string())?;

    host.connection.send_replace(None);
    host.child_exited.send_replace(false);
    *host.child.lock().expect("sidecar lock poisoned") = Some(child);
    host.local_running.store(playback, Ordering::Relaxed);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            let host = handle.state::<Host>();
            match event {
                CommandEvent::Stdout(line) => {
                    match serde_json::from_slice::<SidecarMessage>(&line) {
                        Ok(SidecarMessage::Addresses { urls }) => {
                            host.connection.send_modify(|value| {
                                if let Some(Ok(connection)) = value {
                                    connection.urls = urls.clone();
                                }
                            });
                            let _ = handle.emit_to("main", "connection-addresses", urls);
                        }
                        Ok(SidecarMessage::Ready { connection }) => {
                            host.connection.send_replace(Some(Ok(connection)));
                            let _ = host.player.send(player::Request::Observe);
                        }
                        Ok(SidecarMessage::Observe) => {
                            let _ = host.player.send(player::Request::Observe);
                        }
                        Ok(SidecarMessage::Playback { command }) => {
                            let _ = host.player.send(player::Request::Command(command));
                        }
                        Ok(SidecarMessage::Readiness { nonce }) => {
                            if nonce.len() == 32
                                && nonce.bytes().all(|byte| byte.is_ascii_hexdigit())
                            {
                                if !host.local_running.load(Ordering::Relaxed) {
                                    let build: serde_json::Value = serde_json::from_str(
                                        option_env!("COUCH_BUILD_INFO").unwrap_or("{}"),
                                    )
                                    .unwrap_or_default();
                                    host.report_message(serde_json::json!({"type":"readiness","nonce":nonce,"ok":true,"build":{"version":build["version"],"revision":build["revision"],"dataFormat":build["dataFormat"]}}));
                                    continue;
                                }
                                let _ = host.player.send(player::Request::Readiness {
                                    nonce,
                                    deadline: std::time::Instant::now()
                                        + std::time::Duration::from_secs(2),
                                });
                            }
                        }
                        Ok(SidecarMessage::AppimageQuiesced {
                            nonce,
                            closed,
                            error,
                        }) => {
                            let mut pending = host
                                .update_checkpoint
                                .lock()
                                .expect("checkpoint lock poisoned");
                            if pending.as_ref().is_some_and(|(id, _)| id == &nonce) {
                                if let Some((_, sender)) = pending.take() {
                                    let _ = sender.send((closed, error.map_or(Ok(()), Err)));
                                }
                            }
                        }
                        Ok(SidecarMessage::AppimageResumed { nonce, error }) => {
                            let mut pending = host.update_checkpoint.lock().expect("checkpoint lock poisoned");
                            if pending.as_ref().is_some_and(|(id, _)| id == &nonce) {
                                if let Some((_, sender)) = pending.take() {
                                    let _ = sender.send((false, error.map_or(Ok(()), Err)));
                                }
                            }
                        }
                        Ok(SidecarMessage::AppimageUpdate { request_id, action }) => {
                            if uuid::Uuid::parse_str(&request_id).is_ok() {
                                if let crate::appimage_update::Action::Status {
                                    request_id: ref saved_id,
                                } = action
                                {
                                    host.report_message(local_update_status(
                                        &handle,
                                        saved_id.as_deref(),
                                        &request_id,
                                    ));
                                } else if host
                                    .update_busy
                                    .swap(true, std::sync::atomic::Ordering::SeqCst)
                                {
                                    host.report_message(serde_json::json!({"type":"appimageUpdate","requestId":request_id,"error":"An update or restart operation is already running."}));
                                } else if host
                                    .updates
                                    .try_send(appimage_update::Request {
                                        id: request_id.clone(),
                                        action,
                                    })
                                    .is_err()
                                {
                                    host.update_busy
                                        .store(false, std::sync::atomic::Ordering::SeqCst);
                                    host.report_message(serde_json::json!({"type":"appimageUpdate","requestId":request_id,"error":"An update operation is already running."}));
                                }
                            }
                        }
                        Ok(SidecarMessage::DebUpdate { request_id, action }) => {
                            if uuid::Uuid::parse_str(&request_id).is_ok() {
                                if host
                                    .deb_busy
                                    .swap(true, std::sync::atomic::Ordering::SeqCst)
                                {
                                    host.report_message(serde_json::json!({"type":"debUpdate","requestId":request_id,"error":"A package update operation is already running."}));
                                } else if host
                                    .deb_updates
                                    .try_send(deb_update::Request {
                                        id: request_id.clone(),
                                        action,
                                    })
                                    .is_err()
                                {
                                    host.deb_busy
                                        .store(false, std::sync::atomic::Ordering::SeqCst);
                                    host.report_message(serde_json::json!({"type":"debUpdate","requestId":request_id,"error":"A package update operation is already running."}));
                                }
                            }
                        }
                        Ok(SidecarMessage::Bluetooth { request_id, action }) => {
                            if uuid::Uuid::parse_str(&request_id).is_ok() {
                                let handle = handle.clone();
                                tauri::async_runtime::spawn(async move {
                                    let host = handle.state::<Host>();
                                    let result = host.bluetooth.request(action).await;
                                    host.report_message(match result {
                Ok(state) => serde_json::json!({"type":"bluetooth","requestId":request_id,"state":state}),
                Err(error) => serde_json::json!({"type":"bluetooth","requestId":request_id,"error":error}),
                    });
                                });
                            }
                        }
                        Ok(SidecarMessage::Sound { request_id, action }) => {
                            if uuid::Uuid::parse_str(&request_id).is_ok() {
                                let handle = handle.clone();
                                tauri::async_runtime::spawn(async move {
                                    let result = tauri::async_runtime::spawn_blocking(move || sound::request(action)).await;
                                    let host = handle.state::<Host>();
                                    host.report_message(match result {
                                        Ok(Ok(state)) => serde_json::json!({"type":"sound","requestId":request_id,"state":state}),
                                        Ok(Err(error)) => serde_json::json!({"type":"sound","requestId":request_id,"error":error}),
                                        Err(error) => serde_json::json!({"type":"sound","requestId":request_id,"error":error.to_string()}),
                                    });
                                });
                            }
                        }
                        Ok(SidecarMessage::Display { request_id, action }) => {
                            if uuid::Uuid::parse_str(&request_id).is_ok() {
                                let _ = host.display.send(display::Request {
                                    id: request_id,
                                    action,
                                });
                            }
                        }
                        Ok(SidecarMessage::Diagnostics { request_id }) => {
                            if uuid::Uuid::parse_str(&request_id).is_ok() {
                                let _ = host.player.send(player::Request::Diagnostics(request_id));
                            }
                        }
                        Err(error) => log::error!("Invalid media server protocol: {error}"),
                    }
                }
                CommandEvent::Stderr(line) => {
                    log::info!("{}", String::from_utf8_lossy(&line))
                }
                CommandEvent::Error(error) => {
                    log::error!("Media server error: {error}");
                    host.connection.send_replace(Some(Err(error)));
                }
                CommandEvent::Terminated(payload) => {
                    host.connection.send_replace(Some(Err(format!(
                        "Media server exited: {:?}",
                        payload.code
                    ))));
                    if host.local_running.load(Ordering::Relaxed) {
                        let _ = host.player.send(player::Request::Command(protocol::PlaybackCommand::Stop));
                    }
                    host.child.lock().expect("sidecar lock poisoned").take();
                    host.child_exited.send_replace(true);
                    if host.local_running.load(Ordering::Relaxed)
                        && !host.shutting_down.load(Ordering::Relaxed)
                    {
                        handle.exit(1);
                    }
                }
                _ => {}
            }
        }
    });
    Ok(())
}

fn tv_presentation() -> bool {
    cfg!(target_os = "linux") && std::env::var("COUCH_TV_PRESENTATION").as_deref() == Ok("1")
}

async fn stop_player_before_quit(
    player: &mpsc::Sender<player::Request>,
    workers: &Mutex<Option<(mpsc::Receiver<player::Request>, mpsc::Receiver<display::Request>)>>,
) {
    if workers.lock().expect("worker lock poisoned").is_some() {
        return;
    }
    let (reply, done) = tokio::sync::oneshot::channel();
    if player.send(player::Request::Stop(reply)).is_ok() {
        if !matches!(tokio::time::timeout(Duration::from_secs(5), done).await, Ok(Ok(Ok(())))) {
            log::warn!("Native playback did not stop before Quit");
        }
    }
}

pub fn run() {
    if std::env::args().any(|arg| arg == "--version") {
        println!(
            "{}",
            option_env!("COUCH_BUILD_INFO").unwrap_or("{\"packaged\":false}")
        );
        return;
    }
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            desktop_lifecycle::show(app);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        );
    #[cfg(any(target_os = "linux", target_os = "macos", windows))]
    let builder = builder.plugin(tauri_plugin_video::init());

    builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            connection_info,
            native_receiver::native_receiver_begin,
            native_receiver::native_receiver_request,
            native_receiver::native_receiver_renew,
            native_receiver::native_receiver_command,
            native_receiver::native_receiver_report,
            native_receiver::native_receiver_end,
            native_receiver::native_audio_begin,
            native_receiver::native_audio_renew,
            native_receiver::native_audio_end,
            native_receiver::native_video_state,
            native_receiver::native_video_command,
            set_video_rect,
            choose_media,
            choose_folder,
            metadata_export::save_metadata_export,
            diagnostics_export::save_diagnostics_export,
            operating_mode::playback_device,
            operating_mode::select_playback_device,
            operating_mode::forget_playback_device,
            operating_mode::retry_playback_device,
            operating_mode::complete_local_setup,
            operating_mode::local_update_activity,
            operating_mode::desktop_interface_size,
            now_playing::set_now_playing,
            native_window_title::set_native_window_title,
            native_cursor::set_native_cursor_visible
        ])
        .setup(|app| {
            let data_dir = match std::env::var_os("COUCH_DATA_DIR") {
                Some(path) => std::path::PathBuf::from(path),
                None => app.path().app_data_dir()?,
            };
            prepare_data_dir(&data_dir)?;
            let (update_sender, update_receiver) = tokio::sync::mpsc::channel(1);
            let (deb_sender, deb_receiver) = tokio::sync::mpsc::channel(1);
            let (display_sender, display_receiver) = mpsc::channel();
            let (player_sender, player_receiver) = mpsc::channel();
            let (connection, _) = watch::channel(None);
            let (child_exited, _) = watch::channel(false);
            app.manage(native_receiver::Receiver::default());
            app.manage(Host {
                #[cfg(windows)]
                player_worker: Mutex::new(None),
                data_dir: data_dir.clone(),
                local_running: AtomicBool::new(false),
                switching_library: AtomicBool::new(false),
                renderer_owner: Mutex::new(RendererOwner::LocalCore),
                audio_output: Mutex::new(None),
                player_state: Mutex::new(PlayerState::default()),
                workers: Mutex::new(Some((player_receiver, display_receiver))),
                bluetooth: bluetooth::Bluetooth::default(),
                connection,
                child: Mutex::new(None),
                player: player_sender,
                layouts: Mutex::new(player::LayoutQueue::default()),
                display: display_sender,
                updates: update_sender,
                update_busy: AtomicBool::new(false),
                deb_updates: deb_sender,
                deb_busy: AtomicBool::new(false),
                update_checkpoint: Mutex::new(None),
                shutting_down: AtomicBool::new(false),
                window_closed: AtomicBool::new(false),
                quit_pending: AtomicBool::new(false),
                quit_confirmed: AtomicBool::new(false),
                child_exited,
            });
            native_receiver::watch(app.handle().clone());
            if desktop_update::running(app.handle()) {
                tauri::async_runtime::spawn(desktop_update::run(
                    app.handle().clone(),
                    desktop_update::directory(&data_dir),
                    update_receiver,
                ));
            } else {
                tauri::async_runtime::spawn(appimage_update::run(
                    app.handle().clone(),
                    data_dir.join("updates/appimage"),
                    update_receiver,
                ));
            }
            tauri::async_runtime::spawn(deb_update::run(
                app.handle().clone(),
                data_dir.join("updates/deb"),
                deb_receiver,
            ));
            app.manage(operating_mode::Modes::load(
                data_dir.join("operating-mode.json"),
            )?);
            let mut config = app.config().app.windows[0].clone();
            #[cfg(any(target_os = "linux", windows))]
            {
                // Keep the native window opaque beneath the transparent video WebView.
                config.transparent = false;
            }
            let tv_presentation = tv_presentation();
            config.fullscreen = tv_presentation;
            config.decorations = !tv_presentation;
            if !tv_presentation {
                use tauri_plugin_window_state::StateFlags;
                app.handle().plugin(
                    tauri_plugin_window_state::Builder::default()
                        .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                        .with_filename(data_dir.join("window-state.json").to_string_lossy())
                        .build(),
                )?;
                #[cfg(any(target_os = "macos", target_os = "windows"))]
                desktop_lifecycle::install_desktop_menu(app.handle())?;
                #[cfg(target_os = "linux")]
                desktop_lifecycle::install_linux_menu(app.handle())?;
            }
            let handle = app.handle().clone();
            let main = tauri::WebviewWindowBuilder::from_config(app, &config)?
                .initialization_script(format!(
                    "Object.defineProperty(window, '__COUCH_NATIVE_HOST__', {{ value: true }}); Object.defineProperty(window, '__COUCH_TV_PRESENTATION__', {{ value: {} }}); {}",
                    tv_presentation,
                    if cfg!(target_os = "macos") { "document.documentElement.classList.add('native-macos');" } else { "" }
                ))
                .on_page_load(|window, payload| {
                    if payload.event() == tauri::webview::PageLoadEvent::Started {
                        now_playing::clear(window.app_handle());
                    }
                })
                .on_navigation(move |url| operating_mode::app_origin(handle.config(), url))
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build()?;
            now_playing::install(app.handle(), &main);
            if !tv_presentation {
                desktop_lifecycle::recover_window(&main)?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Cannot start Couch")
        .run(|app, event| {
            if let tauri::RunEvent::WindowEvent { label, event, .. } = &event {
                if label == "main" && !tv_presentation() {
                    desktop_lifecycle::on_main_window_event(app, event);
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        desktop_lifecycle::close(app, api);
                    }
                }
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = &event {
                desktop_lifecycle::show(app);
            }
            if let tauri::RunEvent::ExitRequested { ref api, code, .. } = event {
                let host = app.state::<Host>();
                log::info!("Exit requested with code {code:?}");
                if code.is_none()
                    && !tv_presentation()
                    && !host.quit_confirmed.load(Ordering::SeqCst)
                {
                    api.prevent_exit();
                    desktop_lifecycle::request_quit(app);
                    return;
                }
                if host.shutting_down.swap(true, Ordering::Relaxed) {
                    return;
                }
                api.prevent_exit();
                host.bluetooth.close();
                let mut exited = host.child_exited.subscribe();
                if let Some(child) = host.child.lock().expect("sidecar lock poisoned").as_mut() {
                    if let Err(error) = child.write(b"{\"type\":\"shutdown\"}\n") {
                        log::warn!("Cannot request media server shutdown: {error}");
                    }
                }
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if handle.state::<Host>().child.lock().expect("sidecar lock poisoned").is_some() {
                        let _ = tokio::time::timeout(Duration::from_secs(2), exited.wait_for(|done| *done)).await;
                    }
                    let host = handle.state::<Host>();
                    if let Some(child) = host.child.lock().expect("sidecar lock poisoned").take() {
                        log::warn!("Media server did not exit within two seconds; terminating it");
                        let _ = child.kill();
                    }
                    stop_player_before_quit(&host.player, &host.workers).await;
                    #[cfg(windows)]
                    {
                        let _ = host.player.send(player::Request::Shutdown);
                        let worker = host.player_worker.lock().expect("player worker lock poisoned").take();
                        if let Some(worker) = worker {
                            let _ = tauri::async_runtime::spawn_blocking(move || worker.join()).await;
                        }
                    }
                    #[cfg(any(target_os = "macos", windows))]
                    {
                        use tauri_plugin_video::VideoExt;
                        handle.video().desktop().shutdown_native();
                    }
                    handle.exit(code.unwrap_or(0));
                });
            }
            if let tauri::RunEvent::Exit = event {
                let host = app.state::<Host>();
                let _ = host.player.send(player::Request::Shutdown);
                let child = host.child.lock().expect("sidecar lock poisoned").take();
                if let Some(child) = child {
                    let _ = child.kill();
                }
            }
        });
}

#[cfg(test)]
mod quit_tests {
    use super::*;

    #[tokio::test]
    async fn quit_skips_an_unstarted_player_and_stops_a_started_worker() {
        let (player, receiver) = mpsc::channel();
        let (_, display_receiver) = mpsc::channel();
        let workers = Mutex::new(Some((receiver, display_receiver)));
        assert!(
            tokio::time::timeout(Duration::from_millis(50), stop_player_before_quit(&player, &workers))
                .await
                .is_ok(),
            "Another Couch Quit must not wait for a player worker that never started"
        );
        assert!(matches!(
            workers.lock().unwrap().as_mut().unwrap().0.try_recv(),
            Err(mpsc::TryRecvError::Empty)
        ));

        let (player, receiver) = mpsc::channel();
        let workers = Mutex::new(None);
        let worker = std::thread::spawn(move || match receiver.recv().unwrap() {
            player::Request::Stop(reply) => {
                let _ = reply.send(Ok(()));
            }
            _ => panic!("Quit did not request Stop"),
        });
        stop_player_before_quit(&player, &workers).await;
        drop(player);
        worker.join().unwrap();
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn app_data_is_private_for_new_and_preexisting_directories() {
        let path = std::env::temp_dir().join(format!("couch-permissions-{}", uuid::Uuid::new_v4()));
        prepare_data_dir(&path).unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o700
        );
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        prepare_data_dir(&path).unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o700
        );
        std::fs::remove_dir(path).unwrap();
    }
}
