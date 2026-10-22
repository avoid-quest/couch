# C1/C2 direct PCM experiment

This is a **test-owned, two-receiver prototype**, never a Couch route or an
event-mode option. It bypasses MediaRecorder, HLS and AAC. It sends 48 kHz,
16-bit stereo PCM at 1.536 Mbps per receiver (mono capture duplicated into both
channels). It does not qualify 50 compressed listeners, Wi-Fi, phones or acoustic
latency. Only the native runner's common-graph PCM measurements can assess the
60 ms software latency / 5 ms output skew gates.

Build the CLI with `Bun.build({ entrypoints: ["tests/audio-lab/ingress-cli.ts"],
target: "node", ... })`, then run the result with Node and a JSON config path.
The CLI uses Couch's actual `openStore` and owns only that connection, not Core's
process or database lifecycle. Use the scratch Core database containing the
publisher and receiver identities paired through Core's real `/api/pair` flow.
Run from a task-owned scratch working directory with its own `COUCH_DATA_DIR`
and `COUCH_PORT`; imports may write helper state relative to the working directory.
Use absolute config paths so they do not depend on that directory.

```json
{
  "databasePath": "/scratch/core/couch.db",
  "publisherId": "paired source public key",
  "receiverIds": ["paired first receiver public key", "paired second receiver public key"],
  "allowedOrigins": ["http://127.0.0.1:41001", "http://10.231.0.2:41001"],
  "packetMs": 10,
  "leadMs": 40,
  "host": "0.0.0.0",
  "port": 41002
}
```

Without `tls`, the listener uses HTTP/WS; omitting `host` and `port` keeps the
existing `127.0.0.1` binding and an OS-assigned port. To use HTTPS/WSS on a
task-owned private interface, set these fields in the same config:

```json
{
  "tls": {
    "certFile": "/scratch/core/tls/cert.pem",
    "keyFile": "/scratch/core/tls/key.pem"
  },
  "host": "10.231.0.1",
  "allowedOrigins": ["https://127.0.0.1:41001", "https://10.231.0.1:41001"]
}
```

Both PEM files must come from the **scratch Core's** data directory. Never use
the owner's installed Couch certificate, key, database or data directory. The
certificate must cover the endpoint host/IP, and each receiving browser profile
or Node client must trust that scratch certificate. TLS uses Node's
[`https.createServer`](https://nodejs.org/api/https.html#httpscreateserveroptions-requestlistener);
missing or invalid files fail startup, with no HTTP fallback. TLS is optional
transport protection for this finite test; it adds no production upload route.

`allowedOrigins` contains the **pages' origins** (source and receiver Core URLs),
independently of the ingress endpoint. Matching stays exact, including scheme,
host and port; enabling TLS does not add the endpoint or rewrite HTTP page
origins to HTTPS. The singular `allowedOrigin` remains supported when
`allowedOrigins` is absent. An Origin is an additional browser check;
source authorization comes from the real token, configured publisher identity,
and controller/administrator role. Receiver authorization comes from the paired
key allowlist plus the official Noise handshake's proof of key possession.
Admission requires an open socket, `session.isEncrypted()` and an exact
`session.getClientId()` match to the allowlisted key. The pinned SDK's
`onIdentified` also supports legacy plaintext clients, so it is not proof of
encryption by itself. The ingress rejects plaintext application frames during
Noise setup and keeps its three-second deadline until encrypted hello and
initial state complete identification; init or encryption alone cannot cancel it.
Revocation is rechecked on each PCM frame and by a 10 ms watchdog. HTTP and HTTPS
share the same upgrade, authorization, Noise identification and revocation
guards. Sendspin output is Noise encrypted with AES-GCM. Its server key is
ephemeral and distinct from the installed Couch's key.

The CLI prints `COUCH_INGRESS {"ready":true,"origin":"http://127.0.0.1:41002"}`.
With TLS it returns `https://` instead, for example
`COUCH_INGRESS {"ready":true,"origin":"https://10.231.0.1:41002"}`. The
`startIngressLab` API accepts the same optional `tls` object and returns that
HTTPS origin; the existing snapshot, stop and close APIs are unchanged.
For `host:0.0.0.0`, replace only the host in the returned URL for namespace
receivers, preserving the scheme and port. Send newline-delimited stdin requests:

- `{"id":1}` → `COUCH_INGRESS {"id":1,"value":<snapshot>}`.
- `{"id":2,"stop":true}` stops the source and clears/ends both streams.
- `{"close":true}` closes owned sockets, HTTP(S) server and store. EOF/SIGTERM also
  clean up; the parent retains and stops the PID.

Each admitted `snapshot().receivers[]` entry retains `transport` with
`localAddress`, `localPort`, `remoteAddress`, and `remotePort`, captured from
Node's public upgrade `request.socket` fields (server perspective). Unavailable
values are `null`. This identifies each actual receiver TCP flow for shaping.
`metrics.sentFrames[id]` and `metrics.sentPcmBytes[id]` accumulate frames and
48 kHz stereo s16le payload bytes handed to that receiver's SDK session; they
remain after disconnection. Byte counts exclude the ingress/Sendspin headers,
Noise, WebSocket, TLS and TCP overhead and do not prove remote playback. Entries
appear only after a frame is sent; an absent counter is not an observed zero.

Build `ingress-browser.ts` with `target:"browser", format:"iife"` and inject the
bundle into each existing worker. Its paired `sendspin-identity-sk` and
`couch.remote-token` localStorage values remain the identities used here.

```js
window.__ingressReceiver = await window.__ingressLab.receive({
  origin: ingressOrigin, requiredLeadTimeMs: 10, minBufferMs: 10
});
// Call via the worker's gesture=true execution. Wait for both receivers'
// snapshot().timeSync.synced before starting the source; preserve fixed warmup.
window.__ingressPublisher = await window.__ingressLab.publish({
  origin: ingressOrigin, packetMs: 10 // or 20, matching the CLI
});
```

Both handles expose `snapshot()` and `stop()`. Publishing uses actual
`getUserMedia`, requests no echo cancellation/noise suppression/automatic gain,
and feeds an AudioWorklet. The worklet emits fixed sample counters with at most
two unacknowledged messages; a stalled main thread drops packets at this seam.
Permission/device selection completes before opening the authenticated source
socket, so a long prompt does not consume its pre-start timeout. Subsequent
connection/setup failures stop the acquired tracks.
The websocket reserves the next packet against a two-packet byte budget,
including any queued start control. It stops rather than replaying a backlog.
Capture automatically ends after 130 seconds, on socket close or track stop.

Eight clock probes choose the lowest round-trip sample. After the worklet starts,
a fixed one-second acquisition samples `performance.now()` against
`AudioContext.currentTime` every 5 ms, requiring at least 100 observations.
Acquisition PCM is explicitly discarded before the test signal starts. The final
acquisition read records `firstQualifiedSample`; queued or partial packets
starting before that boundary are also discarded, preserving the original grid. The
offset freezes at the observed envelope's midpoint; its required uncertainty
includes half the observed range, half RTT, bracket duration and one observed
render quantum. An envelope requiring more than 10 ms is `unsupported`.
Subsequent phase/read-bracket residuals must stay inside half the acquired range;
the RTT and render-quantum allowances remain reserved. A one-picosecond comparison
tolerance handles floating-point roundoff only. Violations stop capture rather
than retiming the source or widening uncertainty. `clockAcquisition` and the first 16 observed/published sample starts
are retained. Missing render input discards affected packets and resumes on the
original packet grid, with discontinuity/missing/discarded counters.

**This is an observed render-clock envelope, not an input-hardware capture
timestamp or a proven worst-case uncertainty bound.**
`inputPipelineUncertaintyUs:null` explicitly preserves that unknown.
[`getOutputTimestamp()`](https://webaudio.github.io/web-audio-api/#dom-audiocontext-getoutputtimestamp)
describes output-device playout, not capture; subtracting an estimated output
latency would not calibrate input time. The native common-graph reference includes
the capture pipeline and remains authoritative for measured latency.

Core forwards immediately without a scheduler tick or an application audio
queue, assigning every frame `originUs + sampleOffset / 48000 + leadMs`. It drops
expired input, records skipped samples, rejects repeated/out-of-order counters,
and clears both receivers on source stop/disconnect/revoke. Receiver socket
budgets stay far below the SDK's 512 KiB delayed-send branch; an excluded receiver
stays excluded for this finite experiment. Prospective receiver budgets count
the pinned SDK's 9-byte type/timestamp header, 16-byte AEAD tag and 4-byte
unmasked WebSocket header along with PCM. A 20/40 ms no-progress watchdog samples
the queue before and after writes and between packets; continuously nonempty
queues remain eligible while draining within the byte budget. This watchdog is
not an oldest-packet age measurement. The remaining receiver's clock and
encoder never restart. Kernel TCP buffers and the SDK's internal browser queues
are not equivalent to `bufferedAmount`; only browser fault/output measurements
can prove that late media stays silent across those stages.

Receiver snapshots use only public pinned SDK fields:

- `format`, `connected`, `playing`;
- `timeSync`: `synced`, `offset`, `error`;
- `sync`: `clockDriftPercent`, `syncErrorMs`, `resyncCount`, `outputLatencyMs`,
  `playbackRate`, `correctionMethod`, `samplesAdjusted`, `correctionMode`.

There is no public receiver queue-depth getter. Preserve SDK stdout status lines
(`q=<depth>/<ahead>s`, clock source, resyncs) and server snapshots (`bufferedBytes`,
declared timing, sent/late/missing counts). Configured lead, declared receiver
lead, estimated output latency and measured graph latency are distinct fields.

`receive({outputCompensation:false})` is the one narrow alternative if the
measured failing stage points to the SDK's compensation estimate. Default is
`true`. Record both full, uncorrected graph results; do not subtract latency or
silently select the better configuration after a run.

Pinned official interfaces inspected locally:

- [`@sonn-audio/node-sendspin@0.6.2`](https://registry.npmjs.org/@sonn-audio/node-sendspin/-/node-sendspin-0.6.2.tgz):
  `dist/server/{core,session}.{d.ts,js}`; `sendStreamStart`,
  `sendPcmAudioFrame({data,timestampUs})`, `getPlayerTiming`, `sendStreamClear`,
  `sendStreamEnd`, `isEncrypted`, `getClientId`, `onIdentified`; and
  `dist/noise/handshake.{d.ts,js}` for the async PSK lookup and authenticated
  client identity. Encrypted `source@v1` ingestion is not
  supported by this version; this test adapter is the experiment's explicit gap.
- [`@sendspin/sendspin-js@5.0.0`](https://registry.npmjs.org/@sendspin/sendspin-js/-/sendspin-js-5.0.0.tgz):
  README buffer-timing section, `dist/{index,types}.d.ts`,
  `dist/audio/scheduler.js`. The unmodified official `SendspinPlayer` owns
  decoding, 15 ms queue processing, clock correction, output compensation and
  late-chunk dropping. Declared minimum lead/buffer are hints, not two delays to
  add together. The renderer still needs an actual browser output measurement.
  The TLS protocol tests use the unmodified public `SendspinCore` with
  `webSocket` injection and `storage` for the paired key. Node `ws` supplies the
  page Origin and per-connection CA trust. `onAudioData`, `onStreamClear` and
  `onStreamEnd` observe delivery and revocation without playback or a browser.

Protocol checks (not browser timing):

```sh
repo="$PWD"
scratch=$(mktemp -d /tmp/couch-ingress-check.XXXXXX)
bun build "$repo/tests/live-audio-ingress.test.ts" --target node --outfile "$scratch/ingress.test.mjs"
cd "$scratch"
export COUCH_DATA_DIR="$scratch/data" COUCH_PORT=0
node --test --test-name-pattern '^TLS ' ./ingress.test.mjs
```

Use the repository's pinned Bun version to bundle, then Node to run. TLS checks
generate a fresh certificate through Core's certificate helper in a temporary
directory and remove it afterward. They verify 10/20 ms PCM at two official
SDK receivers, encrypted identities, publisher revocation, certificate trust
rejection, and exact page origins independent of the endpoint. They open only
loopback ephemeral ports. No native, playback, load or timing qualification runs.

The broader protocol suite also contains existing checks described below.
These checks cover authenticated two-receiver encrypted PCM, both packet sizes,
immutable deadlines across drops, queued packets after source stop/revoke,
receiver revocation, wrong credentials/origins, plaintext refusal, replayed source
generations, coalesced plaintext handshake refusal without PCM disclosure,
the deadline through encrypted identification, identity substitution refusal,
and a labelled deterministic socket-pressure model that leaves the
healthy receiver's timestamp unchanged. They cannot produce a latency/skew pass.


Renderer coverage uses `totalDuration - underrunDuration` against the frozen
`AudioContext.currentTime` boundaries. In pinned Chromium **152.0.7977.130**:

- [`RealtimeAudioDestinationHandler::Render`](https://github.com/chromium/chromium/blob/152.0.7977.130/third_party/blink/renderer/modules/webaudio/realtime_audio_destination_handler.cc#L255)
  passes `number_of_frames` to `HandlePreRenderTasks` and advances the context
  frame counter by that same count at line 294.
- [`AudioDestinationHandler::CurrentTime`](https://github.com/chromium/chromium/blob/152.0.7977.130/third_party/blink/renderer/modules/webaudio/audio_destination_handler.h#L48)
  divides the context frame counter by sample rate.
- [`AudioContext::HandlePreRenderTasks`](https://github.com/chromium/chromium/blob/152.0.7977.130/third_party/blink/renderer/modules/webaudio/audio_context.cc#L1578)
  supplies the rendered-frame count and separate glitch information to the
  [stats accumulator](https://github.com/chromium/chromium/blob/152.0.7977.130/third_party/blink/renderer/platform/audio/audio_frame_stats_accumulator.cc#L14).
- [`AudioPlaybackStats::totalDuration`](https://github.com/chromium/chromium/blob/152.0.7977.130/third_party/blink/renderer/modules/webaudio/audio_playback_stats.cc#L28)
  adds observed-frame duration and glitch duration. Glitches do not advance the
  context frame counter, so using this total directly would compare different
  clocks and could mistake lagging counters for full coverage.

The coverage regressions include fresh underruns at exact rendered boundaries,
prior underruns with stale transfers, and a fixed-boundary final drain. Unknown
coverage remains inconclusive; renderer counters alone do not establish PCM
integrity or hardware presentation.
