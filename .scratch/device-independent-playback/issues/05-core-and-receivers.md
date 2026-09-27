# Run Couch Core independently and connect another native receiver

Type: task
Status: open
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
