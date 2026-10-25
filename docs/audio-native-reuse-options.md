# Existing audio projects Couch can reuse

25 October 2026. Source review only; no dependency installed, package deployed or
device opened. Sources retained under `.scratch/audio-native-reuse-research/`.
Companion research: [native controls and library comparison](audio-native-device-controls-research.md).

## Decision

**Use PortAudio's existing native backend for the first desktop capture
comparison.** Keep Couch's actual PCM upload, Core processing, transport and
browser receivers. A small capture helper must adapt timestamps and lifecycle;
it need not implement another CoreAudio backend. PortAudio supplies rate/format
requests, callback timing and overflow information. Its callback frame count can
differ from the underlying hardware period, so expose requested and observed
values separately. The companion report covers exact APIs, pinned sources,
CoreAudio readback and the required clock mapping.

The convenient Node wrappers are real reuse options, but neither reviewed wrapper
is suitable unchanged for this timing-sensitive path. These findings concern
their source behavior, not measured failures on our hardware.

| Project | Useful existing functionality | Decision for Couch |
| --- | --- | --- |
| [PortAudio](https://github.com/PortAudio/portaudio) | Cross-platform native capture, ADC-time estimates, callback status; MIT-style license | First candidate; reuse backend and examples, add a narrow Couch adapter |
| [Audify](https://github.com/almoghamdani/audify) | Node-API binding to RtAudio; device enumeration, sample rate, sample format, negotiated callback size; MIT | Convenient API reference, but requires timing and queue changes |
| [naudiodon2](https://github.com/csukuangfj/naudiodon2) | Node-API PortAudio binding; buffers with first-sample timestamps; Apache-2.0 | Useful timestamp/format reference, but blocking capture queue and default aggregation need repair |
| [FFmpeg AVFoundation](https://ffmpeg.org/ffmpeg-devices.html#avfoundation) | Existing Mac capture tool; timestamped AVPackets | Not the missing hardware buffer controller; raw PCM piping discards packet timestamps |
| [CPAL](https://github.com/RustAudio/cpal) | Native device/stream controls and timing through Rust | Credible alternative if introducing a Rust helper is justified; see companion report |
| [JackTrip](https://github.com/jacktrip/jacktrip) | Existing native device selection, buffer negotiation and lifecycle adapter | Borrow its MIT-licensed audio-interface pattern; license does not cover every GUI/dependency the same way |
| [SonoBus](https://github.com/sonosaurus/sonobus) | Finished device controls, per-peer buffering and network statistics | Product/behavior reference; application code is GPLv3 |
| [Jamulus](https://github.com/jamulussoftware/jamulus) | Existing CoreAudio rate/buffer implementation and network-music application | Implementation reference; inspected current code has AGPL/GPL boundaries |

The companion report's [network-music comparison](audio-native-device-controls-research.md#existing-network-music-applications-to-borrow-from)
pins these three applications and cites their exact source/license boundaries.
Their complete transports are alternative applications, not drop-in replacements
for Couch's existing browser-compatible protocol.

## Audify: good controls, incomplete capture contract

Reviewed commit `1bf64231b2c7aa5931c48e817f7cbc4066d4cd19`, npm 1.10.1.
[`index.d.ts`](https://github.com/almoghamdani/audify/blob/1bf64231b2c7aa5931c48e817f7cbc4066d4cd19/index.d.ts)
exposes input device/channel selection, sample format/rate, requested frame size,
the chosen size returned by `openStream`, and stream rate/latency readback.
These are stream observations, not electrical measurements or guaranteed raw HAL
periods. Its public input callback receives only a Buffer.

In [`src/rt_audio.cpp`](https://github.com/almoghamdani/audify/blob/1bf64231b2c7aa5931c48e817f7cbc4066d4cd19/src/rt_audio.cpp),
`rt_callback` receives RtAudio `streamTime` and `status` but forwards neither to
JavaScript. It allocates a buffer, takes a mutex and queues a JavaScript callback;
if the supplied frame count differs from the stored size it returns without
forwarding that block. The input ThreadSafeFunction is created with queue size
zero, imposing no queue bound ([Node-API semantics](https://nodejs.org/api/n-api.html#asynchronous-thread-safe-function-calls)).
A stalled JavaScript consumer can accumulate old capture instead of producing an
explicit bounded overflow. JavaScript arrival time cannot replace ADC time.

Its [build workflow](https://github.com/almoghamdani/audify/blob/1bf64231b2c7aa5931c48e817f7cbc4066d4cd19/.github/workflows/build.yml)
includes macOS arm64/x64. That is useful packaging precedent, not a verified
Electron 44 build or macOS permission qualification for Couch.

## naudiodon2: timestamps, but avoid its queue policy

Reviewed fork commit `c59ec6beb73fdb7012c4bdc96ea20c5d37d7d53e`, npm 2.5.0.
The original [Streampunk project](https://github.com/Streampunk/naudiodon) was also
checked. The fork's [`PaContext.cc`](https://github.com/csukuangfj/naudiodon2/blob/c59ec6beb73fdb7012c4bdc96ea20c5d37d7d53e/src/PaContext.cc)
uses PortAudio `inputBufferAdcTime`, falling back to current stream time minus
reported input latency if nonpositive. Preserve that distinction if borrowing
this code. It offsets timestamps when splitting chunks and checks callback
over/underflow status. It supports explicit `framesPerBuffer` and format checks.

Two source-level integration traps:

- [`index.js`](https://github.com/csukuangfj/naudiodon2/blob/c59ec6beb73fdb7012c4bdc96ea20c5d37d7d53e/index.js)
  defaults `inOptions.highwaterMark` to 16,384 bytes. Native `fillBuffer` fills the
  requested read. That chunk spans **42.67 ms at 48 kHz stereo float32**, or
  85.33 ms at stereo int16. This is aggregation duration, not a measured fixed
  per-sample latency. The lowercase `w` in the option is intentional upstream.
- Native capture calls `readPaBuffer` → `Chunks::push` →
  [`ChunkQueue::enqueue`](https://github.com/csukuangfj/naudiodon2/blob/c59ec6beb73fdb7012c4bdc96ea20c5d37d7d53e/src/ChunkQueue.h),
  which waits on a condition variable when full. The default maximum is two
  chunks. A slow consumer can therefore block the audio callback. Merely reducing
  the JavaScript read size does not repair this policy.

The module also registers a process-wide segfault handler writing `crash.log`.
No Electron/macOS-arm64 compatibility test was performed. Reusing PortAudio
directly avoids adopting these wrapper policies and then maintaining a fork.

## FFmpeg and external device setters

FFmpeg is already used by Couch, so its AVFoundation input was checked first as
an executable reuse option. In [FFmpeg n8.0 AVFoundation source](https://github.com/FFmpeg/FFmpeg/blob/n8.0/libavdevice/avfoundation.m),
audio arrives in a single `current_audio_frame` slot; a newer callback releases
the previous unconsumed frame. It creates packet timestamps from sample-buffer
timing, but piping raw PCM alone does not preserve those timestamps. Its device
AVOptions expose no audio HAL buffer-frame setter. Output conversion to a chosen
sample rate does not establish the device's nominal rate. This is not the best
starting point for guaranteed ordered, observed native capture.

An attempted SoX primary-manual URL returned 404; SoX was not qualified or
excluded by a source review here. External device setters have already been
tested on this setup: a 128-frame readback in the setter did not establish a
change to Couch's stream. See the retained measurement report before repeating
that experiment.

## Smallest useful integration experiment

After retaining the new ordinary-capture 48 kHz baseline, change only desktop
capture to PortAudio at requested 48 kHz/stereo/128 frames. Record the actual
running configuration, callback timing, sequence continuity and overflow/null
input status; preserve native timestamp meaning when mapping into Couch's clock.
Keep the exact same Core, scheduling, Linux defaults and physical return. Use
the existing electrical detector and acceptance gates, then assess repeat
fidelity separately. A successful native capture test cannot establish that
Android playback is artifact-free. Defer 44.1 kHz until this comparison is clear.
