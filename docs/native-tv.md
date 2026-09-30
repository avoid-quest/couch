# Native Debian TV setup

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
session. Couch runs from the root-owned `/usr/bin/couch` (`/opt/Couch/couch`) in TV presentation, fullscreen on the TV. No source checkout or
manual verification utility is needed.

Keep your administrator account, password and SSH access. Setup does not alter
them. From SSH or Ctrl+Alt+F3, use `sudo couch-session logs`, `status` or `restart`.
The initial session offers **This computer** or **Another Couch**. Setup checks the running app with `check-health.js`, run by the app's own Node (`ELECTRON_RUN_AS_NODE=1`): in This computer mode Core must be a child of the app with the TV data directory and a healthy loopback listener; Another Couch runs no Core. Select this
computer for TV playback and allow remote control to pair a phone. On an
unclaimed TV, open **Settings > Connections**. It shows the one-use administrator
code under **Set up your administrator remote**; **Pair a remote** opens the
pairing QR and six-digit code. Pair the phone, then enter the administrator code
in the phone's **Settings > Connections > Claim administrator**. If you kept
remote control private at first, turn on **Allow remote control** in Connections
before pairing. On a configured TV, **Pair a remote** is also in the header.
Use **Now** for playback and Up next, **Find** for search and sources, and
**Saved** for lists and favorites. TV **Settings > Appearance** offers Default,
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
from the administrator's button restart immediately, even during playback.

From SSH, `sudo systemctl start couch-update@<version>.service` installs a release
by hand, `systemctl list-timers couch-update.timer` shows the next run,
`/var/lib/couch-update/status` holds the last run's outcome (`installed`,
`up-to-date`, `waiting` while something plays, or `failed` with its error) and
`journalctl -u couch-update.service -u 'couch-update@*'` shows how updates went.
`sudo systemctl disable --now couch-update.timer` and then `sudo systemctl mask
couch-update.timer` turn unattended updates off for good.
TVs set up before this rerun `sudo couch-setup --tv` once to get the units.
