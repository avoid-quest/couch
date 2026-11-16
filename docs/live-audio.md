# Live audio over Sendspin

[Live audio](../GLOSSARY.md) and relaxed scheduled sound use the unmodified
official SDKs: `@sendspin/sendspin-js` in browsers and
`@sonn-audio/node-sendspin` in Core. Couch supplies capture, encoding,
presentation timestamps, group membership and authorization; the SDKs own the
connection, Noise encryption, clock sync, decoding, buffering, correction and
reconnection. Don't reach into SDK internals, intercept its transport or parse
its logs. What people do with it is in
[The gig in your ears](stories/the-gig-in-your-ears.md).

## Connection and identity

- Browsers connect with Noise (`client/init`); Core also accepts the Node SDK's
  plaintext `client/hello` behind the same token check. Couch selects
  `suite: "aesgcm"` because Electron's BoringSSL has no ChaCha20-Poly1305.
- A browser's Device ID is the SDK client ID (`loadSendspinClientIdentity`); the
  control connection and `SendspinPlayer` share it. Core keeps its own identity
  in the `sendspin_identity` table.
- `POST /api/audio/session` sets an HttpOnly, SameSite Strict cookie for
  `/sendspin`, so the SDK's URL carries no token. Non-browser clients can use
  `/api/audio/<token>/sendspin`. The upgrade binds the Device to
  `client/init.client_id` and must identify within ten seconds; revocation closes
  the transport even mid-handshake.

## Pipeline

| Step | Why Couch owns it |
|---|---|
| Acquisition: timestamped f32 PCM | The browser SDK has no capture API. Main owns Live capture: the Mac native helper for **Native** inputs, a hidden capture page otherwise. |
| Upload: validated `CaptureAudioPacket` per source epoch | The Node SDK has no public source start/end to declare a format. Publication tokens and epochs retire stale work. |
| Encoding: 48 kHz stereo PCM16 and Opus | One FFmpeg per source: 64-tap `aresample`, Opus at 160 kbps in 5 ms frames. 5 ms steps keep capture-to-chunk delay low. |
| Capture-time mapping | The Node SDK timestamps at send time; Couch maps encoded offsets (with Opus pre-skip) back to measured capture blocks. |
| Group scheduling | Public `getPlayerTiming`, `sendStreamStart`, `sendPcmAudioFrame`, metadata and volume APIs. |

Core's audio worker (`build/audio-worker.mjs`) runs encoding and sessions off
Core's main thread. An upload that's rejected or silent for five seconds fails
only its source.

## Metadata

Each publication has `startedAt` and optional `metadata: { title, description }`,
editable only by the capturing connection. Core sends them with the SDK's
`sendMetadata()`: title → `title`, the line → `artist`, elapsed time as
`progress`. The client shows elapsed time on Core's clock, so a device with a
wrong clock still shows the right time.

## Timing

- A relaxed share keeps at least one second of lead. A Live share's delay, the
  room's, is the host's **Playback buffer floor** (Share dialog, 150 ms
  initially), taken when each listener's playback loads. Every chunk is stamped
  capture time plus that delay; nothing a listener declares moves it.
- Each Receiver declares only its own need through the SDK's `minBufferMs`: its
  once-a-second `syncInfo.outputLatencyMs` reading plus a 35 ms allowance. The
  first reading sets it; later, the median of the last five raises it only when
  it outgrows it by more than 25 ms.
- Core measures its own input-side time per run and wire (Opus and PCM frames
  fill at their own pace): capture to the chunk reaching Core from the encoder,
  the highest of each second, set and raised by the same rule. The first second
  doesn't count: it holds what was captured while the encoder started.
- A listener whose declaration, Sync delay and its wire's input-side time exceed
  the room's delay plays on its own, at that need rounded up to the next 25 ms
  step: the same chunks, stamped later for it. It plays in the room until the
  input-side time is known (about two seconds), so it moves once. Its step only
  rises while it listens and resets when it leaves or the input restarts. A
  rise is a short slew or gap for that listener only. Core keeps each chunk
  until the latest listener has played it.
- Sync is only as good as the browser's output-latency report; Couch can't
  correct a misreported output delay. The SDK exposes no arrival/starvation
  statistics, so the 35 ms allowance (the player's 15 ms scheduling batch,
  decoding and the network) isn't measured jitter.
- No admission limit or eviction: a listener that stops draining gets nothing
  more until it drains.
- **Codec** (Automatic, PCM or Opus) uses the SDK's `codecs` option.
- On Android, relaxed sound plays on the SDK's estimated audio clock, as the SDK
  plays on Cast receivers: Couch hides `AudioContext.getOutputTimestamp()` from
  the page, the case the SDK falls back from. Live keeps output timestamps.
- On macOS, desktop listeners request Chromium's `audio-buffer-size=128`. Linux
  keeps the default until measured there; Windows keeps its device period because
  WASAPI can glitch with mismatched sizes.
- Mac native inputs with more than two channels offer **Input channels**: an
  adjacent stereo pair or one channel as mono, selected with PortAudio's
  `PaMacCore_SetupChannelMap`. An unavailable selection fails; it never
  substitutes another input.

## Checks

The Live integrations (`sendspin-sdk`, `capture-continuity`, `audio-isolation`,
`audio-authorization`, `scheduled-capture`, `live-audience`, `live-delivery`,
`live-lifecycle`) need FFmpeg; run them on Node as [Checks](ci.md#integration-tests)
describes. Physical timing needs real devices: the SDK's clock agreement isn't
input-to-ear latency.
