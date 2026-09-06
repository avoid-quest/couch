# Install Couch on Ubuntu Server

Start with Ubuntu 24.04 Server on x86_64 hardware, an SSH administrator with sudo,
AC power, and a connected display. Copy the authenticated release's `install-couch`,
`couch` Debian package and `couch-appliance` Debian package onto the machine.
Verify their hashes against the release manifest before invoking the installer.
The private development package is transferred through the authenticated Mac.

Run one command, using the two downloaded package paths:

```sh
sudo bash install-couch /absolute/path/couch.deb /absolute/path/couch-appliance.deb
```

The installer checks the OS and packages, runs APT with production dependencies,
then starts LightDM. Package maintainer scripts cannot start services while APT
is working. They do not run APT themselves. The runtime uses the locked,
unprivileged `couch-tv` account. The existing administrator keeps SSH and sudo.
The installer does not reboot the machine or change its network configuration.

For existing Couch data on the first appliance install, append
`--data-dir /absolute/path/to/data`. Stop the previous Couch process first.
The installer retains file ownership and grants the runtime account access with
ACLs. This path should contain only Couch state, not a whole home directory.
Default ACLs let the runtime read future state files. The installer preserves
existing `/etc/couch/appliance.env` on repeated installation and upgrades; omit
`--data-dir` or pass the same path once that file exists. External media folder permissions are managed
separately. Keep your existing OS backup and a backup of Couch data before changing
the machine's session.

Re-run the same command to repair the session or install newer release packages.
APT preserves the configured data path, and the session package does not delete
settings, profiles, pairings, sources or media. An APT failure restores any
preexisting service-start policy and leaves the GUI stopped for diagnosis. SSH
remains available. Fix the reported APT error and rerun the installer.

After installation the session starts without a network dependency. Offline boot
can display Couch and use local media; online services still require connectivity.
See [session operation and recovery](appliance-session.md) for supervision,
administrator recovery, AC/lid behavior and returning to a console.

Qualification must cover a clean Ubuntu installation, repeat and upgrade with
preserved data, offline and cold boot, bounded native/coordinator failure recovery,
and an actual 1080p SDR picture with stereo audio. Container checks establish
package behavior only. Record the human's physical observations separately.
