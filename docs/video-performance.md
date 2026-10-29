# Video performance

Measured on 29 October 2026 against main `73668e36` and the capture API in
`948a03fa`. Playback already uses the native `<video>` decoder and compositor;
there is no JavaScript pixel loop to move onto WebGPU. Live pictures normally
use WebRTC; buffered HLS is a separate compatibility/synchronization path.

## Retained changes

- Screen/window capture accepts independent resolution and **30, 60 or 120 FPS**
  targets. `defaultLiveFrameRate` is 60. Both constraints are applied before
  encoding, and edits during sharing retain the other setting without another
  picker or connection. Concurrent edits serialize; a failed constraint leaves
  the last successful settings intact. Sound-only capture remains at 1 FPS and
  its picture is not transmitted.
- Buffered encoding uses FFmpeg `-fps_mode vfr -enc_time_base demux` to retain
  actual timestamps. Raising `-fpsmax` alone would still duplicate frames when
  MediaRecorder advertises 1000 FPS. A genuine 10 FPS recording with that metadata
  previously produced 30 encoded frames per second; now it produces 10. Genuine
  60/120 FPS recordings previously produced 30; now they preserve 60/120.
- The production renderer, codecs, bitrate selection, UI and GPU startup flags
  are unchanged. The FPS selectors are a separate UI layer, PR #940.

## Environment and limits

Linux x86-64, Xeon E5-2690 v3 (24 logical CPUs), Electron 45.1.0 / Chromium
156.0.8078.49, Xvfb 1920×1080, software composition and decoding. GPU diagnostics
report hardware decode/encode and WebGPU disabled; this does **not** measure
physical GPU performance. The virtual display reports no refresh frequency;
its animation callbacks run at about 60 Hz. It cannot qualify 120 Hz presentation.

The local fixture is a 16-second, moving 1080p60 `testsrc2` H.264 clip, without
sound. The minified production player/router uses deterministic API reads and
250 ms playback-clock updates. Controls receive native pointer movement over the
actual timeline. Live measurements use Electron desktop capture of the isolated
test display (including the source window and receiver), Couch's actual live
session and renderer, and one loopback WebRTC receiver. Signaling is in-memory;
there is no Core, physical capture device, Wi-Fi, TURN or cross-device clock.

CPU percentages sum Electron processes, including the generated source's video
player, publisher and receiver. 100% means one logical CPU; Xvfb is excluded.
Capture-to-display age comes from the browser's video-frame callback timestamps,
not a filmed physical measurement. Video playback quality counts and UI animation
callbacks are reported separately. Callback count alone is not video FPS.

## Repeated results

Three serial runs per condition, each with three seconds of warmup and eight
seconds of observation. Values below are the median across runs; ranges retain
the observed variation. The 30 FPS control uses the original capture constraints
on the new selectable API. An initial run of unmodified main also delivered
29.9 FPS from the original 30 FPS cap.

| Workload | Delivered video FPS, median (range) | Dropped video frames | Total CPU, median |
| --- | --- | --- | --- |
| Native 1080p60 playback | 60.02 (59.94–60.06) | 0% in all runs | 138% |
| Same, timeline hover | 60.09 (60.01–60.09) | 0% in all runs | 177% |
| Live 1080p, target 30 | 29.90 (27.53–30.03) | 0% median; 0–7.92% | 368% |
| Live 1080p, target 60 | 47.23 (46.58–50.46) | 19.02% median; 13.83–19.91% | 520% |
| Live 720p, target 60 | 45.33 (44.36–45.50) | 5.21% median; 3.00–5.93% | 302% |

The 60 FPS target delivers about 58% more frames than the old limit in this
software workload, at about 41% more total CPU. It **does not meet** the sustained
60 FPS gate. Lower resolution reduces CPU but does not reach 60 here either.
Playback and timeline UI p95 frame intervals are 16.7–16.8 ms. The median of
per-run live frame-age medians is 58.4 ms at target 30 and 59.9 ms at target 60;
their per-run p95 ages range from 72.7–97.3 ms and 72.5–79.5 ms respectively.
One short sample cannot establish a latency improvement.

The raw local results are in `.artifacts/video-performance/`: `smoke3`,
`repeat-30`, `repeat-60`, and `vp8-720p60`, each with `result.json`. They include
frame counters, RTC stats before/after, codec implementations, dimensions,
quality-limitation reasons, CPU samples, GPU status and runtime versions.

### Experiments not shipped

Single exploratory samples at the same requested 1080p60:

| Experiment | Delivered FPS | Total CPU | Qualification |
| --- | --- | --- | --- |
| Prefer H.264 | 51.43 | 322% | OpenH264/FFmpeg software path; still 12.31% drops |
| `contentHint = "motion"` | 54.05 | 326% | Encoder reduced the picture to **960×540**; not equivalent quality |
| Remove player UI from the picture | 46.07 | 497% | Still 22.92% drops; does not identify a UI bottleneck |

Artifacts: `h264-60`, `motion-1080p60`, `bare-1080p60`. H.264 is worth comparing
on real hardware, where it may have a hardware encoder, but one software sample
does not justify changing every browser's codec preference. No codec or motion
hint was adopted, and the application does not silently lower the requested
resolution to claim a faster result. WebRTC's own congestion adaptation remains.

## Repeat and validate

Use FFmpeg on PATH, or substitute Couch's downloaded helper. Generate once,
outside the timed samples:

```sh
mkdir -p .artifacts/video-performance/media
ffmpeg -f lavfi -i testsrc2=size=1920x1080:rate=60 -t 16 -an \
  -c:v libx264 -preset ultrafast -crf 23 -pix_fmt yuv420p -g 60 \
  -movflags +faststart -threads 2 .artifacts/video-performance/media/1080p60.mp4
export COUCH_PERF_MEDIA="$PWD/.artifacts/video-performance/media/1080p60.mp4"
bun tests/video-performance.native.ts .artifacts/video-playback \
  --modes=playback,controls --seconds=8 --rounds=3 --assert-fps=55
bun tests/video-performance.native.ts .artifacts/video-live-60 \
  --modes=live --fps=60 --seconds=8 --rounds=3 --assert-fps=55
```

On headless Linux prefix the benchmark command with
`xvfb-run -a -s '-screen 0 1920x1080x24'` and add `--screen`. This selects the test
display rather than a window, which Xvfb without a window manager cannot list.
Do not describe that as a GPU or physical-display test. Use separate evidence
directories for each run. The harness owns an ephemeral port, Electron profile,
`COUCH_DATA_DIR` and `COUCH_PORT`, and kills only its own child on timeout.

`--fps=30|60|120` and `--quality=720p|1080p|original` select capture constraints.
`--codec=h264`, `--hint=motion`, `--bitrate=8000000`, `--jitter=50` and `--bare`
reproduce exploratory probes; `--bitrate` sets only the sender's maximum bits
per second and `--jitter` requests a video jitter-buffer target in milliseconds
where the browser supports it. The [Windows audit](release-audit-2026-10-29.md)
records their measured bandwidth/frame-rate and latency tradeoffs.
They do not change production defaults. `--assert-fps=55` fails below 55 delivered
FPS or above 1% dropped frames (`--max-dropped` overrides the latter). The local
live software measurements correctly fail this gate. Run timing samples without
concurrent builds/tests; keep the source, viewport, codec and encoded dimensions
constant when claiming an improvement.

```sh
bun test tests/live-client.test.ts
bun build tests/live-stream.integration.ts --target=node --outfile=build/live-stream.integration.mjs
COUCH_TEST_FFMPEG=/absolute/path/to/ffmpeg node --test build/live-stream.integration.mjs
xvfb-run -a bun tests/player-performance.native.ts .artifacts/video-ui-checks --checks
```

The buffered regression changes only the WebM `DefaultDuration` metadata to
1000 FPS, retaining the original packets and timestamps. It decodes the actual
HLS output and checks 10/30/60/120 real frames per second, A/V alignment and the
timeline. Existing tests also retain picture-only/audio-only delivery, bounded
HLS storage, channel filtering and encoder cleanup.

Local typecheck, the full Bun unit suite, build, all 12 real-FFmpeg stream
integration tests and five native player regression checks pass. Against the
original `73668e36` stream implementation, the new 10/60/120 FPS tests fail;
the unchanged 30 FPS case passes.

### Pre-merge compatibility experiment

The following records the original branch experiment. Those PRs are now merged;
current-main validation is recorded in the [2026-10-29 audit](release-audit-2026-10-29.md).

The inspected heads were `improve-player` at `2eac7e6e` (#935/#939) and the audio
stack through `sendspin/declared-buffer` at `dbc56104` (#918–#938). The FPS UI
is #940, based on the pipeline PR #941. Presentation remains with its UI owner.

A scratch integration of `dbc56104` and `948a03fa` required resolving conflicts
in `src/client/session/live.ts` and `src/shared/live-input.ts`, retaining the
audio capture/metadata fields alongside the FPS settings. It passes typecheck
and all 44 live-session tests. A five-second smoke sample with the production
player measured 59.98 FPS for playback, 59.95 during timeline hover (both zero
drops), and 46.63 for 1080p60 WebRTC. These are compatibility observations, not
another performance improvement. No open PR was merged or rewritten for this
check. The eventual merged revision still needs its own CI and hardware run.

## GPU and the upcoming Live video mode

1. Keep native `<video>` and WebRTC as the ordinary playback/capture paths.
   Hardware video decoding/encoding and GPU composition are separate from
   WebGPU. Inspect Electron's GPU feature status, CDP Media's decoder name and
   `kIsPlatformVideoDecoder`, and WebRTC's encoder/decoder implementations.
   Browser capability hints alone are not proof of hardware use or throughput.
2. Qualify real macOS, Windows and Linux GPU displays at 1080p60, 1440p60 and
   1080p120, plus representative browser/phone receivers. Compare negotiated
   codecs at the same encoded resolution and image quality, and measure dropped
   frames, CPU, frame age, startup and A/V offset. A 120 FPS source needs a
   120 Hz capture/display chain for a physical 120 FPS claim. Repeat with two
   receivers before deciding whether an SFU is needed; Couch currently encodes
   once per receiver.
3. Add WebGPU when a concrete effect, scaling/compositing job or analysis needs
   programmable frame processing. Prefer `importExternalTexture` for video
   frames, keep frames on the GPU, bound in-flight work, release `VideoFrame`s,
   and retain a feature-detected native fallback. WebGPU is not a codec and
   would not remove the capture cap, hardware-codec availability or network
   constraints measured here. Do not force unsupported GPU startup flags.
4. Live A/V needs capture timestamps and a measured common presentation clock,
   as well as FPS. Direct WebRTC already carries related sound/picture together;
   independently scheduled Sendspin audio and WebRTC picture are not automatically
   synchronized. Do not route an interactive Live video mode through seconds of
   HLS buffering just to reuse relaxed playback. The existing
   [live-input ADR](adr/0001-live-inputs-play-over-webrtc-unless-in-sync.md) and
   [synchronization research](live-sync-research.md) describe that remaining work.

Official references checked: [screen-capture constraints](https://www.w3.org/TR/screen-capture/),
[FFmpeg frame-rate modes and time bases](https://ffmpeg.org/ffmpeg.html#Advanced-options),
[Electron GPU diagnostics](https://www.electronjs.org/docs/latest/api/app#appgetgpufeaturestatus),
[Media Capabilities](https://www.w3.org/TR/media-capabilities/),
[video content hints](https://www.w3.org/TR/mst-content-hint/), and
[WebGPU external textures](https://www.w3.org/TR/webgpu/#external-texture-creation).
The existing unforced Electron window configuration also follows
[t3code](https://github.com/pingdotgg/t3code/blob/main/apps/desktop/src/window/DesktopWindow.ts).
