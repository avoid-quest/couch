# Native Debian TV

## TV mode on an existing desktop

Choose **This computer**, then **Settings → TV → TV mode** (a paired admin can
do it from their device) and confirm **Restart Couch**. Turn on **Share on
network** so phones can use **Remote**. The desktop keeps its normal login and
updates. `COUCH_TV_PRESENTATION=1` forces TV mode for a launcher and locks the
setting.

## Dedicated TV

On minimal Debian 13 amd64, from the ordinary administrator account:

```sh
sudo apt install ./couch_<V>_amd64.deb
sudo couch-setup --inspect   # optional: reports what --tv would do, writes nothing
sudo couch-setup --tv
sudo reboot
```

Installing the package alone changes nothing; `couch-setup` (from the `.deb`,
session files in `/usr/share/couch/tv`) does the setup. It installs Xorg,
Openbox, LightDM, PipeWire, Bluetooth, and the GStreamer plugins and libplist
the [AirPlay receiver](airplay.md) uses. It creates the locked, unprivileged
`couch-tv` account, which runs `/usr/bin/couch` fullscreen in TV presentation.

- Setup refuses an unrelated display manager or Couch service override. Running
  it again preserves administrator configuration and doesn't restart LightDM or
  logind; reboot to apply first-time session and power settings.
- Your administrator account, password and SSH stay as they were. From SSH or
  Ctrl+Alt+F3: `sudo couch-session logs|status|restart|diagnose`.
- Setup checks the running app with `check-health.js`, run by the app's own Node
  (`ELECTRON_RUN_AS_NODE=1`). It reads Core's open files and sockets rather than
  `/proc/<pid>/environ`, which Electron can clear.
- The old 0.1.0 AppImage installation isn't migrated.

## Updates

An admin updates the TV from **Settings → Updates → Update and restart**, also
for a TV in **Another Couch** mode. Root installs updates:

- `couch-update.timer` runs `couch-update.service` 15–75 minutes after boot and
  daily between 04:00 and 05:00. It installs the newest release on the TV's
  channel unless something plays, and never goes back to an older version except
  from a preview to Stable.
- The `couch-tv` account may only start `couch-update@<version>.service`
  (**Restart to update**). Both download the release's `.deb`, check its sha512
  against the release's update file, install it and restart the app.
- If the app doesn't pass the health check within a minute, the script
  reinstalls the previous version (`/var/lib/couch-update/installed.deb`), and
  unattended updates skip the failed release until a newer one appears.
- After each install the script runs `couch-setup --refresh`, so one
  `sudo couch-setup --tv` is enough for later releases' TV files.

From SSH: `sudo systemctl start couch-update@<version>.service` installs a release
by hand; `/var/lib/couch-update/status` holds the last outcome; `journalctl -u
couch-update.service -u 'couch-update@*'` shows how updates went;
`sudo systemctl disable --now couch-update.timer && sudo systemctl mask couch-update.timer`
turns unattended updates off.

## Diagnose

`sudo couch-session diagnose` prints a passive report to attach to a problem
(`--json` for a `couch-evidence/1` record): package, runtime, OS, hardware, setup,
service, health, window lifecycle, mode, helpers, display, sound and the last
update. It changes nothing, never opens `couch.sqlite`, and leaves out keys,
tokens, device names and source URLs ([redact.js](../packaging/tv/redact.js)).

The window lifecycle comes from Main's `<data>/renderer-status.json`, trusted only
when the running process wrote it (same PID, boot and start time): `page-loaded`,
`ready`, `failed` (`remote-failed`: another Couch can't be reached), `stale` or
`unknown`. Core's health is reported separately and alone decides update
rollbacks.
