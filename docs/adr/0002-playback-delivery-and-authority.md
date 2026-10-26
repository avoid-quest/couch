---
status: accepted
---

> **Scope provenance:** accepted playback authority decision recovered from
> `8147fc98fbeda5b415c3351a10a98c7cab816d4a`. The
> [integration ledger](../player-modes-integration-ledger.md) owns implementation
> and fresh validation status; this decision does not certify qualification.

# Core decides delivery and programme authority independently

A Playback has one programme and queue, while its controller, publisher and receiving devices can be different. Core derives delivery from publication intent, prepared source capabilities and consented picture/sound assignments, and publishes actor-specific control capabilities. Joining live audio grants reception and local listening controls; it never grants programme controls. This replaces receiver-count and `inSync` inference spread across command entry points and clients. `inSync` remains the persisted preference for relaxed captured A/V; absent publication intent means relaxed, and live publications/admission remain runtime-only.

Native media renders ordinary single-destination playback. Scheduled audio shares receiver preparation, clock exchange and fanout, with separate read-ahead and fixed-deadline sender policies: capture cannot manufacture future samples or move everybody's deadlines for a late listener. Core owns route/source generations, while each renderer/sender owns and cancels its resources. Asynchronous preparation must recheck both generation and authority before changing outputs. Source timestamps and scheduling use integer microseconds; media positions use seconds; hardware correction uses milliseconds, positive to compensate a late output by scheduling earlier. Content A/V delay is separate.

The existing picture follower remains a relaxed timeline follower, with explicit mapping limitations. WebRTC/TURN and buffered captured-video HLS retain the capabilities documented in [ADR 0001](0001-live-inputs-play-over-webrtc-unless-in-sync.md); they are not a live-audio fallback. Browser capability checks establish technical admission, not measured input-to-ear latency or physical synchronization. The 100 ms and 50-receiver goals require separate qualification evidence.
