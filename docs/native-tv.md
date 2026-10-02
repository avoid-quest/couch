# Native Debian TV setup

**Settings > Updates** shows whether the automatic timer is active. A stopped
or masked timer appears as off; administrators can still use **Update and
restart** from their paired remote.

The Linux `.deb` includes optional TV setup (`/usr/sbin/couch-setup`, with the session files in `/usr/share/couch/tv`). Installing the package alone leaves
the current login, display manager and power policy unchanged.

## Dedicated TV

On minimal Debian 13 amd64, install the package and explicitly enable TV
setup from the ordinary administrator account:

```sh
sudo apt install ./couch_<V>_amd64.deb
sudo couch-setup --tv
sudo reboot
```

Setup installs Debian's Xorg, Openbox, LightDM, PipeWire and Bluetooth support. It
creates the locked, unprivileged `couch-tv` account and enables its graphical
session. Couch runs from the root-owned `/usr/bin/couch` (`/opt/Couch/couch`) in TV presentation, fullscreen on the TV. The mouse pointer hides after a second without movement anywhere on the TV, outside Couch's window and over the recovery notice too, and returns when it moves. No source checkout or
manual verification utility is needed.

Keep your administrator account, password and SSH access. Setup does not alter
them. From SSH or Ctrl+Alt+F3, use `sudo couch-session logs`, `status` or `restart`.
The initial session offers **This computer** or **Another Couch**. Setup checks
the running app with `check-health.js`, run by the app's own Node
(`ELECTRON_RUN_AS_NODE=1`): in This computer mode Core must be a child of the app
with the TV's database open and a healthy loopback listener; Another Couch runs
no Core. The check uses Core's open files and sockets rather than
`/proc/<pid>/environ`, which Electron can clear when setting process titles. Select this
computer for TV playback. To pair a phone, open **Settings > Devices**, turn on
**Share on network** if the TV is still private, and choose **Pair a device**
for the pairing QR and six-digit code. The first device you pair becomes the
admin. If no paired device is admin later,
Devices shows a one-use code under **Make a device the admin**; enter it in the
phone's **Settings > Devices** under **Admin code** and choose **Become admin**.
**Home** shows what plays now and Up next, **Find** holds search and sources,
**Saved** holds lists and favorites, and **Settings** the rest. TV **Settings > Appearance** offers Default,
Larger and Largest at 100%, 115% and 130%; confirm a trial size within 20
seconds or the TV returns to its saved size. Client size stays separate.

A paired administrator's **Settings > Updates** updates this TV remotely with
**Update and restart**. A TV in **Another Couch** mode appears by its paired
Device name in that Couch's Updates page; the request travels over its existing
connection to the TV app. The TV keeps its saved mode, channel and pairing after
restarting. It must be online to receive the request.

Setup refuses an unrelated existing display manager or Couch service override.
Repeated setup preserves administrator configuration, data-directory overrides,
disabled autologin and logind masks. It does not restart LightDM or logind. Reboot
when convenient to apply first-time session and power configuration.

The retired 0.1.0 AppImage installation is not migrated. Fresh installations use
the package above; an old AppImage installation stays as it is and its session is
not switched.

The TV checks for updates like the desktop app and shows them in **Settings >
Updates**, but root installs them. `couch-update.timer` runs
`couch-update.service` roughly 15–75 minutes after boot and daily between 04:00 and 05:00:
it installs the newest release on the TV's channel (the one picked in Settings;
by default Preview on a preview build, else Stable) unless something plays. It
never goes back to an older version, except from a preview to Stable. **Restart
to update** installs a release sooner: the `couch-tv` account may only start
`couch-update@<version>.service`. Both run a root script that downloads the
release's `.deb` from avoid-quest/couch-releases, checks its sha512 against the
release's update file, installs it and restarts the TV app. The timer checks
both Core and the TV window's fresh playback report, including Client-mode
video and synced audio, and checks again after refreshing package lists. A
missing Core without a fresh report waits for the next run. Manual updates
from the administrator's button restart immediately, even during playback. The app must then
pass the check setup uses within a minute, or the script reinstalls the previous
version, kept as `/var/lib/couch-update/installed.deb` (or first downloaded from
its own release), and unattended updates skip the failed release until a newer
one appears.

From SSH, `sudo systemctl start couch-update@<version>.service` installs a release
by hand, `systemctl list-timers couch-update.timer` shows the next run,
`/var/lib/couch-update/status` holds the last run's outcome and
`journalctl -u couch-update.service -u 'couch-update@*'` shows how updates went.
The outcome is `installed`, `installed-unverified` when no TV session runs to
check, `rolled-back` with the `failed` release and its error, `skipped` for that
release, `up-to-date`, `waiting` while something plays, or `failed` with its
error; `rollback=unavailable` means no previous package was at hand.
**Settings > Updates** shows the last install, rollback or failure
under **Automatic updates**, and a failed **Restart to update** shows its error
instead of installing forever.
After each install, including a rollback, the script runs the installed
package's `couch-setup --refresh`, so the one `sudo couch-setup --tv` is enough:
on a completed setup it installs TV packages and links TV files a later release
adds, with the same preservation as setup, and enables `couch-update.timer`
unless masked. It leaves accounts, sign-in and power policy and the running
session alone, so session changes, such as the hidden pointer, apply at the
next sign-in; `setup=failed` in the status means it failed and the update went
ahead.
`sudo systemctl disable --now couch-update.timer` and then `sudo systemctl mask
couch-update.timer` turn unattended updates off for good.
TVs set up before this rerun `sudo couch-setup --tv` once to get the units; until
then **Automatic updates** says so.
