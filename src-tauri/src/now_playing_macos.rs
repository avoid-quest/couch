use super::Media;
use std::{
    ffi::{c_char, CStr, CString},
    sync::OnceLock,
};

extern "C" {
    fn couch_now_playing_install(
        callback: extern "C" fn(*const c_char, *const c_char, f64),
        fallback: *const u8,
        length: usize,
    );
    fn couch_now_playing_update(json: *const c_char);
    fn couch_now_playing_artwork(
        id: *const c_char,
        url: *const c_char,
        bytes: *const u8,
        length: usize,
    );
}
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

extern "C" fn command(id: *const c_char, command: *const c_char, position: f64) {
    let (id, command) = unsafe { (CStr::from_ptr(id), CStr::from_ptr(command)) };
    if let Some(app) = APP.get() {
        super::emit(
            app,
            &id.to_string_lossy(),
            &command.to_string_lossy(),
            position,
        );
    }
}

pub fn install(app: &tauri::AppHandle, _window: &tauri::WebviewWindow) -> Result<(), String> {
    let _ = APP.set(app.clone());
    unsafe {
        couch_now_playing_install(
            command,
            super::FALLBACK_ARTWORK.as_ptr(),
            super::FALLBACK_ARTWORK.len(),
        );
    }
    Ok(())
}

pub fn update(app: &tauri::AppHandle, media: Option<Media>) -> Result<(), String> {
    let json = CString::new(serde_json::to_string(&media).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    app.run_on_main_thread(move || unsafe {
        couch_now_playing_update(json.as_ptr());
    })
    .map_err(|error| error.to_string())
}

pub fn artwork(app: &tauri::AppHandle, id: String, url: String, bytes: Vec<u8>) {
    let (Ok(id), Ok(url)) = (CString::new(id), CString::new(url)) else {
        return;
    };
    let _ = app.run_on_main_thread(move || unsafe {
        couch_now_playing_artwork(id.as_ptr(), url.as_ptr(), bytes.as_ptr(), bytes.len());
    });
}
