# Make browser and native clients share Couch workflows

Type: task
Status: resolved
Blocked by: none

## Goal

Keep library management, browsing, queue/session control and playback selection in
the shared application. Restrict differences to actual target/platform capabilities.

## Work

- Audit existing native-only conditions in `src/client` against the new renderer role.
  A browser controlling TV and a browser rendering locally must both get appropriate controls.
- Keep browsing route/focus/fullscreen local to the UI. Opening a page on a phone
  must not navigate the TV or move playback.
- Expose authorized server-side management in the browser where the operation runs
  on Core. Distinguish it from a file picker or hardware operation on the browser device.
- Reuse existing shared routes and shadcn/design-system components, with flat rows
  and clear target names. Do not fork a reduced web application or redesign unrelated screens.
- Handle browser gesture requirements, target disconnects and unsupported features
  in the normal playback flow. Extend mobile ergonomics as actual browser use reveals gaps.

## Done when

Record a concise workflow comparison, fix unjustified native-only restrictions,
and identify genuinely local OS features. Library, queue, session and target controls
work from the browser with the same underlying operations as native UI.

## Answer — 2026-09-27

Audited native-only conditions without replacing any shared routes or window model.
Browsing, queue/session control, Core folder/source management and authorized settings
already use the shared UI. Ordinary router navigation stays local; the explicit TV
remote remains an intentional trusted-TV command. Fullscreen uses the local browser
or native window; file-open, native video geometry and OS media controls remain local.

Fixed the concrete gaps: Core physical sound outputs/settings are offered only when
the native target is assigned (legacy snapshots preserve prior behavior). Browser
volume remains available. Unavailable copy uses the renderer name, or a selected-output
fallback when its disconnected descriptor is gone, rather than incorrectly naming Core.
Source management now uses host/administrator identity consistently with route guards.

Typecheck and 68 affected UI tests pass. These are UI regression tests, not physical
audio routing qualification. Broader source compatibility remains issue 02; receiver
and group-specific UI can extend these capability rules as those adapters arrive.

## Session and group extension — 2026-09-27

Existing controls now offer personal playback, household control/join and explicit
takeover. Real browser journeys cover simultaneous VOD/live sessions, mode switches,
move back, route lifetime and desktop/TV-sized layouts. Sendspin uses the existing
output menu and a flat shared dialog for This Couch/Another server, gesture-driven
Join, local volume/mute, transport and Leave. Live checks cover first-member join,
group playback and Leave with Core offline. Leaving restores direct rendering.
Clock-only updates still leave browsing/settings shells stable; regression tests
pass unchanged. No window model, navigation or player layout was replaced.

External-server qualification additionally fixed missing Sendspin waiting/reconnect
status after the SDK's connection promise resolves. Pairing and Leave remain usable;
real UI and repeated focused regressions pass. See [current boundary receipt](../boundaries-2026-09-27.md).

## Hosting settings and admission recovery — 2026-09-27

Settings → Remotes now exposes administrator-only Sendspin hosting through existing
flat settings rows, Switch and Alert components. Saved enablement clearly requires
a Core restart; disabling stops output immediately. Existing configuration, read/write
failures and bind/startup errors are visible. The Sendspin dialog shows a terminal
reconnect error with Leave, followed by a fresh explicit Join to recover.
Actual compiled-app pairing, hosting restart, group selection, playback, pause/resume
and disable were exercised in two Couch browser contexts. See
[local workflow qualification](../local-workflow-2026-09-27.md). Physical desktop/TV
checks remain separate; the window model, navigation and player layout are preserved.
