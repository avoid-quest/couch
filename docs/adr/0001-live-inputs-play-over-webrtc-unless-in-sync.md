---
status: accepted for captured video and legacy audio compatibility
---

# Live inputs play over WebRTC unless In sync is chosen

A relaxed shared screen, or an audio publisher without timestamped capture, uses WebRTC with its selected picture and sound channels, however many receivers there are. Timestamped audio inputs and AirPlay instead use scheduled sound even with one listener. Live audio uses source-owned capture and fixed browser deadlines; [ADR 0002](0002-playback-delivery-and-authority.md) defines that authority and delivery policy. Couch's buffered path (a recording uploaded to Core, FFmpeg HLS, the Sendspin clock) is used only for a playback where someone chose **In sync**, which trades seconds of delay for devices playing together, and for a receiver that couldn't connect directly, which Where it plays marks **Buffered**; neither is ever chosen because the receiver count rose.

## Consequences

- Without In sync, devices are not aligned with each other. This is a limit of today's browser playout, not of WebRTC: a `MediaStream` element can't be seeked or rate-adjusted, and `jitterBufferTarget` is a hint, not a shared deadline. Scheduled Live audio now has a common capture clock and receiver deadlines; its physical latency and alignment still require measurement. A synchronized low-latency video engine remains outside this integration ([research](../live-sync-research.md)).
- The buffered path is today's implementation of In sync and of compatibility, not the permanent synchronization design. Core records and encodes while an In sync playback or a connected fallback receiver needs the source. In sync keeps its stream while paused, including while waiting for offline outputs to reconnect; stop that playback or turn In sync off to release it when no other playback or fallback receiver needs it.
- A receiver that can't connect directly gets the buffered stream on its own; the other receivers keep their peers. TURN (`COUCH_LIVE_TURN_*`) can keep such a receiver interactive when its browser can reach the relay; no timestamp scheme fixes a connection ICE can't establish.
- The publisher encodes once per receiver. A forwarding relay (SFU) is added only when measured receiver counts or publisher load justify it.
