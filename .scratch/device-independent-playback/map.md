# Make Couch playback device-independent

Label: wayfinder:map
Status: open

## Destination

Make Couch's shared UI control a session that can play in a browser, on Couch TV,
or on a compatible output group, with remote sources as the normal input.
Reach this through usable iterations, starting with browser ↔ TV playback and handoff.

## Notes

- The preparation session on 2026-09-27 created this handoff, and a subsequent agent
  implemented the first iteration. [The continuation prompt](start.md) describes
  the current state; do not repeat the completed first slice.
- The user explicitly requested faster iteration for a personal project and delegated
  routine design choices. This map carries execution into the effort: its `task`
  tickets are implementation iterations, overriding Wayfinder's default decision-only
  workflow. Do not restart a grilling, research, or approval phase before building.
- [The implementation brief](brief.md) supplies working defaults, not claims of
  decisions individually approved by the user. Change a default when code or a
  working experiment demonstrates a better small solution; record the reason.
- Local Markdown is the tracker fallback because the repository has no configured
  Wayfinder tracker. Child issues live in `issues/`. `Blocked by` records dependencies;
  open, unclaimed issues whose blockers are resolved form the frontier, ordered by filename.
  Claim by saving `Status: claimed`; finish with `Status: resolved` and `## Answer`,
  then add a named link and one-line outcome below. Leave a short continuation note
  when unfinished. Do not call a stub or untested simulation a completed integration.
- Consult repo `AGENTS.md`. Reuse Bun, React, SQLite, Tauri/libmpv, pairing and the
  existing UI. Use first-class media libraries and backend integrations. Keep the
  core out of the media byte path when possible. Future Snapcast and Sendspin support
  must fit the model; implementing both is not a prerequisite for the first iteration.
- Existing research is evidence to consult selectively, not a mandatory reading or
  release checklist. This brief supersedes its proposed rollout order and broad
  qualification gates for the first personal-project iteration.
- Resolve ordinary implementation questions autonomously. Ask only for missing
  information or access that genuinely prevents progress, or a new destructive action.

## Decisions so far

[Browser / TV playback and handoff](issues/01-browser-tv-handoff.md) — resolved for the first direct-media iteration: real browser radio/video, persistent rendering and bidirectional handoff; TV routing validated with a simulated native peer. [Checks and limits](validation.md).

Review fixes now cover idle browser volume, fresh delivery recovery and rollback,
honest audio-track metadata, and structured autoplay handling. See validation for
the recorded checks and the latest Core-only iteration.

The user confirmed Core-only or Core plus local UI/native playback, with the full
shared browser UI acting as controller and optionally renderer. Preserve the current
app experience and window model while expanding capabilities. [The architecture](../../docs/architecture.md)
is the implementation reference; standalone-PWA research is an unselected alternative.

The Core-only increment now omits the native endpoint when no native command channel
exists, advertises playback capabilities and waits for explicit browser selection.
Buffering and handoff/recovery regressions are covered. The branch now includes main's
desktop remote-reachability fix at `3bd72c7d`; preserve it rather than recreating it.

Issue 02 now includes a working direct public DASH VOD increment: lazy Shaka rendering,
upstream adaptive quality under the height cap, real browser handoff and cleanup.
Header-dependent providers and Jellyfin remain the next source-specific access work. [Issue 05](issues/05-core-and-receivers.md)
records the partial Core-only step and outstanding independent native lifecycle.
Physical libmpv/TV qualification remains outstanding. See validation for exact checks.

## Not yet specified

- Source-specific compatibility gaps found while playing Couch's real provider mix;
  the observations will determine additional delivery work, not a speculative matrix.
- Constraints discovered while connecting the first synchronized backend that may
  change the second adapter or later bridges.
- Additional native/mobile integrations whose scope depends on actual use of the
  shared browser and TV workflows.

## Out of scope

- Replacing the UI framework, native playback engine, database, or backend runtime.
- Treating local-file serving as the primary milestone.
- Cloud federation, automatic NAT traversal, or building a public hosted service.
- A custom audio synchronization protocol, arbitrary mixed-backend synchronization,
  and distributed TV lip-sync. Music groups come first; these need separate evidence.
- Implementing every future compatibility feature before a usable handoff exists.

## Latest increment — direct DASH VOD

[Remote source compatibility](issues/02-remote-source-compatibility.md) stays open
with a completed direct DASH slice. The real Angel One manifest failed native browser
loading and now plays through the existing UI with seek/navigation, two-browser
handoff and disconnect recovery. No UI/window, protocol or Core ownership change.
[Validation](validation.md) records exact evidence and remaining provider/hardware gaps.

The blockers on issues 03 and 05 now reflect resolved issue 01. Both can proceed
independently of source compatibility; neither is implemented by a stub. Current PATH
has no Snapcast/Sendspin executable, and independent native enrollment/lifecycle is
still absent. Adaptation, independent sessions, internet access and UI parity remain
in their existing issues 04, 06, 07 and 08.

[Shared UI parity](issues/08-shared-ui-parity.md) — resolved for the current native/browser
workflows: Core hardware controls follow the selected target, disconnected output copy
is accurate, and source management follows authenticated authority. 68 UI tests pass.

Initial draft stack: [Core targets #613](https://github.com/avoid-quest/couch/pull/613) →
[browser renderer #614](https://github.com/avoid-quest/couch/pull/614) →
[architecture records #615](https://github.com/avoid-quest/couch/pull/615).
Subsequent implementation layers extend this same stack.
