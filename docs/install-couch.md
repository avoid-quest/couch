# Install Couch on Debian 13

Native Debian package development and its explicit TV migration are documented
in [Native Debian TV setup](native-tv.md). The instructions below describe the
currently published AppImage release.

Couch supports Debian 13 Trixie, amd64, in an X11 session. Use an existing desktop,
or choose TV setup on minimal Debian. Both profiles use the same complete signed
AppImage. The target needs no source checkout, Bun, Rust, compiler, ffmpeg package
or manually installed Couch libraries.

## Verify the download

Download the release files from [Couch downloads](https://couch.avoid.quest/download).
Obtain `couch-updater.pub` from `https://couch.avoid.quest/couch-updater.pub`.
Use that enrolled key for all three release assets. A checksum downloaded next to
an executable does not authenticate its publisher. Do not substitute a key supplied by an untrusted mirror. The site exposes links
only after all six public assets and the installer/updater endpoints pass verification.

Before installing bootstrap tools, check the supported target:

```sh
. /etc/os-release
[ "$ID" = debian ] && [ "$VERSION_ID" = 13 ] && [ "$(dpkg --print-architecture)" = amd64 ] || exit 1
sudo apt-get update
sudo apt-get install minisign jq
```

Download `Couch_<V>_amd64.AppImage`, `couch-setup-<V>.tar.gz`, their matching `.sig`
files, and the enrolled public key. Replace `<V>` with the release version in
these commands. Tauri wraps Minisign keys and signatures in outer base64:

```sh
base64 --decode couch-updater.pub > couch-updater.minisign.pub
base64 --decode couch-setup-<V>.tar.gz.sig > couch-setup.minisig
minisign -Vm couch-setup-<V>.tar.gz -p couch-updater.minisign.pub -x couch-setup.minisig
```

Continue only if verification succeeds. Extract into a new directory, then run
one of the commands below. The installer verifies the AppImage itself before
executing it or provisioning host packages.

```sh
mkdir couch-setup
tar -xzf couch-setup-<V>.tar.gz -C couch-setup
```

## Existing desktop

Run from the account that will use Couch:

```sh
sudo ./couch-setup/install-couch --desktop-user "$(id -un)" \
  --appimage ./Couch_<V>_amd64.AppImage \
  --signature ./Couch_<V>_amd64.AppImage.sig --public-key ./couch-updater.pub
```

Launch Couch from the application menu in an X11 session. Setup preserves the
display manager, login, autologin and power settings. It preserves an installed
PulseAudio-compatible service. If none is installed, Debian supplies PipeWire.
The app lives at `~/.local/lib/couch/Couch.AppImage`, owned by the desktop user.

## Minimal TV device

Keep the Debian administrator account, its password and any existing SSH access.
Connect a display, then run:

```sh
sudo ./couch-setup/install-couch --tv \
  --appimage ./Couch_<V>_amd64.AppImage \
  --signature ./Couch_<V>_amd64.AppImage.sig --public-key ./couch-updater.pub
```

TV setup creates the locked, unprivileged `couch-tv` account. Debian supplies
Xorg, Openbox, LightDM and PipeWire, with Bluetooth support when hardware exists.
No full desktop is installed. Reboot when convenient to start the session.
The app lives at `/var/lib/couch/application/Couch.AppImage`, owned by `couch-tv`.
The administrator can recover through SSH or Ctrl+Alt+F3:

```sh
sudo couch-session logs
sudo couch-session restart
```

Setup refuses an existing display-manager policy instead of replacing it.
Use ordinary installation on a configured desktop. Repeated TV setup updates
unchanged setup files and preserves administrator-edited files, disabled startup
and custom data paths. Review any preservation messages before rebooting.

## Host maintenance, networking and data

The setup archive's `host-packages.json` is the explicit Debian package list.
It includes FUSE mount helpers from `fuse3`, AppImage ABI support from
`libfuse2t64`, device-side GL/VA drivers, certificates, fonts, X11/audio commands,
D-Bus and WebKit sandbox support. Setup checks package installation, command
availability and runtime-user access to `/dev/fuse`. Missing physical graphics,
audio or Bluetooth devices cannot be repaired by downloading another helper.
Keep Debian current using its ordinary administrator tools.

Couch discovers and refreshes its private IPv4 LAN address every ten seconds.
Sharing off leaves only the loopback listener; sharing on binds the selected LAN
address and checks peers against that interface's subnet. Remote mode stops local playback and sharing. Its private local maintenance
process keeps this installation's updater available. If multiple eligible networks exist, choose one by launching with
`COUCH_LAN_INTERFACE=<interface>`. If that interface owns multiple private IPv4
addresses, also set `COUCH_LAN_ADDRESS=<local-IP>` to select one. Add these variables
to `/etc/couch/appliance.env` for TV setup, then restart Couch. The selected address
must already belong to that interface; Couch reports a missing address or an
occupied port. Enable Allow remote control locally and use the address and pairing
code shown by Couch. The default is HTTP on port 4100.
The machine/network administrator owns IP assignment and any narrowly scoped
firewall rule. Setup does not disable a firewall, configure router forwarding,
install a proxy/DNS daemon or require an internet-facing address. Optional custom
LAN DNS must point directly to this machine on port 4100. Set
`COUCH_ADVERTISE_URLS=http://<your-LAN-name>:4100` in the launching environment.
Couch checks that DNS resolves only to the selected address. A failed lookup or
invalid alias displays a warning and omits that alias from links and Host/Origin
admission. The direct IP listener stays open and its address remains visible for
recovery. Valid aliases keep working; repaired aliases return on a successful
refresh. A new origin may need pairing again; Couch never forwards an existing
pairing credential to an advertised alias. See [Named LAN address](lan-origin.md)
for configuration and recovery. LAN TLS remains deferred.

Persistent data lives outside app bytes at
`$XDG_DATA_HOME/quest.avoid.couch`, defaulting to
`~/.local/share/quest.avoid.couch`. TV setup declares its default data path in
`/etc/couch/appliance.env`. Setup does not copy an ordinary user's data into the TV
account. Rerunning setup with a different AppImage is refused; subsequent signed
app upgrades belong to Couch's updater, with no root package or session changes.
Existing POC installations need no migration.

## Install signed updates

Settings > Updates controls the current installation. In the native app's remote
mode, use **Update this app** in its own top bar. These controls work even when
the selected remote computer cannot be reached. The remote computer's Settings
updates that remote installation; each retains its own channel and timing.

Choose Stable or Preview separately from Manual or Auto when idle. A fresh
installation defaults to Stable and Manual; choose Preview explicitly to follow
prereleases. Checks use CrabNebula at startup, every 15 minutes and on request.
The publishing Mac need not be online. Download and verify, then choose Install
and restart. Desktop Couch relaunches through Tauri; the TV session uses its
existing systemd supervisor. Couch preserves the saved playback mode and target
and does not resume playback automatically.

Auto when idle waits for ten continuous minutes without playback, paused/loading
media, radio retries, input, recordings or scans/imports. Remote control and
reconnection also count as activity. A late activity check can defer replacement.
Manual interruption of playback requires confirmation; recording or data work
must finish. Controllers cannot install updates. Local users and paired
Administrators may do so.

Before interruption Couch verifies saved bytes, Debian prerequisites, available
space and data compatibility. It then closes admission, stops writers and backs
up the previous verified app and current data under the application directory's
`backups/<request-id>/`. Browser-profile backup is best effort.
The app reports success only after the restarted build and local health match.
A failed candidate is not automatically retried. Keep its result and use recovery
or a compatible newer release.

## Recover a retained app

Quit Couch first on an ordinary desktop. Select the existing updater's retained
backup directory containing `Couch.AppImage`, `Couch.AppImage.sig`, `build.json` and `SHA256SUMS`:

```sh
~/.local/bin/couch-recover /absolute/retained-backup
# TV profile:
sudo couch-recover /absolute/retained-backup
```

Recovery verifies the retained signature against the installed public key, checksum
and matching build identity. It refuses
incompatible data formats, saves the failed installation's current data, and
replaces only app bytes. It never restores an older database. Retain local backups;
older hosted releases can expire. A data-format conflict needs a forward fix or
an explicit operator decision outside this command.

The package/installer checks are separate from the final pristine Debian GUI,
playback, boot and Mac-offline update acceptance. Those remain with the acceptance
ticket. No container version command establishes a successful desktop installation.
