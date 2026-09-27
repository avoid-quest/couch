# Current architecture

Couch separates Core, its UI clients, playback targets and media delivery. The
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
| Additional native receiver or output group | Another destination controlled by the chosen Core. | Explicit paired native receiver enrollment reuses the Tauri player. A configured local Snapcast group receives paced PCM; Sendspin remains work. |

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

**This computer** uses the bundled local Core/player; **Another Couch** selects a
remote Core in the same app window and stops local playback. **Enable playback on
this computer** separately enrolls that existing native player as a target of the
selected Core; enrollment alone never selects or starts playback. The installation retains
its private maintenance coordinator and updater. Server selection and target
selection must stay distinct. The serialized `clientOnly` artifact field remains
`false`; it does not describe whether a particular Core currently has a renderer.

## Playback ownership and delivery

The current implementation has one Core-owned household session. Core owns queue,
intent, assignment and persisted progress; the assigned renderer supplies observed
position and playback state. UI clients receive snapshots and compact playback
clocks over the existing authenticated WebSocket. They do not each own a competing
queue. Multiple simultaneous/private sessions are a later extension.

| Code | Boundary |
| --- | --- |
| `src/server/hub.ts`, `store.ts` | Authorization, integrations, persistence and protocol dispatch. |
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
The browser path handles compatible direct HTTP(S) media and public, CORS-enabled
DASH VOD at `.mpd` URLs through a lazy Shaka Player adapter. DASH keeps upstream
adaptive renditions under the existing height cap; Core does not relay or encode.
The adapter releases its pipeline on stop/replacement/fatal failure and preserves
commanded speed while Shaka temporarily pauses its clock for buffering. Separate
audio/video URLs, required headers, clip segments and external subtitles are still
rejected for generic sources. Jellyfin negotiates a conservative browser direct-play
profile from Media Capabilities probes (single-track H.264/AAC MP4 or MP3). Its
header-authenticated bytes use an attempt-scoped HTTP range relay; the selected
renderer receives only a revocable grant, never the provider token. Prepared
provider sessions remain separate until handoff commits, and failed destinations
release their own grant without destroying the source needed for rollback. Broader
format adaptation remains unfinished.
DASH audio selection and subtitles are not yet exposed; audio metadata stays unknown
rather than inventing a track. Those are delivery limits, not a
reason to design a reduced browser UI.

The Snapcast adapter presents one configured group as a target and publishes observed
membership/volume through the existing picker. One Core-owned FFmpeg producer decodes
remote audio and paces bounded PCM into a loopback Snapserver; Snapcast owns member
synchronization. Progress is estimated from submitted audio and the configured
buffer. The qualified 500ms buffer/750ms drain is explicitly different from a physical
silence acknowledgement. Uncertain control/ingestion blocks transfer until a fresh
connection resets the backend; reconnect never autoplays. A durable marker also
fences new playback for 750ms after Core restart. Removed speakers are assigned to
an idle stream, and active foreign groups cannot be silently taken over. See
[Snapcast configuration and limits](snapcast.md). Sendspin remains a separate adapter.

For the next source-access gap, consult
[browser delivery research](research/browser-media-delivery.md). For group adapters,
consult [multiroom research](research/multiroom-snapcast-sendspin.md). The
[PWA runtime exploration](research/couch-runtime-options.md) is an alternative
deployment proposal, not a prerequisite or the current implementation plan.

Core-only Linux deployment reuses the compiled executable with embedded frontend and a
dedicated systemd account/data directory. Pairing and one-time administrator recovery
use the existing authorization paths. See [service installation](core-service.md).
The desktop installation retains its own state and updater.

## External access

Core admits an explicitly configured canonical HTTPS origin only through exact
trusted proxy peers. Forwarded requests never receive native-host authority, even
when the proxy connects over loopback. External pairing is a separate opt-in;
revocation and Allow remotes retain their existing meaning. Discovery and scoped
media URLs use the external origin. See [deployment configuration](remote-access.md).

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
