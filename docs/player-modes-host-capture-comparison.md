> Historical record. The 2026-10-27 [upstream Sendspin baseline](live-audio.md)
> supersedes custom Live-engine decisions, SDK patches, admission rules and
> performance gates below. Those historical results do not measure this baseline.

# Mac host capture decision

This is a historical record of the Sendspin Live implementation. Its Live
performance gate and SDK work are superseded by [Live audio](live-audio.md);
the evidence below applies only to the revisions it names.

Status: the bounded host comparison is complete. This pass does not justify
preferring native capture. The roughly 50 ms reliability/fidelity gate remains
open for P4/P5/P7, M5/M6/M10 and L1–L4; PR submission remains pending. Native
capture remains an explicit desktop-only candidate, with no automatic selection.
Browser clients continue to use browser capture and output APIs.

## Bounded protocol

**Gain staging is a prerequisite.** Inspect the owned stimulus and product/output
volume chain first. Establish identifiable source and return levels with
conservative peak headroom (about −12 dBFS for this stimulus), no clipping and
fixed matched L/R gains. Pin any changed stimulus/analog gain as a new baseline.
The retained PCM recording has source peaks near −33 dBFS and return peaks near
−68 dBFS; return active/quiet RMS ratio is only about 17.6 dB. These are recorded
levels, not formal SNR/THD or proof of a backend/codec defect. Post-capture
normalization cannot recover SNR. If physical preamp adjustment remains necessary,
record the exact meter/adjustment and continue independent integration work.

Use the two existing input selections in the same signed maintained Mac app:
Chromium capture and PortAudio/CoreAudio capture. The preserved experiment is
`recovery/player-modes-20261026:docs/audio-native-device-controls-research.md`,
section “One next controlled experiment: native ownership at 48 kHz”, plus
`docs/audio-native-reuse-options.md` on that ref. Both were read before setup.

1. Establish one ordinary Chrome/Chromium receiver using the maintained Couch
   browser client and supported public Web Audio preferences. Record its version,
   owned profile, constructor preferences, actual base/output latency and output
   timestamps. Keep Linux audio settings fixed; Electron command-line buffer
   switches and the earlier Electron benchmark do not qualify this route.
2. Freeze package/Core/assets, wire codec/packetization, lead/reserve, browser/
   profile, route/network, levels, identifiable stimulus and coherent witness.
   Use 48 kHz/stereo and request 128 native user frames, matching Chromium's
   delivered frames where supported. Log native HAL readback, native user blocks,
   Chromium delivered blocks and witness blocks as separate observations.
3. Run Chromium then native sequentially, with one producer per generation.
   Require identifiable nonzero input before scoring. Retain capture→Core
   age/jitter/gaps with explicit clock offset/uncertainty, separately from actual
   source→browser analog roundtrip, accepted coverage and waveform defects.
   File-start offsets are not capture latency. Keep all failures.
4. Run one confirmation pair after valid setup. Stop after these two matched
   pairs. A persistent unavailable prerequisite gets one actionable retry, then
   a precise blocker and the available host-stage comparison. A receiver blocker
   ends physical qualification for this pass; continue independent integration
   work. Defer output tuning, rate/buffer sweeps and new receiver implementations.

A common diagnostic lead may make the backend comparison observable; it does
not waive the roughly 50 ms usability reference or change strict admission.
Adopt native capture only for a demonstrated useful improvement in latency,
integrity, robustness or device behavior, with timing uncertainty and repeat
limits included. Controls/readback alone do not prove a latency improvement.
If no useful improvement is established, record that verdict without forcing
native adoption. Preserve both implementations and evidence while deciding.

## Prior evidence and accounting

The earlier Electron codec comparison remains separately identified in
[Live performance](live-audio.md). Its passing intervals and
bad repeats do not answer this host-backend decision.

The read-only older-work audit is
`/home/avoid/.t3/worktrees/couch/t3-9cb20eb2/.scratch/mac-host-capture-audit-20261026/README.md`
and `older-draft-prs.json`. The ledger's G5 tracks the seven drafts and four
follow-on branches, including the now-restored bounded publisher setup. Native receiver
results, the earlier opposite-host stereo experiment and synthetic scale work
remain historical evidence with their original limits.

## Result and adoption verdict

**Keep Chromium as the reference host path.** Native has no demonstrated useful,
repeatable advantage in this bounded pass. Preserve both implementations and
measurements, but do not claim native performance qualification or prefer it by
default. The first native median was 1.19 ms lower; the confirmation difference
was only 0.19 ms, with overlapping timing ranges, lower accepted coverage and
higher timestamp-relative ingress jitter. Controls/readback alone do not earn
adoption. No further sweep or physical trial was started after these two pairs.

| Capture / repetition | Accepted electrical windows L/R | Median L/R, ms | p95 L/R, ms | Waveform flags L/R, of 27,991 |
| --- | --- | --- | --- | --- |
| Chromium / 1 | 54/55 / 54/55 | 57.833 / 57.834 | 58.329 / 58.329 | 27,947 / 27,937 |
| Native / 1 | 53/55 / 53/55 | 56.648 / 56.647 | 57.116 / 57.116 | 27,961 / 27,970 |
| Chromium / 2 | 55/55 / 55/55 | 57.455 / 57.455 | 57.773 / 57.773 | 27,947 / 27,955 |
| Native / 2 | 54/55 / 54/55 | 57.268 / 57.268 | 57.655 / 57.655 | 27,964 / 27,960 |

Every trial fails the unchanged 50 ms electrical gate and original waveform
diagnostic. Median waveform correlation is about 0.967 for both backends; the
improved gains did not eliminate mismatch flags. Reverse/crossed controls accept
zero windows in all four runs. These flags do not isolate codec, analog,
resampling or timestamp effects, nor establish audibility. All raw rows, bad
windows and both successful/failed setup attempts remain intact.

## Matched setup and gain baseline

All four runs used the two existing input selections in the same package and
**ordinary Chrome for Testing 156.0.8078.47**, maintained Couch client, one owned
profile/process, wired LAN, stereo 48 kHz, product Opus-first/10 ms packetization,
**55 ms lead / 20 ms source reserve / strict 35 ms output budget**. This higher
common lead is diagnostic; it does not waive the roughly 50 ms reference.
The strict 45/25 ms trial was refused because this receiver required 29 ms.
A supported 50/30 ms setting was not measured in this bounded pass.

Public output preference was 128 frames, actual constructor
`{sampleRate:48000,latencyHint:0.0026666667}`, base latency 2.6667 ms. Running
output latency was mostly 16 ms, with brief 8 ms samples; timestamp pairs are
retained. No Electron audio-buffer switch was used. Private Pulse kept the
archived ALSA sink configuration and 1 ms request; Linux Master remained −12 dB,
PCM/Front/Headphone 0 dB. No Linux tuning or receiver backend was introduced.
Couch receiver volume was fixed at 100%, unmuted, for the new comparison.

Owner accepted analog baseline `gain-meter-r1`. Its direct 440/660 Hz feeds
bypassed Couch; source peaks were −11.84/−11.83 dBFS and return peaks
−23.06/−23.13 dBFS, no clipping in the last 100 meter intervals. With the known
52 s waveform **through Couch**, source peaks remained around −11.8/−11.9 dBFS,
return peaks around −22.6 to −23.6 dBFS. The first run's active/quiet RMS ratios
were 65.2/64.5 dB at the source and 50.3/49.7 dB at the return, versus the earlier
return's approximate 17.6 dB. These are recorded-level comparisons, not formal
SNR/THD. Analog gains stayed fixed; there was no post-capture normalization.

The earlier tested receiver was **80%, unmuted**, not the 35% attributed to it
in an intermediate update. Its SDK gain contributes about −2.91 dB, plus the
Linux Master's −12 dB; these explain only part of the prior roughly 35 dB loss.
All older recordings retain their original level and interpretation limits.

## Capture boundary and uncertainty

Both producers uploaded actual stereo **128-frame blocks**. Native requested
128 user frames and reported 128 callback frames and owner HAL readback, with
5.916667 ms reported input latency. That readback is not the coherent witness's
callback geometry: every witness recorded **5,625 blocks of 512 frames**,
2,880,000 four-channel frames, 60 s, exit 0; no overload, nonfinite sample,
clipping or sample-time discontinuity. UMC readback was 48 kHz/512 before and
after the campaign. Native timestamp-deviation counters (6/8 events, maxima
about 12.9 frames) are retained separately from sample-position continuity.

Actual authenticated audio-worker ingress, not uploader send time, gives:

| Capture / repetition | First-sample timestamp age p50 / p95, ms | Absolute timestamp-relative jitter p95, ms | Startup clock half-RTT, µs |
| --- | --- | --- | --- |
| Chromium / 1 | 6.082 / 6.358 | 0.333 | 100.0 |
| Native / 1 | 6.973 / 7.567 | 1.151 | 214.5 |
| Chromium / 2 | 6.183 / 6.480 | 0.341 | 100.0 |
| Native / 2 | 6.943 / 7.524 | 1.137 | 126.5 |

Steady ingress interval is [20,48) seconds since its authenticated start,
separate from the coherent witness's [20,48) interval. All complete-run counters
report zero missing/duplicate/backward sequences, missing/overlapping frames,
rejected writes or capture failures. The observer retains at most 60 s of
packet timing; 1,035–1,126 later cleanup-tail packets per arm have continuity
counters but omitted timestamp rows. No claim covers their timing distribution.
The scored steady windows are fully retained, without capacity overflow.

Half-RTT is only startup offset uncertainty. Relative clock drift during the run
and Chromium/PortAudio capture-timestamp bias remain uncalibrated. Thus these
ages are software-boundary observations, not electrical capture latency; file
start offsets and readback buffer sizes were not used as latency estimates.

## Provenance, failures and cleanup

Parent scratch `.scratch/live-performance/host-ab-cal-{chromium,native}-*`
contains raw captures, events, manifests, output telemetry, ingress records,
levels, evaluators and unchanged controls. First valid Chromium arm is `r1b`;
`host-ab-cal-chromium-r1` failed before any ADC recording because the separate
**Couch Audio Witness** microphone grant was missing. Owner enabled it, then
one valid pair and one confirmation pair completed. Earlier input discovery
also required Couch's own microphone grant after the environment update. These
are retained setup failures, not silent discarded recordings.

Base is the verified signed `a30218d` arm64 package. Only a bounded numeric
worker-ingress observer was overlaid, identically for both arms; this changes
resource sealing and is disclosed as diagnostic instrumentation, not an unchanged
signed-resource execution. Original worker SHA-256 is
`3830a2f3ad7ec39e5eead1cc05a11c786ec38fd8ef0deb8d40aadb8cc63d24ba`;
overlay is `47b516fbf4cdde4178d76c82993de816a5688f762e68c21f2fa6254a692df02d`.
`resume-20261026/overlay.json` pins the asar identities and ten offline differential
checks. It changes no capture/audio/timer/protocol/admission policy. Later G5
changes affect Hub signaling/state and browser offer setup, not this worker.
The original signed asar was restored and `codesign --verify --deep --strict`
passes. Original installed Couch, personal profiles and investigation worktrees
were untouched. All owned Mac/Chrome/Pulse/Xvfb/witness processes were stopped.

The bounded host decision is complete. The remaining readiness blocker is Live
performance/fidelity on a maintained ordinary-browser route: this pass did not
reproduce the archived roughly 48.5 ms clean PCM interval or establish reliable
50 ms/fidelity behavior. The 141 ms historical estimate remains undecomposed;
it is not a measured hardware floor. Broader physical/platform gates stay open.

Selected new raw measurements, scripts and receipts are preserved separately on
`recovery/player-modes-host-ab-20261026`; pause evidence remains on
`recovery/player-modes-pause-20261026`. Their manifests/part hashes permit restore
without placing archive blobs or ancestry in the implementation PR stack.
The current 394f17f Mac main/preload/audio-worker/capture HTML match the a30218d
comparison base byte for byte; source/results still retain their exact recorded
revisions and diagnostic-overlay limits.
