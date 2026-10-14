# Live sharing performance

Investigated 2026-10-14 against `35ffee9` (`v0.3.1-preview.4`), a report of a MacBook
screen shared to one Android Chrome receiver playing at least ten seconds behind,
where earlier builds had been much faster. The resulting decision is
[ADR 0001](adr/0001-live-inputs-play-over-webrtc-unless-in-sync.md); synchronization
research is in [live-sync-research.md](live-sync-research.md).

## What changed between builds

Recovered from the original Mac Git stores and T3 history on 2026-10-14 (handoff
`START-HERE.txt` and `reports/RECOVERY.md`); no experiment was rerun.

- `5c7ccd4` (October 12) sent WebRTC from the publisher to every receiver.
  `583c849` added authenticated TURN and LAN STUN; TURN TCP is still WebRTC media.
- `5c0f3fc` replaced it, even for one receiver, with a recording uploaded to Core,
  encoded by FFmpeg into one-second HLS segments, with Sendspin scheduling sound
  one second ahead and pictures following its clock.
- `f5f7a0ab5951837e4fb50c6d099845a8ee3ccc8e` restored direct WebRTC in the normal
  player for one receiving device, keeping HLS/Sendspin whenever outputs spanned
  devices and the upload warm for every source. The user ran this build when they
  wrote "this is WAAAY BETTER NOW!" (2026-10-13 13:08:37Z, T3 thread
  `cfca5168-d65e-4d3a-8a3d-fe48f03c4cb4`, Validate live screen sharing). That is a
  qualitative phone confirmation, not an Android measurement.
- `35ffee9` also moved a single receiver to HLS/Sendspin after a failed
  negotiation or a 10-second connection timeout, for the rest of the publication.
  That "relay" is Couch's buffered stream, not TURN-relayed WebRTC.

A local Linux commit `71da5d0` (same subject and author time as `5c7ccd4`, parent
`1d9ede6`, also WebRTC) resolves in this repository but has a different tree and
parent; it was not in the Mac stores the recovery searched, so nothing above
relies on it.

These differences can explain multi-second delay, but the reporter's route was
never observed: their `couch.log` (`Direct on`, `Synced on`, `couldn't connect
directly`) and a physical measurement are still needed. Nothing here proves the
cause on their devices, or that this change removes their delay.

## Measurements

### Recovered, at `f5f7a0a`

Real Mac screen capture to a local packaged Electron receiver, video frame age
from a timestamp drawn on the screen, about 15 s and 58 samples each, receiver
muted. Neither is a phone or acoustic measurement.

- **Direct**: p50 73 ms, p95 87 ms, zero dropped frames
  (`real-mac-glass-rtc-final.json`).
- **Authenticated TURN over TCP**: p50 70 ms, p95 94 ms, zero dropped frames
  (`real-mac-glass-turn-tcp-final.json`; the disposable receiver was forced off
  non-proxied UDP).
- **In sync group** (HLS/Sendspin, despite the file name): 128 identical scheduled
  chunks and a 0.072 ms difference between the clients' software timeline anchors
  (`normal-live-group-rtc-final.json`). That says nothing about physical speaker
  or Android alignment.

`rtc-source-flow-validation.json` binds these to the commit. No numeric
MacBook-to-Android latency or sync, and no synchronized WebRTC implementation,
was recovered.

### Local synthetic, measured on 2026-10-14

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
candidates, inspect `chrome://webrtc-internals` there for the gathered candidates
and the selected pair. TURN keeps a receiver direct only when its browser can
reach a configured relay; whether it did shows in that selected pair.
