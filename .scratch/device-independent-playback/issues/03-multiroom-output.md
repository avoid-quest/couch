# Play remote audio through a synchronized output group

Type: task
Status: claimed
Blocked by: none

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

Sendspin's Python helper was rejected by the user and removed on 2026-09-27.
Preserve its archived commits and evidence; they are not an active implementation.
Use Couch's existing TypeScript/Rust stack. The official SDKs provide client roles;
resolve the hosting-versus-client boundary before writing the replacement.
Physical speaker drift/latency remains unmeasured for both backends.
