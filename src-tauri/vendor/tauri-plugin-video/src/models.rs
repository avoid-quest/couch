use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Version of the JavaScript-to-Rust command, payload, response, and error
/// contract. Additive diagnostic or capability fields do not change it.
pub const VIDEO_PLUGIN_PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativePluginDiagnostics {
    pub protocol_version: u32,
    pub crate_name: String,
    pub crate_version: String,
}

impl NativePluginDiagnostics {
    pub fn current() -> Self {
        Self {
            protocol_version: VIDEO_PLUGIN_PROTOCOL_VERSION,
            crate_name: env!("CARGO_PKG_NAME").to_owned(),
            crate_version: env!("CARGO_PKG_VERSION").to_owned(),
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TrackKind {
    Video,
    Audio,
    Subtitle,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[cfg_attr(test, derive(Default))]
#[serde(rename_all = "camelCase")]
pub struct NativeOpenRequest {
    #[serde(default)]
    pub audio_output: Option<String>,
    /// Protocol and adapter version are required by protocol 1. They remain
    /// optional while deserializing so legacy JavaScript receives a deliberate
    /// protocol error instead of a generic invalid-payload rejection.
    #[serde(default)]
    pub protocol_version: Option<u32>,
    #[serde(default)]
    pub package_version: Option<String>,
    /// Identifies the JavaScript controller that owns the singleton native surface.
    /// Late cleanup from an older React render must not close a newer player.
    #[serde(default)]
    pub session_key: String,
    pub uri: String,
    /// Playback engine requested by the JavaScript controller. Omission selects
    /// the platform's primary native backend; alternatives must be explicit.
    #[serde(default)]
    pub backend: Option<String>,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub audio_uri: Option<String>,
    /// Maximum video height for DASH playback, selected before decoding.
    #[serde(default)]
    pub max_video_height: Option<u16>,
    /// Initial playback position in seconds. Omission or zero starts normally.
    #[serde(default)]
    pub start_position: Option<f64>,
    #[serde(default)]
    pub end_position: Option<f64>,
    #[serde(default)]
    pub preferences: NativePlaybackPreferences,
    #[serde(default)]
    pub subtitles: Vec<NativeSubtitle>,
    #[serde(default)]
    pub radio: bool,
    /// Host-verified explicit IPTV live return. Ordinary loads keep demuxer defaults.
    #[serde(default)]
    pub go_live: bool,
    /// Host-verified EVENT playlist whose first segment anchors the seek timeline.
    #[serde(default)]
    pub event_start: bool,
    #[serde(default)]
    pub cookies: Option<String>,
    #[serde(default)]
    pub user_agent: Option<String>,
    #[serde(default)]
    pub referrer: Option<String>,
    #[serde(default)]
    pub tls_ca_file: Option<String>,
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub scroll_x: f64,
    #[serde(default)]
    pub scroll_y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default = "default_true")]
    pub autoplay: bool,
    #[serde(default = "default_volume")]
    pub volume: f64,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub min_buffer_ms: Option<u32>,
    #[serde(default)]
    pub max_buffer_ms: Option<u32>,
    #[serde(default)]
    pub playback_buffer_ms: Option<u32>,
    #[serde(default)]
    pub rebuffer_ms: Option<u32>,
    #[serde(default)]
    pub target_buffer_bytes: Option<u64>,
    #[serde(default)]
    pub decoder_fallback: Option<bool>,
    #[serde(default)]
    pub dolby_vision_mode: Option<String>,
    #[serde(default)]
    pub tunneling: Option<bool>,
}

const fn default_true() -> bool {
    true
}

const fn default_volume() -> f64 {
    1.0
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NativePlaybackPreferences {
    pub audio_language: String,
    pub subtitle_language: String,
    pub subtitles: NativeSubtitlePreference,
    pub speed: f64,
    pub audio_delay: f64,
    pub replay_gain: NativeReplayGain,
}

impl Default for NativePlaybackPreferences {
    fn default() -> Self {
        Self {
            audio_language: String::new(),
            subtitle_language: String::new(),
            subtitles: NativeSubtitlePreference::Auto,
            speed: 1.0,
            audio_delay: 0.0,
            replay_gain: NativeReplayGain::Off,
        }
    }
}

#[derive(Debug, Default, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum NativeReplayGain {
    #[default]
    Off,
    Track,
    Album,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NativeSubtitlePreference {
    Auto,
    Off,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct NativeSubtitle {
    pub source: String,
    pub title: String,
    #[serde(default)]
    pub language: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeLayoutRequest {
    #[serde(default)]
    pub session_key: String,
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub scroll_x: f64,
    #[serde(default)]
    pub scroll_y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeControlRequest {
    #[serde(default)]
    pub audio_output: Option<String>,
    #[serde(default)]
    pub session_key: String,
    #[serde(default)]
    pub playback_id: Option<String>,
    pub action: String,
    #[serde(default)]
    pub value: f64,
    #[serde(default = "default_native_track_index")]
    pub index: i32,
    #[serde(default)]
    pub subtitle: Option<NativeSubtitle>,
    #[serde(default)]
    pub replay_gain: Option<NativeReplayGain>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSessionRequest {
    #[serde(default)]
    pub session_key: String,
}

const fn default_native_track_index() -> i32 {
    -1
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTrackInfo {
    pub id: String,
    pub index: i32,
    pub kind: TrackKind,
    pub language: String,
    pub label: String,
    pub codec: String,
    #[serde(default)]
    pub selected: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePlaybackSnapshot {
    #[serde(default)]
    pub mpv_state: Option<MpvPlaybackState>,
    pub duration_seconds: f64,
    pub current_time_seconds: f64,
    pub buffered_seconds: f64,
    pub playing: bool,
    pub video_width: u32,
    pub video_height: u32,
    pub tracks: Vec<NativeTrackInfo>,
    #[serde(default)]
    pub presented_frames: u64,
    #[serde(default)]
    pub dropped_frames: u64,
    #[serde(default)]
    pub measured_fps: f64,
    #[serde(default)]
    pub hardware_backend: String,
    #[serde(default)]
    pub encoded_bytes_buffered: u64,
    #[serde(default)]
    pub average_frame_processing_us: f64,
}

// Properties needed by an application-owned queue, read from libmpv itself.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MpvPlaybackState {
    #[serde(default)]
    pub playback_id: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    pub volume: f64,
    pub seekable: bool,
    pub ended: bool,
    pub loading: bool,
    pub speed: f64,
    pub audio_delay: f64,
    pub subtitle_delay: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replay_gain: Option<NativeReplayGain>,
    #[serde(default)]
    pub subtitle_error: Option<String>,
    #[serde(default)]
    pub now_playing: Option<MpvNowPlaying>,
    pub chapters: Vec<MpvChapter>,
}

/// One successor selected by the host queue. Credentials remain native-only.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeNextSource {
    pub playback_id: String,
    pub uri: String,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    pub preferences: NativePlaybackPreferences,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePrepareRequest {
    pub session_key: String,
    pub playback_id: String,
    pub next: Option<NativeNextSource>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct MpvChapter {
    pub title: String,
    pub position: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct MpvNowPlaying {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
}
