# Live audio lab without phones

This is an engineering lab for the [event plan](live-audio-event-plan.md), not a
phone-speaker certification. It records an identifiable source and independent
Electron receivers through a private PulseAudio/JACK graph. The graph source
passes through actual browser capture, Couch's production transport and renderer,
and each receiver's separate virtual output. Calibration uses separate JACK
clients with known sample delays, rather than browser timestamps or separately
started recordings.

The first implementation is Linux-only, mono, and bounded to 5–120 seconds per
run. It uses the repository's pinned Electron. No installed Couch data, ordinary
network interface, or owner's audio default is changed. Keep the generated
directory private: it contains throwaway browser profiles and pairing credentials.
Normal cleanup removes profiles and worker credential files. Forced namespace
termination can leave them in the private artifact directory, and the scratch
database retains lab credentials in either case. Share the evidence JSON, not
the whole artifact directory.

## Prerequisites and commands

Install the repository dependencies and build its production assets:

```sh
bun install --frozen-lockfile
bun run build
bun test tests/live-audio-pcm.test.ts tests/live-audio-evidence.test.ts
node --test tests/live-audio-worklet.test.ts
```

The Linux worker needs a C compiler, JACK2 (including its development headers and
example tools), PulseAudio with its JACK modules and utilities, and a display or
Xvfb. Debian package names are `build-essential`, `jackd2`,
`libjack-jackd2-dev`, `jack-example-tools`, `pulseaudio`, `pulseaudio-utils`,
`pulseaudio-module-jack`, `util-linux`, `iproute2`, and `xvfb`. Buffered playback
also needs a locally available FFmpeg, since lab namespaces have no internet route.
The runner does not install packages or reconfigure system audio. A private
unpacked Debian prefix can be selected with `COUCH_LAB_PREFIX=/path/to/root/usr`;
`COUCH_LAB_PULSE_MODULES` overrides the modules directory. Use
`COUCH_LAB_FFMPEG=/path/to/ffmpeg` to select a verified local executable for Core.

Use a new artifact directory for every run:

```sh
bun tests/live-audio.native.ts calibration /tmp/couch-audio-calibration
xvfb-run -a scripts/live-audio-network.sh run --profile control --clients 2 \
  --duration 120 --evidence /tmp/couch-network-control -- \
  bun tests/live-audio.native.ts direct /tmp/couch-audio-direct
xvfb-run -a bun tests/live-audio.native.ts sync /tmp/couch-audio-sync
xvfb-run -a bun tests/live-audio.native.ts ingress /tmp/couch-audio-ingress
```

`COUCH_LAB_SECONDS` defaults to 15, `COUCH_LAB_SEED` to 20261020, and
`COUCH_LAB_RECEIVERS` to 2. Calibration always uses three outputs with 20, 80
and 150 ms inserted delays. `COUCH_LAB_QUANTUM` selects 128, 256, 512 or 1024
frames at 48 kHz. Changing it changes the simulated output environment; record
it and recalibrate, rather than comparing unlike runs as an application fix.

The private Pulse daemon is explicitly configured for 48 kHz, matching JACK;
system defaults must not silently introduce a 44.1 kHz conversion. The publisher
has its own silent output sink so receiver startup does not share its sink.
`pulse-info.json` and the `pulse-{sinks,sources,sink-inputs,source-outputs}.json`
snapshots retain the actual private server and stream configuration.

`COUCH_LAB_SOURCE_BUFFER_FRAMES` and `COUCH_LAB_RECEIVER_BUFFER_FRAMES` optionally
request 128, 256, 512 or 1024 frames through Chromium's `audio-buffer-size`
switch. Both default to unset. Change source and receiver settings separately,
retain negotiated buffering and raw output measurements, and requalify the
source clock after changing its buffer. This is an Electron backend experiment,
not a setting available to a phone website. The pinned Chromium
[Pulse backend](https://github.com/chromium/chromium/blob/152.0.7977.130/media/audio/pulse/audio_manager_pulse.cc)
honors this switch for both input and output buffer requests.

For a bounded WebRTC buffering experiment, `COUCH_LAB_JITTER_MS=0` requests
`RTCRtpReceiver.jitterBufferTarget=0` in `direct` mode before the fixed startup
wait. The default leaves it unset. Results preserve the request/readback and
raw RTP counters; the browser can clamp this preference. Reading back zero is
not proof of zero buffering or a latency maximum. Compare a control run with
identical backend, quantum, duration and network settings.

The native entrypoint automatically enters the rootless wrapper in
`scripts/live-audio-lab.sh`. It needs Linux user/mount/IPC/PID namespaces and
mounts a fresh `/dev/shm` inside them. A unique JACK server name alone does not
isolate JACK's global shared-memory registry. The network wrapper supplies the
same private shared memory before creating its nodes; the native runner verifies
the `COUCH_LAB_IPC` metadata instead of nesting another PID namespace.
Namespace exit bounds detached descendants as well as ordinary children.
PulseAudio gets a task-owned cookie, explicit socket authentication, private
configuration/state paths and disabled client autospawn. `HOME` stays unchanged.
Standalone runs also get a private network namespace with only loopback enabled;
there is no route to the host network or internet. PulseAudio runs without
realtime/high-priority requests and with a nonexistent private system-bus socket,
so it cannot block on the owner's privilege broker. This scheduling environment
is part of the recorded lab setup, not a production audio recommendation.
Direct WebRTC requires the network wrapper even for an unimpaired `control`
run: the standalone namespace's loopback-only interface does not provide a
usable ICE host route. The native runner rejects that setup before audio starts.

`ingress` is a test-only timestamped PCM experiment using real browser capture,
Couch's paired identities and the official encrypted Sendspin renderer. It is
limited to two receivers. `COUCH_LAB_PACKET_MS=10|20` selects packet size;
`COUCH_LAB_LEAD_MS=40` sets the fixed source-to-presentation lead, and
`COUCH_LAB_OUTPUT_COMPENSATION=0` selects the explicit compensation alternative.
Defaults are 10 ms packets, 40 ms lead and official output compensation enabled.
These are configured timings, not measured end-to-end latency. See the
[prototype contract](../tests/audio-lab/ingress.md). Under the network wrapper,
ingress uses HTTPS/WSS with the scratch Core's certificate and database from the
manifest's server directory. Receivers connect to the shaped server address;
the publisher-to-ingress hop stays local in the server namespace. The fixture
requires the certificate to cover that address and rejects a different
certificate for the pinned hostname. It preserves exact page-origin admission.

The same `ingress` command works inside the network wrapper. `result.json`
retains receiver socket endpoints, per-receiver PCM bytes handed to the SDK,
and recorded output. Sender counters alone do not prove playback. Chromium
`AudioContext.playbackStats` observations come from the actual SDK context;
unsupported, frozen or incomplete counters remain inconclusive. A final drain
of at most 1.5 seconds may extend renderer counter coverage, retaining the
original end snapshot; it does not add PCM to the measured window.

Before publishing, ingress measures a fixed one-second render-clock envelope
every 5 ms, requiring at least 100 observations. Acquisition audio is discarded;
the mapping then freezes. Required uncertainty above 10 ms reports unsupported,
and a later bound violation stops publication. This is not a hardware capture
timestamp guarantee. Inspect `ingress-startup.json` when acquisition stops the
run before PCM measurement. The [recorded results](live-audio-results.md) include
both 10 ms and 20 ms attempts that stopped at this gate on the tested backend.

Use [the network wrapper](live-audio-network.md) for isolated, bidirectional
TCP/UDP impairment. Its control/N0/N1/N2 profiles are defined stress inputs;
they do not model Wi-Fi airtime. N3–N7 and sustained 50-listener qualification
remain separate work.

Production-path receivers in network namespaces use Core's HTTPS LAN listener.
The fixture pins only that scratch Core's certificate for its hostname. It does
not disable browser certificate validation globally. Origin, secure-context and
`crypto.subtle` diagnostics are retained. Certificate provisioning and audio
unlock on actual phones remain untested. Electron runs without its sandbox when
mapped to root in the disposable user namespace; this is recorded in results.

## What the results establish

`result.json` retains observed per-receiver marker latency and skew, missing or
repeated markers, fixed warmup, graph health and route diagnostics.
`markers.ndjson` preserves individual reference/output sample-frame matches in
new runs; older result distributions cannot reconstruct these observations.
`couch-evidence/1` reports apply the frozen 60 ms software and 5 ms alignment
contract. Unknown fields remain unknown. A process exit without errors is not
an audio acceptance pass; inspect the report's individual gates.

The raw latency runs from the graph source to the downstream graph output. It
includes the virtual capture pipeline. No guessed capture or output delay is
subtracted. The dedicated calibration verifies common-graph sample timing; it
does not separately measure the browser's capture delay or physical DAC latency.
Unmeasured calibration, worker headroom or renderer/dropout telemetry makes
full qualification inconclusive, even when some raw metrics are available.

Graph xruns and recorder overflow invalidate the run. Connection setup is
outside the measured signal interval and reported separately; all xruns from
the start of the test signal count. A fixed two-second signal warmup is declared
before ordinary playback runs. Missing markers after warmup are retained as
failures, never discarded latency samples. The graph also reports deviation
between its sample progression and JACK's monotonic time.

The native recorder uses a bounded ring buffer and streams PCM to analysis;
failure snippets are bounded. It keeps no full output recording. Source PCM is
bounded by the run duration. Markers and quiet tones verify identity and timing;
they do not establish speech/music fidelity, stereo channel mapping or
perceptual quality.

The activity checker conservatively flags energy outside matched marker spans.
On a lossy or uncalibrated path, codec/filter tails may cause such activity; it
makes quality inconclusive rather than proving replay. Identified repeated or
out-of-order markers still fail. No padding is inferred from a failed recording
and no latency is subtracted to compensate for codec spread.

Each receiver is a separate browser process and profile. This exercises real
decoding/rendering, but shares a computer and graph clock. It does not simulate
independent phone oscillators, power management, screen locking, mobile browser
autoplay policy, Bluetooth, physical speaker output or venue acoustics.

The runner grants capture in its private Electron session and invokes playback
with test gestures. That is not a permissions/consent UX compatibility test.
No new event option should be exposed on the strength of protocol sockets or
these short timing baselines alone.

## Protocol regression suite

Admission and signaling are tested separately from audio:

```sh
bun test tests/live-client.test.ts
bun build tests/live-admission.integration.ts --target=node \
  --outfile=build/live-admission.integration.mjs
node --test build/live-admission.integration.mjs
```

`COUCH_LIVE_STRETCH=1` enables the deliberately unqualified 100-peer reconnect
stress case. Pairing 100 identities and negotiating synthetic SDP in protocol
tests do not establish that 100 browsers render sound.

References: [JACK process callbacks][jack], [JACK dummy driver][dummy],
[PulseAudio JACK modules][pulse], and [Electron native test conventions](ci.md).

[jack]: https://jackaudio.org/api/group__ClientCallbacks.html
[dummy]: https://github.com/jackaudio/jack2/blob/develop/drivers/dummy/JackDummyDriver.cpp
[pulse]: https://www.freedesktop.org/wiki/Software/PulseAudio/Documentation/User/Modules/#module-jack-sink
