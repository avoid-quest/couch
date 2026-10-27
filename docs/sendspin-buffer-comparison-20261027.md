# Sendspin Live 150 ms and 100 ms buffer measurements

These are historical 3.2.1 results. The owner subsequently authorized the latest
upstream SDK and Noise; see the [5.0.0 field run](sendspin-upstream5-20261027.md)
for the updated implementation at 100 ms.

Two fresh native Live shares reproduced the predicted latency savings without
changing Couch or either SDK. **Neither lower buffer is qualified as a new
default:** the Android electrical return had one uncommanded attenuation at
150 ms and three at 100 ms. Linux had none in either run. The original 250 ms
setting was restored.

## Measured results

Each new point used six minutes of the same pink-noise stimulus. The 250 ms row
is the earlier [passive confirmation](sendspin-passive-confirmation-20261027.md),
not a third recording in this comparison. Values below are electrical latency,
measured from coherent source loopback and analog returns, not configured buffer
or acoustic input-to-ear measurements.

| Receiver minimum buffer | Linux median / p95 | Android median / p95 | Median / p95 Android-minus-Linux skew | Uncommanded return attenuations ≥20 ms |
| --- | ---: | ---: | ---: | --- |
| 250 ms, earlier reference | 405.0 / 405.7 ms | 412.9 / 413.8 ms | 8.0 / 9.9 ms | None detected; deliberate recovery gaps excluded |
| 150 ms | 304.8 / 305.7 ms | 312.5 / 313.6 ms | 7.5 / 9.1 ms | Android: one, about 130 ms; Linux: none |
| 100 ms | 254.9 / 255.6 ms | 263.2 / 264.3 ms | 8.1 / 9.6 ms | Android: three, about 120, 100 and 140 ms; Linux: none |

The median savings are approximately 100 ms at buffer 150 and 150 ms at buffer 100,
consistent with the configured presentation lead. This shows that the pinned
player can deliver approximately 255/263 ms on these devices. It does not show
that this point is reliably usable for a show, or establish a JavaScript floor.

Latency percentiles only describe accepted correlation windows, not continuity.
At 150 ms, Linux accepted 71/71 windows and Android 65/71; at 100 ms, Linux 71/71 and
Android 66/71. Every rejected window is retained. The method remains 0.5-second
windows every 5 seconds, a 0.4 correlation cutoff and a 0–1500 ms search range.
A gap between sampled windows can coexist with narrow latency percentiles.

## Android attenuations

The fixed passive observers began before receiver joins and were never restarted
during either recording. There were no heap queries, SDK polling, Runtime
inspection, UI actions or deliberate Wi-Fi interruptions during recording.
Consequently these events cannot be attributed to our earlier observer restart
in this run. They do not resolve the cause of the earlier confounded events.

| Configured buffer | Recording interval | Duration | Android median amplitude versus nearby normal level |
| --- | --- | ---: | ---: |
| 150 ms | 237.01–237.14 s | 130 ms | 2.2% |
| 100 ms | 57.25–57.37 s | 120 ms | 0.44% |
| 100 ms | 57.53–57.63 s | 100 ms | 0.52% |
| 100 ms | 325.17–325.31 s | 140 ms | 3.4% |

These are 10 ms RMS-bin detector durations below 10% of the active median level,
not precisely timed acoustic silence. Reference inputs and Linux remained near
normal amplitude. No stream/start, stream/clear or stream/end notification
coincided with an event. Both native captures ended with `captureError: 0` and
`observedFlags: 0`. SDK resync counters were deliberately not collected.

The affected receiver path is established; the component responsible is not.
This comparison does not distinguish network delivery, Android/browser output,
SDK correction/decoding or another device-specific condition. One recording per
setting also does not establish that 150 ms is a safe threshold or that lowering
the buffer caused every attenuation. No repair or extra run was attempted.

## Settings, source and measurement integrity

- Tested implementation: `cd0beb1db1d02655837d1f1f5f3276041a0c41a5`; subsequent
  commits are documentation. Unmodified browser SDK 3.2.1 and Node SDK 0.6.2.
- Same Mac native UMC404HD source, unchanged owner-confirmed wiring/gains:
  inputs 1/2 reference loopback, input 3 Linux return, input 4 Android return;
  rig outputs 3/4 carry the existing pink-noise stimulus.
- Automatic capture rate, actual stereo 48 kHz, native requested/reported 128
  frames; Automatic codec negotiated stereo 48 kHz Opus on both receivers.
  Couch volume 80%, unmuted, as in the earlier reference.
- Both receivers' wire declarations confirmed the intended 150 or 100 ms
  ongoing buffer, startup lead 250 ms and static delay 200 ms before recording.
- Each point used a fresh share. Couch may retain a running capture's lead when
  requirements decrease, so changing only the existing UI field would not prove
  a lower-latency point. One scratch app session served both sequential shares.
- Captures contain 17,328,768 frames / 361.016 s and 17,328,896 frames / 361.0187 s
  including recorder tails. All callbacks 128 frames; zero recorder overflow or
  input/output sample-position discontinuities, and no clipping/nonfinite
  samples on any of the four channels. Analyze the active interval [3,359) s.

Setup initially found the Mac disk full, before any recording. Previous remote
rig recordings/timelines were removed only after SHA-256 verification against
complete local evidence. The 150 ms remote duplicate was likewise removed after
verified local transfer to keep room for 100 ms. No local evidence was removed;
the duplicate-removal receipt lists every path/hash.

## Where 250 ms comes from and what to do next

Couch explicitly sets `defaultLiveAudioSettings.minBufferMs = 250`, matching the
pinned official JavaScript player's `DEFAULT_MIN_BUFFER_MS = 250`. That SDK also
independently defaults startup `requiredLeadTimeMs` to 250; Couch leaves that
startup request unchanged. Those two values serve different purposes and are
not two 250 ms buffers to add. They are configurable choices, not a protocol or
JavaScript language minimum. Source review found no rationale proving 250 optimal
for Couch's devices.

The [cited SDK comparison](sendspin-sdk-comparison.md) found a concrete upstream
opportunity: official JS [PR #159](https://github.com/Sendspin/sendspin-js/pull/159)
removes the old fixed 200 ms scheduling headroom, its compensating platform-delay
defaults, and inconsistent render/output-clock mapping. The exact merged commit
`1e8f4d49f77d63d6d42ba16ef4888d3b801e0f3b` predates Noise and retains plaintext
and the APIs Couch uses. It has not been built or measured here. Published
JS 4/5 include the fix but require Noise; the pre-Noise revision needs a
reproducible upstream-source build rather than a blind npm upgrade.

Do not simply remove a 200 ms constant or promise an additional 200 ms saving.
Static delay is compensation, added by the sender and subtracted by the player;
old persisted compensation also needs deliberate handling in an upstream-fix
comparison. The report scopes that dependency/artifact work and its maintenance
cost. Native host capture remains compatible and should stay in place.

The next bounded step is one comparison with that exact unmodified official
revision at the original 250 ms buffer, retaining the existing reference and
checking both latency and Android continuity. This preserves the original buffer
margin while isolating the upstream timing change. State in advance that this
checks the timing fix; it does not presume that the fix cures Android's gaps.
Then use ordinary music/voice listening and focused recovery evidence before
selecting a lower default. Avoid a new language/backend campaign based on these
numbers: current C++ defaults request 500 ms protocol buffer, and Python defaults
250 ms. Their other buffering controls are different layers, not proof of lower
physical latency. Stable 30 ms remains unestablished.

## Evidence and cleanup

Evidence directory:
`.scratch/sendspin-field/20261027-164424-buffer-comparison`

Each 150/100 subdirectory retains full `rig.f32`, `rig.blocks`, recorder/source/
wire/UI logs, settings readback, analysis scripts, every correlation window,
10 ms RMS data, attenuation details, latency plot and matching local/remote
SHA-256 receipts. Root `comparison.json` combines the metrics; `cleanup.json`
records restoration. Recording SHA-256:

- 150 ms: `149dcac40f511488d1bd3161af18754fe003b273ac5af49f6c5ca994b2e91d6b`
- 100 ms: `064ebc6f79d74fc61a9931a6ce616c99d11754b7e1c47b178801a7b4328334bc`

Original buffer 250 was read back through the sharing UI before source shutdown.
All measurement-owned Mac app/Core/capture/recorder and Linux Chrome/Pulse/Xvfb/
tunnel processes stopped. UMC returned to 48 kHz / 512 hardware frames. Original
phone tabs, Wi-Fi/stay-awake settings and USB ownership were preserved/restored;
only the owned tab was closed, and task ADB forwarding/daemon were removed.
Installed Couch/data were untouched. **pve1 networking was unchanged.** The
separate preview on 48760 remains running.

This is two six-minute electrical pink-noise points, not fidelity, ordinary-content,
phone screen-off, long-duration, audience-size or lowest-stable-buffer qualification.
