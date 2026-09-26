#[cfg(target_os = "macos")]
pub fn request(value: serde_json::Value) -> Result<serde_json::Value, String> {
    use std::ffi::{CStr, CString};

    unsafe extern "C" {
        fn couch_sound_request(json: *const libc::c_char) -> *mut libc::c_char;
    }

    let input = CString::new(value.to_string()).map_err(|error| error.to_string())?;
    let output = unsafe { couch_sound_request(input.as_ptr()) };
    if output.is_null() { return Err("Core Audio did not answer.".into()); }
    let result = unsafe { CStr::from_ptr(output) }.to_string_lossy().into_owned();
    unsafe { libc::free(output.cast()); }
    let result: serde_json::Value = serde_json::from_str(&result).map_err(|error| error.to_string())?;
    if let Some(error) = result.get("error").and_then(serde_json::Value::as_str) { return Err(error.into()); }
    Ok(result)
}

#[cfg(target_os = "windows")]
#[path = "sound_windows.rs"]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::request;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn request(_: serde_json::Value) -> Result<serde_json::Value, String> {
    Err("Mac sound requires macOS on this computer.".into())
}

#[cfg(all(test, target_os = "macos"))]
#[test]
fn core_audio_bridge_reads_without_changing_output() {
    let inventory = request(serde_json::json!({"op":"inventory"})).unwrap();
    assert!(inventory["outputs"].is_array());
    let route = request(serde_json::json!({"op":"route"})).unwrap();
    assert!(route["output"].is_null() || route["output"].is_string());
}
