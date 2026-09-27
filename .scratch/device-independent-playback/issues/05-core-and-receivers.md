# Run Couch Core independently and connect another native receiver

Type: task
Status: resolved
Blocked by: none

## Goal

The always-on Linux Core can outlive its TV UI/player, and another Couch installation
can render a session from that Core. Preserve convenient standalone desktop operation.

## Work

- Separate server selection, controller role and native receiver registration. “Another
  Couch” must not be the only model for connecting installations.
- Extract only the native lifecycle ownership needed to run Core independently.
  Reuse Bun and existing stdio where colocated; don't introduce a new backend stack.
- Give native receiver enrollment a stable identity and observations a connection/attempt
  scope. Reconcile reconnects without restoring two owners or autoplaying stale media.
- Persist useful session checkpoints; recover paused/resumable after Core restart.
  If native playback continues briefly through connection loss, stop or pause it before
  a new assignment can safely take over. Document the actual policy.
- Scope volume, HDMI/audio/display/Bluetooth operations to the intended machine;
  keep installation maintenance separate from another server's playback authority.

## Progress — 2026-09-27

Core's native playback channel is now optional. Source-mode Core startup publishes
no native target, advertises browser playback and requires an explicit output choice.
Native startup still publishes the local player and retains the existing experience.
HTTP/WebSocket tests cover both paths; see [validation](../validation.md).

This is a runtime boundary, not completed independent packaging or native receiver
enrollment. Tauri still owns the bundled sidecar lifetime. Continue from the existing
window and operating-mode flows; the user explicitly ruled out a replacement app/window
concept. The issue stays open until the behavior below works.

## Done when

Restarting the TV UI/player leaves Core/library/browser access running; a second
native receiver is selectable; standalone desktop launch remains usable. Exercise
disconnect/reconnect and checkpoint recovery. If packaging/workflows change, follow
`docs/ci.md` and prove them with the required `act` image before dispatch.

## Coordination check — 2026-09-27

Issue 01's direct-media foundation is resolved; this work can proceed independently
of issue 02. Code still has one native stdio target, socket-owned browser registration
and Tauri-owned sidecar shutdown. Persisted queue/progress does not restore an
assigned native receiver after restart. No lifecycle/enrollment change was made in
the DASH increment.

Next bounded receiver work must establish authenticated stable identity and fence
old connections/attempts at the existing endpoint boundary. Keep server selection
and local installation maintenance distinct; retain standalone window behavior.

## Native enrollment increment — 2026-09-27

Implemented explicit native playback enrollment in the existing output picker when
the desktop/TV app controls another Core. It reuses Tauri/libmpv and the existing
video stage. Stable identity derives from the pairing, duplicate live connections
are rejected, reconnect starts idle and requires explicit resume. Receiver lease
expiry is enforced independently of the frontend; failed/hung shutdown terminates
the receiver app before Core's takeover fence expires. A persisted enrollment marker
also fences playback for 12.5 seconds after Core restart. Private maintenance and
Core-local hardware/path authority remain separate.

75 Rust library tests, 78 focused UI tests and 198 server/session/renderer regressions
pass. Nine receiver hub/target tests additionally cover enrollment, stale attempts,
reconnect, restart marker and disconnect during destination preparation. An exploratory Linux Tauri/libmpv journey passed actual playback, pixels,
pause/seek/resume, lease-expiry silence, explicit reconnect/resume, disable and
Core survival after app close. It uses Xvfb/null PulseAudio, not physical hardware;
final clean-revision qualification remains required. Checkpoint restoration beyond queue/progress persistence and
independent deployment guidance remain follow-up work in this issue.

## Checkpoint recovery increment — 2026-09-27

Core now restores a matching queue occurrence and its observed position, speed,
tracks and original progress owner after restart, without assigning an output or
resolving media. The existing picker explicitly prepares fresh delivery paused.
Stop/EOF clear durable intent; failed handoff remains resumable. Profile/history
changes require Stop while a restored item is pending, preserving progress ownership.

Real Chromium/Jellyfin recovery retained 37.25 seconds at 1.5× after graceful Core
restart with no media element/autoplay. Selecting this browser loaded a new grant
paused at that position; the old grant returned 404. Resume advanced and Stop
cleared the stored checkpoint. Disk-reopen tests also cover periodic crash recovery.

The receiver layer passed clean-revision Linux verification at `51677c8e`: all core,
native and build checks, 25 packaged-browser checks, and the actual libmpv receiver
journey (lease-expiry audio removal after 8380 ms). Physical hardware/macOS/Windows
journeys remain unqualified. Independent deployment guidance is the remaining
implementation in this issue.

## Independent Core deployment increment — 2026-09-27

A Linux systemd unit and explicit build/install/bootstrap/update instructions now
reuse the existing compiled Core. The unit forces Core-only mode, binds loopback
by default and uses a dedicated account and data directory. The first browser
pairing becomes administrator; optional one-use recovery can promote a replacement
controller without a local TV UI.
No desktop window, player, data directory or updater behavior changes.

[Deployment guide](../../../docs/core-service.md) includes the compiled process
qualification entry point and distinguishes it from systemd boot qualification.
The exact committed-revision act/process check is pending; a disposable systemd
PID1 probe is unavailable in this environment, so host boot integration remains
a specifically unqualified check. No hosted workflow was dispatched.

## Current result

Independent Core, native enrollment/leases, restart checkpoints and Linux deployment
are implemented. Exact service commit721ff602 passed the required act image, unit
validation and six real compiled-process checks, including first-pair administrator,
optional recovery, restart persistence and SIGTERM. Evidence is in
`.artifacts/core-service-act/qualification.json`. Physical/platform journeys and
systemd boot integration remain explicitly unqualified checks.
