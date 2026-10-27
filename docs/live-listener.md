# Browser Live listener modules

`src/client/session/live-listener/listener.ts` implements the browser half of the
new timestamped Live transport. It is built but **not wired into the session or
Hub yet**. Existing Live playback still uses Sendspin. Core endpoint authorization,
operator UI, browser end-to-end checks and hardware measurements land separately.

The session will create one listener per listening lifetime:

```ts
import { createLiveListener } from "./live-listener/listener";
import { waitForTap } from "./renderer";

const listener = createLiveListener({
  url,                 // Core's authorized /api/live/listen WebSocket URL
  protocols,           // optional WebSocket subprotocols
  auth,                // optional initial JSON handshake, sent before the first ping
  latencyHint,         // AudioContext seconds or category; defaults to "interactive"
  waitForTap,           // existing Start-tap hook, cleared on resume and stop
  onState,
  onStats,
});
await listener.start(); // completes after calibration and node creation, without waiting for a tap
listener.stop();        // also cancels pending startup; create a new instance to restart
```

States are `preparing`, `needs-tap`, `playing`, `reconnecting`, `needs-https`,
`removed`, `failed`, and `stopped`. Removed/failed include `reason`. An insecure
page reports `needs-https` before creating any resources; the future session UI
supplies the HTTPS address. No ScriptProcessor fallback exists. The listener
uses the playback audio session where available and acquires/releases the screen
wake lock with playback, visibility and teardown.

The connection parameters are the handshake seam; the listener does not discover
endpoints or decide membership. `network.ts` currently accepts the prototype's
`hello { session, codec, leadMs }`, with an optional string/number `epoch`,
`pong { t, s }` (client epoch milliseconds, server microseconds), and scheduled
`lead { leadMs, atServerUs }`. A changed session, epoch or codec clears packet,
decoder, fit and renderer state while retaining the AudioContext clock. A same
session reconnect retains the timeline. Retries back off from 250 ms to 5 s;
4001 means removed, 4003/1008 are terminal authorization failures.

Packets retain the 24-byte little-endian header: codec u8 (1 PCM, 2 Opus), stereo
channel count u8, frames u16, sequence u32, position f64, capture microseconds f64.
PCM is interleaved s16. Ordered WebSocket delivery and stamped sample positions
handle discontinuities; the listener does not depend on a global codec sequence.
The Worker initializes `opus-decoder` 0.7.12 asynchronously, then calls its
synchronous `decodeFrame`. Pending frames are bounded and cannot cross an epoch.
The package embeds its WASM; there is no runtime download or vendored decoder.

Audio flows directly from the network Worker to the AudioWorklet through a
MessageChannel. Recycled 1,024-frame stereo buffers batch at 8 ms. Changed capture
and server fits ride along; there are no separate network-clock messages to the
audio thread. The first batch and first server-ready batch flush immediately.
The page samples output timestamps at 50 Hz, takes the 500-observation (10 s)
offset-only upper median, and delivers it immediately, then once per second or
on a 50 µs movement at most twice per second. No shared memory, COEP, timestamp
step estimator, rig trace or tap is included.

`processor.ts` contains the DSP used by the worklet, tests and calibration Worker.
The disposable Worker measures sinc, Hermite and stereo splice search before node
creation. Sinc must fit half a quantum; WSOLA requires search plus two renders
inside that allowance. Quantum changes scale those measured costs without timed
work or audio allocation in `process()`. Two sustained render-progress deficits
demote to Hermite/rate recovery. There are no device or user-agent rules.

Recovery is fixed to the prototype's **fast elastic** tier: ±2% rate, 4%/s slew,
20% WSOLA consumption where admitted, and an 8 s recovery window. A stalled cursor
holds its content position using a decaying periodic hold, then resumes late
content and repays debt toward available audio. A bounded crossfade remains the
last resort. The separate deadline-preserving concealment mode is omitted.
`concealed`/`concealEvents`/`concealLongest` retain the prototype wire names for
elastic hold synthesis; they do not select a second recovery mode.

Two requested behaviours differ from the prototype's elastic branch: scheduled
lead changes ramp the target at 2 ms/s, independently of fast stall recovery, and
the drift PI uses fast gains for the first 20 s before switching to slow gains
with integral continuity. Joining also waits for actual interpolation support
before establishing a cursor, avoiding an eight-second hold before the first
available sample. These differences require the parent's rig validation.

Stats are one-second interval reports, including `debtMs`, `debtMinMs`,
`debtMaxMs`, `marginMinMs`, `deadlineMarginMinMs`, `needMs`, `missing`, hold and
catch-up accounting, output/base latency, network headroom and fitted drift.
`needMs` pairs lead, margin and debt at each render endpoint. `debtMs` is signed
lag at the interval end. Receiver reports and recycling envelopes are reused;
engine-created transfer wrappers still exist. There is no claim of zero browser
heap allocation or hardware timing validation.

## Bundling and checks

Vite's [worker URL import](https://vite.dev/guide/features#web-workers)
`listener-worklet.ts?worker&url` compiles the TypeScript and dependencies to a
standalone JavaScript URL for `audioWorklet.addModule`. A plain
[`?url` asset import](https://vite.dev/guide/assets#explicit-url-imports) alone
would not bundle the DSP import. Both Workers use Vite's recommended
`new Worker(new URL("./…", import.meta.url), { type: "module" })` form.
An explicit `liveListener` build entry keeps the unwired API and its bundles
emitted; remove this extra entry once the session imports it. Existing `dist/**`
packaging includes all assets without packaging-hook changes.

Run the focused suites separately as [CI](ci.md) describes. The bundle suite runs
**after** `bun run build` and executes the actual emitted worklet, calibration
worker and Opus network worker in isolated JS contexts. It does not launch a
browser or a server. Deterministic playout tests cover 5/20/100 ms stalls, ±20 ms
lead ramps, ±250 ppm drift at 90 s, interpolation selection and WSOLA admission.
Clock tests cover epoch precision, median age, quickest-third pings and capture
history at 400 packets/s. Transport tests transfer and detach actual buffers,
assert report reuse and no worklet-owned audio-buffer allocations after startup,
and measure approximately 125 audio messages plus 1–2 clock messages per second.
Lifecycle tests stub browser APIs; real HTTPS, browser scheduling, reconnect to
Core, audio hardware and phone behaviour remain integration/rig work.
