# Live audio over Sendspin

The owner-approved [use cases and capability contract](audio-video-use-cases.md)
and [glossary](../GLOSSARY.md) define this baseline's scope. The objective is a
simple, reliable integration. Further performance optimization is not requested
and does not automatically follow this work.

This is the starting baseline, not the final low-delay Live implementation. The
contract distinguishes the currently acceptable buffering/skew from Live's future
latency ambition, while preserving relaxed playback's separate UX and technical
policies. The configured buffer is not measured input-to-ear latency.

Live audio uses the unmodified official browser SDK, `@sendspin/sendspin-js`
3.2.1, and the unmodified Node SDK, `@sonn-audio/node-sendspin` 0.6.2. There are
no local SDK patches. Native HOST capture feeds the same Sendspin groups used
by relaxed scheduled audio; phones receive through the browser SDK.

The owner selected this baseline on 2026-10-27. It supersedes the proprietary
Live transport, receiver DSP, admission policies and earlier performance gates.
Previous patched-Sendspin/B1 results were not stock upstream measurements. They
do not establish a limitation of this baseline. A subsequent
[one-minute electrical field run at defaults](sendspin-baseline-20261027.md)
measured about 405 ms on Linux and 413 ms on Android, with 7.5 ms median receiver
skew. It is a bounded baseline observation, not a lowest-latency, fidelity,
background-phone or audience-size qualification.

A subsequent [six-minute recovery check](sendspin-stability-20261027.md) recovered
from both receivers' Leave/Join and an Android-only Wi-Fi interruption. Its two
brief Android attenuations coincide with intrusive heap-observer reacquisition;
they remain measurement-confounded rather than established spontaneous defects.
A [passive six-minute confirmation](sendspin-passive-confirmation-20261027.md)
without that inspection reproduced the latency and recovery, with no uncommanded
attenuation of at least 20 ms. A smaller Android timing excursion remains recorded;
lower-buffer latency estimates are documented separately from measured results.

## Upstream APIs and the plaintext version choice

[Browser 3.2.1 README](https://github.com/Sendspin/sendspin-js/blob/830e8f1062b44746606b368e7e8823fe565f8b3c/README.md)
documents `SendspinPlayer` with an explicit `playerId`. Its published protocol
handler sends plaintext `client/hello`. Browser releases 4.0.0 and 5.0.0 always
use Noise and expose only cipher-suite selection, not a plaintext switch.
3.2.1 is pinned to meet the owner's plaintext requirement; continued maintenance
of this older release is not assumed.

The [Node SDK](https://github.com/sonn-audio/node-sendspin/tree/bb435a032e8a55aba0ef95a5945f961b5b3a6082)
supports plaintext sessions without `enableEncryption`. Couch uses the public
`SendspinSession` constructor, hooks, dispatch and stream APIs. A small exception
boundary around `handleText`/`handleBinary` closes a peer if an SDK handler throws;
this replaces the former SDK patch without modifying protocol parsing. A malformed
peer must not terminate the shared worker. Unknown messages keep upstream behavior.

No Noise identity, PSK, key exchange, cipher selection or cryptographic device ID
is required. A locally stored opaque ID is passed as `playerId`. Existing Couch
pairing tokens can rebind an old ID through the control connection's existing
`identify` behavior; pairing does not need to be repeated. Saved SDK key material
and old database rows are ignored, not read or rewritten.

An authenticated `POST /api/audio/session` establishes an HttpOnly cookie for
`/sendspin`; the SDK opens that normal endpoint and owns reconnection. The cookie
contains the existing Couch token and uses SameSite Strict, with Secure on HTTPS.
The SDK URL contains no token. A token-bearing `/api/audio/<token>/sendspin` base
path is available for non-browser SDK clients. The upgrade binds the authenticated
Device to `client/hello.client_id`, checks host/origin and remote-control permission,
and existing revocation removes its session. TLS for LAN access remains separate
from Sendspin application-level encryption. Browser cookies must be usable for
the selected Couch origin.

## Necessary application adapters

- Main retains native CoreAudio/PortAudio capture and ordinary browser system,
  sound-card and line-input capture. The authorized PCM upload carries source
  generation, sample position, format and measured capture timestamps. Sendspin's
  browser player has no capture API; the Node SDK has no capture/encoder pipeline.
  Node 0.6.2 exposes `sendSourceAudioChunk`, but its client has no public
  `client_stream/start`/`end` API to declare the source format that its server
  requires. This cleanup keeps the existing authorized capture upload rather
  than hand-writing another partial Sendspin source client.
- `scheduled-capture.ts` feeds float PCM to FFmpeg, which converts the input rate
  and channels and emits standard 48 kHz stereo PCM and Opus. A streaming float WAV
  header declares the acquired format and bounds demux packets to 20 ms; raw
  float input otherwise waits for a 4096-frame read. Browser-reported gaps up to
  40 ms are filled with silence, preserving sample positions instead of ending
  the source. There is no JavaScript
  resampler, oscillator controller, calibration or custom decoder. Both wire
  formats share one process and a common rate/channel conversion before the
  encoder outputs split. PCM converts float samples to signed little-endian
  PCM16 at this boundary; Opus produces individual packets after removing the
  Ogg transport wrapper. FFmpeg's standard mono conversion applies.
- Encoded offsets map back to measured capture blocks, including Opus pre-skip.
  This keeps long-running source deadlines tied to the input clock instead of
  inventing a second nominal clock. Source generations retire the prior encoder.
- `scheduled-audio.ts` maps product Playbacks, members, levels, metadata and picture
  clocks to SDK sessions. The SDK is a transport/session library, so Couch still
  supplies encoded chunks and presentation timestamps. Live captures use the largest
  declared `min_buffer_ms` plus static output delay in their group; relaxed capture
  retains at least one second of buffering before output-delay compensation. The common
  lead can increase for new declarations and is retained when a listener leaves.
  There is no fixed latency admission limit or slow-receiver eviction policy.
  Per-player buffer capacity bounds sends; the SDK owns receiver scheduling,
  clock synchronization, correction, decoding and recovery.
- Core's audio worker keeps encoding off the main control loop. Its existing
  source epochs, bounded upload queues and helper leases prevent stale work from
  crossing source lifetimes. No separate Live listener fanout bridge remains.

Direct media and relaxed captured A/V retain their existing routing, queue,
Move, output consent, WebRTC/TURN and buffered HLS behavior. Live audience rights
remain Join/Leave, own volume/mute and host removal; joining grants no programme
or queue authority. Ending capture ends that source without ending independent
playback. Native input selection, capture rate/buffer and mute remain available.

The share panel offers Automatic/PCM/Opus through the SDK's public `codecs`
option, and Buffer (ms) through `minBufferMs`/`setMinBufferMs`. Automatic leaves
codec preference upstream; the initial buffer is the SDK default, 250 ms. Opus
is preferred with PCM fallback using upstream browser capability filtering. A
codec change recreates that player; buffer updates reuse its connection. Startup
lead, output mode, correction, decoder and browser hardware buffering use SDK
defaults. No preparation probe or readiness extension gates playback.
An initial audio-session failure is shown through existing error feedback and
offers Tap to hear to retry. Leaving cancels that retry; a rejected bootstrap is
not retained as the active player.

## Adapter boundaries and coverage

| Adapter | Actual input → output | Responsibility / public upstream API | Relevant software checks |
|---|---|---|---|
| Native/browser acquisition and Main ownership | Selected audio device/system track → timestamped interleaved f32 PCM, format, generation and sample position | Existing OS/browser APIs and native helper protocol. The Sendspin browser player has no capture API. Local permissions, input identity, mute and retirement remain separate from receiver rights. | `native-live-authority.test.ts`, `live-client.test.ts`; native hardware is not exercised |
| Authorized upload and worker bridge | Owned publication + f32 capture frames → validated `CaptureAudioPacket` in its source epoch | Retains the existing upload protocol. Node 0.6.2 has `sendSourceAudioChunk` but no public source stream-start/end method; it cannot replace this with a complete source-format negotiation. Worker messages and helper leases retire stale work. | `scheduled-capture.integration.ts`, `live-audience.integration.ts` |
| Sample conversion | f32 at the acquired rate/channels → shared 48 kHz stereo samples and signed LE PCM16 | Standard FFmpeg `aresample`, channel conversion and `pcm_s16le`. Sendspin PCM is integer, not float; session APIs accept already formatted bytes. | `capture-continuity.integration.ts`: 44.1 kHz mono / 48 kHz stereo, channel mapping and integer samples |
| Opus encoding/framing | Shared samples → libopus packets with duration/pre-skip, Ogg wrapper removed | Standard FFmpeg `libopus`; public `sendStreamStart` / `sendPcmAudioFrame` send complete Opus packets, not an Ogg byte stream. | `capture-continuity.integration.ts`, `audio-isolation.integration.ts`, `sendspin-plaintext.integration.ts` |
| Capture-time mapping | Encoded sample offset + generation + measured capture-block timestamps → source timestamp in Core microseconds | A short block lookup, including Opus pre-skip; no oscillator estimator or browser clock replacement. SDK send-time defaults cannot reconstruct source acquisition time or keep differently delayed codec outputs on that source timeline. | `capture-continuity.integration.ts`: source generation replacement, non-nominal capture time and codec delay |
| Playback/group scheduling | Source timestamp/bytes + consented members + SDK timing declarations → common presentation timestamps, per-session frames, level and metadata | Public `getPlayerTiming`, `getPlayerSupportedFormats`, `sendStreamStart`, `sendPcmAudioFrame`, group/metadata/volume APIs. The SDK session does not produce media or choose the application's group timeline. | `sendspin-plaintext.integration.ts`, `live-delivery.integration.ts`, `receiver-error-lifecycle.integration.ts` |
| Device authorization and browser playback | Existing Couch token + opaque ID → token-bound plaintext session and stock player | HttpOnly `/sendspin` cookie and `SendspinPlayer({ playerId, baseUrl })`. Public `codecs`/`setMinBufferMs` implement operator choices. The SDK has no Couch consent/token model. Public `SendspinSession` dispatch has a peer exception boundary instead of a patch. | `sendspin-plaintext.integration.ts`, `sendspin-route.test.ts`, `audio-isolation.integration.ts`, `settings-authority.integration.ts`, `browser-device-identity.test.ts` |

## Actual capability limits

Native acquisition is currently Mac-only and wired through local desktop Live
publication. This is remaining implementation coupling, not a rule that Direct
or relaxed playback requires browser acquisition. Linux/Windows retain their
existing browser adapters. Source/runtime/OS/API/permission selection follows the
[acquisition matrix](audio-video-use-cases.md#acquisition-matrix); this run adds no
OS backend or publication surface.

The current scheduled sender produces 48 kHz stereo PCM16 and Opus. Other PCM
rates, bit depths and channel layouts are valid in Sendspin, but receivers that
support only those other formats cannot use this sender. Source input formats
are converted by FFmpeg at the existing capture boundary. Ordinary file/URL
sources retain their own preparation and decoding path, never microphone or
system-output capture. There is no new FLAC producer or passthrough engine.
Opus browser support uses upstream capability filtering, with PCM fallback.

## Removal inventory

| Removed | Replacement or reason |
|---|---|
| `live-transport.ts`, `live-packet.ts`, `live-fanout.ts`, `live-lead.ts` | Standard Sendspin session and stream APIs |
| `src/client/session/live-listener/` (14 modules) | Unmodified `SendspinPlayer`: decoder, clock, buffering, correction and recovery |
| `/api/live/listen`, `/api/live/listeners`, the `live` instruction and listener telemetry | Authenticated `/sendspin` plus ordinary output/error state |
| Fixed/automatic lead controller, bitrate policy, browser/listener hardware-buffer overrides | Public SDK codec preference and minimum buffer only |
| `createCaptureClock` and its oscillator estimator/interpolating resampler | FFmpeg format conversion and capture-block timestamp mapping; standard WAV framing keeps source reads bounded |
| Node SDK patch and `patchedDependencies` | Public session dispatch exception boundary; zero SDK patches |
| Noise setup, PSKs, AES suite option, server key persistence and key-derived device IDs | Plaintext SDK 3.2.1 and token-bound opaque IDs |
| Direct `opusscript`/`opus-decoder` dependencies, worker WASM staging and related type declarations | Standard FFmpeg Opus and the SDK's own decoder dependency |
| Custom DSP/clock/lead/fanout tests, replay fixtures, browser harness and fixed-chunk-count assertions | SDK-path lifecycle, protocol, capture and product correctness checks |

## Correctness checks

Build only Core and its worker before Node integration checks:

```sh
bun scripts/core.ts
bun run typecheck
bun build tests/sendspin-plaintext.integration.ts tests/capture-continuity.integration.ts tests/audio-isolation.integration.ts tests/scheduled-capture.integration.ts tests/live-audience.integration.ts tests/live-delivery.integration.ts --target=node --outdir=build/checks
COUCH_TEST_FFMPEG=/path/to/ffmpeg node --test build/checks/*.js
```

These use temporary databases, loopback ports and synthetic PCM; they do not open
hardware. The stock browser core check covers plaintext hello, token/ID binding,
PCM decoding, reconnect, SDK buffer updates, a concurrent Opus receiver and Leave.
Capture checks cover native input formats, source generations, measured timestamp
mapping and Opus pre-skip. Session isolation, source upload authorization and
product audience/Direct/relaxed routing have separate regressions. Browser player
adapter checks use only its public API (`tests/sendspin-route.test.ts`).

The source-only cleanup phase performed no hardware runs, benchmark campaigns,
packaging, CI or releases. The subsequent
[default electrical baseline](sendspin-baseline-20261027.md) exercised native
capture and two real browser outputs and measured their physical latency/skew.
Background/sleep recovery, fidelity and broader platform/scale behavior remain
unqualified.
