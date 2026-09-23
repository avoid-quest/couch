fn main() {
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
