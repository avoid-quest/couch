# Sendspin 5.0.0 integration and measurement audit

Couch now uses the unmodified published `@sendspin/sendspin-js` 5.0.0 release
with SDK-owned Noise. Native input acquisition, FFmpeg conversion/encoding and
Couch's existing authorization remain. The playback buffer is a saved operator
setting in the sharing UI; changing it does not require rebuilding Couch.

The field result is **partial, not a stability qualification**. Two fresh-start
12-second checks at 150 ms delivered the intended signal at approximately
151 ms electrical delay. A six-minute 100 ms attempt delivered no reliably
matching programme signal. Changing that failed running source to 150 ms did
not restore it. One later confirmation was invalid because the receiver harness
expired; it provides no product result. All failures and raw data are retained.

## Integration changes

- Browser SDK 5.0.0 is the latest npm release checked on 2026-10-27, source
  [`7d103075`](https://github.com/Sendspin/sendspin-js/tree/7d103075138dda5c8909045647bb42b33c2d44fc).
  It includes the official [timing correction #159](https://github.com/Sendspin/sendspin-js/pull/159).
  Neither SDK is patched. Node SDK remains 0.6.2.
- The server passes its persisted SDK `Identity` and `SENTINEL_RESOLVED` to the
  public `SendspinSession` constructor. It reuses the existing `sendspin_identity`
  table/key when present. Couch's token, origin, remote-access and Device checks
  still run before admitting the SDK's `client/init` identity.
- Public `loadSendspinClientIdentity(storage)` supplies the control connection's
  Device ID. The player uses the same storage/identity. Existing authenticated
  tokens rebind changed IDs without another pairing flow.
- The public `suite: "aesgcm"` option is necessary for this Electron runtime:
  direct runtime inspection found `chacha20-poly1305` absent and `aes-256-gcm`
  present. The default ChaCha handshake failed on the Mac before recording;
  AES-GCM completed. This changes the Sendspin connection, not the capture format.
- **Playback buffer (ms)** is editable in the host sharing popup and persists
  through the existing settings API. Its initial value is now 150 ms, not a
  lower bound, optimum or measured physical-latency promise. The panel asks users
  to restart sharing after a buffer change. There is no automatic tuning engine,
  custom decoder, clock, DSP or transport.

The new label/restart instruction was verified in the staged app. Values 100 and
150 were selected through the UI; no rebuild was used to switch between them.
The final initial-value/label build was separately staged and checked at 150 ms.
The existing UI range and permissions remain; saved choices take precedence over
an initial default.

## What the electrical measurement actually measures

The UMC404HD plays the existing stereo pink-noise stimulus on outputs 3/4 and
records four inputs in one CoreAudio callback on one hardware sample clock:

1. Inputs 1/2: reference loopback, also acquired by Couch's native source.
2. Input 3: Linux analog output return.
3. Input 4: Android analog output return.

The owner confirmed unchanged physical wiring/gains. Capture is stereo 48 kHz,
128 requested/reported native frames; both receivers negotiated 48 kHz stereo
Opus, volume 80%, unmuted. This measures electrical reference-to-return delay,
including the application, network, output backend and analog output path.
It is not an acoustic input-to-ear measurement or a measurement of each internal
component's contribution. Browser clocks and configured buffer values are not
used as the latency verdict.

The original analysis compares 0.5-second signal windows every five seconds
using normalized cross-correlation, searching 0–1500 ms. Correlation below 0.4
rejects the window. Rejected windows are retained, and no latency percentile is
reported when none pass. Separately, 10 ms RMS bins inspect the entire analyzed
active interval for levels below 10% of its median, with a noise floor. The
threshold is an analysis convention, not an audibility standard. Low-level spans
on a return that never carries matching programme cannot be counted as distinct
programme dropouts.

Long-run timing coverage is sampled: those windows cover about 10% of elapsed
time, so narrow percentiles alone cannot demonstrate continuity. The level
analysis covers [3,359) s; it excludes startup/tail and cannot identify every
click, distortion, pitch change or missing packet. Short checks inspect [3,11) s,
with 0.5-second timing windows at 0.5-second spacing: 16 windows per receiver.

No heap inspection, Runtime calls, SDK polling, observer reacquisition or UI
operations occurred during the recordings. Setup probes and ordinary controls
occurred before/between them. The final checked recorder waits ten seconds after
its fresh receiver probe before starting. Earlier evidence established that heap
queries can disturb playback; those confounded cases are not silently reused as
proof of spontaneous defects.

## Audit of the analyzer and test validity

The owner's concern prompted explicit checks rather than another latency claim:

- Known 0/100/150/250 ms delays applied to the recorded reference were recovered
  correctly; maximum numerical error was below 0.001 ms. This checks sign,
  sample-rate conversion, indexing and units, not physical rig calibration.
- A separate implementation uses antialiasing/downsampling and direct NumPy
  time-domain correlation instead of full-rate SciPy FFT correlation. It agreed
  with six checks in the previous valid 3.2.1 recording within 0.09 ms, and with
  six checks in the final valid 150 ms recording within 0.11 ms. It also rejected
  the new near-silent 100 ms returns. Both methods share the correlation principle;
  agreement does not independently prove the wiring or every physical assumption.
- The six-minute capture has coherent callback positions, no recorder overflow
  and zero sample-position discontinuities. Raw reference levels match the older
  valid recording. The return levels are much lower, and all 71 timing windows
  fail on each receiver. No physical latency number is inferred from that run.
- SDK `isPlaying`, synchronization and negotiated format were insufficient
  preflight: they did not prove the intended signal reached the outputs. Future
  long tests must first pass a short, real reference-to-return signal check in
  the selected mode/settings.
- A stale preflight receipt incorrectly admitted a later 12-second recording
  after the Linux launcher reached its 1500-second lifetime. Both Join commands
  had failed. That was an orchestration error, not a Sendspin result. The clip
  is marked invalid. A fresh connected/playing/synchronized receiver check now
  runs before the recorder; a deliberate absent-receiver invocation proved it
  aborts before touching the original recording receipt or launching hardware.
- The SDK integration test now sends a nonzero stereo signal with opposite
  channel polarities and asserts those samples survive capture conversion,
  encryption and SDK decoding. Receiving correctly shaped zero arrays alone is
  no longer treated as sufficient content-delivery evidence.

Earlier Leave/Join runs also showed the intended return channel disappearing
while the reference/peer stayed active. That supports channel assignment. No
new physical pass-through calibration was performed here, so these checks do
not supply a calibrated absolute error bar or validate acoustic/fidelity claims.

## Field results

| Condition | Duration | Linux median / p95 | Android median / p95 | Interpretation |
| --- | ---: | ---: | ---: | --- |
| Fresh 100 ms, updated SDK | 360 s stimulus | No estimate; 0/71 accepted | No estimate; 0/71 accepted | Intended output signal not established |
| Fresh 150 ms, first diagnostic | 12 s | 150.5 / 150.7 ms | 150.5 / 150.7 ms | 16/16 accepted each; no detected ≥20 ms attenuation in [3,11) s |
| Fresh 100 ms contrast | 12 s | No estimate; 0/16 accepted | No estimate; 0/16 accepted | Reproduced absence of a matching return |
| Same source, UI changed 100 → 150 | 12 s | No estimate; 0/16 accepted | No estimate; 0/16 accepted | Live value change did not restore this failed stream |
| Confirmation after harness expiry | 12 s | Invalid | Invalid | Receivers were not joined; excluded from product conclusions |
| Fresh 150 ms, final build | 12 s | 150.5 / 150.8 ms | 151.4 / 151.8 ms | 16/16 accepted each; Android attenuations remain |

In the final valid check, Android had two level attenuations: 30 ms at 9.66 s and
20 ms at 10.46 s. Linux had none. Median Android-minus-Linux skew was 0.93 ms,
p95 1.24 ms. All 16 timing windows still passed: a concrete example of why
latency percentiles and signal continuity must be reported separately.

Fresh 150 ms startup is a reproduced functional operating point on this rig,
not a stable minimum. The failed 100 ms state and unsuccessful live recovery
show that startup/history matters; this does not locate the responsible
component or establish a protocol/browser floor. The 150 ms initial setting
avoids making the observed failed 100 ms condition the starting experience.
It remains selectable. No local timing/DSP fix was added to conceal the failure.

At the same 150 ms configuration, the earlier SDK 3.2.1 measurement was about
305/312 ms. The short new checks are about 151/151 ms. Their durations and
continuity evidence differ, so this supports an upstream latency improvement
without qualifying a further stable reduction or promising 30 ms.

## Verification, evidence and cleanup

Type checking and the production build pass. There are 45 passing targeted Node
integration checks and 14 passing unit/native-authority checks. The enhanced
nonzero-content SDK cases also pass. Checks cover Noise/AES-GCM, Device-token
binding, identity persistence, reconnect, native authority, source continuity,
PCM/Opus delivery, relaxed lead, listener permissions and failure isolation.
No CI, packaging, release or push was started.

Evidence:
`.scratch/sendspin-field/20261027-171926-upstream5-live100/`.

It includes complete recordings/timelines, per-condition validity labels,
original/updated recorder scripts, all rejected windows, short analyses, raw
levels, the measurement audit and independent calculation, UI/settings receipts,
failed handshake logs, the explicit invalid confirmation, guard check, source
patch and staged archives. `recording-sha256.json` confirms local/remote hashes
for every raw recording. Final valid `final150/rig.f32` SHA-256:

`d462622e5ef8fcca521c2328f1cba1f2cbd40d5c4d3a1e4f9352833b65911c90`

All measurement-owned processes stopped. UMC returned to 48 kHz / 512 hardware
frames. Original native phone tabs, Wi-Fi/stay-awake settings and USB permissions
were preserved/restored; the owned tab and task ADB forwarding/daemon were
removed. One pre-existing empty synthetic debugger target stopped enumerating;
the difference is recorded rather than reopening it. Installed Couch/data and
pve1 networking were untouched. The separate preview 48760 remains on its previous
build. The updated test app is stopped, with its isolated data saved at 150 ms.

The next useful work is ordinary music/voice listening and a focused check of
startup/continuity and buffer-change recovery on this same upstream integration.
First prove signal presence in each selected condition. Do not launch another
latency campaign, infer causes from percentiles, impose a numeric floor, or
replace the audio engine based on these observations.
