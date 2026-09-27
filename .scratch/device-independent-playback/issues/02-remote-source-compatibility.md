# Play Couch's existing remote source formats in the browser

Type: task
Status: open
Blocked by: none

## Goal

Broaden the first working browser path to Couch's actual providers without turning
every stream into a Couch transcode. Work alongside or after
[browser and TV handoff](01-browser-tv-handoff.md); coordinate shared source/protocol edits.

## Work

- Preserve useful upstream rendition/manifest information from `web-media.ts` instead
  of treating its current libmpv-shaped selected URL as a universal browser source.
- Use a maintained browser integration for HLS/DASH where needed. Cover split audio/video,
  alternate audio, usable subtitles, existing adaptive quality and user quality limits.
- Keep required per-resource headers/cookies private. Select direct or scoped relay
  based on actual provider/browser access; handle child manifests/segments/keys consistently.
- Handle temporary URLs and destination-specific access without blind retries of every
  403. Refresh only through the provider's qualified resolution path.
- Negotiate Jellyfin playback for the real target and keep upstream lifecycle scoped
  to the playback attempt. Preserve supported HTTP range and seek behavior.
- Treat radio/live/DVR windows distinctly from finite VOD, especially during handoff.

## Done when

The supported source list names what actually works for radio, provider VOD/manifests,
IPTV and Jellyfin, with observed failures documented. Include required headers,
redirects, expiry and seeking. A controller-only connection resolves/fetches no stream.
Direct sources remain direct; an access-only failure never starts an encoder.
Do not wait for every provider to pass before shipping an improvement.

## References

[Delivery research](../../../docs/research/browser-media-delivery.md), `web-media.ts`,
`jellyfin.ts`, `radio.ts`, `iptv.ts` and their tests.

## Current increment — 2026-09-27

Direct public DASH VOD through a lazy Shaka Player adapter. The official Angel One
manifest (`https://storage.googleapis.com/shaka-demo-assets/angel-one/dash.mpd`)
failed native Chromium loading with media error 4 and readyState 0. The tested HLS
sample already loaded natively here, so DASH is the demonstrated format gap.
Couch already preserves DASH manifest URLs in `web-media.ts`; header-dependent
provider resolution remains outside this public direct-access slice.

Completion: real shared-browser playback, pause/seek/navigation, handoff and stop
cleanup, with focused lifecycle regressions. Keep provider bytes direct, preserve
ABR and the existing height cap, and leave the shared UI/window model intact.

## Result — direct DASH increment

Implemented direct `.mpd` rendering with lazy Shaka Player 5.2.12. Real Chromium
now plays Angel One with provider-hosted manifest and separate audio/video resources,
seeks, survives route navigation and moves between two actual browser renderers.
Paused transfer retained 22.25 seconds at 1.5×; disconnect recovery retained 32 seconds
paused. Former renderers and Stop released the MediaSource. A separate real renderer
check enforced 240p and reported/cleaned up a missing manifest as DASH error 1001.
See [validation](../validation.md) for checks, counts and the distinction between
shared-app and isolated-renderer evidence.

This is public DASH VOD qualification, not a qualified authenticated provider account.
Progressive radio/video remain supported. HLS remains the browser's native path; the
public sample loaded on this Chromium, but cross-browser/live/DVR qualification is
open. Header-dependent provider sources, opaque manifest URLs, explicit audio/subtitle
selection, DRM, Jellyfin and format adaptation remain open. The next useful slice is
a real header-dependent provider's scoped access path or target-negotiated Jellyfin
delivery; do not discard headers to force a URL through the new adapter.

## Result — Jellyfin browser direct play

The browser reports conservative Media Capabilities probes. Core requests a
target-specific Jellyfin direct-play profile, validates the returned stream and
relays its private-header media through a revocable attempt-scoped URL with ranges.
Native negotiation remains unchanged. No remuxer/encoder starts for this access gap.
Single-video/single-audio H.264/AAC MP4 and MP3 are supported when the browser probe
succeeds; multi-audio, external subtitles and incompatible codecs fail explicitly.

Real Jellyfin 10.11.11 and Chromium played a 90-second H.264/AAC fixture. Pause,
seek, 1.5× speed and two-browser paused handoff retained 31.5 seconds. Old and stopped
grants returned 404; range requests returned 206. Jellyfin reported DirectPlay, and
its container had no encoder process. Six hub integration tests cover privacy,
revocation, incompatible destinations, successful native-to-browser transfer and
post-commit rollback (native endpoint simulated). See validation for exact evidence.

Issue stays open for the remaining provider/manifest/audio/subtitle/live work above.
