# Play remote media and move the session between browser and Couch TV

Type: task
Status: resolved
Blocked by: none

## Goal

Deliver the first usable iteration from [the brief](../brief.md): remote playback
in the shared browser UI, TV control, and bidirectional handoff of the same session.
This is the next agent's starting issue. The other issues are not prerequisites.

## Work

- Give the existing household session a stable ID and explicit assigned target.
  Adapt native stdio as its first endpoint; register a browser renderer as another.
- Separate target selection from selecting which Couch server the UI connects to.
  Use existing shared controls/design. Let every authorized controller see where
  playback is happening; send private media instructions only to the chosen renderer.
- Keep browser rendering mounted across routes. Opening a controller alone should
  not start a player. Make compatible remote audio and a seekable video actually play.
- Use existing remote resolution and direct delivery first; add the smallest scoped
  relay/rendition choice needed for the selected real source. Preserve the native path.
- Implement explicit handoff with paused preparation, an observed final checkpoint,
  new attempt/assignment, destination confirmation and cleanup. Reuse progress and
  queue policy. Keep target volume separate from session state.
- Preserve queue/current occurrence, paused intent, speed and compatible track choices.
  Capability or autoplay failure must be visible and recoverable.
- Bind browser observations to authenticated registration. Fence retired connections
  and attempts; reject a competing handoff while one is running. Don't broaden host authority.

## Done when

1. A paired browser plays a remote source locally and continues while browsing Couch.
2. The same browser can control native TV playback without downloading that stream.
3. Browser → TV → browser keeps the same queue/item and approximately the same position;
   paused handoff stays paused. Record position error rather than assuming precision.
4. A second controller observes the same session; closing it doesn't interrupt playback.
   Closing the active browser renderer leaves a resumable session rather than silently
   starting audio on the TV. Late source reports cannot change destination progress.
5. Destination refusal/failure doesn't silently lose the queue or produce two intentional
   playback owners. Compatible speed/track state survives; unsupported choices are reported.
6. Type checking and focused regressions pass; actual browser playback is exercised.
   Identify simulated native evidence separately if physical TV validation isn't possible.

## Start here

`src/server/session.ts`, `hub.ts`, `progress.ts`, `src/shared/protocol.ts`,
`src/client/session/session.ts`, `session-context.tsx`, `VideoStage.tsx`, `PlayerPage.tsx`.
See the brief for full path/ownership mapping. Keep changes incremental; do not first
build private accounts, a transcode farm, independent packaging or both multiroom backends.


## Answer

Implemented the first direct browser/native playback iteration. Browser renderers
are authenticated connection-owned targets; private load commands go only to their
renderer. The persistent HTML player survives navigation. Explicit handoff retains
the household queue/session, final observed position, paused intent, compatible
track choices and speed, and leaves destination volume unchanged. Failures and
renderer disconnects remain recoverable without automatically starting TV audio.

Validated real Sygma Radio playback and HTTP H.264/AAC video in the shared browser UI,
plus both handoff directions using a simulated native peer. Paused round trip stayed
at 22.25 seconds, 1.5× and per-target volumes 31/80/31. Confirmed no media element on
a control-only browser, controller-close independence and paused recovery after
renderer disconnect. Type checking and 333 focused tests pass.

See [validation and exact remaining limits](../validation.md). Physical TV/libmpv
validation remains outstanding. Browser access/format support is deliberately limited
to compatible direct media: no authenticated Jellyfin/local library browser delivery,
header relay, adaptive-stream library, split streams or external subtitles yet.
Unsupported source/track transfers fail visibly while keeping the source. Continue
with issue 02 when an actual provider requires additional delivery support.
