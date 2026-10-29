# Native host audio capture

Mac Live audio inputs marked Native use `capture.c` through Main's
`app/live-audio.ts` and `native-audio-input.ts`. Main obtains the current local
owner's microphone grant before starting a child and validates every upload's
local origin, owner token, publication, key and upload generation. The helper
receives no credentials and performs no networking. Cancel, navigation, renderer
loss, Close and quit stop the owned producer; a replacement waits for retirement.

PortAudio's CoreAudio backend opens an input selected by its UID and exact name.
Inputs with more than two channels can capture an adjacent stereo pair or one
channel as mono; other devices retain their existing stereo behavior. Main and
the helper validate the selection against the device. `PaMacCore_SetupStreamInfo`
then `PaMacCore_SetupChannelMap` maps only the chosen channels, before
`Pa_OpenStream`; the callback receives one or two channels, not the whole device.
The `ready` event reports the zero-based `channelMap`, verified by Main before
upload. CLI `--channels 3,4` selects pair 3/4; `--channels 2` selects channel 2
as mono; omission keeps 1/2. The map storage lives until stream closure.
Ambiguous names or a mismatching opened UID fail. Automatic retains
the current 44.1/48 kHz device rate. An explicit rate request checks supported
rates/writability and waits for notification/readback; it may affect other apps
using the device. No system default device changes. Callback requests of
128/256/512/1024 frames (Couch requests 128; 256 when unspecified), delivered blocks and same-process HAL
buffer readback are distinct facts. Share shows requested and reported sizes;
neither is presented as the raw hardware callback period.

The callback copies mono or stereo float32 and PortAudio's ADC-time estimate into 256
preallocated SPSC slots (about 0.7 s at 128 frames), and stdout's socket buffer
holds about another 2.6 s, so a briefly busy Mac or desktop window delays audio
instead of ending the share. It performs no allocation, I/O, lock or wait. Overflow,
driver xruns, invalid input and duplicate/backward time fail explicitly. Timing
spacing variations retain their original timestamps and diagnostic counts rather
than being relabeled as lost samples. stdout carries the existing 40-byte Couch
PCM header plus samples; stderr carries bounded JSON status. stdin accepts
`clock <nonce>`, `start` and `stop`; owner pipe closure also ends capture.

`app/native-capture.ts` bounds pipe parsing and socket queues, validates sequence
and sample position, and maps the helper clock to Core using the minimum of five
bracketed clock exchanges. Each replacement upload starts a fresh generation at
sample zero. Explicit mute writes zero samples without changing the clock.
Core converts either input format to stereo PCM16 and 5 ms/160 kbps Opus for
the Sendspin receivers. Changing channels or capture buffer retires the old
helper and begins a new generation while retaining input mute. See
[Live audio](../../docs/live-audio.md) for timing and measured limits.

Other desktop inputs use the retained hidden browser capture producer:
`src/client/capture-audio.html` → `session/native-audio.ts`. Its preload exposes
only capture commands/events, and its exact frame receives a temporary microphone
grant. This is an explicit input choice, including on Linux/Windows; a failing
native input never silently changes devices. Browser capture probes real frames,
requires stereo for Live and verifies explicit rate requests. Ordinary Audio input,
WebRTC/TURN and buffered captured video retain their existing adapters. Audience
playback uses browser APIs; there is no native audience helper or output setting.

## Build and checks

`scripts/build-live-audio.ts` verifies the upstream PortAudio archive at commit
`1ca0eeedb678c3cca80f3306c474d69a7a4b5278`, SHA-256
`2602de95236428dcf1329e66f1adb1b603b12d16f8d368e11f909a84ba1ccd83`.
CMake builds static PortAudio per target; clang builds the helper with matching
arm64/x86_64 architecture and macOS 13 deployment target. Apple Silicon's app
floor stays 14. The builder verifies library/helper slices, deployment, system-only
dynamic dependencies, native-architecture discovery and ad-hoc signature before
`afterPack` stages the helper, PortAudio license, notice and build receipt.
Package verifies signatures again after app signing. Build logs remain in
`.artifacts/portaudio`; receipt binary hashes describe the pre-app-signing helper.
Linux/Windows skip this build. See [CI](../../docs/ci.md#bundled-mac-capture-input).

The implementation follows [PortAudio's CoreAudio API](https://www.portaudio.com/docs/v19-doxydocs/pa__mac__core_8h.html),
[its pinned CMake build](https://github.com/PortAudio/portaudio/blob/1ca0eeedb678c3cca80f3306c474d69a7a4b5278/CMakeLists.txt),
[Apple's device properties](https://developer.apple.com/documentation/coreaudio/kaudiodevicepropertybufferframesize)
and [t3code's target-resource staging](https://github.com/pingdotgg/t3code/blob/main/scripts/build-desktop-artifact.ts).

C queue tests cover mono/stereo samples and frame positions, wrap, bounded
overflow, driver xruns and invalid input. Node integrations cover real Core ingest/Hub authorization,
Origin, revoked publications, split/coalesced pipe reads, native clock mapping,
ordered generations, mono ingest, channel/buffer restarts, map mismatch, mute and
cancellation. Authority tests reject unavailable/malformed maps before permission
or restart and cover exact hidden-frame grants. These fixtures do not prove device
capture, microphone permission attribution in the signed package, Intel Ventura
runtime, 44.1 kHz hardware changes or physical browser-output fidelity. Historical
native-audience experiments remain recovery evidence, not current support claims.
