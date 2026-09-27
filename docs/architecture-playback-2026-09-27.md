# Current architecture

> Historical 2026-09-27 playback-model record. Use [the replacement contract](playback-product.md) and [active matrix](../.scratch/device-independent-playback/map.md) for current work.

Couch runs on the local computer and home network. Core coordinates its UI clients,
playback targets and media delivery. Internet hosting is outside the product scope. The
browser uses the shared application UI: it can control another target or render
locally. Desktop/TV presentation, access permissions and playback location are
independent choices. [The glossary](../CONTEXT.md) defines these terms.

Preserve the existing app experience: window model, navigation, player layout,
desktop/TV presentation and design system. Extend those workflows with output
selection and broader delivery support. Separating runtime responsibilities does
not call for a new shell, window concept or replacement application.

## Runtime roles

The agreed model supports these compositions on Windows, Linux and macOS:

| Composition | Responsibility | Current implementation |
| --- | --- | --- |
| Core only | Library, integrations/tools, persistence, authorization and sessions; no local player required. | `bun src/main.ts` runs without a native command channel and advertises no native target. The compiled executable runs independently with the documented Linux systemd unit. |
| Core plus local UI/renderer | The same server capabilities, with local screen, HDMI and sound through native playback. | Tauri launches the Bun sidecar and libmpv worker. The bundled sidecar follows the standalone app; an independent Core can serve explicitly enrolled native receivers. |
| Browser UI, optionally rendering | Full shared browsing/management/control workflows; local playback where delivery and browser support permit it. | Authenticated HTTP/WebSocket client and a connection-owned browser renderer. Source and UI parity remain incremental work. |
| Additional native receiver or output group | Another destination controlled by the chosen Core. | A paired native client offers its Tauri player automatically. Optional Sendspin groups receive bounded PCM; Sendspin owns synchronization. |

Server capabilities and target capabilities are separate. Available behavior
depends on permissions, enabled integrations/helpers, source access and the selected
target's formats/controls. Native helpers expose typed operations on their own
machine; browser requests do not grant arbitrary OS command execution. Output volume,
HDMI/display/Bluetooth controls and decoder settings belong to the intended target.

`/api/connection` advertises coarse `browserPlayback` and `nativePlayback`
capabilities. Native playback means a command channel exists; the target's
`connected` flag reports whether its player has been observed. Neither flag promises
support for every source. `/api/tools` separately reports helper availability.
Do not infer a renderer from the server's OS or installed media tools.

**This computer** uses the bundled local Core/player; connecting to a library on
another Couch selects a remote Core in the same app window and stops local playback.
After pairing, the native client offers its existing player to that Core automatically;
enrollment alone never selects or starts playback. The installation retains
its private maintenance coordinator and updater. Server selection and target
selection must stay distinct. The serialized `clientOnly` artifact field remains
`false`; it does not describe whether a particular Core currently has a renderer.

## Playback ownership and delivery

Core owns the existing household session and an optional personal session for each
paired controller. Personal queue, profiles, progress, continuation and checkpoints
use a private playback store; library/configuration/scanners remain shared. The
assigned renderer supplies observed position and playback state. Authenticated HTTP
and WebSocket requests select household or the caller's own personal scope; private
snapshots, clocks and playback notices stay within that scope. Watching profiles
are preferences, not authentication identities.

A single output registry reserves endpoints and group members before asynchronous
operations. Independent playback starts in the caller's personal session. Moving
playback retains that session's queue; joining a household group selects its existing
timeline. An occupied destination requires explicit takeover and confirmed silence.
Closing or revoking a personal session retires its resources without stopping other
sessions. Restoring persisted sessions never automatically claims hardware.

| Code | Boundary |
| --- | --- |
| `src/server/hub.ts`, `store.ts`, `session-store.ts` | Shared services, authenticated runtime selection and isolated playback persistence. |
| `src/server/session.ts`, `progress.ts` | Queue policy, resolution, intent and progress continuity. |
| `src/server/playback-targets.ts` | Optional native endpoint, socket-owned browser and paired native endpoints, assignment and handoff. |
| `src/client/session/session.ts`, `browser-renderer.ts` | UI connection and browser rendering above route lifetime. |
| `src/main.ts`, `src-tauri/src/player.rs` | Existing private native command/observation path. |

Selecting a browser is explicit. Registering a target does not start playback or
create a media element. Private delivery commands go only to the selected/preparing
endpoint; only assigned observations advance session progress. Closing a controller
leaves another target playing; closing the rendering browser loses that target.

Handoff prepares the destination paused, checks compatible track choices, then takes
a confirmed source checkpoint before assigning and resuming the destination. The
queue stays in Core. Playback speed and compatible selections follow the session;
destination volume stays local. Failure rolls back only when destination silence
is confirmed. Browser autoplay can require a gesture on the destination. This is
approximate continuity, not synchronized multiroom playback.

A native receiver's stable identity derives from its paired controller, with one
live socket per enrollment. Its trusted bundled window bridges commands and
observations through Tauri IPC to the existing libmpv worker. Commands are checked
again when the worker executes them. Core-local paths, hardware audio outputs and
maintenance operations are not remote playback authority.

Receiver leases use a fresh native monotonic challenge every two seconds. Core
acknowledges that challenge; Rust accepts it within one second and anchors its
ten-second lease to the original request time. An independent watchdog revokes
expired generations and requires native stop within two seconds, exiting the app
if shutdown cannot be confirmed. Core fences replacement playback for 12.5 seconds
after its last grant when a receiver disconnects. A confirmed stopped reconnect
can recover under the same target ID but requires explicit assignment/resume.
Installations that have enrolled a receiver also wait 12.5 seconds after Core
restart before starting playback, covering leases issued by the previous process.
The native window, player layout and local maintenance coordinator are unchanged.

Core persists the current queue occurrence and observed position, speed and track
choices on progress checkpoints and shutdown. Restart restores resumable intent
without assigning hardware, resolving a source or autoplaying. Explicit output
selection resolves fresh delivery and prepares it paused through the existing
handoff path. Stop and completion clear the checkpoint; watching-profile/history
changes require Stop while restored playback is pending. Provider grants, renderer
identities and playback attempt IDs are never restored from the checkpoint.

Most sources are remote. Prefer provider-to-renderer delivery; Core does not need
to carry the media bytes to coordinate playback. Keep idle controllers inexpensive
through lazy rendering and compact clock updates. Choose an existing compatible
rendition before adding relay, remuxing or transcoding for a demonstrated need.
The browser handles compatible direct HTTP(S) media and public DASH/HLS through a lazy
Shaka adapter. Media fetch and decoding belong to the selected client; Core owns
source references and playback intent. Alternate audio and subtitles use the maintained track APIs; live playback starts
at the live edge and seeks within the observed DVR range. An unsupported source stays
explicitly unsupported until a client/provider-native path is available. The new
Jellyfin browser relay/adaptation experiment was abandoned by user instruction;
existing native provider integration remains compatible.

Sendspin has two independent optional roles. Core hosts an encrypted group through
`@sonn-audio/node-sendspin`; a UI client joins this Core or another server through
the official `@sendspin/sendspin-js` renderer. Administrators enable hosting in
Settings → Remotes; enabling waits for the listener to start, while disabling closes the
producer and listener immediately. The durable choice overrides legacy file-based
enablement, retaining that file's address/name options. Hosting defaults to off.
Joining requires an explicit audio gesture and suspends the client's direct renderer;
leaving restores it. Connection ownership survives navigation, and active client
controls remain available when Core is offline. The existing window and player stay
unchanged. There is no Python runtime.

Core enrolls its own clients with durable, owner-bound PSKs through existing pairing;
revocation disconnects their encrypted sessions. Bun interoperability currently uses
AES-GCM. External receivers need compatible PSK provisioning; this host dependency
does not provide PIN onboarding. The client can use the official pairing flow with
other servers. The PCM decoder feeds one group timeline with bounded buffering.
Unqualified outputs cannot promise silent handoff; explicitly qualified software
identities use a one-second drain fence. See [Sendspin roles and limits](sendspin.md).

For client playback API questions, consult
[browser delivery research](research/browser-media-delivery.md) selectively. Its relay
and conversion proposals are historical alternatives. Sendspin is the sole synchronized
audio backend; the earlier [multiroom comparison](research/multiroom-snapcast-sendspin.md)
is retained as historical research. The
[PWA runtime exploration](research/couch-runtime-options.md) is an alternative
deployment proposal, not a prerequisite or the current implementation plan.

Core-only Linux deployment reuses the compiled executable with embedded frontend and a
dedicated systemd account/data directory. The first pairing establishes an administrator; optional recovery
uses the existing authorization path. See [service installation](core-service.md).
The desktop installation retains its own state and updater.

## Local access

Use the existing LAN listener and Couch pairing. An optional local HTTPS proxy
supports browser secure-context features with a certificate trusted on those devices.
It uses the same pairing and revocation flow; forwarded requests never gain native-host
authority. See [local HTTPS](local-https.md) only when that transport is needed.
Source URLs may still point to Internet providers; local-only describes Couch access,
not an offline media requirement.

## Frontend delivery

```
src/client -- Vite (one transform / route / worker build) --> dist
                                                           |-- Tauri frontendDist
                                                           `-- Bun file imports --> compiled sidecar
```

`bun run build` writes the build identity, runs Vite once, and replaces
`src/frontend.ts` during the sidecar build with exact-byte file imports of `dist`.
Bun does not process the generated HTML, JavaScript or CSS again. The executable
contains all emitted assets, the manifest and worker; it does not read a mutable
`dist` directory after installation. The hub serves the known page paths and
explicit assets, leaving authentication, unknown requests and WebSockets with
the existing coordinator handlers. Tauri still packages `dist` directly.

Both delivery paths use root-relative URLs. Only browser remotes in a supported
secure context register `/sw.js` with root scope. Tauri never registers it.
The worker precaches the shell, not API data, and its navigation fallback is
restricted to the coordinator's known frontend paths. The loaded build identity
is still checked before opening the control WebSocket.

## Development and qualification

`bun run desktop` uses Tauri's `beforeDevCommand`, `devUrl`, and source watcher
for native development. `bun run dev` is the separate browser-only loop: it
starts the source-mode Bun coordinator and Vite together. Vite runs on port
1420 with an API proxy to the coordinator on port 4100; Browser remotes use
Bun's hosted UI. Neither development loop proves that the production remote works.

After committing and building, run `bun tests/linux/built-remote.ts` inside the
existing Linux test environment with WebKitWebDriver, X11/Openbox, xdotool and
the configured null PulseAudio sink. It reuses `tests/linux/ui.ts`, checks every
served byte against `dist`, opens a deep link, pairs, navigates, and verifies
browser Play/Stop through the coordinator's private native pipe. It also checks
worker activation on loopback, a supported secure context. This journey uses a
simulated native peer, not libmpv or physical hardware. It writes the exact build
identity, asset hashes, checks and a screenshot to `.artifacts/built-remote`.
`COUCH_SIDECAR`, `COUCH_FRONTEND_DIST` and `COUCH_ARTIFACTS` can select the already
built paths. Run `bun run test:linux` for the existing actual Tauri/libmpv journey.

The dated [architecture research](research/architecture.md) records alternatives
and earlier delivery proposals, including the former Bun-only frontend build.
It is historical evidence, not the current build contract; this map and
[scripts/build.ts](../scripts/build.ts) describe current delivery.
