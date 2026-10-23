# Master compressor verification and performance

Implemented in the `master-compressor/playback` → `master-compressor/direct`
stack, based on `3e603a5`, on
2026-10-23. These are development measurements of the working tree, not a
release certification or a measurement of the studio ThinkPad T480.

## Behavior verified

- Real Chromium `OfflineAudioContext` renders through the production graph:
  a 20:1 input amplitude contrast becomes 8.267:1 with the defaults; stereo
  balance remains 2:1; listener volume and output gain scale the result
  independently. Bypass reproduces the input after 288 samples (6 ms at
  48 kHz), with maximum absolute error below `3e-8`. Silence stays silent
  and extreme permitted settings produce finite samples.
- The actual Electron renderer starts without a graph when off, processes
  combined and split audio, keeps device gain after compression, suspends
  local processing while following Sendspin, and resumes in Direct. Replacing
  the graph preserves the picture's DOM position and gives subsequent WebRTC
  fresh media elements. Buffered Live Share never creates the graph.
- The real mixer at desktop and 360 px widths batches advanced edits, refuses
  invalid values, resets drafts, and supports remote slider/navigation keys.
  The fixture also runs with TV presentation enabled.
- Hub/WebSocket/database tests preserve Direct delivery, pause, position and
  device volume; carry settings through In sync → Direct; retry after disabling
  a failed compressor; persist per Playback; migrate older queues; reject
  corrupt settings, stale item IDs and unauthorized/live-sharing commands.
- Real FFmpeg 9.0.2 and Sendspin clients receive compressed PCM and Opus from
  one graph. The loud test tone's PCM RMS falls from 0.5657 to 0.1715, stereo
  balance is preserved, and timestamps remain contiguous within each wire.
  Late receivers receive identical samples regardless of their device volume.
  Paused edits apply on resume; disabling restores the original RMS; a live
  publication remains unprocessed even if its load includes an enabled setting.
- Relay tests cover CORS, inconclusive probes, same-origin audio, and every
  segment/key of a compressed HLS playlist. HLS engine regressions include
  settings arriving during a decoder import. mpv filter arguments and IPC
  changes/rejections are checked with mocked process/IPC boundaries.

Typecheck and production build pass, along with the targeted unit and integration
regressions (mixer, public media relay, live input, device volume, sound session,
and Sendspin scheduling). A real mpv installation and Safari/native HLS have
not been exercised here. Physical A/V offset, audible transition artifacts,
network relay overhead and long-run stability still require hardware trials.

## Resource lifecycle iteration

The initial implementation kept processing while paused and kept both audio
branches connected while bypassed. A real-renderer check reproduced both:
`Unnecessary audio work: paused context=running; bypass compressor connected=true`.
The revised renderer suspends the context on pause/end and handles a resume
arriving before suspension completes. The graph connects only the selected
branch at startup. On a toggle it primes the incoming path for 10 ms,
crossfades for 40 ms, then disconnects the inactive branch. The dry path retains
the same 6 ms alignment; no larger output buffer or latency hint was added.

Before/after runs used the same Xeon/Electron environment described below,
serially without competing tests or builds. Each used three alternating-order
rounds, with 5 seconds of warmup and 20 seconds of sampling per case (60 sampled
seconds per case in each version). CPU is **percent of one logical core**.

| Audio-only case | Before mean CPU | After mean CPU | After p95 CPU |
|---|---:|---:|---:|
| Native, no graph | 4.835% | 4.753% | 5.986% |
| Compression enabled | 7.262% | 7.097% | 8.980% |
| Graph bypassed | 7.029% | 5.634% | 7.977% |
| Native, paused | 3.273% | 3.490% | 5.974% |
| Compressed, paused | 5.915% | 3.407% | 4.989% |

- Bypass overhead against its own native baseline falls from **2.194 to 0.881
  percentage points**, about **60% less**. The remaining media-element Web Audio
  route has a cost even with the compressor disconnected. The next load with
  compression off restores the native path.
- Pause overhead falls from **2.642 points to no measurable extra cost**.
  The small negative difference after the change is noise. The suspended
  context's reported audio duration no longer advances during the sample.
- Enabled overhead is **2.344 points**, versus 2.427 before. This is not a
  convincing active-playback speedup; the work saved is during bypass/pause.
  Enabled-minus-native deltas after the change were 2.94, 1.70 and 2.39 points
  by round, so the mean is not a precise hardware budget.

Chromium's `AudioContext.playbackStats` reports zero underrun events during all
enabled/bypass samples after the change. These counters describe software
playout, not the physical output; native playback has no AudioContext counter.
The native resource check now passes pause, resume races, initial paused load,
rapid toggles and compressor disconnection. A realtime oscillator test through
the actual graph, including disconnect/reconnect, records a peak of 0.34983,
maximum adjacent-sample change of 0.04561 and minimum 1 ms RMS of 0.14121 for a
0.2-amplitude input: no gap or spike in that signal. Offline rapid-toggle checks
also exercise the fallback for Firefox's missing `cancelAndHoldAtTime`.
These deterministic checks do not replace listening trials with programme audio.

Evidence: `.artifacts/compressor-perf-iteration/{before,after,checks}/result.json`.
The before source snapshots are in that directory's `baseline/`. The fixture
retains references for its lifecycle assertions, so these runs cannot establish
memory savings or absence of leaks.
Final typecheck, production build and 23 targeted unit/renderer/relay regressions
pass. The final Electron signal, resource lifecycle, mixer and TV navigation
checks pass at desktop and mobile widths; evidence is in
`.artifacts/compressor-perf-iteration/final-checks/result.json`.

## Continuous movie comparison

A first extended fixture repeated a 12-second MP4 with stream-copy looping.
It had an irregular frame timestamp at the seam: 11.966667 → 12.021354 seconds,
instead of 12.000000. A drop near that seam could not establish compressor
overload. The replacement is a single continuous 60-second encode of the same
1280×720/30 fps `testsrc2`, AAC stereo and libx264 ultrafast/CRF 26 source.
The warmup plus sample never reaches its end. Checking decoded timestamps
confirms regular frames at 11.966667, 12.000000 and 12.033333 seconds.

With the revised graph, three alternating-order rounds use 5 seconds of warmup
and 20 seconds of sampling per case. All cases end playing without a renderer
error. Video is drawn at 640 px width with TV presentation, under Xvfb/software
rendering. CPU remains percent of one logical core.

| Movie case | Mean CPU | p95 CPU | Steady dropped / reported frames | Startup/warmup drops | Steady audio underruns |
|---|---:|---:|---:|---:|---:|
| Native, no graph | 32.59% | 35.88% | 0 / 1806 | 0 | Unavailable |
| Bypassed | 33.30% | 36.89% | 0 / 1803 | 3 | 0 |
| Enabled | 34.99% | 38.87% | 0 / 1805 | 2 | 0 |
| Toggle every 2 seconds | 34.21% | 37.87% | 6 / 1805 | 5 | 0 |

Steady compression adds 2.41 points; bypass adds 0.72. The toggle drops occurred
as 0, 4 and 2 by round. This is **not a zero-drop toggle result**. Replacing the
looped fixture did not explain every drop, and no hardware acceptance follows
from this run. Evidence: `.artifacts/compressor-perf-iteration/movie-continuous/`.

A separate three-round diagnostic trace (3-second warmup, 15-second sample,
native versus toggling) recorded no steady drops and two startup drops. Those
startup drops skipped the 33 ms frame about 68 ms after the case began. The
intermittent steady drops did not reproduce under tracing, so their cause
remains unproven. Across 1,274 audio destination callbacks requesting 2,048
samples (42.7 ms at 48 kHz), p95 callback time was 1.679 ms and the maximum
2.737 ms; 128-sample rendering quanta had p95 96 µs and maximum 394 µs.
This trace shows processing headroom in that run, not proof that the untraced
drops were unrelated to the graph. Tracing also raises CPU, so its CPU samples
are excluded from the comparison. Evidence:
`.artifacts/compressor-perf-iteration/movie-continuous-trace/{trace.json,analysis.txt,result.json}`.

A final controlled comparison restored only the original graph, keeping the
current renderer/harness, then repeated with the optimized graph. Both runs
used the continuous clip, native/toggle cases, three alternating-order rounds
and 5-second warmup/20-second samples. The source was restored and byte-checked
afterwards. Original: 6 steady toggle drops / 1,803 frames; optimized: 2 / 1,806.
Neither native baseline dropped a frame, and both toggle versions reported
zero audio underruns. Thus disconnection is not required to reproduce this
symptom; these small, variable counts do not establish that the optimization
fixes it. Toggle-minus-native CPU was 2.02 points originally and 1.41 optimized.
Evidence: `.artifacts/compressor-perf-iteration/{toggle-original,toggle-optimized}/result.json`.

Retain the pause/bypass savings, but **leave TV toggle smoothness open** for a
trial on the T480's real video/audio output. Investigate there if it reproduces;
neither low average CPU nor an underrun-free software counter proves smooth
physical playback.

## Initial Direct measurements (before the resource fixes)

Hardware: Intel Xeon E5-2690 v3, 24 logical CPUs, Debian Linux
`6.12.111+deb13-amd64`. Electron 44.4.5 / Chromium 152.0.7977.130, 48 kHz
stereo. Xvfb and software rendering/decoding; production Vite bundles with the
real renderer and mixer. These are isolated fixture processes, without a full
Couch Core, live network source, or CORS relay.

Three rounds alternate case order. The audio-only run warms each case for
3 seconds and samples for 10 seconds in 1-second intervals. The source is an
8-second looping PCM16 WAV with alternating quiet/loud 997 Hz audio. This is
shorter than the target-device protocol below and is suitable for detecting
large regressions, not setting a hardware budget.

CPU is the sum of cumulative CPU-time deltas for Electron's browser, renderer,
GPU, network and audio utility processes, expressed as **percent of one logical
core** (100% = one fully occupied core). It is not percent of the whole machine.
The advanced case changes a numeric draft four times per second without Apply.

| Audio-only case | Mean CPU | p95 CPU | Mean summed RSS | Peak summed RSS |
|---|---:|---:|---:|---:|
| Off, no graph | 4.42% | 6.98% | 608.4 MiB | 637.0 MiB |
| Graph attached, bypassed | 6.98% | 8.97% | 609.6 MiB | 634.2 MiB |
| Default compression | 7.05% | 8.98% | 597.5 MiB | 602.3 MiB |
| Compression, Advanced editing | 12.50% | 17.97% | 601.9 MiB | 605.0 MiB |
| Extreme settings | 7.31% | 8.97% | 597.8 MiB | 605.3 MiB |

Default compression adds **2.62 percentage points of one core**, approximately
1.57 CPU-seconds per minute, in this fixture. Bypass retains the audio graph
and nearly the same CPU cost in this initial version; the resource iteration
above supersedes that bypass result. The per-round enabled-minus-off deltas were 2.49, 3.49 and 1.89
points. Do not infer a memory saving from the table: browser GC/startup state
varies, and summed working sets count shared resident pages more than once.
There is no evidence here of a large compressor allocation, but these short
samples do not establish absence of a leak.

Web Audio's fixed algorithmic lookahead is 6 ms. Its reported base/output
latencies in this headless environment were about 43/128 ms; these are output
stack estimates, not measured added latency versus native playback. No physical
latency or T480 claim follows from them.

Raw evidence: `.artifacts/compressor-performance/result.json`; screenshots and
signal/UI checks: `.artifacts/compressor-check/` and
`.artifacts/compressor-tv-check/`.

The movie fixture uses FFmpeg-generated 1280×720/30 fps H.264 (`testsrc2`,
libx264 ultrafast/CRF 26) and AAC stereo, a 12-second file drawn at 640 px
width in the TV fixture. Three rounds warm for 3 seconds and sample for 8.
The five-case run averaged 32.07% of one core off, 35.81% bypassed, 35.68%
enabled, 36.06% editing, and 34.69% at extreme settings. Summed process RSS
was roughly 647–658 MiB on average. Evidence:
`.artifacts/compressor-movie-performance/result.json`.

A focused off/on repeat recorded video counters after warmup as well as at
the end: 33.19% off versus 34.27% enabled, a 1.08-point delta compared with
3.61 in the earlier run. This variation limits the precision of a short
software-decoding benchmark. Off dropped 0 frames; enabled dropped 1 of
723 frames during the measured windows and another 5 during startup/warmup.
All samples ended playing with no renderer error. Chromium also logged a
software GPU shared-image warning. This is **not a zero-drop acceptance
result**; repeat on the T480 with its real GPU/output before judging TV
performance. Audio underruns and physical lip sync were not measured.
Evidence: `.artifacts/compressor-movie-steady/result.json`.

## Preliminary shared FFmpeg measurements

Real FFmpeg 9.0.2 decodes a looping 48 kHz stereo WAV, encodes Opus at 96 kbps
with 60 ms frames, and emits PCM alongside it. The enabled case uses the same
shared filter before the split as Sendspin. Null muxers exclude socket traffic,
Core and client work. Each offline run processes five minutes of media; three
rounds alternate order. This measures CPU work per minute of media, not realtime
latency or CPU spikes under network load.

| Case | Mean CPU seconds per minute of media |
|---|---:|
| Off | 0.765 |
| Default compression | 0.893 |
| Extreme settings | 0.988 |

The default adds **0.128 CPU-seconds per media minute**, equivalent to about
0.21% of one core averaged over realtime playback. Peak process RSS across runs
was approximately 23–29 MiB; no second FFmpeg process is introduced by the
compressor. Raw counters, full arguments and logs are in
`.artifacts/compressor-ffmpeg/`. This does not measure multi-client network
scaling, multiple simultaneous Playbacks, or the complete Sendspin pipeline.

## Reproduce on the T480

Use a checkout with dependencies installed using the pinned Bun and frozen
lockfile. The harness starts its own temporary HTTP server and Electron profile;
it does not launch the installed Couch or use its database. Run from a desktop/TV
graphical session with the intended audio output and power settings. An Xvfb
run is useful for regressions but does not establish actual TV decoding cost.
Keep competing builds, tests and playback out of the measurement window.

For a reproducible movie source, encode a continuous clip once. The workspace
comparison used 60 seconds; use 120 for the longer target-device windows below.
Do not extend a short AAC/MP4 by stream-copy looping it.

```sh
/absolute/path/to/ffmpeg -hide_banner -loglevel error -nostdin \
  -f lavfi -i testsrc2=size=1280x720:rate=30 \
  -f lavfi -i 'aevalsrc=0.8*sin(2*PI*997*t)|0.4*sin(2*PI*997*t):s=48000' \
  -t 120 -c:v libx264 -preset ultrafast -crf 26 -pix_fmt yuv420p \
  -c:a aac -b:a 128k -movflags +faststart .artifacts/compressor-movie-120s.mp4
```

```sh
./node_modules/.bin/bun tests/compressor.native.ts .artifacts/compressor-t480-audio --tv --warmup=30 --seconds=60 --rounds=3 --modes=none,bypass,enabled,paused-native,paused
COUCH_PERF_MEDIA=/absolute/path/to/movie.mp4 ./node_modules/.bin/bun tests/compressor.native.ts .artifacts/compressor-t480-movie --tv --warmup=30 --seconds=60 --rounds=3 --modes=none,bypass,enabled,toggle
COUCH_TEST_FFMPEG=/absolute/path/to/ffmpeg ./node_modules/.bin/bun tests/compressor-ffmpeg.performance.ts .artifacts/compressor-t480-ffmpeg
```

Keep the complete JSON, screenshots and source identity. Use continuous media
longer than the warmup plus sampling window to avoid loop-boundary artifacts.
The movie fixture reports decoded/dropped video frames before and after sampling,
final renderer state and, when supported, Web Audio underrun counters. These
do not measure physical lip sync or every possible audible glitch. Follow
with actual radio/movie sources on the studio outputs: test first enable,
bypass, resume, Direct ↔ In sync, and a shared edit/rebuffer. Compare relay
and direct transports separately while holding the DSP state constant. Use
loopback/external capture to establish added audio delay or dropouts, and a
longer run to check memory growth. No universal CPU budget is asserted until
this target-device baseline exists.

For automated regressions:

```sh
./node_modules/.bin/bun test tests/compressor.test.ts tests/compressor-relay.test.ts tests/compressor-mpv.test.ts tests/renderer-hls.test.ts
./node_modules/.bin/bun build tests/compressor.integration.ts tests/compressor-sendspin.integration.ts --target=node --outdir=build
COUCH_TEST_FFMPEG=/absolute/path/to/ffmpeg node --test build/compressor.integration.js build/compressor-sendspin.integration.js
xvfb-run -a ./node_modules/.bin/bun tests/compressor.native.ts .artifacts/compressor-check --rounds=0 --perf-checks --tv
```

`--serve` leaves just the browser fixture open for inspection. Stop its recorded
PID when finished. `--rounds=0` runs the signal, renderer, mixer and layout checks
without taking performance samples. Sources and screenshots stay under the
chosen artifact directory. `--modes=none,enabled` narrows a performance run to
the baseline and default compressor; omitted, the original five cases run.
`paused-native` and `paused` compare suspended playback; `toggle` switches every
two seconds. `--perf-checks` adds the resource lifecycle and realtime transition
regressions. `--trace` saves Chromium audio/media/task events in `trace.json`;
use it for diagnosis separately from untraced CPU comparisons.
