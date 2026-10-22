# JACK software presentation witness

This fixture qualifies only **PCM exposed by the named receiver PulseAudio
`module-jack-sink` output port for a JACK cycle**, after browser/Pulse rendering.
It does not calibrate physical presentation, separate source capture delay, or
prove that the browser preserved the source PCM exactly.

## Executables and lifecycle

```
graph source.f32 receivers|calibrate tail-frames [receiver-delay-frames]
witness max-frames source-port receiver-port...
```

Graph retains the existing client/port names. Optional receiver delay is exactly
`0` (default) or `128`, using private FIFO storage on recorder receiver channels;
the reference stays direct. Witness creates `couch_lab_witness:input_N` and
connects each input to the corresponding exact argv port. It has no source-file
or marker-seed argument. Both require 48 kHz and a quantum of 128–4096 frames.

1. Start graph, establish Pulse/browser connections, and finish warmup.
2. Start witness with source first, then the actual receiver sink output ports.
   Wait for both `READY` messages and retain exact topology/Pulse route snapshots.
3. Send **SIGUSR2 to both** to arm capture. Wait for at least two complete PCM
   records from each before sending **SIGUSR1 to graph**. Source generation
   begins at callback entry; that frame is `sourceFirstFrame`.
4. Graph freezes capture after source plus tail, preserving the complete final
   callback. It emits END1, flushes stdout and prints **CAPTURE_DONE** to stderr,
   but keeps its JACK clients/ports alive. Send **SIGTERM to witness**, which
   freezes capture and drains its ring before emitting its terminal record.
   After witness closes, send **SIGTERM to graph**. This order avoids teardown
   appearing as a topology change during witness capture. Witness also stops at
   its max-frames bound.
5. Drain both stdout streams until process **close**, then call parser `finish()`.
   An early graph SIGTERM is an abort; after CAPTURE_DONE it exits successfully.
   A witness SIGTERM is a normal requested stop.

Capture includes preroll. Give witness a max-frames bound including preroll,
source, tail and an extra quantum (at most 140 seconds). Do not stop witness before
it covers graph's final required frames. Missing coverage is inconclusive.

## Wire format: CLABPCM1

All integers and IEEE float32 samples are explicitly little-endian. No C struct
layout is used. Stdout contains only this protocol; diagnostics use stderr.

The 24-byte stream header is ASCII `CLABPCM1`, then u32 sample rate (offset 8),
channel count (12), quantum (16), and role (20: graph=1, witness=2). Channel zero
is reference, subsequent channels follow receiver argv order. Run identity and
exact port bindings belong to the runner's artifact manifest.

Each record has a 64-byte header:

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | ASCII[4] | `PCM1` or terminal `END1` |
| 4 | u32 | Sequence, starting at zero; END uses next sequence |
| 8 | u32 | Raw JACK cycle-start frame; END uses last end-exclusive frame |
| 12 | u32 | Full callback frame count; END uses zero |
| 16 | u32 | Sticky health flags |
| 20 | u32 | Topology-event count since arming |
| 24 | u32 | Xrun callback count since arming |
| 28 | u32 | Source started (0 or 1; witness always 0) |
| 32 | u32 | Actual source-first JACK frame, valid only when started=1 |
| 36 | u32 | Reserved, zero |
| 40 | u64 | `jack_get_cycle_times` current microseconds; END zero |
| 48 | u64 | Next-cycle microseconds; END zero |
| 56 | u64 | Cumulative captured frames, including this record |

`PCM1` is followed by `count * channels` interleaved float32 samples. `END1` has
no payload and is mandatory. Its final health counts include events after the
last captured callback but before capture was frozen.

Flags: 1 ring overflow; 2 frame discontinuity; 4 sample-rate change; 8 quantum
change; 16 freewheel; 32 server shutdown; 64 unavailable/inconsistent cycle time;
128 output I/O failure; 256 invalid callback size; 512 abort/bound exceeded.
Topology includes graph reorder, port registration/rename and connections.
Any nonzero flag, topology count or xrun count invalidates this capture. Arming
must therefore follow all graph setup. The main thread alone performs stdout
I/O; every realtime ring has one producer and one consumer.

## TypeScript API

`createPresentationParser({ maxFrames, maxChannels?, onBlock? })` exposes
`push(Uint8Array)` and `finish(): PresentationCapture`. It retains decoded blocks
within the caller's explicit frame bound (maximum 140 seconds) and byte ceiling
(64 MiB default, configurable up to 256 MiB including protocol overhead).
`maxChannels` defaults to four: short two-receiver qualification and three-output
graph calibration, not the later 50-renderer soak. PCM retention plus decoder
buffers can use roughly twice the byte ceiling. `onBlock` receives
each validated block for runner streaming/analysis. Structural errors throw;
health is retained for assessment. `finish()` requires a complete terminal record.
Blocks additionally expose `cyclePredictionResidualUs` (current cycle microseconds
minus the previous prediction); this is diagnostic, not a sample-address gate.

`assessPresentation({ recorder, witness, source, receiverPorts,
expectedReceiverDelayFrames, startFrame?, endFrame?, topologyVerified })` verifies
the source file at its declared source-first frame, reference identity, exact
receiver overlap, active audio and all stream health. `source` is the retained
Float32Array; receiverPorts are exact named Pulse JACK outputs. Optional interval
bounds are **source-relative**, defaulting to the complete source interval.
The native caller declares `endFrame` as source duration plus its full allowed
output delay (one second, or eight for sync). The reference is checked over the
entire source file and through that tail, where the finite source must be zero.
With expected delay 128, both reference checks and recorder coverage extend
another 128 frames. Missing tail samples remain inconclusive even if every
scheduled marker was detected. Results retain the exact assessed interval.

The result's `status` is passed/inconclusive with reasons, source verification,
per-channel mismatch/activity counts and a zero-delay negative-control comparison.
An expected-128 qualification must reject the zero-delay assumption. Baseline
qualification reports zero additional sample-address offset only at the named
software boundary. The helper names JACK ports generically: the runner must
verify Pulse module/browser ownership to claim a post-browser Pulse boundary;
the 20/80/150 ms graph fixture remains only a known-delay fixture. Existing marker,
continuous integrity, routing, headroom and physical gates remain separate.
Silence cannot qualify a receiver. The runner must also require successful process
exit codes; an I/O failure after END1 was written cannot update the delivered record.

Frame unwrapping uses one anchor across captures, signed modular distance for
each first frame, and unsigned modular differences thereafter. Do not compare
raw u32 values with ordinary ordering, or normalize each recording to zero.
Analyzer input uses `absoluteCallbackFrame - absoluteSourceFirstFrame`.

## Primary sources

- [JACK exact cycle time, latency and callback contracts](https://github.com/jackaudio/jack2/blob/v1.9.22/common/jack/jack.h).
- [JACK2 single-input zero-copy buffers](https://github.com/jackaudio/jack2/blob/v1.9.22/common/JackGraphManager.cpp#L198-L210): never mutate an input buffer.
- [PulseAudio renders into JACK buffers](https://github.com/pulseaudio/pulseaudio/blob/v17.0/src/modules/jack/module-jack-sink.c#L123-L158).
- [Pulse latency includes downstream maximum](https://github.com/pulseaudio/pulseaudio/blob/v17.0/src/modules/jack/module-jack-sink.c#L170-L196): private recorder FIFO avoids changing that metadata.

Cycle microseconds and JACK latency ranges are supporting metadata, not independent
proof of physical timing. `next_usecs - current_usecs` is JACK's documented mapping
interval. Keep nominal sample-clock milliseconds distinct from wall-clock bounds.
