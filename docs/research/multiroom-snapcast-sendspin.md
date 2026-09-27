# Snapcast and Sendspin integration boundaries

Researched: 2026-09-27. This is a source-based architecture investigation, not hardware qualification. **Recommendation** identifies Couch design proposals. Remote-provider media is a primary input; nothing below requires a local-file library.

## Current compatibility and maturity

Snapcast's latest published release is **v0.35.0**, dated **2026-03-10**, and is not marked prerelease. Its current `develop` head inspected here is `4fed179e177b251c67326e7b62a25c8d8fb2d1a9`, dated 2026-06-12. Searching the complete upstream archives for both revisions found no `sendspin` text. The release notes, stream implementations, and advertised protocols provide no evidence of native Sendspin support. This is a bounded finding about these official revisions, not a claim that bridges or downstream forks cannot exist. [Release](https://github.com/snapcast/snapcast/releases/tag/v0.35.0), [inspected development revision](https://github.com/snapcast/snapcast/tree/4fed179e177b251c67326e7b62a25c8d8fb2d1a9)

The Sendspin website identifies the protocol as **Release Candidate 1**, with the specification still being finalized. Its client architecture explicitly separates protocol handling from discovery, audio output, metadata, and UI modules. [Official implementation guide](https://www.sendspin-audio.com/build/guide/)

Music Assistant's current development source integrates Snapcast through its own provider, configurable PCM input, Snapserver control connection, and built-in/external-server choice. Its Sendspin bridge manager describes bridges for AirPlay, Chromecast, and local soundcards. Neither is evidence that Snapcast itself implements Sendspin. [Snapcast provider](https://github.com/music-assistant/server/blob/dev/music_assistant/providers/snapcast/provider.py), [Sendspin bridge manager](https://github.com/music-assistant/server/blob/dev/music_assistant/providers/sendspin/bridge_manager.py)

**Recommendation:** support both through one Couch output abstraction, with separate tested backend adapters initially. Do not promise mixed Snapcast/Sendspin synchronization until a bridge has been verified. Pin backend/SDK versions and qualification results; a live spec is not proof that a deployed SDK implements it.

## Snapcast: a synchronized audio distribution backend

Snapserver accepts PCM from pipes, TCP, processes, and audio capture interfaces. It encodes and timestamps chunks, then distributes them to clients that synchronize their clocks, buffer decoded audio, and correct playback drift. Documented transport codecs include PCM, FLAC, Vorbis, and Opus. The project presents Snapcast as an extension to an existing player, rather than the owner of that player's library and queue. [Snapcast architecture](https://github.com/snapcast/snapcast)

The official integration guide already demonstrates mpv consuming an HTTP radio source and writing headerless PCM into Snapcast's pipe. Thus remote origins fit the established ingestion model. The historical example URL is illustrative, not a service endpoint Couch should adopt. [Player setup](https://github.com/snapcast/snapcast/blob/v0.35.0/doc/player_setup.md)

The binary protocol contains codec headers, timestamped wire chunks, time synchronization, and server buffering settings. That presentation timeline is a different concept from the original item's resume position. [Versioned binary protocol](https://github.com/snapcast/snapcast/blob/v0.35.0/doc/binary_protocol.md)

Snapcast's JSON-RPC controls client volume/latency, group membership, and group stream assignment, with corresponding notifications. `Stream.Control` delegates player operations and exposes unsupported-operation errors; it does not make every PCM input seekable. Stream creation is restricted to listed source types and controlled script locations. [Control API](https://github.com/snapcast/snapcast/blob/v0.35.0/doc/json_rpc_api/control.md)

Its stream plugin interface supplies metadata and source-player capabilities such as play, pause, seek, and next, and forwards control to the actual source player. [Stream plugin API](https://github.com/snapcast/snapcast/blob/v0.35.0/doc/json_rpc_api/stream_plugin.md)

**Recommendation:** run an explicitly managed audio producer for each Couch session assigned to a Snapcast group. Resolve the remote item, decode its selected audio, and feed a private pipe/socket. Core owns queue progression and content position; Snapcast owns distribution timing and actual member state. Prefer this over capturing all desktop audio: system sounds, unrelated users, volume changes, and other players should not enter the session accidentally. PCM is this adapter's ingestion format, not Couch's universal delivery format.

## Sendspin: audio, controls, metadata, and inputs

The current specification defines player, source, controller, metadata, artwork, visualizer, and color roles. The server coordinates groups; controllers operate their current group. Output uses timestamped PCM, FLAC, or Opus frames, with format capabilities negotiated per player. The source role brings timestamped captured audio into the server; it requires explicit server start authorization. It is not a generic remote-provider URL API. [Current protocol](https://www.sendspin-audio.com/build/spec/)

The same specification separates startup lead time, ongoing minimum buffer, and external output delay. Playback timestamps are in the server's monotonic clock domain; clients map them to their clock. Output delay compensates for downstream hardware, while the client handles its own audio processing latency. A client becoming unavailable is removed from active group participation; restoration does not automatically rejoin it. Current transport specifies plain WebSocket carrying Noise-encrypted payloads, with pairing and explicit approval rules; discovery alone does not authorize playback. [Current timing, lifecycle, and security rules](https://www.sendspin-audio.com/build/spec/)

The official time-filter library estimates clock offset **and drift** with a two-dimensional Kalman filter using four-timestamp exchanges. Its documentation recommends burst sampling and explains that ordered transport can correlate packet delays. [Reference time filter](https://github.com/Sendspin/time-filter)

**Recommendation:** a Couch Sendspin adapter should use a maintained server library or an external backend service, not independently recreate clock filtering. Give it decoded or supported framed audio through the backend's actual ingestion API. The protocol's source role is useful for future line-in hardware; it should not replace Couch's provider resolver. Treat negotiated codec choice as an output decision: a remote FLAC source may allow an efficient path, but an arbitrary MP3/HLS URL is not itself a Sendspin audio frame.

## Browser endpoints and security

The official JavaScript SDK supplies a browser player, buffering controls, reconnection, and Noise pairing. It documents 250 ms defaults for startup lead and ongoing buffering, and warns that its default unpaired mode lacks authenticated peer identity against active interception. It also warns that incompatible older pairing implementations fail against the current SDK. These are SDK defaults and compatibility notes, not universal device capabilities. [JavaScript SDK](https://github.com/Sendspin/sendspin-js)

Music Assistant documents its browser player as a Sendspin endpoint, with different local/remote codec policies. This demonstrates an integrated browser path, but its particular quality restrictions are implementation choices. [Music Assistant browser player](https://www.music-assistant.io/player-support/sendspin/#the-web-player)

Snapcast supports audio streaming over WebSocket/WSS as well as control RPC. Its configuration documents TLS and optional client-certificate verification. Music Assistant also documents Snapweb as a browser playback endpoint. [Snapcast configuration](https://github.com/snapcast/snapcast/blob/v0.35.0/doc/configuration.md#https), [Snapcast client options in Music Assistant](https://www.music-assistant.io/player-support/snapcast/)

**Recommendation:** prefer the first-party browser SDK where it fits; test browser output latency, suspension, autoplay, and network changes on supported platforms. Noise inside `ws://` does not automatically solve an HTTPS application's mixed-content restrictions: qualify a supported same-origin proxy/adopted-socket path instead of exposing backend ports directly. Keep Couch account authorization separate from device pairing. The backend service credential must not become a browser user's blanket permission to regroup every speaker, inject audio, or change another household member's session. Use revocable device trust, limited group-control permissions, and deliberate approval for captured inputs.

## Correct Couch model and control flows

**Recommendation:** use `PlaybackTarget = endpoint | outputGroup`. An output group records backend identity, observed members, supported media modes, and synchronization domain. Core retains session ownership, queue, source identity, desired transport state, and resume policy. The backend remains authoritative for actual membership and its presentation clock. Core reconciles backend events instead of maintaining an independently mutable duplicate group.

For an audio group:

1. Core authorizes the user and resolves the provider item into a renewable source descriptor.
2. A delivery plan decides direct retrieval, relay, repackaging, or decoding for this backend; provider credentials remain within the authorized execution boundary.
3. A session-owned producer supplies one content timeline to the backend, which schedules all members.
4. Backend controls route through Core's session command policy; Core changes the producer/queue and publishes observed results.
5. Progress checkpoints use the source presentation position actually heard, accounting for queued output, rather than bytes downloaded or decoded ahead.

Adding a room means joining the existing synchronized output, not starting another logical viewing session. Moving the whole session to another group is a handoff. Moving only one member can leave the original session playing elsewhere and therefore needs explicit product semantics. Never count identical audio reaching four speakers as four independent listening-progress writers.

## Bridging, video, and qualification boundaries

**Recommendation:** a Snapcast–Sendspin bridge needs clock-domain conversion, presentation timestamps, buffering/latency measurement, flush/seek behavior, metadata, and control ownership. Feeding decoded audio from one into the other can distribute sound, but alone does not establish synchronization with the first backend's existing speakers. Use one synchronization authority per mixed group; expose a bridge only after measurement demonstrates it meets the product's tolerance.

Neither surveyed system is a general video-rendering/session-transfer protocol. The architecture implication is that synchronized audio does not by itself synchronize a TV image: Couch must relate media position to the group's output clock and delay video accordingly, including after seek and buffer changes. HDMI passthrough and surround layouts need explicit capability checks. Start with music groups; gate TV audio plus distributed speakers on measured lip-sync support.

Qualification should cover two unlike endpoints, local TV output included in the same group, long-run drift, late joins, seek/flush, backend restart, member loss, browser suspension, variable Wi-Fi latency, paired/unpaired rejection, and conflicting local controls. Measure sound at outputs; matching timestamps in logs is insufficient. Keep direct single-target video/browser delivery available independently of either multiroom backend.
