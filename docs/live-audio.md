# Live audio over Sendspin

[Live audio](../GLOSSARY.md) and relaxed scheduled sound use the unmodified
official SDKs: `@sendspin/sendspin-js` 5.0.0 in browsers and
`@sonn-audio/node-sendspin` 0.6.2 in Core. Couch supplies capture, encoding,
presentation timestamps, group membership and authorization; the SDKs own the
connection, Noise encryption, clock synchronization, decoding, receiver
buffering, correction and reconnection. The [capability
contract](audio-video-use-cases.md) defines what each playback behavior allows;
user-facing behavior is in [Share](design/share.md#live-audio).

## Connection and identity

Browsers connect with the SDK's Noise encryption (`client/init`). Core also accepts
the Node SDK's plaintext `client/hello`, behind the same token check. Couch selects the public
`suite: "aesgcm"` option because Electron's BoringSSL has no ChaCha20-Poly1305.
Core keeps its SDK identity in the `sendspin_identity` table and passes it, with
the standard `SENTINEL_RESOLVED` PSK, to each public `SendspinSession`.

A browser's Device ID is the SDK client ID from
`loadSendspinClientIdentity(storage)`; the control connection and
`SendspinPlayer` share that identity and storage. An existing Couch token rebinds
a changed ID through `identify`, keeping pairing and permissions while retiring
the paired device's old connections, audio transports, publications and outputs;
trusted host windows keep their existing behavior. Pairing the
same ID again retires work authorized with its replaced token.

An authenticated `POST /api/audio/session` sets an HttpOnly, SameSite Strict
cookie for `/sendspin` (Secure on HTTPS), so the SDK's URL carries no token.
Non-browser SDK clients can use the token-bearing `/api/audio/<token>/sendspin`
base path. The upgrade binds the authenticated Device to `client/init.client_id`,
checks host, origin and remote-control permission, and revocation closes the
authenticated transport even during the Noise handshake. A peer whose messages
throw closes alone; the shared worker continues. Turning off network sharing
also closes paired audio transports. An audio handshake must identify within ten
seconds.

## Pipeline

| Adapter | Input → output | Why Couch owns it |
|---|---|---|
| Acquisition | Selected device or system track → timestamped interleaved f32 PCM with format, generation and sample position | The browser SDK has no capture API. Main owns Live capture: the Mac native helper for **Native** inputs, an isolated hidden capture page for other input IDs. |
| Upload | f32 frames → validated `CaptureAudioPacket` in its source epoch | Node 0.6.2 has `sendSourceAudioChunk` but no public source stream start/end to declare a format. Publication tokens, epochs and helper leases retire stale work. |
| Conversion and encoding | f32 at the acquired rate/channels → 48 kHz stereo PCM16 and Opus packets | One FFmpeg process per source: `aresample` (64-tap filter), stereo layout, `pcm_s16le` and `libopus` (low-delay mode, 160 kbps stereo VBR, 5 ms frames) with the Ogg wrapper removed. FFmpeg reads 5 ms of capture at a time and PCM leaves in 5 ms chunks, because each step holds audio until it is full. Core sends each chunk to listeners as it arrives. Gaps up to 40 ms are filled with silence so sample positions hold. |
| Capture-time mapping | Encoded offset + generation + measured capture blocks → source time in Core microseconds | The Node SDK's default timestamp is send time; it cannot recover capture time. A short block lookup, including Opus pre-skip, keeps long shares on the input's clock. |
| Group scheduling | Source time + members + player timing → presentation timestamps per session | Public `getPlayerTiming`, `sendStreamStart`, `sendPcmAudioFrame`, group, metadata and volume APIs. The SDK session does not choose an application timeline. |

Core's audio worker (`build/audio-worker.mjs`) runs encoding and Sendspin
sessions off Core's main thread.
An upload rejected by ingest or silent for five seconds fails its source:
encoding stops, its listeners' streams end, and the error stays visible until
sharing ends or restarts. Other sources continue.

## Shared metadata

Core assigns each publication `startedAt` (Unix milliseconds) and keeps optional
`metadata: { title, description }` on its `LiveSource`. The capturing connection
alone can patch those details; bounded single-line strings are trimmed, and an
empty field clears it. These are runtime publication details, retained across
capture generations and listener reconnects, and discarded when sharing ends.
Couch state projects the title/line into discovery and playback presentation.
The UI's isolated one-second clock measures elapsed time from `startedAt` on
Core's clock: Core sends its time when each connection opens, and the client
keeps the offset, so a device with a wrong clock still shows the right time.

Core also sends the same details with the Node SDK's public `sendMetadata()` to
the Source's Sendspin group members, on join, edits and reconnection. The title
maps to `title` (falling back to the device/input name); the line maps to `artist`,
the protocol's secondary display field. `progress` carries elapsed publication
milliseconds, duration 0 (unlimited) and speed 1000. Edits retain the original
clock and never restart capture or audio. Leaving/ending clears the metadata.

The [Sendspin metadata specification](https://www.sendspin-audio.com/spec/#metadata-messages)
and [browser SDK's public state callback](https://github.com/sendspin/sendspin-js#example)
support these fields; neither exposes a generic description or publication-start
field. This mapping benefits any Sendspin metadata player without custom wire
extensions or SDK changes. Couch retains its own descriptive metadata object
for future fields, and its Media Session owner reads the same Couch state for
OS title/artist display; elapsed time does not become a seek bar. No Snapcast
integration is added.

## Timing

A relaxed share keeps at least one second of lead. A Live share's lead is the
largest `min_buffer_ms` plus static output delay any member declares. It grows
at once when a member declares more, which moves later timestamps forward by
the difference. It never shrinks while the input keeps running, so listeners never
jump backwards or lose queued audio; lower declarations apply when sharing or
the input restarts (a new capture buffer restarts the input).
A listener leaving keeps the lead. There is no admission limit or slow-listener
eviction: a listener whose connection stops draining (a frozen tab, a dozing
radio) gets nothing more until it drains, then resumes at audio that can still play.
Its incoming requests wait in order meanwhile.

**Playback buffer floor (ms)** is one Couch-wide setting, 150 ms initially, set in
the Share dialog and the running share's panel; 0 removes the host floor. Each
Receiver declares `ceil(max(previous declaration, host floor, output latency +
35 ms) / 5) * 5`, capped at Core's existing 5000 ms declaration limit, through
the SDK's public `minBufferMs`/`setMinBufferMs`. Until a reading is available it
declares the floor, rounded up. Once per second while connected, playing and
clock-synchronized, it reads the public `syncInfo.outputLatencyMs`. Invalid
readings leave the previous declaration and floor intact. The SDK's reading can
include platform estimates; it is not an acoustic measurement. A 27 ms output still
declares 150 ms at the default floor; a 118 ms output declares 155 ms. With a zero
floor, 27/42 ms outputs declare 65/80 ms. These are scheduling requests, not
measured input-to-ear latency or continuity guarantees.

The **35 ms allowance is fixed**, not measured jitter. SDK 5.0.0's public
`SendspinPlayer` has no arrival/queue statistics or late/dropped chunk counters.
`syncInfo` exposes output latency, sync error and resync count; `timeSyncInfo`
exposes clock synchronization and uncertainty, not audio arrival jitter.
Neither clock error nor resyncs identify starvation. There is no starvation
feedback in this version: that needs public player statistics upstream. Couch
does not access SDK internals, intercept its transport or parse console logs.
The allowance needs rig validation, especially on weak Wi-Fi and sleeping phones;
the host floor remains available for those conditions.

Declarations never decrease during a Join, including a codec change or SDK
reconnect. Leave/Join or a new Source starts a fresh declaration; the shared lead
still retains its high-water mark until sharing or the input restarts. An input
restart resets Core's lead to the current declarations, but does not reset the
browser's declaration: the public player does not expose input generations.
Restart sharing to apply a reduced host floor to all Receivers. The host panel
shows the actual shared lead, including static delay, and the Receiver that set
it; attribution remains after that Receiver leaves.

**Codec** (Automatic, PCM or Opus) uses the SDK's `codecs` option; a codec change
recreates that listener's player. SDK correction and buffering options keep their
defaults. Live ignores the SDK's declared startup lead (`requiredLeadTimeMs`): a
joining listener takes the group's running lead, and its SDK may skip the first
chunks while it starts. The buffer is a receiver request, not a measured
input-to-ear latency. See the bounded measurements and coverage below.

Desktop listeners on macOS request Chromium's
[`audio-buffer-size=128`](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/media/base/media_switches.cc#52)
before Electron is ready (128 frames, about 2.7 ms at 48 kHz). Linux keeps
Chromium's default until it is measured there, since the switch also affects
ordinary playback; Windows keeps its device-selected period because
[WASAPI warns that mismatched sizes can glitch](https://chromium.googlesource.com/chromium/src/+/152.0.7977.130/media/audio/win/audio_low_latency_output_win.cc#296).
This app-wide request also affects relaxed browser audio and some browser capture
paths, trades more frequent callbacks for less buffering, and leaves actual output
latency and stability dependent on the device, audio server and load.

Mac native inputs with more than two channels expose **Input channels** beside
**Capture buffer**, both before and during sharing. The host chooses an adjacent
stereo pair (1/2, 3/4, …) or one channel as mono, remembered on this desktop.
Inputs with two or fewer channels retain their existing behavior. Main and the
helper validate the map against the selected device; PortAudio's public
`PaMacCore_SetupChannelMap` selects only those inputs. The helper reports its
zero-based map, which Main checks before accepting PCM. Mono stays one channel
through capture and Core converts it to the existing stereo receiver format.
A channel change, like a capture-buffer change, replaces the helper and upload
generation while retaining mute. An unavailable selection fails with a request
to refresh inputs and choose again; it never substitutes another input.

The sender produces 48 kHz stereo PCM16 and Opus only. A receiver supporting
only other formats gets an error on its row.

## Measured behavior

Electrical measurements, 27–28 October 2026: a Mac desktop host capturing a
UMC404HD native input at 48 kHz, a Linux Chrome receiver on wired LAN and a
Redmi Note 8T Chrome receiver on Wi-Fi, recorded on the UMC's own clock. The
later runs tabulated below used 128-frame capture; earlier settings varied.
The buffer is a scheduling setting, not a physical latency guarantee. In the
110 ms run, Linux delay median/p95 was 110.32/111.04 ms and Redmi was
112.17/112.89 ms. These timing estimates describe matched half-second windows;
successful timing matches do not establish continuity between them.

Separate Core instrumentation measured capture-to-encoded-chunk p50 around
18 ms for Opus and 11 ms for PCM (54 and 27 ms before 5 ms encoding steps).
The electrical recordings do not isolate network, decoding, scheduling and
browser output costs into a further fixed delay budget.

Offline reprocessing covers all 126 retained recordings; the full table, method
and validation stay with the field evidence, outside this repository.
The old absolute −40 dBFS cutoff scored only 13.62 s of the Redmi's twelve
“one-hour” recordings. Its zero count did not mean an hour without gaps.

Below, each receiver cell is **attenuation candidates; scored seconds (% of the
entire recording)**. Coverage estimates where a 20 ms interruption is detectable
above that receiver's measured noise floor. Unscored time remains unknown.

| Condition (recorded duration) | Linux, wired | Redmi, Wi-Fi, L−R return |
|---|---|---|
| 200 ms, twelve separate captures (3,589.7 s) | 3; 339.3 s (9.45%) | 113; 3,397.7 s (94.65%) |
| 180 ms, screen on (299.2 s) | 0; 57.7 s (19.29%) | 0; 283.9 s (94.89%) |
| 150 ms, screen on (299.1 s) | 0; 11.5 s (3.84%) | 0; 283.8 s (94.88%) |
| 120 ms, screen on (299.1 s) | 0; 5.3 s (1.78%) | 14; 283.9 s (94.90%) |
| 110 ms (91.0 s) | 0; 0.22 s (0.24%) | 61; 86.2 s (94.70%) |
| 100 ms (91.0 s) | 0; 0.61 s (0.67%) | 98; 86.2 s (94.70%) |
| 90 ms (91.0 s) | 0; 0.84 s (0.93%) | 107; 86.2 s (94.68%) |
| 150 ms, 85 s forced Doze, screen on (299.1 s) | 0; 80.5 s (26.91%) | 1; 284.4 s (95.08%) |
| 200 ms, 10 extra SDK listeners, one frozen 60 s (299.1 s) | 0; 80.3 s (26.83%) | 0; 284.4 s (95.06%) |

The detector compares a locally aligned, level-matched source envelope with each
return: a 10 dB deficit across sixteen overlapping 4 ms windows (19 ms support),
with expected signal at least 14 dB above measured noise. On covered positions,
synthetic 20 ms silence/−20 dB dips were detected in 98.1–100% of trials;
10 ms edits occasionally triggered (0.11–0.16%). Counts are electrical
attenuation candidates, not sample-exact gap durations, audible stereo gaps or
identified transport faults. Redmi mono output cancels in this L−R wiring and
cannot receive a continuity verdict. Linux's noisy return sharply limits coverage.

A separate Linux silent-output incident retained the SDK's playing state until
page reload; this does not establish the cause of every attenuation. The frozen
headless listener's telemetry reported about 6 s of stale timestamps on waking,
against 60 s before Core stopped queueing for it; it was not an electrical return.

Resampling 44.1 kHz inputs with a 64-tap filter instead of FFmpeg's default 32
puts images 92 dB down instead of 25 dB, with ripple under 0.001 dB, for 0.35 ms
more delay; 48 kHz inputs are not resampled. PCM is not dithered: on quiet piano
dither scored worse.

Opus runs at 160 kbps instead of FFmpeg's implicit 96. On ViSQOL v3.1.0 (audio
mode, nine music excerpts with transients, wide stereo and quiet piano), mean
scores were:

| Frames | 96 kbps | 128 kbps | 160 kbps | Packets/s |
|---|---|---|---|---|
| 2.5 ms | 4.293 | 4.433 | 4.514 | 400 |
| 5 ms | 4.336 | 4.519 | 4.635 | 200 |
| 10 ms | 4.422 | 4.569 | 4.676 | 100 |

Most of the gain is bitrate; 10 ms frames would add about 10 ms in Core for
0.04 more. Opus payload averages about 173 kbit/s per listener instead of 105.
The scores are a codec proxy, not a listening test.

Owner listening on 28 October also found trouble with a screen-off Pixel
(GrapheneOS, Vanadium). The Pixel was not electrically recorded:

| Buffer / condition | Pixel owner report | Linux candidates; coverage | Redmi candidates; coverage |
|---|---|---|---|
| 150 ms, Pixel screen off | no clear artifacts heard | 0; 25.2 s (8.44%) | 28; 284.0 s (94.93%) |
| 120 ms, both phones screen off | struggled / dropouts | 0; 30.8 s (10.31%) | 117; 283.5 s (94.76%) |
| 120 ms, Pixel JIT/reload changed during run | dropouts remained after reload | 0; 21.9 s (7.32%) | 39; 283.3 s (94.70%) |

The selected 150 ms default remains configurable; the bounded Pixel listening
report does not qualify continuity across phones. The JIT comparison was
confounded by a reload during recording and does not establish a causal
improvement. PCM uses about 1.5 Mbit/s per listener; the owner reported Pixel
starvation with PCM where Opus played.

Android-minus-Linux skew median/p95 was 1.69/2.61 ms in the 110 ms run;
per-run estimates and matched-window counts are in the field evidence. Lifecycle
recordings retain post-action evidence for mute, volume, Leave/Join, host Remove
and Wi-Fi recovery, with their individual coverage listed in the field evidence. They do not
provide continuous coverage through those actions or an audience-size qualification.

## Checks

Build Core and its worker before Node integration checks, and use a fresh output
directory:

```sh
bun scripts/core.ts
bun build tests/sendspin-sdk.integration.ts tests/capture-continuity.integration.ts tests/audio-isolation.integration.ts tests/audio-authorization.integration.ts tests/scheduled-capture.integration.ts tests/live-audience.integration.ts tests/live-delivery.integration.ts tests/live-lifecycle.integration.ts --target=node --outdir="$(mktemp -d)"
COUCH_TEST_FFMPEG=/path/to/ffmpeg node --test <that directory>/*.js
```

They use temporary databases, loopback ports and synthetic stereo signals with
opposite channel polarities. `audio-isolation.integration.ts` covers a malformed peer and a listener that stops reading. `audio-authorization.integration.ts` covers cookie and upgrade boundaries, revocation, re-pairing, identity changes and handshake deadlines. `sendspin-sdk.integration.ts` drives the stock
browser SDK core through Noise/AES-GCM, token binding, decoding, buffer changes,
reconnect, a concurrent Opus receiver and Leave. Capture checks cover input
formats, source generations, timestamp mapping and Opus pre-skip.
`live-audience.integration.ts` also verifies host metadata through Couch state
and the stock browser SDK, edits without stream restarts, late discovery,
reconnect, clearing, Leave and a fresh publication clock.

`live-lifecycle.integration.ts` verifies that different Receiver declarations
produce identical samples and timestamps at one shared maximum lead (including
static delay), with host attribution retained after the limiting Receiver leaves.
It also covers input changes during playback, same-identity
takeover, PCM ↔ Opus switches, Stop during Join, buffer changes across restarts,
concurrent shares, publisher crash, rejected and stalled uploads, and Core restart
(which ends runtime-only shares and Joins; the SDK reconnects).

`tests/live-audio.bench.ts` measures Core's capture-to-send delay and worker CPU
with 1, 10 and 50 listeners per codec:

```sh
bun build tests/live-audio.bench.ts --target=node --outfile=/tmp/couch-live-bench.mjs
COUCH_TEST_FFMPEG=/path/to/ffmpeg node /tmp/couch-live-bench.mjs
```

On 28 October (shared host, `nice -n 19`), 50 listeners used 260 ms of worker CPU
per second for PCM and 272 ms for Opus, with delay p50 about 11 and 19 ms. Socket
writes inside the SDK are the largest cost.
