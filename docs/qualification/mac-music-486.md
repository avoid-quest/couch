# Mac music behavior, issue #486

Checked on 23 September 2026 with macOS 26.6.2 (25G83), Apple M5 Pro, Bun
1.4.2, Rust 1.98.1, Homebrew mpv 0.41.0_10 and FFmpeg 9.0.2. These are
source-built, headless libmpv checks. They do not establish installed-app audio
output or physical speaker behavior.

The Mac adapter now passes CUE start and end times to libmpv, uses the shared
sample-boundary adjustment for CUE seeks, and reports segment-relative
progress through the existing player contract. It applies the existing
ReplayGain policy before audio starts. Bun remains the queue authority: only
its eligible local or Jellyfin successor can be appended to the current mpv
playlist. A queue edit clears that successor, and a transition that races a
cancel is stopped until Bun chooses a new item. Unsupported or failed
preparation leaves ordinary EOF handling in place.

The Mac plugin tests decoded actual `ao=pcm` output and checked:

- Three bounded/resumed CUE decodes and an ordinary replacement against exact
  FLAC sample ranges, with no adjacent segment samples.
- Off, Track and Album gain against tagged audio; untagged audio at its normal
  level; a positive gain and the existing clipping policy at signed 16-bit
  output.
- A compatible local FLAC pair, a reordered successor and a canceled
  successor against exact concatenated decoded samples.
- A localhost stand-in for Jellyfin's authenticated `/Audio/.../stream`
  endpoint. Normal and four-second delayed pairs retained both decoded tracks
  and sent the private Authorization header. A 503 successor preserved the
  complete first track and reported the failed second open.

The delayed test uses PCM file output, which has no real-time audio clock.
It confirms the slow open and decoded content, but cannot measure an audible
pause. The HTTP stand-in checks the stream/header shape; it does not exercise
an actual Jellyfin server or its playback reporting. CoreAudio capture,
physical audibility and an installed Mac bundle remain later qualification
work. [mpv's `gapless-audio=weak`](https://mpv.io/manual/stable/#options-gapless-audio) keeps compatible formats on the same output
without promising continuity through a slow network open.

`cargo test -p tauri-plugin-video --lib --locked`, `cargo test --lib --locked`
and `bun run check` passed. Four optional network tests skipped. The PR records
the exact committed-revision receipt and test counts.
The native Linux continuity check and exact committed-revision receipt belong
in the PR evidence for this change.
