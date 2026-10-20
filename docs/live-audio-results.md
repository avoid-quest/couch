# Live event audio: implementation and measured limits

2026-10-20, measurements captured before committing the implementation, from a
worktree based on `1dcfb69`. The no-phone
lab and admission improvements are implemented. **A 50-listener event below
100 ms is not qualified.** The two-browser software gate is still the prerequisite
for selecting and exposing an event audio path.

## What is implemented

- A Linux lab with actual browser capture and independent Electron receiver
  processes, private PulseAudio/JACK outputs, identifiable PCM and common-graph
  sample measurements. Synthetic analyzer tests are separate from native runs.
- Rootless user/mount/IPC/PID isolation with private shared memory and bounded
  process cleanup. Standalone runs use offline loopback; the network wrapper
  provides bidirectional control/N0/N1/N2 profiles, shared caps and route evidence.
- Typed evidence with fixed 60 ms software latency and 5 ms output-skew gates.
  Missing calibration, telemetry or worker headroom prevents qualification.
- Bounded event-sized pairing and separate authenticated signaling budgets,
  with paced browser offers. Existing Couch roles and the invalid-code lockout
  are preserved; this is not a new event invitation or participant role.
- A **test-only**, two-receiver PCM ingress prototype using real AudioWorklet
  capture and the official encrypted Sendspin renderer. It preserves source
  sample positions, bounded queues, stop/revoke behavior and fixed deadlines.

The prototype is not mounted by production Couch. No event UI, SFU, native
mobile client, packaging change, CI workflow or deployment was added.
Its 48 kHz, 16-bit stereo PCM costs 1.536 Mbps per receiver before overhead:
76.8 Mbps for 50. Smaller packets do not reduce that payload rate. A supported
compressed format and measured fanout remain prerequisites for scale.

## Measured baseline

These are short virtual-output observations. Latency includes virtual capture;
no guessed capture/output delay has been subtracted. Unknown presentation
corrections remain null. The results do not measure sound leaving a phone.

| Route | Setup | Maximum raw latency per output | Maximum raw skew | Completeness and graph health |
| --- | --- | --- | --- | --- |
| Known-delay graph calibration | Three outputs, 5 s, 512-frame quantum | Exactly 20 / 80 / 150 ms | Deliberately different delays | 50/50 markers each; zero xruns/overflow; sample error bound 0.0417 ms |
| Production WebRTC | Two browsers, N0, 15 s, 512-frame quantum | 148.94 / 165.96 ms | 17.04 ms | 130/130 markers each; zero xruns/overflow |
| Production In sync, live input | Two browsers, loopback, 8 s, 512-frame quantum | 2587.00 / 2595.02 ms | 10.08 ms | 56/60 and 59/60 markers; zero xruns/overflow |
| WebRTC control, isolated backend | Two browsers, routed control, 8 s, 1024-frame quantum | 144.23 / 157.60 ms | 13.38 ms | 60/60 markers each; zero xruns/overflow |
| WebRTC zero-buffer preference | Same control settings; requested/read back `jitterBufferTarget=0` | Unmeasured / 157.60 ms | Unmeasured | 0/60 and 60/60 markers; zero xruns/overflow |

The WebRTC baseline exceeds both raw software targets. The buffered live route
adds seconds. WebRTC's independent receive buffers do not establish a common
speaker presentation time. An SFU may reduce publisher fanout but does not by
itself solve that alignment problem.

The known-delay calibration establishes graph/analyzer sample timing only. Its
sample-to-monotonic-time deviation was 9.397 ms; the WebRTC and buffered runs
reported 2.882 and 3.342 ms respectively. Separate capture/presentation bounds,
browser-thread headroom and complete dropout telemetry are still missing, so
formal timing qualification remains inconclusive even where raw metrics exist.
The [compact raw results](live-audio-results.json) preserve distributions, counts,
settings, resource observations and hashes of the original local artifacts.

The narrow WebRTC alternative did not qualify. Actual average receive-buffer
residence from interval RTP counters was 53.67/66.53 ms in the control and
57.68/66.64 ms with the zero request. Readback confirms a preference, not its
implementation. Both runs proved increasing audio bytes on their selected routed
UDP pairs. The missing output cannot be treated as a discarded latency sample;
one comparison also cannot establish that the preference caused the dropout.
The alternative's graph-to-wall deviation was 18.461 ms, another reason to avoid
a positive timing claim. No production buffer preference was changed.

The 1024-frame comparison has its own successful known-delay calibration and
uses identical settings on both sides. It is not an improvement claim against
the older 512-frame N0 baseline. A 512-frame routed control reported two xruns
and is invalid for timing. Two earlier standalone WebRTC runs received no media
because loopback alone supplied no usable ICE route; the runner now rejects
that setup and requires the routed wrapper even for an unimpaired control.

## Timestamped PCM experiment

The source now measures a fixed one-second render-clock envelope before
publication, with at least 100 samples and a frozen 10 ms mapping limit. Mapping
does not change per packet; a later violation stops the source. This is an
observed clock envelope, not a hardware capture timestamp guarantee.

| Packet size | Graph quantum / configured lead | Observations | Observed clock range | Required mapping uncertainty | Outcome |
| --- | --- | --- | --- | --- | --- |
| 10 ms | 1024 frames / 40 ms | 201 over 1000.3 ms | 41.67 ms | 23.69 ms | Unsupported; zero packets published |
| 20 ms | 1024 frames / 40 ms | 201 over 1000.4 ms | 38.77 ms | 22.14 ms | Unsupported; zero packets published |

Both runs also observed a startup input discontinuity of 640 samples. The
worklet discarded the affected partial packet and retained the original sample
grid; it did not splice time across the gap. Earlier native attempts exposed
this packet-assembly defect and an inadequate single-point clock estimate;
regressions cover both fixes. Their startup/invalid artifacts remain recorded.

These two runs establish an unsupported source-clock condition on this
PulseAudio/Chromium backend. They establish **no PCM output latency or skew**.
The smaller 512-frame experiment also exceeded its initial clock estimate and
stopped. A more stable low-latency backend or a capture path with suitable
timestamps needs separate measurement; these results do not prove that every
browser or native route is infeasible. Output-compensation on/off comparisons,
PCM through N0/N1, and meaningful 10/20 ms output-latency comparisons remain
unmeasured because source-clock acquisition did not qualify.

The C3 decision is therefore **blocked capability**, with no production audio
architecture selected. The narrow WebRTC buffer alternative above did not supply
a qualifying fallback. The acceptance limits remain unchanged.

## Admission and recovery

50 and 100 valid HTTP pairings completed in under one second alongside bounded
invalid/repeated attempts. A real HTTP/WebSocket 50-peer protocol scenario
completed setup in 2.47 s and reconnect in 5.41 s without disconnecting the
publisher. This uses synthetic SDP/ICE, not 50 real media decoders. The reconnect
number also exceeds the plan's 5 s recovery allocation, though this protocol
fixture does not measure the full audio recovery interval.

100 initial protocol exchanges worked, but simultaneous 100-peer socket
replacement did not deliver all initial states within 45 s. Repeated Core
routing/state work during joins and departures is the observed bottleneck;
raising the signaling allowance does not resolve it. The opt-in stress case is
explicitly unqualified (`COUCH_LIVE_STRETCH=1`).

Pairing now allows 128 successes/minute, at most two per identity, while retaining
the global 20-invalid-attempt lockout. Signaling has independent bounded socket
and per-peer budgets; the publisher starts at most four offers per 100 ms with
four in flight. A participant still receives the existing controller role, so
restricted audience controls remain separate product work.

## What must happen before an event claim

1. Resolve the measured capture-clock limitation on a suitable backend and
   establish the two-output PCM result and scheduling comparison. A failed or
   invalid result blocks production integration; it does not justify weakening
   the gate.
2. Separately calibrate the actual capture/output path and resolve renderer
   scheduling, output compensation and clock uncertainty. Add speech/music,
   stereo/clipping and continuous dropout measurements.
3. Complete known-ahead music and 10-client baseline measurements, then run
   N0/N1 on the candidate path. The current PCM prototype is localhost-only;
   namespace receivers need authenticated TLS/WSS integration first.
4. Address bulk routing/state fanout and measure real browser negotiation.
   Increase rendering workers through 2 → 10 → 25 → 50 with output evidence for
   every listener and measured worker headroom. Qualify 100 separately.
5. Complete N2–N7 recovery, clock, overload and churn checks, then the three
   30-minute runs and two-hour soak. N3–N7 are not implemented by the first
   network runner. CPU affinity/resource guards do not simulate phone clocks.
6. Add the smallest participant flow and mobile compatibility matrix after the
   audio path is proven. Remote-device rental can test compatibility; physical
   latency, synchronized speakers and venue Wi-Fi need a lab/operator with
   synchronized acoustic recording and the intended access-point topology.

See the [full ordered checklist](live-audio-event-plan.md),
[rerun commands and prerequisites](live-audio-lab.md),
[network profiles](live-audio-network.md), and
[PCM prototype contract](../tests/audio-lab/ingress.md).

## Verification and limits

Production type checking and build pass. Scoped strict checks cover the new
native worker/runner and measurement helpers. Validation includes 67
PCM/evidence/live-client regressions, 14 synthetic worklet/clock regressions,
11 encrypted ingress protocol tests, and 12 namespace/network tests. The
admission suite previously passed seven tests with one explicit 100-reconnect
stretch skip; 93 existing lifecycle/pairing regressions passed after one
buffered-upload fixture was rerun in isolation.

Independent reviews found and fixed contradictory-loss and replay evidence
false passes, a single-output overall-pass bug, a test-only receiver admission
race, and cleanup reentrancy. Codec/filter tails on lossy or uncalibrated paths
now produce inconclusive quality instead of being asserted to prove replay.
The test endpoint requires completed encryption and exact identity before
admission. No production route was implicated by that endpoint finding.

The largest real rendering run here is **two browsers**. Protocol pairing of
100 identities does not qualify 100 audio receivers. Speech/music fidelity,
physical phone output, mobile lifecycle and venue Wi-Fi remain unmeasured.
No CI was dispatched and no paid device service was used.
