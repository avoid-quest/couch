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
presentation. Keep the 30 FPS default until **every** 1080p60 steady sample passes
on both native platforms, with sound. Window minimize/hide/window-only closure
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
automatic receiver buffering. The default stays 30 FPS. Capability predictions
alone do not justify a codec preference; keep the failed experiments with their
reruns and require actual encoder/decoder implementations in the evidence.

### Native Windows evidence

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

### Open gates

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
