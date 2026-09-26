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
        "powerUnavailableReason": "Couch's current macOS Bluetooth adapter cannot turn Bluetooth on. Check in System Settings on the playback host.",
        "forgetUnavailableReason": "Couch's current macOS Bluetooth adapter cannot forget devices. Check in System Settings on the playback host."
    })
}

#[cfg(any(target_os = "windows", test))]
pub fn windows() -> Value {
    json!({
        "connectUnavailableReason": "Couch's current Windows Bluetooth adapter cannot connect paired devices. Check in System Settings on the playback host.",
        "disconnectUnavailableReason": "Couch's current Windows Bluetooth adapter cannot disconnect devices. Check in System Settings on the playback host.",
        "pairingNotice": "Pairing requires consent in the local Windows prompt on the playback host's desktop. Be ready to respond there before connecting an unpaired device. Cancelling in Couch may not dismiss that prompt."
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inventories_match_the_shared_platform_fixtures() {
        let fixtures: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/bluetooth-inventories.json"
        ))
        .unwrap();
        for (platform, support) in [
            ("linux", linux()),
            ("macos", macos()),
            ("windows", windows()),
        ] {
            assert_eq!(support, fixtures[platform]["support"], "{platform}");
        }
    }
}
