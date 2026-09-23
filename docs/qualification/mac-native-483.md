# Mac native playback, issue #483

Checked 23 September 2026 on an Apple M5 Pro, macOS 26.6.2 (25G83), arm64.
This is a development runtime check of ordinary local media, not an installed
Full or signed distribution check.

## Native build inputs

- Rust 1.98.1, Bun 1.4.2, Command Line Tools SDK 27.0; full Xcode was not
  installed. `libmpv2` 5.0.3 and `libmpv2-sys` 4.0.1 are locked by Cargo.
- Homebrew `mpv` 0.41.0_10 supplied the headers and libmpv 2 dylib at
  `/opt/homebrew/Cellar/mpv/0.41.0_10`. The dylib SHA-256 was
  `d7871516767687dd7e5fb454ccd530f28d04238111ad4925c155e2c87ceceb1b`.
  Its linked FFmpeg libraries came from Homebrew FFmpeg 9.0.2. The build script
  defaults to that versioned keg and accepts an explicit `COUCH_MPV_PREFIX` for
  another installation. Record the override and dylib hash when using one.
- The host links AppKit, QuartzCore and OpenGL. The view uses AppKit's
  [display link](https://developer.apple.com/documentation/appkit/nsview/displaylink%28target%3Aselector%3A%29)
  to schedule mpv's OpenGL render API on the main thread. Apple introduced this
  view display link in macOS 14, so the bundle declares macOS 14.0 as its
  [minimum version](https://v2.tauri.app/distribute/macos-application-bundle/#minimum-system-version).
- The development executable links Homebrew's libmpv path. A distributable Mac
  bundle still needs its own dependency inclusion, signing and installed check.

## Runtime observations

The isolated test app used its own bundle ID and data directory, leaving other
Couch installations untouched. The generated H.264/AAC local clips were 25 and
120 seconds, with a moving video pattern and 440 Hz audio track. The host
reported video and audio tracks, duration and advancing position. Screenshots
showed moving native pixels beneath Couch controls; pause retained the frame,
exact seek landed at 40 seconds, and volume read back at 30%. Stop removed the
native view and returned the player to idle. Opening a second clip replaced the
first playback ID and duration. Playback continued while minimized; reopening
showed current pixels and position. Quit during active playback removed both
the isolated host and its Bun sidecar. The Couch settings dialog and keyboard
Escape worked over a paused video; resizing and zooming kept the settled video
frame within its stage.

The private native diagnostics now expose mpv's `current-ao`, `current-vo` and
`hwdec-current` for an active session. The selected audio track and generated tone
do not establish physical audibility; output routing still
require the installed Full check.

## Checks

- `bun run check`: passed, 1,247 tests passed and four optional network tests
  skipped (1,244 core plus three real-clock tests).
- `cargo test -p tauri-plugin-video --lib --locked`: three tests passed.
- A local Cargo build with the sidecar excluded and an isolated bundle ID passed.

Source-specific media behavior, Mac dependency bundling and installed sound
acceptance remain separate work from this local-player adapter.
