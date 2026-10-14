# Live sharing performance

Investigated 2026-10-14 against `35ffee9` (`v0.3.1-preview.4`), a report of a MacBook
screen shared to one Android Chrome receiver playing at least ten seconds behind,
where earlier builds had been much faster. The resulting decision is
[ADR 0001](adr/0001-live-inputs-play-over-webrtc-unless-in-sync.md); synchronization
research is in [live-sync-research.md](live-sync-research.md).

## What changed between builds

The first in-app version (local commit `71da5d0`, published as `5c7ccd4` on
`feat/live-device-sharing`) sent WebRTC to every receiver. `5c0f3fc` replaced
that with a recording uploaded to Core, encoded by FFmpeg into one-second HLS
segments, with Sendspin scheduling sound one second ahead and pictures following
its clock. `f5f7a0a` restored WebRTC for a single receiver, keeping HLS/Sendspin
whenever outputs spanned devices and running the upload and encoder for every
source. `35ffee9` also moved a single receiver to HLS/Sendspin after a failed
negotiation or a 10-second connection timeout, for the rest of the publication;
its commit message attributes this to a phone browser gathering no ICE candidates.

These differences can explain multi-second delay, but the reporter's route was
never observed: their `couch.log` (`Direct on`, `Synced on`, `couldn't connect
directly`) and a physical measurement are still needed. Nothing here proves the
cause on their devices, or that this change removes their delay.

## Measurements

All on one Linux machine, Node 24.21.0, Bun 1.4.2, isolated databases and ports.
None is a physical capture-to-display or phone measurement.

- **HLS readiness** (`35ffee9`'s `createLiveStreams`, FFmpeg 9.0.2, paced synthetic
  720p30 VP8/Opus WebM in 250 ms batches): first playable playlist after
  1,739 / 1,742 / 1,739 ms. Excludes MediaRecorder, Sendspin, receivers and output.
- **Buffered In sync audio** (`tests/live-latency.integration.ts`, real FFmpeg):
  capture age at scheduled Sendspin playback 2.047 s and 2.020 s.
- **Direct WebRTC after this change**: a scratch page ran Couch's own live session
  and renderer for a publisher and two receivers in three iframes of one headless
  Chromium, against an isolated Core. The publisher's generated canvas stamped its
  capture time into pixel blocks; receivers decoded each presented frame
  (`requestVideoFrameCallback` expected display time, same machine clock).
  One receiver, about 15 s: p50 34 ms, p95 57 ms, max 71 ms. Two receivers, about 15 s:
  p50 78 / 77 ms, p95 106 / 90 ms, max 199 / 123 ms. Core logged `Direct on
  Receiver A, Receiver B` and never asked for an upload. One browser process
  encoded both streams and decoded both on loopback, so these figures say nothing
  about Wi-Fi, a phone, hardware codecs or a real screen.
- An older 200-receiver run (`1d9ede6`) measured simulated PCM delivery on
  localhost; it is not evidence for video, phones or physical playback.

## Still to measure

On the reporter's MacBook and Android Chrome, record the route from `couch.log`,
then source-to-display delay (p50/p95) with a filmed timecode, startup separately
from steady state, dropped frames, publisher CPU, and audio/video alignment, for
one and two receivers, Direct and In sync. If the phone still gathers no ICE
candidates, inspect `chrome://webrtc-internals` there: a browser WebRTC IP policy
or network that blocks UDP needs TURN, and it cannot be fixed by delivery policy.
