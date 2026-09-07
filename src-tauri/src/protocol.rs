use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

// Mirrors src/shared/protocol.ts across the private newline-delimited pipe.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    pub origin: String,
    pub token: String,
    pub pairing_code: String,
    pub urls: Vec<String>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SidecarMessage {
    AppimageQuiesced { nonce: String, closed: bool, error: Option<String> },
    AppimageUpdate {
        #[serde(rename = "requestId")]
        request_id: String,
        action: crate::appimage_update::Action,
    },
    Display {
        #[serde(rename = "requestId")]
        request_id: String,
        action: crate::display::Action,
    },
    Observe,
    Ready {
        #[serde(flatten)]
        connection: ConnectionInfo,
    },
    Playback {
        command: PlaybackCommand,
    },
    Readiness {
        nonce: String,
    },
    Diagnostics {
        #[serde(rename = "requestId")]
        request_id: String,
    },
}

#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PlaybackCommand {
    Load {
        playback_id: String,
        source: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
        #[serde(default)]
        audio_source: Option<String>,
        #[serde(default)]
        max_video_height: Option<u16>,
        #[serde(default, deserialize_with = "deserialize_start_position")]
        start_position: Option<f64>,
        #[serde(default, deserialize_with = "deserialize_segment")]
        segment: Option<PlaybackSegment>,
        #[serde(default)]
        preferences: PlaybackPreferences,
        #[serde(default)]
        subtitles: Vec<ExternalSubtitle>,
        #[serde(default)]
        radio: bool,
        #[serde(default)]
        go_live: bool,
    },
    AddSubtitle {
        playback_id: String,
        source: String,
        title: String,
        #[serde(default)]
        language: Option<String>,
    },
    Pause {
        playback_id: String,
        paused: bool,
    },
    Seek {
        playback_id: String,
        position: f64,
    },
    Track {
        playback_id: String,
        kind: TrackKind,
        index: i32,
    },
    Speed {
        playback_id: String,
        speed: f64,
    },
    ReplayGain {
        playback_id: String,
        mode: ReplayGainMode,
    },
    AudioDelay {
        playback_id: String,
        delay: f64,
    },
    SubtitleDelay {
        playback_id: String,
        delay: f64,
    },
    Volume {
        volume: f64,
    },
    Stop,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PlaybackPreferences {
    pub audio_language: String,
    pub subtitle_language: String,
    pub subtitles: SubtitlePreference,
    pub speed: f64,
    pub audio_delay: f64,
    pub replay_gain: ReplayGainMode,
}

impl Default for PlaybackPreferences {
    fn default() -> Self {
        Self {
            audio_language: String::new(),
            subtitle_language: String::new(),
            subtitles: SubtitlePreference::Auto,
            speed: 1.0,
            audio_delay: 0.0,
            replay_gain: ReplayGainMode::Off,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ReplayGainMode {
    #[default]
    Off,
    Track,
    Album,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SubtitlePreference {
    Auto,
    Off,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct ExternalSubtitle {
    pub source: String,
    pub title: String,
    #[serde(default)]
    pub language: Option<String>,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
pub struct PlaybackSegment {
    pub start: f64,
    pub end: f64,
}

impl PlaybackSegment {
    pub fn duration(self) -> f64 { self.end - self.start }
    pub fn absolute(self, position: f64) -> f64 { self.start + position.clamp(0.0, self.duration()) }
    pub fn relative(self, position: f64) -> f64 { (position - self.start).clamp(0.0, self.duration()) }
}

fn deserialize_segment<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<PlaybackSegment>, D::Error> {
    let segment = Option::<PlaybackSegment>::deserialize(deserializer)?;
    if segment.is_some_and(|value| !value.start.is_finite() || !value.end.is_finite() || value.start < 0.0 || value.end <= value.start) {
        return Err(serde::de::Error::custom("segment requires finite increasing nonnegative bounds"));
    }
    Ok(segment)
}

fn deserialize_start_position<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<f64>, D::Error> {
    let position = Option::<f64>::deserialize(deserializer)?;
    if position.is_some_and(|value| !value.is_finite() || value < 0.0) {
        return Err(serde::de::Error::custom(
            "startPosition must be finite and nonnegative",
        ));
    }
    Ok(position)
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TrackKind {
    Video,
    Audio,
    Subtitle,
}

#[derive(Clone, PartialEq, Serialize)]
pub struct Track {
    pub id: String,
    pub index: i32,
    pub kind: TrackKind,
    pub label: String,
    pub language: String,
    pub selected: bool,
}

#[derive(Clone, PartialEq, Serialize)]
pub struct Chapter {
    pub title: String,
    pub position: f64,
}

#[derive(Clone, PartialEq, Serialize)]
pub struct NowPlaying {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
}

#[derive(Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerState {
    pub playback_id: Option<String>,
    pub status: &'static str,
    pub position: f64,
    pub duration: Option<f64>,
    pub volume: f64,
    pub seekable: bool,
    pub tracks: Vec<Track>,
    pub chapters: Vec<Chapter>,
    pub speed: f64,
    pub audio_delay: f64,
    pub subtitle_delay: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replay_gain: Option<ReplayGainMode>,
    pub subtitle_error: Option<String>,
    pub now_playing: Option<NowPlaying>,
    pub error: Option<String>,
}

impl Default for PlayerState {
    fn default() -> Self {
        Self {
            playback_id: None,
            status: if cfg!(target_os = "linux") { "idle" } else { "unavailable" },
            position: 0.0,
            duration: None,
            volume: 80.0,
            seekable: false,
            tracks: Vec::new(),
            chapters: Vec::new(),
            speed: 1.0,
            audio_delay: 0.0,
            subtitle_delay: 0.0,
            replay_gain: None,
            subtitle_error: None,
            now_playing: None,
            error: (!cfg!(target_os = "linux"))
                .then(|| "Native playback currently requires Linux. This host can run the UI and LAN server.".into()),
        }
    }
}

#[derive(Clone, Copy, Default, Deserialize)]
pub struct VideoRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cue_segments_validate_and_translate_private_positions() {
        for bounds in ["null", r#"{"start":5.333333333333333,"end":11.666666666666666}"#] {
            let command = format!(r#"{{"type":"load","playbackId":"cue","source":"/album.flac","segment":{bounds}}}"#);
            assert!(serde_json::from_str::<PlaybackCommand>(&command).is_ok());
        }
        for bounds in [r#"{"start":-1,"end":2}"#, r#"{"start":2,"end":2}"#, r#"{"start":3,"end":2}"#, r#"{"start":0,"end":1e999}"#] {
            let command = format!(r#"{{"type":"load","playbackId":"cue","source":"/album.flac","segment":{bounds}}}"#);
            assert!(serde_json::from_str::<PlaybackCommand>(&command).is_err());
        }
        let segment = PlaybackSegment { start: 5.0, end: 11.0 };
        assert_eq!(segment.absolute(2.0), 7.0);
        assert_eq!(segment.absolute(99.0), 11.0);
        assert_eq!(segment.relative(4.0), 0.0);
        assert_eq!(segment.relative(99.0), 6.0);
    }

    #[test]
    fn replaygain_private_pipe_defaults_and_strict_modes() {
        for (mode, expected) in [("off", ReplayGainMode::Off), ("track", ReplayGainMode::Track), ("album", ReplayGainMode::Album)] {
            let command = format!(r#"{{"type":"replayGain","playbackId":"music","mode":"{mode}"}}"#);
            assert!(matches!(serde_json::from_str::<PlaybackCommand>(&command).unwrap(), PlaybackCommand::ReplayGain { playback_id, mode } if playback_id == "music" && mode == expected));
            let preferences: PlaybackPreferences = serde_json::from_value(serde_json::json!({ "replayGain": mode })).unwrap();
            assert_eq!(preferences.replay_gain, expected);
        }
        let preferences: PlaybackPreferences = serde_json::from_str("{}").unwrap();
        assert_eq!(preferences.replay_gain, ReplayGainMode::Off);
        for mode in ["null", "1", "true", "[]", "{}", "\"TRACK\"", "\"invalid\""] {
            let command = format!(r#"{{"type":"replayGain","playbackId":"music","mode":{mode}}}"#);
            assert!(serde_json::from_str::<PlaybackCommand>(&command).is_err());
        }
        let state = PlayerState { replay_gain: Some(ReplayGainMode::Album), ..Default::default() };
        let state = serde_json::to_value(state).unwrap();
        assert_eq!(state["replayGain"], "album");
        assert!(state.get("replayGainPeak").is_none());
        assert!(state.get("replayGainDb").is_none());
        assert!(serde_json::to_value(PlayerState::default()).unwrap().get("replayGain").is_none());
    }

    #[test]
    fn pipe_contract_accepts_typescript_commands_and_ready_message() {
        assert!(matches!(serde_json::from_str::<SidecarMessage>(r#"{"type":"observe"}"#).unwrap(), SidecarMessage::Observe));
        let message: SidecarMessage = serde_json::from_str(
            r#"{"type":"playback","command":{"type":"pause","playbackId":"a","paused":true}}"#,
        )
        .unwrap();
        assert!(matches!(message, SidecarMessage::Playback {
            command: PlaybackCommand::Pause { playback_id, paused: true }
        } if playback_id == "a"));
        let message: SidecarMessage = serde_json::from_str(
            r#"{"type":"ready","origin":"http://127.0.0.1:1234","token":"secret","pairingCode":"123456","urls":[]}"#,
        ).unwrap();
        assert!(
            matches!(message, SidecarMessage::Ready { connection } if connection.pairing_code == "123456")
        );
        let command: PlaybackCommand = serde_json::from_str(
            r#"{"type":"track","playbackId":"a","kind":"subtitle","index":-1}"#,
        )
        .unwrap();
        assert!(matches!(
            command,
            PlaybackCommand::Track {
                kind: TrackKind::Subtitle,
                index: -1,
                ..
            }
        ));
        let command: PlaybackCommand =
            serde_json::from_str(r#"{"type":"audioDelay","playbackId":"a","delay":-0.2}"#).unwrap();
        assert!(matches!(command, PlaybackCommand::AudioDelay { delay, .. } if delay == -0.2));
    }

    #[test]
    fn observations_use_the_shared_field_names() {
        let state = serde_json::to_value(PlayerState::default()).unwrap();
        assert_eq!(state["playbackId"], serde_json::Value::Null);
        assert_eq!(state["volume"], 80.0);
        assert_eq!(state["audioDelay"], 0.0);
        assert_eq!(state["subtitleDelay"], 0.0);
        assert_eq!(state["subtitleError"], serde_json::Value::Null);
        assert_eq!(state["nowPlaying"], serde_json::Value::Null);
        assert_eq!(state["tracks"], serde_json::json!([]));
        assert_eq!(state["chapters"], serde_json::json!([]));
        assert_eq!(state["speed"], 1.0);
        assert!(state.get("playback_id").is_none());
    }

    #[test]
    fn private_subtitle_and_preference_contract_defaults_and_round_trips() {
        let command: PlaybackCommand = serde_json::from_str(
            r#"{"type":"load","playbackId":"a","source":"/private/movie.mkv","preferences":{"audioLanguage":"ita","subtitleLanguage":"eng","subtitles":"off","speed":1.5,"audioDelay":-0.2},"subtitles":[{"source":"/private/movie.srt","title":"English","language":"eng"}]}"#,
        ).unwrap();
        assert!(
            matches!(command, PlaybackCommand::Load { preferences, subtitles, .. }
            if preferences.audio_language == "ita" && preferences.subtitle_language == "eng"
            && matches!(preferences.subtitles, SubtitlePreference::Off)
            && preferences.speed == 1.5 && preferences.audio_delay == -0.2
            && subtitles[0].title == "English" && subtitles[0].language.as_deref() == Some("eng"))
        );
        let command: PlaybackCommand = serde_json::from_str(
            r#"{"type":"load","playbackId":"a","source":"/private/movie.mkv"}"#,
        )
        .unwrap();
        assert!(
            matches!(command, PlaybackCommand::Load { preferences, subtitles, .. }
            if preferences.audio_language.is_empty() && preferences.subtitle_language.is_empty()
            && matches!(preferences.subtitles, SubtitlePreference::Auto)
            && preferences.speed == 1.0 && preferences.audio_delay == 0.0 && subtitles.is_empty())
        );
        let command: PlaybackCommand = serde_json::from_str(
            r#"{"type":"addSubtitle","playbackId":"a","source":"/private/movie.srt","title":"English"}"#,
        ).unwrap();
        assert!(
            matches!(command, PlaybackCommand::AddSubtitle { playback_id, language: None, .. } if playback_id == "a")
        );
        let state = serde_json::to_string(&PlayerState::default()).unwrap();
        assert!(!state.contains("source"));
    }

    #[test]
    fn private_load_accepts_an_optional_dash_height_limit() {
        let command: PlaybackCommand = serde_json::from_str(
            r#"{"type":"load","playbackId":"dash","source":"https://example.test/video.mpd","maxVideoHeight":720}"#,
        ).unwrap();
        assert!(matches!(
            command,
            PlaybackCommand::Load {
                max_video_height: Some(720),
                ..
            }
        ));
        let command: PlaybackCommand = serde_json::from_str(
            r#"{"type":"load","playbackId":"ordinary","source":"https://example.test/video.mp4"}"#,
        )
        .unwrap();
        assert!(matches!(
            command,
            PlaybackCommand::Load {
                max_video_height: None,
                ..
            }
        ));
        for index in ["-1", "1.5", "65536"] {
            let command = format!(
                r#"{{"type":"load","playbackId":"invalid","source":"https://example.test/video.mpd","maxVideoHeight":{index}}}"#
            );
            assert!(serde_json::from_str::<PlaybackCommand>(&command).is_err());
        }
    }

    #[test]
    fn live_return_policy_is_private_optional_and_boolean() {
        for (extra, expected) in [("", false), (",\"goLive\":true", true)] {
            let command = format!(r#"{{"type":"load","playbackId":"live","source":"https://private.test/live"{extra}}}"#);
            assert!(matches!(serde_json::from_str::<PlaybackCommand>(&command).unwrap(), PlaybackCommand::Load { go_live, .. } if go_live == expected));
        }
        for value in ["-1", "\"true\"", "null"] {
            let command = format!(r#"{{"type":"load","playbackId":"live","source":"https://private.test/live","goLive":{value}}}"#);
            assert!(serde_json::from_str::<PlaybackCommand>(&command).is_err());
        }
    }

    #[test]
    fn radio_policy_is_private_and_optional() {
        for (extra, expected) in [("", false), (",\"radio\":true", true)] {
            let command = format!(
                r#"{{"type":"load","playbackId":"radio","source":"http://private.test/stream"{extra}}}"#
            );
            assert!(
                matches!(serde_json::from_str::<PlaybackCommand>(&command).unwrap(), PlaybackCommand::Load { radio, .. } if radio == expected)
            );
        }
        let state = PlayerState {
            now_playing: Some(NowPlaying {
                title: "Artist - Song".into(),
                artist: None,
            }),
            ..Default::default()
        };
        let value = serde_json::to_value(state).unwrap();
        assert_eq!(
            value["nowPlaying"],
            serde_json::json!({ "title": "Artist - Song" })
        );
        assert!(value.get("source").is_none());
    }

    #[test]
    fn load_headers_are_private_and_absence_means_empty() {
        let command: PlaybackCommand = serde_json::from_str(
            r#"{"type":"load","playbackId":"a","source":"http://media.test/video","audioSource":"http://media.test/audio?value=a,b","headers":{"Authorization":"test-token"}}"#,
        ).unwrap();
        assert!(
            matches!(command, PlaybackCommand::Load { headers, audio_source, .. }
            if headers.get("Authorization").map(String::as_str) == Some("test-token")
                && audio_source.as_deref() == Some("http://media.test/audio?value=a,b"))
        );
        let command: PlaybackCommand = serde_json::from_str(
            r#"{"type":"load","playbackId":"b","source":"http://media.test/radio"}"#,
        )
        .unwrap();
        assert!(
            matches!(command, PlaybackCommand::Load { headers, audio_source, .. }
            if headers.is_empty() && audio_source.is_none())
        );
        assert!(serde_json::to_value(PlayerState::default())
            .unwrap()
            .get("headers")
            .is_none());
    }

    #[test]
    fn private_load_accepts_start_position_and_rejects_invalid_times() {
        for (value, expected) in [("12.25", Some(12.25)), ("0", Some(0.0)), ("null", None)] {
            let command = format!(
                r#"{{"type":"load","playbackId":"resume","source":"/media/movie.mkv","startPosition":{value}}}"#
            );
            assert!(matches!(
                serde_json::from_str::<PlaybackCommand>(&command).unwrap(),
                PlaybackCommand::Load { start_position, .. } if start_position == expected
            ));
        }
        let command = r#"{"type":"load","playbackId":"new","source":"/media/movie.mkv"}"#;
        assert!(matches!(
            serde_json::from_str::<PlaybackCommand>(command).unwrap(),
            PlaybackCommand::Load {
                start_position: None,
                ..
            }
        ));
        for value in ["-1", "-0.25", "1e400", "\"12\"", "true", "[]", "{}"] {
            let command = format!(
                r#"{{"type":"load","playbackId":"invalid","source":"/media/movie.mkv","startPosition":{value}}}"#
            );
            assert!(serde_json::from_str::<PlaybackCommand>(&command).is_err());
        }
    }
}
