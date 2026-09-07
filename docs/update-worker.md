# AppImage recovery over SSH

Application replacement uses the official [Tauri updater](https://v2.tauri.app/plugin/updater/).
The former root transaction worker, socket, copied workers and automatic
package/database rollback are removed. Historical acceptance remains on
[issue 8](https://github.com/avoid-quest/couch/issues/8). Ubuntu package maintenance
remains an administrator operation; it cannot update the AppImage.

Systemd starts `/var/lib/couch/application/Couch.AppImage` as `couch-tv` and owns
all restarts. The native updater keeps a consistent stopped-writer snapshot in
`/var/lib/couch/application/backups/REQUEST_ID/`: `Couch.AppImage`, `build.json`,
`SHA256SUMS` and `data/`. The current application's `build.json` records its data
format even if that application cannot start. Installation saves its separate
migration snapshot under `/var/lib/couch-installer/` before replacing packages.
These directories are private. They can contain pairing secrets and media state;
do not attach them to an issue or serve them with the release feed.

If the new application cannot start, the phone may be unavailable. From the SSH
administrator account, inspect the service and choose its retained known-good
snapshot:

```sh
sudo couch-session logs
sudo ls /var/lib/couch/application/backups
sudo couch-recover /var/lib/couch/application/backups/REQUEST_ID
sudo couch-session status
```

`couch-recover` checks the retained bundle's hash and requires its data format to
match the current build. It stops the systemd application, refuses remaining
writers, saves the failed application and current data under
`/var/lib/couch-installer/failed-TIMESTAMP-PID/`, checks the candidate's compiled
build identity, replaces only the AppImage and asks systemd to restart. It does
not copy the old `data/` snapshot back. Newer pairings, preferences, queues and
progress remain intact. An incompatible or unknown format requires a forward fix
or an explicit operator decision about data; recovery fails closed.

Confirm the expected running `/api/build` version and revision, one native host
and sidecar, saved state, retained phone reconnection and no automatic playback.
A successful shell command establishes replacement, not these user journeys.
Keep failed data until recovery is accepted. Storage exhaustion stops recovery
before replacement. The service remains stopped for diagnosis when recovery fails.

For a failed initial migration, fix the reported dependency or bundle error and
rerun the same trusted installer. LightDM remains masked until the installer
finishes. Its saved data and old binaries are diagnostic material, not an
automatic downgrade path. Preserve `/etc/couch/appliance.env`, including the
installed rendering profile. Never restore an old database over newer writes.

The administrator phone's Ubuntu runtime repair uses a separate fixed
`couch-runtime-repair.service` oneshot. Systemd runs APT's update and reinstalls
ffmpeg at its installed version (or the trusted Ubuntu candidate when absent). A narrow polkit rule lets `couch-tv` start
that one unit; it grants no unit editing, arbitrary commands or package arguments. A missing installed-version archive is a truthful failure;
it never silently upgrades ffmpeg during repair.
The native updater waits for its result and checks the repaired tools. APT errors
remain visible; package-lock contention never bypasses APT's own locks. The
service has a five-minute timeout. If dependency repair is interrupted, inspect
APT/dpkg through SSH before retrying.

This uses [polkit authorization rules](https://polkit.pages.freedesktop.org/polkit/polkit.8.html)
and systemd's `org.freedesktop.systemd1.manage-units` action with its fixed
`unit` and `verb` details. The OS repair does not replace the AppImage or restore
application data.
