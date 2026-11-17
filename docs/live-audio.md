# Live audio over Sendspin

[Live audio](../GLOSSARY.md) and relaxed scheduled sound use the unmodified
official SDKs: `@sendspin/sendspin-js` in browsers and
`@sonn-audio/node-sendspin` in Core. Couch supplies capture, encoding,
presentation timestamps, group membership and authorization; the SDKs own the
connection, Noise encryption, clock sync, decoding and reconnection. Relaxed
sound plays with the SDK's `SendspinPlayer`, which also buffers and corrects. A
Live listener plays with Couch's own player (`live-player.ts`) on the SDK's
`SendspinCore`: the SDK's player handles chunks in 15 ms batches, which every
Live listener would wait for. On Android and iOS, Live plays with
`SendspinPlayer` too (Timing explains why). Don't reach into SDK internals,
intercept its transport or parse its logs. What people do with it is in
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
- Which player a Live listener uses:

  | Device | Player | Why |
  |---|---|---|
  | Desktop browsers (Chrome, Edge, Firefox, Safari) | Couch's `LivePlayer` | No 15 ms batch: on the rig's Linux listener it plays at 112–117 ms after capture, where the SDK's player played at 131–157 ms. |
  | Android | The SDK's `SendspinPlayer` | Chrome on Android plays a context that has an AudioWorklet through a FIFO filled from the worklet's thread (desktop Chrome bypasses it). Each time the FIFO runs dry the output plays a callback of silence and keeps that much more queued from then on, but `getOutputTimestamp()` still counts those silent frames as the context's (Chromium's `audio_destination.cc`, `push_pull_fifo.cc`). On the rig's phone `LivePlayer` ran up 56–60 ms of underruns (`AudioContext.playbackStats.underrunDuration`) in its first minute, its declared lead rose from about 39 to 99 ms, and it ended placed at 185 ms. The SDK's player has no worklet: on the same phone it ran up no such delay and played within about 1 ms of its placement. |
  | iOS | The SDK's `SendspinPlayer` | iOS plays a context's sound through a media element (so the silent switch doesn't mute it), fed by a `MediaStreamDestination` whose delay the context doesn't report. The SDK's player adds its own allowance for it (`IOS_UNREPORTED_OUTPUT_LATENCY_MS`, 55 ms) to where it plays and to `syncInfo.outputLatencyMs`; `LivePlayer` would play that much before its placement. |

- Browsers offer AudioWorklet only to secure pages, so a desktop Live listener
  needs Couch's `https://` address (or this computer's own); on the plain HTTP
  address it shows "Live sound needs Couch's https:// address on this device."
  Android's and iOS's Live listeners and relaxed sound don't need it.
- `LivePlayer` hands each decoded chunk to an AudioWorklet
  (`live-timeline.ts`) with the context frame it's due at: its stamp on the
  synced clock, less the Sync delay, mapped to the frame heard then. Chromium's
  `getOutputTimestamp()` gives the frame being heard and when (the median of the
  last second's readings, 20 ms apart); Firefox and Safari give the frame being
  rendered, so their reported `baseLatency` and `outputLatency` stand in.
  The need below comes from the same reading, so placement and declaration agree.
- The worklet plays samples one after another from a short queue. The first
  chunk, and the first after the queue ran dry, starts exactly at its frame;
  what already passed is skipped, so lateness never shifts the timeline. While
  it plays, it follows the frames it was given by playing 0.3 % faster or slower
  once it's more than 1 ms off (the SDK's soft rate and deadband), never by a
  jump; beyond 200 ms (the SDK's resync threshold) the clock itself moved, and
  it starts again at the frame. Volume is the SDK player's.
- Each Receiver declares only its own need through the SDK's `minBufferMs`, read
  only once its sound is unlocked (a suspended context reports its base latency
  only):
  - `LivePlayer`: the most the context's render clock ran ahead of what's heard
    over the last second, which is how far ahead of its time a sample has to
    reach the worklet (the output's latency and its render callback). It's read
    once the output has run a second (an output fills its buffers as it starts).
  - `SendspinPlayer` on Android and iOS: its `syncInfo.outputLatencyMs` plus the
    player's 15 ms scheduling batch (`scheduler.js`
    `scheduleQueueProcessing`), which a chunk may wait for.

  Where the browser reports no output position, the first reading waits for one
  that includes an output latency (or the same twice, on a browser that reports
  none). Later, the median of the last five raises it only when it outgrows it
  by more than 5 ms. Until then it declares 0 and Core sends it nothing: it
  hears nothing for its first two seconds or so, then starts at its step.
- `LivePlayer`'s worklet counts lost chunks: a chunk is lost when it arrives
  after its first sample was due, either its frame passed or the sound before
  it ran out and its stamp follows on from that sound's (Core sent nothing in
  between). A lost chunk also measures how late it was: how long after its
  first sample was due it reached the worklet, network, decoding and the page's
  own work included.
- The SDK's player drops a late chunk silently, so on Android and iOS Couch
  counts them chunk by chunk (`live-loss.ts`), wrapping the SDK's exported `AudioScheduler`
  and Web Audio's `createBuffer`, `getChannelData` and `start`. A chunk is lost
  when its start, the stamp less the output latency and Sync delay, passed more
  than 100 ms ago and the player never started it, or when the player started
  it after a silence though it already held it (a busy page ran its batch after
  the chunk before had ended, and its stamp follows on). A dropped chunk's
  lateness is how far its start had passed at the batch that dropped it
  (Couch wraps `processAudioQueue`); a chunk started after a silence has none.
  Chunks the player discards in a guarded cutover (its private
  `performGuardedCutover`, which starts nothing for 0.3 s after a sync
  recorrection or a Sync delay or clock change) never count.
- With either player, chunks Core never sent, a step's changeover, chunks a
  stream clear discarded, and anything in a second when the context wasn't
  running throughout or the clock isn't synced don't count.
- A Receiver that keeps losing chunks declares a late step (`nextLateSteps`)
  when loss recurs: the last ten seconds lost chunks in two separate spells, or
  three seconds running, or the last minute lost chunks in three separate
  spells (loss that keeps coming back, as late Wi-Fi arrivals do on a phone).
  One stall doesn't step: a burst's late chunks fall within two samples.
- A step is as large as the lateness that recurred, rounded up to the next
  10 ms. A lost chunk's lateness is what a step must add for it to reach the
  player in time. Each spell is as
  late as its latest lost chunk, and the step follows the second latest spell
  that caused it (or, for one spell three seconds running, its second latest
  second): one spell can't set a step however late it was, only lateness two
  spells reached. Loss with no lateness measured (the sound ran out early, with
  nothing late) counts as 0, so it steps 10 ms. On the rig,
  10 ms steps took the phone from 75 to 125 ms one step at a time, losing
  chunks at each; a step sized by the lateness reaches the same place in one.
- Core has applied a step when its chunks leave it half that step further
  ahead of their stamps (Sendspin's `send_ahead`, which Core writes as it sends,
  so the network can't move it). Core applies every step a listener asks for,
  short of its 5 s limit; one not seen within three seconds isn't judged.
- The SDK's player plays a step's first chunk where its last one ended and slews
  to it only while two of its limits hold (`scheduler.js`,
  `recorrection-monitor.js`): a chunk stamped 100 ms or more past the last one's
  end is placed again at once, and so is its sound once its smoothed sync error
  stays 30 ms or more for 0.4 s (a guarded cutover). Either is a gap as long as
  the step. A step shows as that sync error at once, so on Android and iOS a
  step is asked of Core 10 ms at a time: each part once Core applied the last
  and the player slewed to within 8 ms of it (where it stops changing its rate
  and corrects a sample at a time), so it never has more than 18 ms to slew. A
  part takes two to four seconds, 130 ms under a minute. Loss while the parts
  are asked and slewed to happens short of the step and isn't judged: the step
  is judged from once the player slewed to its last part. A player still 8 ms
  or more off ten seconds after a part (30 ms slews to 8 in under 8 s) is off
  for another reason, and the step ends with the parts Core applied.
- An applied step is judged when loss recurs after it: the chunks lost in the ten
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
  keeps every step under the 200 ms at which the worklet places its sound
  again at once instead of slewing. A step that helped, or sixteen minutes with
  no recurring loss, starts the pauses from 24 s again, but steps in any hour
  still add at most 130 ms together: a step can halve the loss by chance, and
  what a step added comes back only as it falls out of the hour. A step after which loss doesn't recur is
  never doubted. Pauses last only as long as the listen. The worklet takes a
  step by playing 0.3 % slower: 10 ms later every 3.3 s. The SDK's player plays
  0.3 % slower while it's over 8 ms off, then corrects a sample at a time.
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
  the page, the case the SDK falls back from. Live keeps them: the SDK's player
  places by them, which on the rig's phone matched its placement within 1 ms.
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
