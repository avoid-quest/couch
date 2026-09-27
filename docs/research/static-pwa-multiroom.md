# Static PWA and synchronized multiroom

Researched 2026-09-27 against current official documentation. Architecture recommendations below are deductions, not hardware qualification. Companion: [protocol integration details](multiroom-snapcast-sendspin.md).

## Decision

**Couch can be a static PWA for ordinary playback and control. Reliable existing-speaker multiroom does not require a Couch cloud service, desktop application, or Rust specifically. It does require an active synchronization coordinator and audio producer somewhere during playback.** An optional local hub is the simplest established implementation; it could run on an existing computer, NAS, or capable speaker. “No Couch server” and “no active coordinating component anywhere” are different requirements.

Mostly unauthenticated remote sources remove much credential handling. They do not remove browser format support, cross-origin restrictions, or synchronization work. A URL playable in a media element is not necessarily readable as samples: Web Audio must silence a media-element source whose resource is CORS-cross-origin. This matters if Couch wants to redistribute its decoded audio. [Web Audio security rule](https://webaudio.github.io/web-audio-api/#MediaElementAudioSourceNode-security)

## Existing protocols: receiver is not producer

Snapcast uses Snapserver to encode, timestamp, and distribute a source; clients buffer audio, synchronize clocks, and correct drift. Snapweb browser playback proves a browser can be a receiver, not that it replaces Snapserver. Snapcast offers WebSocket streaming/control, but its documented audio source inputs are separate from the downstream receiver transport. [Snapcast architecture](https://github.com/snapcast/snapcast), [configuration](https://github.com/snapcast/snapcast/blob/v0.35.0/doc/configuration.md)

Sendspin's JavaScript SDK exposes a browser player, server commands, decoded chunks, and Web Audio scheduling. Its documented API is a client implementation, not a ready-made browser server or remote-URL broadcaster. Browser synchronized playback is therefore real, while server implementation remains a separate responsibility. [JavaScript SDK](https://github.com/Sendspin/sendspin-js)

Sendspin defines a coordinating server, timestamped output, clock mapping, buffering, and output-delay compensation. Its source role uploads captured audio after server authorization; it is not a generic “play this URL” API. Clients normally have one admitted authority, with a pairing exception; competing servers are arbitrated, not merged into one clock. [Current specification](https://www.sendspin-audio.com/build/spec/)

SDK availability is not compatibility proof: the official catalog currently labels JavaScript, Go, Python, Rust, and other SDKs **Pre-RC1**, while the current specification is RC1. Pin and test actual revisions. Go's official repository already provides server examples, custom sources, and HTTP MP3/HLS ingestion, demonstrating that Rust is optional; those examples do not establish RC1 compliance. [SDK catalog](https://www.sendspin-audio.com/build/sdks/), [Go server](https://github.com/Sendspin/sendspin-go)

## Could a browser be the leader?

**In principle, yes.** WebRTC provides peer connections and data channels; Web Audio provides scheduled rendering. Couch could define its own leader, timestamped sample transport, clock-offset/drift estimation, jitter buffers, output-latency calibration, and resampling corrections. Independent HTML audio players receiving simultaneous “play” commands are not that system. WebRTC transport alone does not guarantee equal acoustic output time across multiple devices. [WebRTC specification](https://www.w3.org/TR/webrtc/), [Web Audio specification](https://webaudio.github.io/web-audio-api/)

A browser-only mesh would need rendezvous/signaling or a manual exchange, ICE connectivity handling, membership, leader loss, clock discontinuity recovery, and conflicting-control policy. STUN/TURN needs depend on connectivity; they are not inherently cloud-account requirements. This is a custom distributed audio product, not a smaller use of Snapcast/Sendspin. A leader-centered topology is sufficient; all-to-all audio is unnecessary. These are design deductions from WebRTC's connection model. [WebRTC connection establishment](https://www.w3.org/TR/webrtc/#peer-to-peer-connections)

Ordinary PWAs cannot accept arbitrary inbound TCP/WebSocket connections or perform general UDP multicast/mDNS discovery through standard web APIs. WebSocket exposes an outgoing connection API. Chrome's Direct Sockets adds TCP listeners and UDP, but for Isolated Web Apps, a different deployment model from a portable static PWA. [WebSocket API](https://websockets.spec.whatwg.org/), [Direct Sockets](https://developer.chrome.com/docs/iwa/direct-sockets)

There is an important Sendspin exception: its server-initiated mode lets the coordinator open outgoing WebSockets to listening players. A browser could implement that protocol role against known device addresses, subject to browser security restrictions. It would still need server logic, and would not implement the full server contract requiring both connection modes and mDNS. Browser-to-browser use needs another transport because neither ordinary browser listens. Current Sendspin mandates plain WebSocket with Noise encryption; this does not itself waive HTTPS mixed-content restrictions. [Connection modes and security](https://www.sendspin-audio.com/build/spec/)

Browser lifetime also matters: browsers/OSes can suspend or discard pages. Active audio/WebRTC receives special treatment in Chrome, but is not an unconditional survival guarantee. A service worker is event-driven and terminable, not an always-running audio daemon. [Page lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api), [service worker lifetime](https://www.w3.org/TR/service-workers/#service-worker-lifetime)

## Can the PWA feed an existing hub?

Yes, with a supported ingestion path. The simplest proposal is sending a resolved URL to the hub's application API and letting the hub fetch/decode it. Snapcast documents mpv fetching HTTP audio and writing PCM to its pipe; an additional application owns that producer. A browser could instead upload permitted decoded audio through a browser-accessible ingestion adapter, or implement Sendspin's source role where supported. Do not mistake Snapcast's receiver WebSocket or Sendspin's player SDK for an upload endpoint. [Snapcast producer example](https://github.com/snapcast/snapcast/blob/v0.35.0/doc/player_setup.md), [Sendspin source specification](https://www.sendspin-audio.com/build/spec/)

## Practical choices

1. **Smallest Couch:** static PWA, browser-compatible remote sources, single-device playback; omit synchronized multiroom initially.
2. **Established multiroom:** static PWA plus optional existing local hub/backend. Keep one queue/command authority and one synchronization authority per group. No cloud account is intrinsically needed; local device trust still matters. The hub need only run during playback, or stay available if playback must survive closing Couch.
3. **Zero backend experiment:** browser leader and WebRTC peers; measure actual acoustic alignment, long-run drift, suspension, late joins, and leader loss before promising reliability.

Recommendation: choose option 1 with option 2 as an optional capability. Native decoding, low-level audio/device access, or HDMI passthrough may justify a native adapter for specific targets; multiroom alone does not justify making every Couch installation desktop/Rust. TV lip-sync and surround are separate qualification work, not automatic benefits of synchronized music.
