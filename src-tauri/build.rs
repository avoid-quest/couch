fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new().file("src/sound.m").flag("-fobjc-arc").compile("couch_sound");
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
            "retry_playback_device",
            "complete_local_setup",
            "local_update_activity",
            "desktop_interface_size",
        ]),
    ))
    .expect("Cannot generate native command permissions");
}
