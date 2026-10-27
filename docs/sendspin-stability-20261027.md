# Sendspin stability check and observer interference

A six-minute check at the unchanged Live defaults exercised both receivers'
Leave/Join and one Android-only Wi-Fi interruption. Capture survived; each
receiver recovered without restarting the source, and the other receiver stayed
active. Phone screen off/on was unavailable because MIUI denied input injection.
The existing pink-noise fixture was used; music/voice listening remains untested.

The [default electrical baseline](sendspin-baseline-20261027.md) remains the
latency reference. This follow-up used the same implementation, native input,
stereo Opus and 250 ms configured minimum buffer. No host networking was changed.

## The two Android attenuations

The raw four-channel recording confirms two isolated Android return drops:

| Recording interval | Duration | Android RMS relative to nearby baseline | Reference / Linux |
| --- | ---: | ---: | --- |
| 162.12–162.23 s | 110 ms | 1.03% | Stayed near normal level |
| 278.90–278.97 s | 70 ms | 1.57% | Stayed near normal level |

Subsequent saved-evidence inspection strongly implicates the measurement observer.
Both drops fall within the startup intervals of the run's **only two in-recording
observer restarts**. Those restarts reacquired SDK objects after Leave/Join and
Wi-Fi recovery; they were not user playback commands.

| Observation | First event | Second event |
| --- | --- | --- |
| Observer restart, Linux UTC | 15:35:07.877 | 15:37:04.641 |
| Estimated electrical-drop start, Linux UTC | 15:35:08.559 | 15:37:05.366 |
| First new Android SDK sample | 15:35:08.792 | 15:37:05.555 |
| SDK sync error in that sample | 116.4 ms | 78.6 ms |
| SDK resync count, first → next sample | 0 → 1 | 0 → 1 |

The observer's `connect()` calls `Runtime.queryObjects` for each receiver before
its first getter sample. This is an intrusive heap operation. The official V8
implementation routes it through
[`V8Debugger::queryObjects`](https://github.com/v8/v8/blob/main/src/inspector/v8-debugger.cc)
to
[`HeapProfiler::QueryObjects`](https://github.com/v8/v8/blob/main/src/profiler/heap-profiler.cc),
which explicitly invokes `CollectAllAvailableGarbage` before enumerating objects.
Copies of those primary-source files and their hashes are retained with the
inspection. This establishes an observer side effect; it does not measure the
exact garbage-collection pause in the recorded Android process.

The waveform also shows temporary added Android delay immediately after each
drop: approximately 414 → 534 ms and 414 → 493 ms in short correlation windows.
The SDK then reports a resync and moves back toward its previous timing. Linux
remains near 405 ms. Those short post-drop windows have weaker correlation and
serve as supporting observations, not a new latency benchmark.

No `stream/start`, `stream/end`, `stream/clear`, `client/hello` or Couch `sendspin`
change was recorded within two seconds of either drop. Source references and
Linux stayed active, and Core logged no capture failure. Binary audio arrival
timing was not recorded, so a phone transport stall cannot be excluded solely
from those logs.

## Conclusion and next step

These two points are **confounded by the measurement observer**. The evidence
strongly supports observer-induced disturbance followed by SDK recovery. It
does not establish a spontaneous Couch or Sendspin defect or justify changing
the audio engine, SDK timing behavior, buffer or codec defaults.

The exact heap-query RPC start/end and a performance trace were not recorded.
The upstream source read was not an audit of the exact Android browser build.
The SDK was sampled every two seconds. Electrical/log alignment uses recorded
block host timestamps and one post-run Mac/Linux wall exchange with a 229 ms
bracket; wall-clock rate drift was not independently calibrated. Consequently
the timing association is strong evidence, not a controlled causal proof.

The smallest justified confirmation would be one unchanged run with **no heap
queries or observer reacquisition during recording**. Public SDK counters may
be unavailable after player replacement; that is preferable to disturbing the
measurement to collect them. The electrical witness and ordinary playback
controls already provide the needed continuity/recovery observations. No such
confirmation run or product change was made during this inspection.

## Preserved evidence

The original report and recording remain unchanged at:

`.scratch/sendspin-field/20261027-153054-stability-recovery/`

The added `inspection/` directory contains `timeline.json`, `inspect-events.py`,
`event-levels.png`, upstream V8 source copies and `artifact-hashes.json`.
`.scratch/sendspin-field/inspect-saved-attenuations.py` is the fast deterministic
waveform replay; exit 1 confirms the two recorded isolated Android attenuations.
Original recording SHA-256 is unchanged:

`f292e1cbcb8b2c6cd631492de1d8b2dd1ecef96239170c8c91eecba6ab411647`

This inspection used saved files and a small official-source read. It started
no audio hardware, app, receiver, ADB, network disruption or additional agent.
