# Linux mpv render-thread qualification

The compiled Couch app at `62b136876d0fdcf10709a1761ed4a4637de8758f` passed `TAURI_VIDEO_TELEMETRY=1 bun run test:linux --mpv-threading` on Ubuntu 24.04 ARM64 under Docker, Xvfb and a PulseAudio null sink. The run built the Tauri app and Bun sidecar from that immutable revision. The ordinary Bun checks, Rust native tests and paired-controller smoke also passed.

The paired controller played a generated 640 x 360 video, sought three times, collected diagnostics while playback advanced, replaced it with a second queue entry, then stopped. A stale seek after Stop did not revive the retired playback. The queue remained stopped across app restart. The two X11 captures show [initial video pixels](initial-video.png) and [replacement video pixels](replacement-video.png) inside the GtkGLArea with Couch controls visible after replacement.

| Operation | Controller acknowledgement | Observed playback state |
| --- | ---: | ---: |
| Seek to 4, 8 and 2 seconds | 0.33, 0.31 and 0.31 ms | 51.27, 51.02 and 54.12 ms |
| Replacement Play | 3.80 ms | 2,108.82 ms |
| Stop | 3.20 ms | 55.48 ms |
| Diagnostics export HTTP request | 423.56 ms | n/a |

Acknowledgement times measure WebSocket command replies. Observed times include the next state update; replacement also includes media startup. Diagnostics measures completion of the HTTP export request.

The [machine-readable receipt](receipt.json) records each sample. Render telemetry rose from 3 to 62 presented frames, reached 25.22 measured FPS and reported zero dropped frames. With libmpv warning events subscribed and the native log truncated before launch, no `mpv_render_context_render() not being called or stuck` message appeared. The pixel assertions passed for both captures.

This is actual GtkGLArea/libmpv playback with software rendering. It does not establish physical TV, speaker, Wayland or hardware-decoder behavior.
