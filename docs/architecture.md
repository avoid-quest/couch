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
| Core only | Library, integrations/tools, persistence, authorization and sessions; no local player required. | `bun src/main.ts` runs without a native command channel and advertises no native target. Independent packaged service installation remains work. |
| Core plus local UI/renderer | The same server capabilities, with local screen, HDMI and sound through native playback. | Tauri launches the Bun sidecar and libmpv worker. Their lifecycles are still coupled. |
| Browser UI, optionally rendering | Full shared browsing/management/control workflows; local playback where delivery and browser support permit it. | Authenticated HTTP/WebSocket client and a connection-owned browser renderer. Source and UI parity remain incremental work. |
| Additional native receiver or output group | Another destination controlled by the chosen Core. | Separate receiver enrollment and Snapcast/Sendspin adapters remain work. |

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
remote Core in the same app window and stops local playback. It does not yet enroll
that local native player as a target of the remote Core. The installation retains
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
| `src/server/playback-targets.ts` | Optional native endpoint, socket-owned browser endpoints, assignment and handoff. |
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
rejected; Jellyfin browser delivery and broader format adaptation remain unfinished.
DASH audio selection and subtitles are not yet exposed; audio metadata stays unknown
rather than inventing a track. Those are delivery limits, not a
reason to design a reduced browser UI.

Future Snapcast/Sendspin groups fit as targets whose backend owns timing and member
synchronization; Couch keeps queue and intent. Build a backend adapter when needed
instead of teaching every UI a separate group-control protocol.

For the next source-access gap, consult
[browser delivery research](research/browser-media-delivery.md). For group adapters,
consult [multiroom research](research/multiroom-snapcast-sendspin.md). The
[PWA runtime exploration](research/couch-runtime-options.md) is an alternative
deployment proposal, not a prerequisite or the current implementation plan.

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
