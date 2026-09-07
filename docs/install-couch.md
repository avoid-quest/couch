# Install Couch on Ubuntu Server

Start with Ubuntu 24.04 Server on x86_64 hardware, an SSH administrator with sudo,
AC power, and a connected display. Copy the authenticated release's `install-couch`,
`Couch.AppImage` and `couch-appliance` Debian package onto the machine.
Verify their hashes against the release manifest before invoking the installer.
The private development package is transferred through the authenticated Mac.

Run one command, using the downloaded artifact paths:

```sh
sudo bash install-couch /absolute/path/Couch.AppImage /absolute/path/couch-appliance.deb
```

The installer checks Ubuntu 24.04 and the companion package, runs APT with production dependencies,
then starts LightDM. Package maintainer scripts cannot start services while APT
is working. They do not run APT themselves. The runtime uses the locked,
unprivileged `couch-tv` account. The existing administrator keeps SSH and sudo.
The installer does not reboot the machine or change its network configuration.
Running it selects Couch as the LightDM session and enables LightDM startup,
including removing a previous LightDM mask. It refuses a different configured
display manager and does not replace an administrator's custom systemd unit.
Fresh installs enable passwordless Couch startup. Reinstallation preserves the
General startup choice in the installer-owned LightDM override. See
[TV startup and SSH recovery](appliance-session.md) before disabling it.
After APT installs the Xorg input rules, it refreshes input devices so the first
graphical login uses the existing system keyboard configuration.

For existing Couch data on the first appliance install, append
`--data-dir /absolute/path/to/data`. Stop the previous Couch process first.
The installer retains file ownership and grants the runtime account access with
ACLs. This path should contain only Couch state, not a whole home directory.
Default ACLs let the runtime read future state files. The installer preserves
existing `/etc/couch/appliance.env` on repeated installation and upgrades; omit
`--data-dir` or pass the same path once that file exists. External media folder permissions are managed
separately. Keep your existing OS backup and a backup of Couch data before changing
the machine's session.

Re-run the same command to repair the session or complete an interrupted migration.
Application updates use Tauri after trusted key enrollment.
APT preserves the configured data path, and the session package does not delete
settings, profiles, pairings, sources or media. An APT failure restores any
preexisting service-start policy and leaves the GUI stopped for diagnosis. The
installer keeps its interrupted policy backup and initial data choice under
`/var/lib/couch-installer`. A retry restores the original policy and completes
the chosen data adoption, even if power failed after APT wrote a default conffile.
LightDM stays masked across an interrupted install and reboot until a successful
retry unmasks it. No suspend or power target is masked. SSH
remains available. Fix the reported APT error and rerun the installer.

After installation the session starts without a network dependency. Offline boot
can display Couch and use local media; online services still require connectivity.
See [session operation and recovery](appliance-session.md) for supervision,
administrator recovery, AC/lid behavior and returning to a console.

Qualification must cover a clean Ubuntu installation, repeat and upgrade with
preserved data, offline and cold boot, bounded native/coordinator failure recovery,
and an actual 1080p SDR picture with stereo audio. Container checks establish
package behavior only. Record the human's physical observations separately.

The migration stops the old updater and all supervised writers, saves consistent
data and configuration under `/var/lib/couch-installer/`, installs the companion,
removes the old `couch` Debian package and its application APT source, then places
the bundle at `/var/lib/couch/application/Couch.AppImage` owned by `couch-tv`.
The Ubuntu companion no longer depends on the application Debian package.
Old updater receipts/backups remain available for diagnosis; their worker is disabled.

Enroll the Tauri public key through the authenticated administrator channel:

```sh
sudo bash install-couch /absolute/Couch.AppImage /absolute/couch-appliance.deb \
  --release-key /absolute/couch.pub --release-key-sha256 TRUSTED_SHA256 \
  --release-feed 'https://releases.example/tauri/'
```

The hash must come from the trusted publisher, not the feed being enrolled.
The installer writes root-owned `/etc/couch/appimage-update.json` with the endpoint
and public key; an existing different key is refused before stopping the session.
The application retains the selected Stable/Preview channel in its existing data.
See [operator recovery](update-worker.md) before the first installation.
