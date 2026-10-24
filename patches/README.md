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
No public SDK API changed or application access to private SDK fields was added.

Remove when an upstream release provides equivalent validation/isolation and
`tests/audio-isolation.integration.ts` passes. That test performs real AES-GCM
handshakes and malicious/valid application traffic while another receiver keeps
receiving real Opus on its original timestamp grid, including a handler-throw case
beyond basic envelope validation.
