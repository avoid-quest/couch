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

`allowedOrigins` contains the **pages' origins** (source and receiver Core URLs),
not necessarily the ingress endpoint. An Origin is an additional browser check;
source authorization comes from the real token, configured publisher identity,
and controller/administrator role. Receiver authorization comes from the paired
key allowlist plus the official Noise handshake's proof of key possession.
Admission requires an open socket, `session.isEncrypted()` and an exact
`session.getClientId()` match to the allowlisted key. The pinned SDK's
`onIdentified` also supports legacy plaintext clients, so it is not proof of
encryption by itself. The ingress rejects plaintext application frames during
Noise setup and keeps its three-second deadline until encrypted hello and
initial state complete identification; init or encryption alone cannot cancel it.
Revocation is rechecked on each PCM frame and by a 10 ms watchdog. The prototype
is plain HTTP/WS on task-owned local links; it does not offer a production secure
upload route. Sendspin output is Noise encrypted with AES-GCM. Its server key is
ephemeral and distinct from the installed Couch's key.

The CLI prints `COUCH_INGRESS {"ready":true,"origin":"http://127.0.0.1:41002"}`.
For `host:0.0.0.0`, replace only the host in the returned URL for namespace
receivers. Send newline-delimited stdin requests:

- `{"id":1}` → `COUCH_INGRESS {"id":1,"value":<snapshot>}`.
- `{"id":2,"stop":true}` stops the source and clears/ends both streams.
- `{"close":true}` closes owned sockets, HTTP server and store. EOF/SIGTERM also
  clean up; the parent retains and stops the PID.

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
The websocket is bounded by bytes. It stops rather than replaying a backlog.
Capture automatically ends after 130 seconds, on socket close or track stop.

Eight clock probes choose the lowest round-trip sample. After the worklet starts,
a fixed one-second acquisition samples `performance.now()` against
`AudioContext.currentTime` every 5 ms, requiring at least 100 observations.
Acquisition PCM is explicitly discarded before the test signal starts. The
offset freezes at the observed envelope's midpoint; its required uncertainty
includes half the observed range, half RTT, bracket duration and one observed
render quantum. An envelope requiring more than 10 ms is `unsupported`.
Subsequent residuals outside the frozen bound stop capture rather than retiming
the source. `clockAcquisition` and the first 16 observed/published sample starts
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
stays excluded for this finite experiment. The remaining receiver's clock and
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

Protocol checks (not browser timing):

```sh
bun build tests/live-audio-ingress.test.ts --target node --outfile /tmp/couch-live-audio-ingress.test.mjs
node --test /tmp/couch-live-audio-ingress.test.mjs
```

These checks cover authenticated two-receiver encrypted PCM, both packet sizes,
immutable deadlines across drops, queued packets after source stop/revoke,
receiver revocation, wrong credentials/origins, plaintext refusal, replayed source
generations, coalesced plaintext handshake refusal without PCM disclosure,
the deadline through encrypted identification, identity substitution refusal,
and a labelled deterministic socket-pressure model that leaves the
healthy receiver's timestamp unchanged. They cannot produce a latency/skew pass.
