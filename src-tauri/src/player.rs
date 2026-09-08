use std::collections::BTreeMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::{Receiver, RecvTimeoutError},
    Arc,
};
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::protocol::{
    ExternalSubtitle, PlaybackCommand, PlaybackPreferences, PlaybackSegment, PlayerState, ReplayGainMode, TrackKind, VideoRect,
};
use crate::Host;

pub enum Request {
    Command(PlaybackCommand),
    Layout(VideoRect),
    Observe,
    Diagnostics(String),
    Readiness { nonce: String, deadline: std::time::Instant },
    Shutdown,
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
            Ok(Request::Readiness { nonce, deadline }) => {
                let ok = player.readiness(&app, deadline).is_ok();
                let build = serde_json::from_str::<serde_json::Value>(
                    option_env!("COUCH_BUILD_INFO").unwrap_or("{}"),
                ).unwrap_or(serde_json::Value::Null);
                app.state::<Host>().report_message(serde_json::json!({
                    "type": "readiness", "nonce": nonce, "ok": ok, "build": build,
                }));
                continue;
            }
            Ok(Request::Diagnostics(request_id)) => {
                // A slow display/property query must not occupy the playback worker.
                // Only one query may remain in flight, even after the pipe timeout.
                if !player.diagnostics_pending.swap(true, Ordering::Relaxed) {
                    let pending = player.diagnostics_pending.clone();
                    let app = app.clone();
                    let playback_id = player.session_key.clone();
                    tauri::async_runtime::spawn_blocking(move || {
                        let report = crate::diagnostics::collect(&app, playback_id);
                        app.state::<Host>().report_message(serde_json::json!({ "type": "diagnostics", "requestId": request_id, "report": report }));
                        pending.store(false, Ordering::Relaxed);
                    });
                }
                continue;
            }
            Ok(Request::Command(command)) => player.command(&app, command),
            Ok(Request::Layout(rect)) => {
                player.rect = rect;
                player.layout(&app)
            }
            Ok(Request::Observe) | Err(RecvTimeoutError::Timeout) => player.observe(&app),
            Ok(Request::Shutdown) | Err(RecvTimeoutError::Disconnected) => return,
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
    diagnostics_pending: Arc<AtomicBool>,
    state: PlayerState,
    rect: VideoRect,
    segment: Option<PlaybackSegment>,
    session_key: Option<String>,
}

impl Player {
    fn readiness(&self, app: &AppHandle, deadline: std::time::Instant) -> Result<(), String> {
        if self.state.playback_id.is_some() || std::time::Instant::now() >= deadline {
            return Err("Native readiness requires an idle player and a current request".into());
        }
        #[cfg(target_os = "linux")]
        {
            use tauri_plugin_video::VideoExt;
            app.video().desktop().readiness_native(deadline).map_err(|error| error.to_string())
        }
        #[cfg(not(target_os = "linux"))]
        {
            let _ = app;
            Err("Native update readiness requires the Ubuntu player".into())
        }
    }

    fn command(&mut self, app: &AppHandle, command: PlaybackCommand) -> Result<(), String> {
        match command {
            PlaybackCommand::Prepare { playback_id, next } => {
                self.prepare(app, playback_id, next)?;
                Ok(())
            }
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
            } => {
                self.segment = segment;
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
                            "Could not load the subtitle. Try another SRT, VTT or ASS file.".into(),
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
            PlaybackCommand::ReplayGain { playback_id, mode } => {
                if self.state.playback_id.as_deref() == Some(&playback_id) {
                    self.replay_gain(app, mode)?;
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
                let result = self.close(app);
                self.session_key = None;
                // The coordinator retires this playback ID before requesting stop.
                // Report a close failure against that stopped session as well.
                self.state = PlayerState {
                    volume: self.state.volume,
                    ..PlayerState::default()
                };
                result.map_err(|error| format!("Could not stop native playback: {error}"))
            }
        }
    }
}

#[cfg(target_os = "linux")]
impl Player {
    fn prepare(&mut self, app: &AppHandle, playback_id: String, next: Option<crate::protocol::PreparedAudio>) -> Result<(), String> {
        use tauri_plugin_video::{NativePrepareRequest, VideoExt};
        let Some(session_key) = self.session_key.clone() else { return Ok(()); };
        let request: NativePrepareRequest = serde_json::from_value(serde_json::json!({
            "sessionKey": session_key,
            "playbackId": playback_id,
            "next": next.map(|next| serde_json::json!({ "playbackId": next.playback_id, "uri": next.source, "headers": next.headers, "preferences": next.preferences })),
        })).map_err(|error| error.to_string())?;
        // An unsupported preparation falls back to the existing EOF load.
        // It must not replace the current song's useful playback state.
        if let Ok(snapshot) = app.video().desktop().prepare_native(request) { self.apply(snapshot)?; }
        Ok(())
    }

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
            .map_err(|error| error.to_string())?;
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

    fn replay_gain(&mut self, app: &AppHandle, mode: ReplayGainMode) -> Result<(), String> {
        use tauri_plugin_video::{NativeControlRequest, NativeReplayGain, VideoExt};
        let Some(session_key) = self.session_key.clone() else { return Ok(()); };
        let snapshot = app.video().desktop().control_native(NativeControlRequest {
            session_key,
            action: "replayGain".into(),
            playback_id: self.state.playback_id.clone(),
            value: 0.0,
            index: -1,
            subtitle: None,
            audio_output: None,
            replay_gain: Some(match mode {
                ReplayGainMode::Off => NativeReplayGain::Off,
                ReplayGainMode::Track => NativeReplayGain::Track,
                ReplayGainMode::Album => NativeReplayGain::Album,
            }),
        }).map_err(|error| error.to_string())?;
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
        let snapshot = app
            .video()
            .desktop()
            .stats_native(NativeSessionRequest { session_key })
            .map_err(|error| error.to_string())?;
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
        self.state.position = self.segment.map_or(snapshot.current_time_seconds.max(0.0), |bounds| bounds.relative(snapshot.current_time_seconds));
        self.state.duration =
            self.segment.map(|bounds| bounds.duration()).or_else(|| (snapshot.duration_seconds > 0.0).then_some(snapshot.duration_seconds));
        self.state.volume = observed.volume.clamp(0.0, 1.0) * 100.0;
        self.state.seekable = observed.seekable;
        self.state.speed = observed.speed;
        self.state.audio_delay = observed.audio_delay;
        self.state.subtitle_delay = observed.subtitle_delay;
        self.state.replay_gain = observed.replay_gain.map(|mode| match mode {
            tauri_plugin_video::NativeReplayGain::Off => ReplayGainMode::Off,
            tauri_plugin_video::NativeReplayGain::Track => ReplayGainMode::Track,
            tauri_plugin_video::NativeReplayGain::Album => ReplayGainMode::Album,
        });
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

#[cfg(not(target_os = "linux"))]
impl Player {
    fn prepare(&mut self, _: &AppHandle, _: String, _: Option<crate::protocol::PreparedAudio>) -> Result<(), String> { Ok(()) }
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
    ) -> Result<(), String> {
        self.state.status = "unavailable";
        self.state.error = PlayerState::default().error;
        Ok(())
    }
    fn audio_output(&mut self, _: &AppHandle, _: &str) -> Result<(), String> { Ok(()) }
    fn control(&mut self, _: &AppHandle, _: &str, _: f64, _: i32) -> Result<(), String> {
        Ok(())
    }
    fn replay_gain(&mut self, _: &AppHandle, _: ReplayGainMode) -> Result<(), String> {
        Ok(())
    }
    fn add_subtitle(&mut self, _: &AppHandle, _: ExternalSubtitle) -> Result<(), String> {
        Err("Native playback currently requires Linux".into())
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

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    fn snapshot() -> tauri_plugin_video::NativePlaybackSnapshot {
        serde_json::from_value(serde_json::json!({
            "mpvState": {
                "volume": 0.65, "seekable": true, "ended": false, "loading": false,
                "speed": 1.5, "audioDelay": -0.2, "subtitleDelay": 0.4, "replayGain": "album",
                "chapters": [{ "title": "Second chapter", "position": 10.0 }]
                ,"nowPlaying": { "title": "Song", "artist": "Actual artist" }
            },
            "durationSeconds": 20.0, "currentTimeSeconds": 11.0, "bufferedSeconds": 20.0,
            "playing": true, "videoWidth": 640, "videoHeight": 360,
            "tracks": [{ "id": "mpv-audio-2", "index": 2, "kind": "audio",
                "language": "ita", "label": "Italian", "codec": "aac", "selected": true }]
        }))
        .unwrap()
    }

    #[test]
    fn cue_observations_use_relative_positions_duration_and_chapters() {
        let mut player = Player { segment: Some(PlaybackSegment { start: 8.0, end: 14.0 }), ..Player::default() };
        player.apply(snapshot()).unwrap();
        assert_eq!(player.state.position, 3.0);
        assert_eq!(player.state.duration, Some(6.0));
        assert_eq!(player.state.chapters[0].position, 2.0);
        let mut end = snapshot();
        end.current_time_seconds = 15.0;
        end.mpv_state.as_mut().unwrap().ended = true;
        player.apply(end).unwrap();
        assert_eq!(player.state.position, 6.0);
        assert_eq!(player.state.status, "ended");
        player.segment = None;
        player.apply(snapshot()).unwrap();
        assert_eq!(player.state.position, 11.0);
        assert_eq!(player.state.duration, Some(20.0));
    }

    #[test]
    fn native_observations_populate_controls_without_changing_playback_identity() {
        let mut player = Player::default();
        player.state.playback_id = Some("current-item".into());
        player.apply(snapshot()).unwrap();
        assert_eq!(player.state.playback_id.as_deref(), Some("current-item"));
        assert_eq!(player.state.status, "playing");
        assert_eq!(player.state.speed, 1.5);
        assert_eq!(player.state.audio_delay, -0.2);
        assert_eq!(player.state.subtitle_delay, 0.4);
        assert_eq!(player.state.replay_gain, Some(ReplayGainMode::Album));
        assert_eq!(player.state.tracks[0].kind, TrackKind::Audio);
        assert_eq!(player.state.tracks[0].index, 2);
        assert!(player.state.tracks[0].selected);
        assert_eq!(player.state.chapters[0].position, 10.0);
        let track = player.state.now_playing.as_ref().unwrap();
        assert_eq!(track.title, "Song");
        assert_eq!(track.artist.as_deref(), Some("Actual artist"));
        let mut ordinary = snapshot();
        ordinary.mpv_state.as_mut().unwrap().now_playing = None;
        ordinary.mpv_state.as_mut().unwrap().replay_gain = None;
        player.apply(ordinary).unwrap();
        assert!(player.state.now_playing.is_none());
        assert!(player.state.replay_gain.is_none());
    }

    #[test]
    fn prepared_observations_change_track_identity_but_keep_the_native_session() {
        let mut player = Player { session_key: Some("first".into()), ..Player::default() };
        player.state.playback_id = Some("first".into());
        let mut next = snapshot();
        next.mpv_state.as_mut().unwrap().playback_id = Some("second".into());
        player.apply(next.clone()).unwrap();
        assert_eq!(player.session_key.as_deref(), Some("first"));
        assert_eq!(player.state.playback_id.as_deref(), Some("second"));
        assert_eq!(player.state.status, "playing");
        next.mpv_state.as_mut().unwrap().error = Some("Next source failed".into());
        player.apply(next).unwrap();
        assert_eq!(player.state.playback_id.as_deref(), Some("second"));
        assert_eq!(player.state.status, "error");
        assert_eq!(player.state.error.as_deref(), Some("Next source failed"));
    }

    #[test]
    fn invalid_engine_values_do_not_replace_the_last_good_observation() {
        let mut player = Player::default();
        player.apply(snapshot()).unwrap();
        let previous = player.state.clone();
        for speed in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let mut invalid = snapshot();
            invalid.mpv_state.as_mut().unwrap().speed = speed;
            assert!(player.apply(invalid).is_err());
            assert!(player.state == previous);
        }
    }
}
