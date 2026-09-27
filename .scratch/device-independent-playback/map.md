# Device-independent playback

Status: active

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
| [03 Groups](issues/03-multiroom-output.md) | Snapcast implemented | Sendspin adapter, pairing and qualified recovery/transfer. |
| [04 Adaptation](issues/04-media-adaptation.md) | Revised scope | Client capability/rendition selection; conversion only for a new demonstrated need. |
| [05 Core/receivers](issues/05-core-and-receivers.md) | Implemented | Host boot and physical/platform qualification remain separate. |
| [06 Independent sessions](issues/06-independent-sessions.md) | Implemented | Disk/HTTP/WS isolation and real browser workflows pass. |
| [07 External access](issues/07-internet-access.md) | Admission/proxy implemented | Actual browser topology qualification. |
| [08 UI parity](issues/08-shared-ui-parity.md) | Existing flows checked | Extend checks for new session/group controls. |

## Coordination

The active native stack is #630, through independent-session PR #629. The Python
Sendspin experiment (#628) is closed and preserved on
`archive/sendspin-python-20260927`; it is removed from the application. The user
requires both optional Sendspin roles within TypeScript/Rust: clients join an
existing server, and Core can host groups. Planned owning layers are Sendspin host
then Sendspin client. Official SDK client interoperability with a TypeScript host
library is being qualified. Nothing is merged or released.

Runtime costs: client video decoding/rendering is the main direct-play workload.
Core source resolution is transient; group PCM decoding/distribution is the central
media workload. Measure concurrent sessions and idle controllers after integration,
including CPU, memory, Core network traffic and command latency. Do not infer
performance from passing functional tests.

Detailed existing receipts and unqualified environments: [validation.md](validation.md).

Current receipts: 1,771 core tests pass, ten environment/network tests skip; typecheck
passes. Real browser tests cover independent VOD/live playback, mode roundtrips,
explicit takeover, move back and unchanged desktop/TV-sized layouts. Coordination
benchmark: two simulated renderers plus 20 idle controllers, 1.01% of one CPU core,
70.94–73.50 MB RSS, command p95 1.49 ms. These numbers exclude media decoding and
physical output costs. Detailed receipts remain in validation and ignored artifacts.
