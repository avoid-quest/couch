# Live audio

Live plays an audio input on every listening device as it happens: the input reaches each listener within a shared lead, and all listeners play the same sample at the same moment. [ADR 0003](adr/0003-live-audio-uses-couchs-own-timestamped-stream.md) records why it has its own stream. Relaxed sharing (Audio input without Live, AirPlay, In sync) stays on Sendspin.

```text
couch-capture (native, 128 frames)
  → Main: clock mapping, upload
    → Core audio worker: timestamped PCM / Opus packets, shared lead
      → /api/live/listen (one WebSocket per listener)
        → listener Worker: clock fits, decoding
          → AudioWorklet: plays each sample at capture time + lead
```

## Shared lead

- Every listener reports what it needs: its output latency plus the margin it measured.
- Core sets one lead for the share and schedules each change at a host time, so all listeners move together. It rises after two elevated reports and falls by up to 10 ms every 6 s once 12 s of reports show it can.
- **Maximum** (100 ms by default) and **minimum** (0) are operator settings.
- **Raise for the slowest** (on by default): the lead rises for the slowest listener, up to the maximum. Off: a listener that needs more than the others by itself doesn't move the lead.
- A listener the lead can't cover keeps playing, **behind by** what it lacks. It's never refused; only the operator removes it.

## Listener recovery

Late audio never turns into silence once the listener has started. The listener holds, then catches up within 8 s by resampling up to ±2% (about 35 cents) and time-stretching up to 20%. A debt it can't repay that way is skipped with a 20 ms crossfade. A device whose output is always late settles at its real delay.

## Measured

Rig: a MacBook Air host with a UMC404HD. Out 3/4 is looped into in 1/2 as the input, and each listener's output is recorded on in 3/4, all on the interface's clock. Pink noise, 10 minutes, wired Linux Chrome listener.

| | Lead | In 1/2 → listener, median (p05–p95) | Missing samples | SNR 1.26 / 8 / 12.7 kHz |
| --- | ---: | ---: | ---: | ---: |
| Sendspin Live, PCM | 75 (lowest clean) | 77.27 (77.23–77.49) ms | 0 | 29.7 / 14.5 / 9.2 dB |
| Sendspin Live, Opus 128k | 75 | 77.16 (77.14–77.39) ms | 912 | 15.1 / 4.7 / 0.3 dB |
| Prototype, PCM | 30 | 31.32 ms | 0 | 43 / 25 / 21 dB |
| Prototype, Opus 192k | 36 | 37.18 ms | 0 | — |

At lead 45, Sendspin Live admitted PCM listeners but had gaps and withdrew them. It refused Opus listeners: Linux needs 17 ms, and the deadline allowed 11–12.

On phones, output timing is reported 10–30 ms off what's measured, with nothing a page can observe. Phones are in sync with each other and with desktops to within that error, not to the sub-millisecond of wired desktops.

## Browser session

Hub sends a `live` instruction with the source and this device's volume. The
session opens `/api/live/listen?token=…&sourceId=…`; membership and pairing are
checked by Core. Only the newest tab receives the instruction. Volume and mute
apply through the listener's gain, without disturbing its clock. Live capture
feeds the timestamped transport only; it creates no Sendspin group or encoder.
Relaxed playback still uses Sendspin.

The existing **Tap to hear** prompt unlocks audio when the browser requires it. The player
and Where it plays show **Preparing audio…** through warming, **Behind by N ms**
when late, **Reconnecting…** when disconnected, and **Removed by the host** after
removal. Removal stops retries; joining again starts a new listener. A secure
page uses the AudioWorklet; an insecure LAN page says **Live needs the HTTPS
address:** followed by that Couch's HTTPS address. Credentials are never moved
to that origin automatically. There is no ScriptProcessor fallback.

The session creates one listener per listening lifetime:

```ts
import { createLiveListener } from "./live-listener/listener";
import { waitForTap } from "./renderer";

const listener = createLiveListener({
  url,                 // Core's authorized /api/live/listen WebSocket URL
  protocols,           // optional WebSocket subprotocols
  auth,                // optional initial JSON handshake, sent before the first ping
  latencyHint,         // AudioContext seconds or category; defaults to "interactive"
  waitForTap,           // existing tap-to-hear hook, cleared on resume and stop
  onState,
  onStats,
});
await listener.start(); // completes after calibration and node creation, without waiting for a tap
listener.stop();        // also cancels pending startup; create a new instance to restart
```

States are `preparing`, `needs-tap`, `playing`, `reconnecting`, `needs-https`,
`removed`, `failed`, and `stopped`. Removed/failed include `reason`. An insecure
page reports `needs-https` before creating any resources; the session UI
shows the current Couch origin with HTTPS. No ScriptProcessor fallback exists. The listener
uses the playback audio session where available and acquires/releases the screen
wake lock with playback, visibility and teardown.

The connection parameters are the handshake seam; the listener does not discover
endpoints or decide membership. `network.ts` accepts Core's
`hello { session, codec, leadMs }`, with an optional string/number `epoch`,
`pong { t, s }` (client epoch milliseconds, server microseconds), and scheduled
`lead { leadMs, atServerUs }`. A changed session, epoch or codec clears packet,
decoder, fit and renderer state while retaining the AudioContext clock. A same
session reconnect retains the timeline. Retries back off from 250 ms to 5 s;
4001 means removed, 4003/1008 are terminal authorization failures, and 1001 ends the listening lifetime.

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
The session imports the listener directly; Vite emits its workers and worklet with the app. Existing `dist/**`
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
Lifecycle tests stub browser APIs. `tests/live-listener.browser.ts` drives the built
application in headless Chrome against an isolated fixture Core and the native
capture helper fixture. It checks HTTPS audio and stats, HTTP guidance, volume,
removal, and reconnect after restarting Core without reloading the page.
Core restarts end in-memory publications; the fixture republishes capture and
rejoins the browser. Physical timing and phone behaviour remain rig work.
