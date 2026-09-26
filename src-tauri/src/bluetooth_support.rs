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
        "powerUnavailableReason": "Couch cannot yet turn on Bluetooth on macOS. Open System Settings on the Mac running Couch.",
        "forgetUnavailableReason": "Couch cannot yet forget devices on macOS. Open System Settings on the Mac running Couch."
    })
}

#[cfg(any(target_os = "windows", test))]
pub fn windows() -> Value {
    json!({
        "connectUnavailableReason": "Couch cannot yet connect paired devices on Windows. Open System Settings on the Windows computer running Couch.",
        "disconnectUnavailableReason": "Couch cannot yet disconnect devices on Windows. Open System Settings on the Windows computer running Couch.",
        "pairingNotice": "Pairing needs your confirmation on the Windows computer running Couch. Be ready to respond to its Windows prompt. Cancelling in Couch may not dismiss that prompt."
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
