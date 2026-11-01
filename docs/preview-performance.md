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

### Chapter cues outside the slider (1 November 2026)

Video.js writes `--media-slider-fill` and `--media-slider-pointer` on the slider
root at every pointer move, and a custom property change restyles that element's
whole subtree. The seek fixture's 59 chapter cues lived inside it. Timed in the
player page with style forced by a layout read, one write cost 0.58–1.6 ms with
the cues and 0.13–0.15 ms without them; an ordinary inline property cost 0.04 ms.
Those per-write figures are a one-off diagnostic, not a harness output; the
`--seek` runs below are the reproducible measurement. The cues now sit over the
track beside the slider, at the same positions.

`--seek --rounds=3` without audio, three alternating runs each against main
`0b860fe5`, Linux Xeon E5-2690 v3, Electron 45.1.0 / Chromium 156, a 1920×1080
60 Hz HDMI display on an RTX 3060 (nouveau/Mesa, GPU compositing) under Cage.
CPU is sampled from `/proc` over the 34 s run; 100% is one logical CPU. CPU cells
list the three runs; frame p95 and max were the same or within the shown range
in every run.

| | Renderer main thread | Whole renderer | Frame p95 / max |
| --- | --- | --- | --- |
| main | 47.3 / 47.5 / 47.8% | 58.7 / 58.8 / 59.7% | 16.7 / 16.8 ms |
| cues outside the slider | 22.6 / 22.8 / 23.8% | 33.6 / 34.1 / 34.5% | 16.7–16.8 / 16.8 ms |

Frame timing already met 60 Hz on this machine, so the gain is CPU, which slower
machines may show as smoothness. Media without chapters is unaffected. Main's
runs reported the fixture's "drag preview ended at 759.5, expected about 765"
two or three times each; the change's runs one, one and zero times.

On an Apple M5 Pro (macOS 26.7, 120 Hz built-in display), with the whole renderer
process sampled by `ps` and averaged over each run, the 59-cue fixture went from
21.9–22.3% to 16.2–16.6% of a core, 10 cues from 17.1–17.8% to 15.8–16.1%, and no
cues stayed at 15.6–15.9% vs 16.0–16.1%. Frame p95 / max stayed 9.7–9.9 / 10.4 ms
on both, with no drag preview errors.

Couch doesn't deliver chapters to players yet: no source sets them and Core's
`parsePlayer` drops them from renderer reports. Until chapters are wired through,
the cues, and this saving, appear only in the fixture.

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
- Video playback and capture rates:
  `COUCH_PERF_MEDIA=<absolute path to a 1080p60 file> bun tests/video-performance.native.ts .artifacts/video --modes=playback,controls,live --fps=60`.
  Use a real display to qualify hardware; `xvfb-run` measures software
  playback and capture only.
- Website resolution: [media-resolution.performance.ts](../tests/media-resolution.performance.ts).
- Compressor cost: [compressor-ffmpeg.performance.ts](../tests/compressor-ffmpeg.performance.ts)
  and [compressor.native.ts](../tests/compressor.native.ts).
