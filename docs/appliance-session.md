# Ubuntu TV session

`couch-appliance` supplies the production session for Ubuntu 24.04 x86_64. It
depends on the separately versioned `couch` package. The release manifest records
both versions and hashes. Install through the documented `install-couch` entry
point so APT finishes before LightDM starts.

LightDM logs the locked `couch-tv` account into the Couch Xorg session on `seat0`.
Its home is `/var/lib/couch`. It has no sudo access; the existing SSH account and
its groups remain unchanged. PAM starts its systemd user manager and grants the
active seat access to display/audio devices. Openbox supplies window management;
PipeWire, its PulseAudio compatibility server and WirePlumber supply user audio.

The user unit `couch-tv.service` starts `/usr/bin/couch`. That native process owns
one `/usr/bin/couch-server` and exits nonzero when the coordinator dies. Systemd
restarts the complete control group after five seconds, up to five starts within
120 seconds. A deliberate `couch-session stop` stays stopped. The surrounding
LightDM session remains alive after exhaustion and shows recovery instructions,
so another login cannot silently reset the restart budget. Native and coordinator
output goes to the persistent journal.

From the SSH administrator or a local console reached with Ctrl+Alt+F3:

```sh
sudo couch-session status
sudo couch-session logs
sudo couch-session restart
```

`restart` clears the failed-start budget and restarts the complete application.
For a lost administrator browser, run `sudo couch-session recover-admin` in a
private administrator terminal. It generates a fresh 256-bit code and restarts
the same supervised native owner, passing `COUCH_ADMIN_RECOVERY_CODE` to its
coordinator. Pair the replacement browser and enter the printed code within ten
minutes. Each code can be consumed once; ordinary application restarts do not
renew its expiry or revive it. Do not paste the command output into logs or issue
comments. The code stays in a root-owned file readable only by the runtime group
under `/run/couch-appliance`, survives application crashes, and disappears on
reboot. This command preserves profiles, pairings, settings and media state.

`sudo couch-session stop` pauses it for diagnosis. For display-server trouble,
inspect `sudo journalctl -b -u lightdm` and `/var/log/lightdm/`. To recover to a
console on every boot, run `sudo systemctl disable --now lightdm` and
`sudo systemctl set-default multi-user.target`. SSH and the reserved recovery VT
remain available. Re-running the installer restores the appliance startup.

The package conffile `/etc/couch/appliance.env` sets the absolute `COUCH_DATA_DIR`.
The fresh default is `/var/lib/couch/.local/share/quest.avoid.couch`. Keep an
existing custom value on upgrade. The native application's ordinary data
precedence still applies outside this unit: explicit `COUCH_DATA_DIR`, then
`$XDG_DATA_HOME/quest.avoid.couch`, then `$HOME/.local/share/quest.avoid.couch`.
Package upgrades do not move or remove data, profiles, pairings, sources or media.
WirePlumber's saved routes and volume stay under the same runtime home.
When the package creates the runtime account, it marks one initial audio setup
attempt. After PipeWire starts, Couch selects the first available HDMI stereo
profile and its output sink. Each discovery wait is limited to ten seconds. The
attempt is consumed even if HDMI is absent or setup fails, so subsequent boots
and upgrades preserve the user's saved audio route. An administrator can request
another initial setup by recreating
`/var/lib/couch/.local/state/couch-appliance/initialize-audio` for `couch-tv` and
restarting the TV service.

At login the session disables X11 screensaver/DPMS blanking and selects the first
connected external output as primary at 1920x1080 when supported, otherwise its
preferred mode, falling back to the laptop panel. Logind
ignores idle time. With an external display connected or the laptop docked, lid
closure leaves the TV running. With only the laptop display, lid closure suspends
on AC and battery. The power button, suspend key and administrator power commands
retain their normal behavior. No power targets are masked. Package defaults live
under `/usr/lib/systemd/`; administrator drop-ins under `/etc` retain priority.

Build the companion package on Linux with `sh scripts/build-appliance.sh`. It
needs `git` and `dpkg-deb` only and records its Git revision in
`/usr/share/doc/couch-appliance/build-info.json`. It does not rebuild the native
application. The session does not wait for network access, so local home and
stored media remain usable during offline boot.
Release callers pass a monotonic Debian version as the second builder argument,
such as `sh scripts/build-appliance.sh /output 0.1.0+build.RUN.ATTEMPT`, substituting
the release's numeric run and attempt. The builder validates the version and
still records its actual Git source. The optional hash-based default is for
standalone builds and does not guarantee upgrade ordering.

The contracts above require separate qualification of a real LightDM boot,
coordinator/native failures, and physical picture/audio. Xvfb and a software
audio sink cannot establish those hardware results.

References: [LightDM configuration](https://github.com/canonical/lightdm/blob/main/data/lightdm.conf),
[Ubuntu 24.04 logind policy](https://manpages.ubuntu.com/manpages/noble/man5/logind.conf.5.html),
[Ubuntu PipeWire audio package](https://packages.ubuntu.com/noble/pipewire-audio),
and [Debian maintainer-script requirements](https://www.debian.org/doc/debian-policy/ch-maintainerscripts.html).
