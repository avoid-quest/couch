# Sendspin 5.0.0 maintenance patch

`@sendspin/sendspin-js@5.0.0.patch` is applied by Bun's pinned patchedDependencies
mechanism during frozen install. Upstream package remains Apache-2.0; its LICENSE
and notices remain in the installed dependency. Remove this patch when an upstream
release provides the same fixes and public preparation API and the regressions pass.

Checked npm latest (5.0.0) and upstream main 8716c0942456253c9d601b05763c28d8b6a06f4e
on 2026-10-24. Neither has this complete preparation/slope correction interface.
The patch changes distributed JS and matching declarations, not private fields
from application code or a build-time search/replace.

- Projected output-clock slope uses the interval between projected observation
  times. Raw output timestamp slope retains its original sample-time interval.
  Rate validation uses a separate anchor at least 200 ms apart, retaining the
  0.95–1.05 slope limits. Adjacent observations still check backward timestamps,
  freshness and discontinuities. A recorded Chrome Mac trace reproduces false
  0.934 slope rejections over 40 ms despite a near-unity longer-span rate; the
  regression now prepares within the existing startup bound. Sustained 0.94/1.06
  clocks and stale/backward timestamps still fail. This is startup validation,
  not electrical or continuous-fidelity qualification.
- `SendspinPlayer.prepareAudio(format)` prepares codec/output before admission.
  `outputReady` reflects running AudioContext state. Disconnect cancels pending
  preparation. Native decoder reset preserves synchronous configured readiness;
  stream generation is rechecked after async initialization before decoding.
- Full disconnect still closes the decoder; the patch does not remove relaxed
  codec fallback, the SDK correction loop, or per-output positive advance.

References: https://github.com/Sendspin/sendspin-js and
https://www.w3.org/TR/webaudio-1.1/#dom-audiocontext-getoutputtimestamp .
API readiness and browser latency estimates are not measured hardware latency.

Live playback opts into `sampleCorrectionMode: "rate"`. For small clock errors,
the scheduler preserves decoded buffers and uses proportional Web Audio playback
rate correction (two-second settling target, capped at ±100 ppm) instead of sample
insertion/deletion and its repeated short fades. The selected correction mode's
deadband, larger-error policy and late-packet checks remain in force. Omission
keeps upstream sample correction, including relaxed playback. Tests reproduce
the old sample mutation, cover both correction directions and contiguous
scheduling, and check the public player option. The 100 ppm diagnostic had 55/55 accepted windows per pair and no short-waveform
flags, but its 51.327 ms maximum still failed the 50 ms electrical limit. Sustained
continuous fidelity remains unqualified; see `docs/audio-roundtrip-performance.md`.

The root manifest pins the SDK's four upstream runtime dependencies (`@noble/ciphers`,
`@noble/curves`, `@noble/hashes`, `opus-encdec`) as development/build dependencies.
Bun's isolated patched-package materialization can otherwise omit their Node/Vite
resolution links even though the lockfile contains them. These are upstream's
actual versions, not replacement implementations. Frozen clean installation and
full Vite/Core/app build are checked together.

Decoder initialization has a cancellation epoch: closing/clearing while native
support detection is pending cannot recreate the decoder afterward. Public
preparation rejects that cancelled attempt; the receiver admission generation
also prevents it from advertising readiness.

Fallback initialization is also cancellable: stream clear detaches its pending
promise, construction stays local until ready, and only the current generation
publishes the decoder. A prepared fallback survives clear; cancelled/replaced work
cannot overwrite its replacement. Full close destroys the libopus decoder and
resampler. The regression cancels during dynamic imports, prepares again and
actually decodes a stereo Opus packet using the upstream fallback.

Explicitly prepared direct output processes decoded arrivals through the existing
coalesced microtask path instead of waiting 15 ms. Couch uses this preparation for
live audio; unprepared relaxed direct output and media-element output retain the
15 ms batching timer. Upstream explains the original wait as batching out-of-order
asynchronous FLAC decodes in
[the pre-refactor source](https://github.com/Sendspin/sendspin-js/blob/7f388ca24d897c77229e71d8831c68fce9b9bc0d/src/audio-processor.ts#L1657).

Future horizon refills retain their timers. Stream generation invalidates pending
microtasks and retired preparation; full clear, output invalidation and disconnect
withdraw prompt processing. A clock-preserving stream start keeps prepared output
prompt. Deadlines, output-latency compensation and late-packet dropping stay in
the existing scheduler. This removes a scheduling wait, not a measured amount of
physical RTT. `tests/sendspin-sdk.test.ts` feeds decoded arrivals through the real
SDK with fake Web Audio/time boundaries and covers coalescing, timestamp order,
preparation/clear/disconnect, expired input and timed future refills.

After changing patch bytes, refresh/verify patched-dependency metadata with the
project-pinned Bun during an authorized install window, and verify a frozen install
materializes this scheduler before packaging. Any resulting `bun.lock` update
belongs with that install; do not edit dependency checksums by hand. The local
runtime edit used for focused tests is not a substitute for clean materialization.

`SendspinPlayerConfig.outputLatencyHint?: number` requests an AudioContext output
latency in seconds. Player forwards it to the scheduler, which rejects supplied
nonfinite or negative values and passes `latencyHint` only when supplied; zero is
valid. Omission retains the browser default. Couch requests `0.002` only for Live.
The browser may choose another latency: `OutputLatencyTracker`, compensation,
preparation declarations, admission and expired-packet dropping still use the
actual runtime path. The hint never replaces an output estimate or lowers a
declared requirement. See the official
[AudioContext option](https://www.w3.org/TR/webaudio-1.1/#dom-audiocontextoptions-latencyhint).
`tests/sendspin-sdk.test.ts` exercises actual public player forwarding, omitted
and zero hints, invalid values, and actual latency differing from the request.

# Node Sendspin 0.6.2 isolation patch

Native desktop output additionally uses the explicit browser API
`exportSendspinClientIdentity(storage)` for a private-key handoff to trusted Main.
Ordinary `loadSendspinClientIdentity` results remain unchanged. Never log the
exported credentials. `tests/native-output.integration.ts` verifies that the Node
identity matches the browser's paired Device, including memory-backed storage.

The Node client exposes read-only `clockErrorUs` and per-connection
`connect(url, { webSocketOptions })` (upstream `ws` options). Couch supplies an
HTTPS agent using its existing SPKI pin and a verified peer certificate as CA;
actual media sockets retain TLS validation and disallow redirects. No global TLS
override is used. Opening timeouts now reject their pending promise, and cleanup
terminates the underlying socket even during preparation. The same integration
tests exercise encrypted PCM/deadline preservation, volume/mute, missing-block
failure, wrong pins and cancellation of a connection that never upgrades.

`@sonn-audio/node-sendspin@0.6.2.patch` applies through the same frozen Bun
mechanism. The server SDK declares MIT licensing in its package metadata. Its
published 0.6.2 tarball contains no LICENSE file; see the upstream repository below
for the license text.
Checked npm latest 0.6.2 and upstream HEAD
`bb435a032e8a55aba0ef95a5945f961b5b3a6082` on 2026-10-24:
https://github.com/sonn-audio/node-sendspin . Both still dispatch malformed
application envelopes without validation/connection exception containment.

After decryption, known application messages require object envelopes/payloads
and object role payloads. Invalid JSON/type/shape closes only that session.
Unknown message extensions stay ignorable; payload-free client_stream/end remains
valid. The connection message callback catches remaining handler exceptions and
terminates only its socket. No process-wide exception handler or audience restart.
Application code does not access private SDK fields; the additive public preparation API is documented below.

Remove when an upstream release provides equivalent validation/isolation and
`tests/audio-isolation.integration.ts` passes. That test performs real AES-GCM
handshakes and malicious/valid application traffic while another receiver keeps
receiving real Opus on its original timestamp grid, including a handler-throw case
beyond basic envelope validation.

## Couch output preparation extension

These maintained patches additionally expose an optional Couch-specific extension,
not an upstream Sendspin standard. `SendspinPlayer.setOutputPreparation(report,
timing?)` sends `player.couch_preparation` with `receiverId` (UUID), safe nonnegative
`epoch`, and `state: preparing | ready | failed`. Only failed carries `error`
(nonempty, control-free, at most 240 characters). Ready requires finite nonnegative
`requiredLeadTimeMs` and `minBufferMs`; preparation and both numeric declarations
are published atomically in one `client/state`, including when the numbers have
not changed. Setting before activation stores the state for the initial message.

`SendspinPlayerConfig.onConnectionChange(connected)` runs on transport open before
handshake/initial state and on close before reconnect handling. Couch invalidates
live preparation through this public hook. Transport close clears the extension
and its time-filter observations only if this optional extension was in use;
legacy and relaxed reconnect policy stays unchanged. Activation itself does not
clear preparation, because that would erase the new preparing report from open.

The server exports `OutputPreparation`, types `PlayerStatePayload.couch_preparation`
and `SendspinPlayerStateUpdate.outputPreparation`, and exposes
`SendspinSession.getOutputPreparation()`. It validates the optional report before
retaining or merging timing, rejects malformed reports only on their own socket,
ignores a lower epoch for the same receiver ID before merging any fields, and
returns a copy from the accessor. Preparation survives unrelated deltas on that
same session; a new session starts without it. Initial identification observes
already-merged preparation and timing. Error URLs are redacted.

Couch's worker selects the session matching the current expected control-tab token
and independently applies all existing format, capacity and deadline gates. The
SDK assertion never confers admission by itself. Token expectations are explicit;
legacy clients without the extension retain numeric admission. No per-source ID,
source-switch decoder reset, deadline increase or live PCM fallback is introduced.

Removal requires an upstream release providing equivalent public atomic state,
connection lifecycle, validation and isolation semantics and passing
`output-preparation-sdk.integration.ts`, `receiver-admission.test.ts`,
`sendspin-route.test.ts`, `output-admission.test.ts`, and the encrypted malformed
preparation cases in `audio-isolation.integration.ts`, plus Core's public
`output-admission.integration.ts`. The isolated frozen install/runtime receipt is
in `.scratch/playback-refactor/output-admission-audio/`; it opens no audio output.
