use std::collections::BTreeMap;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::protocol::{
    ExternalSubtitle, PlaybackCommand, PlaybackPreferences, PlayerState, TrackKind, VideoRect,
};
use crate::Host;

pub enum Request {
    Command(PlaybackCommand),
    Layout(VideoRect),
    Observe,
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
    state: PlayerState,
    rect: VideoRect,
}

impl Player {
    fn command(&mut self, app: &AppHandle, command: PlaybackCommand) -> Result<(), String> {
        match command {
            PlaybackCommand::Load {
                playback_id,
                source,
                headers,
                audio_source,
                max_video_height,
                start_position,
                preferences,
                subtitles,
                radio,
            } => {
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
                    max_video_height,
                    start_position,
                    &preferences,
                    &subtitles,
                    radio,
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
                    self.control(app, "seek", position, -1)?;
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
                let result = self.close(app);
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
    fn load(
        &mut self,
        app: &AppHandle,
        source: &str,
        headers: &BTreeMap<String, String>,
        audio_source: Option<&str>,
        max_video_height: Option<u16>,
        start_position: Option<f64>,
        preferences: &PlaybackPreferences,
        subtitles: &[ExternalSubtitle],
        radio: bool,
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
            "maxVideoHeight": max_video_height,
            "startPosition": start_position,
            "preferences": preferences,
            "subtitles": subtitles,
            "radio": radio,
            "backend": "mpv",
            "x": self.rect.x,
            "y": self.rect.y,
            "width": self.rect.width.max(1.0),
            "height": self.rect.height.max(1.0),
            "autoplay": true,
            "volume": self.state.volume / 100.0
        }))
        .map_err(|error| error.to_string())?;
        let snapshot = app
            .video()
            .desktop()
            .open_native(request)
            .map_err(|error| error.to_string())?;
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
        let Some(session_key) = self.state.playback_id.clone() else {
            return Ok(());
        };
        let snapshot = app
            .video()
            .desktop()
            .control_native(NativeControlRequest {
                session_key,
                action: action.into(),
                value,
                index,
                subtitle: None,
            })
            .map_err(|error| error.to_string())?;
        self.apply(snapshot)
    }

    fn add_subtitle(&mut self, app: &AppHandle, subtitle: ExternalSubtitle) -> Result<(), String> {
        use tauri_plugin_video::{NativeControlRequest, NativeSubtitle, VideoExt};
        let Some(session_key) = self.state.playback_id.clone() else {
            return Ok(());
        };
        let snapshot = app
            .video()
            .desktop()
            .control_native(NativeControlRequest {
                session_key,
                action: "addSubtitle".into(),
                value: 0.0,
                index: -1,
                subtitle: Some(NativeSubtitle {
                    source: subtitle.source,
                    title: subtitle.title,
                    language: subtitle.language,
                }),
            })
            .map_err(|error| error.to_string())?;
        self.apply(snapshot)
    }

    fn observe(&mut self, app: &AppHandle) -> Result<(), String> {
        use tauri_plugin_video::{NativeSessionRequest, VideoExt};
        let Some(session_key) = self.state.playback_id.clone() else {
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
        let Some(session_key) = self.state.playback_id.clone() else {
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
        if let Some(session_key) = self.state.playback_id.clone() {
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
        self.state.status = if observed.ended {
            "ended"
        } else if observed.loading {
            "loading"
        } else if snapshot.playing {
            "playing"
        } else {
            "paused"
        };
        self.state.position = snapshot.current_time_seconds.max(0.0);
        self.state.duration =
            (snapshot.duration_seconds > 0.0).then_some(snapshot.duration_seconds);
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
            .filter(|chapter| chapter.position.is_finite() && chapter.position >= 0.0)
            .map(|chapter| crate::protocol::Chapter {
                title: chapter.title,
                position: chapter.position,
            })
            .collect();
        self.state.error = None;
        Ok(())
    }
}

#[cfg(not(target_os = "linux"))]
impl Player {
    fn load(
        &mut self,
        _: &AppHandle,
        _: &str,
        _: &BTreeMap<String, String>,
        _: Option<&str>,
        _: Option<u16>,
        _: Option<f64>,
        _: &PlaybackPreferences,
        _: &[ExternalSubtitle],
        _: bool,
    ) -> Result<(), String> {
        self.state.status = "unavailable";
        self.state.error = PlayerState::default().error;
        Ok(())
    }
    fn control(&mut self, _: &AppHandle, _: &str, _: f64, _: i32) -> Result<(), String> {
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
                "speed": 1.5, "audioDelay": -0.2, "subtitleDelay": 0.4,
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
    fn native_observations_populate_controls_without_changing_playback_identity() {
        let mut player = Player::default();
        player.state.playback_id = Some("current-item".into());
        player.apply(snapshot()).unwrap();
        assert_eq!(player.state.playback_id.as_deref(), Some("current-item"));
        assert_eq!(player.state.status, "playing");
        assert_eq!(player.state.speed, 1.5);
        assert_eq!(player.state.audio_delay, -0.2);
        assert_eq!(player.state.subtitle_delay, 0.4);
        assert_eq!(player.state.tracks[0].kind, TrackKind::Audio);
        assert_eq!(player.state.tracks[0].index, 2);
        assert!(player.state.tracks[0].selected);
        assert_eq!(player.state.chapters[0].position, 10.0);
        let track = player.state.now_playing.as_ref().unwrap();
        assert_eq!(track.title, "Song");
        assert_eq!(track.artist.as_deref(), Some("Actual artist"));
        let mut ordinary = snapshot();
        ordinary.mpv_state.as_mut().unwrap().now_playing = None;
        player.apply(ordinary).unwrap();
        assert!(player.state.now_playing.is_none());
    }

    #[test]
    fn invalid_engine_values_do_not_replace_the_last_good_observation() {
        let mut player = Player::default();
        player.apply(snapshot()).unwrap();
        let previous = player.state.clone();
        let mut invalid = snapshot();
        invalid.mpv_state.as_mut().unwrap().speed = f64::NAN;
        assert!(player.apply(invalid).is_err());
        assert!(player.state == previous);
    }
}
