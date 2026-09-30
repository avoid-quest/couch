# Couch usage and development

Couch plays internet media on a TV or computer and lets every phone on the LAN
control it. The Electron app shows it; Core (Node) owns the shared queue, catalogs
and paired remotes. The rebuild is tracked in
[#644](https://github.com/avoid-quest/couch/issues/644).

## Sources

- **Online video and music** through yt-dlp: YouTube (search, channels and
  playlists), Twitch (live channels and categories), RaiPlay (live TV,
  programmes and replays), public Bandcamp albums and tracks, and pasted links
  from other sites yt-dlp supports.
- **StreamingCommunity** catalogue browsing, search, seasons and episodes. An
  administrator sets its current origin in **Settings > Sources**.
- **Radio**: avoid radio in one click, extended M3U radio playlists and Radio
  Browser search, with shared favorites.
- **Live TV**: M3U playlists with an XMLTV guide in **Settings > Sources > Live
  TV**.

Local files, media folders, the music library and Jellyfin were removed.
Existing databases still open; their old entries stay readable but no longer play.

## Connect a phone

1. On the playback computer choose **This computer** and turn on **Allow
   remotes** in **Settings > Remotes**, then open **Pair a remote**.
2. On the phone, open the address shown there, name the browser and enter the
   six-digit code.
3. Search in **Find**, or paste a link. **Play** starts an item now; **Up next**
   appends it.

**Settings > Playback > Video quality** saves this browser's default online video
quality (Auto is up to 1080p).

## Administrator access

On an unclaimed Couch, **Settings > Remotes** shows a separate one-use
administrator code. Pair the phone first, then enter that code under **Claim
administrator** on the phone. Administrators manage paired devices, sources and
device settings; Controllers browse and play.

### Recover administrator access

Recovery requires trusted local or SSH access to the TV computer. For a source
checkout, stop Couch, generate a fresh secret of 32 to 256 hexadecimal characters,
and supply it through `COUCH_ADMIN_RECOVERY_CODE` when restarting the app. For example, use
`openssl rand -hex 32` to generate a secret, then run these commands in a local
Bash terminal in a source checkout, entering the secret at the hidden prompt:

```bash
read -rsp 'Recovery secret: ' COUCH_ADMIN_RECOVERY_CODE
export COUCH_ADMIN_RECOVERY_CODE
bun run app
unset COUCH_ADMIN_RECOVERY_CODE
```

Pair the replacement browser, open **Settings > Connections > Claim administrator**, and enter that secret
in **Administrator code**. Its ten-minute deadline starts when the server first
accepts the configured secret. Restarting with the same value neither extends
that deadline nor makes a consumed secret reusable. An expired or consumed secret
requires a fresh value and another local restart. Recovery grants administration
to the replacement browser; it does not revoke the old administrator.

Core removes the recovery variable from its environment before starting media
helpers. The server stores a hash, and never sends the secret in a snapshot or
QR code.

## Install

Download Couch, or Couch Preview, from
[couch-releases](https://github.com/avoid-quest/couch-releases/releases): the
dmg on a Mac, the exe on Windows, the AppImage or deb on Linux. After that it
updates itself.

Couch isn't signed by Apple, so the first time macOS says it "is damaged" or
"can't be opened". Move it to Applications, then run this once in Terminal
(`Couch Preview.app` for the preview):

```sh
xattr -dr com.apple.quarantine /Applications/Couch.app
```

This removes the quarantine flag the browser put on the download. Updates the
app installs itself never carry it, so this is needed only once. On Windows,
SmartScreen shows **More info > Run anyway** the first time.

## Run from source

Install Bun 1.4.x and Node 24 or later. Core finds or downloads its media
helpers itself (see [architecture](architecture.md#helpers)).

```sh
bun install --frozen-lockfile
bun run app
```

- `bun run app` builds everything and starts the Electron app from the checkout.
  Its data defaults to `.data`; `COUCH_DATA_DIR` and `COUCH_PORT` (default 4100)
  select another scratch directory and port. An installed app uses the Tauri
  app's data directory instead: `~/Library/Application Support/quest.avoid.couch`
  on macOS, `%APPDATA%\quest.avoid.couch` on Windows and
  `$XDG_DATA_HOME/quest.avoid.couch` (`~/.local/share/...`) on Linux.
- `bun run dev` runs the browser-only loop: Core under `node --watch` and Vite
  on port 1420, which proxies `/api` to Core.
- `bun run build && bun run start` runs Core alone under Node and serves the
  built UI on port 4100.
- `bun run package --mac dmg` (or `--win nsis`, `--linux AppImage deb`) builds
  installers into `.artifacts/app` with electron-builder. A `-preview.N`
  version in `package.json` builds Couch Preview. The
  [Package](../.github/workflows/package.yml) workflow builds all three, and
  [releases](ci.md#releases) publish them. The installed app checks for updates
  at start and every 4 hours; **Settings > Updates** shows them.

From a paired administrator phone, **Settings > Updates** lists the host app
and connected Couch apps, including TVs in **Another Couch** mode. Choose the
TV, check for updates, then click **Update and restart** when its update is
ready. The TV installs and reconnects itself; no keyboard, SSH or physical
access is needed. Controllers can play media but cannot update devices.

See [checks](ci.md) for typecheck and build.
