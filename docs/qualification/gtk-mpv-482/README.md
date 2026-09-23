# Linux mpv render-thread qualification

The compiled Couch app at `6da32a77aecba078b0e661f0fc03fcaa7f9a67e4` passed `TAURI_VIDEO_TELEMETRY=1 bun run test:linux --mpv-threading` on Ubuntu 24.04 ARM64 under Docker, Xvfb and a PulseAudio null sink. The run built the Tauri app and Bun sidecar from that immutable revision. The ordinary Bun checks, Rust native tests and paired-controller smoke also passed.

The paired controller played a generated 640 x 360 video, sought three times, collected diagnostics while playback advanced, replaced it with a second queue entry, then stopped. A stale seek after Stop did not revive the retired playback. The queue remained stopped across app restart. The two X11 captures show [initial video pixels](initial-video.png) and [replacement video pixels](replacement-video.png) inside the GtkGLArea with Couch controls visible after replacement.

| Operation | Paired-controller acknowledgement |
| --- | ---: |
| Seek to 4, 8 and 2 seconds | 0.39, 0.30 and 0.37 ms |
| Replacement Play | 3.38 ms |
| Stop | 3.43 ms |
| Diagnostics export HTTP request | 436.95 ms |

The [machine-readable receipt](receipt.json) records each sample. Render telemetry rose from 3 to 57 presented frames, reached 25.71 measured FPS and reported zero dropped frames. With libmpv warning events subscribed and the native log truncated before launch, no `mpv_render_context_render() not being called or stuck` message appeared. The pixel assertions passed for both captures.

This is actual GtkGLArea/libmpv playback with software rendering. It does not establish physical TV, speaker, Wayland or hardware-decoder behavior.
