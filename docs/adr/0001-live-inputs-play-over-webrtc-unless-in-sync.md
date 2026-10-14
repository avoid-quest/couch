---
status: accepted
---

# Live inputs play over WebRTC unless In sync is chosen

A shared screen or sound has to stay interactive, so every receiver gets the capture over WebRTC with its picture and sound together, however many receivers there are. Couch's buffered path (a recording uploaded to Core, FFmpeg HLS, the Sendspin clock) is used only for a playback where someone chose **In sync**, which trades seconds of delay for devices playing together, and for a receiver that couldn't connect directly, which Where it plays marks **Buffered**; neither is ever chosen because the receiver count rose.

## Consequences

- Without In sync, devices are not aligned with each other. This is a limit of today's browser playout, not of WebRTC: a `MediaStream` element can't be seeked or rate-adjusted, and `jitterBufferTarget` is a hint, not a shared deadline. Low-latency synchronized live audio and video remains the goal; it needs a common capture clock, per-receiver presentation deadlines, controllable scheduling and output compensation, measured on real devices before it replaces the buffered path ([research](../live-sync-research.md)).
- The buffered path is today's implementation of In sync and of compatibility, not the permanent synchronization design. Core records and encodes while an In sync playback or a connected fallback receiver needs the source. In sync keeps its stream while paused, including while waiting for offline outputs to reconnect; stop that playback or turn In sync off to release it when no other playback or fallback receiver needs it.
- A receiver that can't connect directly gets the buffered stream on its own; the other receivers keep their peers. TURN (`COUCH_LIVE_TURN_*`) can keep such a receiver interactive when its browser can reach the relay; no timestamp scheme fixes a connection ICE can't establish.
- The publisher encodes once per receiver. A forwarding relay (SFU) is added only when measured receiver counts or publisher load justify it.
