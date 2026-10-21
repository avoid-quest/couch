# Audio benchmark evaluation audit

This audit was completed before performance tuning resumed. These changes
repair test evidence; they do not themselves establish a lower supported audio
latency. The subsequent measurements and retained failures are in
[the latency results](live-audio-latency-results.md).

## Defects corrected

| Area | Previous failure | Current rule |
| --- | --- | --- |
| Marker detection | Sampling one phase per chip could miss filtered markers. Even searching every phase still let a sparse impostor hide a real match. | Score the complete waveform at every candidate sample. Prefix sums and a Cauchy–Schwarz rejection bound preserve the full correlation decision. Threshold remains 0.8. |
| Capture coverage | Matching early markers could conceal a missing prefix or tail. | Require the complete reference and the entire declared output-delay interval, independently of marker counts. |
| Observation writers | A throwing writer could leave a marker cursor behind its counters. | Advance the cursor before notification, invalidate measurement on failure, and disable subsequent marker writes. |
| Evidence gates | Clipping and duplicate receiver identities could escape the relevant gates. | Reference clipping and duplicate identities invalidate measurement; output clipping fails quality. |
| Witness comparison | Exact output comparisons stopped at source EOF. | Compare through the declared output tail; reference must remain zero after EOF. The 128-frame control captures its additional displacement too. |
| Runner exit | Missing reference markers or incomplete output could still exit successfully. | One recording assessment checks reference and outputs, coverage, markers, clipping, witness comparison and process exits. Export diagnostics before failing. |
| Build provenance | Backend hashes did not identify stale application/worker bundles. | Route identity includes built Core, all served frontend files and actual worker/ingress bundles, plus effective buffer preferences. |
| Offline scoring | More accurate analysis competed with the capture wall deadline. | Close owned audio/browser processes after capture; score with a separate bounded ten-minute budget and retain elapsed time. |
| Scale counters | `Number(null)` reported unknown concealment as zero; changed streams and resets could produce misleading deltas. | Preserve unknown values and require stable peer/stats/SSRC identity, advancing timestamps and valid counters. Negative `packetsLost` remains permitted by WebRTC. |
| Scale activity | A ten-second stage could pass with eight seconds of output. | Freeze each receiver's exact sample interval and score every delivered frame. A fixed 1.5-second drain cannot replace silent cells or grow during slow snapshots. |
| Scale bookkeeping | Wall-clock changes affected durations; the first CPU sample implied zero CPU; incomplete stages could vanish on failure. | Use monotonic observation time, report the initial CPU interval as unknown, export failed stages and require child closure. |

The scale report is now `couch-live-performance/2`. Its activity and counter
completeness verdicts are separate. A complete activity interval is a delivered
PCM interval: the timestamp-free Pulse monitor cannot prove presentation pacing,
waveform identity or absence of short interruptions.

## Regression evidence

Scoring, coverage, writer, clipping, identity and counter regressions were
observed failing before their fixes. The marker tests compare
the actual analyzer against an independent exhaustive full-waveform oracle at
48 kHz, including phase shifts, filtered/noisy markers, search-window edges,
chunk partitions and a sparse impostor beside a genuine marker. Coverage and
writer-failure tests retain incomplete observations instead of repairing them.

The continuous tests retain 5/10/20 ms corruption, bounded resampling, warmup,
negative preroll, partial tails and writer-failure checks. Continuous calibration
remains omitted for exploratory recordings. No waveform tolerance, 60 ms latency
limit, 5 ms alignment limit or 5-second recovery allocation was relaxed.

Validation used pinned Bun 1.4.2:

- 153 benchmark tests passed, with 2,248 assertions.
- 21 Node worklet/upgrade-guard tests passed.
- Project typecheck and production build passed; the build was refreshed after
  stashing the performance candidate.
- Strict targeted TypeScript checking covers both native runners, replay and
  the new regression tests.

## Retained-capture replay

`tests/live-audio-replay.ts` reads both framed streams and the source file,
rechecks topology snapshots and sample addresses, and uses the same recording
assessment as the native runner. It requires a new output directory, hashes its
inputs/evaluators, and never edits the original run. Process exits and historical
browser/Pulse ownership still rely on the retained run attestations.

| Retained run | Replayed observations | Recording verdict |
| --- | --- | --- |
| `couch-lat-default-2`, two receivers, 15 seconds | 130/130 markers each; maxima 142.979 / 140.125 ms, unchanged; full output tail matches witness | Complete recording; no audio qualification |
| `couch-lat-app128-ten-1`, ten receivers, 60 seconds | 5,798/5,800 markers; receivers 3 and 4 still miss one each; maxima unchanged | Incomplete; replay exits 1 |

The ten-receiver replay took 95.600 seconds offline. Missing observations remain
missing; neither RTC zero counters nor a healthy witness can fill them in.
An earlier phase-only replay recovered two filtered markers in the short q256
recording, but that does not repair the missing markers in the longer recordings.

Replay directories are `/var/tmp/couch-evaluation-audit-default-2` and
`/var/tmp/couch-evaluation-audit-ten-1`. The raw input directories remain intact.

## Instrumentation controls

Two fresh five-second known-delay JACK controls exercised the corrected native
runner sequentially, with 48 kHz PCM and quantum 128:

- Baseline: all 50 markers per output, exact 20/80/150 ms delays, zero recorder
  and witness xruns, and 288,000 exact comparisons per output including the tail.
- Private recorder FIFO: all 50 markers per output; 288,000 exact comparisons at
  the declared 128-frame delay. The incorrect zero-delay assumption produced
  240,128 mismatches per output. Reference checks extend through frame 288,128.

Both controls completed successfully, including process shutdown before offline
analysis. They validate the software recorder boundary and known-delay fixture,
not browser latency or physical speakers. Artifacts are
`/var/tmp/couch-eval-calibration-1` and
`/var/tmp/couch-eval-calibration-delay-1`.

A rebuilt-baseline scale preflight then ran two isolated browser receivers for
five steady seconds, without reconnect rounds. Both scored all 240,000 declared
frames with five active cells, no invalid/clipped samples and no silent cells.
RTC counter coverage was complete with zero observed concealment; all direct
children closed and no partial PCM bytes remained. The initial resource sample
correctly reports unknown CPU. This validates runner integration, not capacity,
latency or longer-duration stability. Artifacts are `/var/tmp/couch-eval-scale-1`
and `/var/tmp/couch-eval-scale-net-1`.

## Limits carried into subsequent performance work

The exact marker benchmark with 50 synthetic outputs and ten seconds of input
took 16.895 seconds, with a 200.36 ms worst synchronous batch. Its throughput
gate correctly failed. This analyzer is currently suitable for bounded offline
recordings, not synchronous scoring alongside a 50-renderer live capture.

Historical activity-only soaks do not retroactively satisfy the new sample
coverage contract. The interrupted fifty-receiver soak was stopped during
admission and remains interrupted; it supplies no completed steady-stage result.

Before promoting performance candidates, use the corrected evaluator on matched
builds, then increase receiver count and duration sequentially. Preserve all
failed attempts. Continuous route calibration, renderer/headroom qualification,
independent physical devices, Wi-Fi and acoustic timing remain separate work.
