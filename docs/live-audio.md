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
| Acquisition: timestamped f32 PCM | The browser SDK has no capture API. Main owns Live capture of inputs: the Mac native helper for **Native** inputs, a hidden capture page otherwise. Live **System audio** is the window's own timestamped capture, as relaxed System audio's. |
| Upload: validated `CaptureAudioPacket` per source epoch | The Node SDK has no public source start/end to declare a format. Publication tokens and epochs retire stale work. |
| Encoding: 48 kHz stereo PCM16 and Opus | One FFmpeg per source: 64-tap `aresample`, Opus at 160 kbps in 20 ms frames and PCM in 15 ms chunks, the spec's sizes. Opus goes in MPEG-TS so each frame leaves as it's encoded (Ogg holds a page until the next). |
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
  room's, is the host's **Playback buffer floor** (Share dialog, 0 initially: no
  floor), taken when each listener's playback loads. Every chunk is stamped
  capture time plus that delay; nothing a listener declares moves it.
- Each Receiver declares only its own need through the SDK's `minBufferMs`: its
  once-a-second `syncInfo.outputLatencyMs` reading plus the player's 15 ms
  scheduling batch (`scheduler.js`), read only once its sound is unlocked (a
  suspended context reports its base latency only). The first reading sets it,
  once the context reports an output latency (or reads the same twice, on a
  browser that reports none): just after `resume()` it may report only its base
  latency. Later, the median of the last five raises it only when it outgrows it
  by more than 25 ms. Until then it declares 0 and Core keeps it in the room:
  with no floor it hears nothing for its first second or two, then starts at
  its step.
- The SDK drops a late chunk silently, so Couch counts them chunk by chunk
  (`live-loss.ts`), wrapping the SDK's exported `AudioScheduler` and Web Audio's
  `createBuffer`, `getChannelData` and `start`. Each buffer the player makes of
  a decoded chunk is tagged with the chunk's stamp; a start removes it (a
  sample-corrected copy removes the buffer it was copied from). A chunk is lost
  when its start, the stamp less the output latency and Sync delay, passed more
  than 100 ms ago and it was never started. Chunks Core never sent, chunks a
  stream clear discarded, and anything while the context isn't running or the
  clock isn't synced don't count. A step's changeover can't count either: the
  chunks after it are stamped later.
- A Receiver that keeps losing chunks declares one more 25 ms step
  (`nextLateSteps`): when the last ten seconds lost chunks in both halves, loss
  that recurs; one stall, however long, doesn't step. A step is judged once Core
  has applied it, seen as chunks arriving with half a step more time left; that
  second is skipped, and the next ten seconds' share of chunks lost is compared
  with the ten seconds before the ones that caused the step. A step Core didn't
  apply within three seconds (the room's delay had slack) isn't judged. A step
  that lowered the share is kept and stepping goes on while loss recurs; one
  that didn't pauses stepping for a minute, then two, four and so on for that
  listen. So steps that don't help add at most one per pause, six in the first
  hour. Each rise moves that listener at most one step later.
- Core measures its own input-side time per run and wire (Opus and PCM frames
  fill at their own pace): capture to the chunk reaching Core from the encoder,
  the highest of each second, set and raised by the same rule. The first second
  doesn't count: it holds what was captured while the encoder started.
- A listener whose declaration, Sync delay and its wire's input-side time exceed
  the room's delay plays on its own, at that need rounded up to the next 25 ms
  step: the same chunks, stamped later for it. Listeners whose needs round up to
  the same step play together. It plays in the room until the input-side time
  and its own need are known (about two seconds), so it moves once. Its step only
  rises while it listens and resets when it leaves or the input restarts. When
  the capture restarts, the last input-side time stands in until the new
  encoder's is measured, so listeners keep their steps. A player that reports
  its state without declaring a buffer (another Sendspin player) needs at least
  the input-side time. A rise is a short slew or gap for that listener only.
  Core keeps each chunk until the latest listener has played it.
- Sync is only as good as the browser's output-latency report; Couch can't
  correct a misreported output delay. Decoding and the network aren't measured
  up front: a listener that loses chunks to them steps itself later.
- Couch's log gets one line each time a wire's input side changes
  (`live input side opus: 26 ms`) and one when a listener's declaration or step
  changes (`live listener "Name" opus: declares 55 ms, input side 26 ms, plays
  100 ms after capture (room 0 ms)`), at most every ten seconds per listener
  unless its step rose.
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
