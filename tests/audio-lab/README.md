# Live audio measurement helpers

`pcm.ts` accepts mono Float32 PCM at one sample rate on one graph timeline.
`startFrame` is a graph sample index, never a pipe/browser callback timestamp.
Negative preroll is allowed; a gap or overlap invalidates measurement. Feed
reference and output chunks interleaved in timeline order. A stalled track
cannot grow the pending join or PCM storage indefinitely; exceeding the join
window makes measurement inconclusive. Each track retains at most its bounded
search window plus an input slice. Failure snapshots are capped at eight
256-sample snippets; `onMarker` lets the runner stream raw frame observations
into its own bounded artifact.

Generate the source with `createMarkerSignal({ sampleRate, seed })`. `render`
works at arbitrary file/chunk boundaries; `marker(index)` exposes identity,
start frame and samples. Generate the full duration: looping a short file is
wrong-source/replayed audio. The fixture combines source/ordinal-specific
128-chip codes with a continuous low-level tone bed. It is not a speech/music
quality fixture. The recorded `reference` must contain these actual samples.

Construct `createPcmAnalyzer` before recording with fixed `durationFrames`,
`warmupFrames`, `maxDelayMs`, receiver IDs and `clockUncertaintyMs`. Source
markers before warmup are excluded and reported; no later window selection is
supported. Missing, repeated and reordered markers are counted; absence never
becomes an omitted latency sample. Correlation searches are bounded by
`maxDelayMs` either side of nominal marker time. Audio outside that range
cannot qualify as a timely match. Markers are spaced at 100 ms by default;
this does not establish continuous speech/music integrity between markers.
Keep renderer dropout/concealment telemetry separate.

`assessGraphCalibration(analysis, expectedDelaysMs, { xruns, overflow, exitCode })`
uses the observed minimum and maximum error, not a percentile. Any missing
marker, invalid measurement, unknown graph health, xrun, overflow, failed exit
or error bound above 2 ms is inconclusive. Synthetic array tests only verify
the analyzer. The native known-delay run separately validates graph timing.
Neither establishes physical DAC/acoustic latency or separate capture delay.

`createLiveAudioEvidence(run)` builds the typed `couch-evidence/1` record and
frozen `couch-live-audio/1` acceptance gates. `writeLiveAudioEvidence(run)` from
`tests/evidence.ts` adds checkout/runtime/OS metadata when `COUCH_EVIDENCE` is
set. Supply measured worker headroom and renderer telemetry; use `null` for
unknown quantities. Calibration offset/uncertainty is reported separately from
raw distributions. Source-to-capture delay is never subtracted. An unknown
output correction cannot create a qualified upper bound. Physical sound,
venue Wi-Fi and sustained 50-listener qualification remain unmeasured here.

`calibration.fixtureActivityPath` defaults to `unknown`. Activity outside matched
marker spans makes lossy/unknown paths inconclusive: filters and codecs can
spread energy beyond a marker. Only a separately calibrated `exact-pcm` path
can treat that activity as a fixture-integrity failure. Codec names or the
known-delay timing calibration alone do not establish this property. Identified
duplicate and out-of-order markers still fail; counts and snippets are retained.

Run the deterministic regressions with:

```sh
bun test tests/live-audio-pcm.test.ts tests/live-audio-evidence.test.ts
```
