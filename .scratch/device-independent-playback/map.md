# Device-independent playback

Status: supported workflows implemented; real software boundaries qualified; external blockers recorded

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
| [03 Groups](issues/03-multiroom-output.md) | Both roles implemented; real browser/group transfer and external PSK peers qualified | PIN server dependency, physical speaker timing and arbitrary receivers. |
| [04 Adaptation](issues/04-media-adaptation.md) | Client HLS/DASH adaptation and caps implemented | Further webpage rendition selection waits for a demonstrated provider need. |
| [05 Core/receivers](issues/05-core-and-receivers.md) | Compiled independent startup/recovery and unit syntax pass | Real systemd boot and physical/platform qualification; no Linux device available. |
| [06 Independent sessions](issues/06-independent-sessions.md) | Implemented | Disk/HTTP/WS isolation and real browser workflows pass. |
| [07 External access](issues/07-internet-access.md) | Real HTTPS/WSS WebKit playback, handoff and revocation pass | Public deployment/WAN routing requires an intended host. |
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

Current results, full decoder/browser/network workload measurements, exact-revision
gate location and each external blocker's next action:
[boundary qualification](boundaries-2026-09-27.md). The user confirms no external
Sendspin server or Linux device is available. The remaining PIN, physical-output,
systemd-boot and public-deployment checks require the specified dependency/environment;
they are not missing implementations of either Sendspin role.

Earlier receipts and archived experiments: [validation.md](validation.md).
