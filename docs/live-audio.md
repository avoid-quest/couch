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

- A relaxed share keeps at least one second of lead. Live has no shared delay:
  every chunk is stamped at its capture time, and each listener plays it at its
  own step (below). Settings saved with the old **Playback buffer floor** still
  load; the floor is ignored.
- Each Receiver declares only its own need through the SDK's `minBufferMs`: its
  once-a-second `syncInfo.outputLatencyMs` reading plus the player's 15 ms
  scheduling batch (`scheduler.js`), read only once its sound is unlocked (a
  suspended context reports its base latency only). The first reading sets it,
  once the context reports an output latency (or reads the same twice, on a
  browser that reports none): just after `resume()` it may report only its base
  latency. Later, the median of the last five raises it only when it outgrows it
  by more than 25 ms. Until then it declares 0 and Core sends it nothing: it
  hears nothing for its first second or two, then starts at its step.
- The SDK drops a late chunk silently, so Couch counts them chunk by chunk
  (`live-loss.ts`), wrapping the SDK's exported `AudioScheduler` and Web Audio's
  `createBuffer`, `getChannelData` and `start`. Each buffer the player makes of
  a decoded chunk is tagged with the chunk's stamp; a start removes it (a
  sample-corrected copy removes the buffer it was copied from). A chunk is lost
  when its start, the stamp less the output latency and Sync delay, passed more
  than 100 ms ago and it was never started. Chunks Core never sent, chunks a
  stream clear discarded, and anything in a second when the context wasn't
  running throughout or the clock isn't synced don't count. A step's changeover
  can't count either: the chunks after it are stamped later. A chunk the player
  started after a silence counts as lost too: its batch ran after the chunk
  before it had ended (a busy page), though it already held the chunk. It counts
  only when its stamp follows on from that chunk's (Core sent nothing in between)
  and it was received before that chunk ended, so a late arrival or a gap in the
  stream doesn't; a dropped chunk breaks the chain, so nothing counts twice.
  Chunks the player discards in a guarded cutover (its private
  `performGuardedCutover`, on a sync recorrection or a Sync delay or clock
  change, which starts nothing for 0.3 s) never count: from the cutover on,
  stamps from the first whose start hadn't passed to the guard's end, plus the
  100 ms grace, are excused, so a sample before the player's next start can't
  count them. Each start also measures the chunk's slack: how long before it had
  to start (where the chunk before it ended, when it follows on) the player
  started it, network, decoding and the player's batch included.
- A Receiver that keeps losing chunks declares one more 25 ms step
  (`nextLateSteps`) when loss recurs: the last ten seconds lost chunks in two
  separate spells, or three seconds running, or the last minute lost chunks in
  three separate spells (loss that keeps coming back, as late Wi-Fi arrivals do
  on a phone). One stall doesn't step: a burst's late chunks fall within two
  samples. Core has applied a step when its chunks leave it half a step further
  ahead of their stamps (Sendspin's `send_ahead`, which Core writes as it sends,
  so the network can't move it). Core applies every step a listener asks for,
  short of its 5 s limit; one not seen within three seconds isn't judged or
  remembered. An applied step is judged
  when loss recurs after it: the chunks lost in the ten seconds that show it
  against those of the ten seconds that caused it. Half as many or fewer: it
  helped, and the next step follows. Spells over a minute never show that a step
  helped: each minute that recurs holds three or more. Otherwise no step for a
  minute, then two, four, eight, then at most sixteen; after that, recurring
  loss steps again. A step that helped, or sixteen minutes with no recurring
  loss, starts the pauses from a minute again. A step after which loss doesn't
  recur is never doubted. Pauses last only as long as the listen. Each rise moves
  that listener at most one step later, which the player takes by playing
  slightly slower for about 12 s.
- A device remembers one number per Couch (by origin), in the browser storage
  the SDK keeps its Sync delay in (`couch.live-steps:<origin>`): the late steps
  its last listen ended at that held. A step holds when Core applied it and it
  wasn't judged unhelpful: it helped, or the last minute, all of it after the
  step, lost nothing. A listen that ends before its step is judged can't tell
  whether loss would have recurred, so only a lossless minute keeps it, and loss
  no step cures doesn't climb across joins. The next listen declares them from
  its first declaration as steps never doubted, with no pause, verdict or cause
  carried over. A remembered step comes off only on evidence: a minute of
  listening at it at one placement (the same `send_ahead`), over any number of
  listens and from each listen's first declaration, in which no chunk was lost
  and every chunk started had two steps' slack starts the next listen a step
  earlier. There each would still have had a step's slack. The evidence is
  stored as it changes, so a loss undoes it before a reload could use it.
- Core measures its own input-side time per run and wire (Opus and PCM frames
  fill at their own pace): capture to the chunk reaching Core from the encoder,
  the highest of each second, set and raised by the same rule. The first second
  doesn't count: it holds what was captured while the encoder started.
- Each listener plays at its declaration, Sync delay and its wire's input-side
  time, rounded up to the next 25 ms step: the same chunks, stamped later for
  it. Listeners whose needs round up to the same step play together. It hears
  nothing until the input-side time and its own need are known (about two
  seconds), so it moves once. Its step only rises while it listens; Core forgets
  it when it leaves or the input restarts, and the listener declares its
  remembered steps again when it comes back. When
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
  100 ms after capture`), at most every ten seconds per listener
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
