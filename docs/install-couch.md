# Install Couch

Download the verified Debian package from
[couch.avoid.quest/download](https://couch.avoid.quest/download).
Couch supports Debian 13 amd64 with an X11 desktop. The page shows the actual
filename and installation command for the published version.

## Desktop

Open a terminal in the download folder and run the page's `sudo apt install`
command. APT installs Couch and its Debian dependencies. Open **Couch** from your
applications menu and choose **This computer** for local playback. Enable remote
control if you want to pair a phone.

The package contains the app, its media helpers and dependency notices.
Installation needs the computer's administrator authorization. It needs no
source checkout, compiler, Bun, Node, Minisign, jq or separate setup archive.
Desktop data stays under the `quest.avoid.couch` application identity.

## Dedicated TV

After installing the package, run:

```sh
sudo couch-setup --tv
```

This explicitly creates the unprivileged TV account, configures the Couch login
session and applies TV power settings. Keep your ordinary administrator account
and SSH access. Reboot when convenient. Choose **This computer**, enable remote
control, and pair your phone using the displayed QR or code.

For an existing Couch TV, the same command migrates the service while preserving
its data location, settings and paired devices. Ordinary package installation
does not switch the old AppImage service automatically. See
[native TV setup and migration](native-tv.md) for repeat setup, conflicts and
retained-AppImage recovery.

## Updates and recovery

A paired Administrator can check, download and install signed updates in Couch's
settings. Manual updates are the default. **Auto when idle** waits for ten
continuous idle minutes. Another running Couch session must close before a
system-wide package update can proceed.

Couch verifies the download, stops application writers and retains a data backup.
A restricted root service independently verifies the exact package before APT
installs it. It grants no general APT or shell permission. Couch reports success
after the new application and backend pass their startup checks.

An interrupted or failed package installation may need an OS administrator to
repair APT and reinstall a compatible package. Preserve current data and inspect
the retained transaction; do not automatically restore an older database.
Keep the original downloaded package if you need it for recovery.

## Existing desktop AppImage

Quit Couch, install the Debian package, then retire the old generated launcher:

```sh
sudo couch-setup --desktop-user "$(id -un)"
```

AppImage bytes and application data stay in place. Customized launchers require
inspection rather than replacement. The [legacy AppImage instructions](install-appimage.md)
remain available for the original release; they are not the native installation
path.
