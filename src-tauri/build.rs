fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new().file("src/sound.m").flag("-fobjc-arc").compile("couch_sound");
        cc::Build::new().file("src/now_playing.m").flag("-fobjc-arc").compile("couch_now_playing");
        cc::Build::new().file("src/native_window_title.m").flag("-fobjc-arc").compile("couch_window_title");
        cc::Build::new().file("src/native_cursor.m").flag("-fobjc-arc").compile("couch_cursor");
        println!("cargo:rerun-if-changed=src/native_cursor.m");
        println!("cargo:rustc-link-lib=framework=MediaPlayer");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rerun-if-changed=src/now_playing.m");
        println!("cargo:rerun-if-changed=src/native_window_title.m");
        println!("cargo:rustc-link-lib=framework=CoreAudio");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rerun-if-changed=src/sound.m");
    }
    println!("cargo:rerun-if-changed=build-info.json");
    if let Ok(identity) = std::fs::read_to_string("build-info.json") {
        println!("cargo:rustc-env=COUCH_BUILD_INFO={}", identity.trim());
    }
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "connection_info",
            "set_video_rect",
            "choose_media",
            "choose_folder",
            "save_metadata_export",
            "save_diagnostics_export",
            "playback_device",
            "select_playback_device",
            "forget_playback_device",
            "retry_playback_device",
            "complete_local_setup",
            "local_update_activity",
            "desktop_interface_size",
            "set_now_playing",
            "set_native_window_title",
            "set_native_cursor_visible",
        ]),
    ))
    .expect("Cannot generate native command permissions");
}
