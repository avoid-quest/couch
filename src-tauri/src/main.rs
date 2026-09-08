#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Set before GTK or Tokio starts threads. PipeWire must not rescue a lost
    // Couch stream onto speakers while the sidecar reports the loss.
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("PULSE_PROP_node.dont-fallback", "true");
        std::env::set_var("PULSE_PROP_node.dont-reconnect", "true");
    }
    couch::run();
}
