# Native Debian TV setup

The native `.deb` includes optional TV setup. Installing the package alone leaves
the current login, display manager and power policy unchanged.

## Dedicated TV

On minimal Debian 13 amd64, install the native package and explicitly enable TV
setup from the ordinary administrator account:

```sh
sudo apt install ./Couch_<V>_amd64.deb
sudo couch-setup --tv
sudo reboot
```

Setup installs Debian's Xorg, Openbox, LightDM, PipeWire and Bluetooth support. It
creates the locked, unprivileged `couch-tv` account and enables its graphical
session. Couch runs from the root-owned `/usr/bin/couch`. No source checkout or
manual verification utility is needed.

Keep your administrator account, password and SSH access. Setup does not alter
them. From SSH or Ctrl+Alt+F3, use `sudo couch-session logs`, `status` or `restart`.
The initial session offers **This computer** or **Another Couch**. Select this
computer for TV playback, optionally allow remote control, then pair a phone
using Couch's displayed QR or code. An unclaimed TV shows **Claim and name**
with a separate administrator code. Later, **Pair a remote** in the header or
**Settings > Connections** shows the current pairing QR and six-digit code.
Use **Now** for playback and Up next, **Find** for search and sources, and
**Saved** for lists and favorites. TV **Settings > Appearance** offers Default,
Larger and Largest at 100%, 115% and 130%; confirm a trial size within 20
seconds or the TV returns to its saved size. Client size stays separate.

Setup refuses an unrelated existing display manager or Couch service override.
Repeated setup preserves administrator configuration, data-directory overrides,
disabled autologin and logind masks. It does not restart LightDM or logind. Reboot
when convenient to apply first-time session and power configuration.

The retired 0.1.0 AppImage installation is not migrated. Fresh installations use
the package above; an old AppImage installation stays as it is and its session is
not switched. The trusted local host and paired Administrators can install
signed native updates through the restricted package-update service;
Controllers cannot. Manual is the default, and Auto when idle is optional.
Setup grants no general package-manager privileges.
