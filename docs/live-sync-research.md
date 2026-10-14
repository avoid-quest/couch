# Live sharing and synchronized playback

Research date: 2026-10-14. This note informs the live-delivery ADR; it is not a latency benchmark. Snapcast sources below are pinned to `0ac550845781b41c4643895b79c8a08fb948009f`. Sendspin implementation findings use Couch's installed, pinned packages, rather than assuming the moving protocol specification matches those packages.

## Recommendation

Keep both capabilities in one product: WebRTC audio/video together for responsive live sharing, and an explicit synchronized playback policy using Couch's existing Sendspin clock and players. Borrow Snapcast's scheduling principles, without adding another audio protocol. Preserve the existing synchronized/compatible route while improving its ingestion separately. Do not silently change a live screen share into buffered playback merely because another receiver joins or a direct connection fails.

This follows the earlier live-input research (`docs/live-input-research.md` in local commit `71da5d0`, never published): source latency, inter-device skew, and audio/video alignment are separate requirements. A common timestamp can express a desired playback instant; receivers still need enough advance notice, clock correction, and control of actual output timing to meet it.

## What Snapcast actually does

- Snapserver encodes audio chunks, tags them with capture timestamps, and sends them to clients. Clients continuously synchronize their clocks, decode into a buffer, and schedule audio against server time. This is an **audio** design, not a synchronized video renderer. Its native clients use low-level audio APIs including Core Audio and Android Oboe. [README](https://github.com/snapcast/snapcast/blob/0ac550845781b41c4643895b79c8a08fb948009f/README.md), [wire protocol](https://github.com/snapcast/snapcast/blob/0ac550845781b41c4643895b79c8a08fb948009f/doc/binary_protocol.md).
- The server's documented default is a **1000 ms** end-to-end buffer and **20 ms** source chunks. These are configuration defaults, not a minimum or a measured Couch result. Tight alignment therefore does not imply negligible delay behind the source. [Configuration](https://github.com/snapcast/snapcast/blob/0ac550845781b41c4643895b79c8a08fb948009f/server/etc/snapserver.conf#L206).
- Clock offset estimation uses the bidirectional timing exchange. The player accounts for the audio backend's reported time until output, adjusts drift by inserting/removing frames, and can discard stale audio during resynchronization. Sample-format resampling also exists, but it is inaccurate to describe the entire synchronization mechanism simply as resampling. [Clock](https://github.com/snapcast/snapcast/blob/0ac550845781b41c4643895b79c8a08fb948009f/client/time_provider.cpp#L36), [frame correction and playback scheduling](https://github.com/snapcast/snapcast/blob/0ac550845781b41c4643895b79c8a08fb948009f/client/stream.cpp#L208).

The reusable principle is **shared clock + timed chunks + bounded buffering + drift correction + output-latency accounting**. Copying only the timestamp field omits most of the synchronization system. Snapcast's reported synchronization precision is not a promise for Android Chrome or Couch.

## Couch already has this foundation

[package.json](../package.json) pins `@sendspin/sendspin-js` **5.0.0** and `@sonn-audio/node-sendspin` **0.6.2**. The exact published packages are primary sources: [player archive](https://registry.npmjs.org/@sendspin/sendspin-js/-/sendspin-js-5.0.0.tgz), [server archive](https://registry.npmjs.org/@sonn-audio/node-sendspin/-/node-sendspin-0.6.2.tgz).

- [The server](../src/server/sendspin.ts) already sends identical scheduled timestamps to grouped speakers and publishes a common picture timeline. It decodes once and encodes once per selected wire format, rather than transcoding independently per receiver. Its current scheduling lead is **1 second**; its **8-second** decoded queue limit is backpressure, not eight seconds of mandatory presentation delay. Opus packets are 60 ms and PCM chunks are 100 ms.
- The pinned JS player's `dist/audio/scheduler.js` translates timestamps into Web Audio scheduling, accounts for output latency, and supports sample corrections, playback-rate correction, and larger resynchronizations. Its README exposes `requiredLeadTimeMs` and `minBufferMs`, both defaulting to **250 ms**, as declarations to the server. Do not blindly add those figures to the server lead as separate fixed delays. The pinned server's `SendspinSession.getPlayerTiming()` exposes these declarations and static delay; Couch should use them when designing a live-specific scheduling budget.
- [The client](../src/client/session/sendspin.ts) already exposes the synchronized media position; [picture-clock.ts](../src/client/session/picture-clock.ts) uses a maintained synchronizer to adjust a seekable picture's rate or position. Reuse these responsibilities rather than inventing a second clock service.
- Direct authenticated capture ingestion is not a ready-made switch: the **0.6.2 server README** explicitly says its `source@v1` role cannot yet be used over encryption because pairing/trust support is incomplete. Source hooks alone do not prove a usable integration with Couch's encrypted admission. A narrowly scoped authenticated ingestion adapter or a verified upstream upgrade is needed; do not bypass admission.

The [current Sendspin specification](https://github.com/Sendspin/spec#clock-synchronization) also describes clock offset/drift filtering and timed audio, but it is moving documentation, not evidence that every feature is available in Couch's pinned SDKs.

## Why WebRTC timecodes alone cannot provide synchronized screens

WebRTC's `RTCRtpReceiver.jitterBufferTarget` requests a buffering duration. The browser may clamp or change the actual target; this is not an API to present frame N at a specified group wall-clock instant. The specification also coordinates the target of locally synchronized audio/video tracks. [WebRTC specification](https://w3c.github.io/webrtc-pc/#dom-rtcrtpreceiver-jitterbuffertarget).

A media element playing a `MediaStream` is not seekable; setting its `currentTime` or `playbackRate` must be ignored. Consequently Couch cannot apply its existing URL-video clock follower directly to a live WebRTC track. [Media Capture specification](https://w3c.github.io/mediacapture-main/#mediastreams-in-media-elements).

Cross-device synchronized live A/V therefore needs a verified presentation mechanism for both tracks: common capture-to-presentation mapping, scheduled audio, controllable video buffering/display, bounded recovery, and output calibration. WebCodecs/native rendering are investigation candidates, not a small proven patch. An SFU can reduce publisher fanout work but does not itself schedule independent displays. Do not mix immediate WebRTC video with deliberately delayed Sendspin audio and assume lip sync will survive.

## Smallest safe sequence

1. Restore WebRTC as the live A/V default for one or several receivers. Keep synchronized playback and compatibility available deliberately, retain existing routing/capture features, and report the active delivery policy. Diagnose Android Chrome's missing ICE candidates separately: timecodes cannot establish a connection that ICE cannot establish.
2. Start buffered recording/transcoding only when that route has an actual subscriber; stop it when unused. Keep audio and video together on each interactive receiver. Preserve the existing synchronized path until a replacement is verified.
3. Improve synchronized **audio** ingestion next: avoid an HLS intermediary where capture can enter the existing authenticated audio scheduler directly. Reuse one clock, encode once per required format, retain bounded queues, honor receiver timing declarations, and define stale-chunk/drop/resync behavior. Tune a live-specific lead only after measuring underruns and output latency on target receivers.
4. Treat synchronized live **video** as a separate measured extension. Retain the working seekable/buffered picture path in the meantime. Adding a bespoke browser renderer or a native dependency is justified only by a demonstrated capability gap and successful prototype.

Verification must cover route selection, no unused transcoder, multiple receivers and late joins, source stop/disconnect, permission and admission behavior, bounded backlogs, and synchronized-mode retention. On the actual MacBook and Android Chrome, measure source-to-display delay, audio/video alignment, inter-device skew, sustained drift, underruns, CPU and network use. A local software test can validate routing and queue bounds; it cannot establish physical playback synchronization or claim the reported ten-second regression is fixed.
