# Playback architecture

[The product contract](playback-product.md) owns behavior and acceptance;
[the glossary](../CONTEXT.md) owns application language. This document records
implementation seams and current qualification. The earlier
[architecture](architecture-playback-2026-09-27.md)
and [issue answers](../.scratch/device-independent-playback/issues/) are historical.

## Runtime placement

Couch Core owns Library access, authorization, persistent Playback and assignments.
It can run without a local player. The standalone desktop bundles Core and its native
player; a browser or an additional paired native client can connect to another Core.
Browser, desktop and TV use the same application window/navigation/player model.
Connecting a window to a Library, selecting a Playback in that window, and assigning
Devices to the Playback are separate operations. Opening a window does none of the
last two implicitly. Local hardware controls belong to the named machine; its
installation maintenance stays local.

The implementation currently uses these seams:

| Seam | Responsibility |
| --- | --- |
| `src/server/playback-catalog.ts` | Durable Playback IDs, owners, device selections and each client default. |
| `src/server/session.ts`, `progress.ts`, `session-store.ts` | Queue, current occurrence, intent, progress, tracks, watching state and checkpoints for one Playback. |
| `src/server/playback-devices.ts` | Assignment interface: Device list, occupied state, synchronized audio membership, per-device adjustment and assignment transactions. |
| `src/server/playback-targets.ts` | Renderer registration, attempts, claims, observed state and confirmed handoff. |
| `src/server/sendspin.ts`, `sendspin-playback.ts` | Encrypted host connections and an independent decoded audio timeline per Playback. |
| `src/server/hub.ts` | Authenticated HTTP/WebSocket selection, routing and source access. |
| `src/client/session/session.ts`, `session-context.tsx` | Window selection and connection above route lifetime; renderer registration stays attached while the window selects another Playback. |
| `src/main.ts`, `src-tauri/src/player.rs` | Optional Core process and native libmpv command/observation path. |
| `src-tauri/src/native_receiver.rs`, `src/client/session/device-audio.ts` | Native renderer and audio reservations, independent of the window's selected Playback. |

The `PlaybackRecord` ID is the stable identity. Library pairing grants playback
control; administrator permission is separate. The record's `owner` records default
and migration provenance, and its `storageKey` chooses existing per-Playback state.
The `playback_defaults` row is a
client convenience pointer; successfully assigning a new Playback changes that pointer without
mutating an earlier queue. Legacy `household`/`personal` request selectors and
`personal:<client-id>` stores are migration aliases, not product modes. Preserve
existing SQLite files, checkpoints, queue occurrences, progress and pairings when
migrating. Restored intent stays resumable without claiming hardware or autoplay.
The browser profile stores credentials per origin; a different origin/profile needs
its own pairing. The window's selected Playback is retained in session storage for
refresh, scoped to the same credentials; changing that view never assigns a Device.

## Assignment and media

`createPlaybackDevices` takes a Playback runtime and desired Device IDs. It validates
availability, occupation, audio compatibility and gesture readiness, then uses the
renderer registry to prepare and move. A direct renderer or multiple compatible
audio devices are implementation choices behind that same assignment. One Playback
can use several synchronized audio Devices; multiple Playbacks get separate Sendspin
timelines. Device ownership is global so a Device cannot silently join competing
Playbacks. The serialized `sendspin:<playback-id>` target is internal and never a
user-facing destination. Removing down to one direct-capable Device moves the
current item back to its ordinary player, so the next video has no lingering
audio-only backend. Standalone audio-only endpoints retain their Sendspin adapter.

The registry fences late observations by authenticated connection and playback
attempt. Moving prepares the destination paused, checks compatible tracks and seek,
observes a source checkpoint, verifies the destination, then retires the source.
The selected Device keeps its own volume. Native system gain remains on that
machine; managed client gain is converted at the Sendspin boundary and confirmed
before its stream starts. Device faders and shared volume call the same assignment
service. Off devices keep their last observed level in the mixer. Failure keeps the source running when safe
or reports an uncertain, recoverable state. A browser gesture belongs to that
Device's action. Closing a control-only window does not stop a remote renderer;
loss of an active renderer leaves resumable intent. Receiver leases and restart
fences prevent stale native playback from becoming a second owner.

A committed video move to a native Device selects and presents that Playback once
in its existing window. Preparation, initial connection, audio membership and later
browsing do not redirect the window. Native HLS track metadata exposes equivalent
bitrate renditions as one audio choice while preserving distinct named/language
tracks and original decoder indices.

Before replacing media in shared audio, Core resolves and validates the candidate
without changing the current queue or stopping its producer. A capability failure
returns an actionable playback error through both command and HTTP entry points.

The native window can browse another Library while this installation's Core keeps
running. Core ownership of libmpv is independent of the selected Library: enrollment
alone does not claim or stop it. Before adding a native Device to Sendspin, its owning
client reserves the machine's audio output. That reservation permits the same Core's
verified direct/audio handoff and blocks another Core from starting competing output.
Expiry fences the output until the SDK disconnects and acknowledges release. Closing
or changing the controlled Playback does not retire the SDK. Switching Libraries while
this window supplies audio or remote native playback requires an explicit stop-and-switch
action; other Devices continue. A persistent audio client spanning several Libraries
is not implemented.

An independent Core process needs no window. The desktop-bundled Core still has the
application's lifetime: explicit Quit stops it. Installing and managing an independent
background Core through the desktop UI remains unimplemented.

Ordinary selected clients fetch and decode supported media; control-only clients
fetch no media. Native playback retains its provider paths. The browser uses direct
compatible HTTP(S) media and maintained HLS/DASH playback with track, quality and
live/DVR limits. Unsupported sources remain explicit. New Jellyfin relay/adaptation
is outside the contract. Core may decode bounded PCM for Sendspin audio; the
maintained host and client dependencies own encryption, protocol and synchronization.
The Sendspin host tracks devices globally but creates one producer per Playback.
Normal hosting uses an OS-assigned port returned by authenticated enrollment, so
another library on the same computer needs no manual port coordination. Explicit
existing server configurations keep their configured address.
SDK stop/clear and bounded drain are software-output evidence, not physical speaker
silence or measured acoustic synchronization.
The client SDK has no stream-start fade option. The PCM adapter therefore applies
a 10 ms fade to each new listener's first block, keeping its timestamp and every
ongoing listener's samples unchanged. This is an audible-transition mitigation;
the reported phone pop still needs physical confirmation on the rebuilt app.

## Qualification still open

The replacement model has targeted built-app observations and **no complete
acceptance across the contract yet**. [The active matrix](../.scratch/device-independent-playback/map.md)
tracks fresh/migrated installs, window selection, independent Core, browser/native
clients, simultaneous Playbacks, multi-device audio, moves, recovery, sources and
resource measurements. Earlier tests and receipts remain historical evidence for
specific regressions. Paired-device disclosure of shared control, migration of all
checkpoint/device aliases, failure recovery and actual hardware results must be
checked against the current implementation before claiming this contract works.

Couch access remains local computer/home-network only; Internet media sources are
valid. Optional local HTTPS uses the same pairing boundary. Public deployment,
Snapcast, Python Sendspin, third-party PIN onboarding and new Jellyfin adaptation
are outside scope.
