# Live sharing performance

Investigated 2026-10-14 against `35ffee9` (`v0.3.1-preview.4`), a report of a MacBook
screen shared to one Android Chrome receiver playing at least ten seconds behind,
where earlier builds had been much faster. The resulting decision is
[ADR 0001](adr/0001-live-inputs-play-over-webrtc-unless-in-sync.md); synchronization
research is in [live-sync-research.md](live-sync-research.md).

## What changed between builds

Recovered from the original Mac Git stores and T3 history on 2026-10-14 (handoff
`START-HERE.txt` and `reports/RECOVERY.md`); no experiment was rerun.

- `5c7ccd4` (October 12) sent WebRTC from the publisher to every receiver.
  `583c849` added authenticated TURN and LAN STUN; TURN TCP is still WebRTC media.
- `5c0f3fc` replaced it, even for one receiver, with a recording uploaded to Core,
  encoded by FFmpeg into one-second HLS segments, with Sendspin scheduling sound
  one second ahead and pictures following its clock.
- `f5f7a0ab5951837e4fb50c6d099845a8ee3ccc8e` restored direct WebRTC in the normal
  player for one receiving device, keeping HLS/Sendspin whenever outputs spanned
  devices and the upload warm for every source. The user ran this build when they
  wrote "this is WAAAY BETTER NOW!" (2026-10-13 13:08:37Z, T3 thread
  `cfca5168-d65e-4d3a-8a3d-fe48f03c4cb4`, Validate live screen sharing). That is a
  qualitative phone confirmation, not an Android measurement.
- `35ffee9` also moved a single receiver to HLS/Sendspin after a failed
  negotiation or a 10-second connection timeout, for the rest of the publication.
  That "relay" is Couch's buffered stream, not TURN-relayed WebRTC.

A local Linux commit `71da5d0` (same subject and author time as `5c7ccd4`, parent
`1d9ede6`, also WebRTC) resolves in this repository but has a different tree and
parent; it was not in the Mac stores the recovery searched, so nothing above
relies on it.

These differences can explain multi-second delay, but the reporter's route was
never observed: their `couch.log` (`Direct on`, `Synced on`, `couldn't connect
directly`) and a physical measurement are still needed. Nothing here proves the
cause on their devices, or that this change removes their delay.

## Measurements

### Recovered, at `f5f7a0a`

Real Mac screen capture to a local packaged Electron receiver, video frame age
from a timestamp drawn on the screen, about 15 s and 58 samples each, receiver
muted. Neither is a phone or acoustic measurement.

- **Direct**: p50 73 ms, p95 87 ms, zero dropped frames
  (`real-mac-glass-rtc-final.json`).
- **Authenticated TURN over TCP**: p50 70 ms, p95 94 ms, zero dropped frames
  (`real-mac-glass-turn-tcp-final.json`; the disposable receiver was forced off
  non-proxied UDP).
- **In sync group** (HLS/Sendspin, despite the file name): 128 identical scheduled
  chunks and a 0.072 ms difference between the clients' software timeline anchors
  (`normal-live-group-rtc-final.json`). That says nothing about physical speaker
  or Android alignment.

`rtc-source-flow-validation.json` binds these to the commit. No numeric
MacBook-to-Android latency or sync, and no synchronized WebRTC implementation,
was recovered.

### Local synthetic, measured on 2026-10-14

All on one Linux machine, Node 24.21.0, Bun 1.4.2, isolated databases and ports.
None is a physical capture-to-display or phone measurement.

- **HLS readiness** (`35ffee9`'s `createLiveStreams`, FFmpeg 9.0.2, paced synthetic
  720p30 VP8/Opus WebM in 250 ms batches): first playable playlist after
  1,739 / 1,742 / 1,739 ms. Excludes MediaRecorder, Sendspin, receivers and output.
- **Buffered In sync audio** (`tests/live-latency.integration.ts`, real FFmpeg):
  capture age at scheduled Sendspin playback 2.047 s and 2.020 s.
- **Direct WebRTC after this change**: a scratch page ran Couch's own live session
  and renderer for a publisher and two receivers in three iframes of one headless
  Chromium, against an isolated Core. The publisher's generated canvas stamped its
  capture time into pixel blocks; receivers decoded each presented frame
  (`requestVideoFrameCallback` expected display time, same machine clock).
  One receiver, about 15 s: p50 34 ms, p95 57 ms, max 71 ms. Two receivers, about 15 s:
  p50 78 / 77 ms, p95 106 / 90 ms, max 199 / 123 ms. Core logged `Direct on
  Receiver A, Receiver B` and never asked for an upload. One browser process
  encoded both streams and decoded both on loopback, so these figures say nothing
  about Wi-Fi, a phone, hardware codecs or a real screen.
- An older 200-receiver run (`1d9ede6`) measured simulated PCM delivery on
  localhost; it is not evidence for video, phones or physical playback.

## Still to measure

On the reporter's MacBook and Android Chrome, record the route from `couch.log`,
then source-to-display delay (p50/p95) with a filmed timecode, startup separately
from steady state, dropped frames, publisher CPU, and audio/video alignment, for
one and two receivers, Direct and In sync. If the phone still gathers no ICE
candidates, inspect `chrome://webrtc-internals` there for the gathered candidates
and the selected pair. TURN keeps a receiver direct only when its browser can
reach a configured relay; whether it did shows in that selected pair.

## Smooth sharing investigation, 1 November 2026

This work starts at audit head `8bd6c873`. The native Mac and Windows results in
[the audit](release-audit-2026-10-29.md#playback-and-sharing-performance) are
baseline evidence, not measurements of this change. In particular, raising the
sender ceiling restored encoding cadence but did not consistently pass receiver
presentation. The initial 30 FPS default was retained pending **every** 1080p60
steady sample passing on both native platforms, with sound. Window minimize/hide/window-only closure
keep sharing; source-app exit or Stop sharing ends it. No closure detector is
part of this work.

### What Sunshine and Moonlight control

Primary source checkouts, inspected before implementation:
[Sunshine `68f637a`](https://github.com/LizardByte/Sunshine/tree/68f637a261abb2dd2f215e732d29a7de16de732a),
[Moonlight Qt `1ced9dd`](https://github.com/moonlight-stream/moonlight-qt/tree/1ced9dd9b0a2a41ba720b72ae03e356b25fc4243),
[Moonlight common `5d3c0ec`](https://github.com/moonlight-stream/moonlight-common-c/tree/5d3c0ecca00c1bb3f587acb8060476edcf8e24aa).

Sunshine captures through platform backends: Windows Desktop Duplication and
Windows Graphics Capture, macOS AVFoundation, Linux KMS, Wayland/portal/PipeWire
and X11. GPU-backed paths avoid unnecessary CPU readback where supported. Its
[Windows capture loop](https://github.com/LizardByte/Sunshine/blob/68f637a261abb2dd2f215e732d29a7de16de732a/src/platform/windows/display_base.cpp)
paces against an absolute frame timeline with a high precision timer, restarts
pacing after missed deadlines, and adjusts to the display cadence. Requesting
120 FPS cannot create 120 distinct updates from a 60 Hz source.

The [encoder definitions](https://github.com/LizardByte/Sunshine/blob/68f637a261abb2dd2f215e732d29a7de16de732a/src/video.cpp)
use no B frames, client-selected bitrate and generally a one-frame rate-control
buffer (backend exceptions exist). QSV requests async depth 1 and low-delay rate
control; AMF uses low-latency settings (documented default: ultra-low-latency
usage, preanalysis disabled, VBAQ enabled);
VideoToolbox requests realtime/speed priority; VAAPI uses async depth 1 and
backend rate-control limits. These knobs are platform-specific, not WebRTC API
parameters. The [native NVENC path](https://github.com/LizardByte/Sunshine/blob/68f637a261abb2dd2f215e732d29a7de16de732a/src/nvenc/nvenc_base.cpp)
uses ultra-low-latency tuning, CBR, no lookahead, no frame reordering and a
bitrate/FPS-sized VBV. Adequate bitrate and short queues matter together.

Sunshine's [transport](https://github.com/LizardByte/Sunshine/blob/68f637a261abb2dd2f215e732d29a7de16de732a/src/stream.cpp)
paces packet batches and adds Reed–Solomon parity to bounded blocks. Moonlight's
[RTP video queue](https://github.com/moonlight-stream/moonlight-common-c/blob/5d3c0ecca00c1bb3f587acb8060476edcf8e24aa/src/RtpVideoQueue.c)
reorders/reconstructs packets, reports recovery status and coordinates reference
recovery. Adding this FEC to a browser WebRTC stream would duplicate a transport
layer with incompatible packets. Keep negotiated WebRTC loss recovery and TURN.

Moonlight's [decoder](https://github.com/moonlight-stream/moonlight-qt/blob/1ced9dd9b0a2a41ba720b72ae03e356b25fc4243/app/streaming/video/ffmpeg.cpp)
requests low-delay decoding, uses platform hardware renderers, and uses slice
rather than frame threading for software decode. Its
[pacer](https://github.com/moonlight-stream/moonlight-qt/blob/1ced9dd9b0a2a41ba720b72ae03e356b25fc4243/app/streaming/video/ffmpeg-renderers/pacer/pacer.cpp)
coordinates presentation with vblank, bounds queues and drops old frames when
queues stay backed up. Pacing trades a small queue for smoothness; disabling all
buffering is not automatically faster usable playback. Browsers own these
queues and compositor timing for `<video>`; a JavaScript animation loop would
add another scheduling boundary.

### Browser controls and their limits

- [WebRTC encoding parameters](https://www.w3.org/TR/webrtc/#rtcrtpencodingparameters)
  provide `maxBitrate` in bits/s and `maxFramerate` in frames/s. They are ceilings,
  not reservations or throughput guarantees. Read fresh `getParameters()`, edit
  its existing encodings and await `setParameters()`; retain transaction and
  codec fields. Configure before the offer and update existing senders when
  capture settings change. Congestion control may still send less. Chromium's
  [encoder stream factory](https://webrtc.googlesource.com/src/+/refs/heads/main/video/config/encoder_stream_factory.cc)
  defaults above 960×540 to 2,500 kbit/s when no explicit ceiling is supplied.
- [Content hints](https://www.w3.org/TR/mst-content-hint/#video-content-hints)
  distinguish motion from text/detail. `motion` implicitly prefers frame rate
  by reducing resolution unless an explicit `degradationPreference` overrides
  it. Use explicit `maintain-resolution` with the motion hint when comparing
  equal-size samples; never qualify a downscaled picture as 1080p. Congestion
  can still reduce FPS; increasing a ceiling does not guarantee image quality.
- [Codec preferences](https://www.w3.org/TR/webrtc/#dom-rtcrtptransceiver-setcodecpreferences)
  reorder advertised capabilities before negotiation. They neither enable a
  hardware encoder nor guarantee one. Retain other codecs and repair formats for
  receivers without H.264. [Media Capabilities](https://www.w3.org/TR/media-capabilities/)
  `encodingInfo({type: "webrtc", video: …})` can predict supported, smooth,
  power-efficient encoding for the actual dimensions/rate. Chromium's
  [implementation](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/media_capabilities/media_capabilities.cc)
  queries WebRTC support/performance history. Treat this as a selection hint;
  only outbound/inbound stats identify the implementation actually used.
- [Receiver jitter targets](https://www.w3.org/TR/webrtc/#dom-rtcrtpreceiver-jitterbuffertarget)
  are milliseconds, nullable and feature-detected. Chromium's
  [receiver implementation](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/peerconnection/rtc_rtp_receiver.cc)
  converts them to a minimum-delay request in seconds. Actual delay can exceed
  the requested target. Synchronized sound/picture should use the larger target;
  leave synchronization to WebRTC, rather than retiming sound separately.
- [Video-frame callbacks](https://wicg.github.io/video-rvfc/)
  report frames submitted for composition, with expected display time and a
  cumulative presented counter. Callbacks can be late or skipped on a busy main
  thread and run no faster than the display. Record counter deltas alongside
  playback-quality drops and RTP capture/encode/decode counters. Neither these
  callbacks nor capture timestamps measure photons or acoustic A/V offset.
- [WebCodecs](https://www.w3.org/TR/webcodecs/) provides codec access, hardware
  preference, realtime latency mode and queue visibility, but supplies no
  transport, congestion control, loss recovery, jitter buffer or synchronized
  A/V playout. Hardware preference is not a cross-browser hardware guarantee.
  A native host encoder plus browser decoder would need all those missing
  pieces, timestamp mapping, keyframe recovery and per-receiver backpressure.

### Pipeline decision

Proceed with **(a), configured WebRTC**, as a candidate awaiting native gates.
The audit's bitrate-only experiments restore roughly 57–60 encoded FPS from
34–38 at the same 1080p dimensions. They establish a fixable sender budget limit,
while 1–4% receiver drops remain unresolved. They do not establish that WebRTC
cannot pass or justify replacing its A/V clock and transport with (b).

The bitrate candidate budgets at 30/60/120 FPS are 2/4/8 Mbit/s for 720p and
4/8/16 Mbit/s for 1080p. Original scales from actual capture pixels, capped at
40 Mbit/s. These are maximums per receiver, not fixed transmission rates;
8 Mbit/s at 1080p60 comes from the audit's measured sender recovery. The first candidate also tested a motion hint, 50 ms video jitter target and
H.264 preference gated by a smooth/power-efficient WebRTC Media Capabilities
prediction. Actual Windows stats confirmed NVIDIA hardware encode and D3D11
decode, but receiver drops were substantially worse than VP8. A 150 ms target
added roughly 100 ms of frame age without fixing the drops. A 59 FPS encoder
ceiling also failed. Those settings are not retained. The bitrate candidate
uses `detail`, explicit `maintain-resolution`, and the browser's codec order and
automatic receiver buffering. At this sender-only stage the default stayed
30 FPS. Capability predictions
alone do not justify a codec preference; keep the failed experiments with their
reruns and require actual encoder/decoder implementations in the evidence.

### Native Windows evidence, initial sender candidate

The isolated Windows run is launched from WSL through native PowerShell/Bun/
Electron, not through WSLg. It uses actual 1920×1080 capture (1280×720 for the
720p case), generated loopback sound, three serial eight-second steady samples
following three-second warmups. Source, publisher and receivers share one Windows
host; signaling is an in-memory fixture. No installed app/profile is used.
The final matrix runs without concurrent builds, tests or other benchmark apps.
Machine details remain only in ignored results. The native display is 60 Hz;
it cannot qualify 120 Hz presentation. The existing 60 FPS fixture also cannot
establish a 120 FPS source claim.

| Gate | Delivered FPS, samples 1 / 2 / 3 | Steady drops %, samples 1 / 2 / 3 | Windows result | Evidence under `.artifacts/streaming-windows/` |
| --- | --- | --- | --- | --- |
| 1080p60, ≥55 FPS / ≤1% | 56.41 / 58.08 / 55.33 | 2.15 / 1.88 / 6.11 | **Fail drops** | `final60/result.json` |
| 1080p30, ≥28 FPS / ≤1% | 29.96 / 29.89 / 29.75 | 0 / 0 / 0.41 | **Pass** | `final30/result.json` |
| 720p60, ≥55 FPS / ≤1% | 57.28 / 57.74 / 57.55 | 4.35 / 3.51 / 4.12 | **Fail drops** | `final720/result.json` |
| Two 1080p60 receivers, each ≥55 / ≤1% | A: 53.81 / 56.84 / 55.70; B: 53.77 / 55.09 / 55.68 | A: 8.25 / 2.13 / 3.43; B: 6.87 / 5.12 / 3.43 | **Fail FPS/drops** | `final-two/result.json` |
| 1080p60, emulated 6 Mbit/s link | 57.97 / 59.36 / 58.71 | 2.09 / 1.03 / 1.66 | **Fail drops** | `final-mid6m/result.json` |
| 1080p, requested 120 | 55.83 / 57.79 / 58.50 | 1.95 / 2.10 / 2.47 | **Not qualified: 60 Hz display/source**; 110 FPS assertion remains failed | `final120/result.json` |

Every final sample retains its required dimensions and advances sent/received
sound bytes, audio energy and nonzero decoded PCM. Encoder and decoder are both
libvpx. Frame-rate stages for the 1080p controls:

| Requested / sample | Captured | Encoded | Decoded | Presented | Warmup drops | Steady drops % | Summed process CPU % |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 60 / 1 | 59.75 | 57.65 | 57.65 | 56.16 | 25 | 2.15 | 144.5 |
| 60 / 2 | 59.68 | 59.19 | 59.19 | 57.95 | 12 | 1.88 | 147.6 |
| 60 / 3 | 60.05 | 58.93 | 58.93 | 55.21 | 13 | 6.11 | 150.4 |
| 30 / 1 | 30.09 | 30.09 | 29.96 | 29.84 | 1 | 0 | 85.5 |
| 30 / 2 | 30.01 | 30.01 | 29.89 | 29.76 | 0 | 0 | 85.7 |
| 30 / 3 | 29.87 | 29.99 | 29.87 | 29.62 | 0 | 0.41 | 84.9 |

Unmodified audit-head 1080p60 baseline: 36.47 / 35.92 / 37.26 delivered FPS,
3.28 / 3.34 / 2.59% drops, libvpx encode/decode (`baseline60`). The configured
sender removes most capture-to-encode cadence loss. Final-matrix video RTP
reports zero packet loss and zero inbound frame drops; playback quality still
counts unpresented frames. This places the remaining observed loss downstream
of decoding, without identifying its exact internal cause. Raising bitrate alone
is **not** a smooth-sharing qualification. A final three-sample control without
`--diagnostics` also fails: 58.75 / 58.92 / 57.14 delivered FPS and
1.66 / 1.65 / 4.16% drops (`quiet60/result.json`). Removing the optional frame
probes does not eliminate the failure.

Further three-sample comparisons retain exact dimensions and sound:

| Diagnostic | Delivered FPS | Steady drops % | Implementations / finding |
| --- | --- | --- | --- |
| H.264, motion, target 50 ms | 46.55 / 49.29 / 48.95 | 17.36 / 14.07 / 13.94 | NVIDIA H.264 MFT / D3D11; capability prediction did select real hardware, but presentation fails |
| H.264, detail, target 50 ms | 48.59 / 55.72 / 57.41 | 18.33 / 7.01 / 3.73 | Same hardware; changing hint does not qualify it |
| VP8, detail, target 150 ms | 55.01 / 57.92 / 58.44 | 5.11 / 2.30 / 1.87 | libvpx; more buffering does not pass |
| VP8, detail, 59 FPS encoding cap | 55.11 / 56.07 / 55.98 | 3.88 / 4.63 / 4.43 | libvpx; extra pacing ceiling does not pass |
| H.265 | 54.59 / 54.96 / 47.97 | 8.11 / 8.07 / 19.38 | NVIDIA HEVC MFT / D3D11; hardware is not sufficient |
| AV1 | 51.66 / 52.58 / 53.57 | 13.66 / 12.58 / 10.74 | libaom / D3D11; advertised codec is not hardware encoding |
| VP9 | 51.78 / 57.19 / 56.27 | 11.95 / 3.95 / 5.01 | libvpx / D3D11; also fails |
| VP8, receiver always on top | 57.32 / 57.05 / 59.15 | 3.94 / 4.56 / 0.83 | libvpx; controlling occlusion does not eliminate failures |

All raw runs remain in `%TEMP%/couch-streaming-20261101/source/.artifacts/streaming`,
linked locally as `.artifacts/streaming-windows`. The ignored
`.artifacts/streaming-research/report.md` lists every run's individual rates,
warmup drops, CPU and implementations; `candidate-02/` retains the discarded
production experiment source. Earlier exploratory runs are not quiet serial
qualification: one H.264/150 ms final interval overlapped the following VP8
build, and local setup/unit checks ran during early probes. Their failures are
retained, not replaced by the final serial matrix or dismissed as passes.

### Open gates before the pacing follow-up

- **1080p60 smooth by default remains incomplete.** The sender budget is fixed;
  Windows receiver presentation still exceeds 1% drops. The internal cause is
  unresolved. No codec, extra jitter delay, lower encoder cap or forced
  foreground sample passes every interval. Keep the default at 30 FPS.
- **Mac has no new native run.** This WSL/Windows session exposes no connected
  Darwin execution host. The prior audit's Mac numbers remain historical, not
  passes for this candidate. All Mac gates are unmeasured here.
- **120 Hz, physical receivers and image-quality/A/V timing qualification remain
  open.** The Windows display/source is 60 Hz/FPS. Two local player frames and
  P2P emulation exercise production paths but do not qualify phones, the Linux
  TV, physical networks, perceptual quality or acoustic A/V offset. Existing
  WebRTC A/V synchronization is retained; no audio clock or scheduling change
  is introduced.
- There is no evidence yet that a native host encoder plus WebCodecs transport
  would resolve the receiver failure while preserving all browser/fallback/A/V
  behavior. Encoding already keeps up in these WebRTC runs. Continue (a) before
  undertaking (b); this draft is not a claim that the requested goal is complete.

### Correctness checks

On the retained candidate, local frozen install, all three TypeScript projects,
all 768 Bun tests and the production build pass. Native Windows sharing/capture
Bun checks pass 110/110 across five files. The 21 selected Node integration
suites pass **189/189, zero skips, on both Linux/WSL and native Windows**,
including the 12 real-FFmpeg buffered-video cases and the Live audio checks
listed in [live-audio.md](live-audio.md#checks). They cover channel/privacy
filtering, multiple receivers, fallback, pairing/revocation, capture generations,
Sendspin and buffered 10/30/60/120 cadence/A/V timestamps. No threshold or
assertion was weakened.

Logs are in `.artifacts/streaming-checks/`: `typecheck.log`, `unit.log`,
`build.log`, `integration-02.log`, `windows-correctness.log` and
`windows-integrations-02.log`. The first integration invocation used the wrong
bundle glob: Linux discovered zero tests and Windows fell back to Node's default
test discovery (which cannot run Bun suites). Those failed/empty invocations
remain as `integration.log` and the latter portion of `windows-correctness.log`;
the corrected explicit bundle paths produce the 189-case results above. They
are harness invocation errors, not passing integrations or product failures.


### Worker pacing follow-up

After the first draft, Chromium tracing localized the loss to remote-video
presentation: decoded frames arrived about 12 ms before their reference render
time, and the reference-time mapping was stable, yet the compositor skipped
frames. Equal audio/video jitter targets, a video-only control and 20 Mbit/s
ceilings did not fix it. These additional failures remain in `trace60`,
`av-jitter50`, `video-only60`, `vp8-20m` and `h264-20m`.

A bounded decoded-frame FIFO, modeled on Moonlight's pacer, removes that loss
without replacing WebRTC. The production receiver uses a dedicated worker's
animation-frame cadence and forwards each original `VideoFrame` once through a
local video track. It does not copy pixels, duplicate frames, re-encode or rewrite
timestamps. At most three frames wait; overflow closes the oldest frame and is
counted. Audio remains the original WebRTC track, and the original RTP receiver
continues decoding/synchronizing. Existing TURN, pairing, privacy, multiple
peers, buffered fallback and source-window lifetime are retained.

The browser APIs are feature-detected. Unsupported/failed setup uses the native
WebRTC track; worker failure restores that track. Stop/replacement abort pending
setup, close owned clones/generated tracks and bound worker retirement. The
standard worker `requestAnimationFrame` supplies display cadence, while
Chromium's compatible track processor/generator APIs carry frames; no canvas
pixel loop or transport replacement is introduced.

With pacing, native Windows H.264 also passes. The host now prefers H.264 only
when its WebRTC Media Capabilities query predicts supported, smooth,
power-efficient encoding, retaining all fallback codecs. The native runs below
confirm NVIDIA H.264 MFT encode and D3D11 decode; the earlier unpaced hardware
failures are retained above. These are serial three-by-eight-second samples
following three-second warmups, with generated sound and unchanged dimensions.

The original FPS/drop/dimension assertions remain. The harness additionally
checks **combined** compositor drops, pacing overflow and missing processor
frames against decoded RTP frames, at the same ≤1% ceiling. Thus forwarding to a
local track cannot conceal drops in its producer.

| Gate | Delivered FPS, samples 1 / 2 / 3 | Combined drops %, samples 1 / 2 / 3 | Windows | Evidence under `.artifacts/streaming-windows/` |
| --- | --- | --- | --- | --- |
| 1080p60 | 59.14 / 59.75 / 59.33 | 0.42 / 0.00 / 0.00 | **Pass** | `paced60-01/result.json` |
| 1080p30 | 29.71 / 29.62 / 29.83 | 0.00 / 0.00 / 0.00 | **Pass** | `paced30/result.json` |
| 720p60 | 59.69 / 59.74 / 58.95 | 0.00 / 0.00 / 0.00 | **Pass** | `paced720/result.json` |
| Two 1080p60 receivers | A: 60.02 / 59.79 / 59.70; B: 60.00 / 59.77 / 59.69 | A: 0.00 / 0.00 / 0.21; B: 0.00 / 0.00 / 0.21 | **Pass** | `paced-two/result.json` |
| 1080p60, emulated 6 Mbit/s | 59.05 / 59.11 / 59.69 | 0.21 / 0.21 / 0.21 | **Pass** | `paced-mid6m/result.json` |

All steady player presentation-drop counters are zero. The conservative combined
counter also includes producer/processor losses and snapshot-boundary differences.
Every sample passes advancing RTP sound/energy and nonzero decoded PCM checks.
For 1080p60, requested/captured/encoded/decoded/presented rates and CPU are:

| Requested / sample | Captured | Encoded | Decoded | Presented | Player warmup drops | Combined steady drops % | Summed process CPU % |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 60 / 1 | 59.26 | 59.26 | 59.38 | 58.89 | 3 | 0.42 | 58.2 |
| 60 / 2 | 59.63 | 59.63 | 59.63 | 59.63 | 2 | 0.00 | 57.6 |
| 60 / 3 | 59.46 | 59.46 | 59.46 | 59.09 | 2 | 0.00 | 60.7 |

Pacing snapshots retain cumulative pre-steady queue drops separately from player
startup/warmup/steady counters; the historical worker startup-versus-warmup split
is not separately recorded. Raw CPU, implementations and all stage counters for
the other gates remain in each result. No raw frames or sound recordings are
retained. Full typecheck, 769 Bun tests and the production build pass on the
paced code; live-client cases include pending-worker cancellation and native-track
recovery after worker failure. Native Windows sharing/capture unit suites pass
111/111. The unchanged Core/backend integration code retains its earlier 189/189
passes on Linux/WSL and native Windows.

At the previous Windows handoff, further experiments stopped at the user's request. **Mac, 120 Hz,
perceptual image-quality and physical/acoustic A/V checks remain unqualified.**
Timestamp-preserving forwarding and the existing WebRTC audio clock are retained,
but software frame age and decoded audio energy do not prove acoustic alignment.
The optional A/V marker prototype was not tested and remains ignored, outside
the shipped code. Default capture remains 30 FPS until native Mac qualification
passes as well; do not treat the earlier failing sender-only draft as the final
Windows result. No merge or release was performed.

### Native Mac follow-up

Native Mac validation on 1 November 2026 starts at `9a6a5fe`, with frozen Bun
dependencies, Electron 45.1.0 and Chromium 156.0.8078.49. The final series follows
the owner's explicit exclusive-access handoff and includes the restored default.
Samples run serially without concurrent builds/tests, using isolated profiles,
`COUCH_DATA_DIR` and ports. A task-owned caffeinate process keeps the display
awake and exits afterward. Installed Couch/data/TCC entries are untouched;
hardware details remain only in ignored evidence.

The real moving 1920×1080 H.264 fixtures contain 960 frames in 16 seconds at
60 FPS, or 1,920 at 120 FPS, generated before sampling. The source window is
sized in physical pixels. The display reports 120 Hz and animation callbacks
confirm it. Each row below retains three eight-second steady samples after
three-second warmups, with the original FPS and ≤1% loss gates.

Sound is real macOS system loopback of the generated tone: every receiver sample
has advancing RTP sound bytes/energy and nonzero decoded PCM. Actual H.264
encode is `VideoToolbox`, decode is
`ExternalDecoder (VideoToolboxVideoDecoder)` throughout. The primary 60 FPS RTP
stats also report power-efficient encode and decode in all three samples. All captured, encoded
and decoded dimensions pass, including 1280×720 in the 720p case. Every paced
sample has nonempty pacing snapshots; only the intentional native-presentation
comparison has none.

| Gate | Delivered FPS, samples 1 / 2 / 3 | Combined steady loss % | Mac result | Evidence under `.artifacts/macbook-sharing/` |
| --- | --- | --- | --- | --- |
| 1080p60, ≥55 FPS | 57.86 / 57.85 / 57.74 | 0 / 0 / 0 | **Pass** | `final60/result.json` |
| 1080p30, ≥28 FPS | 29.30 / 29.31 / 29.42 | 0 / 0 / 0 | **Pass** | `final30/result.json` |
| 720p60, ≥55 FPS | 57.81 / 57.58 / 57.60 | 0 / 0 / 0 | **Pass** | `final720/result.json` |
| Two 1080p60 receivers, each ≥55 FPS | A: 57.87 / 57.61 / 57.87; B: 57.97 / 57.59 / 57.85 | 0 / 0 / 0 | **Pass independently** | `final-two/result.json` |
| 1080p60, requested 6 Mbit/s emulation | 57.61 / 57.74 / 57.73 | 0 / 0 / 0 | FPS/loss **pass**; hard link **unqualified** | `final-mid6m/result.json` |
| 1080p120 target, ≥110 FPS | 111.58 / 111.39 / 111.63 | 0 / 0 / 0 | **Pass at measured rates** | `final120/result.json` |
| 1080p60 without optional diagnostics | 57.90 / 57.91 / 57.78 | 0 / 0 / 0 | **Pass** | `final-quiet60/result.json` |
| 1080p60 native presentation, pacer disabled | 58.09 / 56.71 / 56.46 | 0 / 0 / 0 player loss | **Pass comparison** | `final-native60/result.json` |

Two receivers means two independent production sessions/players in separate
iframe globals and distinct WebRTC peer connections on one Mac. It is genuine
per-peer fanout, not two views of one incoming track; it is not cross-device
Wi-Fi or phone/TV qualification.

The CDP command accepts the requested global 6 Mbit/s rule, but video RTP is
6.72 / 5.57 / 6.70 Mbit/s. A separate diagnostic removing the unlimited localhost
rule also passes FPS/loss (57.18 / 56.82 / 55.95 FPS), yet video RTP still reaches
5.78 / 6.74 / 6.73 Mbit/s (`final-mid6m-global/result.json`, diagnostic source in
`bandwidth-global-only.source.ts`). Neither establishes an enforced 6 Mbit/s
link. The emulation discrepancy remains unresolved; no production bandwidth
policy or assertion was changed to make it pass.

120 is a requested target, not a locked rate: actual capture is
111.83 / 111.77 / 111.76 FPS, source playback counters advance at about 120,
and presentation exceeds the unchanged 110 FPS assertion. This supports the
120 target on this tested Mac chain, not physical display latency or Windows
120 Hz. Callback counts alone are not used to qualify source playback.

| Requested / sample | Captured | Encoded | Decoded | Presented | Player startup / warmup / steady drops | Pre-steady queue / steady queue drops | Combined steady loss % | Summed process CPU % | Frame age p50 / p95 ms |
| --- | ---: | ---: | ---: | ---: | --- | --- | ---: | ---: | --- |
| 60 / 1 | 57.99 | 57.99 | 57.99 | 57.74 | 0 / 0 / 0 | 0 / 0 | 0 | 58.3 | 36.8 / 45.8 |
| 60 / 2 | 57.85 | 57.85 | 57.85 | 57.85 | 0 / 0 / 0 | 0 / 0 | 0 | 58.7 | 38.4 / 47.7 |
| 60 / 3 | 57.86 | 57.74 | 57.74 | 57.49 | 0 / 0 / 0 | 0 / 0 | 0 | 60.3 | 37.6 / 53.3 |

All final paced samples have zero steady player drops, queue overflow and
missing-processor counts. CPU ranges are 43.3–44.7% for 30, 61.0–63.2% for
720p60, 69.0–71.5% for two receivers together, 58.1–60.0% for requested 6 Mbit/s,
63.7–66.7% for 120, and 55.1–58.0% for quiet60. 100% is one logical CPU; these
sums include the source, publisher and receiver Electron processes, not all
macOS services.

Startup/warmup are separate from the steady result. Two-receiver player startup
counts A/B are 0/0, 1/0, 1/0; warmup counts are 1/1, 0/0, 0/0. Each receiver's
pacer has cumulative **pre-steady** queue drops of 5 / 6 / 31 across the three
runs, with zero additional drops during steady sampling. These snapshots do not
split queue loss into startup versus warmup. Other final paced rows have zero
player startup/warmup and pre-steady queue drops. The native comparison has one
player warmup drop in its first sample. Queues remain bounded at three frames.
`final-summary.json` and `final-report.md` retain every sample's requested/
captured/encoded/decoded/delivered/presented rates, CPU, audio RMS,
implementations, frame age and all drop counters; raw per-second stats and
source playback probes remain in individual results.

Earlier preliminary runs remain separately in `paced60-01`, `paced30`,
`paced720`, `paced-two`, `paced-mid6m`, `paced120`, `quiet60` and `native60`,
with `summary.json`/`report.md`. Their 1080p60 combined losses are 0 / 0 / 0.22%:
the last is one frame of disagreement between RTP decode and processor
snapshots, whose exact cause was not isolated. Preliminary two-receiver
pre-steady queue loss is 15 / 14 / 9, distinct from the final series. Late
bandwidth diagnostics `mid6m-global-only` (also missing its bandwidth argument)
and `mid6m-global-only-02` fail with low FPS and disappearing capture-source
IDs before exclusive access; they are not qualification samples and their
cause is not attributed to a production change. A zsh read-only variable also
broke their outer exit-code reporting. Raw results/logs and excluded-run notes
remain. No failed evidence was overwritten or assertion weakened.

Native 1080p60 now passes every final Mac and retained Windows steady sample
with sound and exact dimensions. The targeted 30 FPS workaround from `037405be`
is therefore reversed: default capture is **60 FPS**, with explicit 30 and 120
still available. This changes the shared default and its assertions only; the
Windows-qualified bitrate, codec preference, worker, transport and audio
pipeline are unchanged. A future change to that pipeline requires Windows
requalification.

**Lifecycle and A/V scope.** `final-lifecycle-av/result.json` records native
production-session checks for 720p/1080p and 30/60 Picture edits with unchanged
source identity and the expected sender ceilings, twelve one-second queue
snapshots (maximum one queued frame), three Stop/restart/playback replacements,
track/worker retirement, injected worker-error recovery to advancing original
video, and a missing-generator native fallback. Pending-setup cancellation is
also covered by the live-client unit suite. No source-window visibility or
closure detector was added; capture lifetime retains the existing platform path.

A separately generated 60 FPS flash/997 Hz beep marker traverses real Mac
screen/system-audio capture and the production WebRTC/player path. Pixel
transitions are detected from presented frames. The source element audio tap
works, but `MediaElementAudioSourceNode` returns zeros when tapping this receiver
`srcObject`, with WebContents muting both enabled and disabled. A separate
`MediaStreamAudioSourceNode` analysis branch detects the received pulses after
its output is silenced to prevent same-Mac loopback feedback. Its
[output timestamp](https://webaudio.github.io/web-audio-api/#dom-audiocontext-getoutputtimestamp)
is an OS estimate, and the separate audio context contributes its own timing;
[video callbacks](https://wicg.github.io/video-rvfc/) report expected composition,
not photons. The final diagnostic matches 21 source and 17 receiver events:
source audio-minus-video median 32.90 ms (32.13–35.85), receiver estimate
92.93 ms (55.03–126.33). These are **not** the production element's acoustic A/V
offset and cannot qualify alignment or identify a pacing regression. Raw pulse
onsets, output-clock mappings and `timing-summary.json` remain beside the result.
Physical/acoustic A/V remains unqualified, as on Windows; no physical timing
recording or calibrated output loopback is available in this validation.

All earlier A/V/lifecycle attempts remain: `lifecycle-av-01` has an invalid
cross-track media-clock comparison after fallback; `lifecycle-av-02/03` retain
successful lifecycle checks but failed element-audio detection;
`av-element-04` confirms the zero tap without muting; `av-stream-05` exposes
recapture feedback; `av-stream-06` is the first silent-analysis diagnostic.
None is substituted for a passing physical alignment measurement.

**Regressions.** Frozen install, full typecheck and production build pass on the
final code. The Bun suite passes 768 tests with one existing Linux `/proc`
process-name check skipped on macOS (769 total). This includes sharing,
live-client, capture, quality/FPS edits, fallback codecs, pairing/privacy and
pending-worker cancellation. All 81 tests across the eight Live audio suites in
`docs/live-audio.md` plus the 12-case real-FFmpeg buffered-video suite pass with
no skips. Native Main/preload/Core hidden stereo capture, restart, cleanup and
quit ordering pass in `checks/live-host/stereo/events.json`; it uses Chromium's
synthetic input, not a physical stereo device. Logs stay under
`.artifacts/macbook-sharing/checks/`. The first Node invocation used the wrong
Bun output subdirectory and ran no tests; `integrations-02.log` is the corrected
81-test run. No release or package workflow was started.

Remaining qualification is acoustic/physical A/V, an enforced mid-bandwidth
network, physical cross-device/phone/Linux TV behavior and perceptual image
quality. This session supplies no new Windows hardware run; its existing native
60 FPS evidence remains applicable because the tested pipeline is unchanged.
The local gh-stack catalog migration conflict involves another branch, so this
continuation uses a normal fetched/rebased, non-force Git push to the existing
draft PR, without changing that unrelated catalog.
