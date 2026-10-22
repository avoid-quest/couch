# Build and validate Couch live event audio

Status: lab/admission implementation delivered, event capability not qualified,
2026-10-20. Checkboxes below require the full stated gate, not just code being
present. See [measured results and remaining work](live-audio-results.md),
[lab commands and limits](live-audio-lab.md) and [network fixture](live-audio-network.md).
This plan assumes **no locally available phones**. It requires no paid service
to begin and does not authorize purchases or deployments. It builds on the
[code audit and research](live-audio-event-research.md) and the
[test options research](live-audio-test-options.md).

## Outcome and boundaries

Deliver one audio program to **50 simultaneous listeners**, with 100 as a
separately qualified stretch target, on dedicated venue Wi-Fi. Support live
sound-card input and music Couch can load ahead, for private listening and
phones playing aloud. Keep the live **capture-to-acoustic-output target at
100 ms maximum**; do not quietly replace it with an average or percentile.

Build an automated lab that can establish server capacity, real browser
decode/render performance, software output alignment, congestion behavior and
recovery without owning phones. A second track can use rented remote devices
for mobile compatibility. Acoustic phone latency and a crowded venue's radio
behavior remain explicitly unqualified until a physical measurement exists.
That distinction lets development finish without presenting simulation as
physical proof.

Known-ahead music gets prebuffered scheduled playback. Audio captured from a DJ
application or external mixer remains a live input even if the music is recorded.
Video, arbitrary internet/mobile-data delivery, Bluetooth latency qualification,
and a new native mobile app are outside the first implementation.

## Decisions to test before committing to architecture

- Reuse Couch's clock, authenticated device model and encode-once grouped
  sender. First investigate **direct timestamped audio ingestion**, skipping
  MediaRecorder, HLS and the intermediate AAC encode/decode.
- Test the existing Sendspin renderer and transport with small live packets.
  A lower buffer constant alone is insufficient: receiver scheduling,
  output-latency compensation and stale-audio handling must fit the budget.
- Keep an SFU as a conditional option for the direct WebRTC route. It solves
  publisher fanout, not synchronized speaker emission. Do not require two new
  delivery stacks before measuring the simpler path.
- Preserve the ordinary buffered playback policy outside the event mode.
  Event playback must not silently move a listener to seconds-late HLS.
- The pinned server SDK cannot accept encrypted `source@v1` today. Verify an
  upstream solution or a narrow authenticated ingestion adapter before choosing
  the production integration; never bypass Couch admission to make a demo work.

## What the no-phone lab will contain

**Source → real Couch capture/ingestion → Core/selected transport → independently
impaired receiver connections → real browser decoder and renderer → individual
virtual audio outputs → continuous PCM analysis.**

Start with the repository's pinned Electron runtime and native-test pattern,
using separate browser processes/profiles and actual Couch client code. A
network namespace alone does not isolate a browser's audio output: give every
receiver a separately identifiable sink/monitor. Use a private PulseAudio or
PipeWire test session; leave the owner's default output and session untouched.
Build against the production assets rather than a rewritten test player.

Use protocol-only clients for cheap admission/fanout tests, explicitly labelled
as such. A claim about 50 browser listeners requires **50 active real decoding
and rendering paths**, with evidence of output from every receiver. Several
tabs in one browser do not represent independent audio hardware or clocks.

Linux `tc netem` and traffic shaping on disposable network namespaces cover
UDP and TCP, both directions, per-receiver links and a shared bottleneck.
Browser DevTools HTTP throttling is not the WebRTC network emulator. A shaped
link models selected failure modes; it does not reproduce Wi-Fi contention,
power saving, interference, roaming or 50 distinct radios.

The first recording harness must place source and output samples on a common
graph timeline; starting separate WAV files at approximately the same time is
not synchronization. Preserve raw measurements and calibration corrections.
A virtual monitor may expose audio before its scheduled presentation, so neither
its callback arrival time nor the browser's own claimed timestamp is sufficient
without calibration. Prefer one supported audio backend initially, not two.

One capable Linux computer is enough to develop the harness with two clients.
Before larger runs, measure per-client CPU/RAM and reserve capacity for the
source/Core and instrumentation. Shard clients onto other computers or Linux
VMs when needed. Worker saturation makes a capacity run inconclusive; it must
not be reported as either a Couch capacity limit or a pass. No server size or
cloud bill is assumed in advance.

## Proposed acceptance contract

These are initial engineering gates to freeze in A1 before changing playback.
The software budget is a deliberate allocation, not a prediction of phone DAC
latency. If it proves infeasible, record the failure and revisit the design;
do not weaken a gate retrospectively to turn a red result green.

| Area | Acceptance and evidence |
| --- | --- |
| Physical live target | Every observed capture-to-speaker measurement ≤100 ms on a qualified physical setup. This remains **unmeasured** in the no-phone lab. No finite test establishes an all-time maximum. |
| Live software budget | Every detected reference marker reaches each active receiver's virtual output within **60 ms**, including the measurement uncertainty bound, during the accepted steady-state profile. Reserve the remaining 40 ms for excluded input/output hardware and margin; this reserve does not certify any phone. Report p50/p95/p99 and observed maximum per receiver. |
| Synchronized software output | Maximum observed inter-receiver skew **≤5 ms** for the same marker, including clock/measurement uncertainty. Label this virtual-output alignment. Physical speaker skew remains unmeasured. |
| Clean audio | No missing/duplicated/out-of-order markers, unexpected mute/disconnect, or renderer underrun in the clean run. Verify channel mapping and clipping separately. |
| Impaired audio | In the mild profile below: ≤1% missing/concealed source duration per listener and no interruption longer than 100 ms; every emitted marker still meets the live software deadline. Report concealment separately from missing audio. These are proposed quality gates, not perceptual guarantees. |
| Admission | 50 valid participants can pair/join in a burst; 100 is the stretch run. After a completed audio-unlock gesture, all eligible clients start within 10 seconds. No publisher disconnect from legitimate signaling; malformed/repeated attempts remain bounded. Startup is reported separately from steady-state media age. |
| Failure isolation | One slow/offline receiver cannot change healthy receivers' presentation deadline, restart their encoder, or accumulate stale audio indefinitely. Over-budget receivers are reported and excluded/muted, not silently marked healthy. |
| Recovery | After a fault ends, eligible clients recover within 5 seconds after clocks/media are ready; record the entire outage and recovery duration. Rejoin at the current timeline, with no old-audio replay. |
| Duration | Three 30-minute qualification runs at 50 clients with distinct recorded seeds; then a two-hour soak with churn. Qualify 100 separately. No monotonic queue, connection, process or memory growth; report CPU headroom on the named machines. |

An absent marker is a failure/dropout, not a missing latency sample to discard.
Intentional muting or receiver exclusion cannot manufacture a capacity pass:
report requested, admitted, actively rendering and excluded counts separately.
Warmup is fixed in advance, capped and reported; no discarding bad windows after
seeing results. Invalid measurement/worker overload is **inconclusive**, not pass.

## Repeatable scenarios

Numbers below are deliberately defined stress inputs, **not measurements of a
real venue**. Store profiles and random seeds in evidence; later replay actual
network traces when they become available. Apply and report one-way impairment
in both directions; do not accidentally double an intended RTT.

| Profile | Configuration | Expected result |
| --- | --- | --- |
| N0: baseline | No injected loss; 2 ms one-way delay ±1 ms; shared 20 Mbps downlink cap, independently controlled uplink. | All clean gates at 50, then 100. Also record a no-impairment control. |
| N1: mild variation | 5 ms one-way delay ±3 ms; 0.1% seeded loss; same shared cap. | Live deadline, alignment and impaired-quality gates; measure packet-loss concealment. |
| N2: one bad receiver | One receiver at 60 ms delay ±20 ms, 2% loss and 128 kbps cap; others N0. | Bad receiver is visible/excluded as necessary; healthy group remains within N0 gates. This does not qualify all 50 listeners. |
| N3: common outage | Drop traffic to all receivers for 200 ms and, separately, 2 seconds; restore N0. | Outages count as outages; no late replay or global deadline creep; bounded recovery. |
| N4: difficult connectivity | Block direct UDP; exercise actual configured TURN/TCP; also refuse relay access. | Report selected route; either meet the same target or show unsupported/unavailable. Never count buffered HLS as live success. |
| N5: lifecycle and churn | Simultaneous joins; 10 receivers leave/rejoin; publisher restart; revoke one participant; change a codec/output route; suspend a receiver process. | No cross-participant disruption, stale generation, leaked process or wrong-source playback. |
| N6: clock and CPU stress | Model ±50/100/200 ppm output-clock drift, clock-estimator resets and output-delay changes; separately constrain worker CPU and stall the JS thread. | Scheduler corrects or reports loss of qualification, with bounded queues and recovery. Modelled drift is not physical oscillator validation. |
| N7: asymmetric and overloaded links | Sweep 2/10 and 10/2 ms forward/reverse delay; step the shared bottleneck from 2× to 1.2× to 0.8× measured offered load; include seeded correlated-loss bursts. | Clock bias is measured or bounded; overload/burst-loss intervals count as degradation, not continuous-service passes. Healthy feasible routes keep their deadlines; queues stay bounded and recovery is measured. |

For N6 use explicit clock/output models at a narrow scheduler test seam;
do not monkey-patch global wall-clock APIs and pretend the real audio hardware
clock changed. Keep deterministic clock-model results separate from real-browser
integration measurements. For multi-host recordings, quantify clock mapping
uncertainty; if it exceeds the skew budget, that run cannot qualify skew.

## Ordered task list

Each item should produce a small reviewable change and its evidence. Dependencies
refer to task IDs; conditional tasks are recorded as not needed only with the
corresponding measured decision. The implementation status below distinguishes
available code from complete qualification; unchecked tasks are still required.

| Task | Implemented evidence | Remaining gate |
| --- | --- | --- |
| A1 | Typed frozen contract; false-pass regressions | Complete |
| A2 | Unique PCM, bounded analyzer, private native graph, exact known-delay calibration | Capture/presentation bounds, speech/music, stereo/clipping |
| A3 | Disposable networking/audio IPC; control/N0/N1/N2; route/counter and cleanup tests | Clock models, CPU quotas, N3–N7 |
| A4 | Two-browser WebRTC and buffered-live baselines | Known-ahead music and 10-client fanout |
| B1 | Bounded 50/100 HTTP bursts with existing identities | Complete for existing admission model |
| B2 | Separate budgets and paced offers; 50-peer protocol recovery | 50 real browser negotiation/recovery; 100 protocol recovery fails |
| C1/C2 | Authenticated test-only PCM capture/sender; native integration and diagnostics | Two-output latency/skew and complete clock/path calibration; N0/N1 |
| C3 | Measurements establish no qualified production choice yet | Two-output gate and a defensible architecture decision |
| D/E/F | Conditional production, UI, compatibility and capacity work | Blocked behind C3 |
| G1/G2 | Manual bounded lab commands and a scoped results report | Full regression/capability release qualification |

### A. Establish measurements before modifying the audio path

- [x] **A1 — Freeze the acceptance contract and evidence schema.** Extend
  [tests/evidence.ts](../tests/evidence.ts), reusing `couch-evidence/1`. Record
  commit/dirty state, runtime/OS, worker resources, actual codec/packet duration,
  route, sample rates, source/receiver counts, network profile/seed, clock mapping
  error, per-client distributions, dropouts/concealment, queue age/bytes, CPU/RSS,
  fixed warmup and untested conditions. Separate `protocol`, `virtual-output`,
  `emulator`, `remote-device` and `acoustic` evidence. **Done:** a report cannot
  label an unmeasured acoustic or Wi-Fi condition passed.
- [ ] **A2 — Build and calibrate the audio measurement harness.** Generate
  continuous identifiable PCM (nonrepeating markers plus speech/music fixtures),
  feed a virtual capture device through real capture, and record source reference
  and each receiver's output separately. Analyze cross-correlation/sample timing
  continuously; retain compact metrics and bounded PCM around failures. Include
  the source-to-capture delay in a separate calibration rather than losing it.
  **Depends:** A1. **Done:** inserting known 20/80/150 ms delays is detected
  within a documented error bound (initial goal ≤2 ms), and silent, wrong-source,
  stalled and out-of-order outputs fail even when packets/timestamps arrive.
- [ ] **A3 — Build isolated impairment and resource controls.** Add disposable
  namespaces, veth routing, per-client and shared shaping, both UDP/TCP directions,
  CPU limits and explicit clock-model fixtures. Provision only task-owned network
  and audio resources, record every PID, and clean them on exit. **Depends:** A1.
  **Done:** packet captures/counters verify the intended path cannot bypass
  shaping; fault parameters and resource limits are reproducible.
- [ ] **A4 — Record current-route baselines.** Run two real receivers through
  direct WebRTC, current In sync and known-ahead music; record 2/10-client direct
  fanout cost where resources permit. Use existing Node tests for routing and
  permission regressions, not audio-quality proof. **Depends:** A2, A3.
  **Done:** artifacts explain current latency and scaling costs, and the existing
  buffered path demonstrably fails the new live target without modifying it.

### B. Remove event admission and signaling obstacles

- [x] **B1 — Make admission support an event burst.** Design a bounded event
  invitation/admission policy using existing Couch identities and roles; remove
  the successful-join bottleneck in the global 20-attempt window without simply
  disabling limits. Test valid simultaneous joins alongside invalid/replayed
  attempts and revoked access. **Depends:** A1. **Done:** 50 valid pairings
  complete under the admission gate and abuse handling remains bounded.
- [ ] **B2 — Budget signaling separately from user commands.** Fix the shared
  60-messages/second limit for authenticated offers/candidates; pace negotiation,
  bound per-peer work and preserve authorization. **Depends:** A1.
  **Done:** a real 50-peer negotiation/reconnect burst cannot disconnect the
  publisher; malformed/excessive signaling still fails predictably.

### C. Prove a small low-latency synchronized audio path

- [ ] **C1 — Prototype direct authenticated ingestion.** Feed small timestamped
  PCM or Opus frames into the existing grouped sender, mapping source sample
  position to Core's monotonic clock. Compare a verified SDK upgrade with a
  narrowly scoped adapter; measure codec lookahead and packetization. Start with
  one supported source/codec and two browser outputs. **Depends:** A4.
  **Done:** no MediaRecorder/HLS/AAC intermediary or unintended video track;
  actual decoded output is measured and authorization survives stop/revoke.
- [ ] **C2 — Test short-lead scheduling and output compensation.** Compare
  20 ms and 10 ms packets; account for the server tick, browser queue processing,
  declared receiver lead, output-latency estimates, Apple compensation heuristic,
  clock uncertainty, drift and late joins. Keep configured, estimated and measured
  delays distinct. **Depends:** C1, A3. **Done:** two real browser outputs meet
  the software latency/skew gates under N0/N1, or a precise failing stage is
  documented; no unexplained subtraction makes the result pass.
- [ ] **C3 — Decide the production architecture from those results.** Record
  capture format, clock ownership, transport, scheduling, supported receivers,
  SDK changes and stale-audio policy in an ADR following the repo's domain-modeling
  instructions when that ADR is written. **Depends:** C2.
  **Done:** choose the proven path. If browser scheduling or TCP head-of-line
  blocking is the limiting stage, do one narrowly scoped alternative experiment
  before choosing a new transport/renderer. An SFU alone is not a sync solution.
  If the two-client target still fails, retain an explicit blocked capability;
  do not proceed to claim a 50-client solution.

### D. Implement the proven audio path and fault policy

- [ ] **D1 — Productionize ingress and capture lifecycle.** Implement the C3
  decision for selected sound-card input, sample-rate/channel negotiation, format
  changes, source stop/restart and revoked publishers. Reuse the existing capture
  and identity layers. **Depends:** C3. **Done:** continuous speech/music with
  correct channels and gain, no unintended DSP, no orphan capture or old-source
  packets after a generation change; isolated native capture smoke coverage.
- [ ] **D2 — Bound live audio age at every queue.** Add deadline-aware queues,
  stale-frame dropping/concealment, group clock continuity and per-receiver
  recovery. Resolve the pinned SDK's wait-and-send audio backpressure behavior
  upstream or at the verified integration boundary. Avoid letting one late
  receiver move the whole group's deadline. **Depends:** D1.
  **Done:** N2/N3 stay bounded; healthy listeners remain on time and recovering
  listeners do not replay buffered history. Quality failures still count.
- [ ] **D3 — Make codec support and late joins predictable.** Prefer one
  compressed audio format where supported; explicitly budget/reject a PCM-only
  live participant rather than silently increasing load or bypassing the deadline.
  A new format must not restart existing healthy listeners' encoder. Preserve
  normal buffered compatibility outside event playback. **Depends:** D1, D2.
  **Done:** mixed-capability clients, format changes and late joins have bounded
  bandwidth, clear status and no healthy-group discontinuity.
- [ ] **D4 — Add a local SFU only if measured fanout requires it.** Compare an
  established implementation against the direct-publisher baseline; carry one
  encoded source into the relay, retain per-device authentication/revocation and
  report the selected media route. **Depends:** C3, F1 baseline, B2.
  **Done:** a measured CPU/uplink or admission advantage at the target population,
  without breaking latency/recovery. Otherwise close as unnecessary. If this
  adds a packaged helper, inspect t3code's helper/resource approach first and
  include lifecycle, platform runtime and packaging verification.

### E. Make participation usable and exercise mobile compatibility

- [ ] **E1 — Add the smallest event participation flow.** A participant joins
  and unlocks audio locally, controls their own level/leaving, and cannot change
  the event's global queue/transport. Show joining, playing, unsupported and
  interrupted states; keep late-HLS fallback out of the live event. Reuse Couch's
  surfaces/components, update the affected surface docs first, and consult the
  official shadcn catalog per [design.md](design.md). **Depends:** B1, B2, D2, D3.
  **Done:** a crowd can join without per-person host operations; consent,
  autoplay refusal, certificate/origin prerequisites and reconnect are tested.
- [ ] **E2 — Run the no-phone compatibility matrix.** Exercise Chromium via
  the existing Electron runner, desktop Firefox, and actual desktop Safari if
  a Mac is available; use Android Emulator and additional WebKit automation for
  useful API/lifecycle coverage where supported. Require real codec/track output
  checks and a user-gesture path; do not globally disable autoplay policies for
  that suite. **Depends:** E1. **Done:** a versioned support matrix reports pass,
  failure or untested, not "iOS tested" from a viewport or WebKit emulation.

### F. Qualify scale, recovery and sustained playback

- [ ] **F1 — Build the full-browser worker pool.** Run 2 → 10 → 25 → 50
  receivers, then 100 separately, each with unique identity and captured output.
  Use a separate source/Core resource allocation; distribute receivers when the
  worker baseline cannot sustain them. Run protocol-only load as a distinct suite.
  **Depends:** A2, A3; use A4's current route for baseline and D1–D3 for candidate
  qualification. **Done:** output evidence exists for every active receiver;
  increasing workers distinguishes harness saturation from application limits.
- [ ] **F2 — Run the fault and interoperability matrix.** Apply N0–N7, separately
  verifying known-ahead music and live input. Exercise bulk joins, mixed codecs,
  slow readers, lost clocks, TCP recovery, relay failures, permissions/revocation,
  route changes, mute/unmute and stale sessions. **Depends:** F1, B1, B2, E1.
  **Done:** required-profile gates hold per listener; failed optional routes are
  explicit unsupported outcomes, with no silent fallback or averaged-away outlier.
- [ ] **F3 — Run repeatability and endurance qualification.** Execute the three
  30-minute runs and two-hour soak; compare 10/20 ms packets and selected bitrate
  using the same sources/profiles. Run a second worker distribution to expose
  shared-host artifacts. **Depends:** F2 and D4 if the architecture selected it.
  **Done:** a reproducible capacity report lists the largest tested population,
  machine topology, deadline/skew/quality results and resource headroom. Never
  extrapolate a 10-client run or 100 protocol sockets to 100 rendered listeners.

### G. Automate evidence and make the release claim match it

- [ ] **G1 — Add bounded manual regression runs.** Keep fast routing/admission
  tests separate from the privileged/long audio lab. Add a manual lab entrypoint,
  preserve failing artifacts and cap time, storage and process lifetimes. Integrate
  CI only after the harness is stable; use a suitable runner with required namespace,
  audio and CPU capabilities. **Depends:** F2. **Done:** documented rerun commands
  reproduce a report from a clean checkout. Workflow/packaging edits pass `act`
  with `catthehacker/ubuntu:full-latest` before manual dispatch, per [ci.md](ci.md);
  macOS/native and timing claims are verified on their actual targets separately.
- [ ] **G2 — Publish an explicitly scoped capability report.** Include the
  tested software envelope, browser matrix, known unsupported outputs, setup
  requirements, fallback/recovery behavior and unresolved physical limits.
  Gate new behavior behind an explicit event option until qualified.
  **Depends:** E2, F3, G1. **Done:** a software-validated event preview can be
  evaluated without claiming "50 phones guaranteed below 100 ms".
- [ ] **G3 — Optional remote hardware qualification.** First rent a small
  selection of Android/iOS devices through a lab for browser/codec/lifecycle
  compatibility. Before spending, verify access, media transport, audio capture,
  automation and concurrency capabilities with a one-device pilot. For physical
  timing, commission a lab/operator with synchronized reference/output recording
  and the actual dedicated-AP topology; ordinary cloud session audio/video is
  not sufficient. **Depends:** E1 for an early compatibility pilot; G2 for final
  physical qualification. Optional for software preview, required before a
  measured phone/venue performance claim. **Done:** the report separates devices measured from
  devices only covered by inference. The user never needs to own a phone fleet.

## Practical execution order

**First reviewable batch:** A1 + A2, then A3 + A4. This produces the measurement
tool and an honest failing baseline before changing the live path. B1/B2 can
follow independently while C1/C2 investigate feasibility. The core critical path
is **A1 → A2/A3 → A4 → C1 → C2 → C3 → D1–D3 → F1–F3 → G2**; E1/E2 and G1
join before G2. D4 and G3 are conditional branches, not automatic dependencies.

Use the existing Node integration and Electron-native test conventions in
[ci.md](ci.md), [tests/live-close.native.ts](../tests/live-close.native.ts) and
[tests/evidence.ts](../tests/evidence.ts). All scratch runs get their own
`COUCH_DATA_DIR`, reserved `COUCH_PORT`, browser profiles and PID-owned cleanup.
Never alter the installed Couch, its data, the owner's audio defaults or the
host's ordinary network interface to run an impairment test.

The first milestone is **a trustworthy no-phone test lab**. The second is
**two real browser outputs meeting the software target**. The third is
**50 real browser outputs passing sustained and impaired tests**. Phone-acoustic
and venue-radio qualification is a separate, optionally outsourced milestone;
it cannot be replaced by a more optimistic emulator setting.
