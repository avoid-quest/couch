# Couch usage and development

Couch plays internet media on a TV or computer and lets every phone on the LAN
control it. The Electron app shows it; Core (Node) owns the shared queue, catalogs
and paired remotes.

## Sources

- **Online video and music** through yt-dlp: YouTube (search, channels and
  playlists), Twitch (live channels and categories), RaiPlay (live TV,
  programmes and replays), public Bandcamp albums and tracks (including keyword
  search), SoundCloud track search, and pasted links from other sites yt-dlp supports.
- **StreamingCommunity** catalogue browsing, search, seasons and episodes. An
  administrator sets its current origin in **Settings → Sources**.
- **123MoviesFree** film and TV-season browsing, search, saved items and episode
  selection. Its direct player integration is experimental: live manifests
  returned HTTP 502 during verification. See [source details](123moviesfree.md).
- **[AnimeSaturn](animesaturn.md) and [AnimeUnity](animeunity.md)** anime browsing,
  search, episode selection, saved items and lists, with direct playback from
  their public players. Whole-anime queueing and automatic continuation support
  lists of up to 500 episodes; choose individual episodes for longer anime.
- **Radio**: avoid radio in one click, extended M3U radio playlists and Radio
  Browser search, with shared favorites.
- **AirPlay** sound from an iPhone, iPad or Mac, on a Couch that runs on Linux,
  once an admin turns it on in **Settings → Sources**: [Receive AirPlay](airplay.md).
- **Live TV**: M3U playlists, with an optional XMLTV guide, in **Settings →
  Sources → Live TV**. Channels that need custom headers or DRM are skipped.
  Edit keeps saved URLs unless you type new ones; **Remove guide** drops a
  source's guide and its programmes. Browse them in Discover's **Live TV**.

Local files, media folders, the music library and Jellyfin were removed.
Existing databases still open; their old entries stay readable but no longer play.

Bandcamp and SoundCloud open a search prompt from **Discover → Sources**; they
have no catalogue home or genre feed in Couch. Bandcamp search returns albums
and tracks in one result list, without a next page. Its catalogue accepts public
`artist.bandcamp.com/album/...` and `/track/...` links; artist or label homepages,
tag pages and custom domains are not catalogue links. SoundCloud track searches
offer **More from SoundCloud**.

## What plays where

A Couch app hosts with **This computer** chosen and joins with **Another
Couch**. The Linux TV column waits for a real TV: the TV layout was only run on
a Mac.

| Source | Couch app hosting | Couch app joining | Desktop browser | Phone browser | Linux TV | Synced sound on several devices |
|---|---|---|---|---|---|---|
| YouTube videos, channels, playlists | Yes | Yes | Yes | Yes | Not tested | Yes |
| Twitch live and videos | Yes | Yes | Yes | Yes | Not tested | Yes |
| RaiPlay live and replays | Yes | Yes | Yes | Yes | Not tested | Yes |
| Bandcamp | Yes | Yes | Yes | Yes | Not tested | Not tested |
| StreamingCommunity | Yes | Not tested | Yes | Not tested | Not tested | Not tested |
| 123MoviesFree | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified |
| AnimeSaturn and AnimeUnity | Not verified | Not verified | Yes | Not verified | Not verified | Not verified |
| Radio | Yes | Yes | Yes | Yes | Not tested | Yes |
| Other yt-dlp sites (Dailymotion, SoundCloud) | Yes | Yes | Yes | Yes | Not tested | Yes |
| Vimeo | Depends on item | Not tested | Depends on item | Not tested | Not tested | Not tested |
| Live TV, H.264 (HLS or MPEG-TS) | Yes | Not tested | Yes | Not tested | Not tested | Yes |
| Live TV, MPEG-2, AC-3, E-AC-3 or MP2 | Yes, in its own window | Host only | Host only | Host only | Not tested | Host only |

- Live TV channels in MPEG-2, AC-3, E-AC-3 or MP2 play only in mpv on the
  computer that hosts Couch. Asked for elsewhere, the player says "This channel
  plays only on" the host. HEVC channels play where the device decodes HEVC,
  with conservative mpv fallback when the requested outputs include a Linux
  host and no H.264 alternative is available. Remote-only HEVC tries that
  browser's decoder; a decoding failure never adds or starts the host.
  Adding the Linux host to HEVC-only playback takes the same native fallback,
  leaving only the host. Turning off both channels of a pending Move here destination
  cancels that move; the original device keeps playing and Move here can be tried again.
  Actual HEVC support depends on the browser build and device.
- Public Vimeo items without DRM can play through yt-dlp; items requiring DRM
  or sign-in cannot. Other sites requiring DRM or sign-in cannot play either. Live TV
  channels that need custom headers or DRM are skipped when the list is added.
- Safari, Firefox and iPhone or iPad aren't verified. iOS ignores a page's
  volume, so on an iPhone only Mute or a volume of 0 changes what you hear.
- The browser can't install Couch as an app over the network's self-signed
  certificate. Use the browser's **Add to Home screen** shortcut instead.
- YouTube in a plain browser depends on no-cors fetches from googlevideo, which
  browsers may block. It hasn't failed in Chrome so far.
- StreamingCommunity's picture quality follows the connection; the quality you
  choose doesn't cap it.

## Connect a phone

1. On the playback computer choose **This computer**, turn on **Share on
   network** in **Settings → Devices & network**, then choose **Pair a device**
   there.
2. On the phone, scan the code or open the address shown there. The first time,
   the browser warns that the connection isn't private: continue to the page.
   Fill in **Name this device** and the six-digit **Pairing code**. The first
   device you pair becomes the admin. The dialog closes when the phone pairs,
   and a message names it, ending in "· admin" for the first.
3. Type in the header's search field and press Enter. To search one kind or
   source, pick it from the list under the field first, or type its name (`film`,
   `music`, `yt`) and press Tab. Results are grouped by kind; **Music** holds
   Bandcamp and SoundCloud. **Play** starts an item now; **Queue** in its **…**
   menu adds it to Up next. Paste a link and press Enter to play it; a YouTube,
   Twitch, RaiPlay, Bandcamp, StreamingCommunity, 123MoviesFree, AnimeSaturn or
   AnimeUnity link can also open its page.

**Settings → This device → Online video quality** saves this
browser's default quality for online video it starts, wherever it plays (Auto is up to 1080p).

## Administrator access

The first device you pair becomes the admin. If no paired device is admin later,
**Settings → Devices & network** on the host shows a one-use code under **Make a device the
admin**. Enter it under **Admin code** on a paired device and choose **Become
admin**. Administrators manage the whole Couch from any paired device: paired
devices, network sharing and HTTP, the live relay, TV mode, sources, hardware
and updates. Controllers browse and play, change the shared Playback
preferences, and see the rest read-only. Each device's own speaker and screen
consent stays with that device.

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

Pair the replacement browser, open **Settings → Devices & network**, enter that secret
under **Admin code** and choose **Become admin**. Its ten-minute deadline starts
when the server first accepts the configured secret. Restarting with the same
value neither extends that deadline nor makes a consumed secret reusable. An
expired or consumed secret requires a fresh value and another local restart.
Recovery grants administration to the replacement browser; it does not revoke
the old administrator.

Core removes the recovery variable from its environment before starting media
helpers. The server stores a hash, and never sends the secret in a snapshot or
QR code.

## Install

Download Couch, or Couch Preview, from
[Couch releases](https://github.com/avoid-quest/couch/releases): the
dmg on a Mac, the exe on Windows, the AppImage or deb on Linux. After that it
updates itself.

Couch isn't notarized by Apple, so the first time macOS won't open it. Move it
to Applications, then run this once in Terminal (`Couch Preview.app` for the
preview):

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
  at start and every 4 hours. **Settings → Updates** shows them: the
  Couch's apps on the host, the app's own in **Another Couch** mode.

From a paired administrator phone, the Couch's **Settings → Updates** lists the host app
and connected Couch apps, including TVs in **Another Couch** mode. Choose the
TV, check for updates, then click **Update and restart** when its update is
ready. The TV installs and reconnects itself; no keyboard, SSH or physical
access is needed. Controllers can play media but cannot update devices.

See [checks](ci.md) for typecheck and build.
