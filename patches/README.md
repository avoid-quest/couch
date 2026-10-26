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

References: https://github.com/Sendspin/sendspin-js and
https://www.w3.org/TR/webaudio-1.1/#dom-audiocontext-getoutputtimestamp .
API readiness and browser latency estimates are not measured hardware latency.

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
