# Live performance completion gate

Status: **open; integration completion and PR submission are pending**. This gate
supersedes the earlier claim that 250 ms scheduling plus decoded buffers was a
sufficient Live integration outcome. Preserve the useful Core/Browser/Host/
Validation stack and its correctness, retirement, packaging and review evidence.

## Reference and scope

The owner requires preservation of the observed roughly 50 ms browser capability.
Read-only recovery evidence is in the original investigation checkout
`/home/avoid/.t3/worktrees/couch/t3-3c4248e6/.scratch/audio-roundtrip-sync/`
and the archive indexed by `recovery/player-modes-20261026`.

- `mac-host-swap-r15/result.json`: both channels 55/55 accepted windows; median
  about 48.543 ms, p95 about 48.938 ms, maximum about 48.961 ms; zero waveform flags.
- `mac-host-swap-r16/result.json`: both channels 46/55 accepted; 4,747 / 4,727
  flagged waveform windows. Retain this failing repeat beside r15. A successful
  interval is not reliability qualification.
- r15's manifest names ordinary Mac UMC input 1/2 capture, Couch Core over wired
  LAN, Linux ALC892 browser output returned to UMC input 3/4; 48 kHz stereo /
  128-frame capture blocks, S16_LE PCM wire / maximum 240 frames / 45 ms lead,
  receiver 256 frames and Pulse latency request 1 ms.
- r15 used a package plus exact compiled browser-asset overlays. Freeze their
  individual identities and execution receipts; a candidate directory name alone
  does not establish the executable comparison.

Browser PCM predates the excluded native audience implementation. Assess its
transport, supported settings and low-lead reserve independently. Retain native
host capture and all useful integrated correctness fixes. Do not introduce native
audience output, weaken admission thresholds or select a codec before evidence.
The earlier 141 ms value is an admission estimate for its tested output/profile,
not a physical hardware floor. Existing Mac microphone access is now granted.

## Execution and completion criteria

1. Copy and hash selected harness, calibration, manifests and source/assets into
   owned scratch. Preserve original worktrees and archive. Record current stack
   heads, tool versions and read-only physical device/route availability.
   Done when both historical outcomes and their comparison inputs are identified.
2. Establish one agent-runnable physical-loop command with a known stimulus and
   actual analog return. Reuse the archived evaluator and its negative controls;
   first replay r15/r16 to prove the verdict catches defects. Freeze source,
   package/assets, profiles, wire, devices, clocks and evaluation intervals before
   acquisition. Check wiring with a bounded diagnostic before comparative runs.
   If unavailable, record the exact missing physical prerequisite, keep this gate
   open, and complete independent causal software comparisons.
3. Compare frozen prior and maintained source on the same physical topology.
   Record actual AudioContext constructor latencyHint, baseLatency, outputLatency,
   output timestamps, selected route, ALSA/Pulse buffers, capture rate/block sizes,
   wire codec/packet cadence/lead and scheduling. Minimize the red symptom, then
   rank falsifiable causes before one-variable probes. Done when matched evidence
   explains the 141 ms estimate and loss of low-lead usability.
4. Add focused causal regressions at the real boundary, demonstrate red, and fix
   supported behavior in its owning gh-stack layer. Preserve authority, admission
   integrity, source continuity, fanout bounds and cleanup. Run bounded matched
   fresh-start repeats, retaining every pass and bad repeat with waveform/coverage
   and timing verdicts; do not select only successful intervals.
5. Revalidate affected integration/package paths, obtain fresh independent reviews
   of fixed base/head, update ledger/dispositions/PR bodies and push all affected
   layers. Completion reports measured physical roundtrip and reliability results
   or a concrete unresolved blocker. PR submission remains pending.

Use `diagnosing-bugs` for the feedback loop and `writing-for-agents` for briefs
and receipts. Delegated diagnosis uses T3-owned GPT-6.1 Sol xhigh/default with
verified returned settings. Parent owns physical acquisition, shared interfaces
and stack mutations; children have bounded disjoint ownership. Every Couch launch
must carry explicit isolated `COUCH_DATA_DIR` and `COUCH_PORT`; own and stop each
PID. Preserve personal data and installed apps. This is the newly authorized Live
integration gate, not a resumption of the old stopped audio goal.

## Reopened execution evidence

Parent scratch root: `.scratch/live-performance/`. The frozen historical
electrical and waveform evaluators were replayed unchanged on both raw captures.
r15 returns green; r16 returns red. Reverse and crossed-channel controls accept
zero windows for both. The fixed gate remains 50 ms, at least 95% accepted
electrical windows, with the original waveform diagnostic preserved alongside it.

| Physical interval | Electrical results, left / right | Verdict |
| --- | --- | --- |
| Archived r15, PCM / 45 ms lead | 55/55 both; medians 48.5427 / 48.5425 ms; p95 48.9375 / 48.9380; maxima 48.9606 / 48.9608; zero waveform flags | Observed passing interval; reliability unqualified |
| Archived r16, same intended profile | 46/55 both (83.64%); 4,747 / 4,727 waveform flags, including low-return events | Failed repeat, retained |
| Fresh maintained signed `bd25f9a`, Opus / 100 ms lead | 55/55 both; medians 102.4696 ms; p95 102.6628 / 102.6634; maxima 102.6873 | Fails 50 ms gate |

The fresh run (`maintained-r2/`) used an actual returned analog signal: Mac
UMC404HD ADC 1/2 → native host capture → Core over wired LAN → packaged Linux
Electron browser → ALC892 analog output → UMC ADC 3/4. A separate coherent native
witness recorded all four channels for 60 s, with known 52 s stimulus and the
predeclared analysis interval [20,48). It recorded 2,880,000 frames, exit 0, no
overload/clipping/nonfinite/discontinuity events. Raw SHA-256:
`93d122eac210183d8ecaec3c1fc467307311171d9cf45e1e1c40758777f5452e`.
Capture requested and reported stereo 48 kHz / 128-frame callbacks; its timestamp
deviation events remain in the log. The witness and capture use separate callback
geometry. The original UMC 48 kHz / 512-frame setting was restored after testing.

Receiver: Electron 44.4.5, `--audio-buffer-size=256`, saved preference 128 frames,
actual constructor `latencyHint=128/48000` seconds, `baseLatency=2.6667` ms.
All 307 running clock samples report `outputLatency=8` ms; public SDK estimate is
10.6667 ms, required lead 25 ms and admission ready. Existing-context output
timestamps were also collected after quiet acquisition. Private Pulse requested
1 ms latency and used the archived ALSA sink configuration; the actual ALSA
period/buffer readback is retained rather than treated as a physical-delay
estimate. All data directories and processes were isolated. The known scratch
self-signed HTTPS origin used a disclosed CDP certificate-error override; audio
preparation and admission were unchanged.

`maintained-r2/manifest.json` retained stale candidate/overlay labels from its
archived harness template. Those fields do not identify executed artifacts.
The signed-package field, execution events, copied package hashes and controller
identify this new maintained run; it used the maintained signed Mac/Linux package
without the old compiled browser overlay. Preserve the as-executed manifest and
read this correction beside it.

The original waveform search covers only 35–65 ms, so its all-window flags cannot
diagnose fidelity of a 102 ms recording. A separate non-gating alignment probe
uses the unchanged evaluator/thresholds and 85–115 ms search. It finds correlation
flags in 27,988 / 27,990 of 27,991 windows, median correlation about 0.9633, with
zero gain-change, silence or clipping flags and no abrupt lag steps above 0.25 ms.
Exact-delay and 20 ms mute controls respectively give zero and 29 flags. This
establishes a waveform difference, without isolating codec, analog, resampling or
timing effects, or establishing audibility. Full rows and the independent report
are preserved under `opus-alignment/`; no codec decision follows from this alone.

The exact old ad-hoc Mac candidate was copied/hash-verified and launched in owned
scratch, but fresh publication fails its Microphone check. Its signing identity
differs from the signed Couch identity the owner enabled. No TCC changes were
made. This blocks a fresh exact-old executable comparison; physical wiring and
the signed maintained app both work. Failed baseline and harness setup attempts
remain beside the successful acquisition.

## Causal software repairs and remaining comparison

Real-boundary differentials demonstrated three capability losses before repairs:
the public settings rejected former 45/50/55/75/95 ms choices, Core rejected PCM
at the identical strict 25 ms budget, and a real scheduled capture subscription
emitted reset without the prior immediate PCM. Repairs are in their owning layers:

- Core again emits immediate stereo S16 PCM alongside Opus, at most 240 frames
  per packet, with bounded queues, source-generation cancellation and independent
  peer fanout. Existing Opus prewarm, continuity and helper leases remain.
- Core admits PCM at its original 65,536-byte capacity floor; Opus retains 4,096.
  Identity, preparation, clock, timing and correction gates remain strict.
- Host restores the five low-lead choices. Defaults remain 100/70 ms. The 45 ms
  choice preserves r15's 20 ms source reserve and strict 25 ms output budget;
  the later recovered 8 ms reserve is not substituted.

The browser still prefers and prepares Opus. The earlier same-source Electron
codec diagnostic is finished, with every interval retained:

| Interval | Electrical result | Diagnostic limit |
| --- | --- | --- |
| Product Opus 45 r2 | 54/55 per channel; median 46.758 ms, p95 47.172 ms | 27,990 waveform flags per channel; no qualification |
| Original SDK Opus/PCM data-URL attempts | Playback failed | Confounded observer failure: 1.75 MB script URL serialized through CDP; retained, not codec evidence |
| Corrected short-URL Opus 45 r2 | 0/55 in the scoring interval | Output latency/admission rose and strict budget withdrew output |
| Corrected short-URL PCM45 r1 | 55/55 both; median 47.070 ms, p95 47.541 ms, max 47.564 ms | 32 waveform flags per channel; low-level return limited interpretation |
| Corrected short-URL Opus 45 r3 | 45/55 left, 44/55 right; accepted medians 46.424/46.439 ms | Broad correlation/gain flags; no qualification |

The URL-only control keeps identical JavaScript and two initial contexts: the
original yields zero starts and socket1013, while a normal exact-origin script
URL yields12,472 starts, ready admission and no close. No product SDK logic
changed. These receivers were packaged Electron 44.4.5 with its256-frame switch,
not the later ordinary Chrome host comparison.

## Calibrated Mac host comparison

The owner then limited the next physical pass to Chromium versus native HOST
capture. That pass is complete: one valid matched pair and one confirmation
pair through the maintained client in ordinary Chrome 156.0.8078.47. Analog gains
were accepted by the owner and fixed. Known waveform source peaks were near
−12 dBFS, return peaks near−23 dBFS, no clipping; return active/quiet RMS ratio
was about50 dB, versus the earlier17.6 dB. This is not formal SNR/THD.

| Host capture | Pair1 median, ms | Confirmation median, ms | Accepted windows L/R |
| --- | --- | --- | --- |
| Chromium | 57.833 | 57.455 | 54/55 both; then 55/55 both |
| Native | 56.647 | 57.268 | 53/55 both; then 54/55 both |

All four used the same Opus 10 ms wire, 48 kHz/stereo,55 ms lead/20msreserve/strict35 ms
budget, one browser/profile, fixed Linux route and coherent four-channel witness.
The 45/25 ms preflight refused the ordinary receiver's29 ms requirement. Public
128-frame preference gives base latency2.6667 ms and mostly16 ms running output
latency, with brief8 ms samples. No Electron buffer flag or Linux tuning was used.
The unchanged50 ms/fidelity gate fails in every trial; all retain broad waveform
flags (median correlation≈0.967), with reverse/cross controls accepting zero.
Better gain staging did not remove those mismatches or isolate their cause.

Both producers delivered128-frame packets without sequence/sample gaps. Native
had higher timestamp-relative ingress jitter in both repetitions. Clock mapping
half-RTTs were100–214.5 µs; in-run drift and capture timestamp bias remain separate
unmeasured uncertainty. Timing metadata records first60s, with omitted late
cleanup-tail timestamp rows but complete continuity counters. Native owner HAL
readback128 and its128-frame callbacks are distinct from the witness's512-frame
callbacks. File offsets/readback are not latency measurements.

**No useful repeatable native advantage was established; do not prefer it or claim
native performance qualification.** Chromium remains the reference host path;
both implementations/evidence stay preserved. The higher common diagnostic lead
does not waive the roughly 50 ms reference. See the [host comparison](player-modes-host-capture-comparison.md)
for exact results, instrumentation/signature limits, failed setup and cleanup.
The comparison stopped at the agreed two pairs. Live readiness remains open:
this maintained ordinary-browser route has not reproduced the clean archived
roughly 48.5 ms interval reliably or passed the original fidelity diagnostic.

The old `mac-opus-default-admission.json` records required 141 ms versus allowed
70, with zero decoded buffers. It has no constructor, raw latency, output-clock,
argv or route decomposition. The unchanged guard implies an SDK estimate in
(130,131] ms, not measured electrical delay. The fresh matched output profile gives
10.6667 ms; an official AudioContext-only comparison changing Pulse latency request
from 1 ms to unset changes outputLatency from 8 to 16 ms and does not reproduce
141. Its exact original profile/cause remains unresolved. Neither result is a
hardware floor, and this gate stays open.
