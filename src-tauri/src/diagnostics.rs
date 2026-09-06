use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tauri_plugin_video::{NativeSessionRequest, VideoExt};

// The private pipe carries only these facts. No media paths, process environment,
// credentials or arbitrary mpv properties enter the report.
pub fn collect(app: &AppHandle, playback_id: Option<String>) -> Value {
    let mut facts =
        vec![json!({"name":"Native host", "value":"Ready", "source":"Private coordinator pipe"})];
    let monitor = app
        .get_webview_window("main")
        .and_then(|window| window.current_monitor().ok().flatten());
    facts.push(json!({"name":"Selected display", "value":monitor.as_ref().and_then(|monitor| monitor.name()).map(|name| name.chars().take(100).collect::<String>()), "source":"Monitor containing the native window; unknown if unavailable"}));
    facts.push(json!({"name":"Display pixels", "value":monitor.map(|monitor| format!("{} × {}", monitor.size().width, monitor.size().height)), "source":"Native window monitor"}));
    facts.push(json!({"name":"Data directory override", "value":std::env::var_os("COUCH_DATA_DIR").is_some().to_string(), "source":"COUCH_DATA_DIR environment when set, otherwise application data directory; path omitted"}));
    facts.push(json!({"name":"Basic rendering requested", "value":matches!(std::env::var("COUCH_BASIC_RENDERING").as_deref(), Ok("1")).to_string(), "source":"COUCH_BASIC_RENDERING environment; this is configuration, not observed renderer state"}));
    let properties = playback_id
        .and_then(|session_key| {
            app.video()
                .desktop()
                .diagnostic_properties(NativeSessionRequest { session_key })
                .ok()
        })
        .unwrap_or_default();
    for (name, property, source) in [
        ("mpv version", "mpv-version", "Running native media helper"),
        (
            "Hardware decoder",
            "hwdec-current",
            "mpv actual decoder; no means software decoding; unknown when idle or unavailable",
        ),
        ("Video output", "current-vo", "mpv current output driver"),
        ("Audio output", "current-ao", "mpv current audio driver"),
        (
            "Audio device selection",
            "audio-device",
            "mpv effective selection; auto delegates the physical route to the audio system",
        ),
        ("Video decoder", "video-codec", "mpv current video decoder"),
        (
            "Basic GPU rendering",
            "gpu-dumb-mode",
            "mpv effective renderer property; unknown if unsupported",
        ),
    ] {
        facts.push(json!({"name":name, "value":properties.get(property).and_then(|value| value.as_ref()).filter(|value| !value.is_empty()), "source":source}));
    }
    json!({"build":serde_json::from_str::<Value>(option_env!("COUCH_BUILD_INFO").unwrap_or("{}")).unwrap_or(Value::Null), "facts":facts})
}
