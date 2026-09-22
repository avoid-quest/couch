# GTK and libmpv rendering

Issue [#421](https://github.com/avoid-quest/couch/issues/421) asks whether GTK needs different mpv calls. This review covers source revision `423221134cd66606cbc0c69133f547780b4cef06`.

## Answer

No GTK-specific mpv command change is warranted. Couch should retain `vo=libmpv`, an OpenGL `mpv_render_context`, and a `GtkGLArea`. Replacing that with `wid` would make the Linux path X11-specific and would not fix the threading contract.

Couch does not currently meet that contract. Its GTK main thread is the render thread, and it also makes normal synchronous libmpv control and property calls there. The pinned header prohibits that arrangement, including a render-thread wait dependency on another thread making normal libmpv calls. Leaving `MPV_RENDER_PARAM_ADVANCED_CONTROL` unset makes violations non-fatal through mpv timeouts. It does not make the calls safe or compliant.

## Contract and implementation

The pinned [mpv 0.37.0 render header](https://github.com/mpv-player/mpv/blob/v0.37.0/libmpv/render.h#L51-L92) and the current [public render header](https://github.com/mpv-player/mpv/blob/master/include/mpv/render.h) prescribe a single render thread, a current and unchanged OpenGL context for render API calls, an update callback that does not call mpv, no non-safe normal libmpv calls or wait dependencies on the render thread, and destruction of the render context before its mpv handle. The current header also recommends the render API over native window embedding for GUI toolkits.

Couch follows the lifecycle and OpenGL parts of that model in [`desktop.rs`](../../src-tauri/vendor/tauri-plugin-video/src/desktop.rs): it creates and realizes a `GtkGLArea`, makes its context current before creating the render context, sends the update callback through a one-item GLib channel, calls `update()` on the GTK thread with the context current, and renders the GTK framebuffer from `connect_render`. Drop removes the callbacks, makes the context current, then drops the render context before the mpv handle. The vendored `libmpv2` binding exposes each required operation: `RenderContext::new`, `set_update_callback`, `update`, `render`, `report_swap`, and `Drop`.

GTK 3 documents that `GtkGLArea` makes its GL context current during its `render` signal and manages the framebuffer used for its texture. See [GtkGLArea](https://docs.gtk.org/gtk3/class.GLArea.html) and its [render signal](https://docs.gtk.org/gtk3/signal.GLArea.render.html). This is the rendering arrangement Couch uses, not native-window embedding.

`wid` is the alternative mpv setup, not an extra rendering command. mpv documents it as an X11 window on Linux. GTK's current X11 surface accessor is deprecated for new code, and GTK 4 removed portable native/foreign subwindow support. See mpv's [`wid` option](https://mpv.io/manual/master/#options-wid), GTK's [X11 surface accessor](https://docs.gtk.org/gdk4-x11/method.X11Surface.get_xid.html), and the [GTK 3 to 4 migration guide](https://docs.gtk.org/gtk4/migrating-3to4.html#adapt-to-gdkwindow-api-changes). `wid` is therefore not a first-class Wayland-compatible replacement.

## Synchronous work in the GTK thread

All Linux native requests are dispatched through the GTK main context. `load_source` synchronously stops and replaces the source. `control` synchronously performs stop-adjacent work, seek and property writes, then takes a snapshot. `stats`, diagnostic reads and snapshots synchronously read mpv properties. Event draining uses `wait_event(0.0)` and has a 64-event bound, so it does not wait for an event but can consume GTK time under a hot event stream.

None of these calls occur inside the mpv update callback. The callback only tries to enqueue a redraw, which meets that narrower rule. They still share the GTK render thread with `update()` and `render()`, which violates the separate render-thread rule. mpv documents the consequence as a possible deadlock, degraded playback after its timeout, and a `mpv_render_context_render() not being called or stuck` log. This review found documented risk, not a measured incident.

## Measurement status

The retained Linux journey already exercises actual Tauri/libmpv playback under Xvfb with a GtkGLArea. It covers seek, Stop, replacement after a failed source, video-pixel capture, paused-video pixels, and Stop returning to the WebView. The test also records software-rendering limits in `tests/linux/playback.ts`.

I started `bun run test:linux` on 22 September 2026 from the reviewed revision. Docker was available and began building the Ubuntu 24.04 ARM64 image, including GTK, WebKit and libmpv dependencies. The run did not reach the test container before the command window ended, so it provides no pass or failure result and no responsiveness measurement. No physical display, hardware decode, speaker, Wayland, or real-TV claim follows from this attempt.

The next measurement should run that existing journey to completion with `TAURI_VIDEO_TELEMETRY=1`, while issuing repeated seek, Stop, source replacement and diagnostics during a visible fixture. Record command latency, `presented_frames`, measured FPS, native-pixel captures, and the documented stuck-render log. The result distinguishes the documented violation from a reproduced incident and bounds the thread-separation change.

## Recommendation

Keep the GtkGLArea/libmpv render API integration, but do not endorse synchronous normal libmpv calls on its render thread. Do not add `wid` or `ADVANCED_CONTROL`. Complete the retained measurement, then scope the smallest supported separation of normal libmpv control from rendering; no binding replacement or new framework is justified.
