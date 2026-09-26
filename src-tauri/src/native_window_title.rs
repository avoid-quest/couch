#[tauri::command]
pub fn set_native_window_title(window: tauri::WebviewWindow, title: String) -> Result<(), String> {
    crate::operating_mode::trusted(&window)?;
    window.set_title(&title).map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    {
        let native = window.clone();
        let title = std::ffi::CString::new(title).map_err(|error| error.to_string())?;
        window
            .run_on_main_thread(move || {
                if let Ok(window) = native.ns_window() {
                    // AppKit owns the toolbar and native window behavior; only its label is custom.
                    unsafe { couch_update_window_title(window, title.as_ptr()) };
                }
            })
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
extern "C" {
    fn couch_update_window_title(window: *mut std::ffi::c_void, title: *const std::ffi::c_char);
}
