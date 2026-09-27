# Couch runtime options: PWA first, optional host

Historical alternative researched 2026-09-27. The subsequent user clarification
selects Core-only or Core plus the existing app/renderer, with the full shared
browser UI connected to Core. Follow [the current architecture](../architecture.md)
for implementation. The standalone-PWA recommendations below remain exploratory;
they do not authorize replacing the app, window model or session authority.

## Recommendation

Make the shared web UI the default way to use Couch. Let it work alone for supported
sources, connect to an optional headless Couch host for broader capabilities, and
control optional native renderers or synchronized audio backends. Native installation
should earn a concrete capability rather than be the price of opening a library.

| Mode | State and session authority | What it earns |
| --- | --- | --- |
| Standalone PWA | Browser-local store and session | No Couch installation; compatible remote sources, local library/history and browser playback. |
| PWA connected to Couch host | Host's existing store and session | Shared library, external extraction/tools, unattended coordination and supported delivery adaptation. |
| Host plus native renderer | Same host authority; renderer reports observations | libmpv formats, native output/device control and TV integration. UI can be browser or native wrapper. |
| PWA with synchronized backend | One Couch session authority; backend owns group timing | Snapcast/Sendspin outputs without creating Couch's own audio synchronization protocol. An integration/producer must still run somewhere. |

These are composable roles, not four application rewrites. A desktop installation
can bundle host, UI and renderer for convenience. Headless operation should not need
a window. Basic fullscreen video and OS-selected HDMI/audio already fit a browser;
low-level routing, passthrough, decoding and unattended operation justify specific
native capabilities, not a blanket native-only rule.

## What exists today

- `src/client` is already the shared React UI. `vite.config.ts` and `register-sw.ts`
  provide PWA shell caching, but connection/pairing gates still require a Core.
  Static hosting alone does not turn this into standalone Couch.
- `src/server/session.ts`, `hub.ts` and `store.ts` own queue policy, controllers,
  persistence and progress in Bun/SQLite. Source adapters and `web-media.ts` do
  extraction and transport preparation. This domain is not implemented in Rust.
- The working handoff patch adds a target coordinator and browser renderer; it
  still has one host-owned household session and limited direct browser delivery.
- Tauri launches the Bun sidecar and owns the native libmpv path. Rust also carries
  operating-mode, OS integration, updates and packaging support. `bun src/main.ts`
  is an existing server entry point; fully independent supported lifecycle and
  receiver enrollment remain work, not a completed packaging option.

Retain these working pieces. If standalone mode proves useful, share the small
session policy it actually needs and inject persistence/delivery at concrete seams.
Do not port all Bun adapters into browser workers or build a universal runtime first.

## The boundaries a PWA cannot erase

Public and unauthenticated are different from browser-readable. A media element can
play some cross-origin URLs while JavaScript cannot fetch their catalog, manifest
or decoded samples. Service workers and `no-cors` do not remove that restriction.
Current yt-dlp-based provider extraction also does more than expose a URL.

Service workers help install/cache the shell and handle supported background events.
They are terminable, event-driven workers, not permanent audio/network servers.
Installed apps retain the browser sandbox. Background playback is possible, but
locked-phone coordinator lifetime is not a portable promise.

For source decisions, read [the provider assessment](static-pwa-sources.md).
For CORS, storage, lifecycle and LAN API claims, read
[the platform assessment](static-pwa-platform.md). Both link primary documentation.
Endpoint/browser qualification is still needed; this research did not test every
provider's live CORS policy or measure battery/CPU.

## Mesh is an option, not the default simplification

WebRTC can connect active browsers. It still needs signaling: a small rendezvous
service, or complete two-way manual offer/answer exchange for a constrained LAN
experiment. A static host supplies assets, not a live peer mailbox. A room code
alone does not eliminate that service. NAT traversal/relay needs vary by network.

Library replication, leader loss and concurrent edits then become Couch's work.
Use one authority per active session even if the authority is a browser; avoid
multiple peers independently advancing the same queue. In standalone mode the
browser owns its session. In connected mode the chosen host owns that session.
Connecting should select a library/session explicitly; merging local libraries or
transferring authority between Cores is separate from moving the renderer.

Real multiroom adds clock mapping, latency compensation, buffering and drift
correction. Simultaneous Play commands are insufficient. Snapcast and Sendspin
already provide backend/client roles, including browser receivers. Their player
SDKs are not drop-in browser servers. Sendspin's outgoing-to-player connection
mode admits a limited browser-coordinator experiment, but browser listening,
discovery, source access and lifetime still constrain it. See
[the multiroom assessment](static-pwa-multiroom.md) before choosing an adapter.

An existing NAS, media PC or audio backend can supply the coordinator/producer.
It only needs to run during playback unless availability after closing Couch is
required. Neither cloud accounts nor Rust are intrinsically necessary.

## Contracts worth preserving now

- Keep controller, session authority, renderer and delivery separate. A controller
  receives state and sends intent; merely opening it starts no decoder or stream.
- Available workflows depend on source access, renderer support and any host/backend
  capabilities together. Negotiate actual operations instead of a desktop/web flag.
- Sessions own queue/item, progress, paused intent, speed and semantic track choices.
  Targets own volume/output calibration; delivery owns temporary URLs and recovery.
  Fence observations by assignment and attempt. The producer's read-ahead is not
  the listener's progress.
- Prefer provider-to-renderer playback. Introduce relay for access, remux for
  containers, and conversion for unsupported formats/quality, only when needed.
  A control connection and a media pipeline are independent costs.
- Represent a synchronized group as one target. Keep clock synchronization in its
  backend and source ingestion in an explicit integration; do not confuse a
  receiver WebSocket with an upload API.
- Public media needs no Couch account. Devices that control another output still
  need an explicit local trust step, such as existing pairing. Keep trust local
  rather than inventing a cloud login or assuming every LAN peer may control speakers.
  A separately hosted PWA also needs an explicitly supported origin/secure connection
  path to the host; current same-origin pairing is not automatically sufficient.
  Browser LAN permissions and HTTPS/WebSocket restrictions still apply.

## Next useful experiment

After the current handoff regressions, try a small standalone browser slice: local
queue/favorites/progress plus real direct radio and seekable video. Add one real
catalog/manifests path if its browser access works. Compare that useful subset
against the same UI connected to the existing host. This tests product value and
source limits before extracting a large portable Core.

For multiroom, connect one maintained backend and measure audible behavior. Keep
browser-peer mesh as a separate experiment if eliminating that last local process
is worth accepting leader/lifecycle constraints. No PWA runtime, mesh, packaging
rewrite or backend integration was implemented as part of this research.
