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
