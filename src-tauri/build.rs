fn main() {
    println!("cargo:rerun-if-changed=build-info.json");
    if let Ok(identity) = std::fs::read_to_string("build-info.json") {
        println!("cargo:rustc-env=COUCH_BUILD_INFO={}", identity.trim());
    }
    tauri_build::build()
}
