use std::{sync::Mutex, time::{Duration, Instant}};
use tauri::{Emitter, Manager};
use crate::{player, protocol::{PlaybackCommand, PlayerState}, AudioAuthority, Host, RendererOwner};

const LEASE: Duration = Duration::from_secs(10);
const CHALLENGE: Duration = Duration::from_secs(1);
#[derive(Default)]
struct Lease {
    generation: Option<String>,
    pending: Option<(String, Instant)>,
    deadline: Option<Instant>,
}
impl Lease {
    fn valid(&self, generation: &str, now: Instant) -> bool {
        self.generation.as_deref() == Some(generation) && self.deadline.is_some_and(|deadline| now < deadline)
    }
    fn request(&mut self, generation: &str, now: Instant) -> Result<String, String> {
        if self.generation.as_deref() != Some(generation) || self.deadline.is_some_and(|deadline| now >= deadline) { return Err("Native receiver expired.".into()); }
        let nonce = uuid::Uuid::new_v4().to_string();
        self.pending = Some((nonce.clone(), now));
        Ok(nonce)
    }
    fn renew(&mut self, generation: &str, nonce: &str, now: Instant) -> Result<(), String> {
        if self.generation.as_deref() != Some(generation) || self.deadline.is_some_and(|deadline| now >= deadline) { return Err("Native receiver expired.".into()); }
        let Some((expected, requested)) = self.pending.as_ref() else { return Err("No receiver renewal is pending.".into()); };
        if expected != nonce || now.duration_since(*requested) > CHALLENGE { return Err("Native receiver renewal expired.".into()); }
        self.deadline = Some(*requested + LEASE);
        self.pending = None;
        Ok(())
    }
    fn expired(&self, now: Instant) -> bool {
        self.generation.is_some() && self.deadline.or_else(|| self.pending.as_ref().map(|(_, at)| *at + CHALLENGE)).is_some_and(|deadline| now >= deadline)
    }
}
#[derive(Default)]
pub struct Receiver { lease: Mutex<Lease>, audio: Mutex<Option<(String, Instant, bool)>>, operation: Mutex<()> }

pub fn valid(app: &tauri::AppHandle, generation: &str) -> bool {
    app.state::<Receiver>().lease.lock().unwrap().valid(generation, Instant::now())
}
pub fn active(app: &tauri::AppHandle) -> bool {
    let receiver = app.state::<Receiver>();
    let lease = receiver.lease.lock().unwrap();
    lease.generation.as_ref().is_some_and(|generation| lease.valid(generation, Instant::now()))
}
fn current_generation(app: &tauri::AppHandle) -> Option<String> {
    let receiver = app.state::<Receiver>();
    let lease = receiver.lease.lock().unwrap();
    lease.generation.as_ref().filter(|generation| lease.valid(generation, Instant::now())).cloned()
}
pub fn report(app: &tauri::AppHandle, expected: &str, state: &PlayerState) {
    let receiver = app.state::<Receiver>();
    let lease = receiver.lease.lock().unwrap();
    if let Some(generation) = lease.generation.as_ref().filter(|generation| generation.as_str() == expected && lease.valid(generation, Instant::now())) {
        let _ = app.emit_to("main", "native-receiver-player", serde_json::json!({ "generation": generation, "state": state }));
    }
}
// Called off the UI and player threads. Silence is mandatory before authority changes.
fn stop(app: &tauri::AppHandle) {
    let host = app.state::<Host>();
    if host.workers.lock().unwrap().is_some() { return; }
    let (sender, mut reply) = tokio::sync::oneshot::channel();
    if host.player.send(player::Request::Stop(sender)).is_err() { std::process::exit(1); }
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match reply.try_recv() {
            Ok(Ok(())) => return,
            Ok(Err(_)) | Err(tokio::sync::oneshot::error::TryRecvError::Closed) => std::process::exit(1),
            Err(tokio::sync::oneshot::error::TryRecvError::Empty) => {},
        }
        if Instant::now() >= deadline { std::process::exit(1); }
        std::thread::sleep(Duration::from_millis(10));
    }
}
pub async fn revoke(app: &tauri::AppHandle, generation: Option<String>) -> Result<(), String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let receiver = app.state::<Receiver>();
        let _operation = receiver.operation.lock().unwrap();
        let mut lease = receiver.lease.lock().unwrap();
        if generation.as_ref().is_some_and(|generation| lease.generation.as_ref() != Some(generation)) { return; }
        let old = lease.generation.clone();
        *lease = Lease::default();
        drop(lease);
        if let Some(old) = old {
            if *app.state::<Host>().renderer_owner.lock().unwrap() == RendererOwner::Remote(old.clone()) {
                stop(&app);
                app.state::<Host>().release_renderer(&app, &RendererOwner::Remote(old));
            }
        }
    }).await.map_err(|error| error.to_string())
}
pub fn watch(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(50));
        let shutting_down = app.state::<Host>().shutting_down.load(std::sync::atomic::Ordering::Relaxed);
        let receiver = app.state::<Receiver>();
        let Ok(_operation) = receiver.operation.try_lock() else { continue; };
        let mut lease = receiver.lease.lock().unwrap();
        let expired = lease.expired(Instant::now()) || shutting_down;
        let old = if expired { lease.generation.take() } else { None };
        if expired { *lease = Lease::default(); }
        drop(lease);
        if let Some(old) = old {
            if *app.state::<Host>().renderer_owner.lock().unwrap() == RendererOwner::Remote(old.clone()) {
                stop(&app);
                app.state::<Host>().release_renderer(&app, &RendererOwner::Remote(old));
            }
        }
        let expired_audio = {
            let mut audio = receiver.audio.lock().unwrap();
            if let Some((generation, deadline, revoked)) = audio.as_mut() {
                if !*revoked && (shutting_down || Instant::now() >= *deadline) {
                    *revoked = true;
                    Some(generation.clone())
                } else { None }
            } else { None }
        };
        if let Some(generation) = expired_audio {
            // Keep the output reserved until the WebView confirms that its SDK stopped.
            let _ = app.emit_to("main", "native-audio-revoked", generation);
        }
        if shutting_down { return; }
    });
}
#[derive(serde::Serialize)]
pub struct Started { generation: String, nonce: String }
#[tauri::command]
pub async fn native_receiver_begin(window: tauri::WebviewWindow, app: tauri::AppHandle, origin: String) -> Result<Started, String> {
    crate::operating_mode::trusted(&window)?;
    let modes = app.state::<crate::operating_mode::Modes>();
    let _mode = modes.operation.lock().await;
    crate::operating_mode::receiver_authority(&app, &origin)?;
    crate::start_player(&app)?;
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let app = handle;
        let receiver = app.state::<Receiver>();
        let _operation = receiver.operation.lock().unwrap();
        let previous = receiver.lease.lock().unwrap().generation.take();
        *receiver.lease.lock().unwrap() = Lease::default();
        if let Some(previous) = previous {
            if *app.state::<Host>().renderer_owner.lock().unwrap() == RendererOwner::Remote(previous.clone()) {
                stop(&app);
                app.state::<Host>().release_renderer(&app, &RendererOwner::Remote(previous));
            }
        }
        let generation = uuid::Uuid::new_v4().to_string();
        let mut lease = receiver.lease.lock().unwrap();
        lease.generation = Some(generation.clone());
        let nonce = lease.request(&generation, Instant::now())?;
        Ok(Started { generation, nonce })
    }).await.map_err(|error| error.to_string())?
}
#[tauri::command]
pub fn native_receiver_request(window: tauri::WebviewWindow, app: tauri::AppHandle, generation: String) -> Result<String, String> {
    crate::operating_mode::trusted(&window)?;
    app.state::<Receiver>().lease.lock().unwrap().request(&generation, Instant::now())
}
#[tauri::command]
pub fn native_receiver_renew(window: tauri::WebviewWindow, app: tauri::AppHandle, generation: String, nonce: String) -> Result<(), String> {
    crate::operating_mode::trusted(&window)?;
    app.state::<Receiver>().lease.lock().unwrap().renew(&generation, &nonce, Instant::now())?;
    observe(&app, generation)
}
#[tauri::command]
pub fn native_receiver_command(window: tauri::WebviewWindow, app: tauri::AppHandle, generation: String, command: PlaybackCommand) -> Result<(), String> {
    crate::operating_mode::trusted(&window)?;
    if !valid(&app, &generation) { return Err("Native receiver expired.".into()); }
    if let PlaybackCommand::Load { playback_owner, video_only, .. } = &command {
        if let Some(lease) = app.state::<Host>().audio_output.lock().unwrap().as_ref() {
            if !lease.permits_load(playback_owner.as_deref(), *video_only) {
                return Err("This computer's audio belongs to another playback.".into());
            }
        } else if *video_only {
            return Err("Silent video requires this playback's audio reservation.".into());
        }
    }
    if matches!(command, PlaybackCommand::Prepare { .. } | PlaybackCommand::Load { .. }) {
        app.state::<Host>().claim_remote(&generation)?;
    }
    if *app.state::<Host>().renderer_owner.lock().unwrap() != RendererOwner::Remote(generation.clone()) {
        if matches!(command, PlaybackCommand::Stop) { report(&app, &generation, &PlayerState::default()); return Ok(()); }
        if !matches!(command, PlaybackCommand::Volume { .. }) || !app.state::<Host>().idle() {
            return Err("This computer's player is already in use.".into());
        }
    }
    app.state::<Host>().player.send(player::Request::RemoteCommand { generation, command }).map_err(|error| error.to_string())
}
#[tauri::command]
pub fn native_receiver_report(window: tauri::WebviewWindow, app: tauri::AppHandle, generation: String) -> Result<(), String> {
    crate::operating_mode::trusted(&window)?;
    if !valid(&app, &generation) { return Err("Native receiver expired.".into()); }
    observe(&app, generation)
}

fn observe(app: &tauri::AppHandle, generation: String) -> Result<(), String> {
    if *app.state::<Host>().renderer_owner.lock().unwrap() == RendererOwner::Remote(generation.clone()) {
        app.state::<Host>().player.send(player::Request::RemoteObserve(generation)).map_err(|error| error.to_string())
    } else {
        let volume = app.state::<Host>().player_state.lock().unwrap().volume;
        report(app, &generation, &PlayerState { volume, ..PlayerState::default() });
        Ok(())
    }
}
#[tauri::command]
pub async fn native_receiver_end(window: tauri::WebviewWindow, app: tauri::AppHandle, generation: String) -> Result<(), String> {
    crate::operating_mode::trusted(&window)?;
    revoke(&app, Some(generation)).await
}

#[tauri::command]
pub fn native_audio_begin(window: tauri::WebviewWindow, app: tauri::AppHandle, managed: Option<bool>, playback_owner: Option<String>, retiring_playback_id: Option<String>) -> Result<StartedAudio, String> {
    crate::operating_mode::trusted(&window)?;
    let receiver = app.state::<Receiver>();
    let _operation = receiver.operation.lock().unwrap();
    let generation = uuid::Uuid::new_v4().to_string();
    let authority = if managed.unwrap_or(false) {
        if crate::operating_mode::remote_selected(&app) {
            AudioAuthority::Remote(current_generation(&app).ok_or("This computer is not connected as a playback device.")?)
        } else {
            AudioAuthority::LocalCore
        }
    } else {
        AudioAuthority::External
    };
    app.state::<Host>().claim_audio(&generation, authority, playback_owner.as_deref(), retiring_playback_id.as_deref())?;
    *receiver.audio.lock().unwrap() = Some((generation.clone(), Instant::now() + LEASE, false));
    Ok(StartedAudio { generation })
}

#[derive(serde::Serialize)]
pub struct StartedAudio { generation: String }

#[tauri::command]
pub fn native_audio_renew(window: tauri::WebviewWindow, app: tauri::AppHandle, generation: String) -> Result<(), String> {
    crate::operating_mode::trusted(&window)?;
    let receiver = app.state::<Receiver>();
    let mut audio = receiver.audio.lock().unwrap();
    if let Some((current, deadline, revoked)) = audio.as_mut() {
        if current == &generation && !*revoked && Instant::now() < *deadline {
            *deadline = Instant::now() + LEASE;
            return Ok(());
        }
    }
    Err("This computer's audio lease expired.".into())
}

#[tauri::command]
pub fn native_audio_end(window: tauri::WebviewWindow, app: tauri::AppHandle, generation: String) -> Result<(), String> {
    crate::operating_mode::trusted(&window)?;
    let receiver = app.state::<Receiver>();
    let _operation = receiver.operation.lock().unwrap();
    let mut audio = receiver.audio.lock().unwrap();
    if audio.as_ref().is_some_and(|(current, _, _)| current == &generation) {
        *audio = None;
        drop(audio);
        app.state::<Host>().release_audio(&app, &generation);
    }
    Ok(())
}

#[tauri::command]
pub async fn native_video_state(window: tauri::WebviewWindow, app: tauri::AppHandle, generation: String, playback_owner: String) -> Result<Option<PlayerState>, String> {
    crate::operating_mode::trusted(&window)?;
    let (reply, result) = tokio::sync::oneshot::channel();
    app.state::<Host>().player.send(player::Request::VideoState { generation, playback_owner, reply }).map_err(|error| error.to_string())?;
    tokio::time::timeout(Duration::from_secs(2), result).await.map_err(|_| "Native video did not respond.".to_string())?.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn native_video_command(window: tauri::WebviewWindow, app: tauri::AppHandle, generation: String, playback_owner: String, command: PlaybackCommand) -> Result<(), String> {
    crate::operating_mode::trusted(&window)?;
    let (reply, result) = tokio::sync::oneshot::channel();
    app.state::<Host>().player.send(player::Request::VideoCommand { generation, playback_owner, command, reply }).map_err(|error| error.to_string())?;
    tokio::time::timeout(Duration::from_secs(2), result).await.map_err(|_| "Native video did not respond.".to_string())?.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn renewal_uses_request_time_and_rejects_delayed_or_replayed_nonce() {
        let now = Instant::now();
        let mut lease = Lease { generation: Some("one".into()), ..Lease::default() };
        let nonce = lease.request("one", now).unwrap();
        assert!(lease.renew("one", &nonce, now + Duration::from_millis(500)).is_ok());
        assert_eq!(lease.deadline, Some(now + LEASE));
        assert!(lease.renew("one", &nonce, now).is_err());
        let next = lease.request("one", now + Duration::from_secs(2)).unwrap();
        assert!(lease.renew("one", &next, now + Duration::from_secs(4)).is_err());
        assert!(lease.expired(now + LEASE));
        assert!(!lease.valid("one", now + LEASE));
    }
    #[test]
    fn initial_challenge_expires_without_permitting_playback() {
        let now = Instant::now();
        let mut lease = Lease { generation: Some("one".into()), ..Lease::default() };
        let nonce = lease.request("one", now).unwrap();
        assert!(!lease.valid("one", now));
        assert!(lease.expired(now + CHALLENGE));
        assert!(lease.renew("one", &nonce, now + CHALLENGE + Duration::from_millis(1)).is_err());
    }
    #[test]
    fn revoked_generation_rejects_queued_commands_and_renewals() {
        let now = Instant::now();
        let mut lease = Lease { generation: Some("new".into()), deadline: Some(now + LEASE), ..Lease::default() };
        assert!(!lease.valid("old", now));
        assert!(lease.request("old", now).is_err());
        lease = Lease::default();
        assert!(!lease.valid("new", now));
    }
}
