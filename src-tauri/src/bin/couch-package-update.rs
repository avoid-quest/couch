#[path = "../package_update/mod.rs"]
mod package_update;

fn main() {
    if let Err(error) = package_update::run() {
        eprintln!("Couch package update: {error}");
        std::process::exit(1);
    }
}
