# Live audio

Live plays an audio input on every listening device as it happens: the input reaches each listener within a shared lead, and all listeners play the same sample at the same moment. [ADR 0003](adr/0003-live-audio-uses-couchs-own-timestamped-stream.md) records why it has its own stream. Relaxed sharing (Audio input without Live, AirPlay, In sync) stays on Sendspin.

```text
couch-capture (native, 128 frames)
  → Main: clock mapping, upload
    → Core audio worker: timestamped PCM / Opus packets, shared lead
      → Core main thread: each packet written to every listener's /api/live/listen WebSocket
        → listener Worker: clock fits, decoding
          → AudioWorklet: plays each sample at capture time + lead
```

## Shared lead

- Every listener reports what it needs: its output latency plus the margin it measured.
- Core sets one lead for the share and schedules each change at a host time, so all listeners move together. It rises after two elevated reports and falls by up to 10 ms every 6 s once 12 s of reports show it can.
- **Maximum** (100 ms by default) and **minimum** (0) are operator settings. **Fixed** holds one lead instead.
- The operator's changes apply to the running share: the lead ramps to a new fixed value or into new bounds, a new Opus bitrate takes the next packet, and a new codec or capture buffer starts listeners on a new session.
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

## Fan-out

Node can't hand a socket to a worker thread, so each listener's WebSocket stays on Core's main thread, where Hub accepted it. The audio worker posts each packet there once, with the listeners it goes to, and Core writes it to each of them ([live-fanout.ts](../src/server/live-fanout.ts)). Listener messages cross the same port both ways, so they stay in order with the audio. Core pings each listener every 100 ms: one unanswered for 0.5 s stops its audio, for 2 s closes it with 4002. A stalled listener never delays the others.

From 20 listeners on, each listener's audio leaves two packets per write: half the socket writes and TLS records, and half the packets on the Wi-Fi. The first packet of each pair waits one packet longer, 2.67 ms for PCM and 2.5 ms for Opus. A message to the listener, such as a pong, takes its waiting packet along and never waits itself.

At 50 listeners the Wi-Fi carries about 87 Mbit/s and 9,400 packets/s of PCM, or about 20 Mbit/s and 10,000 packets/s of Opus 192k.

Measured on a 24-core Xeon E5-2690 v3 (2.6 GHz), Linux, Node 24, with `tests/live-fanout.performance.ts`: a scratch Core on its LAN HTTPS address, the capture fixture, and fixture listeners in their own process that ping every 50 ms and report once a second. Each step was measured for 30 s once every listener was `ok`. CPU is one core's share; send age is capture to send in the worker, mean and maximum over the window. On loopback the kernel charges the listeners' receive work to Core's sends as well, so `sys` overstates what a real network costs.

| Listeners | Codec | Main thread, before → after | Audio worker, before → after | Send age at 50, before → after |
| ---: | --- | ---: | ---: | ---: |
| 1 | PCM | 13% → 14% | 6% → 6% | |
| 10 | PCM | 51% → 35% | 13% → 7% | |
| 25 | PCM | 68% → 48% | 26% → 9% | |
| 50 | PCM | 74% → 62% | 41% → 11% | 3.6 / 14.3 → 3.6 / 6.3 ms |
| 1 | Opus | 13% → 15% | 15% → 14% | |
| 10 | Opus | 50% → 35% | 23% → 17% | |
| 25 | Opus | 68% → 47% | 34% → 18% | |
| 50 | Opus | 79% → 64% | 49% → 22% | 7.6 / 16.1 → 7.5 / 11.1 ms |

Each change of a listener's standing still resends every window's state, which holds Core's main thread for about 80 ms at 50 windows and delays the audio behind it.

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

## Sendspin retirement

Core streams Live itself. The old Sendspin admission gate, receiver preparation,
measured headroom and per-source fixed Live deadlines are removed. Capture
normalization returns source timestamps; relaxed scheduling adds its one-second
lead. The timestamped Live transport applies its shared lead independently.
Sendspin retains Audio input without Live, AirPlay and In sync, including
per-output delay, PCM compatibility, capture generations and encoder lifetimes.

The browser SDK runs upstream 5.0.0. Node SDK 0.6.2 retains only
[message isolation](../patches/README.md): the relaxed isolation regression
crashes its audio worker on an encrypted malformed message without those hunks.
No timing or preparation patch remains, and the four direct dependencies used
only for patched-package materialization are removed.

The earlier performance investigation is superseded by the decision and measured
comparison above. Historical player-mode reports keep their revision-specific
results; they do not describe the current transport.
