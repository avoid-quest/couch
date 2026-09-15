# Native Debian TV setup and migration

The native `.deb` includes optional TV setup. Installing the package alone leaves
the current login, display manager and power policy unchanged. The published
0.1.0 AppImage instructions remain in [Install Couch](install-couch.md) until the
native release is qualified and published.

## New dedicated TV

On minimal Debian 13 amd64, install the native package and explicitly enable TV
setup from the ordinary administrator account:

```sh
sudo apt install ./Couch_<V>_amd64.deb
sudo couch-setup --tv
sudo reboot
```

Setup installs Debian's Xorg, Openbox, LightDM, PipeWire and Bluetooth support. It
creates the locked, unprivileged `couch-tv` account and enables its graphical
session. Couch runs from the root-owned `/usr/bin/couch`. No source checkout,
separate installer download, FUSE setup or manual verification utility is needed.

Keep your administrator account, password and SSH access. Setup does not alter
them. From SSH or Ctrl+Alt+F3, use `sudo couch-session logs`, `status` or `restart`.
The initial session offers **This computer** or **Another Couch**. Select this
computer for TV playback, optionally allow remote control, then pair a phone
using Couch's displayed QR or code.

Setup refuses an unrelated existing display manager or Couch service override.
Repeated setup preserves administrator configuration, data-directory overrides,
disabled autologin and logind masks. It does not restart LightDM or logind. Reboot
when convenient to apply first-time session and power configuration.

## Existing released TV

Run the same two install/setup commands. Installing the `.deb` first leaves the
AppImage session selected. Only `couch-setup --tv` switches the service.

Migration stops Couch's writers, retains a data snapshot, selects the native
service and restarts it when the old service was running. Its data location,
`operating-mode.json`, database and paired controllers stay in place. No new
first-use choice or phone pairing is required. An ordinary user's library is not
copied into the shared TV account.

The existing `/var/lib/couch/application/Couch.AppImage` and its support files
remain intact. The root-owned migration record and data snapshot are under
`/var/lib/couch-installer/native-tv`. If native startup fails, setup attempts to
restore the old service selection. The explicit recovery command is:

```sh
sudo couch-setup --tv --restore-appimage
```

Recovery requires the recorded AppImage bytes and matching current/retained data
formats. It switches the service selection and preserves current data. It never
restores an older database. If the retained app changed, the current unit was
customized, or formats differ, inspect the installation and obtain a compatible
forward fix.

## Existing ordinary desktop

Quit Couch, install the native package, then explicitly retire the generated old
launcher for your account:

```sh
sudo couch-setup --desktop-user "$(id -un)"
```

Launch Couch from the application menu. The command moves the recognized
`~/.local/share/applications/couch.desktop` and old per-user recovery command to
`.appimage-retained` siblings. Customized launchers or recovery commands require
administrator inspection. AppImage bytes and application data remain in place.
To restore the old desktop entry deliberately, quit Couch and move the retained
launcher back to `couch.desktop`.

Native remote update installation and compatible-package recovery are separate
work in [#299](https://github.com/avoid-quest/couch/issues/299). This setup command
does not grant password-free package installation or general service management.
