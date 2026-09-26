use serde::{Deserialize, Serialize};

const FALLBACK_ARTWORK: &[u8] = include_bytes!("../icons/128x128@2x.png");

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    id: String,
    title: String,
    artist: String,
    album: String,
    playing: bool,
    live: bool,
    position: f64,
    duration: Option<f64>,
    rate: f64,
    can_pause: bool,
    can_seek: bool,
    can_next: bool,
    artwork: Option<Artwork>,
}

#[derive(Clone, PartialEq, Deserialize, Serialize)]
pub struct Artwork {
    url: String,
    #[serde(skip_serializing)]
    token: Option<String>,
}

#[cfg(target_os = "macos")]
#[path = "now_playing_macos.rs"]
mod platform;
#[cfg(windows)]
#[path = "now_playing_windows.rs"]
mod platform;
#[cfg(target_os = "linux")]
#[path = "now_playing_linux.rs"]
mod platform;

use std::sync::Mutex;
use tauri::Emitter;
type ArtworkTask = Option<(String, Artwork, tauri::async_runtime::JoinHandle<()>)>;
static ARTWORK: Mutex<ArtworkTask> = Mutex::new(None);

pub fn install(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    if let Err(error) = platform::install(app, window) {
        log::warn!("System media controls are unavailable: {error}");
    }
}

fn emit(app: &tauri::AppHandle, id: &str, command: &str, position: f64) {
    if let Err(error) = app.emit_to(
        "main",
        "native-media-command",
        serde_json::json!({ "id": id, "command": command, "position": position }),
    ) {
        log::warn!("Couldn't send a system media command: {error}");
    }
}

fn update(app: &tauri::AppHandle, media: Option<Media>) -> Result<(), String> {
    platform::update(app, media.clone())?;
    let requested = media.and_then(|media| media.artwork.map(|artwork| (media.id, artwork)));
    let mut current = ARTWORK.lock().map_err(|error| error.to_string())?;
    if current.as_ref().map(|(id, artwork, _)| (id, artwork))
        == requested.as_ref().map(|(id, artwork)| (id, artwork))
    {
        return Ok(());
    }
    if let Some((_, _, task)) = current.take() {
        task.abort();
    }
    if let Some((id, artwork)) = requested {
        let task_id = id.clone();
        let task_artwork = artwork.clone();
        let app = app.clone();
        let task = tauri::async_runtime::spawn(async move {
            if let Some(bytes) = fetch_artwork(&task_artwork).await {
                platform::artwork(&app, task_id, task_artwork.url, bytes);
            }
        });
        *current = Some((id, artwork, task));
    }
    Ok(())
}

async fn fetch_artwork(artwork: &Artwork) -> Option<Vec<u8>> {
    let url = reqwest::Url::parse(&artwork.url).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .ok()?;
    let mut request = client.get(url);
    if let Some(token) = &artwork.token {
        request = request.bearer_auth(token);
    }
    let mut response = request.send().await.ok()?.error_for_status().ok()?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
            return None;
        }
        bytes.extend_from_slice(&chunk);
    }
    Some(bytes)
}

pub fn clear(app: &tauri::AppHandle) {
    if let Err(error) = update(app, None) {
        log::warn!("Couldn't clear system media controls: {error}");
    }
}

#[tauri::command]
pub fn set_now_playing(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    media: Option<Media>,
) -> Result<(), String> {
    crate::operating_mode::trusted(&window)?;
    update(&app, media)
}
