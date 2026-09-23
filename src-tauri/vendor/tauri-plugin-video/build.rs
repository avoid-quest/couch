const COMMANDS: &[&str] = &[
    "native_diagnostics",
    "native_open",
    "native_control",
    "native_layout",
    "native_stats",
    "native_close",
];

fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let prefix = std::env::var("COUCH_MPV_PREFIX").unwrap_or_else(|_| "/opt/homebrew/Cellar/mpv/0.41.0_10".into());
        let header = std::path::Path::new(&prefix).join("include/mpv/render.h");
        let library = std::path::Path::new(&prefix).join("lib/libmpv.dylib");
        assert!(header.is_file() && library.is_file(), "libmpv headers and dylib required at {prefix}; set COUCH_MPV_PREFIX");
        cc::Build::new()
            .file("src/desktop/macos.m")
            .include(format!("{prefix}/include"))
            .flag("-fobjc-arc")
            .flag("-Wno-deprecated-declarations")
            .compile("couch_mpv_view");
        println!("cargo:rustc-link-search=native={prefix}/lib");
        println!("cargo:warning=Mac libmpv from {}", library.display());
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=OpenGL");
        println!("cargo:rustc-link-lib=framework=QuartzCore");
        println!("cargo:rerun-if-env-changed=COUCH_MPV_PREFIX");
        println!("cargo:rerun-if-changed={}", header.display());
        println!("cargo:rerun-if-changed={}", library.display());
        println!("cargo:rerun-if-changed=src/desktop/macos.m");
    }
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
