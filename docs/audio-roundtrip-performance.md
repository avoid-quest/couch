# Live audio roundtrip measurements

25 October 2026. Work continues from `27e580c` using the Behringer UMC404HD and
wired MacBook Air. This record separates measured electrical delay from the
configured sender deadline and from calibrated physical qualification.

The current working goal is 50 ms full electrical roundtrip, with 30 ms a stretch
direction. These are optimization goals, not fixed configuration requirements.
Passing an intermediate 100 ms check does not finish this work.

## Current direction: Mac host → Linux analog output

### Maintained host comparison, 25 October 22:59 UTC

`linux-native-receiver-r13` passed **55/55 windows per pair**, median **46.298 ms**,
maximum **46.308 ms rounded up** (exact 46.3079166667). Intended invalid lags and
accepted reversed/cross controls: zero. The unchanged waveform diagnostic flagged
**0/27,991 tiles per channel** in [20,48). Original 60 s witness / 52 s stimulus,
50 ms threshold and all coverage gates retained.

This uses a separately frozen maintained Core/worker/Main/frontend candidate:
`.scratch/audio-supported-live-host-r1/app.asar`, SHA-256
`9a118bd6978897a19d88ee088a2d72559cab4dbd566b1cf407741c7f50831c6f`.
The previous frozen R4 remains unchanged. Maintained Core now offers Live PCM16
alongside browser Opus from one normalizer/timeline, admits PCM with at least
65,536 bytes, and gives explicit 45/50/55 ms presets 37/42/47 ms receiver budgets.
Default 95/70 ms is unchanged. Separate maintained relaxed-queue and late-join
fixes are included explicitly. Capture source matches R4 (native-capture hash
from R2; other capture source pins from R1); native helper and r11 receiver are
unchanged. Lead45 was selected through the public settings endpoint. Hardware,
Pulse defaults/request20ms, routes and gains unchanged.

Receiver wrote 23,194 packets / 2,969,540 frames in order, with no logged underrun.
Publication withdrawal after the completed witness stopped the harness on a
receiver-generation change: 5 received packets / 528 frames remained unwritten
at shutdown. Preserve that terminal truncation; do not call every received frame
delivered. Helper exit0. Witness overload/clipping/nonfinite/interruption zero.
Maintained Core omits the experimental packet traces, so complete host-ingress
continuity is not established here. Both hosts' owned processes retired, Linux
ledger empty, private Pulse socket absent and ALSA closed.

Preceding r12 failed before measurement because the staged helper lost execute
permission (EACCES); its failure and cleanup remain. No product conclusion from
r12. All software regressions, three typechecks and the new build passed;
receipts: `.scratch/audio-supported-live-core-r1/`. Opus tests explicitly filter
Opus now that PCM is concurrent. This is still a sampled electrical diagnostic,
not calibrated or sustained fidelity qualification. Next: actual desktop Native
selection against this exact host, then sustained qualification.


### Maintained native receiver comparison, 25 October 22:41 UTC

`linux-native-receiver-r11` replaces the scratch session/pipe with maintained
`app/native-audio-output.ts`, its public SDK APIs/TLS adapter,
`app/native-playback.ts`, and the helper compiled by Linux packaging. Frozen
Native R4 host (45 ms lead / 37 ms receiver budget), Pulse 20 ms request,
hardware formats, ring/period, volumes, stimulus and electrical gates remain.
Unlike r10's scratch receiver, this session honors the server's stream-volume
command (80); hardware gains did not change. This is a receiver implementation
comparison, not an isolated controller-parameter comparison.

Both pairs passed **55/55 windows**, median **46.219 ms**, maximum **46.287 ms
rounded up** (exact maximum 46.2860416667). Intended invalid lags and accepted
reversed/cross controls: zero. The unchanged waveform diagnostic flagged
**0/27,991 tiles per channel** in [20,48); local lag decreased about 0.134 ms.
All **23,041 packets / 2,949,846 frames** were received/written in order. Host
ingress continuous, normalized gaps and trace loss zero; all 181 raw timing
observations valid. Rates stayed 48000..48004 Hz, ending at 48003.

Witness: 2,880,000 frames/channel; overload, clipping, nonfinite and interruption
zero. One terminal underrun **12.328 ms after the final PCM write**, following
the completed witness/publication withdrawal, remains recorded with helper
exit 7; none occurred during PCM delivery. Acquisition cleanup independently
confirmed: no owned Mac Lab process, Linux ledger empty, Pulse socket absent,
ALSA closed. Full raw, gates, waveform rows, traces and cleanup receipts remain
under roundtrip scratch `mac-host-swap-r1/linux-native-receiver-r11/`.

Desktop integration now has Main-owned identity/TLS/session/lifecycle handling,
preload IPC and Live-only output/buffer Selects. Browser remains default; native
selection currently covers audio-only Live, with explicit leave/rejoin after
connection/reset/timing failure or an active delay change. The renderer does
not forward PCM. Focused encrypted SDK/owner tests, clean frozen installation,
existing adapter/preparation/browser regressions and all three typechecks pass.
The actual settings component was inspected at desktop and 390 px widths.
Evidence: `.scratch/audio-native-desktop-output-r1/`.

The real Linux Package workflow built AppImage/deb under `act` using
`catthehacker/ubuntu:full-latest`. The helper, license and build receipt were
verified in packaged resources; a deb was retained locally. The workflow's
subsequent artifact-upload step failed because act's server rejects v7's
`mime_type` field. This is a packaging-build pass, not a complete workflow pass.
Nothing was dispatched or installed. The packaged Main predates the small
subsequent same-value-delay guard; r11 bundles the final maintained session and
uses the unchanged packaged C++ helper.

Next: exercise the actual desktop selection against an exact, compatible host
frontend, then sustained automatic-control qualification. r11 still uses the
retained control-plane harness, not an Electron window. Also retain the policy
distinction: frozen R4 allows a 37 ms receiver budget at 45 ms lead, whereas
current maintained `liveOutputBudget(45)` allows only 25 ms. Do not silently
merge a new Core or describe this result as qualification of that policy.
No calibrated physical or continuous-fidelity qualification is claimed.

### Automatic native clock correction, 25 October 22:09 UTC

`linux-native-receiver-r10` starts at nominal 48,000 Hz and replaces the fixed trim
with bounded automatic feedback from the qualified raw queue/timing observation.
It passed **55/55 windows per channel**, median **46.138 ms**, maximum
**46.150 ms rounded up**, with zero intended invalid lags and zero accepted
reversed/cross controls. The unchanged waveform diagnostic flagged **0/27,991
tiles per channel**; local lag grew 0.118 ms over [20,48). Original 60 s witness,
52 s signal, fixed interval and explicit 50 ms threshold retained.

No device-specific trim was supplied. Rates moved 48000→48001→48002→48003→48004→
48005→48004→48003. The controller filters phase over 2 s, waits 5 s before acting,
limits correction to ±500 ppm and changes rate by at most 1 Hz/s. Invalid/stale
observations, a detected wall-clock step or >10 ms phase discontinuity abort;
source deadlines and PCM frame counts never change. Pure simulated-clock tests
cover both drift directions, changing drift, bounds/slew and invalid observations.
A real Pulse null test retained all 2,304,000 frames; an injected phase error
exposed and fixed failure-report accounting so already-written frames remain
counted on abort. Red/green receipts are retained.

All 22,983 packets / 2,942,417 frames were received/written in order, host ingress
continuous, normalized gaps and trace loss zero. All 180 raw timing observations
were valid. Witness overload/clipping/nonfinite/interruption zero. One terminal
underrun after completed witness/publication withdrawal remains in the software
summary with helper exit 7; none occurred during PCM delivery. Cleanup complete.

Frozen implementation/tests are `.scratch/audio-native-clock-servo-r1/`; full raw
and reports are under roundtrip scratch `mac-host-swap-r1/linux-native-receiver-r10/`.
The signed Native R4 host, 45 ms lead, capture, formats, Pulse request, hardware
and volumes are unchanged. This is the first automatic-control electrical pass,
not supported integration, calibrated accuracy or sustained/cross-device fidelity.

The proven controller and adapted Apache-2.0 sink were subsequently promoted to
`native/live-audio/playback/`. `scripts/build-live-playback.ts` builds the Linux
helper, and `app/native-playback.ts` owns its pipe/process without credentials.
The maintained helper passes real null-sink ordered/control/error cases; eight
adapter tests cover PCM/deadline preservation, acknowledgement order, format/
resampler rejection, canceled preparation, invalid PCM and bounded backpressure.
App/scripts typechecks and whitespace checks pass. Build/test receipts are under
`.scratch/audio-native-clock-servo-r1/` and `.scratch/audio-native-maintained-output-r1/`.
Desktop selection, Node SDK session ownership, IPC and packaging are still open;
the maintained helper changes are not yet a new electrical qualification.

### Hardware timing-observer check, 25 October 22:00 UTC

`linux-native-receiver-r9` repeated r6's predetermined rate steps and added only
timing observations. **55/55 electrical windows per pair passed**, median
48.056 ms, maximum 49.102 ms rounded up; accepted reversed/cross controls and
intended invalid lags zero. The unchanged waveform check flagged 0/27,991 tiles
per channel. The raw queue observer never controlled playback or initial padding.

This exposed a stronger feedback defect than the immediate rate-change offsets:
the legacy Pulse-derived deadline error reached **1.470 seconds**, with 1,488
writes over 100 ms. Retrospective inspection of retained r6 also finds spikes up
to 1.069 s (540 writes over 100 ms), so the added observer did not introduce them.
These are software timing-estimate failures, not corresponding measured
electrical latency. Fixed-rate r5/r7/r8 have no such over-100 ms estimates.

The current queued-index/timing-age observer returned 180 valid readings,
raw deadline error −4.107..+3.898 ms, and immediate rate-step residuals within
22 µs after accounting for elapsed query time. Timing sample age was 2.715 ms
to 1.495 s; bounded freshness, clock-step handling and filtering still need an
explicit controller policy. Do not feed the legacy smoothed estimate directly
into variable-rate correction. This result supports the alternative observation,
not calibrated absolute output accuracy or a finished automatic controller.

All 23,021 packets / 2,947,282 frames were written in order. Host ingress was
continuous, normalized gaps and trace loss zero. Witness overload/clipping/
nonfinite/interruption zero. One terminal underrun, 13.111 ms after final write
following completed witness/publication withdrawal, is retained with helper
exit 7; none occurred during the PCM write span. All owned processes retired,
private socket absent and ALSA closed.

Frozen observer/source/build/null evidence: `.scratch/audio-native-rate-observer-r1/`.
Raw, unchanged gates, timing comparison and retrospective r6 audit: roundtrip
scratch `mac-host-swap-r1/linux-native-receiver-r9/`. Preserve r7/r8 as fixed-trim
comparisons. Next: bounded automatic per-device clock correction, then supported
receiver integration and broader sustained fidelity; no further daemon tuning.

### Fixed trim after four minutes of streaming, 25 October 21:54 UTC

`linux-native-receiver-r8` retained r7's exact audio configuration and waited
240 seconds after native PCM admission before starting the original 60 s witness
and 52 s signal. Only experiment lifetime bounds were extended. Both pairs
accepted **55/55 windows**, median **45.469 ms**, maximum **45.498 ms rounded up**;
intended invalid lags and all accepted reversed/cross controls were zero. The
unchanged waveform diagnostic flagged **0/27,991 tiles per channel** in [20,48).
Local lag changed −0.0649/−0.0643 ms over that interval. Startup offsets differ
between sessions; the lower median than r7 is not evidence of an aging benefit.

The receiver retained every one of 113,027 received/written packets, 14,470,732
frames, ordered over 301.46 s. No underrun occurred during the PCM write span.
One terminal underrun occurred 13.122 ms after the final write following completed
witness/publication withdrawal, helper exit 7 retained. Capture reported 56,883
256-frame callbacks, zero capture error/driver flags, and 10 ADC timestamp-spacing
deviations (maximum 12.746 frames), preserved without repair. The witness completed
2,880,000 frames/channel with zero overload/clipping/nonfinite/interruption.

**Evidence limit:** the frozen host trace reached its existing 100,000-row cap
and dropped 240,566 diagnostic rows. Its retained prefix is continuous, but full
host ingress/normalization coverage cannot be claimed. Receiver logs and raw
witness are intact. The pre-roll does not supply four minutes of waveform
qualification: physical/fidelity inspection remains the original recording and
fixed interval. Fixed +62.5 ppm trim is specific to this device pair; automatic
clock correction and supported receiver integration remain open.

The capture owner's HAL readback and observed callbacks were 256 frames; the
separate witness reported 512 HAL frames. Keep those observations distinct rather
than labeling either as proven raw AUHAL callback geometry. Linux remained native
48 kHz/S32_LE/stereo, ring 96,000 / period 48,000; stream PCM16 at 48,003 Hz is
filtered by Pulse while the physical sink stays 48 kHz. Volumes/routes unchanged.

Source/bounds are frozen in `.scratch/audio-native-rate-trim-aged-r1/`; complete
evidence is in `mac-host-swap-r1/linux-native-receiver-r8/` under the roundtrip
scratch root. Cleanup receipts and independent absence checks passed; Linux
ledger active entries 0, private socket absent, ALSA closed.

Separately, `.scratch/audio-native-rate-observer-r1/` exercised an observation-only
queue estimate from current write/read index difference and timing age against a
null sink. Across the same four rate steps, immediate change after accounting for
elapsed time stayed within 32 µs, versus legacy estimate jumps up to 950 µs.
That null test is software evidence only; the later r9 hardware observation is
reported above. No controller uses this observer yet. Do not retune the daemon
or hardcode the measured device-pair trim as a product default.

### Native rate actuator and fixed clock trim, 25 October 21:44 UTC

**Fixed +62.5 ppm receiver trim reduced electrical drift from about 1.85 ms to
0.12 ms over the original [20,48) interval, while passing the unchanged ≤50 ms
gate.** This is evidence for independent clock mismatch, not a portable default
or a completed clock controller. The receiver remains experimental.

| Run | Pulse stream rate (hardware stays 48 kHz) | Coverage each | Median L/R | Maximum L/R | Waveform flags each |
| --- | --- | --- | --- | --- | --- |
| `linux-native-receiver-r6` | 48000→48001→48000→47999→48000 | 55/55 | 47.288 ms | 48.340 ms | 0/27,991 |
| `linux-native-receiver-r7` | 48003, fixed before preparation | 55/55 | 46.583 ms | 46.593 ms | 0/27,991 |

Both retained the exact signed Native R4 host, 45 ms lead / 37 ms budget, native
48 kHz/256-frame capture, PCM16 stereo transport, 20 ms Pulse request, ordinary
daemon configuration and hardware volumes. Only receiver stream resampling
changed. Pulse confirmed `speex-float-1`, including at equal nominal rates; all
rate commands acknowledged. No hardware rate change, raw retiming, frame edits,
threshold changes or interval selection. Both original 60 s witnesses completed
2,880,000 frames/channel, zero overload/clipping/nonfinite/interruption. Intended
invalid delays and accepted reversed/cross controls were zero.

The r6 schedule changed rate at 15/25/35/45 s after first PCM. Separate exploratory
lag-slope observations moved in the expected direction; they do not replace the
fixed acceptance interval. In r7, local lag grew 0.116/0.117 ms; a linear fit over
the whole original interval estimates residual 3.321/3.320 ppm. This is consistent
with compensating approximately 66 ppm by 62.5 ppm. It does not prove stability
across devices, temperature changes, restarts or longer sessions.

All 23,013 / 22,997 received packets respectively were written once in order
(2,946,258 / 2,944,210 frames). Capture ingress was continuous, normalized gaps and
trace loss zero. Each run retained one terminal underrun after publication
withdrawal and completed witness: 14.814 / 12.316 ms after final PCM write,
helper exit 7. Neither occurred within the PCM write span. Do not report whole-run
zero underruns. Separate waveform diagnostics still do not establish calibrated
or unrestricted continuous fidelity.

The actuator check also found a feedback limitation: `pa_stream_get_latency()`
jumps immediately across rate changes (about −0.334/+0.542/+0.750/−0.959 ms in r6).
The physical waveform did not show corresponding flagged discontinuities. Pulse
17 source converts the cumulative write index using the new rate while estimating
playback time through its smoother; that estimate must be requalified before
closing a feedback loop. A fixed device-pair trim is not the supported solution.

Evidence: `.scratch/audio-native-rate-actuator-r1/` (adapted Apache-2.0 upstream
sink, source pins, 48 s null test with all four rate transitions),
`.scratch/audio-native-rate-trim-r1/` (fixed trim and null check), and the r6/r7
runtime folders under `.scratch/audio-roundtrip-sync/mac-host-swap-r1/` (original
raw, all window reports, software summaries and identity cleanup receipts).
All owned runtime processes stopped; ALSA closed. No new microphone grant,
daemon tuning, installed-app change or product-package rebuild was needed.

### Native full-path comparison, 25 October 21:28 UTC

**The 45 ms candidate passes the unchanged sampled ≤50 ms electrical diagnostic.**
This is Mac UMC ADC1/2 → normal desktop Native input → actual Couch upload/Core/
network → experimental native Linux PCM receiver → ALC892 green output → UMC
ADC3/4. It is not yet a supported product receiver or calibrated/long-session
qualification. The ordinary browser result and original experimental WASM result
remain separate.

| Retained run | Host lead / receiver budget | Each intended pair | Median L/R | Maximum L/R | ≤50 ms |
| --- | --- | --- | --- | --- | --- |
| `linux-native-receiver-r4` | 55 / 47 ms | 55/55 (100%) | 58.470 / 58.470 ms | 59.310 / 59.311 ms | Fail |
| `linux-native-receiver-r5` | 45 / 37 ms | 55/55 (100%) | 46.232 / 46.231 ms | 47.065 / 47.066 ms | Pass |

Both use the original 52-second stimulus, 60-second coherent recording,
prospectively fixed [20,48), explicit `--threshold-ms 50`, unchanged 95% coverage
and confidence gates. Intended pairs have zero invalid lags; all reversed/cross
controls accept zero windows. Each witness retained 2,880,000 four-channel frames,
with zero overloads, clipping, nonfinite samples or interruption. Raw samples were
not retimed. All reports/windows, including previous failures, remain retained.

Configuration: UMC native capture 48 kHz/stereo float32, requested/reported 256 frames;
PCM16 stereo 48 kHz transport/output stream; reused Sendspin C++ Pulse sink with 20 ms
request, 15 ms granted stream queue and about 20 ms total reported queue. Receiver
preparation declares 31 ms required lead and 25 ms minimum buffer after a silent
measurement and SDK clock check. Pulse daemon/route/volumes remain the retained
near-default configuration; ALSA allocation remains a 96,000-frame ring / 48,000-frame
period. This allocation is not the measured latency. No drift correction, sample
insertion/deletion or adaptive resampling runs in this comparison receiver.

The existing separate waveform diagnostic inspected all 27,991 ten-millisecond
return tiles per channel at 1 ms hops in [20,48), with unchanged 35..65 ms search and
thresholds. **Both runs have zero flagged tiles on both channels.** This only
establishes that diagnostic's tested sensitivity, not absence of every possible
audible defect. Local waveform lag increased about 1.85 ms across 28 seconds in both
runs, so long-session latency remains unresolved despite the short-run pass.

Software evidence: all 23,007/23,013 received packets respectively were written
once and in order (2,945,490/2,946,256 frames). Core ingress is continuous, normalized
gaps zero and trace rows lost zero. The 45 ms run logged one end-of-stream underrun
14.859 ms after its final write, after deliberate publication withdrawal following
the completed witness; helper exit 7 is retained. No underrun occurred within the
PCM write span or fixed steady interval. The 55 ms run logged none. Neither terminal
underrun nor native ADC timestamp deviations were discarded from the evidence.

A concrete Core join bug blocked the initial native comparison: admission checked
the receiver's required lead but the new stream cursor started at `now`. The first
packet arrived 3.106 ms past its mapped deadline; the native sink rejected its
−25.038 ms queue gap without writing PCM. `linux-native-receiver-r3` therefore
retains 0/55 windows on both pairs and its complete 60 s failed witness. Earlier r1/r2
stopped before acquisition because the controller used an obsolete Done button
and omitted the explicit receiver Device in Play. These were harness failures.

The maintained fix starts a new Live listener's cursor after its required lead
plus positive output correction; existing audience timestamps stay fixed. A real
scheduled-audio/encoder/encrypted-client regression reproduced 6.375 ms first lead
against a 45 ms requirement, then passed. Source typecheck passes. Native R3 differs
from Native R2 only in that worker fix. Native R4 then changes only 55→45 ms lead
(and derived 47→37 ms budget) in Core/worker. The separate relaxed-PCM queue fix was
not mixed into these packages. Stable Lab signing retained microphone permission
for both rebuilds; no further grant was requested.

Evidence: `.scratch/audio-roundtrip-sync/mac-host-swap-r1/linux-native-receiver-r{3,4,5}/`
(raw under `mac/`, complete latency/negative/waveform reports, timing and cleanup),
`.scratch/audio-native-receiver-r1/` (bounded diagnostic adapter and pinned upstream
sink), `.scratch/audio-native-desktop-r{3,4}/` (exact archives/signing receipts), and
`.scratch/audio-live-join-lead-r1/` (red/green regression). The passing Native R4 ASAR
is recorded in its `candidate.json`; it is distinct from the older original
`mac-host-swap-r1/Couch Audio Lab R4.app`.

All owned Mac/Linux processes are stopped, Linux ledger active entries 0 and ALSA
closed; independent Mac absence check also passed. **Next:** preserve this 45 ms
baseline; qualify Pulse's filtered variable-rate actuator and a bounded drift
controller before longer reliability trials and supported receiver integration.
Do not replace that work with further daemon tuning or a 44.1 kHz hardware-rate change
while the coherent witness remains 48 kHz.


### Reused native Pulse sink, 25 October 20:47 UTC

A bounded sink-only experiment reused Sendspin C++ CLI's unmodified Pulse sink
at commit `7c7f5e015a894e62b1673f9debdc23b8800d0241`, with standalone clock/log
adapters and its existing volume/recovery code. No protocol player was linked.
It requested20ms at48k/stereo/s32le against the unchanged near-default private
Pulse and ALC892 green output. Master remained−12dB/unmuted, PCM0dB; no mixer,
daemon or hardware-buffer change was made. ALSA still allocated96000 frames with
48000-frame periods. Pulse granted a15ms stream queue and reported20ms total.

The nonzero r2 wrote all2,880,000 frames in11250 complete writes. Reported finish
lead over software seconds[20,48) was median16.466ms, p95 19.137ms, maximum20.118ms
(whole-run maximum20.369ms). No ALSA underrun message appeared. The sink's sole
“ran dry” event was13.064ms after the final write, during its explicit100ms drain.
These are software queue observations, **not electrical input-to-output delay**.
They support testing a native output without further Pulse tuning, not declaring
that implementation stable across devices.

The unchanged coherent witness retained60 seconds/2,880,000 four-channel frames,
with no overload, clipping, nonfinite samples or interruption. Physical analysis
remains **unqualified**. The prospectively chosen alignment anchor[10,11) was a
harness mistake: the original stimulus is deliberately silent there. A subsequent
exploratory[20,21) anchor also failed the original0.98 one-second criterion
(correlations about0.620/0.621). It was used only to inspect short waveform tiles,
not to revise a gate. The unchanged return interval[20,48) has161/27991 flagged
left tiles and0/27991 right tiles. All left flags lie at20.000–20.160s, where the
delayed left reference/return are near the noise floor. They remain flagged.
Local alignment drifts about4.65ms over27s; no raw samples were retimed. Independent
playback starts and independent DAC clocks make that offset unsuitable as a
Couch-latency result. No overall fidelity pass follows from the exploratory tiles.

The first sink run supplied silent original DAC1/2 instead of active DAC3/4;
its raw witness, timing and explicit signal-invalid result are preserved. The
only audio change for r2 was correcting that channel extraction, without scaling
or resampling. Both runs retired sink/Pulse/witness, left ALSA closed and required
no new permissions. Source, pins, build and failed analyses are under
`.scratch/audio-native-pulse-sink-r1/`; runtime/raw/results are under
`mac-host-swap-r1/linux-native-pulse-sink-r1/` and `linux-native-pulse-sink-r2/`
within the roundtrip scratch root. The full Couch≤50ms electrical goal remains open.

### Normal native desktop publication/upload, 25 October 20:36 UTC

The separately signed Native R2 scratch app selected the UMC through the normal
Live audio UI at 48 kHz, stereo float32, requested/reported256 frames. Its real
Core worker received7036 consecutive blocks (1,801,216 frames, 37.525 s), with
exact sequence/sample-position continuity and zero normalized gap frames. The
native helper reported captureError0, callback sizes256 throughout and no driver
flags; four ADC-time spacing deviations remain unmodified and recorded. No trace
rows were dropped. These are capture/upload observations, **not waveform or
electrical qualification**; no witness/stimulus was run in this short integration.

R1 failed before capture: its Node WebSocket omitted Origin, which Core requires
for upload. A regression through the real Hub reproduces rejection; adding the
local origin passes, while a revoked publication still fails. All six native
upload tests pass. Only compiled Main differs between R1 and R2; frozen Core,
worker, native helper and client assets are retained. Packages and receipts are
in `.scratch/audio-native-desktop-r1/` and `audio-native-desktop-r2/`.

Playback was not admitted: the freshly built frontend declares Opus preparation,
but the frozen Core requires signed16 PCM preparation. This archive compatibility
failure is separate from the prior53>47ms output floor. Receiver software also
reported50.667ms output latency. Do not treat this as a latency/dropout verdict
or silently alter the frozen Core to make the candidate compatible.

A dedicated Lab signing certificate in an isolated keychain replaced ad-hoc
cdhash identity. After the user's R1 microphone grant, rebuilt R2 selected native
capture without another prompt. System trust and personal keychain contents were
unchanged; keychain search/default settings were restored. Installed Couch and R4
remain unchanged. Both Mac runs retired all owned processes. Linux cleanup
conservatively reported failure after an exiting child lost its executable;
its original receipt is retained, and a separate read-only follow-up confirmed
every recorded PID and same-executable process absent. Pulse/display/tunnel are
stopped, ALSA closed. No lifecycle framework change was made.

### Native capture-stage comparison, 25 October 20:02 UTC

PortAudio candidate `capture-source-r5` requested and read back **256 frames,
48 kHz, stereo float32** on the UMC. In `native-witness-r2`, its captured samples
matched the retained coherent recorder's ADC1/2 **exactly after the witness's
existing S32 conversion**, for all **2,880,000 frames per channel**. The fixed
[20,48) interval also has zero mismatches across 1,344,000 frames per channel.
A single fixed [20,21) anchor established the file-start offset of996 samples;
this is indexing between recordings, **not capture latency**. No resampling,
drift fitting, changing alignment or timestamp repair was applied. Per-second
comparisons, raw packets, witness audio, metadata and hashes are retained in
`.scratch/audio-portaudio-candidate-r1/collected-native-witness-r2/`.

This used the original52-second signal and60-second witness, but **did not use
Couch upload, Core transport or Linux playback**. It is capture-stage evidence
only, not an electrical latency pass or sustained product qualification. Native
callback/xrun/queue counters and witness overload/nonfinite/clipping checks
reported no errors. One final queued native packet was not written at deliberate
stop, outside the complete witness overlap; both full raw streams remain retained.
Both processes were reaped and verified absent. The R4 ASAR remains byte-identical.

Two implementation findings preceded this result. CoreAudio UID lookup needed
the UID qualifier API, not AudioValueTranslation. A conservative two-sample
ADC-timestamp spacing guard also stopped on CoreAudio host-time adjustments;
a diagnostic PortAudio trace showed consecutive HAL sample positions through
the adjustment, unchanged timestamp offset and no xrun. Native timestamps now
remain untouched, with deviations reported; invalid/backward/duplicate times,
xruns and queue overflow still fail. Core's clock validation is unchanged.

The first long comparison (`native-witness-r1`) was invalid: native PCM was all
zero while the witness captured the signal. macOS TCC logs explicitly attribute
the helper to SSH and deny microphone access. Its initial ungated correlation
report is retained and superseded by a signal-validity failure. The passing
comparison changed launch attribution only: the unchanged, already-authorized
Lab executable ran a bounded external test entry in Node mode and owned the
helper. No bundle re-signing or permission workaround was used. This is **not**
qualification of the normal desktop publication/consent path. All failed raw
evidence is retained. The independent Linux admission53>47ms blocker below remains.

### Near-default output baseline, 25 October 19:00 UTC

Follow-up20:12UTC: `mac-host-swap-r1/linux-output-hints-r1/` compared Automatic,
numeric .002, Automatic in the retained Linux package, with unchanged near-default
Pulse. Each resumed48k AudioContext ran an inaudible oscillator for4 seconds.
All three requested Pulse tlength32ms/minreq5.33ms. Automatic reported
baseLatency10.667ms versus2.667ms for .002; outputLatency observations varied
around32–40ms. Automatic did not remove the native Pulse buffer request. These
are software reports only, not a playback latency or fidelity result. Raw
observations and Pulse logs remain retained; identity-verified cleanup completed
for Main, Pulse and the dedicated display, and ALSA closed.

`native-baseline48-r1/` retained the unchanged signed R4 host package (55 ms
sender lead, 8 ms source reserve, 47 ms receiver budget) and the near-default
Linux Pulse configuration. No new package, rate, volume or buffer override was
applied. The receiver rejected admission: **required lead 53 ms exceeded 47 ms**;
reported output latency was **42.667 ms**. Pulse logged a 32 ms request/final
latency with 5.333 ms minreq. These software reports are distinct and are not
electrical measurements. The package still requested AudioContext latency `.002`;
the Linux launch had no `PULSE_LATENCY_MSEC` or audio-buffer-size override.

The controller stopped sharing after the bounded Listening wait failed, before
the fixed steady interval. The original 60 s four-channel recording nevertheless
completed with 2,880,000 frames, zero witness overloads/interruption/clipping or
nonfinite samples. At the unchanged [20,48), 50 ms electrical gate, both pairs
accepted **0/55**, all rejected for low correlation; all four reversed/cross
controls accepted zero. This is a **failed admission baseline**, not a measured
latency or evidence of capture dropout. Raw audio and complete rejected-window
reports remain retained. Host, witness, Linux Main and Pulse cleanup completed;
ALSA closed. Temporary infrastructure alone was renewed through 20:06 UTC.

The immediate limitation under these defaults is the receiver's admission
requirement. Replacing Mac capture alone does not remove it. Preserve this
failure when comparing native implementations; do not reduce the admission
requirement or discard it to manufacture a sub-50 ms result.

The user has moved the UMC404HD USB connection to the Mac and the return plug to
the Linux ALC892 green output. This is now the primary test route. The electrical
target remains ≤50 ms, with 30 ms a longer-term goal. The former internal 25 ms
receiver admission budget is not the electrical target and may be rebalanced.
The user now authorizes retaining working audio settings. Linux Master is left
unmuted at −12 dB; the original mixer snapshot is retained.

The ordinary Mac capture delivers **128-frame, stereo 48 kHz** blocks. The separate
coherent four-channel witness uses 512-frame callbacks. A standalone CoreAudio
setter reported 128 in its own process, while another process and the subsequent
witness still reported 512. That attempt did **not** change Couch capture and is
not a valid hardware-buffer comparison. Pinned Chromium's Mac input policy uses
128 frames; its AudioUnit buffer configuration must not be inferred from another
client's device-property readout. Core ingress age in two retained runs had medians
5.5–5.7 ms, with no normalized gaps through the steady interval. These are software
diagnostics, not electrical results.

All results below retain the original 60-second witness, 52-second stimulus,
fixed [20,48), explicit 50 ms limit, original coverage/invalid-lag gates and
negative controls. Both complete channel pairs are shown; waveform counts are
overlapping flagged windows, **not independent dropout counts**.

| Swapped-route configuration | Accepted L/R | Maximum ms | Waveform flags L/R |
| --- | --- | --- | --- |
| Tiny IRQ output ring, default Chromium output (`mac-host-swap-r2`) | 0/55 each | — | 27,991/27,991 |
| Timer scheduling, Pulse 1 ms request, receiver override 128 (`r4`) | 55/55 each | 51.561 | 66/64 |
| Ineffective standalone Mac setter; actual repeat of r4 (`r5`) | 55/55 each | 52.012 | 161/161 |
| Receiver override 256; other audio settings unchanged (`r6`) | 55/55 each | 51.231 | 87/85 |
| Same 256 plus existing receiver metadata probe (`r7`) | 54/55 each | 51.741 | 166/165 |
| Same 256, receiver probe and limited timeline trace (`r9`) | 55/55 each | 51.684 | 55/57 |
| Small drift correction uses playback rate, initial 1000 ppm cap (`r11`) | 52/55 each | 51.731 | 0/0 |
| Same rate correction capped at 100 ppm (`r12`) | 55/55 each | 51.327 | 0/0 |
| 45 ms sender lead, 100 ppm correction, Pulse request1 ms (`r15`) | 55/55 each | 48.961 | 0/0 |
| Exact repeat (`r16`), Pulse underruns then admission failure | 46/55 each | 48.661 | 4,747/4,727 |
| Pulse request4 ms only (`r17`) | 55/55 each | 48.831 | 16/19 |
| Pulse request8 ms only (`r18`) | 55/55 each | 48.825 | 0/0 |
| Exact8 ms repeat (`r19`), no Pulse underrun logged | 54/55 each | 48.759 | 54/54 |

**The 45 ms candidates pass the sampled latency gate in several runs, but repeat
fidelity remains unreliable.** All negative controls accept zero.
The tiny IRQ ring briefly admitted playback, then underruns and rising reported
latency caused admission to fail again; the steady return was noise. Initial
default output and timer/default-output attempts (`r1`, `r3`) were rejected before
the steady interval and have no complete-path electrical verdict. A separate
launch failed because a scratch diagnostic output filename was reused; it is
retained as a harness failure, and subsequent launches use unique paths.

The r7 ordered scheduler/start reconciliation finds 21,434 decoded packets,
21,411 observed starts and 23 deadline omissions: 14 at startup, nine later.
Those nine were sent with 41.6–42.2 ms lead, but were already late when receiver
decoding/scheduling ran. Decode-to-decision was at most 0.2 ms for them. This
narrows that burst to transport or receiver processing; it does not distinguish
network delay from a stalled renderer, explain every waveform defect, or prove
that every scheduled buffer reached the analog output. Probe records were not
truncated. Do not use lost original AudioBuffer identities as omission counts.

The r9 trace/probe comparison identifies a separate waveform defect candidate:
20 successive one-sample deletions accompany a roughly 0.412 ms shortening of
measured delay (20 samples are 0.417 ms at 48 kHz). No exact ADC-to-browser clock
calibration was established. A renderer GC also preceded an earlier late burst,
but ended about 29 ms before the late decisions; it does not explain the whole
arrival gap. Sample correction and packet omissions must remain distinct.

A maintained SDK option, `sampleCorrectionMode: "rate"`, now preserves decoded
buffers in the small-error branch and uses native Web Audio playback-rate
correction. Couch opts into it only for Live. The default SDK sample correction,
large-error handling and deadline policy are unchanged. Tests first reproduced
stereo sample changes with the old branch, then passed with preserved samples and
contiguous rate-adjusted scheduling. All 29 SDK tests pass; source typecheck and
a clean patched install passed for the initial revision. The 100 ppm revision
also passes all 29 SDK tests. Neither source test is an audio-fidelity verdict.

Only three compiled receiver assets were changed in isolated candidates. During
r11/r12, CDP supplied their exact bytes to the scratch Linux receiver, and executed
script hashes were checked before the steady interval. Mac capture/Core remained
byte-identical to the frozen 48 ms package. This is a diagnostic delivery method,
not a production package qualification. The first 1000 ppm cap preserved every
observed decoded buffer and had zero short waveform flags, but failed one-second
correlation coverage (52/55 each). Smooth delay changes during correction remain
a plausible cause of those detector rejections; they are not hidden or relabeled
as accepted windows. Reducing only the cap to 100 ppm recovered 55/55 each while
retaining zero waveform flags. All reversed/cross controls accept zero. The
maximum remained 51.327 ms, so the electrical goal still fails. Startup/tail
lateness remains in the full probe evidence. Two clean short waveform intervals
are not sustained, full-bandwidth or calibrated continuous-fidelity qualification.

The next prepared host candidate changes sender lead 48→45 ms and source reserve
23→20 ms, retaining the 25 ms receiver admission budget. Only Core and worker
members differ from the retained host package. Its separate signed Mac scratch
app initially could not acquire audio because macOS required a new microphone grant. A first
controller attempt attached before its product page was ready (`r13`); a second
confirmed the microphone denial (`r14`). Both failures and cleanup are retained. The user then granted access, and r15
completed a fresh 60-second acquisition (`r15`): 55/55 per pair, maximum
48.961 ms, zero short waveform flags. Its exact repeat (`r16`) failed coverage
after Pulse underruns increased minimum latency2→4→8→16 ms and receiver
preparation rose10.667→26.667→42.667 ms, triggering admission failure. Capture
continued; this is an output-side failure with independent earlier late packets.
Increasing only the process Pulse request to4 ms (`r17`) passed sampled latency
but retained16/19 waveform flags. At8 ms, r18 passed both short diagnostics;
r19 passed latency again but retained54/54 waveform flags with no Pulse underrun
in its log. The two r19 waveform groups lie at raw30.427–30.453 and42.486–42.512 s.
Its late packets had38.7–39.9 ms lead at the worker send call and0–0.1 ms
decode-to-decision time. That marker precedes encryption/WebSocket send and the
Core raw TCP tunnel, so it does not establish actual NIC departure. Transport,
Core tunnel and receiver processing remain separate candidates.

The user now directs work away from aggressive Linux tuning: research upstream
defaults, retain a sensible configuration, and test additional Chrome receivers
on a MacBook and Android over Wi-Fi. Listening and reported sync are complementary
evidence, not replacements for electrical or continuous-fidelity qualification.
Initial routed Wi-Fi joins failed before playback in both Helium and Chrome:
required preparation34/37 ms exceeded the25 ms budget, and separate attempts
failed timestamp startup validation. The user's100-sample Chrome trace reproduced
the latter offline: adjacent40 ms slopes sometimes fell to0.934 while the
longer-span slope was1.000076. A separate200 ms rate-validation anchor fixes
that regression while retaining slope limits and adjacent freshness/backward
checks. Invalid-clock controls, SDK tests, typecheck and clean install pass.
This is a software startup fix only. The next isolated candidate retains45 ms
lead and allocates37 ms to output admission; its8 ms source reserve still needs
runtime validation. No Wi-Fi listening or electrical success follows yet.
Evidence: `wifi-mac-admission-r1/` and `wifi-clock-replay-r1/` under the scratch root.
The first corrected Wi-Fi Chrome trial subsequently admitted37 ms and completed
the original52-second signal. The user reported continuous sound with no obvious
artifacts; the host logged no later admission failure. This is subjective
listening evidence only: that Mac's analog output was not returned to the UMC,
and the bounded transport traces filled before the signal. The complete raw
recording and this limitation are retained in `wifi-listening-r1/`. Electrical
and continuous-fidelity qualification remain open.
With Android added, the user heard a few Android crackles on the first run;
the Mac was not assessed closely and sounded quiet. The unchanged repeat sounded
clean on both. Both devices retained ready admission at37 ms; native recordings
completed, but there is no analog Wi-Fi return and detailed traces are truncated.
These mixed results remain unqualified. The user's next direction is broader
device compatibility with less aggressive internal constraints. The separate55 ms
lead comparison completed with both devices listening: Android crackled once
and otherwise sounded clean; no separate Mac verdict was provided. The native
witness completed2,880,000 frames with no reported overload/interruption; source,
witness and scratch Main cleanup completed. Extra10 ms headroom did not eliminate
all reported Android artifacts. These are listening/load observations, not
Wi-Fi electrical latency or continuous-fidelity qualification. The45 ms package
and unchanged50 ms electrical acceptance are retained. Evidence:
`wifi-listening-r2/`, `-r3/`, and `wifi-listening-r4/` (including raw, metadata,
cleanup and hash receipts).

Advanced audio dropdowns now expose scheduling lead for new host shares and a
browser output-buffer preference for the next client join. The maintained95 ms
lead/default Opus path and25 ms source reserve remain distinct from the isolated
45/55 ms PCM diagnostics. No new Mac package was signed or deployed for this UI
work; the authorized R4 package is unchanged. Settings software checks cannot
establish artifact-free audio or the electrical target.
The earlier r8 trace-export cleanup mistake and r10 stale pre-reload script-ID
verification failure are also retained as harness failures, not product evidence.

The package remains frozen ASAR
`5bf9e411f974fe1c64a7302912a929084c602af54aaa8f8c5b995e5dd8514d3b`:
ordinary Mac capture, float32 capture upload, scratch 48 kHz signed16 PCM network
audio, 48 ms sender lead and existing admission policy. Linux receiver overrides
remain experimental; this is not production or calibrated physical qualification.
Private Pulse uses timer scheduling and S32_LE stereo hardware output at 48 kHz.
Its 2-second hardware allocation is distinct from its millisecond active playback
queue. No hardware sample-rate, clock or UMC gain changes were made.

Raw, detector/control/waveform reports, settings and cleanup receipts are under
`.scratch/audio-roundtrip-sync/mac-host-swap-r1/` through `mac-host-swap-r19/`.
All audio runs are stopped. Identity checks verified process retirement, including
follow-up absence checks where the cleanup helper conservatively rejected an
already-exiting process. The native witness is new and not independently validated;
zero witness overload counters do not qualify continuous product fidelity.

One experimental setup passes the sampled 50 ms check. Ordinary Opus capture has not
yet passed the unchanged coverage gate. A later scratch Live PCM extension with
ordinary capture also passes the sampled gate; it still has playback drops. Later
isolated ordinary-capture/Opus trials with64-frame hardware periods also pass the
sampled gate, but retain interior output omissions and remain scratch-only:

| Setup | Accepted windows, left / right | Accepted maximum | 50 ms diagnostic |
| --- | --- | --- | --- |
| Original fresh baseline | 54/55 / 54/55 | 100.597 ms | Delay fails |
| WASM48, source256 and constructor hint | 54/55 / 54/55 | 48.679 ms | Pass; experimental capture/output configuration |
| Public hint, normal capture, latest fresh default-ring control | 51/55 / 51/55 | 49.089 ms | Coverage fails |
| Public hint, normal capture, 2.5 ms encoder | 46/55 / 45/55 | 49.101 ms | Coverage fails |
| Public hint, normal capture, 48 ms with correlated probes | 46/55 / 45/55 | 48.805 ms | Coverage fails |
| Same probes and ordinary capture, 60 ms deadline control | 55/55 / 55/55 | 60.969 ms | Delay fails; full sampled coverage |

Maxima describe accepted windows. Rejected windows remain failures; these results
are uncalibrated diagnostics. A separate public-hint/source256 run aborted with
a capture-clock interruption before the steady interval and has no acceptance
result. The detailed evidence below retains both successes and failures.

The actual path is electrical stereo input → packaged Couch Main/preload capture
→ timestamped upload → scheduled audio worker/Opus → normal Mac product receiver
→ headphone output. One private PulseAudio process owns the four-channel 48 kHz
capture. ADC1/2 record the source reference; ADC3/4 record the Mac headphone return.
The same coherent recording supplies both channel pairs. Installed Couch and its
data, personal browser profiles, routing and hardware volumes are preserved.

## Ordinary Live UI with IRQ64: latency passes, fidelity fails, 14:05 UTC

Returned to the normal Share → Live audio → explicit remapped UMC input UI, with
no R6 capture invocation. The exact retained reuse package, scratch PCM policy,
48ms lead/25ms admission/public Mac .002 hint,48kHz S32_LE four-channel hardware,
64-frame period/256-frame ring and original browser trace categories remain.
The original60s witness,52s stimulus and fixed[20,48) criteria are unchanged.

Both pairs accept55/55 windows, maximum48.9225ms, intended invalid delays0 and
all reversed/cross controls0. **Latency diagnostic passes; fidelity fails:**
63/27991 left and65/27991 right overlapping waveform windows are flagged.
Those are overlapping flags, not63/65 independent glitches. The full source
observation records14947 decoded packets,14931 starts and16 late decisions:
eight startup and eight later. All on-time decisions have observed starts.

All3043 ordinary capture transfers correspond in order to Core worker ingress
under one constant recorded origin offset. Normalization reports zero gap frames.
This does not prove uninterrupted output. For lateblock1318, capture read age is
35.301ms and a15.595ms UI majorGC overlaps delayed delivery. Block2014 is read
aged36.900ms alongside25.067ms React work; block2716 is read aged39.800ms alongside
UI tasks. Transfer follows read immediately. Two other lateblocks have normal
read age:1786 reaches the worker aged38.664ms despite22.300ms read age, while2750
reaches it aged23.676ms and becomes late later. Thus there are multiple delay
locations; neither hardware buffering nor one Core stall explains all failures.

Evidence: `ordinary48-pcm-irq64-current-r1/` (especially
`ordinary-capture-late-blocks.json`, `late-trace-overlap.json`,
`start-reconciliation.json`), `runs/candidate48-ordinary-pcm-irq64-current-01/`
and `pcm-continuity-audit-r1/ordinary-pcm-irq64-current-01.json`.
All acquisition/controller/observer exits0; Main/Pulse cleanup true and ALSAclosed.
Ordinary capture entry is measured, but the PCM/latency policy remains scratch;
this is not supported-production, calibrated or continuous-fidelity qualification.

Decision: stop expanding the optional Core-probe/R6 harness branch. Hold the
hardware format and buffer geometry fixed while addressing observed ordinary
capture/UI delay, then retest the same electrical and fidelity gates. Preserve
separate evidence for the later transport/receiver delays rather than assigning
all flags to UI capture. More clean short intervals alone cannot finish the goal.

## Compilation trace: latency passes, waveform fails, 14:00 UTC

The exact unprofiled reuse package was repeated with compilation events added to
its existing browser trace. Both pairs accept54/55 (98.18%), maximum48.376875ms,
no intended invalid delay, and zero accepted negative controls. The waveform
checker flags14/27991 left and15/27991 right. **Fidelity fails.** Seventeen late
output decisions remain, including startup, an interior event and a late cluster.
The Core task across the late cluster lasts44.170ms,42.087ms threadCPU; unioned
main-thread compilation events cover14.559ms. Compilation contributes but does
not account for the whole task. Further probe expansion is deferred in favor of
a direct ordinary Live UI comparison with the retained tuned audio settings.

Evidence: `owned48-r6-irq64-pcm-reuse-repeat6-r1/`, corresponding raw run and
waveform report. Acquisition/controller/observers exit0; Main/Pulse cleanup true.
The preceding repeat5 aborted on the exact Mac Join selector: the retained UI
snapshot has no source button. Ordered upload confirmed source presence, but no
receiver decoded audio. Its8.448s partial recording and failed receipts remain;
it has no electrical verdict and is not evidence about latency or the Core stall.

## Core stall attribution, 13:34–13:52 UTC

Three further runs retain IRQ64/four periods, ordinary 1024-frame isolated R6
capture, scratch PCM, 48 ms lead, public Mac .002 hint, and the unchanged original
60-second witness/52-second stimulus/[20,48) electrical and waveform gates.

| Observation change | Electrical coverage each | Accepted maximum | Waveform flags each | Whole-source late decisions |
| --- | --- | --- | --- | --- |
| Sparse timing around device update and hub flush | 55/55 | 48.795 ms | 0/27991 | 7 startup + 3 after 61.927 s |
| Repeat existing Core CPU profile | 55/55 | 48.350 ms | 0/27991 | 7 startup |
| Non-Promise callback duration probe | 55/55 | 48.601 ms | 0/27991 | 7 startup |

All negative controls accept zero; intended invalid delays are zero. Every
acquisition/controller/observer exits successfully and Main/Pulse cleanup is
complete. All raw samples and reports are retained. These clean sampled waveform
results do not qualify supported ordinary Live integration or continuous fidelity.

The sparse probe reproduces a 37.779 ms Core task (36.608 ms thread CPU), with
**neither device update nor hub flush overlapping it**. Minor GC occupies only
0.930 ms. This rules out those two specific functions for this task; it does not
justify changing database durability. Both CPU-profile runs avoid the recurrent
task and incur their own large start/stop costs. The callback probe also avoids
it; its slow callback records do not identify a culprit. Observation can perturb
timing, so absence in these finite samples is not a fix.

Evidence: `owned48-r6-irq64-pcm-corelabels-r1/`,
`owned48-r6-irq64-pcm-coreprofile-repeat2-r1/`,
`owned48-r6-irq64-pcm-callbacks-r1/`, corresponding `runs/` directories and
`pcm-continuity-audit-r1/` reports. Use `result-v2.json` and
`start-reconciliation.json`: sample correction replaces AudioBuffer objects, so
unmatched original buffer IDs alone overcount output omissions.

## Unprofiled repeat passes the sampled waveform check, 13:19–13:28 UTC

The exact reuse package (ASAR5bf9e411… described below), IRQ64/four periods, public Mac.002
hint,48ms lead and retained browser trace was repeated without the Core CPU
profiler. Both intended pairs accept55/55, maximum48.489167ms; invalid intended
delays0 and all reversed/cross controls0. The unchanged waveform checker flags
**zero** of27991 overlapping windows per channel in the original[20,48) interval,
with minimum correlations0.997399/0.997459. The full60s four-channel raw, original
52s stimulus, all rejected/accepted rows and startup/tail remain retained.

This does not close reliability. The65s source run has14958 decoded packets,
14948 starts and10 late decisions: six startup and four at61.775959–61.787292s
relative to first decode, after the electrical witness ended. A36.561ms Core task
occurs across that late cluster. One block reached the audio worker normally and
was sent with38.356/43.168ms lead, yet two packets were later late at the receiver;
the next block reached the worker aged40.803ms. Thus source sample age alone
cannot explain all missed output. The Core proxy also handles outbound transport;
its precise blocking function remains to be identified. No cross-machine clock
subtraction is used. Fifteen buffer identities are lost after SDK replacement;
ordered scheduler/start reconciliation accounts for them without calling them drops.

Evidence: `owned48-r6-irq64-pcm-reuse-repeat4-r1/`,
`runs/candidate48-owned-r6-irq64-pcm-reuse-repeat4-01/`, and
`pcm-continuity-audit-r1/owned-r6-irq64-pcm-reuse-repeat4-01.json`.
A preceding repeat2 abort retained8.219s of raw: both machines received the source
and ordered upload was active, but the expected Mac Join locator timed out.
It has no electrical verdict. Repeat3 failed a preparation anchor assertion and
then the launcher's pin check before any audio process launched. Both failures
remain. Repeat4 changes only failure-path button/heading observation and completes
with every acquisition/controller/observer exit0; the Join selector is unchanged.

Main cleanup initially records a disappearing executable during a child's exit
and conservatively reports incomplete despite no remaining PIDs. A separate
bounded follow-up verifies every retained PID absent and the original owned group
empty twice, without further signals. Both receipts remain; ledger retirement
points to that follow-up. Private Pulse cleanup completes and ALSA is closed.
This is the first clean **unprofiled** sampled waveform result in this segment;
the earlier reuse trial remains red. Supported ordinary Live integration,
sustained fidelity and calibrated physical qualification remain unfinished.

## Array reuse and a clean profiled sample, 13:04–13:15 UTC

A fresh scratch derivative changes only the isolated upload worker's temporary
sample arrays to reuse their storage. The helper, Core, encoder, receiver and
hardware geometry remain unchanged. A1200-block differential check (including
frame-size changes, stereo content and silence) retains identical upload packets,
fingerprints and metadata while reducing sample-buffer allocations4800→603.
The first allocation test incorrectly counted non-allocating views; that failed
test and explanation remain beside the corrected check. ASAR:
`5bf9e411f974fe1c64a7302912a929084c602af54aaa8f8c5b995e5dd8514d3b`.

The actual reuse trial still fails waveform fidelity:14/14 flagged overlapping
windows, despite latency coverage55/55 left and54/55 right, maximum48.366ms,
controls0 and no invalid intended delay. A steady lateblock1323 coincides with a
13.336ms Core task; a38.544ms Core task accompanies further late output after the
witness ended. This trial does not establish a fidelity benefit from array reuse.
Evidence: `owned48-r6-irq64-pcm-reuse-r1/` and corresponding raw run.

An observation-only child adds the standard Node inspector CPU profiler to Core
at1ms sampling. Its exact original electrical test accepts55/55 each, maximum
48.425ms, controls0. The unchanged waveform diagnostic reports **zero flagged
windows** on both channels in[20,48), minimum correlations0.997889/0.997946.
All14944 decoded packets have decisions;14938 start, with six late startup
packets and no later late decision. This is one clean sampled scratch run, not
reliable supported capture or continuous-fidelity qualification. Profiling itself
adds a101.596ms startup Core task and56.197ms shutdown task, and changes runtime
timing. The earlier39ms task did not recur. A10.560ms Core task includes7.353ms
sampled in synchronous `touchDevice` database work; that does not identify the
unobserved39ms stall. Evidence: `owned48-r6-irq64-pcm-coreprofile-r1/`,
`profile-long-tasks.json`, CPU/host traces and corresponding raw/waveform reports.

A counter limitation was found and corrected transparently: SDK sample correction
can replace an AudioBuffer, losing its original WeakMap decode ID while still
starting output. The reuse/profiling summaries initially count24/27 unmatched
IDs, but ordered scheduler/start reconciliation establishes12/6 omitted starts;
12/21 additional starts lack original buffer identity. Every on-time decision
is followed by an observed start. `start-reconciliation.json` and `result-v2.json`
supersede those omission counts; all original reports remain. Electrical and
waveform verdicts are unchanged. No journal rows were dropped. Both runs cleanly
retire helper/source, Main and private Pulse, leaving ALSA closed. The next check
repeats the exact unprofiled reuse configuration rather than adopting profiling
as a latency fix.

## Remaining stalls located at upload-worker delivery, 12:52–13:01 UTC

The observation-only PCM timing derivative retains IRQ64/four periods and the
same audio path. Both pairs accept55/55, maximum48.900ms, controls0 and no
invalid intended delay. The unchanged waveform check still flags20/20 overlapping
windows. Two interior receiver late decisions map to sourceblock1989, already
38.926ms old at worker ingress; Core→worker is0.391ms and worker→send0.221/0.494ms.
No timing journal dropped rows. Evidence: `owned48-r6-irq64-pcm-timing-r1/` and
`runs/candidate48-owned-r6-irq64-pcm-timing-01/`.

An initial offline field `decisionServerLeadMs` incorrectly subtracted the Mac's
local performance clock from server timestamps. It is invalid and must not be
used. The original `packet-stages.json` remains; `packet-stages-v2.json` removes
that field and records the clock-domain limitation. No network delay is inferred.

Adding only the retained Linux browser trace to this exact package again passes
55/55 per pair, maximum48.736ms, controls0 and no invalid intended delay. Waveform
still fails15/14 overlapping windows. The helper PID and upload-worker thread are
identified; the console timestamp falls inside the10.224ms monotonic bracket.
All3049 binary upload sends match ordered Core receipt sequence count. Trace IDs
link the helper's block2202 post to worker handling11.961ms later, followed by
0.531ms to WebSocket send. Core→audio-worker is0.427ms. The worker's preceding
6.876ms MajorGC supports allocation/GC as a candidate, but does not directly
overlap the entire later wait; its cause is not yet established. A separate
39.621ms Core task corresponds to later omitted output, after the60s electrical
recording ended. Preserve it as a sustained-path concern, not a waveform claim.

There are13 late decisions across the full65s source: six startup, one interior,
and six after61.482s relative to first decode. All14956 decoded packets and
scheduler decisions are retained,14943 starts observed, no journal/probe drops.
Both runs pin actual loaded host/Mac frontends before capture and finish with all
controller/acquisition exits0, reviewed Main/Pulse cleanup complete and ALSA closed.
The scratch R6/PCM route remains unqualified for supported ordinary Live and
continuous fidelity. Evidence: `owned48-r6-irq64-pcm-hosttrace-r1/`, its
`upload-trace-match.json`, retained trace and raw run; unchanged waveform reports
are in `pcm-continuity-audit-r1/owned-r6-irq64-pcm-{timing,hosttrace}-01.json`.

## Isolated capture plus PCM: latency passes, waveform still fails, 12:39–12:44 UTC

A new explicit scratch derivative retains R6 isolated ordinary capture, IRQ64
(four periods,256-frame ring), the missing-pactl guard and idle-radio fix, then
changes only the Live codec path to the already-tested signed16/stereo48k PCM
encoder. Packets contain at most240 frames and emit partial tails immediately;
no codec lookahead or sample padding is added. Core is byte-identical to its
parent. The only changed archive members are the audio worker, active receiver
negotiation chunk and PCM decoded-observation hook. The full observation probe
adds its existing PCM weak-map callback; no Core/worker timing journals were added.
The packaged PCM/Opus/capacity/deadline/owner admission controls pass. The separate
maintained relaxed-PCM queue fix remains outside this frozen derivative.

The original60/52-second physical test, fixed[20,48), explicit50ms threshold and
all confidence/coverage gates are unchanged. Both pairs accept55/55, median
48.066ms and maximum48.782ms; no confidently invalid intended delay occurs and
reversed/cross controls accept zero. Both actual loaded frontends were pinned
before acquisition. Core admission reports PCM with25ms required/minimum lead,
zero correction and normal Mac output readiness.

**Continuous fidelity remains red.** The unchanged validated PCM waveform
checker flags55/56 of27991 overlapping windows per pair. These counts are not
independent defect counts or lost-audio duration. All14938 decoded PCM packets
have retained observations,14928 have unique output starts, and no probe rows
were dropped. Six missing starts occur at startup; four occur in the interior
at41.128021 and43.773813..43.783813seconds relative to the first decoded packet.
These software coordinates are not calibrated ADC coordinates. The65-second
helper/worker run again records3049 blocks, zero reported timestamp discontinuities
or errors, all worker AudioData closed and zero queued frames at stop. Its retained
first64/recent512 metadata does not cover those interior delays, so their location
in capture/Core/network/receiver cannot yet be assigned from these receipts.

Evidence: `owned48-r6-irq64-pcm-r1/`,
`runs/candidate48-owned-r6-irq64-pcm-01/`,
`pcm-continuity-audit-r1/owned-r6-irq64-pcm-01.json`, and
`candidate-owned48-r6-pcm-r1/receipt.json`. ASAR:
`548ea864d94c1a691a5d76ac8c3cfcbcbca5bf6466d75e87cfa78d6dfaf65879`.
All acquisition/controller/observer exits are zero; helper/source cleanup and
reviewed Main/Pulse retirement complete, private socket absent, ALSA closed.
This is useful sampled electrical progress, not supported-product integration,
artifact-free audio or calibrated physical/continuous-fidelity qualification.
The next experiment should locate the remaining interior delays with retained
boundary timing, keeping this exact configuration as the reference.

## Isolated ordinary capture and smaller hardware periods, 12:00–12:33 UTC

A fresh ordinary-UI PCM/IRQ256 repeat again accepted55/55 per pair, maximum
48.475ms, but the frozen waveform diagnostic flagged53/52 overlapping windows.
Late steady source blocks arrived aged34.688/48.519ms; their Core-to-worker
handoff was below0.4ms. This reproduced residual defects after the host improvement.
Evidence: `ordinary48-pcm-irq256-repeat2-r1/` and its corresponding raw run.

R6 was then selected specifically to investigate UI delivery stalls. No abandoned
supervisor was repaired or run. The working600-second launcher and reviewed
native-r4 per-identity cleanup launched the exact frozen R6 package. Its existing
native Close controller passed the capture-specific pre-ready cancellation in a
70.959ms hold: one real WM_DELETE_WINDOW, helper destroyed before readiness,
permission cleared, owner retained. This is not a pending-native-GUM claim.
A subsequent10-second actual ordered upload completed with472 matched helper/
worker blocks, zero reported discontinuities/errors, zero queue at stop, actual
source presence, Mac Listening and Core ready Opus admission. Both helper/source
cleanup acknowledgments and final process cleanup completed. This supersedes
R6's historical pending Close/upload status; it does not qualify product Live.
Evidence: `owned-capture-r6-direct-r1/`.

The full electrical comparisons retained the original60-second coherent raw,
52-second stimulus, fixed[20,48), explicit50ms gate,95% per pair and controls.
The initial R6 comparator is `ordinary48-correlated-r1/` (46/55,45/55), with the
same original Pulse geometry, full v2 observation probes and exact Core/worker.
The older uninstrumented51/55 ring control is contextual only.

| Candidate | Accepted L / R | Accepted maximum | Decoded without observed start, whole run |
| --- | --- | --- | --- |
| Frozen R6, original timer96000/48000 ring/period | 47/55 / 47/55 | 49.534ms | 1248 / 12750 |
| Same R6, IRQ1024/256 | 55/55 / 55/55 | 49.065ms | 57 / 12760 |
| R6 plus missing-pactl guard, IRQ1024/256 | 50/55 / 50/55 | 48.791ms | 243 / 12766 |
| Same guarded package, IRQ256/64 | 55/55 / 55/55 | 48.853ms | 8 / 12769 |
| Same64-frame geometry plus idle-radio timer fix | 55/55 / 55/55 | 49.064ms | 15 / 12760 |

All reversed/cross controls accept zero and all intended confidently invalid-delay
counts are zero. Failures and rejected windows remain. Every65-second ordered
capture completed3049 ordinary1024-frame blocks, with zero reported raw timestamp
discontinuities/errors; every worker AudioData closed and queue-at-stop was zero.
These counters do not prove continuous electrical fidelity. All decoded packet
timestamps form a continuous5ms sequence (within rounding); missing output starts
persist, including the interior. The strict PCM waveform criterion has not been
represented as qualified for this lossy Opus path.

The guard-only trial did not establish a performance improvement: retained worker
age median/p95 changed from23.600/24.100 to26.200/26.601ms between256-frame runs.
Those age summaries cover only first64/recent512 retained blocks, not the whole
run or a calibrated ADC clock. Frequent320ms loss patterns suggested insufficient
Opus margin and hardware-period phase as a hypothesis, not proven causality.
Changing only fragment_size4096→1024bytes (four periods retained) negotiated64-frame
periods/256-frame ring and reduced retained worker age to22.301/22.601ms. That run
had five startup missing starts and three interior omissions at30.325,30.345 and
44.705seconds relative to its first decoded packet. Those coordinates are not ADC
coordinates; no acceptance interval was changed. Pulse retained a POLLIN/avail
warning; no overrun/underrun message was found, which is not proof of their absence.

The subsequent idle-radio fix retained the same Core/worker/capture/geometry.
It did not establish fidelity improvement: five startup and ten interior missing
starts remain, including15-second repetitions and a separate39.22-second cluster.
No artifact-free claim is supported.64-frame periods are promising, but sustained
repeatability and robustness against scheduling interruptions remain unqualified.

R6 itself stays frozen. Explicit new derivatives change only Core's two already-
tested missing-pactl guards (`candidate-owned48-r6-pactlguard-r1`, ASAR
`ad9d3f56d16f426ceaa42d0555c5dfde3fac188891ae98838e74fa71343a11b6`), then only the
active radio chunk's already-tested idle timer subscription
(`candidate-owned48-r6-idleclock-r1`, ASAR
`ecf562707d7954fefb435025d3b186ebef898811ffe79acacaa153013203f2fb`). Every other
archive member is byte-identical to its respective parent. Opus/frame5 remains;
no scratch PCM or separate relaxed-PCM queue change was folded into these packages.

A provenance limitation was found and preserved: reused R6 frontend preflight
checked host scripts only. A read-only post-run Mac check after the64-frame guard
run matched all loaded R6 scripts, but cannot retroactively pin the earlier
recordings. The idleclock run verifies actual loaded script hashes on both host
and Mac before acquisition. Both still use the public.002 output hint, with no
constructor shim or source256 switch.

Evidence: `owned48-r6-{electrical,irq256,irq256-pactlguard,irq64-pactlguard,irq64-idleclock}-r1/`
contains complete electrical/control/ordered-capture/probe/result/cleanup receipts;
raw recordings are `runs/candidate48-owned-r6[-irq256|-irq256-pactlguard|-irq64-pactlguard|-irq64-idleclock]-01/`.
All acquisitions/controllers/observers exited zero. Reviewed per-identity cleanup
confirms Main/children and Pulse retired, private socket absent, ALSA capture and
playback closed. Installed/personal state, routing, volumes and clocks remain
unchanged. The infrastructure alone has a verified13:06UTC lease. Its first renewal
safely stopped on transient Xvfb keymap-compiler children; the preserved fresh resume
retired only remaining owned infrastructure and completed the bounded renewal.

The goal remains open: no supported ordinary-Live integration or calibrated
continuous-fidelity qualification has been completed. Next, attribute the sparse
interior receiver omissions at64-frame periods; do not treat sampled latency
passes, packet counters or the smallest buffer setting as completion.

## Host buffer tuning, 11:18–11:56 UTC

The UMC404HD descriptor exposes capture as S32_LE with24 valid bits; S16_LE
is playback-only. A16-bit capture trial would add conversion, not change the ADC.
Copied private Pulse configurations retain48kHz, channel maps and volumes.
Original `preflight/config/private.pa` remains byte-identical. Every run below
uses ordinary1024-frame Chromium capture, the frozen scratch LivePCM240-frame
package `candidate-48-pcm-idleclock-r1/Couch`,48ms lead and the public Mac.002
output hint. This is still scratch PCM, not supported-product qualification.

| Pulse hardware setting | Accepted L / R | Accepted maximum | Capture age p95 | Waveform flagged L / R |
| --- | --- | --- | --- | --- |
| Timer reference,96000/48000 ring/period | 53/55 / 53/55 | 49.110ms | 34.138ms | 378 / 375 |
| IRQ default,4800/1200 | 42/55 / 42/55 | 48.990ms | 46.984ms | 13257 / 13258 |
| IRQ,1024/256 | 55/55 / 55/55 | 49.070ms | 24.216ms | 39 / 38 |
| IRQ,512/128 | 55/55 / 55/55 | 48.630ms | 24.864ms | 20 / 20 |
| IRQ1024/256, owned Pulse I/O thread RR5 | 55/55 / 55/55 | 48.589ms | 24.143ms | 19 / 18 |
| IRQ1024/256, Linux task trace | 53/55 / 54/55 | 48.969ms | 26.780ms | 87 / 86 |
| IRQ2048/256, eight-period ring | 53/55 / 53/55 | 48.855ms | 26.767ms | 101 / 102 |

All retain the original60-second recording,52-second stimulus,[20,48), explicit
50ms threshold and95% gate per pair. Reversed/cross controls accept zero and no
intended delay is confidently invalid. All raw recordings and rejected windows
remain. Waveform counts are overlapping10ms windows at1ms hops in the separate
frozen diagnostic, not independent defects or lost-audio duration. Every setting
still has detected defects. No artifact-free or calibrated-fidelity claim follows.

Changing IRQ default to256-frame periods recovered about10ms of capture-age p95
relative to the timer reference without changing Chromium block size. IRQ default
is rejected. Neither128frames nor temporary RR5 establishes superiority for rare
failures from one run. The RT trial changed only the identity-verified owned Pulse
ALSA thread with a200ms RLIMIT_RTTIME guard; cleanup confirms it absent. Doubling
only the ring from4 to8 periods did not improve fidelity and is not retained.
The four-period256-frame configuration remains the useful reference.

The Linux trace is observation-only and may perturb timing. A console timestamp
inside a Node monotonic bracket verifies trace/worker clock comparability; it does
not calibrate ADC time. Source blocks392 and422 arrive aged41.428/55.164ms after
main-renderer MajorGC spans31.809/44.475ms. The minified `D` callback is React's
scheduler; it runs8.661ms near block254 and16.990ms during block1846's delay.
The earlier block1845 age59.592ms remains unexplained by duration-bearing events.
The trace has no uppercase B/E spans; lowercase asynchronous events describe
animations/event timing and cannot be treated as CPU-blocking spans. These facts
identify specific application stalls, not the cause of every residual defect.

Evidence: `host-audio-tuning-r1/comparison-01.json`, preparations
`ordinary48-pcm-{irq-default,irq256,irq128,irq256-rt,irq256-hosttrace,irq256-ring8}-r1/`,
corresponding `runs/candidate48-public-normal-pcm-*-01/`, and
`pcm-continuity-audit-r1/irq*-01.json`. Each preparation has electrical, controls,
stage and cleanup reports. All native/controllers/observers exit zero; reviewed
per-identity cleanup retires Main/children and Pulse, removes the private socket,
and confirms ALSA capture/playback closed. The next decision is repeatability of
exact untraced IRQ256, not further threshold or interval changes.

## Ordinary capture: correlated deadline comparison, 09:18–09:29 UTC

**Hypothesis:** ordinary capture loses playback deadline margin. First, the
unchanged detector reproduced the retained default-ring failure: 51/55 per pair,
maximum 49.089 ms. Then two new complete electrical runs compared that exact
public-hint frame5 package with observation-only v2 browser probes (empty options)
at 48 ms, versus a 60 ms deadline control with the same probes. Each used fresh
private Pulse with original `private.pa`, verified 96,000-frame ring / 48,000-frame
period, ordinary capture, and no source-buffer switch or constructor override.

| Sender deadline | ADC1→3 coverage | ADC2→4 coverage | Median L / R | Maximum L / R |
| --- | --- | --- | --- | --- |
| 48 ms with probes | 46/55 (83.64%) | 45/55 (81.82%) | 48.560 / 48.556 ms | 48.805 / 48.805 ms |
| 60 ms control | 55/55 (100%) | 55/55 (100%) | 60.398 / 60.398 ms | 60.969 / 60.968 ms |

Both retained all 2,880,000 frames, original 52-second stimulus, prospectively
fixed [20,48), explicit `--threshold-ms 50` and unchanged confidence/coverage
gates. Reversed/cross controls accept zero; no intended-pair delay is confidently
invalid. The 48 ms run retains nine/ten low-correlation rejections. The 60 ms
control has full coverage but fails delay. Neither passes the goal or establishes
calibrated physical/continuous-fidelity qualification.

**New evidence:** at 48 ms, all 11,370 decoded buffers form a continuous 5 ms
sequence (rounding ±1 µs), but 1,625 have no observed output start. At 60 ms,
only 12 of 11,433 have no start, including five at startup and seven later.
Every observed start has a matched decoded identity, 5 ms duration and rate 1.
Decode-ready → start-call median/p95 stays 0.1/0.2 ms in both runs. Both retain
1,024-frame capture blocks; whole-run first-sample age median/p95 is 28.2/33.301 ms
at 48 ms and 27.6/32.700 ms at 60 ms. Maxima remain 113.3/118.9 ms. Both probes
report zero dropped rows/errors. Normal readiness remains clock error 1 ms,
output estimate 8 ms, required/minimum buffer 25 ms and zero correction.

The control changes only policy constants in copied Core/worker bundles:
lead 48→60 and reserve 23→35 preserve output cap 25 ms. Every other ASAR member
and executable is byte-identical. This is a scratch configuration overlay, not
a source rebuild/release. An initial post-write verifier failed on leading-slash
ASAR paths; a read-only corrected verifier confirmed the exact delta before
runtime. The failure remains recorded. No maintained product change occurred;
the separate relaxed PCM queue fix, R6 and all prior evidence remain untouched.

**Decision:** the comparison strongly supports insufficient deadline margin in
the ordinary pipeline. Continuous decoded timestamps weaken missing transport
packets as the explanation for this run; full coverage at 60 ms weakens an
inherently unsuitable stimulus/detector explanation. Receiver drop reasons and
the separate capture/upload/encode/transport contributions remain unmeasured.
Do not attribute the difference from the older uninstrumented control to probe
overhead from one comparison. Witness timestamps are receipt-only: saved clock
brackets do not establish exact ADC-to-browser alignment. Next, retain the 48 ms
configuration and measure packet headroom at worker emission and receiver arrival
before choosing a supported delivery change. Extra deadline is not the solution.

A narrow official Pulse17 source check did not justify a watermark-only trial:
`fix_min_sleep_wakeup()` starts from a 10 ms minimum sleep, clamped to half the
requested buffer; `fix_tsched_watermark()` caps the watermark accordingly.
No Pulse setting was changed. Original `private.pa` retains its original hash.

**Cleanup:** native writers, controllers and observers exit zero. Normal
Leave/Stop precedes probe export; scripts are removed and pages reloaded.
Reviewed native-r4 per-identity cleanup confirms Main/children and Pulse absent,
private socket absent, and ALSA capture/playback closed. Final Mac inspection
finds no probe/shim markers or Leave control. Installed/personal state is preserved.
Owned infrastructure remains identity-verified under its 10:06 UTC lease.

Evidence under `.scratch/audio-roundtrip-sync/`: preparations
`ordinary48-correlated-r1/` and `ordinary60-correlated-control-r1/`, recordings
`runs/candidate48-public-normal-correlated-01/` and
`runs/candidate60-public-normal-correlated-control-01/`, plus
`candidate-60-wasm-public-control-r1/`. Each preparation's `result.json` records
raw/detector/probe hashes and results; all rejected windows and controls remain.

## PCM and complete packet timing, 09:52–10:09 UTC

The 48 ms ordinary Opus run with complete timing retained **47/55 windows on
both pairs**, maximum 49.218 ms: coverage failure. Every one of 11,441 transmitted
packets reached a receiver scheduling decision; **1,471 decisions were late**.
Late-packet median render headroom was −2.279 ms. Emission-to-send median/p95
was 14/22 µs (maximum 31.295 ms); median ingress age was 28.858 ms. This directly
identifies missed render deadlines; missing accepted windows alone did not.

A scratch Live PCM extension then removed Opus lookahead and cross-block packet
waiting. It retained ordinary 1,024-frame capture, the original Pulse ring,
48 ms lead, 25 ms output budget and public output hint. Available normalized
samples emit immediately as signed16 stereo48k PCM in packets of at most240
frames, including partial tails. Source timestamps are preserved. Protocol PCM
support does not make this already-supported Couch Live behavior: the maintained
Live route still restricts Opus. The separate relaxed PCM queue fix is not mixed
into the frozen package.

| PCM48 pair | Coverage | Median | Maximum | Result |
| --- | --- | --- | --- | --- |
| ADC1→3 | 51/55 (92.73%) | 48.952 ms | 49.290 ms | Coverage fails |
| ADC2→4 | 52/55 (94.55%) | 48.954 ms | 49.289 ms | Coverage fails |

All60 seconds/2,880,000 frames, the original52-second stimulus, fixed[20,48),
explicit50 ms threshold and rejected windows remain retained. Controls accept
zero and intended pairs have zero confidently invalid delays. All12,068 sent
packets match receiver decisions in order; **65 actual late decisions remain**,
versus1,471 in the prior Opus run. These are whole-run counts, including startup.
Both probes and worker journal have zero dropped rows. The capture journal shows
two missing-position events (1,030 and1,021 frames), near startup and shutdown;
these are not silently removed from fidelity evidence.

Exploratory20 ms waveform tiles show mostly strong correspondence (median
correlation≈0.994), interrupted by short failures and abrupt delay changes.
This is not a validated continuous-fidelity qualification and does not replace
or relax the original electrical detector. PCM is promising but not drop-free.
Several large deadline-loss clusters repeat around five seconds, often between
browser frame transfer and worker ingress. The next comparison observes Core
upload receipt and event-loop delay to locate that remaining cost before another
behavior change.

Cleanup completed: all acquisition/controller/observer processes exit0; normal
Leave/Stop completed; reviewed per-PID cleanup confirms Main/children and Pulse
absent, socket absent, and ALSA capture/playback closed. The infrastructure lease
was separately renewed to11:06 UTC, warning10:59 UTC; it is not capture authority
past an individual600-second supervisor bound.

Evidence: `ordinary48-full-timing-r1/`,
`runs/candidate48-public-normal-full-timing-01/`, `live-pcm-candidate-r1/`,
`candidate-48-pcm-r1/`, `ordinary48-pcm-r1/`,
`runs/candidate48-public-normal-pcm-01/`, and `pcm-fidelity-diagnostic-r1/` under
`.scratch/audio-roundtrip-sync/`. PCM ASAR SHA256:
`2a03fb48242735fd81b106e76415da1d003650985a34f3f3c055dc510c9fd6a3`.

## Missing sound-helper retries: ordinary-capture sampled pass, 10:20–10:30 UTC

Additional observation-only Core/worker timing reproduced the PCM failure:
52/55 each, maximum48.590 ms. Core showed repeating five-second delayed callbacks;
most Core-to-worker forwarding was fast (median0.355 ms,p950.499 ms). Several
large browser-transfer-to-ingress delays coincided with Core stalls. Worker
receiver-state handling took under0.11 ms in steady operation, weakening the
five-second receiver-state handler as the cause.

`/usr/bin/pactl` is absent on this host. Sound monitoring repeatedly spawned it
for subscription and inventory recovery. A small maintained guard checks its
presence before spawning, preserving the same retry cadence, missing-tool
message, installation recovery and session-loss/Close behavior. The regression
first reproduced18 query spawns and5 subscription spawns while absent; after the
fix all four integration cases and TypeScript checking pass.

The frozen comparison changes only Core's missing-tool spawn guard, retaining
PCM48, handoff probes and original Pulse configuration. Recurring Core stalls
vanished in the observed steady span. The unchanged electrical detector reports
**54/55 (98.18%) on both pairs**, median48.954 ms, maximum49.119 ms; controls
accept zero and no intended-pair lag is confidently invalid. This is a sampled
50 ms diagnostic pass using ordinary capture plus the still-experimental Live
PCM extension. It is **not continuous-fidelity qualification**:62 late receiver
decisions remain across the whole run, including steady operation. The comparison
control had140; run-to-run counts are not a deterministic performance guarantee.

A failed administrative attempt is retained: two frontend`networkidle` timeouts
were followed by an erroneous shell continuation into acquisition. Root stopped
it at484,608 recorded frames; normal Leave/Stop and per-PID cleanup completed.
It is excluded from qualification, not erased. The fresh run verifies loaded
script hashes after DOM/application readiness; network quiescence is not an app
readiness requirement. Subsequent launch commands fail closed on check errors.

Both completed and interrupted runs retain raw evidence. Final cleanup confirms
Main/children/Pulse absent, private socket absent and ALSA capture/playback closed.
Evidence: `ordinary48-pcm-handoff-r1/`, `missing-pactl-fix-r1/`,
`candidate-48-pcm-pactlguard-r1/`, `ordinary48-pcm-pactlguard-r2/` (interrupted),
`ordinary48-pcm-pactlguard-r3/` (complete), and corresponding
`runs/candidate48-public-normal-pcm-{handoff-01,pactlguard-01,pactlguard-02}/`.
Next: localize remaining receiver-side stalls, including observed15-second
clusters, without changing deadlines or hiding rejected windows.

## Renderer work and ordinary PCM controls, 10:32–11:10 UTC

A dedicated Mac trace identified 15-second React flushes of 6–11 ms and an
18.466 ms major GC. Empty radio metadata subscribed to the shared progress timer.
The maintained fix leaves empty metadata unsubscribed; its real React browser
regression goes red before the fix and passes afterward, with TypeScript passing.
The exact frontend-only candidate still failed electrical coverage (52/55 each,
maximum49.382 ms,65 late decisions). This fix does not establish audio reliability.
Trace overhead and instrumentation allocations remain possible contributors.

The next controls retained ordinary1,024-frame capture, original Pulse geometry,
PCM stereo48k, public Mac output hint, original60/52-second acquisition and fixed
[20,48), threshold50ms. Every reversed/cross control accepted zero; no intended
pair had a confidently invalid delay. All raw samples and rejected windows remain.

| One-variable control | Left / right accepted | Accepted maximum | Late decisions, whole run | Result |
| --- | --- | --- | --- | --- |
| Lightweight browser counters; same240-frame PCM | 53/55 /53/55 |49.110 ms|98|Sampled pass; waveform defects remain|
| PCM maximum240→480frames, immediate tails |52/55 /52/55|49.184 ms|74|Coverage fails; reject|
| Original240frames, lead48→48.75ms |52/55 /52/55|49.398 ms|49|Coverage fails; reject|

The larger packets reduced count but increased the audio carried by late packets
from22,288 to34,272 frames (464.3→714ms across the whole run, including startup/tail).
This is software loss accounting, not measured analog missing duration. Transmitted
and decoded counts match in each run; lightweight journals have no dropped rows.
Late packets often arrive at the worker with first-sample age around34–35ms;
Core→worker handoff medians are below0.5ms. Larger sporadic delays also remain.
These observations support a tight capture/render margin, not a calibrated floor
or a single explanation for every failure. The48.75ms trial's first normalized
sample was verified at capturedAtUs+48,750; extra lead did not remove defects.

A separate offline waveform diagnostic now covers every return sample in[20,48)
with10ms windows at1ms spacing. Criteria were fixed before examining these runs:
correlation0.98, gain stability, silence/clipping, search-boundary and abrupt-delay
flags. Fractional-delay reference fitting leaves raw data unchanged. Clean synthetic
controls at0/±100ppm pass; injected1ms silence, repeat, deletion, sign flip, clipping
impulse and gain change are detected. The initial integer-score implementation
falsely flagged clean drift; its failure and corrected validation are preserved.
This is an explicit sensitivity check, not general continuous-fidelity qualification.

The240-frame sampled-pass run has378/375 flagged windows out of27,991 per pair;
480-frame packets have572/574;48.75ms lead has403/402. Overlapping flags are not
independent defects or missing-audio duration. Typical correlation is about0.9984,
with short severe failures in both returns. Passing the original sampled latency
gate therefore does not mean artifact-free audio.

All three runs completed normal Leave/Stop, native recording exit0 and reviewed
Main/Pulse cleanup; ALSA closed. Owned access was renewed separately to12:06UTC.
No installed/personal app, routing, hardware volume or clock setting changed.
No source256 switch, constructor shim, R6 loader or supervisor-r3 was used.

Evidence under`.scratch/audio-roundtrip-sync/`: `idle-radio-clock-fix-r1/`,
`ordinary48-pcm-{ui-timing,mac-trace,idleclock,light,packet480}-r1/`,
`ordinary4875-pcm-r1/`, `pcm-continuity-audit-r1/` and corresponding`runs/`.
The new`receipt-audit.json` files retain two provenance corrections: the light
preparation's descriptive candidate-verification hashes were stale (runtime
product pins are correct); the480-frame preparation retained a5ms metadata label
although its exact package and trace show10ms packets. Original receipts remain
untouched. Neither correction changes the rejected outcome or supplies qualification.
Live PCM remains scratch-only. A supported capture implementation with more
measured deadline margin, plus sustained fidelity evidence, is still required.

## Measurement

The [sync-test evaluation](sync-test-evaluation.md) explains why stock upstream's
±5 ms relative-output detector cannot directly measure this route. The small
[offline adapter](../scripts/audio-roundtrip.py) derives its numerical detector
from pinned Sendspin/sync-test, reads retained S32_LE recordings, and searches
reference-to-return delay at the recorded 48 kHz rate. It needs only NumPy/SciPy,
not PortAudio or a second device open. The original acquisition writer remains;
this replaces the latency-analysis loop, not the actual product path.

Checks require at least 95% accepted windows per pair, no confidently
invalid delay, and every accepted delay within the configured threshold. The
adapter defaults to 100 ms; current experiments explicitly use `--threshold-ms 50`.
Rejected windows remain in the
report. Windows cover the complete requested interval; gapped schedules reject.
Reversed and cross-channel controls must accept no windows. Fifteen deterministic
tests and an independent review cover these gates, including two aggregate
false-pass bugs found and corrected before candidate measurement.

The interpolation grid is not calibrated accuracy. ADC channel/path bias,
absolute sample-rate accuracy, continuous fidelity and per-packet completion
remain separate measurements. Reports explicitly retain
`physical_qualification: false` and `calibration: uncalibrated`. The earlier
failed affine timing gates in the [validation ledger](audio-video-refactor-validation.md)
remain failed; this method does not reinterpret them as passes.

## Baseline

The original 610-second recording, unchanged, gives approximately 101.34 ms median
with either the prior pilot evaluator or the new waveform detector. The new
detector's accepted-window maximum is 101.593 ms; both intended pairs accept
1,096/1,119 windows. Reversed and cross pairs accept zero.

A fresh 60-second recording uses the original 52-second stimulus and the fixed
steady interval [20,48). The corrected detector gives:

| Pair | Accepted windows | Median | p95 | Maximum | ≤100 ms diagnostic |
| --- | --- | --- | --- | --- | --- |
| ADC1→3 | 54/55 (98.18%) | 100.115 ms | 100.576 ms | 100.597 ms | Fail |
| ADC2→4 | 54/55 (98.18%) | 100.115 ms | 100.576 ms | 100.597 ms | Fail |

Each pair has one low-correlation window; reversed and cross pairs accept zero.
All 2,880,000 frames were retained; witness, generator, observers and publication
completed with exit 0. A UI cleanup locator correction is recorded separately.
Raw SHA-256: `93efba31e2b7f9b43005e11811ae4245cd3b51690c18d67932af902013a80e11`.
Evidence is under `.scratch/audio-roundtrip-sync/runs/baseline-01/`; corrected
reports are `roundtrip-v2.json` and `roundtrip-negative-v2.json`. Original v1
reports remain unchanged.

## Candidate and software checks

Live sender lead changes from 100 to 95 ms. Live Opus packets, WAV demuxer packets
and Ogg pages change together from 10 to 5 ms (240 stereo frames / 1,920 float
bytes). This lets the encoder emit from the first 479-frame normalized capture
block without waiting for another 10 ms input block. Relaxed capture retains its
1-second lead and 10 ms Opus cadence. Receiver admission remains at 70 ms.

An 18-trial real-FFmpeg comparison covers three repeats at 20/40 ms ingress age:
100 ms lead/10 ms packets, 95/5, and a 100/5 isolation control. All trials exit 0
with valid cadence and every complete packet. The isolation control gains about
5 ms of steady encoding headroom. Candidate steady p5 headroom is comparable to
baseline; startup and worst-case margins are not uniformly better. Encoder CPU
increases from approximately 54–59 to 74–81 ms per one-second trial, and Ogg bytes
increase about 17.8%, with approximately twice as many packets. This is an
encoder-only experiment, not proof for every admitted receiver.

Candidate checks pass: all three TypeScript projects, production build, ten
focused Bun clock/admission tests, and eight real-FFmpeg Node cases, including
all 299 complete 5 ms intervals at both capture ages, no repeated buffering,
relaxed-generation behavior, fixed deadlines and 50 encrypted software clients.
New timing expectations failed against the original encoder before the change.
Software clients do not stand in for physical receivers.

The physical candidate is a scratch copy of the previous verified package with
only `build/audio-worker.mjs` changed inside its ASAR. Main, preload, renderer,
executable and other archive files remain byte-identical. This is an experimental
worker overlay, not a release package; embedded baseline build metadata is not a
candidate source identity. Exact source and runtime hashes are in
`.scratch/audio-roundtrip-sync/candidate-95-5-r2/receipt.json`.

The first candidate recording retained all 2,880,000 frames over 60 seconds with
the same 52-second stimulus and prospectively fixed [20,48) steady interval:

| Pair | Accepted windows | Median | p95 | Maximum | ≤50 ms diagnostic |
| --- | --- | --- | --- | --- | --- |
| ADC1→3 | 53/55 (96.36%) | 95.394 ms | 95.586 ms | 95.607 ms | Fail |
| ADC2→4 | 52/55 (94.55%) | 95.402 ms | 95.586 ms | 95.607 ms | Fail |

Median delay improved about 4.7 ms against the fresh baseline. The right pair
also fails the unchanged 95% coverage requirement; rejected windows remain
failures. Reversed and cross pairs accept zero windows. Native writers,
observers and publication completed successfully; controller cleanup failures
and their corrections remain retained separately. Reports are
`.scratch/audio-roundtrip-sync/runs/candidate95-01/roundtrip-50ms-v2.json` and
`roundtrip-negative-50ms-v2.json`. No sustained 95 ms soak was started because
this is an intermediate candidate toward the new goal.

Two instrumented, source-only 20-second diagnostics compared the normal capture
request with an ideal 5 ms latency preference. Both real stereo tracks reported
21.333 ms and delivered 1,024-frame batches at 48 kHz. Reader sample-age medians
were approximately 28 ms, p95 approximately 33.2 ms, with retained maxima of
88.5/96.8 ms. The preference had no observed benefit and was not added to product
code. These ages use Chromium's estimated capture timestamps; they are not
electrical floors. The permission-only mono processing probe is distinct from
the selected stereo, processing-off product track. Results and unchanged settings
are in `.scratch/audio-roundtrip-sync/timing-diagnostics/source-diagnostic-pair-complete.json`.

An instrumented 20-second source/Mac diagnostic measured Core ingress age at
28.325 ms median and 33.134 ms p95. The Mac reported 10 ms base latency plus
16 ms output latency. These are runtime estimates, not calibrated sequential
floors. Startup, tail and outliers remain in the exports under
`.scratch/audio-roundtrip-sync/timing95-preparation/run-01/`.

A separate process-scoped `--audio-buffer-size=256` experiment, using the same
95/5 instrumented worker and original receiver scheduling, changed actual stereo
capture to 256-frame batches and a reported 5.333 ms latency. Reader age fell to
11.401 ms median, 15.901 ms p95 and 32.901 ms maximum. Core ingress recent median
was 11.857 ms. All 4,097 output starts carried matched decoded-buffer identities;
decode-ready → start-call wait was 11.5 ms median and 16.6 ms p95. Evidence is in
`.scratch/audio-roundtrip-sync/buffer256-preparation/run-01/`. This diagnostic had
no electrical stimulus or witness recording. The Chromium debugging switch is
an experimental launch argument; it has not become a product capture setting.

A live-only sender change now invokes the existing fanout pass as each encoded
chunk arrives; the 5 ms timer remains for housekeeping. A regression holds that
timer while real FFmpeg, encryption and WebSocket delivery run: before the change
it receives zero chunks, and afterward it receives continuously on the unchanged
5 ms grid. Relaxed sending keeps its polling behavior. All four real-FFmpeg
continuity cases and the three TypeScript projects pass. This recovers deadline
headroom; electrical RTT at a lower sender lead is still to be measured.

The maintained SDK patch also uses its existing coalesced microtask path after
successful direct output preparation. Unprepared direct and media-element output
keep the original 15 ms batching; future refills keep their timers. Source
generations cancel pending microtasks and retired preparation. Sixteen SDK,
six route and eight admission regressions pass in separate processes, including
red-before-fix prompt scheduling and retired preparation cases. Combined execution
exposed existing test mock leakage; it is not reported as a pass. The new SDK
is included in the scratch prompt candidate. The first overlay loaded the new
bytes but failed the frontend/Core revision guard before publication or Join;
both retained probes have zero rows. `candidate-95-prompt-r2` rebuilds the same
frozen client with the unchanged Core's compatibility identity and preserves the
prompt worker byte-for-byte. Actual source/runtime hashes are recorded separately
from that compatibility label. Packaging alone establishes no lower electrical
roundtrip.

The corrected prompt95/source256 20-second comparison completed with no probe
drops or errors. All 4,103 scheduled buffers were matched: decode-ready → start
median 0.100 ms, p95 0.200 ms and maximum 0.700 ms, versus 11.5/16.6/19.5 ms with
the old scheduling. Source reader age stayed comparable at 11.5 ms median and
16.0 ms p95. The Mac retained 10+16 ms reported output latency. Probe exports and
`root-probe-summary-v1.json` are in
`.scratch/audio-roundtrip-sync/prompt95-preparation/run-02/`. This package has no
Core latency instrumentation; zero Core probe records is expected, not evidence
of zero upstream delay. No electrical measurement was made.

The next source128/default-output run delivered real 128-frame stereo blocks but
source age rose to 13.001 ms median and 22.8 ms p95. In the subsequent source128
run with only the Mac's standard `latencyHint: 0.002` changed, source ages were
8.9/13.3 ms. This variation leaves the 128-versus-256 comparison unresolved;
reported block size alone does not prove a lower capture floor. The Mac hint
changed steady reported output latency from 10+16 ms to 0+8 ms. Its matched
decode-ready → start median/p95 remained 0.1/0.2 ms. Neither run lost probe rows.
Exports are under `prompt95-buffer128-preparation/run-01` and
`prompt95-buffer128-outputhint002-preparation/run-01` in the same scratch root.
The hint is currently an explicit scratch experiment, with its actual negotiated
latency observed; it does not establish an 8 ms electrical output floor.

Live-only encoder prewarming starts FFmpeg with its WAV header before PCM arrives.
The first real PCM establishes its unchanged timestamp base; later generations
restart normally, and close invalidates pending helper resolution. Relaxed capture
remains lazy. Six real-FFmpeg continuity cases and source typecheck pass, including
red-before-fix startup and async lifecycle regressions. Six paired software trials
reduced first-ingress → first-Opus median from 13.606 to 6.356 ms. The retained
41-packet prefix is contiguous in each trial; the pending codec tail is not a
completed-packet claim. Savings depend on time available to prewarm. Source and
measurement pins are in `.scratch/audio-roundtrip-sync/latency-probes-prewarm/`.
This change is not in the measured prompt95 timing package and has no electrical
result yet.

The server's Live deadline and both admission/correction gates now share one
small policy module. Current lead remains 95 ms; reserving 25 ms for upstream
delivery derives the same 70 ms output cap. Lower scratch candidates must change
the deadline and upstream reserve together. The receiver continues to report its
actual preparation requirement; the default Mac currently requests 36 ms.

The first 50 ms scratch candidate includes matched Core/worker policy, prewarm,
prompt dispatch/scheduling, source256 and the explicitly requested Mac `.002`
hint. Its output cap is 25 ms; actual runtime admission is lead25/min25/correction0
with the Mac reporting an 8 ms output estimate. Nine real variant admission
integrations and boundary checks pass. The default product policy remains 95 ms.

`runs/candidate50-01` retains all 2,880,000 frames from the same 60-second protocol.
Fixed [20,48) analysis remains **red**: each pair accepts 48/55 windows (87.27%),
median 50.699 ms, p95 50.894 ms and maximum 50.947/50.946 ms. Each pair rejects
seven low-correlation windows; neither the delay nor coverage gate passes.
Reversed and cross pairs accept zero windows. Corrected detector reports are
`roundtrip-50ms-v2.json` and `roundtrip-negative-50ms-v2.json`; raw SHA-256 is
`d59e6b02a5af2a77ef4e3a78d5c943d05897c46349341f390cd03419fa01b916`.
All native writers/controllers completed successfully and cleanup stopped the
publication and removed the shim. A separate instrumented diagnostic follows;
low-correlation windows have not been relabeled as successful audio delivery.

The subsequent 20-second diagnostic retains 4,330 encoded packets, including 16
already overdue at emission (worst headroom −17.572 ms). Nine occur before the
first periodic report and seven more during the run. Source reader age is
16.5 ms median, 25.6 ms p95 and 54.2 ms maximum. Mac decode-ready → start stays
0.1/0.2 ms median/p95, but only 3,819 of 4,101 decoded buffers have observed
starts; the unstarted buffers span the run. This records missing starts without
inferring a reason code. Decode input timestamps include two 35 ms gaps and one
10 ms gap. These observations motivate reducing upstream wait while preserving
late-drop rules; they do not map individual missing starts to the earlier raw
recording's rejected windows. Deduplicated Core records and scheduling metadata
are in `candidate50-diagnostic-preparation/run-01/root-timing-summary-v2.json`
and `root-scheduling-summary-v1.json`.

A separate Live-only WASM encoder candidate now passes bounded software checks.
It uses the existing pinned `opus-encdec` dependency, one shared runtime per audio
worker and source-owned stereo encoders. Relaxed capture keeps the identical
FFmpeg branch. Generation/reset/close reentrancy, nonzero stereo decoding,
queue bounds, fixed sample-index timestamps and owner/shared failure handling
are covered. The first packet retains the actual queried 120-sample lookahead;
late packets advance the original timeline rather than shifting later audio.
All five FFmpeg children and three check workers closed.

Two reversed-order paced comparisons, retaining the common first 50 packets,
reduce median upstream consumption by 5.37/5.45 ms against current Ogg. These
synthetic source timings include first packets and pre-skip, but omit physical
capture, network and receiver work. The frozen candidate remains scratch-only;
actual Electron/ASAR loading and electrical performance are separate gates.
Sources, artifacts and results are pinned in
`wasm-live-candidate/handoff.json` under the scratch root. No production encoder
or capture setting has been changed by this experiment.

Actual Electron utilityProcess → audio worker ASAR loading subsequently passed.
A disposable clone missing only the WASM member produced an explicit archive
`ENOENT`/compile abort, zero Mac decode/output and no observed fallback; no UI
alert was captured. Restoring the pinned package delivered 2,089 decoded buffers
and 2,064 matched output starts over 10.39 seconds. Normal readiness reported
1 ms public clock uncertainty, 8 ms output estimate, 25 ms required lead/buffer
and zero correction. All three packaged codec asset pins matched. These are
instrumented loading/delivery checks, with startup/tail retained, rather than an
electrical continuity result. Receipt:
`wasm-restored-positive-preparation/gate-result.json` under the scratch root.

The matched 50 ms WASM electrical run retains all 2,880,000 frames. Both pairs
accept 53/55 windows (96.36%), with median 50.368 ms, p95 50.634 ms and maximum
50.664 ms in fixed [20,48). Coverage passes, while delay remains **red** at 50 ms.
Both pairs retain two low-correlation windows. Reversed and cross-channel
controls accept zero. This single run improves observed acceptance relative to
the native candidate's 48/55; it is not continuous-fidelity qualification.
Raw SHA-256: `3588b9e2b105149b95154cb15f9bcca5e9d91a42709317e7c55f6fbaf40a4af7`.
Reports and unchanged detector/raw hash receipt:
`runs/candidate50-wasm-01/analysis-receipt-v2.json` under the scratch root.

The subsequent 48 ms lead / 23 ms upstream reserve / 25 ms output-cap candidate
passes the unchanged ≤50 ms **sampled electrical diagnostic**. Each intended
pair accepts 54/55 windows (98.18%), median 48.387 ms, p95 48.670 ms and maximum
48.679 ms; one low-correlation window per pair remains rejected. Reversed and
cross pairs accept zero. All 2,880,000 frames were retained, native/controller
exits were zero, and normal readiness reported 1 ms public clock error, 8 ms
output estimate, 25 ms required/minimum buffer and zero correction.

This result uses experimental source256 and the Mac `.002` constructor shim.
It is not calibrated or continuous-fidelity qualification, and it does not prove
a supported production capture path. The 23 ms upstream allowance remains an
experimental policy, with no guaranteed tail bound. Raw SHA-256:
`fe856bfc20a79d120206741eccaa6f5094f5fe370cc534830e312889309f00f7`.
Reports and hash receipt are in `runs/candidate48-wasm-01/` under the scratch root;
all earlier red runs remain unchanged. Work continues toward supported output
configuration, smaller frames, ordinary capture and lower latency.

Review also found a readiness-units bug: the SDK public clock-error getter
returns rounded milliseconds, while Couch compared it with 10,000 and logged it
as microseconds. The guard now requires finite, nonnegative public error ≤10 ms
and logs `clockErrorMs`. Fourteen focused tests pass after boundary regressions
failed against the old code. Public rounding and statistical uncertainty remain;
this is not a hard calibrated clock-error bound. Frozen comparison packages keep
their original frontend bytes and are labeled accordingly; the correction is
included only after a new frontend build. The 25 ms receiver buffer floor remains
unchanged.

The first-class output-hint path is now implemented through the maintained
SDK patch: optional numeric seconds flow from player config to the AudioContext
constructor, with finite/nonnegative validation and unchanged omitted defaults.
Couch supplies 0.002 for Live only. Tests keep actual 26 ms and 8 ms runtime
estimates despite the requested 2 ms; preparation/admission and relaxed batching
remain intact. SDK 25/25 and receiver 14/14 pass, with red evidence retained.
A fresh cache and clean frozen install reproduced all four changed runtime/type
files and passed the 25 SDK tests. The lockfile stayed unchanged. All three
TypeScript projects and the production build pass, and source review is clear.
The new frontend includes the clock-unit correction; historical comparison
packages retain their earlier bytes. Evidence is in `public-output-validation/`.

A distinct scratch 48/23 candidate changes only the Opus frame size from 240 to
120 samples (2.5 ms). Actual lookahead remains 120 samples, first packets are
retained and nonzero stereo decoding, variable-block normalization, lifecycle,
late-index timing and the queued+sent bound pass. Matched software medians recover
2.73–2.79 ms of upstream time, with a separately retained 5.294 ms cold first
encode. This is not yet a physical result. Its exact source/artifact receipt is
`wasm-live-candidate/lead48-frame2p5-r1/receipt.json` under the scratch root.

Ordinary capture with that public hint, no constructor shim and no source-buffer
switch does **not** pass at 48 ms. Its separate 20-second diagnostic observed
1,024-frame blocks, with reported post-first-two-second first-sample ages
32.4 ms median / 42.2 ms p95. Actual output estimate remained 8 ms and clock error
1 ms. In the complete 60-second electrical run, fixed [20,48) accepts only 38/55
left and 37/55 right windows (69.09% / 67.27%); accepted medians are
48.677/48.680 ms and maxima 48.976/48.978 ms. Reversed/cross controls accept zero.
The rejected windows remain failures; accepted-delay statistics alone do not
establish supported ≤50 ms delivery. Raw SHA-256:
`ba2b361935ce2a0e06dfc4ae929ed23c18705e643a3e8717e20efa1393f77fcf`.
Evidence is under `runs/candidate48-public-normal-01/` and
`electrical48-public-normal-preparation/`. A same-package source256 control follows;
no causal conclusion is drawn from the non-overlapping capture-age diagnostics.

The same public-hint 48 ms package with only source256 restored aborted after
620,800 frames (12.93 seconds): the product reported “The audio input's capture
clock was interrupted.” The upload worker rejects timestamp steps below −2 ms
or gaps above 40 ms; the retained message alone does not identify which condition
occurred. The fixed [20,48) interval was never reached, so no electrical acceptance
is available. Witness exit −15 and controller abort exits remain aborts; cleanup
verified all processes absent. Evidence: `runs/candidate48-public-256-01/`.
No thresholds or timestamp handling were relaxed.

The private Pulse session log independently records progressive overrun-driven
adaptation (reported minimum latency 1→106 ms and watermarks reaching 86 ms).
It lacks event timestamps and establishes no causal link to the interruption or
higher ordinary-capture ages. The audit recommends a fresh-daemon, same-config
control before any tuning. Official Pulse17 scheduling uses requested latency
minus watermark; a smaller watermark is not automatically a faster capture
cadence. Audit: `latency-probes-pulse-adaptation-audit.md` under the scratch root.

A subsequent 20-second source256 diagnostic used the 2.5 ms WASM encoder and
bounded packet-emission instrumentation. It also failed: a capture-clock
interruption arrived during export, before Leave/Stop. The initial controller's
"observation elapsed" label does not override that error. The host export ends
0.387 seconds before the error, so it cannot identify the failing timestamp
step. Source age was 16.4 ms median / 25.4 ms p95 after the first two seconds.
Of 8,630 encoded packets, 13 were already overdue and dropped, including packet
index zero with −13.184 ms headroom. First-packet loss remains in the result.
All 13 precede the Mac's contiguous decoded indices 452–8,629. Cumulative
reports add no new Core expirations across 7,811 packets after the first report.
The Mac still has 31 decoded buffers without observed starts, including 19 later
in the run; the reason is unproved. The 101 ms read-timestamp discontinuity is
the initial preparation pair, whose first frame was never transferred. It does
not identify the later capture failure. Saved calculations are in
`wasm-live-candidate/diagnostic48-public-2p5-review-01/`.
The final 512-packet upstream-consumption median/p95 was 21.507/29.262 ms;
these recent quantiles are not whole-run quantiles. Instrumentation may affect
timing. Evidence: `timing48-public-2p5-preparation/diagnostic-01/`.

The diagnostic controller now stops sharing normally before exporting large
probe objects, retains probes through terminal callbacks, and scans errors
through cleanup. This reduces an avoidable observer effect without establishing
the cause of either interruption. Existing failures remain failures. A separate
same-config private-daemon restart preserves the original logs and settings and
updates owned-process watchdog identities; its next measurement is a control,
not evidence that a restart solves capture reliability.

The first fresh-daemon normal-capture diagnostic completed cleanly through
Stop/export/removal. It still delivered 1,024-frame blocks; post-first-two-second
transfer age was 27.8 ms median / 32.9 ms p95 / 102.4 ms maximum. Readiness
reported 1 ms clock error, 8 ms output, 25 ms required/minimum buffer and zero
correction. No runtime/admission/export/cleanup errors were retained. This one
comparison does not isolate the reason for the lower ages. Evidence:
`fresh-pulse-public-normal-preparation/diagnostic-01/`. A matched electrical
control used the same public frame5 package and no capture-buffer switch.

That complete 60-second control remains **red on coverage**: left 50/55 (90.91%),
right 49/55 (89.09%). Accepted medians are 48.888/48.891 ms, p95
49.139/49.140 ms and maxima 49.164/49.166 ms. Reversed/cross controls accept zero.
All 2,880,000 frames were retained without an observed product error, and native,
controller and observer exits were zero. A clean runtime and sub-50 ms accepted
delays do not override the rejected windows. This run improves observed coverage
relative to the earlier normal-capture run, but does not establish a causal Pulse
fix or reliable supported delivery. Raw SHA-256:
`925b91d3d01c4c4bff51d2f05c95f384aac22fa66633b22ff39353490cc5b71d`.
Evidence and unchanged detector/raw hash receipt:
`runs/candidate48-public-normal-freshpulse-01/analysis-receipt-v2.json`.

The following normal-capture trial changes only the encoder to 2.5 ms frames on
the same private daemon. It also remains **red on coverage**: left 46/55 (83.64%),
right 45/55 (81.82%); accepted medians 48.782/48.778 ms and maxima
49.101/49.101 ms. Reversed/cross controls accept zero. All 2,880,000 frames and
zero process exits were retained with no observed product error. This single
trial does not isolate why coverage differs; the software encoding-headroom
gain has not established reliable normal-capture delivery. Raw SHA-256:
`3b9b4ac158c1e568098804646a9594a3d3d9bc20a31625e5423c760addb15c2a`.
Evidence: `runs/candidate48-public-normal-2p5-01/analysis-receipt-v2.json`.

A separate packaged native-readable probe compares two processors on the same
real stereo track: a Window reader and the actual unlocked native readable
transferred to a worker. It retains bounded full-block fingerprints, raw
timestamps, startup and ambiguity counts; it never selects or corrects an origin.
Only three same-origin static assets are added to a copied package. The initial
controller attempt stopped before `run` because idle enumeration could not
confirm an explicit device. Corrected confirmation uses the product's temporary
native microphone grant and preserves the enumeration before checking it.

The five-second no-stall control yields 232 unique common blocks, all matching
the predetermined destination-origin timestamp difference; one ambiguous
fingerprint remains retained. Both readers have zero discontinuities and every
observed AudioData is closed. Thus this actual binary changes native readable
timestamps to the worker's origin. The existing per-AudioData upload remains
correctly tagged with its Window origin; its unsupported Electron44 stream-origin
comment has been corrected without changing runtime behavior.

One subsequent 200 ms Window stall records 228 Window frames and a 128.167 ms
maximum gap, versus 233 worker frames with zero discontinuities and a 0.167 ms
maximum residual. There are 227 unique destination-origin matches and six
unmatched worker blocks. Both runs finish with no errors, owned tracks stopped,
worker absent and native preparation cleared. This supports bounded UI isolation;
it does not prove the cause of the earlier electrical abort or a timestamp-safe
product replacement. The pinned implementation can retain old-origin queued
buffers during handoff, which needs a separate queued-startup control. Receipts:
`native-transfer-device-preflight-r2/{no-stall-02,stall-01}/`.

A separate queued-startup control then requests a 100 ms delay between releasing
the preparation reader and transferring the native stream (observed 100.100 ms).
All 238 uniquely matched candidate blocks are retained: the first four use the
unchanged Window origin, followed by 234 using the destination origin. No
ambiguous or unmatched candidate blocks remain. The worker records one
−23,306.533 ms raw timestamp discontinuity while the Window records none.
This reproduces mixed origins in one actual native readable; a single fixed
origin cannot safely replace the current upload seam. No timestamps or startup
frames were rewritten or removed by the probe. Cleanup completes without errors.
Evidence: `native-transfer-queued-preparation-r2/queued-handoff-01/`.
Pinned Chromium's [transfer implementation](https://github.com/chromium/chromium/blob/152.0.7977.130/third_party/blink/renderer/modules/breakout_box/frame_queue_underlying_source.cc#L337)
updates the producer's realm information without rebasing the shared queue;
[audio copying](https://github.com/chromium/chromium/blob/152.0.7977.130/third_party/blink/renderer/modules/breakout_box/media_stream_audio_track_underlying_source.cc#L64)
can also be in flight. No public counter or acknowledged producer boundary was
found that proves a safe finite warmup. Paired content matching cannot guarantee
identity for silence or repeated blocks. Native transfer remains diagnostic;
the existing product timestamp seam is retained.

Before a ring-capacity trial, another fresh unchanged-daemon control retains the
same public frame5 package and ordinary capture. Its clean 20-second diagnostic
reports 1,024-frame blocks, first-sample age 27.901 ms median / 33.100 ms p95 /
112.400 ms maximum, and unchanged readiness (clock1/output8/required25/min25,
zero correction). Its full 60-second electrical run remains **red**: each pair
accepts 51/55 windows (92.73%), medians 48.803/48.803 ms and maxima
49.089/49.089 ms. Reversed/cross controls accept zero. All 2,880,000 frames are
retained and native/controller/observer exits are zero. Raw SHA-256:
`fa986b9b06bfc0d58aa0814d9968ecb316808b323e32ca33467ba8d6aa4d2b75`.
Evidence: `runs/candidate48-public-normal-ringcontrol-01/`.

The one-knob trial appends only `tsched_buffer_size=30720` to the private
four-channel s32le/48 kHz ALSA source. Negotiation confirms 1,920 frames / 40 ms
ring capacity, 960-frame / 20 ms periods and timer scheduling. The watermark
configuration is unchanged; capacity is not capture cadence. No overrun/underrun
message appears in its retained since-startup log. Actual browser blocks remain
1,024 frames, and age worsens to 30.300 ms median / 37.800 ms p95 / 112.801 ms
maximum. This fails the prospectively required ≥5 ms p95 gain from 33.100 ms.

Its complete electrical run also remains **red**: left 45/55 (81.82%), right
43/55 (78.18%), accepted medians 48.773/48.773 ms and maxima 49.103/49.103 ms.
Reversed/cross controls accept zero. All 2,880,000 frames and zero process exits
are retained; readiness stays unchanged. The configuration is rejected and the
next hardware run must use the original private-daemon configuration.
This trial establishes no performance benefit. Raw SHA-256:
`3774c2a4ddcc27358077581ab5ecf81aee1fce87d59edd1944fd6f5a6a78f5e7`.
Evidence: `runs/candidate48-public-normal-ring40-01/` and
`preflight/private-pulse-ring40-01/`.

A bounded software fairness check subsequently goes **red** against the frozen
WASM capture implementation. It queues a real MessagePort task and timer before
preparation resolves, then feeds 400 ms and two-second historical input backlogs.
Both tasks run only after the first source finishes draining or reaches its
unchanged missed-deadline failure. Expired packets bypass the existing slice
branch, and microtask slices do not yield to those worker tasks. The second source
remains healthy; actual encoded packet indices, payloads, lookahead and deadlines
are retained, including late packets. This tests cooperative scheduling at the
capture→WASM seam, not the complete HTTP/WebSocket path or production starvation
duration. Two workers exit cleanly. Evidence:
`wasm-live-candidate/io-fairness-preparation/RESULTS.md`.

A separate 95 ms / 5 ms scratch revision turns that same scheduling check
**green**. It resumes draining through cancellable `setImmediate` tasks after
bounded encoded slices, counting expired packets too. Close, reset and failure
cancel the continuation; new writes preserve FIFO behind it. Task-time lifecycle
checks, owner-local errors and shared-fatal cancellation pass. All 80/100 encoded
payloads match the red inputs, and 34 unaffected emitted packets retain their
bytes and timestamps. Real task yields can increase lateness: the historical
400 ms case emits three packets rather than four. The original deadline failure
is retained. All six test workers exit, and source typecheck and the matching
worker build pass. Root source review finds no blocking issue. Product and prior
freezes remain unchanged; no hardware performance improvement follows from this
software check. Evidence: `wasm-live-candidate/io-fairness-r1/README.md`.

The next scratch experiment keeps MSTP in a Main-owned hidden capture Window and
transfers individual AudioData objects to that Window's worker, with its explicit
capture origin. Packaged r3 proves different actual UI/helper OS PIDs, the same
Session/local origin, no opener and Main-reported hidden state before GUM. Its
temporary exact-frame microphone lease passes unprepared, sibling, subframe and
stale-target denial controls. Source review first found and fixed hidden-state,
owner-crash and stale ordinary-preparation cleanup gaps; prior freezes remain.

One five-second no-stall run and one five-second run with a reviewed 200 ms UI
stall each deliver all 235 native stereo/48 kHz, 1,024-frame blocks to the worker.
Every transferred frame is closed, with matching retained fingerprints and
explicit origin conversion, zero errors/discontinuities and a drained queue.
During the actual 200 ms UI stall, helper and worker each process ten frames.
The consumed preparation frame is retained separately; preparation-to-first-read
timestamp residuals are about −33 µs. Both runs stop tracks, remove helper/worker,
clear native preparation and leave no Pulse client capture. Maximum positive
native timestamp residual is 0.167 ms in each run.

This qualifies only the documented bounded capture/serialization isolation.
Default r3 opens no Core upload socket; it establishes no electrical latency or
long-duration reliability improvement and is not integrated into production
Live/mute/rejoin. A later upload trial must preserve real preparation before
publication on the same acquisition and use the existing publisher connection.
Evidence: `owned-capture-qualification-r3-preparation/` and
`latency-probes-owned-capture-core-upload-plan.md`.

Pinned Electron44.4.5/Chromium152 source tracing finds no supported public
latency-constraint route to smaller raw blocks on this Pulse backend. It supplies
1,024-frame input parameters without variable buffer capabilities, so the raw
constraint candidate has identical minimum and maximum sizes. The public latency
capability can still include a nominal 10 ms processing candidate; with processing
disabled, that candidate does not supply a smaller raw buffer allocation. A
required 5 ms upper bound is predicted to reject rather than force 240/256 frames.
Settings report configured source-buffer duration, not measured sample age.
No new constraint trial was run. The cited trace and reporting correction are in
`latency-probes-public-capture-latency-constraint.md` under the scratch root.

The first controlled owner-Close attempt failed before `run()` because the
controller used an unsupported CDP attachment mode. No helper or GUM started;
the result remains inconclusive. The replacement flattened-session controller
passes offline checks, but review found that its failure path could release the
debugger hold before verifying process retirement. A separate controller revision
fixes that ordering and passes 18 offline tests; four regression cases fail
against the earlier frozen controller. Root source review and all 12 frozen-file
hash checks pass. Actual owner-Close qualification and the ordered Core-upload experiment
remain pending; the successful serialization runs do not establish either gate.

A source review of the maintained product changes found a relaxed-capture
regression: counting released, unplayed chunks toward the new200-chunk ceiling
could terminate healthy128-frame PCM input under its unchanged one-second lead.
The minimal repair counts retained sent chunks only for Live, preserving the
original relaxed queue limit. A regression through the real capture encoder,
scheduler and encrypted PCM receiver fails against the old line, then delivers
all240 paced chunks with exact stereo samples and original timestamps after
the fix. Existing continuity cases pass6/6; source and regression typechecks
pass, and all28 recorded command/encoder PIDs are absent. This is software
regression coverage, not an electrical result. Evidence:
`relaxed-pcm-queue-fix-r1/README.md` under the scratch root.

The ordered Core-upload R4 scratch revision passes62 focused contract tests,
three typechecks and isolated frontend/Main/helper builds. Root materialization
verifies all92 allowed overlay paths, with62 added ASAR members, four changed,
none removed, and all unlisted members/native resources unchanged. Core,
audio-worker, codec assets and embedded compatibility identity stay pinned.
The package has never launched. A fresh independent source review found two
blocking contract gaps: the serialization API still accepts a direct upload URL,
and successful ordered upload does not require an observed first Core-source
presence. R4 and its package are preserved as blocked; a new R5 scratch revision
will reject entrypoint upload URLs and enforce bounded source confirmation.
Actual owner-Close, ordered upload and electrical gates remain pending.

No release or installed-app change has occurred.


## Next comparison: capture rate, after the new baseline

The user requested a 44.1 kHz comparison **after** establishing the new 48 kHz
baseline. Do not run the rate change first or label a delivered-stream rate as
an observed sound-card rate. Hold package, scheduling lead, receiver preference,
Linux defaults, routes, levels and stimulus fixed. Keep the coherent witness at
48 kHz and the original electrical gate; change only the Couch capture request.
Verify actual delivered capture format. Scheduled audio remains normalized to
48 kHz, so this evaluates 44.1 kHz capture plus conversion, not an all-44.1 kHz
pipeline. A hardware-rate experiment additionally needs independently observed
CoreAudio device rate; none has been performed here.

Without a physical return, host/receiver timing telemetry can estimate latency
and localize stalls but cannot establish full electrical input-to-analog-output
latency or continuous fidelity. Keep those estimates separately labeled.
