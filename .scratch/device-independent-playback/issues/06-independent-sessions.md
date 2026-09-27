# Let people play independently without sharing every queue

Type: task
Status: resolved
Blocked by: none

## Goal

Add simultaneous sessions while retaining the existing household queue and explicit
handoff. Opening a personal browser must not unexpectedly replace living-room playback.

## Work

- “Play here” can start/select an independent session; “Move this session” retains
  identity/queue; “Join group” retains the group's shared timeline. Make these distinct.
- Scope persistence, provider active/prepared/reporting state, subtitles, continuation
  and progress to their sessions/attempts. Do not just call `createSession()` twice
  above singleton Jellyfin/subtitle/audio state.
- Subscribe to authorized sessions. Separate shared library invalidations from private
  playback events. Keep target occupancy explicit and require an intentional takeover.
- Distinguish watching profiles from authenticated people/household authority. Introduce
  only the identity/permission model needed for real isolation; do not build an account
  platform as a prerequisite for household playback.
- A group and one of its members cannot independently own conflicting sessions.
  Preserve one progress writer per assignment/viewing lineage.

## Done when

Two sessions can play different remote items, seek and change subtitles without
cross-updating queues, upstream reports, progress or cleanup. A controller cannot
observe/control a session outside its permissions. Existing household data migrates intact.

## Implementation contract

Use one shared Core service graph and one global output registry. Household storage
remains intact. A personal session belongs to the authenticated controller ID and
uses an explicit playback-store facade over private SQLite state. Watching profiles
are not authentication identities. Requests select only household or own personal
scope; private state/events never reach another controller.

Session runtimes own queue, progress, continuation, provider playback attempts,
subtitles and radio observations. Shared catalogs/configuration/scanners remain
singletons. Reserve outputs before asynchronous preparation; explicit takeover
requires the previous output to stop safely. Opening a client never steals playback.

UI separates independent Play here, Move this session and joining an authorized
group timeline. Measure two concurrent sessions plus idle controllers after the
functional isolation tests pass.

## Verified result — 2026-09-27

Private stores, session-owned attempts/subtitles, global output reservations, scoped
HTTP/WebSocket delivery and existing-UI session selection are implemented. Twelve
real-hub integration tests cover isolation, disk restart, revocation, diagnostics
privacy, update-idle retirement, source-change cancellation and live seeking.
Actual browser checks passed simultaneous VOD/live playback, private/household mode
roundtrips, explicit takeover and move back. Live handoff preserves distance behind
the live edge when renderer timelines differ. Viewport checks preserve the existing
app; native TV hardware remains separate qualification.

The 15-second coordination benchmark used real HTTP/WebSockets, two simulated
renderers and 20 idle controllers: 1.01% of one CPU core, 70.94–73.50 MB RSS, p50
0.56 ms / p95 1.49 ms command RTT. Idle controllers fetched no media. Decoder and
physical output costs are not included.
