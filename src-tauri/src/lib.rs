mod bluetooth;
mod desktop_lifecycle;
mod display;
mod native_cursor;
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

use tauri::{Emitter, Manager};
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
    shutting_down: AtomicBool,
    window_closed: AtomicBool,
    quit_pending: AtomicBool,
    quit_confirmed: AtomicBool,
    child_exited: watch::Sender<bool>,
}

impl Host {
    fn report(&self, state: &PlayerState) {
        self.report_message(serde_json::json!({ "type": "player", "state": state }));
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

#[tauri::command]
fn set_video_rect(window: tauri::WebviewWindow, rect: VideoRect, host: tauri::State<'_, Host>) -> Result<(), String> {
    operating_mode::local_authority(&window)?;
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

fn start_local(app: &tauri::AppHandle) -> Result<(), String> {
    let host = app.state::<Host>();
    if host.child.lock().expect("sidecar lock poisoned").is_some() {
        return Ok(());
    }
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
    for (variable, name) in [
        ("COUCH_YT_DLP", "yt-dlp"),
        ("COUCH_DENO", "deno"),
    ] {
        let filename = format!("{name}{}", if cfg!(windows) { ".exe" } else { "" });
        let bundled = app
            .path()
            .resource_dir()
            .map_err(|error| error.to_string())?
            .join("tools")
            .join(&filename);
        if !cfg!(debug_assertions) {
            if !bundled.is_file() {
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
    host.local_running.store(true, Ordering::Relaxed);
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
                        Ok(SidecarMessage::Playback { command }) => {
                            let _ = host.player.send(player::Request::Command(command));
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
                    let _ = host
                        .player
                        .send(player::Request::Command(protocol::PlaybackCommand::Stop));
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
        .invoke_handler(tauri::generate_handler![
            connection_info,
            set_video_rect,
            operating_mode::playback_device,
            operating_mode::select_playback_device,
            operating_mode::forget_playback_device,
            operating_mode::retry_playback_device,
            operating_mode::complete_local_setup,
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
            let (display_sender, display_receiver) = mpsc::channel();
            let (player_sender, player_receiver) = mpsc::channel();
            let (connection, _) = watch::channel(None);
            let (child_exited, _) = watch::channel(false);
            app.manage(Host {
                #[cfg(windows)]
                player_worker: Mutex::new(None),
                data_dir: data_dir.clone(),
                local_running: AtomicBool::new(false),
                workers: Mutex::new(Some((player_receiver, display_receiver))),
                bluetooth: bluetooth::Bluetooth::default(),
                connection,
                child: Mutex::new(None),
                player: player_sender,
                layouts: Mutex::new(player::LayoutQueue::default()),
                display: display_sender,
                shutting_down: AtomicBool::new(false),
                window_closed: AtomicBool::new(false),
                quit_pending: AtomicBool::new(false),
                quit_confirmed: AtomicBool::new(false),
                child_exited,
            });
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
