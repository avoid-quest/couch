# Play remote audio through a synchronized output group

Type: task
Status: open
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

## Coordination check — 2026-09-27

Issue 01's direct-media foundation is resolved; issue 02 is not a prerequisite for
a group adapter. No `snapserver`, `snapclient`, `sendspin`, `sendspin-server` or
`music-assistant` executable was found on the current PATH. Containers and remote
installations were not inventoried. No real backend/version has been qualified.

Continue at the existing playback-target command/observation boundary, adding one
real backend's producer and timing ownership. Establish paused readiness, buffered
progress, flush and confirmed silence before claiming handoff; do not add a group
stub while the direct DASH increment proceeds in issue 02.
