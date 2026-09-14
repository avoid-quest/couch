# Minimal first-boot failure

The first unchanged dedicated-session boot failed. LightDM authenticated `couch-tv`, then Xsession could not execute `/usr/lib/couch-appliance/session` because its installed mode is `0644`. No native Couch process was observed. Five-minute Couch idle sampling remains unrun.

This is the task-owned minimal clone `19C197A2-BAE0-49B4-B487-2E5C515747A9`, using the retained disposable-key candidate. [The summary](summary.json) records its boot ID and artifact/source identities. The parent task requested the reboot. This collection performed read-only observations and wrote evidence files; it made no repairs, package changes, session changes, restarts or GUI actions.

## What happened

The first SSH connection timed out during banner exchange. A connection with a longer allowance succeeded. [The access record](access-attempts.json) preserves the distinction between that access timeout and the application startup failure.

[The initial snapshot](initial/date.stdout) began at 2026-09-14 23:24:27 UTC. LightDM was active and had opened a `couch-tv` session. The first user-service queries found no bus, while later journal entries in that same collection show the user manager starting. That early bus observation alone does not establish a persistent startup defect.

[The follow-up snapshot](followup/date.stdout) began at 23:26:04 UTC. [The Xsession error log](followup/xsession-errors.stdout) records `/usr/lib/couch-appliance/session: Permission denied`. [The LightDM log](followup/lightdm-session-log.stdout) and [user-manager journal](followup/user-manager-journal.stdout) retain the session exit and subsequent normal user-manager shutdown. Couch's service journal has no entries and neither snapshot contains a native Couch process.

## Preserved cause

[Installed file metadata](followup/installed-session-modes.stdout) shows these root-owned files all have mode `0644`:

- `/usr/lib/couch-appliance/session`
- `/usr/lib/couch-appliance/initialize-audio`
- `/usr/lib/couch-appliance/set-autostart`
- `/usr/sbin/couch-session`

The session path's parent directories are traversable. The session file lacks every execute bit. The [signed setup archive inventory](followup/setup-script-modes.json) records the same `0644` modes. `install-couch` copies each managed file using the source mode, so the installed mode follows the signed archive. The other three entrypoints were not executed in this failed boot; their modes identify additional affected entrypoints without claiming observed failures there.

The follow-up fix belongs in source/package preparation and a separate diagnostic clone. Preserve this installation and these first-failure receipts. A corrected production artifact still needs a new pristine acceptance run.

## Measurement limits

[The sample decision](initial/sample-scope.txt) records why five-minute sampling did not run. The retained process and memory snapshots describe the guest OS during startup. They are not Couch idle memory, playback performance or hardware acceptance. UTC timestamps here fall on September 15 in Europe/Rome.
