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
session. A peer whose messages throw closes alone; the shared worker continues.

## Pipeline

| Adapter | Input → output | Why Couch owns it |
|---|---|---|
| Acquisition | Selected device or system track → timestamped interleaved f32 PCM with format, generation and sample position | The browser SDK has no capture API. Main owns Live capture in an isolated hidden capture page. |
| Upload | f32 frames → validated `CaptureAudioPacket` in its source epoch | Node 0.6.2 has `sendSourceAudioChunk` but no public source stream start/end to declare a format. Publication tokens, epochs and helper leases retire stale work. |
| Conversion and encoding | f32 at the acquired rate/channels → 48 kHz stereo PCM16 and Opus packets | One FFmpeg process per source: `aresample`, stereo layout, `pcm_s16le` and `libopus` with the Ogg wrapper removed. Gaps up to 40 ms are filled with silence so sample positions hold. |
| Capture-time mapping | Encoded offset + generation + measured capture blocks → source time in Core microseconds | The Node SDK's default timestamp is send time; it cannot recover capture time. A short block lookup, including Opus pre-skip, keeps long shares on the input's clock. |
| Group scheduling | Source time + members + player timing → presentation timestamps per session | Public `getPlayerTiming`, `sendStreamStart`, `sendPcmAudioFrame`, group, metadata and volume APIs. The SDK session does not choose an application timeline. |

Core's audio worker (`build/audio-worker.mjs`) runs encoding and Sendspin
sessions off Core's main thread.

## Timing

A relaxed share keeps at least one second of lead. A Live share's lead is the
largest `min_buffer_ms` plus static output delay any member declares. It grows
at once when a member declares more, which moves later timestamps forward by
the difference. It never shrinks while the input keeps running, so listeners never
jump backwards or lose queued audio; a smaller buffer applies when sharing or the
input restarts (a new capture buffer restarts the input).
A listener leaving keeps the lead. There is no admission limit or slow-listener
eviction.

**Playback buffer (ms)** is one Couch-wide setting, 250 ms initially, set in the
Share dialog when Live is chosen and in the running share's panel. Core sends it
to each listener, which applies it with the SDK's `minBufferMs`/`setMinBufferMs`.
**Codec** (Automatic, PCM or Opus) uses the SDK's `codecs` option; a codec change
recreates that listener's player. Startup lead, correction and output buffering
keep SDK defaults. The buffer is a receiver request, not a measured
input-to-ear latency. 250 ms is the default because 150 ms had audible gaps on a
Wi-Fi phone in both measured runs, while 250 and 300 ms had none (below).

The sender produces 48 kHz stereo PCM16 and Opus only. A receiver supporting
only other formats gets an error on its row.

## Measured behavior

Electrical measurements, 27 October 2026: a Mac desktop host capturing a UMC404HD
native input (48 kHz, 128 frames), a Linux Chrome receiver on wired LAN and a
Redmi Note 8T Chrome receiver on Wi-Fi, both recorded on the UMC's own clock.
Content was 260 s of music, speech and piano with stereo-identity sections.

| Playback buffer | Runs | Reference-to-output delay | Gaps of 20 ms or more |
|---|---|---|---|
| 150 ms | 2 | 150.2 ms Linux, 150.6–151.1 ms Android | Android 10 and 47; Linux 0 and 5 |
| 250 ms | 1 | 250.2 ms both | none |
| 300 ms | 2 | 300.1–300.3 ms both | Android none; Linux 0 and 2 |

Median Android-minus-Linux skew was 0–0.9 ms, p95 at most 2.3 ms. Capture mute, Leave/Join,
host Remove, each listener's own volume and mute, and recovery 13 s after a
10 s Android Wi-Fi outage were confirmed on the electrical returns. These short
runs are not a long-stability, background-phone or audience-size qualification.
A Linux receiver whose PulseAudio stream died under host load kept reporting
playing in the SDK while silent; reloading the page recovered it.

## Checks

Build Core and its worker before Node integration checks, and use a fresh output
directory:

```sh
bun scripts/core.ts
bun build tests/sendspin-sdk.integration.ts tests/capture-continuity.integration.ts tests/audio-isolation.integration.ts tests/scheduled-capture.integration.ts tests/live-audience.integration.ts tests/live-delivery.integration.ts --target=node --outdir="$(mktemp -d)"
COUCH_TEST_FFMPEG=/path/to/ffmpeg node --test <that directory>/*.js
```

They use temporary databases, loopback ports and synthetic stereo signals with
opposite channel polarities. `sendspin-sdk.integration.ts` drives the stock
browser SDK core through Noise/AES-GCM, token binding, decoding, buffer changes,
reconnect, a concurrent Opus receiver and Leave. Capture checks cover input
formats, source generations, timestamp mapping and Opus pre-skip.
