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
a changed ID through `identify`, keeping pairing and permissions.

An authenticated `POST /api/audio/session` sets an HttpOnly, SameSite Strict
cookie for `/sendspin` (Secure on HTTPS), so the SDK's URL carries no token.
Non-browser SDK clients can use the token-bearing `/api/audio/<token>/sendspin`
base path. The upgrade binds the authenticated Device to `client/init.client_id`,
checks host, origin and remote-control permission, and revocation closes the
authenticated transport even during the Noise handshake. A peer whose messages
throw closes alone; the shared worker continues.

## Pipeline

| Adapter | Input → output | Why Couch owns it |
|---|---|---|
| Acquisition | Selected device or system track → timestamped interleaved f32 PCM with format, generation and sample position | The browser SDK has no capture API. Main owns Live capture in an isolated hidden capture page. |
| Upload | f32 frames → validated `CaptureAudioPacket` in its source epoch | Node 0.6.2 has `sendSourceAudioChunk` but no public source stream start/end to declare a format. Publication tokens, epochs and helper leases retire stale work. |
| Conversion and encoding | f32 at the acquired rate/channels → 48 kHz stereo PCM16 and Opus packets | One FFmpeg process per source: `aresample` (64-tap filter), stereo layout, `pcm_s16le` and `libopus` (low-delay mode, 160 kbps stereo VBR, 5 ms frames) with the Ogg wrapper removed. FFmpeg reads 5 ms of capture at a time and PCM leaves in 5 ms chunks, because each step holds audio until it is full. Core sends each chunk to listeners as it arrives. Gaps up to 40 ms are filled with silence so sample positions hold. |
| Capture-time mapping | Encoded offset + generation + measured capture blocks → source time in Core microseconds | The Node SDK's default timestamp is send time; it cannot recover capture time. A short block lookup, including Opus pre-skip, keeps long shares on the input's clock. |
| Group scheduling | Source time + members + player timing → presentation timestamps per session | Public `getPlayerTiming`, `sendStreamStart`, `sendPcmAudioFrame`, group, metadata and volume APIs. The SDK session does not choose an application timeline. |

Core's audio worker (`build/audio-worker.mjs`) runs encoding and Sendspin
sessions off Core's main thread.
An upload rejected by ingest or silent for five seconds fails its source:
encoding stops, its listeners' streams end, and the error stays visible until
sharing ends or restarts. Other sources continue.

## Timing

A relaxed share keeps at least one second of lead. A Live share's lead is the
largest `min_buffer_ms` plus static output delay any member declares. It grows
at once when a member declares more, which moves later timestamps forward by
the difference. It never shrinks while the input keeps running, so listeners never
jump backwards or lose queued audio; a smaller buffer applies when sharing or the
input restarts (a new capture buffer restarts the input).
A listener leaving keeps the lead. There is no admission limit or slow-listener
eviction: a listener whose connection stops draining (a frozen tab, a dozing
radio) gets nothing more until it drains, then resumes at audio that can still play.

**Playback buffer (ms)** is one Couch-wide setting, 200 ms initially, set in the
Share dialog when Live is chosen and in the running share's panel. Core sends it
to each listener, which applies it with the SDK's `minBufferMs`/`setMinBufferMs`.
**Codec** (Automatic, PCM or Opus) uses the SDK's `codecs` option; a codec change
recreates that listener's player. Correction and output buffering keep SDK
defaults. Live ignores the SDK's declared startup lead (`requiredLeadTimeMs`): a
joining listener takes the group's running lead, and its SDK may skip the first
chunks while it starts. The buffer is a receiver request, not a measured
input-to-ear latency. See the measurements below for each receiver's floor.

The sender produces 48 kHz stereo PCM16 and Opus only. A receiver supporting
only other formats gets an error on its row.

## Measured behavior

Electrical measurements, 27–28 October 2026: a Mac desktop host capturing a
UMC404HD native input (48 kHz, 128 frames), a Linux Chrome receiver on wired LAN
and a Redmi Note 8T Chrome receiver on Wi-Fi, recorded on the UMC's own clock.
Measured delay was within about 1 ms of the playback buffer in every run, so the
buffer is the delay; what limits it is the time audio needs to reach each player
in time.

That time has two parts. Core holds a captured sample until its encoded chunk is
ready: about 18 ms for Opus and 11 ms for PCM (p50, timed in Core; 54 and 27 ms
before the encoding steps shrank to 5 ms). The receiver side (network, SDK
decoding and scheduling, and the browser's output path, which the SDK reports as
about 43 ms on the Linux receiver) needs roughly another 65 ms.

| Condition | Linux, wired | Redmi, Wi-Fi |
|---|---|---|
| One hour at 200 ms (12 × 5 min) | 2 gaps (30, 50 ms); delay within 0.2 ms | no gaps; delay within 0.2 ms |
| 5 min at 180, 150 and 120 ms | no gaps | no gaps |
| 90 s at 110, 100 and 90 ms | no gaps | no gaps |
| 5 min at 150 ms, 85 s forced Doze, screen on | no gaps | no gaps |
| 5 min, 10 extra SDK listeners, one frozen 60 s | no gaps | no gaps |

A gap is a return more than 20 dB below the delayed source for 20 ms or more.
The Linux gaps came from that host's audio output under load; a Linux receiver
whose PulseAudio stream died kept reporting playing in the SDK while silent, and
reloading the page recovered it. The frozen listener received 6 s of stale audio
from transport buffers on waking, against 60 s before Core stopped queueing for
it.

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

The limit is phones going to sleep. Before the encoding steps shrank, a Pixel
whose screen turned off at 120 ms played heavy artifacts, and at 250 ms a Redmi
had short gaps (≤ 90 ms) as its screen switched off and on. At 200 ms the owner
heard no artifacts on a MacBook and a Pixel on Wi-Fi with the Pixel's screen off
and on. The default stays 200 ms until a locked phone passes at 150 ms. PCM uses
about 1.5 Mbit/s per listener; over this Wi-Fi it starved a Pixel that played
Opus without trouble.

Median Android-minus-Linux skew was 0–0.9 ms, p95 at most 2.3 ms. Capture mute,
Leave/Join, host Remove, each listener's own volume and mute, and recovery 13 s
after a 10 s Android Wi-Fi outage were confirmed on the electrical returns. These
runs are not an audience-size qualification.

## Checks

Build Core and its worker before Node integration checks, and use a fresh output
directory:

```sh
bun scripts/core.ts
bun build tests/sendspin-sdk.integration.ts tests/capture-continuity.integration.ts tests/audio-isolation.integration.ts tests/scheduled-capture.integration.ts tests/live-audience.integration.ts tests/live-delivery.integration.ts tests/live-lifecycle.integration.ts --target=node --outdir="$(mktemp -d)"
COUCH_TEST_FFMPEG=/path/to/ffmpeg node --test <that directory>/*.js
```

They use temporary databases, loopback ports and synthetic stereo signals with
opposite channel polarities. `audio-isolation.integration.ts` covers a malformed peer and a listener that stops reading. `sendspin-sdk.integration.ts` drives the stock
browser SDK core through Noise/AES-GCM, token binding, decoding, buffer changes,
reconnect, a concurrent Opus receiver and Leave. Capture checks cover input
formats, source generations, timestamp mapping and Opus pre-skip.

`live-lifecycle.integration.ts` covers input changes during playback, same-identity
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
