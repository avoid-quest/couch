# Native device controls for Live concert audio

25 October 2026. Research only: source/document reads and this findings file. No
installs, builds, audio-device opens, applications launched, settings changes,
SSH, signing or commits. The existing dirty tree and signed Mac scratch package
are preserved. Hardware remains under the parent operator's control.

## Recommendation

**Reuse PortAudio in a small capture-only helper first.** Its existing CoreAudio
backend already implements native buffer negotiation, input capture, ADC-time
estimates and overflow reporting. Adapt its maintained capture example to feed
Couch's existing timestamped PCM upload, Core and network path; keep browser
receivers unchanged. Add Couch session/lifecycle/clock glue and a narrow native
readback shim, rather than writing another capture backend. CPAL is a credible
alternative if a Rust helper is acceptable, with stronger public timing/xrun
information than RtAudio or miniaudio. A bespoke direct CoreAudio stream should
only follow a demonstrated library gap. This is a reuse recommendation, not
evidence of lower electrical latency or artifact-free playback. [P1–P5, Q1–Q2,
R1–R2, M1, L3]

The user's DAW comparison is correct: **real buffer/rate controls exist**.
REAPER documents setting both on macOS; CoreAudio, PortAudio, RtAudio and JUCE
implement them. A browser API limitation does not establish an OS limitation.
Equally, a DAW's successful request does not establish what another application's
stream uses. The retained standalone setter already failed that test here.
Do not repeat that unchanged experiment. [D1, A1–A3, P2, R1, J1, L1]

The proposed host scheduling lead (default 95 ms), retained 25 ms source reserve,
receiver AudioContext preferences and exact getUserMedia rate request are
different controls. A receiver latency hint expresses a browser preference in
seconds; a successful capture-rate request plus first AudioData verifies delivered
format. Neither alone verifies the UMC's nominal rate, its running I/O cycle or
electrical latency. Experimental 45/55 ms PCM packages remain separate. [W1–W2,
C1–C4, L2–L3]

## What is already established on this setup

The primary route is UMC ADC1/2 → ordinary Mac Couch capture → real Core/network
→ Linux ALC892 analog output → UMC ADC3/4. The independent witness records all
four ADC channels together. The existing report and receipts establish:

- Couch delivered stereo 48 kHz AudioData in **128-frame blocks**.
- The native witness delivered **512-frame callbacks**.
- A standalone setter requested 128 and read 128 in its own still-running
  process. An independent process still read 512. The witness remained 512;
  no change to Couch capture was demonstrated.
- That property query reported a range **15…4096**. This is a reported HAL range
  in that context, not qualification of every integer for Couch, every client or
  the physical USB transport. [L1]

These observations are compatible with distinct client I/O configurations and
Chromium's reblocking. They do not identify the driver's internal arbitration
algorithm. In particular, `kAudioObjectPropertyScopeGlobal` means a property's
addressing scope; it is not proof that a buffer request propagates to every
process. Calling this one readout the universal “hardware buffer” overstates the
evidence. A DAW's “sound-card buffer” normally concerns driver/HAL I/O buffering;
it need not expose the USB interface's internal FIFO or converter delay. [A1,
C1–C2, L1]

## Exact CoreAudio controls and readback

Use the selected physical device's **UID**, resolving its current AudioDeviceID;
do not persist the old numeric ID 85. Keep device selection explicit rather than
changing the system default. Check `AudioObjectHasProperty()` and
`AudioObjectIsPropertySettable()` at the intended property address, then use
`AudioObjectGetPropertyDataSize()`/`AudioObjectGetPropertyData()`. [A1–A3]

**Device properties:**

- `kAudioDevicePropertyBufferFrameSize`: `UInt32` I/O buffer frames.
  `kAudioDevicePropertyBufferFrameSizeRange`: `AudioValueRange` of advertised
  inclusive bounds. Request with `AudioObjectSetPropertyData()` and read back
  **inside the process that owns the running stream**. A separate observer is
  supplementary evidence. If implemented,
  `kAudioDevicePropertyUsesVariableBufferFrameSizes` describes variable sizes;
  count actual callback frames rather than assuming fixed delivery. [A1, P2, J1]
- `kAudioDevicePropertyNominalSampleRate`: `Float64` configured device rate;
  `kAudioDevicePropertyAvailableNominalSampleRates`: array of `AudioValueRange`.
  Request the nominal rate only when supported/settable and a device-rate change
  is intended. `kAudioDevicePropertyActualSampleRate` is the current rate measured
  from device timestamps, when provided; it is an observation, not the rate to
  set. Preserve nominal and actual as separate fields. [A2, P2]
- Inspect `kAudioDevicePropertyStreams` and each stream's
  `kAudioStreamPropertyVirtualFormat` and `kAudioStreamPropertyPhysicalFormat`
  (`AudioStreamBasicDescription`), plus
  `kAudioDevicePropertyStreamConfiguration` for channel/buffer layout. Device
  nominal rate, stream format and callback data must agree with the intended
  native-rate contract. [A1–A2, R1]
- Observe input/output-specific `kAudioDevicePropertyLatency`,
  `kAudioDevicePropertySafetyOffset` and `kAudioStreamPropertyLatency` separately.
  These are driver reports, not measured converter/analog timing. Do not add all
  reported latencies blindly: pinned Chromium explicitly notes that AU latency
  already includes device latency on current macOS. [A2, C5]

Register `AudioObjectAddPropertyListener()` or its block variant **before** a
request; watch buffer size, nominal/actual rate, device changes and availability.
Apple says a successful `AudioObjectSetPropertyData()` call does not establish
completion: many changes are asynchronous and must be observed through HAL
notifications. Use a bounded completion wait, then read again after stream start
and on subsequent changes. Return unsupported/error/clamped outcomes truthfully.
A numeric range and `noErr` alone do not prove the requested effective size;
Chromium documents silent clamping, including an example 4410→4096. [A3, C1]

**An owned AUHAL stream:** Apple's TN2091 describes creating
`kAudioUnitSubType_HALOutput`, enabling input with
`kAudioOutputUnitProperty_EnableIO` (input scope, element 1), disabling unused
output (output scope, element 0), selecting the device with
`kAudioOutputUnitProperty_CurrentDevice`, and installing
`kAudioOutputUnitProperty_SetInputCallback`. The callback obtains input through
`AudioUnitRender()` on element 1. [A4]

For that AU, request/read `kAudioDevicePropertyBufferFrameSize` through
`AudioUnitSetProperty()`/`AudioUnitGetProperty()` at global scope, element 0,
as pinned Chromium does. Read the device-side AU format on input scope, element
1; set/read the client format with `kAudioUnitProperty_StreamFormat` on output
scope, element 1. Configure/read `kAudioUnitProperty_MaximumFramesPerSlice` to
provide adequate allocation. **MaximumFramesPerSlice is a capacity ceiling, not
an I/O-period request.** TN2091 requires the AUHAL client/device sample rates to
match; separate conversion is necessary for a different client rate. [A4–A5,
C1–C2]

**A direct HAL helper:** `AudioDeviceCreateIOProcID()` → `AudioDeviceStart()` →
callback → `AudioDeviceStop()` → `AudioDeviceDestroyIOProcID()` is an even smaller
alternative when the native device format is suitable. Request/read device
properties in this same process; measure callback frames from each
AudioBuffer's bytes, sample format and channel layout. There is no AudioUnit
MaximumFramesPerSlice or AU client-format property on this path. The retained
`witness.c` already demonstrates this API on this device, including native
four-channel float32 data; it is not a completed Couch capture backend. [A1–A2,
L1]

## Existing tools: what they actually control

**Audio MIDI Setup:** Apple's built-in GUI is the practical existing device-rate
control: select the UMC and its Input/Output view, then Format for rate/depth.
The documented standard UI does not provide a general buffer-frame selector.
Do not alter clock source, Configure Speakers, volume or default routes as part
of this experiment. The GUI's Format is not a running browser callback readout.
[A6]

**REAPER:** Preferences → Audio → Device, documented in user guide **7.41,
§1.12.2**, allows macOS sample-rate and block-size settings; the guide's general
buffer discussion explicitly mentions 256/128 and the possibility of clicks at
small sizes. REAPER is a maintained commercial application with an evaluation,
not a dependency Couch needs to bundle. **Ableton Live 12** also uses selected
CoreAudio input/output devices and has audio hardware/latency configuration;
its official manual points to its built-in audio setup lesson. The stronger
directly verified written buffer-setting evidence here is REAPER's manual.
Neither application is an independent readback of Couch's stream. [D1–D2]

**CLI:** the retained `bufferctl.c`/`bufferctl-hold.c` are concrete native property
query/set examples, with the failed cross-process result above. A robust control
utility must add UID resolution, asynchronous listeners and running-owner
readback; it must not infer success from one `noErr`. `SwitchAudioSource`
(`switchaudio-osx`, MIT, inspected commit below) selects devices and mute state;
its documented `-f` is **output text format**, not sample format. It has no
documented rate/buffer setter. Qrivi's `audioctl` (MIT, July 2026 revision,
Apple Silicon/Intel releases) documents device, volume, mute and aggregate
operations but no buffer/rate-set command. Do not recommend either as the
missing buffer controller. [L1, T1–T2]

A small upstream Swift utility named `Set-CoreAudio-Sample-Rate` does call
`AudioObjectSetPropertyData(...NominalSampleRate...)`; its inspected source only
prints success from the return code, has no completion listener/readback and no
buffer control. It is evidence that a rate-setting CLI is feasible, not a
qualified replacement for the requested observation tool. Its README reports
testing with RME, not this UMC; no runtime compatibility or licensing conclusion
is made here. Manufacturer pages/PDF endpoints were inaccessible in this
research, so this report does **not** certify a UMC rate list or vendor-specific
control panel. Query the actual device. [T3]

**JACK:** JACK2's CoreAudio driver requests buffer/rate and performs readback and
property-change handling. It is a real native solution, not proof that Chromium
will join its scheduling domain: an ordinary getUserMedia stream is not a JACK
client. Adding a JACK server/virtual routing layer is unnecessary for a small
Couch capture helper. JACK2 and example tools are separate licensed projects;
the inspected server COPYING is LGPL 2.1 and `jack_iodelay` source is GPL 2+.
No macOS package/support qualification was performed. [K1–K2]

## What Electron 44.4.5 / Chromium 152 actually does

Electron's **v44.4.5 DEPS pins Chromium 152.0.7977.130**. The following trace uses
that tag, not generic Chromium HEAD. The Electron patch inventory was checked
for relevant audio/media changes; this is not a full audit of every patch or a
runtime attestation of an arbitrary installed binary. [E1]

1. `AudioManagerMac::GetInputStreamParameters()` reads the device nominal rate
   and calls `ChooseBufferSize(true, rate)`. At 48 kHz its ordinary input default
   is 128 frames, with min/max hardware-capability metadata. It does **not**
   simply inherit the standalone tool's current buffer readout. [C1]
2. `AUAudioInputStream::OpenAUHAL()` selects its device, requires its input-device
   rate to match the requested native rate, and calls `MaybeChangeBufferSize()`.
   That function reads and writes **its AudioUnit's** buffer-frame property,
   clips the request to the queried range and accounts for smaller streams in
   Chromium's own active input/output stream lists. Those lists are not a
   system-wide DAW arbitration service. A fresh open therefore has its own
   buffer policy; a pre-applied external value has no retention guarantee. [C1–C2]
3. It reads back the AU property after configuration, then can compensate for
   mismatches: `Provide()` stages native callback data in a FIFO and emits
   `input_params_.frames_per_buffer()` blocks. The MSTP source copies those
   AudioBus blocks to AudioBuffers/AudioData. **128-frame AudioData is not by
   itself proof of 128-frame native callbacks.** [C2–C3]
4. The raw/unprocessed sample-rate candidate is fixed to the device's advertised
   native rate. The inspected Mac open path reads/checks the nominal rate; it
   does not write `NominalSampleRate` to satisfy a JavaScript constraint. An
   exact 44.1 kHz request with processing disabled can therefore reject while
   the device remains 48 kHz. It is not an OS hardware-rate setter. [C1–C2, C4]

There is also a useful nuance: pinned Mac capture **does have** a public
getUserMedia `latency` → unprocessed `requested_buffer_size` → AUHAL allocation
path, because its backend advertises variable input-buffer bounds. The same
claim cannot be made for the pinned Pulse backend, which advertises a fixed
default input size. Thus “JavaScript can never affect a Mac native buffer” is too
broad. It is still a seconds-based capture latency constraint, selected through
browser processing/capability policy, followed by clamping and possible
reblocking; it is not the explicit device negotiation/readback interface wanted
for this investigation. Keep this source-level option distinct from the already
planned **output** AudioContext latency preference. No new browser constraint
trial is proposed here. [C1, C4, C6, W1–W2]

**External tools and concurrent DAWs:** changing nominal rate can affect the
shared device and what Chromium sees at its next enumeration/open. Changing a
different client's buffer does not establish Chromium's buffer; the retained
trial proves that locally. Keeping a DAW open may maintain a particular device
rate, add load, or conflict if it takes exclusive/hog access, but cannot grant
Couch control over the DAW's stream. Do not use “leave REAPER running” as a
supported solution. Exact behavior of a live rate change, driver/client buffer
arbitration and how Electron reacts to a running device reconfiguration remain
runtime questions. Avoid that reconfiguration in the next experiment. [A1–A4,
C1–C2, L1]

## Capture-backend comparison and concrete reuse

**Direct CoreAudio — reference option if a library gap is demonstrated.**
Use an input-only IOProc, or input-enabled/output-disabled AUHAL if format/channel
mapping makes that simpler. Request 128/256/512 through the owned HAL/AU path;
read back after start and retain actual frame histograms. IOProc supplies
`inInputTime.mSampleTime`, `mHostTime` and validity flags; `inNow` is callback-cycle
time and includes scheduling delay. Listen for `kAudioDeviceProcessorOverload`
and `kAudioDevicePropertyIOStoppedAbnormally`, and independently detect sample
discontinuities and local queue overflows. An overload notification is not an
exact missing-sample count. This requires macOS-native code and Xcode/SDK builds
per shipped architecture, but no third-party audio runtime or driver. It keeps
the native timestamp evidence most accessible. Reuse the retained `witness.c`
for API/measurement conventions, not as a reason to build a new backend before
trying an existing library. [A1–A5, L1]

**PortAudio — recommended first reuse candidate.** Its C callback API takes rate,
channels, `framesPerBuffer` and a suggested latency; `Pa_GetStreamInfo()` reports
estimated input/output latency and stream rate. The CoreAudio implementation
actually sets/reads HAL buffer frames, observes rates/latency and maps overloads
to `paInputOverflow`/`paOutputUnderflow`. The callback's
`PaStreamCallbackTimeInfo.inputBufferAdcTime` describes the first input sample's
estimated ADC time in PortAudio's stream-time clock. The Mac backend derives it
from host timestamps and reported device latency. This is substantially better
suited to Couch than stamping arrival time. [P1–P3]

Important PortAudio details: `framesPerBuffer` is the **user callback size**, not
a portable guarantee of the hardware period; fixed user blocks may add adaptation
buffering. Suggested latency participates in the Mac host-buffer choice. Use
native property/callback readback, not just the Pa_OpenStream arguments.
`paMacCoreChangeDeviceParameters` permits hardware parameter/rate changes;
`paMacCoreFailIfConversionRequired` with it requests rejection rather than rate
conversion. These flags can disrupt concurrent clients; do not enable a device
rate change merely to capture the existing native 48 kHz stream. The public
stream-rate field can equal the requested rate when more precise hardware
information is unavailable; retain independent nominal/actual readback. [P1–P3]

PortAudio is MIT-style licensed. Latest published stable inspected is **19.7.0
(6 April 2021)**, but the repository is actively maintained: inspected commit
`1ca0eeedb678c3cca80f3306c474d69a7a4b5278` (23 October 2026) fixes a CoreAudio
start/stop deadlock. That makes dependency/version qualification material; this
report inspects stable and current source, not a recommendation to ship an
unpinned branch. Build its selected backend for each platform. [P2–P4]

Start from `examples/paex_record.c` for enumeration/open/start/stop and callback
plumbing, and `test/patest_suggested_vs_streaminfo_latency.c` for requested versus
reported latency. **Do not copy the examples unchanged:** `paex_record.c` ignores
`timeInfo`/`statusFlags` and inserts silence for null input. Preserve
`inputBufferAdcTime`, record overflow/null input explicitly, queue interleaved
stereo float32 outside the callback, and send the existing Couch packet header.
Use `PaMacCore_GetStreamInputDevice(stream)` for the owning stream's device ID,
`PaMacCore_GetBufferSizeRange()` for bounds, and native property readback in that
same process. These are existing Mac extension APIs. The public API does not
expose every AUHAL callback's raw `mSampleTime`/frame count: the PortAudio callback
may already be adapted. A narrow diagnostic hook in its existing CoreAudio
callback can expose those if required; do not label user-callback frames as raw
HAL frames. None of this requires implementing a new audio driver/backend. [P1–P3,
P5]

**CPAL — credible existing Rust helper, not a bespoke HAL implementation.**
The inspected source is revision
`68f6f752b2941ab101e2d7d67fe3f1caa67d9eaf` (20 October 2026), whose Cargo manifest
declares **0.19.0**, Apache-2.0 and Rust1.85 minimum. This is a source pin, not a
claim that every published version has these APIs. `DeviceTrait` supplies
`supported_input_configs()`/`build_input_stream()`; `StreamConfig` takes channels,
sample rate and `BufferSize::Fixed(frames)`, with `SupportedBufferSize::Range` for
advertised bounds. The source explicitly calls Fixed a request, not a callback
size guarantee. `StreamTrait::play()` starts it. Reuse `examples/record_wav.rs`
for device/config/capture plumbing, replacing WAV output with the existing Couch
packet producer and bounded queue. [Q1–Q2]

At this pin the callback gets **`CallbackInfo`**, whose `timestamp()` returns
`StreamTimestamp { callback, device }` and `xrun()` reports a glitch. Older
`InputCallbackInfo` examples must not be mixed with this source API. The Mac
backend converts `mHostTime` to `StreamInstant`, then derives input `device` time
by subtracting queried buffer/device/safety-offset depth; overload listeners feed
the xrun flag. This is a derived acquisition estimate with a backend-specific
convention, not untouched ADC time or an exact lost-frame count. Its clock docs
also forbid assuming independent streams share origins. Preserve the same
clock-mapping/electrical-bias qualification as PortAudio. [Q1]

One material CPAL caveat: this Mac input implementation attempts to set the
**physical stream format** and requested rate before building its AUHAL stream,
and monitors device changes. That is more intrusive than a read-only device
selection: verify it does not disturb the fixed48k witness, and adapt that policy
if necessary. Native AU buffer readback exists internally, but Couch still needs
explicit diagnostic exposure. CPAL is attractive if Rust integration is already
wanted; adding Rust solely to avoid a small C PortAudio adapter is not clearly a
smaller change. Parent is separately assessing Electron/Node bindings. [Q1–Q2]

**miniaudio — easy C integration, missing capture-timing contract.** Inspected
revision `9634bedb5b5a2ca38c1ee7108a9358a4e233f14d` (3 March 2026) identifies itself
as **0.11.25** and offers public-domain/Unlicense or MIT No Attribution licensing.
`ma_device_config_init(ma_device_type_capture)`, `capture.pDeviceID`, format,
channels, `sampleRate`, `periodSizeInFrames`, `ma_device_init/start/uninit` and the
existing `examples/simple_capture.c` are directly reusable. Period size/count
are hints; the CoreAudio backend does set and read back buffer frames. Leave
`coreaudio.allowNominalSampleRateChange` false to retain the current device rate.
Automatic resampling can otherwise make client/device rates differ. [M1–M2]

Its public `ma_device_data_proc(device, output, input, frameCount)` has **no
per-block acquisition timestamp or xrun status**. The inspected CoreAudio input
callback uses `AudioTimeStamp` for `AudioUnitRender()` but does not pass it through
to the user callback; the documented notification kinds cover lifecycle/rerouting,
not an ADC-overrun counter. `noFixedSizedCallback=true` avoids its normal fixed
callback reblocking but does not add timestamps. Meeting Couch's clock/overrun
contract therefore requires backend additions, not just a wrapper. The capture
example also writes its encoder from the callback and needs a bounded queue for
this task. Choose it for simple audio I/O only if those explicit additions are
acceptable; PortAudio needs less timing glue here. [M1–M2]

**RtAudio — small, but requires a timing extension for this use.** It is
MIT-style licensed, cross-platform and designed as a `.cpp`/`.h` pair. Its
`openStream()` accepts a buffer-frame pointer, rate and input/output parameters;
CoreAudio sets buffer size and nominal rate, waits for rate readback and reports
xruns. However the public callback's `streamTime` is seconds elapsed since stream
start, **not the input sample's host/ADC timestamp**. The inspected CoreAudio
callback does not expose its native input timestamp to that API. Its buffer
argument/result also is not a substitute for a fresh native property and actual
callback readback. Choosing it would require a small backend-specific timestamp
extension to preserve Couch's measurement contract, reducing its simplicity
advantage. Its existing `tests/record.cpp` provides capture/open/stop plumbing but
ignores `streamTime`/status in the sample callback, so it also needs adaptation.
Inspected maintained revision:
`06f97b633c06ea747d6478f0e87b6e1178104511` (16 October 2026). [R1–R3, R4]

**JUCE — capable, unnecessary here.** Its CoreAudio implementation has direct
buffer/rate requests/readback, an optional callback `hostTimeNs` context and an
xrun count. Host time still needs direction/latency interpretation, not an
automatic ADC-time label. The inspected current framework is dual licensed
AGPLv3/commercial (JUCE 9), and brings broader modules/build conventions. It is
reasonable if Couch already needed that framework; there is no evidence that it
is the smallest addition for this capture-only seam. Inspected revision:
`454fe891acc8204f99f4ef1e3a28c84b1a4da145` (12 October 2026). [J1–J2]

**Reusable now versus Couch-specific glue:** PortAudio/CPAL already own native
capture, device enumeration, parameter requests and lifecycle primitives.
Couch must still supply its owner permission/session, UID selection, bounded
PCM queue, generation/sequence/sample-position header, source→Core monotonic
clock mapping, error policy and PID cleanup. Existing examples demonstrate
capture; they do not implement those application contracts. Prefer reusing the
library backend while keeping this small adapter explicit. [P5, Q1–Q2, L3–L4]

## Existing network-music applications to borrow from

**JackTrip is the best existing application reference for permissive code reuse.**
At inspected revision `df585b004da527bb434350645e81159bf1eb9be0`,
`src/RtAudioInterface.cpp` is MIT-licensed and already demonstrates selected
devices, input-only or duplex `openStream()`, buffer negotiation, channel handling
and error/lifecycle integration. Borrow that adapter pattern if useful, while
using PortAudio for its acquisition-time API. Reusing JackTrip's whole transport
would replace the required Couch network path and browser receivers, so it does
not answer this capture-only task. JackTrip's license distinguishes MIT core/
Virtual Studio code from the GPL Classic GUI; shipped Qt/ASIO dependencies and
binary variants have additional terms. Do not generalize the core's MIT license
to every distributed JackTrip build. [G1]

**SonoBus is a strong behavior/reference application, with GPLv3 boundaries.**
Its inspected revision `35f1062dab196b9838a4bb529c4bf6592b7f5987` documents native
peer-to-peer music streaming, adjustable latency/quality, PCM/Opus, visible
network statistics and larger safety buffers for Wi-Fi jitter. It uses its own
modified JUCE6 and AOO, not today's JUCE9; inspect each vendored license before
extracting code. It is useful for how a finished music application separates
audio device settings and network buffering. Directly copying application code
brings GPLv3 obligations; it is not a permissively licensed capture component or
a drop-in Couch sender. No runtime comparison is claimed. [G2]

**Jamulus is a concrete native CoreAudio implementation reference.** At inspected
revision `4c0dbf23a1ccd0a3624906064a2e03292ba77494`,
`src/sound/coreaudio-mac/sound.cpp` reads/sets nominal rate, requests input/output
buffer sizes and handles actual sizes. Its server mixes clients, so using the
whole application changes the protocol and path. A material license trap: the
README's generic GPL link is less specific than current `COPYING` and source
headers. Those state AGPL3-or-later for the combined/current project and new
contributions from3.12.1dev, with earlier-code GPL3-or-later provisions. Treat
that inspected code as copyleft, not an MIT sample. Borrow concepts or separately
evaluate the license before copying; PortAudio avoids this extra application
framework/protocol surface. [G3]

These existing source projects establish that native buffers and
network music are solved, reusable engineering domains. Their latency claims
do not certify Couch, the UMC, Wi-Fi Android, or the ≤50ms electrical target.
For the smallest reusable **capture** candidate, PortAudio plus Couch's existing
upload adapter still wins; for a permissive **application integration pattern**,
start by reading JackTrip's audio interface. Binding/CLI implementations are
covered separately by the parent and were not duplicated here.

## Keep the existing Couch seam and clock meaning

The existing upload contract is already appropriate: generation, sequence,
source sample position, source-clock first-sample time, rate, real channel count
and interleaved float32 PCM. Its binary v1 decoder accepts 44.1/48/96 kHz and up
to 4096 frames; Live requires real stereo. Core normalizes to scheduled 48 kHz.
Replace the capture producer, not this contract or the receiver. A native
implementation must establish its monotonic-clock mapping through the same
Core upload/session authority; it cannot impersonate a renderer time origin by
copying integer values. [L3]

Keep native callback work bounded: preallocated PCM/timestamp records into a
bounded queue; conversion/serialization/upload off the realtime callback. Stop
or report an explicit discontinuity on overflow. Do not repair a missing block
by retimestamping it as continuous audio. Retain a local monotonic sample index
and the native sample-time deltas so elapsed callback count cannot hide a
capture gap. These are recommended design requirements, not implemented changes.
PortAudio's callback contract explicitly prohibits blocking/unbounded work. [P1]

Timestamp pitfalls that must be settled before comparing backends:

- A Mach host timestamp is a clock count, **not nanoseconds or Unix time**.
  Convert using the host clock's timebase; preserve original ticks and validity
  flags for diagnostics. `mSampleTime` is a device frame timeline, not time
  elapsed since the upload connection began. Anchor first-sample position/time
  together and start a new generation on incompatible restart. [A2, L1, L3]
- `inNow`, JavaScript arrival, callback entry and ADC first-sample time differ.
  Apple's IOProc documents `inInputTime` as acquisition from hardware, whereas
  Chromium's AUHAL path subtracts its calculated hardware latency from the AU
  timestamp. PortAudio similarly computes an ADC-time estimate. Preserve raw
  timestamps plus reported latency and explicitly name the chosen convention;
  do not double-subtract AU/device latency or silently equate these conventions.
  Their residual physical bias requires electrical comparison. [A2, C2, C5, P2]
- Map helper monotonic time into Core's clock with measured offset/uncertainty;
  do not use wall time, renderer arrival time, or an assumed identical
  `performance.timeOrigin`. Track oscillator drift separately from clock offset
  and delivery delay. Couch's existing resampler/clock contract already makes
  these distinct. [L3]

**Lifecycle and permission:** Main should own the Live capture grant/session
and helper PID, stop on Share stop, owner-window close/navigation, Core/session
loss and app quit, and require explicit restart after unrecoverable format or
clock change. A native helper bypasses Chromium's media-permission machinery,
so retain Couch's owner authorization and macOS microphone consent explicitly;
do not use it as a permission bypass. Native capture needs the app's
`NSMicrophoneUsageDescription`; audio-input entitlement applies if Hardened
Runtime is enabled. Current Couch packaging declares the usage description and
has `hardenedRuntime: false`; enabling it is a separate change, not a prerequisite
inferred here. Whether a separately signed helper inherits the expected consent
attribution needs a real packaged permission test. [E2, A7, L4]

An ordinary native executable can be supervised by Main, or a native module can
run in an Electron utility process. `utilityProcess.fork()` launches a **Node
module**, not an arbitrary Mach-O executable; it provides message ports and
spawn/exit events. The module route adds Electron/native-ABI packaging concerns;
a small executable avoids that ABI coupling. Bundle the eventual helper for
each architecture and sign nested code before the outer app, following Apple's
normal nesting rules. The existing t3code native-helper build script is a useful
small scope reference, not evidence of microphone support. None of this requires
a driver, JACK service, new network protocol, or receiver rewrite. **Do not patch
or re-sign the retained scratch app** to explore this: permission identity and
package stability remain part of the controlled evidence. [E3, A8, T4, L4]

Capture-only is sufficient for the present route. A native output backend would
be a separate receiver change; a full-duplex backend is only needed if Couch
itself must drive local output/stimulus. The independent witness may continue its
existing full-duplex four-channel recording/stimulus. Use mixable/shared access:
no hog/exclusive mode, aggregate device, system-default switch, gain/volume,
channel remapping or monitoring changes. A rate change may affect other clients
even when the preference is offered only in Live; strict isolation cannot be
promised for a shared device clock. [A1–A4, P2, R1, L1]

## One next controlled experiment: native ownership at 48 kHz

**After the new ordinary-capture 48 kHz baseline is retained**, do one bounded
capture-backend comparison against it. Prepare a separate, supervised
**PortAudio-based capture producer at 48 kHz, stereo ADC1/2, requested 128-frame
user blocks**, recording suggested input latency and native post-open buffer
readback. Feed the existing Couch binary upload/Core/network path and unchanged Linux
browser receiver. Use 128 to match ordinary Couch's delivered block size; a
256/512 sweep would add another variable and is not the next experiment.
This compares backends, not an isolated claim about buffer-size causation.
The signed R4 app remains byte-identical. If the helper cannot use the existing
authorized upload seam without changing that package, resolve that source-level
seam first; do not quietly substitute a new signed app. [L1–L4]

1. **Before streaming:** resolve the UMC UID in the helper; log rate/buffer
   existence, settable flags, advertised bounds, nominal/actual rate, native
   stream layout and input latencies. Register property listeners. Use
   `Pa_OpenStream()` with no output parameters and no device-rate-change flag;
   retain the exact rate/frame/suggestedLatency arguments. Request only input
   buffering, not a nominal-rate change. Retain request status and completed
   readback. Keep the independent observer's values separately labeled. [A1–A3]
2. **During the actual Couch share:** have the helper itself read back after
   start using `PaMacCore_GetStreamInputDevice()` plus native properties, and log
   `Pa_GetStreamInfo()`. Retain PortAudio callback frames, ADC-time deltas,
   overflow/null-input/abnormal-stop events, queue high-water and overflow counts,
   plus first and periodic Core ingress receipts. If a narrow native diagnostic
   hook is available, retain raw HAL callback frames/sample-time/validity too;
   otherwise identify those as unobserved rather than inferring them from
   128-frame user callbacks. Stop the
   ordinary browser microphone producer before starting this new source: two
   producers must not feed the same generation. Keep the coherent witness on
   all four channels at native 48 kHz; log its own callback geometry/overloads
   without forcing it to 128. If nominal rate, witness continuity or routes
   change, the comparison is invalid. [A1–A3, L1, L3]
3. **Measure the real path:** retain package/settings/route/level/stimulus
   identity and the original 60-second witness, 52-second stimulus, [20,48)
   electrical coverage, ≤50 ms limit, negative controls and waveform criteria.
   Linux stays near-default Pulse: no `PULSE_LATENCY_MSEC`, no
   `--audio-buffer-size` override, timer scheduling, `flat-volumes=no`. Keep
   scheduling lead/reserve, codec and receiver preference fixed to the new
   baseline. End by stopping/reaping only owned PIDs and recording cleanup.
   No “512 is stable everywhere” or sustained drop-free conclusion follows
   from one run. [L1–L2]

**Known:** existing PortAudio implements native capture/parameter requests and
ADC-time/overflow callbacks; the independent witness exercises native capture on
this UMC. **Hypothesis:**
owning capture can improve delivery/observability without browser capture
handoffs. **Unknown until the experiment:** negotiated helper callbacks,
timestamp bias, actual age at Core, preservation of concurrent witness capture,
and whether end-to-end fidelity/latency improves. Current browser blocks already
being 128 means this is not a “shrink a 512-frame Couch buffer” experiment.

## 44.1 versus 48 kHz: what a later comparison means

Distinguish device nominal/actual rate, native stream/callback format, delivered
PCM rate, and Core's **48 kHz normalized/network rate**. They need separate
readbacks. Delivered 44.1 kHz with hardware at 48 kHz includes conversion; actual
hardware 44.1 kHz followed by Core48 also includes conversion. A failed exact
44.1 kHz raw getUserMedia request at native48 is an informative unsupported
combination, not permission to enable speech DSP or pretend hardware changed.
[C1–C4, A4, L3]

For a later capture-rate-only comparison, keep the new 48 kHz baseline's backend,
package, buffer request in frames, lead/reserve, receiver, Linux format/defaults,
stimulus and physical gates fixed, changing only the source request. Record any
conversion and its location. Holding frames fixed necessarily changes duration:
128/256/512/1024 frames at48k are **2.667/5.333/10.667/21.333 ms**; at44.1k they are
**2.902/5.805/11.610/23.220 ms**. Holding milliseconds instead changes frames and
answers a different question. Conversion CPU/filter delay is implementation
dependent; do not assign a fixed SRC penalty or assume lower rate is faster.
[P1–P3, W1, L3; durations calculated as frames/rate]

**Fixed48k witness constraint:** the existing direct witness explicitly rejects
a native format other than48k. Changing the same UMC ADC clock to44.1k cannot
simultaneously preserve that witness as an unconverted native48k recording.
Keeping a48k *delivered* witness via SRC would be a different witness path requiring
qualification. Therefore a true hardware44.1k comparison is separate and deferred;
do not change the device clock under the current fixed48k witness. The native48k
backend comparison above avoids that conflict completely. [L1, A4]

## Linux and Android: relevant boundaries, no new tuning

ALSA hardware parameters belong to an **open PCM substream**. A native ALSA owner
can request rate, channels, period size and buffer size with `snd_pcm_hw_params_*`
functions; `*_near` negotiates, so read actual installed params and stream delay.
`/proc/asound/card*/pcm*p/sub*/hw_params` shows the active playback substream's
rate/period/buffer; `status` and `sw_params` provide different information. If
Pulse owns `hw:...`, those are Pulse's hardware parameters, not a private ALSA
period owned by Chromium. `aplay --period-size/--buffer-size` configures a newly
opened aplay stream and does not retroactively set Chromium's. [N1]

For real Pulse, Chromium requests **per-stream** attributes through libpulse;
the inspected output uses `tlength=3×block bytes`, `minreq=block bytes/2` with
`PA_STREAM_ADJUST_LATENCY`. Pulse combines client requests with device limits and
adaptive scheduling; the request and allocated ALSA ring are not current queued
latency. Observe server identity, `pactl list sinks`, `sink-inputs`, and their
sample specs, requested/configured/reported latency; a native client can inspect
`pa_stream_get_buffer_attr()`/`pa_stream_get_latency()` and callbacks. Keep the
existing defaults recommendation; nothing here establishes ALC892-specific
tuning or explains the Android crackles. [C6, N2, L2]

On PipeWire, distinguish graph rate/quantum, individual stream format/buffering
and ALSA device period/headroom. `pw-top` reports driver QUANT/RATE, follower
suggestions, FORMAT and xruns/errors; FORMAT may differ from graph rate and
require SRC. `node.latency` is a suggestion; forcing graph quantum or device
period configuration can affect other clients. Pulse-compatible Chromium
normally negotiates through pipewire-pulse when that is the server. Verify
which server is actually running; do not apply a global PipeWire quantum/rate
change to this Pulse baseline. Distribution policy and this machine's precise
PipeWire behavior were not qualified. [N3]

Android/Chrome offers browser audio preferences, not direct AAudio/Oboe device
buffer ownership. A native Android receiver could request low latency and tune
the opened stream's buffer using AAudio/Oboe, read burst size, actual capacity,
mode, timestamps and xrun count; requested modes/sizes can differ from accepted
ones. Oboe advises querying after open and allows device-specific size limits.
That would be a separate native receiver product, unnecessary for the Mac
capture-only candidate. No universal512-frame stability follows, and this
research does not identify the Wi-Fi crackle cause. [N4, W1, L1]

## Automatic latency estimates without a physical return

Receiver telemetry can estimate first-sample age at receive/decode/schedule,
queued lead, clock uncertainty/drift, schedule omissions, and predicted output
time using `AudioContext.getOutputTimestamp()` plus reported output latency.
With a source capture timestamp mapped into the same clock, it can estimate
**source timestamp → predicted presentation** for that receiver. Do not add
baseLatency/outputLatency mechanically: the output timestamp already maps a
context frame to estimated device rendering, and the specification warns that
`currentTime` minus its contextTime is not a reliable output-latency measure.
Report distributions and uncertainty, not just the configured95ms lead. [W1, L3]

It cannot independently establish the true ADC timestamp bias, hidden device
conversion/driver delays, actual analog output, speaker propagation or continuous
audible integrity. A scheduled AudioBuffer is not proof that it reached the
jack; a receiver cannot identify an unknown live source's original electrical
time from content alone. WebRTC jitter/RTT stats, if that transport is used,
remain transport statistics; Couch's current custom PCM/Opus upload/network path
does not magically obtain physical calibration from them. [W1–W3, L1–L3]

Optional acoustic measurement could correlate a known source marker with a
microphone recording of a listening speaker, preferably capturing the source
reference and destination sound coherently. It includes speaker/mic/room and
propagation delay, so it is a different endpoint measurement. JACK's maintained
`jack_iodelay` sends a signal and analyzes a connected return; it needs the route
under test to traverse its ports and does not measure a separate Couch path by
merely being open. Retain the existing coherent electrical return as the stronger
test for this target. This answers the estimation question; no automatic
calibration feature is proposed or implemented. [K2, L1]

## Sources and exact versions

Apple/W3C online references and rolling manuals were read on 25 October 2026.
Archived Apple notes remain useful API documentation; they do not certify every
modern driver. Constants with sparse web documentation were cross-checked
against maintained native implementations. Apple's copyright SDK header
comments are additionally available in a third-party mirror, explicitly identified
below rather than treated as an independently maintained API specification.

- **A1 — Apple device buffer APIs:** [buffer frames](https://developer.apple.com/documentation/coreaudio/kaudiodevicepropertybufferframesize), [range](https://developer.apple.com/documentation/coreaudio/kaudiodevicepropertybufferframesizerange), [variable frames](https://developer.apple.com/documentation/coreaudio/kaudiodevicepropertyusesvariablebufferframesizes), [IOProc](https://developer.apple.com/documentation/coreaudio/audiodeviceioproc), [create](https://developer.apple.com/documentation/coreaudio/audiodevicecreateioprocid(_:_:_:_:)), [overload](https://developer.apple.com/documentation/coreaudio/kaudiodeviceprocessoroverload), [hog mode](https://developer.apple.com/documentation/coreaudio/kaudiodevicepropertyhogmode).
- **A2 — Apple rate/clock/format APIs:** [nominal](https://developer.apple.com/documentation/coreaudio/kaudiodevicepropertynominalsamplerate), [available nominal rates](https://developer.apple.com/documentation/coreaudio/kaudiodevicepropertyavailablenominalsamplerates), [actual rate](https://developer.apple.com/documentation/coreaudio/kaudiodevicepropertyactualsamplerate), [AudioTimeStamp](https://developer.apple.com/documentation/coreaudiotypes/audiotimestamp), [AudioHardware.h, Apple macOS11.3 SDK comments mirrored](https://github.com/phracker/MacOSX-SDKs/blob/master/MacOSX11.3.sdk/System/Library/Frameworks/CoreAudio.framework/Versions/A/Headers/AudioHardware.h#L717), [AudioHardwareBase.h mirror](https://github.com/phracker/MacOSX-SDKs/blob/master/MacOSX11.3.sdk/System/Library/Frameworks/CoreAudio.framework/Versions/A/Headers/AudioHardwareBase.h#L668).
- **A3 — Apple property protocol:** [settable](https://developer.apple.com/documentation/coreaudio/audioobjectispropertysettable(_:_:_:)), [set and asynchronous-completion discussion](https://developer.apple.com/documentation/coreaudio/audioobjectsetpropertydata(_:_:_:_:_:_:)), [listeners](https://developer.apple.com/documentation/coreaudio/audioobjectaddpropertylistener(_:_:_:_:)).
- **A4 — Apple TN2091:** [Device input using the HAL Output Audio Unit](https://developer.apple.com/library/archive/technotes/tn2091/_index.html), especially “Setting up the AUHAL” and “Setting the format.”
- **A5 — Apple QA1533:** [How to handle kAudioUnitProperty_MaximumFramesPerSlice](https://developer.apple.com/library/archive/qa/qa1533/_index.html).
- **A6 — Apple:** [Set up audio devices in Audio MIDI Setup](https://support.apple.com/guide/audio-midi-setup/set-up-audio-devices-ams59f301fda/mac).
- **A7 — Apple permission:** [NSMicrophoneUsageDescription](https://developer.apple.com/documentation/bundleresources/information-property-list/nsmicrophoneusagedescription), [audio-input Hardened Runtime entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.device.audio-input).
- **A8 — Apple TN2206:** [macOS Code Signing In Depth, Nested Code](https://developer.apple.com/library/archive/technotes/tn2206/_index.html).
- **E1 — Electron44.4.5:** [DEPS](https://github.com/electron/electron/blob/v44.4.5/DEPS#L4), [Chromium patch inventory](https://github.com/electron/electron/tree/v44.4.5/patches/chromium).
- **E2 — Electron:** [askForMediaAccess and Info.plist requirements](https://www.electronjs.org/docs/latest/api/system-preferences#systempreferencesaskformediaaccessmediatype-macos).
- **E3 — Electron:** [utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process), distinguishing Node-module fork from an executable helper.
- **C1 — Chromium152.0.7977.130:** [Mac input parameters](https://github.com/chromium/chromium/blob/152.0.7977.130/media/audio/mac/audio_manager_mac.cc#L736), [ChooseBufferSize](https://github.com/chromium/chromium/blob/152.0.7977.130/media/audio/mac/audio_manager_mac.cc#L1083), [MaybeChangeBufferSize](https://github.com/chromium/chromium/blob/152.0.7977.130/media/audio/mac/audio_manager_mac.cc#L1153), [nominal rate read](https://github.com/chromium/chromium/blob/152.0.7977.130/media/audio/mac/audio_manager_mac.cc#L1491).
- **C2 — Same pin:** [AUHAL open/rate check/buffer request/readback](https://github.com/chromium/chromium/blob/152.0.7977.130/media/audio/apple/audio_low_latency_input.cc#L399), [callback FIFO/reblocking and capture-time calculation](https://github.com/chromium/chromium/blob/152.0.7977.130/media/audio/apple/audio_low_latency_input.cc#L1166).
- **C3 — Same pin:** [MSTP audio block copying/timestamp conversion](https://github.com/chromium/chromium/blob/152.0.7977.130/third_party/blink/renderer/modules/breakout_box/media_stream_audio_track_underlying_source.cc#L64).
- **C4 — Same pin:** [raw rate candidate](https://github.com/chromium/chromium/blob/152.0.7977.130/third_party/blink/renderer/modules/mediastream/media_stream_constraints_util_audio.cc#L845), [latency→buffer request](https://github.com/chromium/chromium/blob/152.0.7977.130/third_party/blink/renderer/modules/mediastream/media_stream_constraints_util_audio.cc#L950), [min/max selection](https://github.com/chromium/chromium/blob/152.0.7977.130/third_party/blink/renderer/modules/mediastream/media_stream_constraints_util_audio.cc#L1691), [direct source allocation](https://github.com/chromium/chromium/blob/152.0.7977.130/third_party/blink/renderer/modules/mediastream/local_media_stream_audio_source.cc#L53).
- **C5 — Same pin:** [CoreAudio hardware-latency calculation and inclusion warning](https://github.com/chromium/chromium/blob/152.0.7977.130/media/audio/mac/core_audio_util_mac.cc#L477).
- **C6 — Same pin:** [Pulse input parameters](https://github.com/chromium/chromium/blob/152.0.7977.130/media/audio/pulse/audio_manager_pulse.cc#L112), [Pulse output buffer attributes](https://github.com/chromium/chromium/blob/152.0.7977.130/media/audio/pulse/pulse_util.cc#L601).
- **D1 — REAPER7.41:** [official user guide §1.12.2 and §22.4](https://www.reaper.fm/userguide/ReaperUserGuide741c.pdf), [license/evaluation](https://www.reaper.fm/purchase.php).
- **D2 — Ableton Live12 manual:** [Audio settings](https://www.ableton.com/en/live-manual/12/first-steps/#settings), [monitoring and overall latency](https://www.ableton.com/en/live-manual/12/routing-and-i-o/#monitoring). Help-center buffer article returned HTTP403; no unavailable text is relied upon.
- **P1 — PortAudio19.7.0:** [callback time info/status, Pa_OpenStream, PaStreamInfo](https://github.com/PortAudio/portaudio/blob/v19.7.0/include/portaudio.h#L692), [Mac flags/range API](https://github.com/PortAudio/portaudio/blob/v19.7.0/include/pa_mac_core.h#L146).
- **P2 — PortAudio current inspected pin:** [CoreAudio capture, timestamp calculation, listeners](https://github.com/PortAudio/portaudio/blob/1ca0eeedb678c3cca80f3306c474d69a7a4b5278/src/hostapi/coreaudio/pa_mac_core.c), [setBestSampleRateForDevice / setBestFramesPerBuffer / xrun mapping](https://github.com/PortAudio/portaudio/blob/1ca0eeedb678c3cca80f3306c474d69a7a4b5278/src/hostapi/coreaudio/pa_mac_core_utilities.c#L444).
- **P3 — PortAudio19.7.0 comparison:** [host buffer choice and ADC-time calculation](https://github.com/PortAudio/portaudio/blob/v19.7.0/src/hostapi/coreaudio/pa_mac_core.c#L1635), [buffer setter/readback](https://github.com/PortAudio/portaudio/blob/v19.7.0/src/hostapi/coreaudio/pa_mac_core_utilities.c#L638).
- **P4 — PortAudio:** [19.7.0 release](https://github.com/PortAudio/portaudio/releases/tag/v19.7.0), [23 October2026 CoreAudio deadlock fix](https://github.com/PortAudio/portaudio/commit/1ca0eeedb678c3cca80f3306c474d69a7a4b5278), [license](https://github.com/PortAudio/portaudio/blob/1ca0eeedb678c3cca80f3306c474d69a7a4b5278/LICENSE.txt).
- **R1 — RtAudio inspected pin:** [CoreAudio negotiation and callbacks](https://github.com/thestk/rtaudio/blob/06f97b633c06ea747d6478f0e87b6e1178104511/RtAudio.cpp#L1586).
- **R2 — Same pin:** [callback streamTime/status semantics](https://github.com/thestk/rtaudio/blob/06f97b633c06ea747d6478f0e87b6e1178104511/RtAudio.h#L185), [openStream/getStreamLatency/getStreamSampleRate](https://github.com/thestk/rtaudio/blob/06f97b633c06ea747d6478f0e87b6e1178104511/RtAudio.h#L519).
- **R3 — Same pin:** [build/platform notes](https://github.com/thestk/rtaudio/blob/06f97b633c06ea747d6478f0e87b6e1178104511/README.md), [license](https://github.com/thestk/rtaudio/blob/06f97b633c06ea747d6478f0e87b6e1178104511/LICENSE).
- **J1 — JUCE inspected pin:** [CoreAudio device requests and callback implementation](https://github.com/juce-framework/JUCE/blob/454fe891acc8204f99f4ef1e3a28c84b1a4da145/modules/juce_audio_devices/native/juce_CoreAudio_mac.cpp#L841), [public callback context/xrun API](https://github.com/juce-framework/JUCE/blob/454fe891acc8204f99f4ef1e3a28c84b1a4da145/modules/juce_audio_devices/audio_io/juce_AudioIODevice.h#L42).
- **J2 — Same pin:** [JUCE9 AGPLv3/commercial licensing](https://github.com/juce-framework/JUCE/blob/454fe891acc8204f99f4ef1e3a28c84b1a4da145/LICENSE.md).
- **K1 — JACK2 pin17959465a722225a36a8b612aed26764036f258e:** [CoreAudio buffer/rate requests and readback](https://github.com/jackaudio/jack2/blob/17959465a722225a36a8b612aed26764036f258e/macosx/coreaudio/JackCoreAudioDriver.mm#L1476), [license](https://github.com/jackaudio/jack2/blob/17959465a722225a36a8b612aed26764036f258e/COPYING).
- **K2 — JACK example tools pin1f87b60464e2ec28bc8fd797b47ce287f0b44a33:** [iodelay signal/return implementation and GPL notice](https://github.com/jackaudio/jack-example-tools/blob/1f87b60464e2ec28bc8fd797b47ce287f0b44a33/tools/iodelay.cpp).
- **T1 — switchaudio-osx pin6659247d96a6b1f0c6b89bfd33a597ed36030c9a (2023):** [commands/platform notes/license](https://github.com/deweller/switchaudio-osx/blob/6659247d96a6b1f0c6b89bfd33a597ed36030c9a/README.md).
- **T2 — Qrivi/audioctl pin5dff1b3fa291f01289c2cf84259cb085c9eec729:** [commands/releases](https://github.com/Qrivi/audioctl/blob/5dff1b3fa291f01289c2cf84259cb085c9eec729/README.md), [MIT license](https://github.com/Qrivi/audioctl/blob/5dff1b3fa291f01289c2cf84259cb085c9eec729/LICENSE).
- **T3 — Set-CoreAudio-Sample-Rate, source as read25October2026:** [README](https://github.com/Bom-Shanka-Machines/Set-CoreAudio-Sample-Rate), [setter source](https://github.com/Bom-Shanka-Machines/Set-CoreAudio-Sample-Rate/blob/master/Source/set_coreaudio_sample_rate.swift).
- **T4 — t3code, source as read25October2026:** [small native-helper build script](https://github.com/pingdotgg/t3code/blob/main/apps/desktop/scripts/build-browser-secret.mjs).
- **N1 — Linux/ALSA:** [kernel6.18 procfile specification](https://github.com/torvalds/linux/blob/v6.18/Documentation/sound/designs/procfile.rst), [ALSA-lib1.2.14 PCM hw_params implementation/documentation](https://github.com/alsa-project/alsa-lib/blob/v1.2.14/src/pcm/pcm.c), [official hardware-parameter API](https://www.alsa-project.org/alsa-doc/alsa-lib/group___p_c_m___h_w___params.html).
- **N2 — PulseAudio:** [upstream latency-control guide](https://www.freedesktop.org/wiki/Software/PulseAudio/Documentation/Developer/Clients/LatencyControl/), [17.0 stream overrides](https://github.com/pulseaudio/pulseaudio/blob/v17.0/src/pulse/stream.c).
- **N3 — PipeWire rolling official docs:** [pw-top columns](https://docs.pipewire.org/page_man_pw-top_1.html), [graph settings](https://docs.pipewire.org/page_man_pipewire_conf_5.html), [node/device latency, rate, period properties](https://docs.pipewire.org/page_man_pipewire-props_7.html), [Pulse compatibility](https://docs.pipewire.org/page_man_pipewire-pulse_conf_5.html). These are documentation snapshots, not claims about installed server version/defaults.
- **N4 — Android/Oboe:** [AAudio guide](https://developer.android.com/ndk/guides/audio/aaudio/aaudio), [Oboe guide pinned4468344c8fdfdd7df068d5abefe2d8615fd6b431](https://github.com/google/oboe/blob/4468344c8fdfdd7df068d5abefe2d8615fd6b431/docs/FullGuide.md), [official low-latency recommendations](https://developer.android.com/games/sdk/oboe/low-latency-audio).
- **W1 — W3C Web Audio1.1:** [latencyHint](https://www.w3.org/TR/webaudio-1.1/#dom-audiocontextoptions-latencyhint), [baseLatency](https://www.w3.org/TR/webaudio-1.1/#dom-audiocontext-baselatency), [outputLatency](https://www.w3.org/TR/webaudio-1.1/#dom-audiocontext-outputlatency), [getOutputTimestamp](https://www.w3.org/TR/webaudio-1.1/#dom-audiocontext-getoutputtimestamp).
- **W2 — W3C Media Capture and Streams:** [constraints, settings and latency](https://www.w3.org/TR/mediacapture-streams/#def-constraint-latency).
- **W3 — W3C WebRTC Stats:** [inbound RTP jitter-buffer metrics](https://www.w3.org/TR/webrtc-stats/#dom-rtcinboundrtpstreamstats-jitterbufferdelay), [candidate-pair RTT](https://www.w3.org/TR/webrtc-stats/#dom-rtcicecandidatepairstats-currentroundtriptime).

- **P5 — PortAudio same current pin:** [capture example](https://github.com/PortAudio/portaudio/blob/1ca0eeedb678c3cca80f3306c474d69a7a4b5278/examples/paex_record.c), [suggested versus reported latency](https://github.com/PortAudio/portaudio/blob/1ca0eeedb678c3cca80f3306c474d69a7a4b5278/test/patest_suggested_vs_streaminfo_latency.c), [Mac stream-device/range APIs](https://github.com/PortAudio/portaudio/blob/1ca0eeedb678c3cca80f3306c474d69a7a4b5278/include/pa_mac_core.h).
- **Q1 — CPAL pin68f6f752b2941ab101e2d7d67fe3f1caa67d9eaf:** [configuration API](https://github.com/RustAudio/cpal/blob/68f6f752b2941ab101e2d7d67fe3f1caa67d9eaf/src/lib.rs#L360), [timestamp/xrun API](https://github.com/RustAudio/cpal/blob/68f6f752b2941ab101e2d7d67fe3f1caa67d9eaf/src/timestamp.rs), [CoreAudio input/format/buffer/readback](https://github.com/RustAudio/cpal/blob/68f6f752b2941ab101e2d7d67fe3f1caa67d9eaf/src/host/coreaudio/macos/device.rs#L535), [overload/device monitors](https://github.com/RustAudio/cpal/blob/68f6f752b2941ab101e2d7d67fe3f1caa67d9eaf/src/host/coreaudio/macos.rs#L195).
- **Q2 — CPAL same pin:** [capture example](https://github.com/RustAudio/cpal/blob/68f6f752b2941ab101e2d7d67fe3f1caa67d9eaf/examples/record_wav.rs), [version/toolchain manifest](https://github.com/RustAudio/cpal/blob/68f6f752b2941ab101e2d7d67fe3f1caa67d9eaf/Cargo.toml), [Apache-2.0 license](https://github.com/RustAudio/cpal/blob/68f6f752b2941ab101e2d7d67fe3f1caa67d9eaf/LICENSE).
- **M1 — miniaudio pin9634bedb5b5a2ca38c1ee7108a9358a4e233f14d:** [public capture callback/configuration](https://github.com/mackron/miniaudio/blob/9634bedb5b5a2ca38c1ee7108a9358a4e233f14d/miniaudio.h#L6860), [configuration field meanings](https://github.com/mackron/miniaudio/blob/9634bedb5b5a2ca38c1ee7108a9358a4e233f14d/miniaudio.h#L8687), [CoreAudio buffer setter/readback](https://github.com/mackron/miniaudio/blob/9634bedb5b5a2ca38c1ee7108a9358a4e233f14d/miniaudio.h#L34341), [CoreAudio capture callback](https://github.com/mackron/miniaudio/blob/9634bedb5b5a2ca38c1ee7108a9358a4e233f14d/miniaudio.h#L35171).
- **M2 — miniaudio same pin:** [capture example](https://github.com/mackron/miniaudio/blob/9634bedb5b5a2ca38c1ee7108a9358a4e233f14d/examples/simple_capture.c), [license alternatives](https://github.com/mackron/miniaudio/blob/9634bedb5b5a2ca38c1ee7108a9358a4e233f14d/LICENSE), [platform/build notes](https://github.com/mackron/miniaudio/blob/9634bedb5b5a2ca38c1ee7108a9358a4e233f14d/README.md).
- **R4 — RtAudio same pin:** [capture example](https://github.com/thestk/rtaudio/blob/06f97b633c06ea747d6478f0e87b6e1178104511/tests/record.cpp).
- **G1 — JackTrip pindf585b004da527bb434350645e81159bf1eb9be0:** [RtAudioInterface and its MIT notice](https://github.com/jacktrip/jacktrip/blob/df585b004da527bb434350645e81159bf1eb9be0/src/RtAudioInterface.cpp), [license/build boundaries](https://github.com/jacktrip/jacktrip/blob/df585b004da527bb434350645e81159bf1eb9be0/LICENSE.md), [project scope](https://github.com/jacktrip/jacktrip/blob/df585b004da527bb434350645e81159bf1eb9be0/README.md).
- **G2 — SonoBus pin35f1062dab196b9838a4bb529c4bf6592b7f5987:** [features, buffering guidance, JUCE6/AOO and licensing](https://github.com/sonosaurus/sonobus/blob/35f1062dab196b9838a4bb529c4bf6592b7f5987/README.md), [GPLv3 text](https://github.com/sonosaurus/sonobus/blob/35f1062dab196b9838a4bb529c4bf6592b7f5987/LICENSE).
- **G3 — Jamulus pin4c0dbf23a1ccd0a3624906064a2e03292ba77494:** [CoreAudio implementation and current source license](https://github.com/jamulussoftware/jamulus/blob/4c0dbf23a1ccd0a3624906064a2e03292ba77494/src/sound/coreaudio-mac/sound.cpp), [COPYING license transition](https://github.com/jamulussoftware/jamulus/blob/4c0dbf23a1ccd0a3624906064a2e03292ba77494/COPYING), [server/codec/platform scope](https://github.com/jamulussoftware/jamulus/blob/4c0dbf23a1ccd0a3624906064a2e03292ba77494/README.md).

Local evidence/code, **working-tree snapshots rather than upstream API sources**:

- **L1:** [current measurement record](audio-roundtrip-performance.md),
  [scope receipt](../.scratch/audio-roundtrip-sync/mac-host-swap-r1/buffer-setting-scope.json),
  [setter](../.scratch/audio-roundtrip-sync/mac-host-swap-r1/bufferctl.c),
  [held setter](../.scratch/audio-roundtrip-sync/mac-host-swap-r1/bufferctl-hold.c),
  [initial query](../.scratch/audio-roundtrip-sync/mac-host-swap-r1/bufferctl-build-query.json),
  [trial receipt](../.scratch/audio-roundtrip-sync/mac-host-swap-r5/remote-evidence/buffer-lease-r1.json),
  [native witness](../.scratch/audio-roundtrip-sync/mac-host-swap-r1/witness.c).
- **L2:** [Linux defaults research](audio-linux-defaults-research.md).
- **L3:** [capture packet/clock/normalization contract](../src/server/capture-audio.ts),
  [browser first-frame verification](../src/client/session/capture-audio.ts).
- **L4:** [capture authorization](../app/capture.ts),
  [Live ownership](../app/live-audio.ts), [packaging/usage description](../package.json).
