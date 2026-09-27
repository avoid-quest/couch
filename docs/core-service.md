# Independent Linux Core

Run Core under systemd when the library and sessions should stay available without
an open desktop app. Playback still needs an explicitly selected browser, native
receiver or configured group. The desktop installation remains standalone, with its
own data and updater. This service does not install a player or open network ports.

## Build and install

Use a clean checkout on Linux x64 or arm64 with Bun 1.4.2. Do not set
`COUCH_PACKAGE_FORMAT` or reuse staged `src-tauri/resources/tools.json`: those inputs
select desktop packaging and its separate bundled helpers. The existing build embeds
Bun and the complete production frontend in one executable; running it needs neither
Bun, a Rust build, libmpv nor a separate `dist` directory.

```sh
bun install --frozen-lockfile
bun run build
# On arm64 use aarch64 instead of x86_64 in the two paths below.
src-tauri/binaries/couch-server-x86_64-unknown-linux-gnu --version
sudo useradd --system --user-group --home-dir /var/lib/couch-core --shell /usr/sbin/nologin couch-core
sudo install -d -m 0755 /usr/local/lib/couch-core
sudo install -m 0755 src-tauri/binaries/couch-server-x86_64-unknown-linux-gnu /usr/local/lib/couch-core/couch-server
sudo install -d -m 0700 /etc/couch-core
sudo install -m 0644 deploy/couch-core.service /etc/systemd/system/couch-core.service
sudo systemd-analyze verify /etc/systemd/system/couch-core.service
```

Check that `--version` reports the intended revision, `dirty:false` and
`packaged:false`. These are fresh-install commands; reuse an existing `couch-core`
service account on subsequent updates. Never point this service at the desktop's
SQLite database. systemd creates `/var/lib/couch-core` for this account with mode
0700. The unit forces `COUCH_NATIVE=0`, even if an environment file requests native
mode. It binds loopback port 4100 by default; choose another port in
`/etc/couch-core/core.env` if a desktop Core already uses it.

## Pair and become administrator

A fresh Core permits browser pairing. Pairing alone creates a controller; a separate
one-use recovery code establishes the administrator when there is no local TV UI.
Generate the code immediately before starting, because it expires after ten minutes:

```sh
sudo sh -c 'umask 077; printf "COUCH_ADMIN_RECOVERY_CODE=%s\n" "$(openssl rand -hex 32)" > /etc/couch-core/bootstrap.env'
sudo systemctl daemon-reload
sudo systemctl enable --now couch-core.service
sudo journalctl -u couch-core.service -n 20 --no-pager
sudo cat /etc/couch-core/bootstrap.env
curl --fail http://127.0.0.1:4100/api/health
```

Open `http://127.0.0.1:4100`, pair with the six-digit code in the journal, then open
Settings → Remotes (`/settings/connection`) and enter the recovery value under
**Admin code → Become admin**. A headless host can be reached through an SSH tunnel
from your computer:

```sh
ssh -N -L 4100:127.0.0.1:4100 user@core-host
```

Keep the browser URL and Core port consistent with the tunnel. If that local port is
occupied, configure another Core port and forward that same port. Pairings are tied
to their browser origin; switching to a LAN or HTTPS address requires pairing at
that address. After confirming administrator access:

```sh
sudo rm /etc/couch-core/bootstrap.env
sudo systemctl restart couch-core.service
```

The administrator pairing survives restart. The six-digit pairing code changes.
A consumed or expired recovery code cannot be revived by restarting; generate a
new code if recovery is needed. Recovery also allows an existing installation to
establish a replacement administrator. Protect journal access and the root-owned
bootstrap file. The current application accepts this secret through its environment
and removes it before launching media helpers; keep the bootstrap file temporary.

## Configuration and media

Create `/etc/couch-core/core.env` with root ownership and mode 0600 for overrides.
For deliberate LAN access set `COUCH_HOST=0.0.0.0` and restrict reachability to the
intended network. For HTTPS through a trusted proxy follow
[explicit HTTPS access](remote-access.md). No installer changes your firewall,
router or proxy. Sharing is persisted in the database: restarting does not override
an administrator's decision to disable remotes.

The service starts without optional media helpers. Web extraction needs yt-dlp and
Deno; install the repository's pinned helpers into a service-readable directory with
`bun run setup:media --dir /absolute/path`, then set `COUCH_YT_DLP` and `COUCH_DENO` to
the executable paths in `core.env`. Install ffprobe through your distribution when
local video metadata is needed; this source build finds it on the service PATH.
Other backends may require their own helpers, such as ffmpeg for Snapcast.

The folder picker offers `/var/lib/couch-core/Music`, `/var/lib/couch-core/Videos`
and real subdirectories of `/media` and `/mnt`. Grant the service account read and
search access to selected media. Symlink escapes are not accepted. Avoid service
sandbox overrides that hide those directories unless you intend to remove access.

## Update, backup and remove

Build and verify the next revision first. Stop `couch-core.service`, back up the
entire `/var/lib/couch-core` directory while stopped, replace only
`/usr/local/lib/couch-core/couch-server`, then start the service. Verify health and
reconnect the browser. Keep the previous executable and matching database backup;
rolling back an executable alone may not support a newer database format. Core
handles SIGTERM and closes its database and sessions before exit.

To remove the service, disable and stop it, remove its unit and executable, and run
`systemctl daemon-reload`. Preserve `/var/lib/couch-core` unless you explicitly want
to delete this installation's library configuration and pairings. Desktop data is
separate.

## Qualification

After building a clean revision, run the process qualification in the existing Linux
test environment:

```sh
bun tests/linux/core-service.ts
```

`COUCH_SIDECAR` selects the compiled executable; `COUCH_ARTIFACTS` selects the report
directory (default `.artifacts/core-service`). It verifies exact clean revision,
fresh Core-only startup, embedded frontend, HTTP pairing and administrator claim,
WebSocket baseline without a native target, restart persistence and graceful SIGTERM.
It uses disposable data and does not touch an installed service. This is process
qualification, not proof of systemd boot integration: also verify the unit and run
the install/start/restart commands on the intended host. Follow [CI guidance](ci.md)
for the required `act` check before dispatching packaging changes.

The unit uses systemd's standard [service lifecycle](https://github.com/systemd/systemd/blob/main/man/systemd.service.xml)
and [execution environment and state directory](https://github.com/systemd/systemd/blob/main/man/systemd.exec.xml)
settings. `Type=exec` reports execution failures, not application readiness; use the
health endpoint to check readiness.
