# macOS and Windows support

Assessment for [Support for MacOs and Windows](https://github.com/avoid-quest/couch/issues/171), checked on 2026-09-08 against `d6eb731db859da3013c37cf6225b4da984ff7117`.

Couch can run its compiled coordinator on this Apple Silicon Mac. Native playback remains Linux-only, and Windows has neither a supported build path nor runtime evidence in this repository. Tauri's platform support alone does not establish Couch's support.

## What client and server mean today

The Tauri host always starts its own Bun sidecar, owns the native player, and supplies the sidecar's private host token. The sidecar owns one queue, library, database and paired-controller set. Browser clients control that player. Starting the sidecar alone serves the UI and pairing, but reports playback unavailable. There is no remote-native-player connection mode. See [native host](../../src-tauri/src/lib.rs), [coordinator](../../src/main.ts), [session](../../src/server/session.ts), and [client connection](../../src/client/App.tsx).

The requested client mode needs one product decision before a broad port:

| Interpretation | Playback location | Work beyond platform support |
| --- | --- | --- |
| Each desktop is a media center | The desktop with its own coordinator | Preserve today's local library and browser-remotes model |
| Desktop client is a remote control | The other Couch host | Select and pair to a server, retain ordinary controller authority, and avoid starting an unused local player |
| Desktop client consumes a headless Couch server | The desktop client | Define authenticated media delivery, source ownership, per-player queues/progress and server lifecycle |

The third interpretation cannot use server filesystem paths as client media paths. Existing `file:` sources and native commands belong to the machine running the coordinator and player. A headless server cannot become a playable media server merely by hiding the native window.

## Platform gaps

- [The build script](../../scripts/build.ts) recognizes Linux and macOS x64/arm64 and rejects Windows. Windows needs its MSVC target triple and correctly named `.exe` sidecar. [Media-tool setup](../../scripts/setup-media.ts) also lacks Windows targets, executable suffixes, extraction and application-data paths.
- [The player](../../src-tauri/src/player.rs) has a Linux implementation and explicit unavailable behavior elsewhere. [Cargo](../../src-tauri/Cargo.toml) only enables the video plugin on Linux. Removing those guards would not provide another renderer.
- The vendored mpv renderer uses GTK, `GtkGLArea` and GLX. Upstream's [platform table](https://github.com/get-air/tauri-video-plugin#platform-support) supports Windows through GStreamer and explicitly excludes macOS. Windows integration is not an interchangeable version of Couch's existing mpv backend. Preserve and qualify Couch's replay gain, CUE segments, subtitles, stream headers and live playback before adopting another engine.
- [Packaging](../../scripts/package-prepare.ts) accepts Ubuntu x64 only. Default Tauri bundle targets are Debian and AppImage. [App updates](../../src-tauri/src/appimage_update.rs), [startup](../../src/server/startup.ts) and [sound](../../src/server/sound.ts) use Ubuntu services. AppImage trust, systemd restart and LightDM autologin are not desktop-platform adapters.
- [Media folders](../../src/server/media-folders.ts) already have a non-Linux device/inode fallback, but default locations and mount handling need native acceptance. macOS media commonly lives under `Movies` and `/Volumes`; Windows needs drive and UNC handling. Existing Linux mount-replacement protections must survive a port.

## Supported building blocks

[Tauri's prerequisites](https://v2.tauri.app/start/prerequisites/) allow Command Line Tools for macOS desktop development. Windows needs Microsoft C++ Build Tools, an MSVC Rust toolchain and WebView2. [Tauri sidecars](https://v2.tauri.app/develop/sidecar/) use target-suffixed filenames, with `.exe` on Windows. Its [updater](https://v2.tauri.app/plugin/updater/) supports desktop platforms, but Couch's enrollment, quiesce, install and restart policy must be adapted separately.

[Bun's executable documentation](https://bun.sh/docs/bundler/executables) supports macOS and Windows on x64 and arm64. Bun adds `.exe` for Windows output. Building a Windows executable on another OS proves packaging only; it cannot prove runtime behavior. Signed macOS delivery also needs a deliberate Bun-sidecar entitlement and signing configuration.

Keeping mpv avoids changing media semantics, but still requires native view integration. The [mpv examples](https://github.com/mpv-player/mpv-examples/tree/master/libmpv) include Cocoa and Cocoa OpenGL examples and describe native-window and render-API embedding. The [render API](https://github.com/mpv-player/mpv/blob/master/include/mpv/render.h) supplies the rendering contract, not a ready Tauri macOS implementation. The [mpv installation page](https://mpv.io/installation/) lists both platforms and distinguishes third-party packages from first-party testing builds. Choose and pin release dependencies before claiming distributable playback support.

## Concrete first increment and evidence

The first offline native check failed because [diagnostics](../../src-tauri/src/diagnostics.rs) imported the Linux-only video plugin unconditionally. The accompanying fix scopes mpv diagnostics to Linux. Other platforms retain native window, display and host diagnostics. The existing player status continues to report playback unavailable. This restores compilation without inventing a media backend.

This session used the installed Apple Silicon Rust target and Command Line Tools, with no package installation, CI dispatch or TV changes. Existing project dependencies were reused read-only. Validation:

- `bun run build` passed with Bun 1.4.2 and produced `couch-server-aarch64-apple-darwin`.
- The actual compiled coordinator ran twice against a disposable database on loopback. Frontend serving, health, pairing, authenticated build access, clean SIGTERM shutdown, and retained pairing after restart passed. Health correctly reported `player: unavailable`.
- `cargo check --manifest-path src-tauri/Cargo.toml --locked --offline -j 2` failed before the diagnostics fix with unresolved `tauri_plugin_video` and missing `AppHandle::video`, then passed after it. Cargo used a separate target directory. An existing non-Linux dead-code warning for `PlaybackSegment::relative` remains.

No GUI launch, audible/video playback, signed macOS package, Windows build or Windows runtime was tested. No mpv or ffmpeg executable was found in the inspected Mac tool paths. This evidence leaves the parent issue open.

Once client mode is decided, the next bounded increment should prove one real local media file with pause, seek, resize/fullscreen and audio on macOS, using the chosen native engine. Windows needs a real Windows environment for the equivalent acceptance. Platform packaging, helpers and OS settings then need their own installation and restart evidence. Headless media delivery is a separate dependency when the selected client mode requires it.
