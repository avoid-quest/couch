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
  uses Homebrew's stable `opt/mpv` prefix for Apple Silicon or Intel and accepts
  an explicit `COUCH_MPV_PREFIX` for another installation. Record the resolved
  dylib version and hash when using another installation.
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

After the EOF/replay review fix, the rebuilt development app showed distinct
native frames from a 120-second, 1280×720 H.264/AAC test clip at 0:33 and 1:31.
The frame timestamp and playback position advanced. A burst of 24 pause, seek and
resume commands through the paired controller returned 24 successful replies;
the player remained `playing` without an error at the final seek position and
continued showing new frames. The check ran at 0% volume; Stop returned the
app to idle and the previous 99% volume was restored. A focused mpv fixture
test covers EOF followed by seek and play in the same native session.

### Fresh development-app replay at code commit `2c9e3372`

On 23 September, the rebuilt isolated `Couch Native 483` development app played
the 120-second H.264/AAC local clip again. Its position advanced while moving
native pixels appeared below Couch. The live Advanced diagnostics reported
`libmpv` video output, `videotoolbox` decoding, `coreaudio` audio output and
audio device selection `auto`. This establishes the selected mpv audio driver,
not the physical device or audibility.

Pausing held the displayed frame. The playback settings dialog appeared above
the picture, and Escape returned to Now. A native window zoom changed the app
from its large monitor-sized window to a smaller window; the moving picture
remained within the stage. The Window menu's Minimize and Couch reopen actions
left playback progressing from about 1:24 to 1:49, with current pixels visible
on reopen. A replacement command changed the paused 120-second clip to the
25-second local clip; its position advanced to 0:14 before Stop returned Couch
to Nothing playing and removed the video view. No separate mpv helper process
was present. Finally, confirming Quit during an active local clip removed both
the isolated Couch host and its Bun coordinator process.

The queued live radio entry attempted to start after the 120-second clip reached
EOF and reported the documented unsupported single-source Mac player path.
That source-specific behavior remains follow-up work. Installed Full physical
audibility and bundled Mac dependency checks remain unverified.

## Checks

- `bun run check`: passed, 1,247 tests passed and four optional network tests
  skipped (1,244 core plus three real-clock tests).
- `cargo test -p tauri-plugin-video --lib --locked`: six tests passed.
- A local Cargo build with the sidecar excluded and an isolated bundle ID passed.

Source-specific media behavior, Mac dependency bundling and installed sound
acceptance remain separate work from this local-player adapter.
