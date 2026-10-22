# Continuous PCM identity fixture

`continuous.ts` checks the recorded waveform between the existing sparse latency
markers. It is test-owned, mono, 48 kHz, bounded to 120 seconds and 100 receivers.
It does not replace `pcm.ts`, change marker latency/skew gates, measure renderer
underruns, or establish physical audio/backend presentation timing.

```ts
const signal = createContinuousSignal({ sampleRate: 48_000, seed });
// Use signal.render(0, durationFrames) for the source file.
const analyzer = createContinuousAnalyzer({
  sampleRate: 48_000, seed, receiverIds, durationFrames, warmupFrames,
  maxDelayMs: 1_000, runId, routeId,
  // calibration omitted on exploratory runs
  onWindow: observation => writeBoundedObservation(observation),
});
// Supply actual recorded graph PCM to BOTH independent analyzers.
analyzer.push("reference", { startFrame, samples });
analyzer.push(receiverId, { startFrame, samples });
const result = analyzer.finish();
```

`runId` identifies this recording. `routeId` must identify the source/output
route, pinned implementations, backend, and relevant settings. A graph sample
index is required: pipe or browser callback arrival time is not a sample clock.
Negative zero preroll is supported. Every track must begin at or before frame
zero and be contiguous; arbitrary chunk boundaries and track ordering are valid.
Source-relative indices are safe integers. Negative preroll is audited and
discarded before acquisition; changing its length cannot change the phase
anchor. All timing arithmetic after acquisition uses positions in the bounded
120-second source, not large absolute JACK counters. Fractional positions use
JavaScript doubles and interpolation; they are not claimed to be exact sample
identity. Integer sample ownership uses half-open intervals and `ceil` at both
ends, so adjacent cells neither omit nor duplicate an output sample. The error
thresholds, rather than an adjustable epsilon or a rounded offset, decide fit.
Record the output tail through the end of the delayed/resampled source. A missing
track or truncated ending remains unresolved, including a partial final cell.
`push` after `finish`, repeated `finish`, invalid identities/configuration, and an
observation-writer exception throw. A writer exception also invalidates the run.

## Waveform and frozen profile

`signal.manifest` declares `couch-continuous-signal/1`. SHA-256 hashes the UTF-8
string `couch-continuous-signal/1:<seed>:<absolute block ordinal>`. Each block
provides 256 chips; bits are consumed low-bit first within successive bytes.
Chip values are ±512/32768, at six frames per chip. Linear interpolation between
neighboring chips softens transitions. There is no duration-sized loop, and
rendering arbitrary partitions produces the same Float32 samples. Negative
frames are zero. The supplied duration controls when the runner stops playback.

The existing marker identities, waveform, amplitude, and 100 ms interval are
unchanged. Only the tone bed is replaced. The existing marker analyzer receives
the new recorded PCM independently, using its existing detection/gating rules.

`continuousProfile` is frozen, with no caller-provided tolerance overrides:

- Every source frame is accounted for in contiguous 240-frame (5 ms) cells.
  Warmup and the final partial cell can split a cell. There are no excluded
  marker edges, quiet spans, or post-failure windows.
- Output residual RMS must be at most 0.10 times the frozen output bed
  amplitude; peak error must be at most 0.50 times that amplitude. Normalizing
  by the bed prevents loud markers from hiding quieter corruption.
- The recorded reference must reproduce the generated fixture to absolute
  peak error 0.000001, including acquisition and warmup. It is never replaced
  with regenerated PCM as purported recording evidence.
- Gain must be positive and within 0.125–2. It is acquired once and frozen.
  Polarity inversion, mute, and changing gain are not fitted away.
- Source/output advancement rate is restricted to 0.995–1.005, on a fixed
  0.000125 search grid. The first 960 source frames establish one bounded
  acquisition, using the unchanged first marker; maximum acquisition delay
  is 1000 ms. Warmup must contain at least those 960 frames.

Acquisition searches only the predeclared interval and rejects multiple
separated first-marker candidates. It uses the first marker, not whichever
later marker happens to succeed. After acquisition, every candidate timing
step shares the previously accepted endpoint. Accepted mappings are immutable.
There is no independent cell offset/gain fit or retrospective alignment repair.
On the first nonconforming output cell, that cell is reported as mismatching and
the remaining source interval is unresolved. The analyzer never reacquires.
Reference mismatches and capture gaps/overlaps/non-finite values invalidate
measurement. Later good samples cannot repair them.

The first implementation uses contiguous 5 ms cells rather than overlapping
10 ms windows: coverage and defect intervals need no overlap subtraction.
Regressions inject 5/10/20 ms faults at six offsets, including one-sample and
half-cell offsets. Faults include mute, substitution with earlier content,
delete-and-close-gap, insertion, and a drop followed by compensating repeat.
Resampling regressions independently synthesize fractional phase and rates
including both ±0.5% endpoints. These are demonstrated finite synthetic cases,
not a universal mathematical guarantee for arbitrary corruption. Below 5 ms,
or below the residual bounds, defects may be indistinguishable from allowed
correction. Intentional and accidental single-sample edits cannot be attributed
from this result. The detector is not a speech/music listening-quality test.

## Results and calibration

`rawIdentity` is `matched`, `mismatched`, or `inconclusive`. It describes the
observed fixture under this model. `status` is `passed`, `failed`, or
`inconclusive`; a matched exploratory run stays inconclusive without independent
route calibration. Invalid reference/capture data also prevents a pass, even
when an output happens to resemble the generator.

`calibration`, when supplied, has:

```ts
{
  kind: "route" | "synthetic",
  status: "passed" | "failed",
  artifact: string,
  sha256: string,       // 64 hexadecimal characters
  runId: string,        // must differ from this measurement's runId
  routeId: string,      // exact match with this measurement
  profileId: string,    // continuousProfile.id
}
```

The caller must verify and retain that artifact and its hash. The analyzer is a
pure streaming module: it validates the supplied provenance fields, not files
or their authenticity. A metadata-only unit test of the pass branch is not
route calibration. Real calibration must independently show the named healthy
route conforms to this frozen profile and that injected faults remain visible;
it must precede the qualification recording. Synthetic calibration verifies
only detector behavior. A failed or unsupported calibration does not authorize
retuning against the qualification recording. New limits require a new profile.

Per-track coverage partitions `[warmupFrames, durationFrames)` exactly into
matched, mismatched, and unresolved source-frame intervals. `evaluatedFrames`
is matched plus mismatched. A mismatching cell marks a suspect interval, not
five milliseconds of proven missing audio. The result deliberately has no
missing/concealed-source-duration or renderer-underrun counters. Those remain
unknown unless separately observed by the caller. Never derive zeros from a
matched waveform or overwrite the parent evidence's other calibration/health
gates with this result.

`recordedSamples`, `checkedOutputSamples`, and `uncheckedRecordedSamples` expose
the recording audit separately from source coverage. All supplied output
preroll/tail outside the mapped source interval is checked for unexpected
samples (absolute magnitude above 0.10 times the frozen bed amplitude). No
gain is fitted to preroll: before acquisition its check uses the conservative
minimum permitted gain. No
claim is made about audio after recording ends. Source/output intervals,
frozen gain, phase anchor, accepted rate extrema, extrema of residuals,
provenance, and retained failure snippets remain in the result. Reference
residuals are absolute PCM values; receiver residuals are relative to the bed.

## Explicit bounds

PCM buffers depend on the acquisition window and input slice size, not recording
duration or how far one track outruns another. The result reports the observed
track-buffer peak and a conservative total live-PCM bound including one
append/slice copy, acquisition/render workspace, and all allowed snippets.
This is an algorithmic live-data bound, not process RSS or garbage-collector
headroom. Caller-owned input arrays are outside it.

There are at most 128 retained mismatch/unresolved intervals globally, eight
64-sample failure snippets, and 4096 `onWindow` calls globally. Coalescing only
joins adjacent same-verdict intervals on the same track. Truncated interval and
observation counts are explicit; complete coverage totals continue to be
computed. Without a callback, observations are counted as omitted. Callback
payloads contain scalar observations, never full PCM. The callback must provide
its own bounded/nonblocking artifact writer; writer failures are not ignored.
All result metadata collections are bounded. The cap can truncate diagnostic
detail; it does not silently remove samples from measurement coverage.

## Official source limits

Sendspin 5.0.0 can intentionally insert/remove single samples and change playback
rate. Its public `syncInfo` is a snapshot, not a per-chunk correction ledger:
[`scheduler.ts`](https://github.com/Sendspin/sendspin-js/blob/5.0.0/src/audio/scheduler.ts).
The ±0.5% profile is an explicit allowance, not proof of end-to-end clock behavior
or a growing offset-search allowance. It does not model every Sendspin recovery
or sample-blending event. Unsupported distortion remains nonpassing.

Web Audio permits implementation-dependent resampling:
[`AudioBufferSourceNode`](https://www.w3.org/TR/webaudio/#playback-AudioBufferSourceNode).
No universal browser waveform-error bound or physical timing guarantee follows
from the PCM codec name. Backend/output presentation calibration, missing-marker
evidence, resource headroom, renderer telemetry, physical speakers, and Wi-Fi
qualification remain independent.

Run only the lightweight deterministic checks with the pinned Bun:

```sh
/tmp/couch-bun-1.4.2-rmw59ov2/bun-linux-x64/bun test tests/live-audio-continuous.test.ts
```
