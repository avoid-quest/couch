mod player;
mod protocol;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Mutex,
};
use std::time::Duration;

use serde::Serialize;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};
use tokio::sync::watch;

use protocol::{ConnectionInfo, PlayerState, SidecarMessage, VideoRect};

struct Host {
    connection: watch::Sender<Option<Result<ConnectionInfo, String>>>,
    child: Mutex<Option<CommandChild>>,
    player: mpsc::Sender<player::Request>,
    shutting_down: AtomicBool,
    child_exited: watch::Sender<bool>,
}

impl Host {
    fn report(&self, state: &PlayerState) {
        if self.shutting_down.load(Ordering::Relaxed) {
            return;
        }
        let mut child = self.child.lock().expect("sidecar lock poisoned");
        if let Some(child) = child.as_mut() {
            let mut line =
                serde_json::to_vec(&serde_json::json!({ "type": "player", "state": state }))
                    .expect("serializable player state");
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
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

#[tauri::command]
async fn connection_info(host: tauri::State<'_, Host>) -> Result<ConnectionInfo, String> {
    let mut connection = host.connection.subscribe();
    tokio::time::timeout(Duration::from_secs(15), async move {
        loop {
            if let Some(result) = connection.borrow().clone() {
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

#[tauri::command]
fn set_video_rect(rect: VideoRect, host: tauri::State<'_, Host>) -> Result<(), String> {
    if ![rect.x, rect.y, rect.width, rect.height]
        .iter()
        .all(|value| value.is_finite())
        || rect.width < 0.0
        || rect.height < 0.0
    {
        return Err("Invalid video rectangle".into());
    }
    host.player
        .send(player::Request::Layout(rect))
        .map_err(|_| "Native player stopped".into())
}

#[derive(Serialize)]
struct PickedMedia {
    source: String,
    title: String,
}

#[tauri::command]
async fn choose_media(app: tauri::AppHandle) -> Result<Option<PickedMedia>, String> {
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
async fn choose_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
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

pub fn run() {
    if std::env::args().any(|arg| arg == "--version") {
        println!("{}", option_env!("COUCH_BUILD_INFO").unwrap_or("{\"packaged\":false}"));
        return;
    }
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        );
    #[cfg(target_os = "linux")]
    let builder = builder.plugin(tauri_plugin_video::init());

    builder
        .invoke_handler(tauri::generate_handler![
            connection_info,
            set_video_rect,
            choose_media,
            choose_folder
        ])
        .setup(|app| {
            let data_dir = match std::env::var_os("COUCH_DATA_DIR") {
                Some(path) => std::path::PathBuf::from(path),
                None => app.path().app_data_dir()?,
            };
            prepare_data_dir(&data_dir)?;
            let (player_sender, player_receiver) = mpsc::channel();
            let (connection, _) = watch::channel(None);
            let (child_exited, _) = watch::channel(false);
            let token = format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            );
            let mut sidecar = app
                .shell()
                .sidecar("couch-server")?
                .env("COUCH_NATIVE", "1")
                .env("COUCH_HOST_TOKEN", token)
                .env("COUCH_DATA_DIR", &data_dir)
                .env(
                    "COUCH_PORT",
                    std::env::var("COUCH_PORT").unwrap_or_else(|_| "4100".into()),
                );
            for (variable, name) in [
                ("COUCH_YT_DLP", "yt-dlp"),
                ("COUCH_DENO", "deno"),
            ] {
                let bundled = app.path().resource_dir()?.join("tools").join(name);
                let path = if bundled.is_file() { bundled } else { data_dir.join("tools").join(name) };
                if std::env::var_os(variable).is_none() && path.is_file() {
                    sidecar = sidecar.env(variable, path);
                }
            }
            let (mut events, child) = sidecar.spawn()?;
            app.manage(Host {
                connection,
                child: Mutex::new(Some(child)),
                player: player_sender,
                shutting_down: AtomicBool::new(false),
                child_exited,
            });
            let handle = app.handle().clone();
            std::thread::Builder::new()
                .name("native-player".into())
                .spawn(move || {
                    player::run(handle, player_receiver);
                })?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = events.recv().await {
                    let host = handle.state::<Host>();
                    match event {
                        CommandEvent::Stdout(line) => {
                            match serde_json::from_slice::<SidecarMessage>(&line) {
                                Ok(SidecarMessage::Ready { connection }) => {
                                    host.connection.send_replace(Some(Ok(connection)));
                                    let _ = host.player.send(player::Request::Observe);
                                }
                                Ok(SidecarMessage::Playback { command }) => {
                                    let _ = host.player.send(player::Request::Command(command));
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
                            if !host.shutting_down.load(Ordering::Relaxed) {
                                handle.exit(1);
                            }
                        }
                        _ => {}
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Cannot start Couch")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { ref api, code, .. } = event {
                let host = app.state::<Host>();
                if host.child.lock().expect("sidecar lock poisoned").is_none() {
                    return;
                }
                api.prevent_exit();
                if host.shutting_down.swap(true, Ordering::Relaxed) {
                    return;
                }
                let mut exited = host.child_exited.subscribe();
                if let Some(child) = host.child.lock().expect("sidecar lock poisoned").as_mut() {
                    if let Err(error) = child.write(b"{\"type\":\"shutdown\"}\n") {
                        log::warn!("Cannot request media server shutdown: {error}");
                    }
                }
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ =
                        tokio::time::timeout(Duration::from_secs(2), exited.wait_for(|done| *done))
                            .await;
                    let host = handle.state::<Host>();
                    if let Some(child) = host.child.lock().expect("sidecar lock poisoned").take() {
                        log::warn!("Media server did not exit within two seconds; terminating it");
                        let _ = child.kill();
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

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn app_data_is_private_for_new_and_preexisting_directories() {
        let path =
            std::env::temp_dir().join(format!("couch-permissions-{}", uuid::Uuid::new_v4()));
        prepare_data_dir(&path).unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o700
        );
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::write(path.join("existing-data"), b"preserved").unwrap();
        prepare_data_dir(&path).unwrap();
        assert_eq!(std::fs::read(path.join("existing-data")).unwrap(), b"preserved");
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o700
        );
        std::fs::remove_dir_all(path).unwrap();
    }
}
