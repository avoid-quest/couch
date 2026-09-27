# Let people play independently without sharing every queue

Type: task
Status: open
Blocked by: 01

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
