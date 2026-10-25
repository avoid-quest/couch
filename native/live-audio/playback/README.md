# Native Live playback

Integration in progress; this helper is not yet selected by the desktop app.
The matching diagnostic controller passed the original electrical gate in
`linux-native-receiver-r10`. See [measurements](../../../docs/audio-roundtrip-performance.md).

The Pulse sink, gain ramp and recovery code are reused from the Apache-2.0
[Sendspin C++ CLI](https://github.com/Sendspin/sendspin-cpp-cli), commit
`7c7f5e015a894e62b1673f9debdc23b8800d0241`. `upstream-pins.json` records the original
files; `LICENSE` and original notices are retained. Couch adapts `pulse_sink.*`
for filtered variable-rate playback and bounded timing observations. The small
`adapter/sendspin/client.h` supplies only the sink's monotonic clock/log types;
the protocol remains owned by the Node Sendspin SDK, not this helper.

`playback.cpp` accepts `device buffer-ms duration-seconds`. Empty device means the
Pulse default. Duration 0 follows its parent's pipe lifetime; nonzero bounds are
for diagnostics. It carries only 48 kHz stereo PCM16. Hardware rate, daemon
configuration, device routing and hardware volume are not changed. Pulse must
report a Speex resampler; unsupported fallback fails explicitly.

Input uses a 16-byte little-endian header: signed 64-bit desired audible time in
Linux monotonic microseconds, unsigned 32-bit frame count, unsigned 32-bit packet
sequence, then interleaved PCM16. Sequence begins at zero and cannot skip; queue,
write waits, timing age and clock corrections are bounded. With zero frames,
sequence is a control opcode: 0 stop, 1 stream volume (time field 0..100), or
2 stream mute (time field 0/1). These controls do not change the PCM sequence.
No network credential enters this process. EOF ends output.

The first packet is aligned to its preserved deadline with initial silence.
Subsequent PCM is written once in order; filtered resampling follows a bounded
phase/rate controller without frame insertion/deletion or deadline changes.
Automatic correction uses current queue indices and timing age, not Pulse's
smoothed cumulative-time estimate, which failed during rate updates.

`clock-servo-test.cpp` simulates independent positive/negative clocks, changing
drift, noisy observations, bounds/slew and rejected timing discontinuities.
These tests do not establish physical fidelity. The existing raw diagnostic
experiments and their failures remain frozen outside this maintained directory.

On the target Linux architecture, `bun scripts/build-live-playback.ts` uses a
C++20 compiler and `pkg-config libpulse` to produce `build/live-audio/couch-playback`,
its license and source/executable receipt. This standalone build does not start
Pulse or change system settings. The Linux `afterPack` hook includes these files.
`app/native-playback.ts` owns one helper, maps the SDK's monotonic deadline epoch,
validates readiness/PCM acknowledgements, bounds its pipe, and supports volume,
mute and cancellation. `app/native-audio-output.ts` owns the Node SDK session;
`app/live-output.ts` binds it to the current main frame, origin, SPKI trust and
receiver token. Browser identity is explicitly handed to Main, never to the
helper. Native selection is limited to audio-only Live; browser remains default.
The desktop integration still needs its own packaged physical qualification.
