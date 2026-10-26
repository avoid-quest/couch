# Maintained Sendspin patches

Bun applies the pinned `@sendspin/sendspin-js` **5.0.0** and
`@sonn-audio/node-sendspin` **0.6.2** patches through `patchedDependencies` during
frozen installation. These patches change distributed JavaScript and matching
public declarations. Application code uses those public interfaces.

The browser patch was reconstructed from pre-native `browser-patch.before`, SHA-256
`10f9c3c499587832ed5ac8bfeed6d70d361f287e62c2574108d41711f05cd890`.
This is the recovery source hash; correcting the maintained type comment from
±0.1% to ±100 ppm (±0.01%) changes the final patch file hash.
The Node patch matches pre-native `node-patch.before`, SHA-256
`eb4a8654e780e0767fed92bebaff5f6fb7a0a4ba72245c8961a6cc1aa3cb7734`.
Both members live under `audio-native-desktop-output-r1/` in the
[recovery evidence](../docs/player-modes-recovery-reference.md). They contain no
private-key export or native audience receiver API. Browser identity and encrypted
Sendspin connections retain their normal lifecycle.

Historical upstream checks on 2026-10-24 found browser 5.0.0/main
`8716c0942456253c9d601b05763c28d8b6a06f4e` and Node 0.6.2/HEAD
`bb435a032e8a55aba0ef95a5945f961b5b3a6082` without the complete interfaces below.
Recheck upstream when upgrading. Remove each patch only after equivalent upstream
behavior passes its regressions on a fresh frozen install and production build.
Current integration results and outstanding final checks belong to the
[integration ledger](../docs/player-modes-integration-ledger.md).

## Browser clock, correction and preparation

- Output timestamp validation uses an independent **200 ms slope anchor**.
  Adjacent observations still check discontinuity, backward time and freshness;
  the slope bounds remain 0.95–1.05. Projected slope uses observation-time
  intervals; raw slope uses timestamp sample-time intervals. This fixes false
  rejection of the recorded Chrome trace without widening those bounds.
- `sampleCorrectionMode: "rate"` preserves decoded buffers and corrects small
  drift with Web Audio playback rate, capped at **±100 ppm (±0.01%)**. Couch selects
  it for Live. Omitting the option retains upstream sample correction for relaxed
  playback. Stream discontinuity/resynchronization remains separate from gentle
  drift correction.
- `outputLatencyHint` accepts finite, nonnegative seconds. Couch maps the saved
  browser output preference to this hint for Live; **Automatic omits it**, leaving
  the browser default. It is a browser preference, not an exact hardware buffer
  request or measured output latency.
- `SendspinPlayer.prepareAudio(format)` prepares codec/output before admission;
  `outputReady` requires a running AudioContext. Disconnect/clear/close cancel
  pending work. Initialization epochs and stream generations prevent stale native
  or libopus fallback initialization/decoding from replacing a newer stream.
  Prepared fallback can survive clear; full close releases decoder/resampler.
- Preparation preserves the validated output clock, processes queued audio
  promptly and guards callbacks by generation; timed future refills remain.
  Ordinary disconnect still closes resources. Relaxed codec fallback and
  per-output positive advance remain available.

Couch declares `ceil(outputLatencyMs + processingTimeMs)` as its Live lead, with
no margin or floor, and updates it as measurements change. `minBufferMs: 0` is an
explicit request for no extra ongoing jitter buffering by the server: prepared
direct output has no decode-batching wait. Processing and output costs are in the
lead already. The pinned 5.0.0 wire lacks per-chunk send times, so this does not
claim to measure network jitter. The initial 1000 ms declaration is a legacy
hold, ignored by modern Core's preparing gate and replaced atomically on ready.
See the upstream [player timing field definitions](https://github.com/Sendspin/spec/blob/main/roles/player/v1.md#client--server-clientstate-player-object).

Regenerate with the pinned Bun, following its [patch workflow](https://bun.com/docs/pm/cli/patch):

```sh
bun patch @sendspin/sendspin-js@5.0.0
# Edit the distributed JS and matching declarations in node_modules/@sendspin/sendspin-js.
bun patch --commit @sendspin/sendspin-js@5.0.0
bun install --frozen-lockfile
```

Commit the generated patch and lockfile together. `tests/sendspin-sdk.test.ts`
covers measured PCM/native Opus scheduling, trailing-window expiry and silent
Opus/PCM bootstrap without audio devices; `tests/receiver-admission.test.ts`
locks the 10 ms output + 2 ms processing = 12 ms declaration.

The root manifest pins the SDK's four upstream runtime dependencies (`@noble/ciphers`,
`@noble/curves`, `@noble/hashes`, `opus-encdec`) as development/build dependencies.
Bun's isolated patched-package materialization can otherwise omit their Node/Vite
resolution links even though the lockfile contains them. These are upstream's
actual versions, not replacement implementations. Frozen clean installation and
full Vite/Core/app build are checked together.

SDK clock
uncertainty is **milliseconds**: receiver admission requires finite 0–10 ms.
Capture timestamps and scheduled deadlines use integer microseconds.

These browser changes do not select sender lead or packet duration. Integrated
Host policy retains **100 ms default Live lead / 70 ms receiver budget** with
**10 ms Opus packets**, and offers 100/150/250 ms lead choices with a 30 ms source
reserve. Policy is frozen per publication and carried through the worker; saving
a setting does not retime an active source. Relaxed capture keeps one second. Live audience
output remains stereo Opus; relaxed PCM compatibility and PCM capture ingress
remain distinct supported paths. Timing estimates and technical admission do not
qualify physical input-to-ear latency, skew or continuous fidelity.

- `SendspinPlayer.syncInfo.processingTimeMs` exposes the maximum observed local
  chunk-arrival-to-`AudioBufferSourceNode.start()` cost over the trailing second.
  Receive time is captured before transport decryption (at the completing frame
  for a fragmented chunk), retained through native Opus, fallback Opus and PCM
  decoding, and measured after buffer copying and queue processing. It is
  `undefined` without a current observation; explicit output invalidation and
  close discard observations. Stream clears retain still-current measurements.
- `prepareAudio(format)` also schedules one disconnected, silent local codec
  probe if processing is unmeasured. Core withholds stream audio until admission,
  so waiting for a real arrival would deadlock. The probe uses the prepared
  decoder and the same buffer-copying, queue and source-scheduling path as real
  audio, starts/stops an unconnected source and changes no playback anchors.
  Opus uses a valid 10 ms silence packet; PCM uses 10 ms of zero samples, matching
  Couch's normalized Live cadence. Cancellation retires the probe on a new
  preparation, output invalidation or disconnect. Real arrivals replace probe
  observations in the same window. Probes measure local processing, not network,
  loaded-stream worst cases or hardware latency. Relaxed playback never prepares
  or probes, and its scheduling policy and platform latency estimates are intact.

Regressions: `tests/sendspin-sdk.test.ts` exercises both drift signs, sample
identity, continuous rate-adjusted scheduling, omitted-option behavior and decoder
cancellation with real fallback Opus decoding. `tests/output-clock.test.ts` replays
`tests/fixtures/mac-chrome-output-timestamps.json` and rejects sustained .94/1.06,
stale and backward clocks. `receiver-admission.test.ts` and `sendspin-route.test.ts`
cover preparation/route/token lifecycle. Retain these checks when removing the
patch.

## Node connection isolation

After decryption, known application messages require object envelopes/payloads
and object role payloads. Invalid JSON/type/shape closes only that session.
Unknown extensions remain ignorable; payload-free `client_stream/end` stays valid.
The connection callback contains remaining handler exceptions on its own socket.
Healthy listeners keep their original Opus timestamp grid.

`tests/audio-isolation.integration.ts` uses real AES-GCM handshakes and
malicious/valid traffic, including a handler exception beyond envelope validation.
Equivalent upstream validation and connection isolation must pass this test before
patch removal. Native audience-only `webSocketOptions`, `clockErrorUs` and client
credential-export additions are outside the maintained patches.

## Couch output preparation extension

This optional extension is Couch-specific, not an upstream Sendspin standard.
`SendspinPlayer.setOutputPreparation(report, timing?)` publishes
`player.couch_preparation`: UUID `receiverId`, safe nonnegative `epoch`, and
`state: preparing | ready | failed`. Only failed carries `error` (nonempty,
control-free, at most 240 characters). Ready requires finite nonnegative
`requiredLeadTimeMs` and `minBufferMs`; the report and both declarations travel
atomically in one `client/state`, even if the numbers did not change. Setting
before activation retains the report for the initial message.

`onConnectionChange(connected)` runs on transport open before handshake/state and
on close before reconnect handling. Couch invalidates Live preparation through
this hook. Transport close clears the extension and time-filter observations
only when the extension was used; relaxed/legacy reconnect policy stays intact.
Activation preserves the new preparing report from open.

The server exports `OutputPreparation`, types
`PlayerStatePayload.couch_preparation` / `SendspinPlayerStateUpdate.outputPreparation`,
and exposes `SendspinSession.getOutputPreparation()`. It validates before merging
timing, isolates malformed reports to their socket, ignores lower epochs for the
same receiver before merging any fields, and returns a copy. Preparation survives
unrelated deltas on the session; new sessions start empty. Initial identification
sees merged preparation/timing; error URLs are redacted.

The worker matches the current control-tab receiver token and independently
checks format, capacity, timing and correction. A ready assertion alone never
grants admission. Legacy clients without the extension retain numeric admission.
The extension neither retimes a source nor enables Live PCM.

Removal gates: `output-preparation-sdk.integration.ts`, `receiver-admission.test.ts`,
`sendspin-route.test.ts`, `output-admission.test.ts`, malformed-preparation cases in
`audio-isolation.integration.ts`, and Core's public `output-admission.integration.ts`.

## Installation and licensing

The manifest also pins the SDK's actual upstream runtime dependencies
(`@noble/ciphers`, `@noble/curves`, `@noble/hashes`, `opus-encdec`) as build dependencies.
Bun's isolated patched-package materialization can otherwise omit Node/Vite
resolution links even when the lockfile contains them. Verify a fresh frozen
install together with frontend, Core/worker and Main/preload builds; existing
node_modules or mixed historical artifacts cannot prove patch materialization.

The browser SDK remains Apache-2.0 with its installed LICENSE/notices. Node SDK
0.6.2 declares MIT but its published tarball omits LICENSE; consult its
[upstream repository](https://github.com/sonn-audio/node-sendspin).
Browser upstream: <https://github.com/Sendspin/sendspin-js>.
Web Audio defines [output timestamp units](https://www.w3.org/TR/webaudio-1.1/#dom-audiocontext-getoutputtimestamp)
and [latency hints](https://www.w3.org/TR/webaudio-1.1/#dom-audiocontextoptions-latencyhint);
Couch's 200 ms validation window is its maintained SDK policy.
