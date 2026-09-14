# Install Couch on Debian 13

Couch supports Debian 13 Trixie, amd64, in an X11 session. Use an existing desktop,
or choose TV setup on minimal Debian. Both profiles use the same complete signed
AppImage. The target needs no source checkout, Bun, Rust, compiler, ffmpeg package
or manually installed Couch libraries.

## Verify the download

Obtain `couch-updater.pub` from the authenticated Couch HTTPS download site.
Use that enrolled key for all three release assets. A checksum downloaded next to
an executable does not authenticate its publisher. Hosted key distribution and
public download links are supplied by the release ticket; do not substitute a
key supplied by an untrusted mirror.

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
address and checks peers against that interface's subnet. Remote mode stops the
local backend. If multiple eligible networks exist, choose one by launching with
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
The hosted-release ticket owns the new line's update enrollment and final update
integration. Existing POC installations need no migration.

## Recover a retained app

Quit Couch first on an ordinary desktop. Select the existing updater's retained
backup directory containing `Couch.AppImage`, `build.json` and `SHA256SUMS`:

```sh
~/.local/bin/couch-recover /absolute/retained-backup
# TV profile:
sudo couch-recover /absolute/retained-backup
```

Recovery verifies the retained checksum and matching build identity. It refuses
incompatible data formats, saves the failed installation's current data, and
replaces only app bytes. It never restores an older database. Retain local backups;
older hosted releases can expire. A data-format conflict needs a forward fix or
an explicit operator decision outside this command.

The package/installer checks are separate from the final pristine Debian GUI,
playback, boot and Mac-offline update acceptance. Those remain with the acceptance
ticket. No container version command establishes a successful desktop installation.
