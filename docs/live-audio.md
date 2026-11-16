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
| Encoding: 48 kHz stereo PCM16 and Opus | One FFmpeg per source: 64-tap `aresample`, Opus at a constant 320 kbps in 5 ms frames and PCM in 5 ms chunks, so a frame's fill adds little to every listener's delay. Opus goes in MPEG-TS so each frame leaves as it's encoded (Ogg holds a page until the next, and the TS muxer holds packets under 170 bytes). |
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
  by more than 5 ms. Until then it declares 0 and Core sends it nothing: it
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
  count them.
- A Receiver that keeps losing chunks declares a late step (`nextLateSteps`)
  when loss recurs: the last ten seconds lost chunks in two separate spells, or
  three seconds running, or the last minute lost chunks in three separate
  spells (loss that keeps coming back, as late Wi-Fi arrivals do on a phone).
  One stall doesn't step: a burst's late chunks fall within two samples.
- A step is as large as the lateness that recurred, rounded up to the next
  10 ms. Couch measures each dropped chunk's lateness at the player's batch
  that dropped it (it wraps `processAudioQueue`): how far its start had passed,
  which is what a step must add for that batch to start it. Each spell is as
  late as its latest lost chunk, and the step follows the second latest spell
  that caused it (or, for one spell three seconds running, its second latest
  second): one spell can't set a step however late it was, only lateness two
  spells reached. A chunk started after a silence (a busy page, nothing late)
  and loss with no lateness measured count as 0, so they step 10 ms. On the rig,
  10 ms steps took the phone from 75 to 125 ms one step at a time, losing
  chunks at each; a step sized by the lateness reaches the same place in one.
- Core has applied a step when its chunks leave it half that step further
  ahead of their stamps (Sendspin's `send_ahead`, which Core writes as it sends,
  so the network can't move it). Core applies every step a listener asks for,
  short of its 5 s limit; one not seen within three seconds isn't judged. An
  applied step is judged when loss recurs after it: the chunks lost in the ten
  seconds that show it against those of the ten seconds that caused it. Half as
  many or fewer: it helped, and the next step follows. Spells over a minute
  never show that a step helped: each minute that recurs holds three or more.
  Otherwise no step for a while; after that, recurring loss steps again. Each
  10 ms of steps that didn't help pauses 24 s, then 48, 96, 192, then at most
  384 s, and a larger step pauses as long as its 10 ms parts would one after
  another (40 ms: 24 + 48 + 96 + 192 s). A step adds at most what 10 ms steps
  that don't help could add in an hour, less the 10 ms parts whose pauses fell
  in the hour before it: 130 ms at first, then as little as 10 ms. So loss no
  step changes climbs no faster than with 10 ms steps, however late: at most
  130 ms in a listen's first hour and about 90 ms an hour after. The cap also
  keeps every step under the 200 ms at which the player resyncs at once instead
  of slewing. A step that helped, or sixteen minutes with no recurring loss,
  starts the pauses from 24 s again. A step after which loss doesn't recur is
  never doubted. Pauses last only as long as the listen. The player takes a
  step by playing slightly slower (0.5 % while it is over 35 ms off, 0.3 % over
  8 ms, then a sample at a time): at 0.3 % it plays 10 ms later every 3.3 s.
- Each listen starts with no late steps and learns its own: nothing is
  remembered across listens, so a step one listen needed never holds a later
  one back, and loss no step cures can't climb across joins.
- Core measures its own input-side time per run and wire (Opus and PCM frames
  fill at their own pace): capture to the chunk reaching Core from the encoder,
  the highest of each second, set and raised by the same rule. The first second
  doesn't count: it holds what was captured while the encoder started.
- Each listener plays at its declaration, Sync delay and its wire's input-side
  time, rounded up to the next 5 ms step: the same chunks, stamped later for
  it. Listeners whose needs round up to the same step play together; others a
  few ms apart. It hears
  nothing until the input-side time and its own need are known (about two
  seconds), so it moves once. Its step only rises while it listens; Core forgets
  it when it leaves, when its session ends or is replaced (a reload starts with
  no late steps), or when the input restarts. When
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
  85 ms after capture`), at most every ten seconds per listener
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
