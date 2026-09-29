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

Setup refuses an unrelated existing display manager or Couch service override.
Repeated setup preserves administrator configuration, data-directory overrides,
disabled autologin and logind masks. It does not restart LightDM or logind. Reboot
when convenient to apply first-time session and power configuration.

The retired 0.1.0 AppImage installation is not migrated. Fresh installations use
the package above; an old AppImage installation stays as it is and its session is
not switched. In-app updates were removed while Couch is rebuilt
([#644](https://github.com/avoid-quest/couch/issues/644)); setup grants no
package-manager privileges.
