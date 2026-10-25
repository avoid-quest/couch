# Native Sendspin playback reuse

25 October 2026. Primary-source review only. No builds, installs, audio runs,
SSH, device/settings changes or commits; only this report was written. The
parent remains the sole runtime operator. This supplements the
[device-controls](audio-native-device-controls-research.md),
[reuse](audio-native-reuse-options.md) and
[Linux defaults](audio-linux-defaults-research.md) reports.

## Decision

**The strongest new reuse candidate is Sendspin's maintained C++ CLI and its
native PulseAudio sink. No reviewed complete receiver is a drop-in Couch Live
output.** Reuse that sink for one bounded playback experiment before adopting a
whole receiver. It already requests per-stream latency, handles partial writes
and reports an estimated playback finish time from libpulse. Its ordinary
`--buffer-ms` control reaches Pulse's `tlength` directly. The CLI's PortAudio
sink instead selects high device latency; Python and Rust also retain buffering
or correction policies unsuitable unchanged for this task. [C1–C5, P1, R1–R3]

The retained Mac native capture comparison now matches all 2,880,000 ADC1/2
frames per channel after the coherent witness's existing S32 conversion at
48 kHz/256. It bypassed ordinary Couch publication, Core transport and playback.
The independent Linux browser blocker remains **53 ms required against a 47 ms
budget**, with 42.667 ms reported output latency. Automatic/.002/Automatic
AudioContext diagnostics all requested Pulse `tlength=32 ms`, `minreq=5.333 ms`;
reported browser output latency was about 32–40 ms. They produced no electrical
qualification. These are distinct findings, recorded in the
[measurement report](audio-roundtrip-performance.md#current-direction-mac-host--linux-analog-output).

## Existing receivers: what can actually be reused

### C++: useful native sinks, unsuitable default live policy

Inspected `sendspin-cpp-cli` **7c7f5e0** (21 October; manifest 0.4.0), which
pins `sendspin-cpp` **90cbd808**. Also checked library HEAD **985fba57**;
the playback-sync documentation describes the same correction approach.
Both projects are Apache-2.0. This is active upstream implementation work, not
an abandoned prototype; current source and released binaries must still be
qualified separately. [C1, C2, C6]

The pinned C++ codec wrappers micro-flac 0.3.0/micro-opus 0.3.5 are also
Apache-2.0 and noise-c 0.1.13 is MIT-style. These root licenses do not replace
the notices/licenses of bundled codec submodules or the linked audio libraries;
no complete distribution license audit was performed. [C9, C10]

- **Native Pulse:** `PulseAudioSink::configure(rate, channels, bits)` requests
  the stream format. `--buffer-ms` defaults to **100**, accepts **10…2000**,
  and becomes `tlength` with `PA_STREAM_ADJUST_LATENCY`; `minreq` and `prebuf`
  use server choices. Timing interpolation and automatic updates are enabled.
  After writes, `pa_stream_get_latency()` plus the client's monotonic time
  supplies the estimated finish timestamp for `notify_audio_played()`.
  Underflows are logged and connection recovery exists. This is reusable output
  code, but the latency request and timestamps remain estimates. No ALC892
  minimum or artifact-free result follows from source. [C3]
- **Native ALSA:** requests the exact stream rate with
  `snd_pcm_hw_params_set_rate()`, buffer time near `buffer_ms`, period time near
  one fifth of it, reads negotiated buffer/period frames, and starts at one
  period. Playback finish uses `snd_pcm_delay()`. Thus 10 ms requests roughly
  480 buffer frames/96 period frames at 48 kHz **before negotiation**, not a
  guaranteed 256-frame configuration. `hw:…` is a hardware route; `default` or
  `alsa:pulse` may still go through plugins/a server. [C4, A1]
- **PortAudio:** passes the negotiated stream rate but hard-codes
  `defaultHighOutputLatency` and `paFramesPerBufferUnspecified`.
  `--buffer-ms` sizes a PCM ring; it does **not** request lower PortAudio device
  latency or an exact callback size. Ring capacity is at least 1024 frames and
  three times reported device latency. Capacity is not automatically occupied
  delay. Its callback maps `outputBufferDacTime-currentTime` into the client
  clock, but currently ignores PortAudio callback status flags. Useful sink
  plumbing, but needs latency controls and complete xrun observation. [C5]

The reusable library seam is explicit: `PlayerRoleListener::on_audio_write()`
receives decoded interleaved PCM on the sync thread, and the sink calls
`notify_audio_played(frames, finish_timestamp)` back. Server-clock conversion
uses a two-state offset/drift Kalman filter. However, the CLI leaves the library
defaults of **150 ms derived startup lead** (25 priming + 50 extra silence +
75 allowance) and **500 ms ongoing buffer request**. `--buffer-ms 20` changes
neither declaration. Startup lead is configured/derived, not measured. Neither
default meets Couch's 47 ms admission budget. Merely reporting smaller numbers
would not qualify a lower-latency implementation. [C2, C7]

**Drift quality is a real blocker:** beyond 100 µs error the library inserts an
averaged frame or drops a frame and blends into its neighbor, once per decoded
chunk; beyond 5 ms it inserts silence or drops late audio, with a 500 µs settling
threshold. This is interpolation around discrete edits, not continuous
band-limited asynchronous resampling. It changes source samples and can create
waveform defects; no listening or electrical failure is asserted here. The
existing browser sample-deletion findings make this unsuitable to accept on
“native” or “synchronized” branding alone. [C6, C8; local measurement report]

The CLI's `--audio-format` only **prioritizes** formats; other advertised formats
remain as fallbacks. Check the actual `stream/start` and running stream. The
library includes Opus support, which Couch Live requires. Native Pulse stream
rate is not proof of the physical sink's nominal rate or absence of server
resampling. Its host build also disables IXWebSocket TLS and proposes only
ChaChaPoly Noise: compatibility with Couch's endpoint/transport must be checked,
not assumed from the Sendspin name. Couch's installed Node library has both
Noise cipher implementations, so ChaChaPoly alone is not an established blocker.
[C1, C2, C9; local `node_modules/@sonn-audio/node-sendspin/dist/noise/session.js`]

### Python CLI / sounddevice: good reference, poor first live candidate

Inspected **004a88b2** (24 October), Apache-2.0. It uses Python ≥3.12,
`aiosendspin`, sounddevice, NumPy and PyAV; sounddevice is MIT and wraps
PortAudio. `--audio-device` and `--audio-format codec:rate:depth:channels` are
real controls, with device format checks and the negotiated rate passed into
`RawOutputStream`. The player nevertheless hard-codes **2048 callback frames**
(42.667 ms at 48 kHz) and **`latency="high"`**. No public player option exposes
256 frames or a numeric latency. sounddevice itself supports numeric seconds
and block sizes, including host-selected `blocksize=0`; that flexibility is not
exposed by this CLI unchanged. [P1–P3]

Startup waits for **200 ms queued audio or 16 chunks**, not an invariant 200 ms
floor independent of chunk size. A source comment assumes chunks arrive
**5+ seconds early**. DAC-time/monotonic mapping, start gating, clock filtering
and underflow recovery exist, but callbacks execute Python queue/allocation and
copy operations. Correction drops input frames or duplicates the previous frame,
with ±0.2% cap, 2 ms deadband and 500 ms reanchor threshold; it is not a smooth
resampler. The reviewed playback connector handles PCM/FLAC, so an unchanged
client also lacks Couch Live's required Opus playback path. Changing constants
would leave format, drift, packaging and admission work. [P1, P4]

### Rust: maintained synchronization code, additional integration blockers

Inspected `sendspin-rs` **acde529c**, v0.3.8 (15 October), Apache-2.0; upstream
still labels the library WIP. Its `SyncedPlayerConfig.buffer_size: Option<u32>`
does expose a fixed frame request; the negotiated format supplies exact stream
rate/channels. It uses **CPAL 0.18**, not the newer CPAL HEAD reviewed in the
capture report. Callback playback/callback timestamp differences are mapped
to a monotonic instant for scheduling. This is a real reusable player, not a
complete Couch adapter. [R1, R2]

The example requests **500 ms lead and minimum buffer**, waits for a separately
configurable 500 ms startup buffer, and leaves device buffer size unspecified.
Its correction skips or duplicates individual frames, capped at **4%**, with
3 ms engagement/1.5 ms deadband. Recent fixes suppress correction while reported
output delay settles and cap it at 0.5% for the first 20 s. These are worthwhile
timestamp-stability lessons, not continuous high-quality resampling or a low
latency qualification. [R2, R3]

The reviewed protocol connection sends plaintext **`client/hello` first**;
there is no Noise initialization on that path. Couch requires `client/init`
and proof of an admitted Device key. TLS support does not substitute for this
handshake. This makes the stock example a standalone protocol experiment,
not a client that can simply join Couch. [R4; local sources below]

## PortAudio through Pulse: can request less; cannot guarantee it

**ALSA direct is not yet shown necessary.** A native Pulse client can request
less than Chromium's 32 ms without daemon tuning. With
`PA_STREAM_ADJUST_LATENCY`, `tlength` targets sink plus stream buffering.
Pulse explicitly requires measuring actual latency; the server can choose
different attributes and its adaptive underrun protection can raise latency.
No reviewed source supplies an ALC892-specific reliable minimum. The earlier
1 ms failures argue against another aggressive tuning sweep. [L1, L2]

There are two materially different PortAudio “Pulse” routes:

1. **Native Pulse host API in current PortAudio**: inspected **1ca0eeed**;
   **absent from stable 19.7.0**. Positive `suggestedLatency` becomes a
   microsecond request converted into `tlength`; it enables
   `ADJUST_LATENCY`, interpolation and automatic timing updates. Default-low
   **10 ms** and default-high **80 ms** are explicitly trial-and-error defaults,
   not enforced floors or demonstrated reliable values. `framesPerBuffer=256`
   is a user callback size, not a Pulse hardware-period command. [A2–A4]
2. **PortAudio ALSA host API → ALSA `pulse` plugin**: can occur with stable
   builds. The inspected plugin maps ALSA buffer/period sizes to Pulse
   `tlength`/`minreq` and uses `PA_STREAM_EARLY_REQUESTS`, **without
   `PA_STREAM_ADJUST_LATENCY`**. Its `tlength` therefore has different semantics.
   An ALSA-labelled device named `pulse` is not PortAudio's native Pulse host
   API and does not bypass Pulse. Log both host API and device. [A1, L1]

**Important readback trap:** current native Pulse PortAudio initializes public
`PaStreamInfo.outputLatency` from its buffer processor's adaptation latency;
that assignment does not add the Pulse server/device queue. Its callback timing
does query `pa_stream_get_latency()` to construct `outputBufferDacTime`.
Therefore `Pa_GetStreamInfo()` alone is insufficient for Couch's actual output
preparation. Expose Pulse timing/negotiated attributes or validate callback DAC
lead against them. Reusing the C++ CLI's native libpulse sink avoids this extra
wrapper/readback issue. [A3, A4]

Direct ALSA through an existing sink/backend is a later fallback if normal
Pulse cannot sustain the unchanged deadline and fidelity gates. It removes
the server queue but requires hardware access/coexistence handling; `default`,
`plug` and `dmix` are not equivalent to `hw`. Small hardware buffers still risk
xruns. No server switch, exclusive takeover or tuning is justified by this
source review. [C4, A1; Linux defaults report]

## Smallest next experiment and the product boundary

**One sink-only experiment, operated by the parent:** reuse the pinned C++ CLI
`PulseAudioSink` in a disposable harness at **48 kHz, stereo, existing PCM
format, 20 ms stream latency request**, against the same near-default private
Pulse and ALC892 route. Leave `minreq`/`prebuf` server-selected as upstream does;
apply no environment, daemon or mixer overrides. This choice is a test request,
not a demonstrated floor. Reusing the sink avoids bringing the full receiver's
150/500 ms declarations or correction algorithm into the first comparison.

Retain requested and negotiated attributes, stream/sink formats and rates,
timing-data availability, `pa_stream_get_latency()` over startup and a bounded
60 s run, write deadlines, underflows/recovery and any latency growth. Use the
coherent witness to inspect the known output signal for interruptions; identify
this as **sink-only evidence**, without a Couch roundtrip/admission claim. A
request being accepted or a low median is not success. Compare the sustained
output requirement with the existing 47 ms budget and existing safety allowance;
if it grows beyond the budget or has gaps, retain the failure. Do not make its
timing declaration smaller to force admission. [C3, L1, L2]

If that succeeds, an **owned Couch desktop output** still needs a concrete
adapter for Device identity/Noise trust, selected receiver token and preparation
epoch, measured readiness/latency publication, actual Opus48k/stereo decoding,
clock mapping, deadline accounting, drift correction, device-change failure and
process teardown. Current selection requires the expected `couch_preparation`
receiver token; the stock players do not provide it. Native support must
implement that contract, not remove it. See local
[`output-admission.ts`](../src/server/output-admission.ts),
[`scheduled-audio.ts`](../src/server/scheduled-audio.ts) and
[`receiver-admission.ts`](../src/client/session/receiver-admission.ts).

The reusable parts are real native sinks, protocol/clock implementations and
codecs. **None reviewed supplies both Couch's integration contract and the
desired smooth drift policy unchanged.** Retain the existing Core/network and
admission/physical gates during integration; repeat the original 60 s witness,
fixed [20,48) interval, complete pair coverage, waveform checks and reversed/cross
controls. The ≤50 ms electrical goal remains open. For eventual helper packaging,
t3code's architecture-specific native-helper build is an existing precedent
already inspected here; this research makes no build/release change. [T1]

## Primary sources

- **C1:** [C++ CLI README, formats/platforms/license](https://github.com/Sendspin/sendspin-cpp-cli/blob/7c7f5e015a894e62b1673f9debdc23b8800d0241/README.md), [version, pinned library and optional native backends](https://github.com/Sendspin/sendspin-cpp-cli/blob/7c7f5e015a894e62b1673f9debdc23b8800d0241/CMakeLists.txt).
- **C2:** [CLI player configuration](https://github.com/Sendspin/sendspin-cpp-cli/blob/7c7f5e015a894e62b1673f9debdc23b8800d0241/src/main.cpp#L803), [buffer defaults/bounds](https://github.com/Sendspin/sendspin-cpp-cli/blob/7c7f5e015a894e62b1673f9debdc23b8800d0241/src/cli.h#L51), [pinned library startup/minimum-buffer policy](https://github.com/Sendspin/sendspin-cpp/blob/90cbd80864bf763fb6a4100f23b1ad2e128c8a75/include/sendspin/config.h#L406).
- **C3:** [Native Pulse sink: writes/timing](https://github.com/Sendspin/sendspin-cpp-cli/blob/7c7f5e015a894e62b1673f9debdc23b8800d0241/src/pulse_sink.cpp#L386), [latency request/flags/open](https://github.com/Sendspin/sendspin-cpp-cli/blob/7c7f5e015a894e62b1673f9debdc23b8800d0241/src/pulse_sink.cpp#L613).
- **C4:** [ALSA sink negotiation/readback](https://github.com/Sendspin/sendspin-cpp-cli/blob/7c7f5e015a894e62b1673f9debdc23b8800d0241/src/alsa_sink.cpp#L313), [delay feedback](https://github.com/Sendspin/sendspin-cpp-cli/blob/7c7f5e015a894e62b1673f9debdc23b8800d0241/src/alsa_sink.cpp#L626).
- **C5:** [PortAudio high-latency open](https://github.com/Sendspin/sendspin-cpp-cli/blob/7c7f5e015a894e62b1673f9debdc23b8800d0241/src/portaudio_sink.cpp#L523), [ring and callback timing/status handling](https://github.com/Sendspin/sendspin-cpp-cli/blob/7c7f5e015a894e62b1673f9debdc23b8800d0241/src/portaudio_sink.cpp#L678).
- **C6:** [Current library playback-sync design](https://github.com/Sendspin/sendspin-cpp/blob/985fba57afb0462b520ab9ce974d1860858ed685/docs/playback-sync.md), [Apache-2.0 license](https://github.com/Sendspin/sendspin-cpp/blob/90cbd80864bf763fb6a4100f23b1ad2e128c8a75/LICENSE).
- **C7:** [Player listener/progress API](https://github.com/Sendspin/sendspin-cpp/blob/90cbd80864bf763fb6a4100f23b1ad2e128c8a75/include/sendspin/player_role.h#L71), [CLI feedback adapter](https://github.com/Sendspin/sendspin-cpp-cli/blob/7c7f5e015a894e62b1673f9debdc23b8800d0241/src/player_listener.cpp#L27).
- **C8:** [Pinned sync thresholds](https://github.com/Sendspin/sendspin-cpp/blob/90cbd80864bf763fb6a4100f23b1ad2e128c8a75/src/sync_task.cpp#L38), [sample insertion/deletion](https://github.com/Sendspin/sendspin-cpp/blob/90cbd80864bf763fb6a4100f23b1ad2e128c8a75/src/sync_task.cpp#L502).
- **C9:** [Pinned codecs, disabled host TLS and Noise suite/dependencies](https://github.com/Sendspin/sendspin-cpp/blob/90cbd80864bf763fb6a4100f23b1ad2e128c8a75/cmake/host.cmake#L65).
- **C10:** [micro-flac license](https://github.com/esphome-libs/micro-flac/blob/v0.3.0/LICENSE), [micro-opus license](https://github.com/esphome-libs/micro-opus/blob/v0.3.5/LICENSE), [noise-c license](https://github.com/esphome-libs/noise-c/blob/v0.1.13/COPYING).
- **P1:** [Python audio player: constants, stream open, DAC timing, correction and startup gate](https://github.com/Sendspin/sendspin-python-cli/blob/004a88b2f2617eebed6baae10a3222f506682fe9/sendspin/audio.py).
- **P2:** [Python CLI controls](https://github.com/Sendspin/sendspin-python-cli/blob/004a88b2f2617eebed6baae10a3222f506682fe9/sendspin/cli.py#L198), [device/format checks](https://github.com/Sendspin/sendspin-python-cli/blob/004a88b2f2617eebed6baae10a3222f506682fe9/sendspin/audio_devices.py), [dependencies/license](https://github.com/Sendspin/sendspin-python-cli/blob/004a88b2f2617eebed6baae10a3222f506682fe9/pyproject.toml).
- **P3:** [sounddevice stream arguments and PortAudio call](https://github.com/spatialaudio/python-sounddevice/blob/master/src/sounddevice.py#L1637), [MIT license](https://github.com/spatialaudio/python-sounddevice/blob/master/LICENSE). Rolling source read 25 October; rendered ReadTheDocs endpoint returned 403.
- **P4:** [Python PCM/FLAC playback connector](https://github.com/Sendspin/sendspin-python-cli/blob/004a88b2f2617eebed6baae10a3222f506682fe9/sendspin/audio_connector.py#L332).
- **R1:** [Rust manifest/version/CPAL/license](https://github.com/Sendspin/sendspin-rs/blob/acde529c3d087ddea66680800c1ce6f0df4c6b08/Cargo.toml), [upstream project status](https://github.com/Sendspin/sendspin-rs), [license](https://github.com/Sendspin/sendspin-rs/blob/acde529c3d087ddea66680800c1ce6f0df4c6b08/LICENSE).
- **R2:** [Rust device/frame controls](https://github.com/Sendspin/sendspin-rs/blob/acde529c3d087ddea66680800c1ce6f0df4c6b08/src/audio/synced_player.rs#L48), [stream configuration](https://github.com/Sendspin/sendspin-rs/blob/acde529c3d087ddea66680800c1ce6f0df4c6b08/src/audio/synced_player.rs#L1050), [DAC timing](https://github.com/Sendspin/sendspin-rs/blob/acde529c3d087ddea66680800c1ce6f0df4c6b08/src/audio/synced_player.rs#L1412), [frame edits](https://github.com/Sendspin/sendspin-rs/blob/acde529c3d087ddea66680800c1ce6f0df4c6b08/src/audio/synced_player.rs#L1828).
- **R3:** [Rust correction planner/settling](https://github.com/Sendspin/sendspin-rs/blob/acde529c3d087ddea66680800c1ce6f0df4c6b08/src/audio/sync_correction.rs), [startup correction caps](https://github.com/Sendspin/sendspin-rs/blob/acde529c3d087ddea66680800c1ce6f0df4c6b08/src/audio/synced_player.rs#L354), [example buffer/lead policy](https://github.com/Sendspin/sendspin-rs/blob/acde529c3d087ddea66680800c1ce6f0df4c6b08/examples/player.rs#L179).
- **R4:** [Rust connection handshake](https://github.com/Sendspin/sendspin-rs/blob/acde529c3d087ddea66680800c1ce6f0df4c6b08/src/protocol/client.rs#L848).
- **A1:** [ALSA Pulse plugin, pinned source](https://github.com/alsa-project/alsa-plugins/blob/811c2ce69d1265ace42a05ef045ca1b4ed72e01c/pulse/pcm_pulse.c#L727), [buffer mapping](https://github.com/alsa-project/alsa-plugins/blob/811c2ce69d1265ace42a05ef045ca1b4ed72e01c/pulse/pcm_pulse.c#L861).
- **A2:** [Stable PortAudio 19.7.0 host APIs](https://github.com/PortAudio/portaudio/tree/v19.7.0/src/hostapi), [current Pulse defaults](https://github.com/PortAudio/portaudio/blob/1ca0eeedb678c3cca80f3306c474d69a7a4b5278/src/hostapi/pulseaudio/pa_linux_pulseaudio_internal.h#L75), [MIT-style license](https://github.com/PortAudio/portaudio/blob/1ca0eeedb678c3cca80f3306c474d69a7a4b5278/LICENSE.txt).
- **A3:** [PortAudio Pulse suggested-latency conversion and public stream info](https://github.com/PortAudio/portaudio/blob/1ca0eeedb678c3cca80f3306c474d69a7a4b5278/src/hostapi/pulseaudio/pa_linux_pulseaudio.c#L1275).
- **A4:** [PortAudio Pulse callback timing](https://github.com/PortAudio/portaudio/blob/1ca0eeedb678c3cca80f3306c474d69a7a4b5278/src/hostapi/pulseaudio/pa_linux_pulseaudio_cb.c#L70), [stream attributes/flags](https://github.com/PortAudio/portaudio/blob/1ca0eeedb678c3cca80f3306c474d69a7a4b5278/src/hostapi/pulseaudio/pa_linux_pulseaudio_cb.c#L738).
- **L1:** [PulseAudio 17 stream latency/timing contract](https://github.com/pulseaudio/pulseaudio/blob/v17.0/src/pulse/stream.h#L80), [buffer attribute semantics](https://github.com/pulseaudio/pulseaudio/blob/v17.0/src/pulse/def.h#L388).
- **L2:** [Official Pulse latency guidance](https://www.freedesktop.org/wiki/Software/PulseAudio/Documentation/Developer/Clients/LatencyControl/), [Pulse 17 adaptive ALSA sink](https://github.com/pulseaudio/pulseaudio/blob/v17.0/src/modules/alsa/alsa-sink.c).
- **T1:** [t3code native-helper build](https://github.com/pingdotgg/t3code/blob/main/apps/desktop/scripts/build-browser-secret.mjs), rolling source read 25 October 2026.

## Addendum: timestamp scheduling and smooth drift correction

25 October 2026, source-only follow-up. **Stock GStreamer 1.26.2
`appsrc ! audioresample ! pulsesink slave-method=resample` does not provide
smooth asynchronous resampling for clock drift.** The blocker is concrete:
`GstAudioBaseSink` estimates clock rate and requests unequal input/output frame
counts; `pulsesink` implements those counts with whole-frame `memcpy`, skipping
or repeating frames. Its source calls this the “toy resampler for trick modes.”
`RESAMPLE` does not silently select the separate `SKEW` mode, but its actual
actuator still performs discrete frame edits. The installed-version upstream
tag was inspected directly, not inferred from newer documentation. [G1, G2]

`audioresample` is a real filtered resampler, but no stock connection sends the
sink's clock error/rate estimate upstream to it. Its rate updates follow input
and output caps, and equal caps permit passthrough. Adding it to this pipeline
does not replace the sink's frame-editing path. `pulsesink` also opens Pulse
without `PA_STREAM_VARIABLE_RATE`. **Do not implement this pipeline expecting
its property name to guarantee smooth correction.** [G3, G4]

### What GStreamer does reuse, and which clock it follows

The proposed Node Sendspin SDK host→client mapping is a viable starting point
for a **timestamp-scheduling diagnostic**, with these distinct domains:

1. Sendspin host timestamps/source sample positions describe the media timeline;
   the existing SDK maps host time into its client monotonic domain. Preserve the
   selected playback deadline when deriving each desired audible target.
2. Node's client monotonic epoch/units must be mapped explicitly into the helper's
   `GstSystemClock` nanoseconds. Linux's ordinary system clock uses monotonic time,
   but shared clock ancestry does not make Node's numeric epoch interchangeable.
3. GStreamer running time is pipeline-clock time minus `base_time`, transformed
   through the TIME segment. Use `appsrc format=time is-live=true`, explicit PTS
   and PCM caps; do not timestamp packet arrival. Force the system clock as the
   pipeline master so Pulse's provided audio clock is not selected instead.
4. Pulse's stream clock is an estimated playback position obtained with
   `pa_stream_get_time()`, ultimately following the sink/DAC. `RESAMPLE` slaves
   that provided clock to the pipeline master using `GstClock` observations and
   linear regression. It therefore already supplies a clock-rate estimator and
   audio timestamp scheduler, although its Pulse resampling actuator is unsuitable.
   [G1, G5–G7]

For a zero-based, unit-rate TIME segment, the source schedules at approximately
`base_time + PTS + pipeline_latency + ts_offset - render_delay`, before conversion
to the internal audio clock and frame position. If the mapped time already means
the desired audible instant, account for those offsets when constructing PTS;
`PTS = target - base_time` alone also adds pipeline latency. Establish base time
and latency after state negotiation, and invalidate the mapping after restart.
Do not add/subtract a second guessed 20 ms on top. Start is expressed by writing
at the corresponding Pulse stream byte position, with cork/uncork management;
Pulse's absolute seek offset is **not** an absolute host-monotonic deadline. [G1, G4]

There is a further limit to the proposed mapping: the built-in estimator follows
**Pulse/DAC versus local system clock**, not source media versus host clock.
The sink derives a buffer's end from frame count and nominal caps rate, explicitly
ignoring its supplied duration. Slowly changing per-packet PTS is not an automatic
fractional resampling controller for the source timeline. Clock mapping, source
sample-rate error and DAC-rate error must not be conflated. [G1]

### Queue, underruns and readback

`buffer-time=20000 latency-time=5000` are microsecond requests, replacing the
200/10 ms base-sink defaults. Pulse receives requested `tlength`/`minreq` with
`ADJUST_LATENCY`; actual attributes are read back and logged. This is a request
for roughly 20 ms total Pulse playback latency, not a guaranteed 20 ms stream
queue, and excludes upstream buffering/filter delay. Bound `appsrc` separately;
its capacity is not a jitter/deadline policy. [G1, G4, G7, V1]

`pulsesink` deliberately sets `prebuf=0`: an underrun leaves time advancing with
silence; writes behind the read index are lost. Its underflow callback logs a
warning rather than failing the pipeline. It does not implement Couch's required
failure/admission policy. The already-tested CLI sink leaves prebuffer selection
to Pulse, so its recovery behavior can differ. [G4, V1, C3]

The GStreamer sink exposes its estimated audio clock and internally logs Pulse
timing/read/write indexes and negotiated attributes. A pipeline latency query
reports scheduling latency, including reported filter latency; it is not an
instantaneous end-to-DAC measurement. `pa_stream_get_latency()` on an owned Pulse
stream provides estimated remaining playback delay, with missing/corrupt timing
and the negative-delay flag handled explicitly. Do not treat requested buffers,
pipeline position or a successful state change as physical delay readback.
[G3, G4, V1, V2]

The parent's [20:47 sink experiment](audio-roundtrip-performance.md#reused-native-pulse-sink-25-october-2047-utc)
already supersedes the earlier sink-only proposal: unchanged native Pulse granted
15 ms stream/20 ms total, with finish lead median 16.466 ms and maximum 20.118 ms
over [20,48). Physical qualification failed the retained alignment criterion;
the approximately 4.65 ms/27 s exploratory drift is not a calibrated PLL target.
This supports trying a correction actuator without daemon tuning or direct ALSA;
it establishes neither electrical latency nor a fidelity pass.

### Pulse variable rate versus an explicit smooth actuator

Open the existing CLI sink with `PA_STREAM_VARIABLE_RATE`, then call
`pa_stream_update_sample_rate()`. Pulse creates a resampler even for equal nominal
rates and changes that stream's input ratio, **not the hardware clock**. With
Speex, updates reuse existing filter state; Speex rescales fractional phase when
the ratio changes. This is filtered variable-rate conversion rather than whole
frame insertion/deletion. However: [V3–V5]

- The API accepts integer Hz: 1 Hz at 48 kHz is **20.833 ppm**. It offers neither
  fractional-Hz targets nor an explicit slew interval. Commands/acknowledgements
  are asynchronous, without a timestamped audible transition boundary. Already
  rendered hardware audio is not retimed by the new setting. [V3, V4]
- Actual method matters. Pulse's `auto` chooses Speex float quality 1 when
  available, but variable-rate fallback without Speex is `trivial`. Filtered
  quality must be observed, not presumed. Pulse's soxr backend calls
  `soxr_set_io_ratio(..., 0)`: an immediate ratio update, not a smooth rate ramp.
  Neither the flag nor a filtered method guarantees artifact-free transitions.
  [V5, V6]
- Pulse supplies an actuator and timing estimates, **no Sendspin deadline
  scheduler or media-clock PLL**. Retain source-frame accounting and a bounded
  phase/rate controller. A sample-rate update also changes libpulse's sample
  specification/timing smoother; requalify the existing finish-time feedback,
  especially across updates, rather than dividing all past frames by the latest
  rate. [V2–V4]

**Smallest reusable components:** the Apache-2.0 Sendspin CLI sink remains the
smallest already-exercised output component. Its library's startup/scheduler and
offset/drift Kalman filter are reusable code, but its 150/500 ms defaults and
sample-edit correction remain unsuitable unchanged (C2, C6–C8). GStreamer owns
more scheduling/clock estimation, but the proposed chain cannot supply the
desired correction quality. If explicit fractional ratios and continuous slew
are required, **libsoxr variable-rate mode** is the narrow existing resampler:
`SOXR_VR`, `soxr_set_io_ratio(double ratio, slew_len)`, and `soxr_delay()` in output
samples. Its upstream example explicitly ramps over the next `slew_len` output
samples. It still needs the existing timestamp mapping and a small controller;
filter/startup delay must fit the measured budget. No inspected component makes
that controller disappear. [X1]

### Smallest defensible next experiment

**Prefer one parent-operated actuator diagnostic on the retained CLI Pulse
harness, not a GStreamer receiver implementation.** Keep 48 kHz/stereo, the 20 ms
request and ordinary server settings; enable variable rate and first observe the
actual resampler. A `trivial` fallback ends the smooth-resampling hypothesis for
that configuration. With a filtered method, use a predetermined, logged bounded
rate sequence (for example 48000→48001→48000→47999→48000), no feedback controller
yet. Retain acknowledgements, continuous frame counts, signed delay/readback,
requested/actual attributes, underflows and raw witness. This isolates whether
filtered rate changes preserve usable timing and waveform quality at this queue;
it does not prove full clock locking. If explicit rate slewing is the question,
run the equivalent isolated libsoxr VR ramp before the fixed-rate sink instead.
Use a valid prospectively selected signal anchor and the unchanged physical gate.

A stock GStreamer run is defensible only to answer the separate **first-PTS/start
scheduling** question; it cannot resolve the smooth-correction blocker above.
Per the parent's inventory, 1.26.2 libraries are installed but `gst-launch`,
pkg-config/development metadata and the Pulse plugin are missing; matching Debian
downloads are available for parent-owned scratch extraction. No packages were
installed/extracted or runtime probes performed here. That availability does not
alter the source finding. These remain standalone experiments, not supported
Couch output or grounds to lower admission declarations.

Licensing: the inspected GStreamer audio base sink is LGPL-2.0-or-later; its Pulse
plugin is LGPL-2.1-or-later. libpulse is LGPL subject to the upstream dependency
notes; libsoxr is LGPL-2.1-or-later. These are reusable libraries, not an Apache-only
bundle; keep notices and the applicable linking/redistribution obligations. [G1,
G4, V7, X2]

### Addendum primary sources

- **G1:** GStreamer **1.26.2** [base-sink defaults](https://github.com/GStreamer/gstreamer/blob/1.26.2/subprojects/gst-plugins-base/gst-libs/gst/audio/gstaudiobasesink.c#L88), [resample clock conversion](https://github.com/GStreamer/gstreamer/blob/1.26.2/subprojects/gst-plugins-base/gst-libs/gst/audio/gstaudiobasesink.c#L1360), [master selection](https://github.com/GStreamer/gstreamer/blob/1.26.2/subprojects/gst-plugins-base/gst-libs/gst/audio/gstaudiobasesink.c#L1691), [PTS/offset/frame-count scheduling and commit](https://github.com/GStreamer/gstreamer/blob/1.26.2/subprojects/gst-plugins-base/gst-libs/gst/audio/gstaudiobasesink.c#L1931), license in file header.
- **G2:** 1.26.2 Pulse sink [frame-copy resampling macros](https://github.com/GStreamer/gstreamer/blob/1.26.2/subprojects/gst-plugins-good/ext/pulse/pulsesink.c#L1365), [unequal-count commit path](https://github.com/GStreamer/gstreamer/blob/1.26.2/subprojects/gst-plugins-good/ext/pulse/pulsesink.c#L1481), [macro invocation](https://github.com/GStreamer/gstreamer/blob/1.26.2/subprojects/gst-plugins-good/ext/pulse/pulsesink.c#L1629).
- **G3:** 1.26.2 `audioresample` [same-caps passthrough](https://github.com/GStreamer/gstreamer/blob/1.26.2/subprojects/gst-plugins-base/gst/audioresample/gstaudioresample.c#L219), [converter rate updates](https://github.com/GStreamer/gstreamer/blob/1.26.2/subprojects/gst-plugins-base/gst/audioresample/gstaudioresample.c#L420), [filter latency query](https://github.com/GStreamer/gstreamer/blob/1.26.2/subprojects/gst-plugins-base/gst/audioresample/gstaudioresample.c#L1008).
- **G4:** 1.26.2 Pulse sink [underrun callback/timing logging](https://github.com/GStreamer/gstreamer/blob/1.26.2/subprojects/gst-plugins-good/ext/pulse/pulsesink.c#L696), [buffer flags and actual attributes](https://github.com/GStreamer/gstreamer/blob/1.26.2/subprojects/gst-plugins-good/ext/pulse/pulsesink.c#L962), [absolute stream writes/uncork](https://github.com/GStreamer/gstreamer/blob/1.26.2/subprojects/gst-plugins-good/ext/pulse/pulsesink.c#L1658), [estimated clock](https://github.com/GStreamer/gstreamer/blob/1.26.2/subprojects/gst-plugins-good/ext/pulse/pulsesink.c#L1993), license in file header.
- **G5:** 1.26.2 [GstClock observation/regression](https://github.com/GStreamer/gstreamer/blob/1.26.2/subprojects/gstreamer/gst/gstclock.c#L1439).
- **G6:** 1.26.2 [system monotonic clock](https://github.com/GStreamer/gstreamer/blob/1.26.2/subprojects/gstreamer/gst/gstsystemclock.c#L158).
- **G7:** 1.26.2 [appsrc TIME segment/live/buffering properties](https://github.com/GStreamer/gstreamer/blob/1.26.2/subprojects/gst-plugins-base/gst-libs/gst/app/gstappsrc.c#L340).
- **V1:** Pulse 17 [latency requests, actual attributes, underrun/index semantics](https://github.com/pulseaudio/pulseaudio/blob/v17.0/src/pulse/stream.h#L87).
- **V2:** Pulse 17 [latency estimate implementation and invalid-timing cases](https://github.com/pulseaudio/pulseaudio/blob/v17.0/src/pulse/stream.c#L2552).
- **V3:** Pulse 17 [variable-rate API](https://github.com/pulseaudio/pulseaudio/blob/v17.0/src/pulse/stream.h#L776), [asynchronous update and timing-rate change](https://github.com/pulseaudio/pulseaudio/blob/v17.0/src/pulse/stream.c#L2836).
- **V4:** Pulse 17 [resampler creation](https://github.com/pulseaudio/pulseaudio/blob/v17.0/src/pulsecore/sink-input.c#L526), [asynchronous sink-thread rate update](https://github.com/pulseaudio/pulseaudio/blob/v17.0/src/pulsecore/sink-input.c#L1738).
- **V5:** Pulse 17 [method selection](https://github.com/pulseaudio/pulseaudio/blob/v17.0/src/pulsecore/resampler.c#L143), [stateful rate update](https://github.com/pulseaudio/pulseaudio/blob/v17.0/src/pulsecore/resampler.c#L494), [Speex update versus reset](https://github.com/pulseaudio/pulseaudio/blob/v17.0/src/pulsecore/resampler/speex.c#L119); SpeexDSP 1.2.1 [fractional phase preservation](https://github.com/xiph/speexdsp/blob/SpeexDSP-1.2.1/libspeexdsp/resample.c#L1108).
- **V6:** Pulse 17 [soxr update with zero slew](https://github.com/pulseaudio/pulseaudio/blob/v17.0/src/pulsecore/resampler/soxr.c#L96).
- **V7:** Pulse 17 [license and dependency qualifications](https://github.com/pulseaudio/pulseaudio/blob/v17.0/LICENSE).
- **X1:** libsoxr **945b592b** [variable-rate/ramp example](https://github.com/chirlu/soxr/blob/945b592b70470e29f917f4de89b4281fbbd540c0/examples/5-variable-rate.c#L37), [delay and ratio API](https://github.com/chirlu/soxr/blob/945b592b70470e29f917f4de89b4281fbbd540c0/src/soxr.h#L175). This is component API evidence, not a claim of recent upstream releases.
- **X2:** libsoxr [LGPL-2.1-or-later license](https://github.com/chirlu/soxr/blob/945b592b70470e29f917f4de89b4281fbbd540c0/LICENCE).
