// Current adapter implementation support, not OS guarantees or permission/hardware state.
use serde_json::{json, Value};

#[cfg(any(target_os = "linux", test))]
pub fn linux() -> Value {
    json!({
        "powerUnavailableReason": null,
        "connectUnavailableReason": null,
        "disconnectUnavailableReason": null,
        "forgetUnavailableReason": null,
        "pairingNotice": null
    })
}

#[cfg(any(target_os = "macos", test))]
pub fn macos() -> Value {
    json!({
        "powerUnavailableReason": "Couch can't yet turn on Bluetooth on macOS. Open System Settings on the computer running Couch.",
        "forgetUnavailableReason": "Couch can't yet forget devices on macOS. Open System Settings on the computer running Couch."
    })
}

#[cfg(any(target_os = "windows", test))]
pub fn windows() -> Value {
    json!({
        "connectUnavailableReason": "Couch can't yet connect paired devices on Windows. Open System Settings on the computer running Couch.",
        "disconnectUnavailableReason": "Couch can't yet disconnect devices on Windows. Open System Settings on the computer running Couch.",
        "pairingNotice": "Pairing needs your confirmation on the computer running Couch. Be ready to respond to its Windows prompt. Cancelling in Couch may not dismiss that prompt."
    })
}

