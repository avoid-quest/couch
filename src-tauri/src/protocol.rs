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
    Addresses { urls: Vec<String> },
    Bluetooth {
        #[serde(rename = "requestId")]
        request_id: String,
        action: crate::bluetooth::Action,
    },
    Sound {
        #[serde(rename = "requestId")]
        request_id: String,
        action: serde_json::Value,
    },
    Display {
        #[serde(rename = "requestId")]
        request_id: String,
        action: crate::display::Action,
    },
    Ready {
        #[serde(flatten)]
        connection: ConnectionInfo,
    },
    Playback {
        command: PlaybackCommand,
    },
}

#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PlaybackCommand {
    AudioOutput { output: String },
    AudioPause,
    Load {
        #[serde(default)]
        audio_output: Option<String>,
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
        #[serde(default)]
        paused: bool,
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
        #[serde(default)]
        event_start: bool,
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
}

impl Default for PlaybackPreferences {
    fn default() -> Self {
        Self {
            audio_language: String::new(),
            subtitle_language: String::new(),
            subtitles: SubtitlePreference::Auto,
            speed: 1.0,
            audio_delay: 0.0,
        }
    }
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
    pub buffering: bool,
    pub position: f64,
    pub duration: Option<f64>,
    pub volume: f64,
    pub seekable: bool,
    pub tracks: Vec<Track>,
    pub chapters: Vec<Chapter>,
    pub speed: f64,
    pub audio_delay: f64,
    pub subtitle_delay: f64,
    pub subtitle_error: Option<String>,
    pub now_playing: Option<NowPlaying>,
    pub error: Option<String>,
}

impl Default for PlayerState {
    fn default() -> Self {
        Self {
            playback_id: None,
            status: if cfg!(any(target_os = "linux", target_os = "macos", windows)) { "idle" } else { "unavailable" },
            buffering: false,
            position: 0.0,
            duration: None,
            volume: 80.0,
            seekable: false,
            tracks: Vec::new(),
            chapters: Vec::new(),
            speed: 1.0,
            audio_delay: 0.0,
            subtitle_delay: 0.0,
            subtitle_error: None,
            now_playing: None,
            error: (!cfg!(any(target_os = "linux", target_os = "macos", windows)))
                .then(|| "Native playback is unavailable on this computer.".into()),
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

