use std::collections::BTreeMap;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::protocol::{
    ExternalSubtitle, PlaybackCommand, PlaybackPreferences, PlaybackSegment, PlayerState, TrackKind, VideoRect,
};
use crate::Host;

pub enum Request {
    Command(PlaybackCommand),
    Layout,
    Observe,
    Stop(tokio::sync::oneshot::Sender<Result<(), String>>),
    Shutdown,
}

#[derive(Default)]
pub struct LayoutQueue { rect: Option<VideoRect>, queued: bool }

impl LayoutQueue {
    pub fn push(&mut self, rect: VideoRect) -> bool {
        self.rect = Some(rect);
        if self.queued { false } else { self.queued = true; true }
    }

    pub fn take(&mut self) -> Option<VideoRect> { self.queued = false; self.rect.take() }
    pub fn cancel(&mut self) { self.queued = false; }
}

const RECONCILE_STARTED_LOAD: &str = "Native load started after its reply wait. Observing playback before retrying.";

fn is_rejected_control(command: &PlaybackCommand) -> bool {
    !matches!(command, PlaybackCommand::Load { .. } | PlaybackCommand::Stop)
}

enum CommandError {
    Reconcile,
    Ignore(String),
    Report(String),
}

fn command_error(replacement: bool, rejected_control: bool, error: String) -> CommandError {
    if replacement && error == RECONCILE_STARTED_LOAD {
        CommandError::Reconcile
    } else if rejected_control {
        CommandError::Ignore(error)
    } else {
        CommandError::Report(error)
    }
}

#[cfg(any(target_os = "linux", target_os = "macos", windows))]
fn observation_error(reconciling: &mut bool, error: tauri_plugin_video::Error) -> Result<(), String> {
    if *reconciling && matches!(error, tauri_plugin_video::Error::DispatcherInFlight) {
        return Ok(());
    }
    *reconciling = false;
    Err(error.to_string())
}

// One worker preserves command order. The plugin dispatches GPU work onto GTK.
pub fn run(app: AppHandle, receiver: Receiver<Request>) {
    let mut player = Player::default();
    let mut reported = None;
    loop {
        let request = receiver.recv_timeout(Duration::from_millis(250));
        let force = matches!(
            request,
            Ok(Request::Observe | Request::Command(PlaybackCommand::Stop))
        );
        let result = match request {
            Ok(Request::Stop(reply)) => {
                let result = player.command(&app, PlaybackCommand::Stop);
                let _ = reply.send(result);
                continue;
            }
            Ok(Request::Command(command)) => {
                let replacement = matches!(&command, PlaybackCommand::Load { .. });
                let rejected_control = is_rejected_control(&command);
                match player.command(&app, command) {
                    Err(error) => match command_error(replacement, rejected_control, error) {
                        CommandError::Reconcile => {
                            player.reconciling_started_load = true;
                            player.observe(&app)
                        }
                        CommandError::Ignore(error) => { log::warn!("Native playback control was rejected without changing playback state: {error}"); continue; }
                        CommandError::Report(error) => Err(error),
                    },
                    Ok(()) => Ok(()),
                }
            }
            Ok(Request::Layout) => {
                let rect = app.state::<Host>().layouts.lock().expect("layout queue poisoned").take();
                if let Some(rect) = rect {
                    player.rect = rect;
                    if let Err(error) = player.layout(&app) { log::warn!("Native layout was rejected without changing playback state: {error}"); }
                }
                continue;
            }
            Ok(Request::Observe) | Err(RecvTimeoutError::Timeout) => player.observe(&app),
            Ok(Request::Shutdown) | Err(RecvTimeoutError::Disconnected) => {
                let _ = player.close(&app);
                return;
            }
        };
        if let Err(error) = result {
            player.state.status = "error";
            player.state.now_playing = None;
            player.state.error = Some(error);
        }
        if force || reported.as_ref() != Some(&player.state) {
            app.state::<Host>().report(&player.state);
            reported = Some(player.state.clone());
        }
    }
}

#[derive(Default)]
struct Player {
    reconciling_started_load: bool,
    state: PlayerState,
    rect: VideoRect,
    segment: Option<PlaybackSegment>,
    session_key: Option<String>,
}

impl Player {
    fn command(&mut self, app: &AppHandle, command: PlaybackCommand) -> Result<(), String> {
        match command {
            PlaybackCommand::AudioOutput { output } => self.audio_output(app, &output),
            PlaybackCommand::AudioPause => self.control(app, "audioPause", 0.0, -1),
            PlaybackCommand::Load {
                audio_output,
                playback_id,
                source,
                headers,
                audio_source,
                max_video_height,
                start_position,
                paused,
                segment,
                preferences,
                subtitles,
                radio,
                go_live,
                event_start,
            } => {
                self.segment = segment;
                self.reconciling_started_load = false;
                self.session_key = Some(playback_id.clone());
                let start_position = segment.map(|bounds| bounds.absolute(start_position.filter(|position| *position < bounds.duration()).unwrap_or(0.0))).or(start_position);
                self.state = PlayerState {
                    playback_id: Some(playback_id),
                    status: "loading",
                    volume: self.state.volume,
                    ..PlayerState::default()
                };
                self.load(
                    app,
                    &source,
                    &headers,
                    audio_source.as_deref(),
                    audio_output.as_deref(),
                    max_video_height,
                    start_position,
                    paused,
                    &preferences,
                    &subtitles,
                    radio,
                    go_live,
                    event_start,
                )
            }
            PlaybackCommand::AddSubtitle {
                playback_id,
                source,
                title,
                language,
            } => {
                if self.state.playback_id.as_deref() == Some(&playback_id) {
                    // A bad subtitle must not stop an otherwise playable movie.
                    if self
                        .add_subtitle(
                            app,
                            ExternalSubtitle {
                                source,
                                title,
                                language,
                            },
                        )
                        .is_err()
                    {
                        self.state.subtitle_error = Some(
                            "Couldn't load the subtitle. Try another SRT, VTT or ASS file.".into(),
                        );
                    }
                }
                Ok(())
            }
            PlaybackCommand::Pause {
                playback_id,
                paused,
            } => {
                if self.state.playback_id.as_deref() == Some(&playback_id) {
                    self.control(app, if paused { "pause" } else { "play" }, 0.0, -1)?;
                }
                Ok(())
            }
            PlaybackCommand::Seek {
                playback_id,
                position,
            } => {
                if self.state.playback_id.as_deref() == Some(&playback_id) {
                    self.control(app, "seek", self.segment.map_or(position, |bounds| bounds.absolute(position)), -1)?;
                }
                Ok(())
            }
            PlaybackCommand::Track {
                playback_id,
                kind,
                index,
            } => {
                if self.state.playback_id.as_deref() == Some(&playback_id) {
                    if kind == TrackKind::Subtitle && index == -1 {
                        self.control(app, "subtitlesOff", 0.0, -1)?;
                    } else if matches!(kind, TrackKind::Audio | TrackKind::Subtitle)
                        && self
                            .state
                            .tracks
                            .iter()
                            .any(|track| track.index == index && track.kind == kind)
                    {
                        self.control(app, "track", 0.0, index)?;
                    } else {
                        return Err("The selected track is no longer available".into());
                    }
                }
                Ok(())
            }
            PlaybackCommand::Speed { playback_id, speed } => {
                if self.state.playback_id.as_deref() == Some(&playback_id) {
                    self.control(app, "speed", speed, -1)?;
                }
                Ok(())
            }
            PlaybackCommand::AudioDelay { playback_id, delay } => {
                if self.state.playback_id.as_deref() == Some(&playback_id) {
                    self.control(app, "audioDelay", delay, -1)?;
                }
                Ok(())
            }
            PlaybackCommand::SubtitleDelay { playback_id, delay } => {
                if self.state.playback_id.as_deref() == Some(&playback_id) {
                    self.control(app, "subtitleDelay", delay, -1)?;
                }
                Ok(())
            }
            PlaybackCommand::Volume { volume } => {
                if self.state.playback_id.is_some() {
                    self.control(app, "volume", volume / 100.0, -1)?;
                } else {
                    self.state.volume = volume.clamp(0.0, 100.0);
                }
                Ok(())
            }
            PlaybackCommand::Stop => {
                self.segment = None;
                self.reconciling_started_load = false;
                let result = self.close(app);
                if result.is_ok() {
                    self.session_key = None;
                }
                // The coordinator retires this playback ID before requesting stop.
                // Report a close failure against that stopped session as well.
                self.state = PlayerState {
                    volume: self.state.volume,
                    ..PlayerState::default()
                };
                result.map_err(|error| format!("Couldn't stop native playback: {error}"))
            }
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "macos", windows))]
impl Player {
    fn load(
        &mut self,
        app: &AppHandle,
        source: &str,
        headers: &BTreeMap<String, String>,
        audio_source: Option<&str>,
        audio_output: Option<&str>,
        max_video_height: Option<u16>,
        start_position: Option<f64>,
        paused: bool,
        preferences: &PlaybackPreferences,
        subtitles: &[ExternalSubtitle],
        radio: bool,
        go_live: bool,
        event_start: bool,
    ) -> Result<(), String> {
        use tauri_plugin_video::{NativeOpenRequest, VideoExt};
        // The plugin's own defaulted request fields retain its engine defaults.
        let request: NativeOpenRequest = serde_json::from_value(serde_json::json!({
            "protocolVersion": tauri_plugin_video::VIDEO_PLUGIN_PROTOCOL_VERSION,
            "packageVersion": env!("CARGO_PKG_VERSION"),
            "sessionKey": self.state.playback_id,
            "uri": source,
            "headers": headers,
            "audioUri": audio_source,
            "audioOutput": audio_output,
            "maxVideoHeight": max_video_height,
            "startPosition": start_position,
            "endPosition": self.segment.map(|bounds| bounds.end),
            "preferences": preferences,
            "subtitles": subtitles,
            "radio": radio,
            "goLive": go_live,
            "eventStart": event_start,
            "backend": "mpv",
            "x": self.rect.x,
            "y": self.rect.y,
            "width": self.rect.width.max(1.0),
            "height": self.rect.height.max(1.0),
            "autoplay": !paused,
            "volume": if audio_output.is_some() { 1.0 } else { self.state.volume / 100.0 }
        }))
        .map_err(|error| error.to_string())?;
        let snapshot = app
            .video()
            .desktop()
            .open_native(request)
            .map_err(|error| match error {
                tauri_plugin_video::Error::DispatcherInFlight => RECONCILE_STARTED_LOAD.into(),
                error => error.to_string(),
            })?;
        self.apply(snapshot)
    }

    fn audio_output(&mut self, app: &AppHandle, output: &str) -> Result<(), String> {
        use tauri_plugin_video::{NativeControlRequest, VideoExt};
        let Some(session_key) = self.session_key.clone() else { return Ok(()); };
        let snapshot = app.video().desktop().control_native(NativeControlRequest {
            session_key, playback_id: None, action: "audioOutput".into(), value: 0.0, index: -1,
            subtitle: None, replay_gain: None, audio_output: Some(output.into()),
        }).map_err(|error| error.to_string())?;
        self.apply(snapshot)
    }

    fn control(
        &mut self,
        app: &AppHandle,
        action: &str,
        value: f64,
        index: i32,
    ) -> Result<(), String> {
        use tauri_plugin_video::{NativeControlRequest, VideoExt};
        let Some(session_key) = self.session_key.clone() else {
            return Ok(());
        };
        let snapshot = app
            .video()
            .desktop()
            .control_native(NativeControlRequest {
                session_key,
                action: action.into(),
                playback_id: if matches!(action, "volume" | "audioPause") { None } else { self.state.playback_id.clone() },
                value,
                index,
                subtitle: None,
                replay_gain: None,
                audio_output: None,
            })
            .map_err(|error| error.to_string())?;
        self.apply(snapshot)
    }

    fn add_subtitle(&mut self, app: &AppHandle, subtitle: ExternalSubtitle) -> Result<(), String> {
        use tauri_plugin_video::{NativeControlRequest, NativeSubtitle, VideoExt};
        let Some(session_key) = self.session_key.clone() else {
            return Ok(());
        };
        let snapshot = app
            .video()
            .desktop()
            .control_native(NativeControlRequest {
                session_key,
                action: "addSubtitle".into(),
                playback_id: self.state.playback_id.clone(),
                value: 0.0,
                index: -1,
                subtitle: Some(NativeSubtitle {
                    source: subtitle.source,
                    title: subtitle.title,
                    language: subtitle.language,
                }),
                replay_gain: None,
                audio_output: None,
            })
            .map_err(|error| error.to_string())?;
        self.apply(snapshot)
    }

    fn observe(&mut self, app: &AppHandle) -> Result<(), String> {
        use tauri_plugin_video::{NativeSessionRequest, VideoExt};
        let Some(session_key) = self.session_key.clone() else {
            return Ok(());
        };
        if self.state.status == "error" {
            return Ok(());
        }
        let snapshot = match app.video().desktop().stats_native(NativeSessionRequest { session_key }) {
            Ok(snapshot) => snapshot,
            Err(error) => return observation_error(&mut self.reconciling_started_load, error),
        };
        self.reconciling_started_load = false;
        self.apply(snapshot)
    }

    fn layout(&mut self, app: &AppHandle) -> Result<(), String> {
        use tauri_plugin_video::{NativeLayoutRequest, VideoExt};
        let Some(session_key) = self.session_key.clone() else {
            return Ok(());
        };
        if self.state.status == "error" {
            return Ok(());
        }
        app.video()
            .desktop()
            .layout_native(NativeLayoutRequest {
                session_key,
                x: self.rect.x,
                y: self.rect.y,
                width: self.rect.width.max(1.0),
                height: self.rect.height.max(1.0),
                scroll_x: 0.0,
                scroll_y: 0.0,
            })
            .map_err(|error| error.to_string())
    }

    fn close(&mut self, app: &AppHandle) -> Result<(), String> {
        use tauri_plugin_video::{NativeSessionRequest, VideoExt};
        if let Some(session_key) = self.session_key.clone() {
            app.video()
                .desktop()
                .close_native(NativeSessionRequest { session_key })
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    fn apply(
        &mut self,
        snapshot: tauri_plugin_video::NativePlaybackSnapshot,
    ) -> Result<(), String> {
        let Some(observed) = snapshot.mpv_state else {
            return Err("Native backend did not provide playback observations".into());
        };
        if ![
            snapshot.current_time_seconds,
            snapshot.duration_seconds,
            observed.volume,
            observed.speed,
            observed.audio_delay,
            observed.subtitle_delay,
        ]
        .iter()
        .all(|value| value.is_finite())
        {
            return Err("Native backend reported invalid playback timing or volume".into());
        }
        if let Some(playback_id) = observed.playback_id {
            self.state.playback_id = Some(playback_id);
        }
        self.state.status = if observed.error.is_some() {
            "error"
        } else if observed.ended {
            "ended"
        } else if observed.loading {
            "loading"
        } else if snapshot.playing {
            "playing"
        } else {
            "paused"
        };
        self.state.buffering = observed.buffering && self.state.status == "loading";
        self.state.position = self.segment.map_or(snapshot.current_time_seconds.max(0.0), |bounds| bounds.relative(snapshot.current_time_seconds));
        self.state.duration =
            self.segment.map(|bounds| bounds.duration()).or_else(|| (snapshot.duration_seconds > 0.0).then_some(snapshot.duration_seconds));
        self.state.volume = observed.volume.clamp(0.0, 1.0) * 100.0;
        self.state.seekable = observed.seekable;
        self.state.speed = observed.speed;
        self.state.audio_delay = observed.audio_delay;
        self.state.subtitle_delay = observed.subtitle_delay;
        self.state.subtitle_error = observed.subtitle_error;
        self.state.now_playing = observed
            .now_playing
            .map(|track| crate::protocol::NowPlaying {
                title: track.title,
                artist: track.artist,
            });
        self.state.tracks = snapshot
            .tracks
            .into_iter()
            .map(|track| crate::protocol::Track {
                id: track.id,
                index: track.index,
                kind: match track.kind {
                    tauri_plugin_video::TrackKind::Video => TrackKind::Video,
                    tauri_plugin_video::TrackKind::Audio => TrackKind::Audio,
                    tauri_plugin_video::TrackKind::Subtitle => TrackKind::Subtitle,
                },
                label: track.label,
                language: track.language,
                selected: track.selected,
            })
            .collect();
        self.state.chapters = observed
            .chapters
            .into_iter()
            .filter(|chapter| chapter.position.is_finite() && chapter.position >= 0.0 && self.segment.is_none_or(|bounds| chapter.position >= bounds.start && chapter.position < bounds.end))
            .map(|chapter| crate::protocol::Chapter {
                title: chapter.title,
                position: self.segment.map_or(chapter.position, |bounds| bounds.relative(chapter.position)),
            })
            .collect();
        self.state.error = observed.error;
        Ok(())
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
impl Player {
    fn load(
        &mut self,
        _: &AppHandle,
        _: &str,
        _: &BTreeMap<String, String>,
        _: Option<&str>,
        _: Option<&str>,
        _: Option<u16>,
        _: Option<f64>,
        _: bool,
        _: &PlaybackPreferences,
        _: &[ExternalSubtitle],
        _: bool,
        _: bool,
        _: bool,
    ) -> Result<(), String> {
        self.state.status = "unavailable";
        self.state.error = PlayerState::default().error;
        Ok(())
    }
    fn audio_output(&mut self, _: &AppHandle, _: &str) -> Result<(), String> { Ok(()) }
    fn control(&mut self, _: &AppHandle, _: &str, _: f64, _: i32) -> Result<(), String> {
        Ok(())
    }
    fn add_subtitle(&mut self, _: &AppHandle, _: ExternalSubtitle) -> Result<(), String> {
        Err("Native playback is unavailable in this build".into())
    }
    fn observe(&mut self, _: &AppHandle) -> Result<(), String> {
        Ok(())
    }
    fn layout(&mut self, _: &AppHandle) -> Result<(), String> {
        Ok(())
    }
    fn close(&mut self, _: &AppHandle) -> Result<(), String> {
        Ok(())
    }
}

