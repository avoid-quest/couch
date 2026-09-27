# Device-independent playback

Status: implementation complete for supported workflows; qualification limits below

## Current direction

Clients fetch, decode and render supported sources directly. Core owns authorization,
queue/session intent, persistence and output assignment. Idle controllers fetch no
media. Group backends own synchronization. Preserve the existing app presentation.

The user explicitly abandoned new Jellyfin work on 2026-09-27. Existing native
provider support remains compatible; new Core browser relays/adaptation are removed.
The uncommitted HLS experiment is preserved in stash
`6b5303026b2056bdbf34fb39efd05923bac7de72`, with ignored qualification artifacts.
It is not an implementation dependency or a priority for future agents.

## Existing backlog

| Issue | Current state | Completion still needed |
| --- | --- | --- |
| [01 Handoff](issues/01-browser-tv-handoff.md) | Implemented | Hardware qualification remains separate. |
| [02 Client sources](issues/02-remote-source-compatibility.md) | Implemented | Physical/platform qualification remains separate. |
| [03 Groups](issues/03-multiroom-output.md) | Snapcast and optional Sendspin host/client implemented | Physical speaker drift/latency and arbitrary receiver qualification. |
| [04 Adaptation](issues/04-media-adaptation.md) | Client HLS/DASH adaptation and caps implemented | Further webpage rendition selection waits for a demonstrated provider need. |
| [05 Core/receivers](issues/05-core-and-receivers.md) | Implemented | Host boot and physical/platform qualification remain separate. |
| [06 Independent sessions](issues/06-independent-sessions.md) | Implemented | Disk/HTTP/WS isolation and real browser workflows pass. |
| [07 External access](issues/07-internet-access.md) | Admission/proxy implemented | Actual browser topology qualification. |
| [08 UI parity](issues/08-shared-ui-parity.md) | Session/group flows checked | Physical desktop/TV platform qualification remains separate. |

## Coordination

The active PR chain includes independent sessions #629, TypeScript Sendspin hosting
#631 and official JS Sendspin client #632, followed by this validation handoff. The Python
Sendspin experiment (#628) is closed and preserved on
`archive/sendspin-python-20260927`; it is removed from the application. The user
requires both independent optional roles: clients join an existing server, and Core
can host groups. Both are implemented. Hosting is opt-in; Couch enrollment provisions
owner-bound PSKs. Host interoperability uses AES-GCM; its library lacks PIN server
onboarding. The client uses official pairing when connecting to an external server.
Nothing is merged or released. Existing main remains `3bd72c7d` after fetch.

Runtime costs: client video decoding/rendering is the main direct-play workload.
Core source resolution is transient; group PCM decoding/distribution is the central
media workload. Ordinary direct playback keeps provider traffic on renderers. Hosted
group PCM is 192 kB/s per receiver before overhead. Do not infer physical performance
or total decoding cost from the Core-only process measurements below.

Detailed existing receipts and unqualified environments: [validation.md](validation.md).

Current code receipt `07f91ecf`: 1,804 core tests plus three clock tests pass, ten
environment/network tests skip; typecheck and production build pass. Compiled macOS
Core accepts the encrypted SDK and serves all 58 embedded assets byte-identically.
Real browser tests cover independent VOD/live playback, mode roundtrips, explicit
takeover, move back, existing desktop/TV-sized layouts, Sendspin group controls,
explicit join/leave and Leave while Core is offline. Coordination
benchmark: two simulated renderers plus 20 idle controllers, 1.01% of one CPU core,
70.94–73.50 MB RSS, command p95 1.49 ms. Actual two-client Sendspin software playback:
1.74% Core CPU, 115.31–120.80 MB RSS over 15 seconds, excluding FFmpeg/browser CPU.
Two Web Audio graphs passed pause/seek/speed/Stop; physical speakers remain unqualified.
Detailed receipts remain in validation and ignored artifacts.
