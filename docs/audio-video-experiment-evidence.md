# Audio/video experiment evidence audit

Research snapshot: **2026-10-24**. Architecture research only: no application,
test runner, scorer, service, hardware operation, agent restart, merge or release
was performed. This audit changes only this note. Existing reports and
verification receipts are historical evidence, not tests run by this audit.

**The experiments establish useful mechanisms and limited measurements, not a
finished architecture or 50-receiver synchronized A/V capacity.** The 350 ms
fresh-session wired checkpoint passed. Lower-latency results are stronger than
“only shorts at 90 ms” across the whole history, but weaker than a confirmed
lowest reliable operating point. No 150 ms product requirement follows from
the experiment's margin policy.

## Provenance and corrections to the leads

- Main is `59ac6cd6a510ca96bf60dfc9a3628cc635be22e1`, clean at inspection, in
  `/home/avoid/Code/avoid-quest/couch`.
- Latest checkout is `/home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline`,
  branch `experiment/stereo-clock-discipline`, HEAD
  `1f02400b8c9b56d2a8a152648d38dd6ece9a5756` **plus dirty files below**.
  Measurements use their pinned bundles/plans, not this HEAD alone.
- Older checkout `/home/avoid/.t3/worktrees/couch/t3-6c0b21ea` is clean and
  actually on `t3/live-audio/latency`, HEAD
  `28bb99f7805b33595ded6d937e67325b9106d04d`. The supplied original branch,
  `t3/investigate-live-audio-scalability`, still points to `1dcfb69f…`; inspecting
  only that ref misses the experiment. Ignored scratch evidence exists despite
  a clean Git status.
- Both stopped threads were read through their complete paginated message
  timelines using `t3_thread_read`: [latest][latest-thread], through position
  7011; [older][older-thread], through 5541. Neither was contacted. The latest
  stop record explicitly withdraws the intervening integration instruction,
  records no integration work, and leaves the latency search/final review
  unfinished. Earlier recommendations to retain the whole stack or defer video
  are historical, not current architecture decisions. [Shutdown record][stopped]
- The [inventory][inventory] and [prior audit][prior-audit] were leads. In
  particular, **“no completed 90 ms long” is true for R5, not all revisions**:
  C15 and C19 each have an earlier passing 720-second 90 ms run; C16 has one
  passing 85 ms long. Their confirmations/revisions have separate failures.
  [Original-report index][historical-index]

Read-only GitHub queries confirmed **#804/805/806/807/808/810/811 are all open
drafts**. The four later exact branch names below returned no PR, including
closed/merged PRs. Local Git objects match the queried PR heads. `git cherry
main t3/live-audio/latency` marks all 41 historical commits as lacking a
patch-equivalent commit on main; current runtime source also retains the
specific old behaviors discussed below. These PRs were inspected as records
and were not linked to this research thread.

## What ships, and what remains experimental

Already merged work changes the baseline: [#841][merged-ahead] supplies bounded
Sendspin send-ahead and late-join handling; [#877][merged-sharing] updates live
sharing controls/identity; [#878][merged-helpers] changes helper lifetime;
[#881][merged-ui] reduces UI snapshot/rendering work; [#887][merged-compressor]
and [#888][merged-compressor-direct] add compressor processing. None merges the experimental native stereo path or
qualifies its latency. Current Sendspin starts with **1 s lead**, permits **8 s
send-ahead**, and bounds receiver delivery by capacity/cursors. Eight seconds
is a buffering budget, not mandatory input-to-output latency. Main still uses
independent WebRTC peers for direct live sharing, and buffered ingestion plus
Sendspin for multi-device live In sync. [Current sender][main-sendspin],
[route selection][main-hub], [current receiver][main-receiver]

The older stack should be mined selectively, not rebased or integrated as a unit:

| Layer / observed head | Classification | Finding |
| --- | --- | --- |
| [#804 admission](https://github.com/avoid-quest/couch/pull/804), `104d74fc` | Useful unmerged logic | Separate bounded successful/failed pairing budgets, authenticated signaling budgets, four unsettled negotiations maximum with 100 ms pacing. Cancellation must retain a slot until its promise settles; closing a peer alone is insufficient. Main still has the shared 20-attempt/minute pairing allowance. Adapt around today's TV/public pairing and live-source types. |
| [#805 evidence](https://github.com/avoid-quest/couch/pull/805), `2e5b4fca` | Harness | Identifiable PCM, calibration and explicit unknown/failure gates. Keep later detector/coverage repairs; the PR's old throughput number is superseded. |
| [#806 isolation](https://github.com/avoid-quest/couch/pull/806), `c1b857f2` | Harness | Private Linux namespaces/audio registry, network shaping, per-client traffic evidence and bounded descendant cleanup. Useful if a lab is needed; not product architecture. |
| [#807 ingress](https://github.com/avoid-quest/couch/pull/807), `cb498b63` | Historical prototype | Exactly two encrypted receivers, fixed sample deadlines, bounded queues, revocation/TLS. Browser render-clock envelope is not ADC time. Capture requests mono and duplicates it into stereo wire channels: not true stereo acquisition. |
| [#808 browser-lab](https://github.com/avoid-quest/couch/pull/808), `b20d2f5f` | Harness/history | Real Electron capture/render workers, private Pulse/JACK, deadline/child-close fixes and early results. Desktop buffer switches do not apply to ordinary phone webpages. |
| [#810 state-fanout](https://github.com/avoid-quest/couch/pull/810), `abd79f9e` | Useful unmerged logic | Reuse levels, decorated outputs and permissions within one synchronous state broadcast; recipient permissions and freshness remain essential. Synthetic-signaling 50/100 reconnects improved to 2.675/15.284 s, not audio recovery. |
| [#811 output-evidence](https://github.com/avoid-quest/couch/pull/811), `bed96d0e` | Harness | Framed sample addresses, independent software-port witness, full tails, continuous identity analysis and offline scoring. Continuous route calibration still missing. |
| [`receiver-joins`][join-fix], `88f72f9d` | Useful unmerged logic | Omit unavailable channel requests instead of sending explicit `false` into private-channel authorization. Main still has the old expression; the prior audit records a current-main reproduction. |
| [`performance-bench`][bench-head], `b59c4c66` | Harness | Scale/recovery runner plus corrected `/2` activity and RTC interval rules. Small pure helpers can be considered independently of the full lab. |
| [`live-routing`][routing-head], `72ba5c01` | Useful unmerged logic + history | Suppress unchanged-volume feedback; coalesce publisher peer lists within a turn. Main still sends redundant volume commands and immediate peer lists. Preserve stop/load ordering and actual volume changes, including zero. |
| [`latency`][latency-head], `28bb99f7` | Unproven product policies + useful observer fix | Linux-wide 128-frame default and 64/128 kb/s Opus requests are separate policy candidates. Read sender parameters once before measurement; repeated blocking reads caused an observed 8.7 s publisher stall. |

These classifications follow the actual layer diffs and sources, not PR titles.
The old Opus comment/report overstates “negotiated mono”: RFC 7587 defines
`stereo` as a **receiver preference**, not proof of encoded channel content;
parameter readback also does not prove transmitted bitrate. [RFC §6.1][opus],
[candidate source][latency-policy], [ingress source][ingress-source]

## Latest experiment: the mechanism actually tested

The native fixture records a known stereo test signal through four electrical
channels on one UMC404HD acquisition clock: source L/R and one Mac receiver's
headphone L/R. Only source L/R feed
the network path. This is **one stereo receiver**, over Ethernet; four recorded
channels are not four receivers. The earlier Helium baseline was followed by
stock Electron 45.0.0 / Chromium 156.0.8078.48 for the qualifying checkpoint.
The left acquisition differential was calibrated by reciprocal cable/DAC swaps;
right absolute bias and independent Mac-route gain remain unknown.
[Rig/calibration record][rig], [fixed-lead result][fixed-result]

The original nominal mapper lost about **10.49 ms/min of send headroom**.
The implemented correction pairs `readEnd + delayFrames` with ALSA monotonic
status time, fits capture rate over a bounded four-second window, and uses a
single stateful stereo **libsoxr variable-rate resampler**. Arrival timestamps
check freshness; they do not timestamp packets. A phase correction converges
over two seconds; rate, phase, backlog and generation guards fail explicitly.
The output grid stays `T0 + outputFrame / 48000 + lead`, with at most 960
stereo S16 frames per packet. Correcting timestamps alone would leave sample
duration wrong. The helper's integrated duration is bookkeeping, not a native
sample-position measurement; this libsoxr variable-rate implementation's
`soxr_delay()` placeholder is deliberately not used as measured backlog.
[Clock][clock-code], [flow][flow-code], [native converter][resampler],
[contract and retained nominal audit][clock-contract]

The receiver corrections are distinct:

1. A hash-pinned lab build transform fixes SDK 5.0.0's predicted-clock slope:
   projected audio time is compared over the matching projected-time interval,
   `max(now, timestamp.performanceTime)`, while raw context slope keeps its own
   interval. It preserves thresholds and correction policy. Installed SDK and
   product builds are unchanged. [Transform][receiver-fix]
2. Empty-stream preparation checks the final session/generation before frame
   zero; disconnect, suspension, replacement or clear invalidates it. It relies
   on pinned SDK internals, not a first-class public readiness API. Candidate 8
   additionally requires a fresh page/context and bounded startup ages.
   [Preparation][preparation], [freeze/result][fixed-result]
3. Existing Sendspin `sync` corrections remain active. The passing long used
   **683 one-sample adjustments**, zero hard resyncs. Source normalization does
   not replace each receiver's clock/output correction. No continuous receiver
   ASRC, adaptive buffer or AOO/Snapcast implementation was adopted.
   [SDK scheduler][sdk-scheduler], [fixed result][fixed-result]

The sender offers per-receiver timing/capacity/socket guards and explicit
generation resets, but `stereo()` is still an opt-in laboratory seam. It uses
a hardcoded group and volume, PCM only, and has no normal Hub routing, product
capture lifecycle or video relationship. Native acquisition/resampling and
receiver transforms live under `tests/stereo-hardware`. At 48 kHz × 16 bits ×
two channels, payload is **1.536 Mb/s per unicast receiver, 76.8 Mb/s for 50**,
before overhead. This is arithmetic, not measured server/Wi-Fi capacity.
[Sender][stereo-code], [integration seam][stereo-seam]

## Qualification, failures and lower-latency results

**350 ms:** C8's two 60 s prerequisites and 720 s long each retain **222/222
passing gates**, plus fresh-start verification and passing final independent
Spec/Standards reviews. The long contains all 34,560,000 acquisition frames;
all 36,007 packet lifecycles reconcile. Headroom is 309.584–333.195 ms; trend
is −0.003373 ms/min, correlated 95% interval [−0.009934, +0.003377], inside
the declared ±1 bound. The fitted input rate is about 47,991.625 frames/s;
normalization emits 34,566,031 frames on the 48 kHz grid. Identified **steady** left pilots have median 349.989 ms
and p99 350.109 ms. [Original report][c8-report], [final reviews][c8-reviews]

This is sparse electrical correspondence, not continuous fidelity or acoustic
qualification: 1,359/1,360 steady left pilots identify, 53/60 startup pilots
identify per channel, and pilots cover about 2% of time. The conditional left
uncertainty is ±4 samples (±0.0833 ms nominal); right absolute latency remains
unknown. The global affine clock model remains inadequate. Scheduled/ended
callbacks prove lifecycle accounting, not native DAC completion.
[Physical result][fixed-result], [Web Audio timing semantics][web-audio]

Failures were not converted into passes:

- C1 startup lost scheduling; C3 clock preparation failed. The SDK arithmetic
  correction addresses a reproduced mechanism, not retroactive physical proof.
- C4's added `ended`/`currentTime` completion assertion was invalid. The later
  prospective `source-lifecycle-v1` contract changed acceptance **semantics**;
  unchanged numerical gates do not mean an unchanged measurement contract.
- C6's long failed after a 90.218 ms host ingestion pause exhausted the 250 ms
  receiver guard. Measurement work was subsequently isolated from the sender;
  the exact historical blocking operation remains unknown.
- C7 acquired the full long but missed one scheduled packet and timed out.
  Retained SDK replay reproduces a clock demotion/promotion and early stop.
  C8's fresh-session policy passed; arbitrary long-idle recovery did not become
  qualified. [Failure reports and causal evidence][clock-failures]

**R5 is a different capture revision.** It increases ALSA ring capacity from
1024 to 4096 frames, retaining 256-frame reads/period/avail-min. Applied native
parameters are queried and bound to each run. This is headroom against capture
overrun, not an instruction to accumulate 4096 frames before delivery.
Timestamp evidence had already changed prospectively: R2 accepts consistent
stationary position/time pairs; R3 accounts for sampling inside the status query
and USB delay versus availability. Old failures remain failed. R5 has the 222
reference gates plus 20 supplemental gates. [R2][r2], [R3][r3], [R5][r5],
[native capture][capture-code], [qualifier][qualifier]

All completed R5 rows below passed all **242** gates and retain successful
recomputation receipts. Values are **full-run identified left-pilot** median/p99,
not the steady-only distribution quoted for C8. Tuple = lead / required lead /
minimum buffer; static delay is zero. [Canonical ledger][r5-ledger],
[reports and summaries][r5-results], [verification receipts][r5-verifications]

| R5 tuple, ms | Completed evidence | Left median / p99, ms | Minimum sender margin / conditional API reserve, ms |
| --- | --- | --- | --- |
| 150/50/50, C23 | Two fresh blocks, each 60 s + 60 s + 720 s ([long 1][r5-150a], [long 2][r5-150b]) | Longs 150.173 / 150.512; 150.135 / 150.562 | Worse across longs: 57.877 / 57.204 |
| 100/25/25, C24 | Two shorts + [one 720 s long][r5-100] (`direct-bGrLbn`) | Long 100.039 / 100.459 | 34.477 / 17.234 |
| 95/25/25, C25 | Two shorts + [one 720 s long][r5-95] (`direct-Fr0Jhs`) | Long 95.174 / 95.764 | 27.983 / 9.449 |
| 90/25/25, C26 | Two 60 s shorts ([direct-OBTsLc][r5-90a], [direct-hBQCPT][r5-90b]) | 90.142 / 90.473; 90.015 / 90.242 | 25.897 / 8.711; 24.274 / 9.186 |

The **R5 90 ms long was cancelled during preflight, with no acquisition**.
Its reservation and consumed prerequisite pair are not a run. R5 lacks second
long confirmations at 100/95 ms, its adjacent lower failure/boundary, and final
independent result review. C23 meets the experiment's two-long ≥20 ms margin
criterion; calling it a final architecture requirement or universal minimum
would be wrong. API reserve is a conditional post-`start()` render-clock metric
with a quantum allowance, not physical output time. Lower receiver declarations
change admission guards; they do not directly shrink the SDK scheduling timer.
[Stop state][stopped], [pending final audit][pending-audit], [API reserve][reserve]

Earlier original reports separately show C12 100 ms, C14 95 ms, C15 90 ms and
C16 85 ms passing longs under R2. C16's confirmation failed its then-frozen
timestamp predicate; R3 C17's new 85 ms long failed with two unscheduled packets.
C13's 80 ms attempt missed five schedules. R4 C19's first 90 ms long passed;
its second failed capture EPIPE at 142.037 s after an observed 40.075 ms host
ingestion span. Capture failure is not a receiver latency boundary. These
results cannot be pooled into repeat confirmation across different revisions.
[Original reports/index][historical-index], [R4 rationale][r4], [R5 rationale][r5]

The dirty checkout is material: nine tracked modifications comprise the explicit
source-clock capacity argument; native parameter querying; flow/runner capacity
binding; timestamp/capacity qualification logic; and their tests. Twelve untracked
files comprise seven ALSA/latency research/revision documents and five capacity/
timestamp helpers/tests. In particular, `capture-capacity.ts` and the R2/R3/R5
qualifier changes are absent from HEAD. Frozen run manifests and retained
snapshots, not a clean rebuild of `1f02400`, identify the measured code.
[Capacity helper][capacity-code], [R5 freeze][r5-freeze]

## What the older scale and latency work proves

| Evidence class | Retained finding | Limit |
| --- | --- | --- |
| Synthetic control traffic | 50/100 pairing and HTTP/WebSocket signaling; state-fanout reconnect 2.675/15.284 s | Synthetic SDP/ICE, no corresponding decoder/speaker capacity. [#810](https://github.com/avoid-quest/couch/pull/810) |
| Two-browser PCM ingress | Early 30 s loopback maxima 41.75/41.69 ms, skew 0.146 ms; TLS N0 at 50 ms lead 51.15/51.81 ms, skew 0.67 ms | Shared virtual graph, desktop tuning, incomplete calibration/continuity. Stricter final clock checks were not followed by replacement native qualification. [Early results][old-results] |
| Two-browser direct WebRTC | Matched 120 s runs: maxima 134.458/139.458 ms → 89.396/88.958 ms using 128-frame buffers, requested 64 kb/s; 1,180 markers per output, no recorder/witness xruns | Software JACK boundary; misses old 60 ms gate. No common physical presentation deadline. [Latency results][old-latency] |
| Ten-browser timing | Initial 128 kb/s run: 11,800 markers, max 96.625 ms, skew 11.5 ms. Final 64 kb/s run: 11,796/11,800 markers, six recorder/three witness xruns | Final capture invalid; cannot isolate a codec regression. [Latency results][old-latency] |
| Fifty real Electron receivers, fake source/virtual sinks | Historical 30 min soak: 90,000 active one-second cells; 9,982 concealed samples/22 events | Actual browser decoding, but old `/1` evaluator; no timestamped physical output or continuous identity. [Performance results][old-performance] |
| Fifty-browser corrected `/2` controls | Two matched 10 min runs, 28.8 million initial samples/receiver. Original buffers: 1,468,992 concealed samples; 128 frames: 76,816. Recovery maxima 49/all-50: 6.711/8.365 s versus 7.548/9.368 s | Both `qualified:false`; both miss 5 s recovery. Full outage includes Play near 8 s. Single runs, no Wi-Fi/physical clocks; less concealment coexisted with slower recovery. [Original raw results][old-raw], [latency report][old-latency] |

The older plan's three qualifying 30-minute runs and two-hour soak were not
completed as audio qualification. Nor is there a 50-receiver test of the latest
disciplined stereo path or synchronized video. One real browser per virtual
receiver is stronger evidence than socket simulation, but it cannot be combined
with the separate one-Mac electrical measurement to claim 50 synchronized
physical outputs. [Historical acceptance contract][old-contract]

Important harness corrections remain useful independently: full-waveform marker
matching instead of phase-only shortcuts; prefix/tail coverage; independent
sample-address witness; unknown-preserving counters tied to peer/SSRC/time;
exact declared activity frames; child-close drain; and scoring after capture.
The corrected 50-track/10-second synthetic analyzer took **16.895 s**, worst
synchronous batch **200.36 ms**, failing throughput; #805's older ~3.58 s figure
must not be reused. One-second activity cannot establish identity, pacing or
absence of short gaps. Continuous analysis still requires independent route
calibration. [Evaluator audit][old-audit], [counter helper][counter-helper],
[activity helper][activity-helper], [recording assessment][recording-code]

Artifact checks in this audit: all **28 R5 qualification/result hashes** matched
their 14 completed ledger entries; all **36 pre-R5 original-report hashes**
matched the historical index. C8's three original reports retain 222 passing
gates. All **27 older performance/latency run directories** exist and their
result/failure JSON hashes match the committed manifests. Conversely **0/41**
early `sourceArtifact` paths under `/tmp` exist. Full R5 raw captures are present
at expected sizes. This audit did not rehash every waveform or rerun scoring;
the prior audit's broader 98-file raw-hash check remains separately attributed.
[Older manifests][old-manifests], [prior audit][prior-audit]

## Architecture implications, without selecting the implementation

- **Direct audio+video:** preserve a responsive single-receiver experience and
  local A/V alignment. Existing WebRTC demonstrates that route; the scale
  experiments do not establish synchronized speakers. An SFU could change
  publisher fanout cost, but forwarding alone supplies no group output clock.
- **Relaxed synchronized audio+video:** retain the capability to schedule shared
  playback and let pictures follow sound. Available prerecorded media can be
  sent ahead; uncaptured live media cannot. Main's picture follower polls the
  sound timeline every 250 ms and uses `timingsrc`; that is existing behavior,
  not a low-latency video qualification. [Picture follower][picture-code]
- **Low-latency synchronized audio+video, targeting 50 receivers:** assign source
  time, clock conversion, receiver output delay/rate correction, deadline
  admission and recovery explicitly. The stereo experiment supports the
  feasibility of bypassing recording/HLS for audio. It supplies no video
  timestamps, decoder/display deadlines, lip-sync result or inter-screen skew
  measurement. Audio and video may use different transports/renderers, but
  must share a defined presentation relationship. Evaluate that requirement
  now; the older “video later” scope does not satisfy this task.

Useful candidates are bounded timing, generation ownership, rate/phase
separation, selective runtime fixes and corrected evidence rules. Obsolete as
architecture assumptions are the nominal capture mapper, callback-as-DAC
validator, pre-repair evaluators, treating duplicated mono as true stereo, and transferring
qualification across revised builds. Neither the browser-clock ingress, global
128-frame default, HLS concert route, patched Sendspin internals, nor a wholesale
transport replacement deserves automatic adoption. SonoBus/AOO and Snapcast
remain comparisons, not measured substitutes. [Pinned comparison][comparison]

The prior audit records the owner's functional locked-screen playback confirmation
on iPad and Android Chrome; it supplies no quantitative timing or duration.
[Production-path audit][prior-paths]

Physical multi-device skew, quantified mobile/output-change behavior, continuous fidelity,
long low-latency stability and 50-receiver synchronized A/V remain evidence gaps.
No new physical inputs are available; those gaps limit claims rather than block
architecture research or authorize another campaign. The owner's 100 ms
reference and the retained 90 ms results remain visible; **150 ms is one tested
margin candidate, not an invented requirement**.

[latest-thread]: t3-thread://v1/mcp:e9b1703d-748b-422c-8cbe-632cf5a89eea
[older-thread]: t3-thread://v1/dbdc6c11-7cf4-4d67-b839-b7a52f1188f3
[inventory]: /home/avoid/.t3/worktrees/couch/t3-50ab3999/docs/audio-video-system-inventory.md
[prior-audit]: /home/avoid/.t3/worktrees/couch/t3-c6dbac94/docs/audio-history-research.md
[prior-paths]: /home/avoid/.t3/worktrees/couch/t3-c6dbac94/docs/audio-paths-research.md
[merged-ahead]: https://github.com/avoid-quest/couch/commit/b28db6d10c1b7145e5b8f962ca890fb0a26b39bf
[merged-sharing]: https://github.com/avoid-quest/couch/commit/a7dc537
[merged-helpers]: https://github.com/avoid-quest/couch/commit/83050b4
[merged-ui]: https://github.com/avoid-quest/couch/commit/2304b69
[merged-compressor]: https://github.com/avoid-quest/couch/commit/1e2421b
[merged-compressor-direct]: https://github.com/avoid-quest/couch/commit/32a79d3
[main-sendspin]: https://github.com/avoid-quest/couch/blob/59ac6cd6a510ca96bf60dfc9a3628cc635be22e1/src/server/sendspin.ts
[main-hub]: https://github.com/avoid-quest/couch/blob/59ac6cd6a510ca96bf60dfc9a3628cc635be22e1/src/server/hub.ts
[main-receiver]: https://github.com/avoid-quest/couch/blob/59ac6cd6a510ca96bf60dfc9a3628cc635be22e1/src/client/session/sendspin.ts
[picture-code]: https://github.com/avoid-quest/couch/blob/59ac6cd6a510ca96bf60dfc9a3628cc635be22e1/src/client/session/picture-clock.ts
[join-fix]: https://github.com/avoid-quest/couch/commit/c72c2f9be0e47daadee2aa0fd58cd2bf1bd78561
[bench-head]: https://github.com/avoid-quest/couch/commit/b59c4c6662ef252e59c6271c883bbd09d673f2a7
[routing-head]: https://github.com/avoid-quest/couch/commit/72ba5c019b8b3e22eedd21491d4711f204045b1d
[latency-head]: https://github.com/avoid-quest/couch/commit/28bb99f7805b33595ded6d937e67325b9106d04d
[latency-policy]: https://github.com/avoid-quest/couch/commit/1e59dee67da99da0671e5302dc8ad243f0dbaa6d
[opus]: https://www.rfc-editor.org/rfc/rfc7587#section-6.1
[web-audio]: https://www.w3.org/TR/2021/REC-webaudio-20210617/#dom-audiocontext-getoutputtimestamp
[ingress-source]: https://github.com/avoid-quest/couch/blob/28bb99f7805b33595ded6d937e67325b9106d04d/tests/audio-lab/ingress-browser.ts
[old-results]: https://github.com/avoid-quest/couch/blob/28bb99f7805b33595ded6d937e67325b9106d04d/docs/live-audio-results.md
[old-latency]: https://github.com/avoid-quest/couch/blob/28bb99f7805b33595ded6d937e67325b9106d04d/docs/live-audio-latency-results.md
[old-performance]: https://github.com/avoid-quest/couch/blob/28bb99f7805b33595ded6d937e67325b9106d04d/docs/live-audio-performance-results.md
[old-raw]: /var/tmp/couch-lat2-readback50-1/result.json
[old-contract]: https://github.com/avoid-quest/couch/blob/28bb99f7805b33595ded6d937e67325b9106d04d/tests/audio-lab/evidence.ts
[old-audit]: https://github.com/avoid-quest/couch/blob/28bb99f7805b33595ded6d937e67325b9106d04d/docs/live-audio-evaluation-audit.md
[counter-helper]: https://github.com/avoid-quest/couch/blob/28bb99f7805b33595ded6d937e67325b9106d04d/tests/audio-lab/rtc-counters.ts
[activity-helper]: https://github.com/avoid-quest/couch/blob/28bb99f7805b33595ded6d937e67325b9106d04d/tests/audio-lab/activity.ts
[recording-code]: https://github.com/avoid-quest/couch/blob/28bb99f7805b33595ded6d937e67325b9106d04d/tests/audio-lab/recording.ts
[old-manifests]: /home/avoid/.t3/worktrees/couch/t3-6c0b21ea/docs/live-audio-latency-results.json
[rig]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/docs/audio-stereo-experiment.md
[fixed-result]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/docs/audio-clock-fixed-lead-result.md
[clock-code]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/src/server/live-stereo-clock.ts
[flow-code]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/tests/stereo-hardware/disciplined-source.ts
[resampler]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/tests/stereo-hardware/resample.c
[clock-contract]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/docs/audio-clock-contract.md
[receiver-fix]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/tests/stereo-hardware/receiver-clock-correction.ts
[preparation]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/tests/stereo-hardware/prepare-receiver.ts
[sdk-scheduler]: https://github.com/Sendspin/sendspin-js/blob/7d103075138dda5c8909045647bb42b33c2d44fc/src/audio/scheduler.ts
[stereo-code]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/src/server/live-stereo.ts
[stereo-seam]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/src/server/sendspin.ts:425
[c8-report]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/.scratch/clock-discipline/direct-pTCXx4/qualification.json
[c8-reviews]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/.scratch/clock-discipline/final-spec-r11/REPORT.md
[clock-failures]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/docs/audio-clock-result.md
[r2]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/docs/audio-latency-measurement-r2.md
[r3]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/docs/audio-latency-measurement-r3.md
[r4]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/docs/audio-latency-confirmation-r4.md
[r5]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/docs/audio-latency-capacity-r5.md
[capture-code]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/tests/stereo-hardware/capture.c
[qualifier]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/tests/stereo-hardware/qualify_clock.py
[capacity-code]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/tests/stereo-hardware/capture-capacity.ts
[r5-ledger]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/.scratch/latency-investigation/campaign-r5.ndjson
[r5-150a]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/.scratch/clock-discipline/direct-BZMN0I/qualification.json
[r5-150b]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/.scratch/clock-discipline/direct-Tdglq5/qualification.json
[r5-100]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/.scratch/clock-discipline/direct-bGrLbn/qualification.json
[r5-95]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/.scratch/clock-discipline/direct-Fr0Jhs/qualification.json
[r5-90a]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/.scratch/clock-discipline/direct-OBTsLc/qualification.json
[r5-90b]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/.scratch/clock-discipline/direct-hBQCPT/qualification.json
[r5-results]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/.scratch/latency-investigation/r5-operations
[r5-verifications]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/.scratch/latency-investigation/operator/verifications
[r5-freeze]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/.scratch/latency-investigation/r5-operations/root-freeze-decision.json
[historical-index]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/.scratch/latency-investigation/r5-operations/historical-index.json
[stopped]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/.scratch/latency-investigation/r5-operations/STOPPED.md
[pending-audit]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/.scratch/latency-investigation/r5-operations/FINAL-AUDIT.md
[reserve]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/docs/audio-latency-api-reserve.md
[comparison]: /home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/docs/audio-sonobus-comparison.md
