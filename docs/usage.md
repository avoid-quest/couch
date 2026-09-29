# Couch usage and development

Couch plays internet media on a TV or computer and lets every phone on the LAN
control it. Tauri embeds libmpv; Bun owns the shared queue, catalogs and paired
remotes. The rebuild into one Electron app is tracked in
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
bun run desktop
unset COUCH_ADMIN_RECOVERY_CODE
```

Pair the replacement browser, open **Settings > Connections > Claim administrator**, and enter that secret
in **Administrator code**. Its ten-minute deadline starts when the server first
accepts the configured secret. Restarting with the same value neither extends
that deadline nor makes a consumed secret reusable. An expired or consumed secret
requires a fresh value and another local restart. Recovery grants administration
to the replacement browser; it does not revoke the old administrator.

Bun removes the recovery variable from its environment before starting media
helpers. The server stores a hash, and never sends the secret in a snapshot or
QR code.

## Run from source

Install Bun 1.4.x and Rust stable with [rustup](https://rustup.rs). On macOS
install Apple's command-line tools (`xcode-select --install`) and Homebrew `mpv`
for libmpv. On Linux install the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#linux) plus
`libmpv-dev`. yt-dlp (and a JavaScript runtime for YouTube) come from `PATH`, or
run `bun run setup:media` to download pinned copies into the data directory.

```sh
bun install --frozen-lockfile
bun run desktop
```

- Vite serves the UI on port 1420 and proxies `/api` to the coordinator on port
  4100 (`COUCH_PORT`).
- `COUCH_DATA_DIR` selects the data directory. The default is the Tauri app data
  directory (`~/Library/Application Support/quest.avoid.couch` on macOS), which
  an installed Couch shares. To keep a development run apart from an installed
  Couch, also pass another identifier:

  ```sh
  COUCH_DATA_DIR=/tmp/couch-dev bun scripts/desktop.ts dev \
    --config src-tauri/tauri.dev.conf.json --config '{"identifier":"quest.avoid.couch.dev"}'
  ```

- Edits under `src/client` hot reload. Edits under `src/server`, `src/shared` and
  `src-tauri` restart the app.
- `bun run dev` runs the browser-only loop: the coordinator from source and Vite.

See [checks](ci.md) for typecheck and build.
