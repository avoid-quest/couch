# Play remote audio through a synchronized output group

Type: task
Status: implemented; real software boundaries qualified
Blocked by: maintained PIN-server dependency and unavailable physical/external environments for remaining qualification

## Goal

Connect the session/target model to a real Snapcast or Sendspin group, then use what
we learn to add the other backend. Keep backend timing separate from Couch session policy.

## Work

- Choose the already available backend; otherwise start with Snapcast's documented
  producer/control integration. Record the backend/version and why it was simplest.
- Feed a remote station or track through a session-owned producer to the backend.
  Reuse one upstream fetch/decode per group where compatible; allow client-specific
  encoding where the backend requires it. Avoid desktop-wide loopback capture.
- Expose a group as one target, with observed members and individual volume/mute.
  Backend events establish actual topology. Couch keeps the queue and transport intent.
- Support whole-session transfer between a group and browser/native output; distinguish
  adding/removing a member from moving the session or starting independent playback.
- Report audible content progress, accounting for buffered output; flush on seek.
  Keep one progress writer. Keep backend control credentials out of ordinary clients.
- Add the second adapter using maintained backend/SDK support; change the small shared
  interface if necessary rather than implementing a custom clock protocol.

## Done when

Remote audio plays through a real group, join/leave and volume work, seek/stop clears
old audio, and backend/member loss is recoverable. Record what was measured for drift
and buffering; no audible-sync claim based only on logs. Report each backend separately.
Browser/TV direct playback still works without either backend installed.

## Reference

[Snapcast and Sendspin findings](../../../docs/research/multiroom-snapcast-sendspin.md).
Arbitrary cross-backend groups and distributed TV lip-sync remain outside this issue.

## Snapcast implementation — 2026-09-27

Snapcast 0.35.0 now presents a real group through the existing output picker, with
observed join/leave and member volume/mute. A bounded FFmpeg PCM producer owns
remote decoding; Snapcast owns synchronization. Paused preparation, seek, speed,
Stop, disconnect/reconnect and browser transfers work. The qualified 500ms buffer
and 750ms drain are estimated timing, not physical silence acknowledgements.
Uncertain control/ingestion blocks transfer until a fresh backend reset, and Core
restart observes a durable recovery fence. Removed members go to a dedicated idle
stream. See [operator configuration](../../../docs/snapcast.md).

Actual two-client software-sink journey passed 18 checks; Chromium and Jellyfin
transferred to the group paused at 25 seconds/1.25×, played recorded audio, then
returned to Chromium paused at 48.175 seconds/1.25×. The group sink recorded zero
PCM after transfer. Full check: 1717 core tests passed, ten skipped, three clock
tests passed, typecheck passed. Exact-revision backend qualification follows commit.

## Sendspin implementation — 2026-09-27

Optional TypeScript Core hosting uses `@sonn-audio/node-sendspin` 0.6.2; independent
client mode uses official `@sendspin/sendspin-js` 5.0.0. Existing output controls
manage membership and volume. Durable owner-bound enrollment, revocation, encrypted
admission, bounded PCM, pause/seek/stop, loss recovery and explicit client Leave are
implemented. See [configuration and interoperability limits](../../../docs/sendspin.md).

Two actual Web Audio clients passed sustained playback, pause, seek, speed and Stop.
Software graph silence followed pause/stop within 53 ms; socket loss drained within
511 ms. These measurements do not qualify physical speakers or arbitrary clients.
The host requires AES-GCM and provisioned PSKs; server-side PIN onboarding is not
available in its library. Group transfer requires explicit qualification of the
actual output configuration, not just successful enrollment.

The rejected Python experiment is preserved on `archive/sendspin-python-20260927`
and closed PR #628, outside active ancestry. Physical speaker drift/latency remains
unmeasured for both backends. Detailed receipts are in [validation](../validation.md).

## Current boundary result

Actual Couch browser → two Sendspin Web Audio outputs → browser passes, preserving
the session and 1.25× speed. Independent TypeScript PSK peers, PCM delivery,
reconnect and revocation checks pass within their recorded scopes. Host enrollment
now documents the existing supported external provisioning path; PIN-only onboarding
remains an upstream dependency gap. The client connection-status regression is fixed.
See [measurements, precise limits and next actions](../boundaries-2026-09-27.md).
