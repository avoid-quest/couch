#[tauri::command]
pub fn set_native_cursor_visible(window: tauri::WebviewWindow, visible: bool) -> Result<(), String> {
    crate::operating_mode::trusted(&window)?;
    #[cfg(target_os = "macos")]
    {
        let native = window.clone();
        window
            .run_on_main_thread(move || {
                if let Ok(window) = native.ns_window() {
                    unsafe { couch_set_cursor_visible(window, visible) };
                }
            })
            .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    window.set_cursor_visible(visible).map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
extern "C" {
    fn couch_set_cursor_visible(window: *mut std::ffi::c_void, visible: bool);
}
