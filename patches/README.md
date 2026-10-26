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
  Original thresholds and sync correction policy remain intact.
- `SendspinPlayer.prepareAudio(format)` prepares codec/output before admission.
  `outputReady` reflects running AudioContext state. Disconnect cancels pending
  preparation. Native decoder reset preserves synchronous configured readiness;
  stream generation is rechecked after async initialization before decoding.
- Full disconnect still closes the decoder; the patch does not remove relaxed
  codec fallback, the SDK correction loop, or per-output positive advance.

References: https://github.com/Sendspin/sendspin-js and
https://www.w3.org/TR/webaudio-1.1/#dom-audiocontext-getoutputtimestamp .
API readiness and browser latency estimates are not measured hardware latency.

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

# Node Sendspin 0.6.2 isolation patch

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
