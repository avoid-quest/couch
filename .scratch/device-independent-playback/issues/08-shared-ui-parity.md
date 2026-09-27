# Make browser and native clients share Couch workflows

Type: task
Status: open
Blocked by: 01

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
