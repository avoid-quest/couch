# Fifty-browser direct playback performance

Measured on 2026-10-21. The final local implementation reduced the median of
three 49-receiver output-recovery maxima from **9.274 s to 5.968 s (35.6%)**.
One receiver stayed online during those faults. The previously working comparison
already contained the volume-command fix; the original unfixed baseline failed
by disconnecting that untouched receiver. **Every final reconnect round still
exceeds the unchanged five-second recovery allocation.**

The measurements and hashes are retained in
[the sanitized results](live-audio-performance-results.json). Reproduction and
measurement definitions are in [the benchmark guide](live-audio-performance.md).
This is an exploratory performance comparison, not audio or device qualification.

## Changes and failure reproduction

1. **Avoid unchanged volume commands** (`075cd4b`). During the baseline's first
   49-receiver fault, the untouched receiver closed with WebSocket code 1008.
   A reduced real-hub test reproduced “Too many commands”: every redundant volume
   command elicited a renderer reply. Remembering the last sent peer volume
   removes this feedback without changing command/signaling limits. Real volume
   changes, including zero, still propagate.
2. **Reuse consent projected for one broadcast** (`2f6b486`). A Core CPU profile
   identified repeated installation/permission lookups while building each
   recipient's controls. The synchronous broadcast reuses its fresh device
   projection. Command handling continues to consult current permissions.
3. **Coalesce publisher peer lists** (`e7f69fb`). Routing changes in one event-loop
   turn share a publisher notification. Receiver stop/load remains immediate;
   ending a source cancels pending notifications. In the first 49-receiver fault,
   observed publisher peer-list messages fell from 98 to 51; state messages to
   the publisher and untouched receiver each fell from 156 to 108.

Both live-routing regressions were observed failing before their fixes. The final
51 focused tests, project typecheck, targeted strict test typecheck, and production
build passed. Existing permission, state-freshness, lifecycle and zero-volume
checks remained intact. The original 50-peer protocol scenario retained its
45-second waits and 90-second timeout; its scratch-timed reconnect changed from
1.793 to 1.466 seconds with notification coalescing. That protocol-only result
is not a browser recovery result.

## Comparable reconnect rounds

Each cell below is the **slowest of all 49 reconnecting receivers**, in seconds.
All three rounds are retained. Control requires a fresh connected socket; media
requires a fresh connected peer with received media. Output additionally requires
a complete active one-second monitor cell after observing that peer. Snapshot
cadence adds observation delay, so these are upper observation bounds rather than
precise presentation times.

| Implementation | Control maxima, rounds 1 / 2 / 3 | Output maxima, rounds 1 / 2 / 3 | Median output maximum |
| --- | --- | --- | --- |
| Volume fix | 6.163 / 7.905 / 7.123 | 8.042 / 9.917 / 9.274 | 9.274 s |
| + broadcast permission reuse | 4.416 / 3.960 / 3.665 | 6.816 / 6.087 / 5.796 | 6.087 s |
| + publisher notification coalescing | 4.061 / 3.950 / 3.839 | 5.927 / 6.075 / 5.968 | 5.968 s |

For the volume-only and final runs, each round's media maximum equals its control
maximum. The middle
run's media maxima are 4.684 / 3.960 / 3.933 seconds. The final median control/media
maximum is 3.950 seconds, down from 7.123 seconds (44.5%). Most of the measured
browser gain follows broadcast permission reuse. The additional output improvement
from notification coalescing is modest (2.0% median); three rounds cannot separate
such a small difference confidently from run variation. The standalone protocol
improvement must not be substituted for the browser measurements.

The untouched receiver retained its peer and active output throughout all nine
partial faults across the three fixed runs. There are no omitted slow receivers.

**Full-group outage has different semantics.** Couch pauses when its last output
goes offline. The harness preserves this policy and sends Play at eight seconds
if recovery remains incomplete. Final full-50 output maxima were 9.172 / 8.442 /
8.313 seconds; media maxima were 3.841 / 3.905 / 3.775 seconds. These are not
automatic all-group recovery successes and do not satisfy the five-second gate.

## Thirty-minute soak after reconnects

The final run completed **1800.032 seconds with all 50 receivers**
after all six reconnect faults. Each receiver contributed exactly 1,800 complete
one-second output windows: **90,000 total, zero silent windows**, with no invalid
or clipped samples reported by the steady-phase assertions. Every receiver kept
its peer through the soak. All seven shorter steady phases in this run also
completed with active output and zero reported concealment.

The long soak nevertheless reported **22 concealment events and
9,982 concealed samples across 18 receivers**;
the largest per-receiver increment was 1,302 samples. RTP packet loss was zero.
Increments appeared in five sampled intervals, first observed at 200.724,
376.332, 441.539, 1369.797 and 1435.086 seconds after the initial soak snapshot.
Those are observation times, not precise fault timestamps. Per-receiver increments
are retained in the JSON. The cause remains unresolved; the measurements do not
justify converting these counters into missing-source durations or claiming
that a particular optimization reduced concealment.

Across 899 complete resource intervals within the soak, median CPU consumption
was 4.15 logical CPUs and the maximum sampled interval was
5.09. Process count stayed at 468. Maximum summed RSS was
38.55 GiB; first- and last-minute means were
38.07 and 38.09 GiB.
Host available memory never fell below 43.77 GiB in those samples.
These observations describe this half-hour run; they do not establish a maximum
receiver count or rule out slower resource growth.

## Environment and scope

Every run used 50 production Electron receiver processes, each with its own
profile, identity, network namespace, mono Pulse sink and PCM monitor, plus one
publisher. Five private Pulse servers served ten receivers each. Electron was
44.4.5, Node 24.21.0, Bun 1.4.2, and PulseAudio 17.0. The route was production
direct WebRTC with a looped 30-second 440 + 997 Hz fake microphone. It did not use
the experimental PCM ingress or the In sync route.

The host was an Intel Xeon E5-2690 v3 at 2.60 GHz, exposing 24 logical CPUs and
62.65 GiB RAM, running Linux 6.12.111+deb13-amd64 on x86-64.
The isolated workload used CPUs 0–15, a 48,000 MiB summed-RSS cap, a 1,024-process
cap, an 8 GiB host-available-memory guard and a sustained CPU guard. Resource
measurements include browser, audio, network and measurement processes. Summed
RSS double-counts shared pages and is not unique physical memory consumption.
No network impairment was injected. All heavy runs were sequential; the owner's
installed Couch, data, audio defaults and host interfaces were left unchanged.

The common sequence was sequential admission, a 15-second warmup, 60 seconds of
steady playback, then three rounds reconnecting 49 and 50 receivers, each followed
by 15 seconds of steady playback. Only the final run added another 15-second
warmup and a 1,800-second soak. Thus its first six fault measurements remain
comparable, while its long-run observations have no matched long baseline.

Browser stats were sampled every five seconds while steady and every 250 ms plus
request cost during recovery. PCM activity cells contain 48,000 samples, with
RMS required above 0.001. Every receiver was scored; browser telemetry truncation,
errors, missing monitor coverage, invalid samples and clipping fail the run.
Core and publisher CPU profiling and PCM monitoring add overhead. These are
instrumented comparisons, not maximum uninstrumented capacity measurements.

One-second activity cannot rule out shorter gaps, incorrect/repeated content,
clock drift or concealed audio. The tone fixture cannot establish continuous
waveform identity. WebRTC concealment counters do not establish exact missing
source duration or renderer underruns. Physical devices, Wi-Fi, independent
clocks, DAC timing, source-to-output latency and inter-output skew remain outside
this experiment. `qualified` remains false, independently of functional completion.

## Retained attempts and provenance

| Run | Recorded implementation | Result |
| --- | --- | --- |
| `baseline` | `bafe9d3` | 50 admitted and initial activity passed; first partial fault dropped the untouched receiver; run failed. Initial steady phase reported 868 concealed samples. |
| `routing` | `aa71a6a` | Six reconnects completed; all five-second gates failed. One post-fault steady phase reported 32,110 concealed samples. |
| `projections` | `1e832bb` | Six reconnects completed; all five-second gates failed. All seven steady intervals reported zero concealment. |
| `batched` | `e7f69fb` | Final comparison and soak; see results above. |

The recorded SHAs are the tested snapshots, including pre-rebase commit IDs.
The JSON also retains three two-receiver preflights: the first stopped at private
Pulse startup, the second exposed an incorrect harness Play action, and the third
completed after those harness fixes. All their owned children closed. None is
used as a 50-receiver performance comparison.
The JSON retains full hashes, per-receiver phase observations and steady counter
deltas, workload contracts, resource summaries, backend fingerprints, errors and
cleanup. Raw artifacts are private under `/var/tmp/couch-perf-<run>-1` and the
corresponding `-net-1` directories. Do not distribute whole directories: Core
logs and temporary configuration can contain test credentials. The sanitized
JSON is the portable evidence; the local raw directories may not persist.

All four 50-receiver attempts closed all 107 owned direct children with exit
code zero, including the failed baseline. The three completed fixed runs also
finished the network wrapper with exit code zero and verified application traffic
for all 50 receiver namespaces. The failed baseline's wrapper correctly returned
one and did not claim complete traffic verification. After the final run, a scan
for benchmark artifact paths in process commands/environments found no remaining
owned processes.

No merge, push or deployment was performed. The five-second recovery gap and
the soak's concealment observations remain open. Improving the next iteration
requires another measured change and the same comparison contract; shorter
observation windows or relaxed targets would not demonstrate a product gain.
