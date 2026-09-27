# Client-first remote playback

Type: task
Status: claimed
Blocked by: none

## Goal

Let the selected client fetch and render the formats it supports while Core owns
the session. Existing compatible direct media and public DASH remain direct.

## Work

- Use maintained client playback APIs for direct HLS/DASH, alternate audio, subtitles
  and actual live/DVR seek ranges. Preserve quality limits, speed and handoff intent.
- Keep renderer creation and media requests exclusive to the selected/preparing
  client. Controller-only navigation must not resolve or fetch streams.
- Preserve provider rendition/access information instead of forcing every source
  into one libmpv-shaped URL. Use client-side access where the client supports it.
- Record actual supported sources and remaining access constraints. Jellyfin-specific
  browser negotiation, relay and conversion are outside the user's selected scope.

## Done when

Real browser playback can choose available audio/subtitles, handle finite/live seek
ranges correctly and recover/transfer without competing playback. Direct media bytes
flow provider-to-client. Tests cover cleanup, stale attempts and idle controllers.
The supported-source record distinguishes tested behavior from unsupported features.

## Client implementation — 2026-09-27

Public DASH/HLS now uses maintained browser track APIs with stable command indices,
subtitle off, live-edge start and observed DVR bounds. The existing player timeline
accepts a seek range with unknown duration. Real T3 browser checks covered alternate
audio, active subtitle cues/off, seek/rate, route continuity, direct HLS requests and
Stop cleanup. Receipts: `.artifacts/browser-manifest-proof`. Native caption contrast
and footer overlap are recorded presentation limits. Provider authentication/CORS
and codec restrictions remain explicit client/source constraints.
