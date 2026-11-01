# Player performance checks

How to measure player and navigation smoothness. These are controlled
workloads, not whole-app or physical-device speed claims; narrow windows
exercise the phone layout, not phone hardware.

## Run the harness

[`tests/player-performance.native.ts`](../tests/player-performance.native.ts)
builds its own Electron run on an ephemeral loopback port and data directory and
exits its own process, so it never touches an installed Couch. Run timing samples
serially, without another build or test competing for the CPU.

```sh
COUCH_PERF_WIDTH=1512 COUCH_PERF_HEIGHT=982 bun tests/player-performance.native.ts .artifacts/player-performance --rounds=40 --assert-budget=60
bun tests/player-performance.native.ts .artifacts/player-checks --checks
COUCH_PERF_WIDTH=390 COUCH_PERF_HEIGHT=844 bun tests/player-performance.native.ts .artifacts/player-checks-phone --checks
COUCH_PERF_REDUCED_MOTION=1 bun tests/player-performance.native.ts .artifacts/player-checks-reduced --checks
```

- A timing run writes raw frame/transition samples, the display frequency, GPU
  feature status and runtime versions to `result.json`. `--trace` adds an
  Electron/Chromium `trace.json`.
- `--assert-budget=60` checks cold and repeated navigation against 16.67 ms plus
  1 ms of scheduling jitter; `--assert-budget=120` uses 12.5 ms to detect a
  missed 120 Hz interval. rAF samples measure scheduling cadence, not GPU
  presentation. The measured Mac runs on 23 October 2026 failed the strict
  120 Hz budget; it is not an established passing gate.
- Clock updates arrive every 250 ms by default; `--clock-ms=0` disables them.
- `--shell-navigation` visits Saved, Settings and Remote from Home and back
  through the real navigation links instead of the player.
- `--checks` uses React's profiling build for commit assertions and runs the
  artwork, clock isolation, player transitions, Remote navigation, footer
  clearance, player status, pointer-leave auto-hide and seek-preview regressions.
  Timing runs use the ordinary minified build.

## Add continuous audio

Set `COUCH_PERF_AUDIO` to a local MP3 to include silent decoding during the run;
the report checks only the final audio state: unpaused, `readyState >= 3` and
nonzero `currentTime`. It does not sample playback position during the run.

```sh
ffmpeg -f lavfi -i sine=frequency=440:sample_rate=48000 -t 16 -ac 2 -codec:a libmp3lame .artifacts/benchmark.mp3
COUCH_PERF_AUDIO=.artifacts/benchmark.mp3 COUCH_PERF_WIDTH=1512 COUCH_PERF_HEIGHT=982 bun tests/player-performance.native.ts .artifacts/player-audio --rounds=40 --assert-budget=60
```

## Seek bar

`--seek` drives playback, hover and native mouse drags (three rounds by default).
`--profile` measures React render cost separately; don't use profiling numbers as
release-build frame timing.

```sh
COUCH_PERF_AUDIO=.artifacts/benchmark.mp3 COUCH_PERF_WIDTH=1512 COUCH_PERF_HEIGHT=982 bun tests/player-performance.native.ts .artifacts/seek-performance --seek --rounds=3 --assert-budget=60
COUCH_PERF_AUDIO=.artifacts/benchmark.mp3 COUCH_PERF_WIDTH=1512 COUCH_PERF_HEIGHT=982 bun tests/player-performance.native.ts .artifacts/seek-profile --seek --rounds=3 --profile
```

## Behaviour regressions

`tests/artwork-route.test.ts`, `tests/search-navigation.browser.tsx`,
`tests/collection-rendering.browser.ts` and `tests/web-intake.integration.ts`
protect shared artwork downloads, stable outgoing search state, collection
freshness and extraction reuse. They don't assert timing thresholds.

## Other harnesses

Each harness documents its commands in its opening comments.

- Media startup, resolved media to first frame, no external traffic:
  `xvfb-run -a bun tests/media-startup.native.ts .artifacts/media-startup/run --rounds=3`
  (set `COUCH_TEST_FFMPEG` to an FFmpeg binary when needed).
  On 1 November 2026 (Linux Xeon E5-2690 v3, Electron 45.1.0, 1920×1080 60 Hz
  HDMI display on an RTX 3060 with GPU compositing), a fresh page asked for the
  HLS playlist 36–64 ms after the load because hls.js was still loading and
  evaluating. The Couch app now loads it while idle. Measured with a scratch copy
  of the harness that sets `window.couchApp = {}` before the module script and
  waits 1 s at the start of each sample, as a running app would have, with
  `--rounds=3 --delay=200`. Three alternating runs each against main `0b860fe5`:
  the playlist request median went from 64 to 10 ms and the HLS first frame
  from 561 / 581 / 627 ms (median / p95 / max of 9) to 500 / 562 / 568 ms. MP4
  and split controls stayed within noise. On an Apple M5 Pro (macOS 26.7), the
  same comparison moved the playlist request from 10.5 to 1.7 ms and the HLS
  first frame from 447 / 482 / 482 to 438 / 464 / 464 ms; MP4 went from 227 to
  230 ms and split from 228 to 226 ms (medians). Browsers, such as phones joined
  as remotes, skip the idle preload: their service worker may precache the
  578 KB chunk, but they still load and evaluate it on their first HLS start.
- Video playback and capture rates:
  `COUCH_PERF_MEDIA=<absolute path to a 1080p60 file> bun tests/video-performance.native.ts .artifacts/video --modes=playback,controls,live --fps=60`.
  Use a real display to qualify hardware; `xvfb-run` measures software
  playback and capture only.
- Website resolution: [media-resolution.performance.ts](../tests/media-resolution.performance.ts).
- Compressor cost: [compressor-ffmpeg.performance.ts](../tests/compressor-ffmpeg.performance.ts)
  and [compressor.native.ts](../tests/compressor.native.ts).
