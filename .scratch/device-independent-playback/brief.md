# Implementation brief: device-independent Couch

Prepared 2026-09-27 against `81ca2a293907da55e68c4b53a186f9466627392e`.
This is a build handoff, not a claim that the proposed features exist.

The first direct-media iteration now exists; see [the map](map.md) and
[validation](validation.md) for its limits. Follow [the current architecture](../../docs/architecture.md)
for the agreed runtime model and the requirement to preserve the existing app
experience. This brief's first-iteration instructions are historical scope, not a
request to build the same slice again.

## The goal and the first result

Couch should feel like one application regardless of which UI opens it. Its session
can play on a selected target without making the controller run the media. Most
sources are remote. Core coordinates playback; it does not have to relay it.

**First result:** from the browser, play a real remote source here, select Couch TV,
control it, and move the same queue/item/position back and forth. Browsing another
page does not stop browser playback. Closing a controller does not stop TV playback.
Preserve paused state, speed, and compatible track choices. Show unsupported choices
honestly. Make this work with the existing household queue before adding private sessions.

Start with remote audio and one compatible seekable video path. Use a real existing
provider where accessible plus deterministic remote HTTP fixtures for repeatability.
Do not substitute a local-file server or a mocked player for the actual browser result.
An HTTP fixture is useful evidence for routing and handoff, but does not establish
compatibility with a provider's authentication, manifests, or expiring URLs.

The user wants rapid personal-project iteration. Build this usable path first;
let failures determine the next changes. No mandatory standalone prototype phase,
design approval, complete codec matrix, or production rollout programme.

## What to reuse and where to work

| Existing code | What it already does / likely change |
| --- | --- |
| `src/server/hub.ts`, `src/main.ts` | One Bun coordinator creates one session; authenticated HTTP/WS controllers send commands; private stdio reaches the owning native player. Add explicit target dispatch and observation attribution here. |
| `src/server/session.ts` | Owns queue, intent, continuation, source resolution, progress and preparation. Extend it rather than copying that policy into the browser. |
| `src/shared/protocol.ts` | Shared commands/state; `playbackId` already identifies a load. Add session/target identity and assignment fencing without redefining `playbackId` as a session. |
| `src/server/progress.ts`, `store.ts` | Checkpoints observed progress; `replaceTransport` preserves an active progress record across a load replacement. Existing session persistence is singleton-shaped. |
| `src/server/web-media.ts`, `jellyfin.ts`, `radio.ts`, `iptv.ts` | Existing remote resolution. Some outputs have headers, separate audio/video or temporary URLs. Jellyfin has singleton active/prepared state and a native-oriented profile. |
| `src/client/session/session.ts`, `session-context.tsx` | Shared connection, commands, snapshots and compact clocks. Put renderer lifetime above route changes. |
| `VideoStage.tsx`, `PlayerPage.tsx`, `PlaybackTransport.tsx` | Existing display and controls. VideoStage only positions the native surface; PlayerPage equates nonlocal native hosting with playback elsewhere. Update that distinction. |
| `PlaybackDevice.tsx`, `src-tauri/src/operating_mode.rs` | Currently selects another server and stops local playback. Server selection and output selection must stay separate. |
| `src-tauri/src/player.rs`, `protocol.rs` | Keep libmpv and its ordered worker. Wrap the existing native command/observation connection as a target. |

Paths above are relative to `src/` where abbreviated. `apps/web` is the marketing
site; the browser application is the shared `src/client` build. See
[current architecture](../../docs/architecture.md) if unsure.

## Working defaults: make these choices now

These are recommended defaults chosen for a fast first implementation. They are
deliberately concrete so the next agent need not interview the user again.

1. **One Core coordinates each session.** Keep the current household session first,
   give it a stable identity, and make new protocol/ownership code session-aware.
   Add multiple simultaneous queues later; do not rewrite all storage now.
2. **A UI is a controller; rendering is an additional role.** Opening a browser
   alone creates no media fetch/decoder. A browser tab can become a renderer without
   taking over the native host identity. Its registration belongs to its connection.
3. **A target is an endpoint or a backend-managed group.** Keep this distinction in
   the target contract. Implement native and browser endpoints first. Do not create
   speculative group tables, clock code, or unused backend abstractions.
4. **The session owns queue, current item, timeline, paused intent, speed and desired
   tracks.** The target owns volume/mute, output device, and calibration. Never copy
   the TV's loudness to laptop headphones. Delivery owns rendition, URLs and buffers.
5. **Explicitly move playback.** In the first iteration there is one household
   session: selecting another output moves it, or selects its output while idle.
   Label an active change as “Move playback here” / “Continue on Couch TV.” Later,
   separate “Play here” (independent session) from “Move this session” and “Join group.”
6. **One active progress writer per assignment.** Bind observations to the actual
   authenticated target connection, session and playback attempt/generation. Ignore
   late source observations after handoff; never accept a claimed target ID as proof.
7. **Existing HTTP JSON and WebSocket control are sufficient.** Retain native stdio.
   HTTP carries direct/relayed media; a multiroom backend later uses its own supported
   media protocol. Do not add a broker, event-sourcing system, or microservices.
8. **Reuse current household pairing for the LAN iteration.** Checking target identity,
   limiting media access, and retaining provider secrets are part of making the new
   path correct. A new account system or public-internet deployment is not required.
9. **Prefer a small interruption to accidental double playback.** Do not promise
   seamless or sample-accurate handoff. Browser autoplay may require a destination click.
10. **Use ordinary implementation judgement.** Pick a maintained HLS/DASH player if
    the chosen source needs one. Shaka is a researched candidate for both; plain
    HTML media is enough for a compatible progressive stream. Check current official
    integration docs at the point of adding a dependency; do not hold a new survey.

## First handoff: small, explicit, recoverable

- Verify the destination exists and can receive the selected media. Resolve fresh
  access for it when needed; a TV's provider URL/headers may not work in a browser.
- Prepare the destination paused, keeping the source active while possible. This
  is a new preparation operation; do not casually reuse native next-track preparation,
  which already has queue-advancement semantics.
- Serialize handoffs for this session. Reject a second transfer as busy; do not build
  a general distributed command scheduler. Ordinary commands during transfer must
  either cancel it consistently or be rejected until it finishes.
- Pause the source and get its observed checkpoint. Seek the destination to that
  checkpoint, then switch assignment and start it (or keep it paused if intended).
  If the provider permits only one stream, use an explicit pause/stop-then-open path.
- Keep queue occurrence IDs/order, current episode, profile, continuation and
  session ID unchanged. Create a new playback attempt. Refresh the final position
  after preparation instead of using a stale timestamp from the button click.
- Confirm destination playback/paused readiness; command acceptance alone is not
  success. Only the assigned renderer writes progress. Release the old load/resources.
- Before source pause, failure simply leaves it playing. Afterwards, resume the
  source only when the destination is known silent. If destination start is uncertain,
  show a recoverable paused/uncertain state rather than starting both.
- For a first implementation, in-memory handoff coordination plus the existing
  durable checkpoint is enough. After Core restart recover paused/resumable; a durable
  distributed transaction journal is not a prerequisite.

Tracks travel by stable identity or semantic preference (language, role, subtitle
off), not native stream indices. Preserve exact choices when supported. If a required
track cannot be delivered, keep the source and explain the incompatibility; do not
silently disable subtitles. Live sources without DVR continue at the live edge,
not a fictional transferable timestamp. Live/DVR provider qualification can follow
the first finite-video handoff.

## Media delivery and efficiency

Treat access and format as two separate decisions:

```text
Access:    provider → target       OR provider → authorized Couch relay → target
Format:    existing rendition → remux → audio/subtitle adaptation → video encoding
Multiroom: remote source → session audio producer → synchronization backend → members
```

Direct play is the default when format and provider access allow it. Prefer an
existing compatible/lower-quality upstream rendition before converting anything.
Keep native direct playback intact. Relaying for credentials or CORS is not a reason
to transcode. Do not push every source through PCM or an FFmpeg process.

For any relay actually needed, keep upstream credentials on Core, expose only
authorized source resources, preserve upstream-supported ranges and stream with
bounded buffers. HLS/DASH child resources, redirects, keys and subtitles need the
same access policy. Do not create a generic unauthenticated URL/path proxy. Keep
provider-specific exceptions explicit; configured private Jellyfin sources must
remain usable. Conversion comes later for demonstrated gaps.

Retain compact clock events and periodic progress checkpoints. Subscribe controllers
to relevant session state; don't serialize the queue or write SQLite on every tick.
Cache/coalesce source resolution only within compatible account/access/expiry scope.
Limit preloading to useful imminent work and cancel abandoned loads/delivery jobs.

Measure on the equipment available: control-only idle cost, direct-path CPU/network,
startup/seek/handoff delay, position error, and resource cleanup. Direct playback
should introduce no Couch media relay or encoder. More controllers should add no
media pipelines. Do not invent performance numbers or require unavailable TV/GPU
hardware before delivering code that can be tried.

## Multiroom: reserve the right seam, then connect a real backend

A group is one selected playback target with one session timeline. Its backend owns
speaker clocks, buffers, drift correction and observed membership. Couch owns media
selection, queue and user intent. One group must not produce several progress writers;
use audible content time, not how far its producer has decoded ahead.

Default to a Snapcast integration first if neither backend is already configured:
its ingestion/control paths are documented in the research. If the user's existing
setup makes Sendspin simpler, use that instead and record why. Use maintained backend
implementations/SDKs; do not reimplement synchronization. Add the second backend
against the interface learned from the first. Group join is different from whole-session
handoff and different from splitting one member into independent playback.

## Follow-ups and limits of the first result

The issue files cover broader remote format support; a synchronized audio backend;
conversion only where needed; independent Core/native receiver lifecycles; multiple
sessions; deliberate internet access; and shared UI workflow parity. These remain
part of the destination, not prerequisites for the first usable result.

The first iteration need not provide arbitrary codecs, ASS/PGS fidelity, both audio
backends, public accounts, phone background playback or perfect group/video lip-sync.
It must not disguise missing behavior as successful playback. Keep failures readable
and the previous native path usable.

## Evidence and finishing an iteration

Run `bun run typecheck` and relevant existing tests. Add focused tests for new
cross-target behavior and actual regression risks: stale observations, handoff failure,
source/destination disconnect and progress ownership. Reuse session continuity,
progress, subtitle lifecycle, hub authorization and client connection tests.

Try the actual browser path, including navigation during playback and a second
controller. If Linux/native hardware is unavailable, use the existing simulated
native peer to exercise routing, and explicitly distinguish that evidence from a
real libmpv/TV run. Do not claim audible sync from timestamps alone. Workflow or
packaging changes still follow the repo's `act` instructions; avoid them unless needed.

Update the issue with what works, exact checks, limitations and the next useful
iteration. Keep intermediate changes runnable. Do not spend a session only producing
more plans once the implementation agent has this handoff.

## Optional reference material

- [Architecture research](../../docs/research/device-independent-playback.md): detailed ownership, flow and source mapping.
- [Media delivery](../../docs/research/browser-media-delivery.md): browser formats, provider access, seeking and conversion.
- [Snapcast / Sendspin](../../docs/research/multiroom-snapcast-sendspin.md): backend roles, timing and integration constraints.
- [Comparable systems](../../docs/research/playback-ecosystem-comparisons.md): architectural lessons and primary sources.

These references are recommendations based on source inspection and documentation,
not implemented features or measured capacity. Read the relevant part when needed.
