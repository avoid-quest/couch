# Using Couch

Couch plays internet media on a TV or computer. Phones and laptops on the same
network join it to choose what plays, play it themselves, or share their own
screen or sound.

## Sources

- **Online video and music** through yt-dlp: YouTube (search, channels,
  playlists), Twitch, RaiPlay, public Bandcamp albums and tracks, SoundCloud
  tracks, and links from other sites yt-dlp supports.
- **StreamingCommunity, 123MoviesFree, AnimeSaturn and AnimeUnity** catalogues.
  An administrator sets StreamingCommunity's current address in
  **Settings → Sources**. See [providers](providers.md).
- **Radio**: avoid radio, M3U radio playlists and Radio Browser search. While a
  station plays, **Identify song** recognizes a short excerpt
  ([song recognition](radio-recognition.md)).
- **AirPlay** sound from Apple devices, on a Couch that runs on Linux
  ([Receive AirPlay](airplay.md)).
- **Live TV**: M3U playlists with an optional XMLTV guide, in
  **Settings → Sources → Live TV**. Channels that need custom headers or DRM are
  skipped.

Local files, media folders, the music library and Jellyfin were removed.

## What plays where

A Couch app hosts with **This computer** chosen and joins with **Another Couch**.

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

- Live TV in MPEG-2, AC-3, E-AC-3 or MP2 plays only in mpv on the computer that
  hosts Couch. HEVC plays where the device decodes it.
- Items that need DRM or sign-in can't play.
- Safari, Firefox, iPhone and iPad aren't verified. iOS ignores a page's volume,
  so on an iPhone only Mute or a volume of 0 changes what you hear.
- A browser can't install Couch as an app over the self-signed certificate; use
  **Add to Home screen** instead.

## Connect a phone

1. On the playback computer choose **This computer**, turn on **Share on
   network** in **Settings → Devices & network**, then choose **Pair a device**.
2. On the phone, scan the code or open the address shown. Continue past the
   browser's "not private" warning, name the device and enter the six-digit
   code. The first device you pair becomes the admin.
3. To pair a TV, open Couch on it and scan its QR code with an admin phone (or
   open the address it shows), check the code matches and choose **Pair**.

## Administrator access

Administrators manage the whole Couch from any paired device: devices, network
sharing, the live relay, TV mode, sources, hardware and updates. Controllers
browse and play. If no paired device is admin, **Settings → Devices & network**
on the host shows a one-use code under **Make a device the admin**.

To recover admin access without the host's screen, quit Couch on the host, then
start it again with a fresh secret (32–256 hex characters) and enter that under
**Admin code** on a paired device within ten minutes. In Bash, from a source
checkout (the installed app reads the same variable when started from its
executable):

```bash
read -rsp 'Recovery secret: ' COUCH_ADMIN_RECOVERY_CODE   # e.g. from openssl rand -hex 32
export COUCH_ADMIN_RECOVERY_CODE
bun run app
unset COUCH_ADMIN_RECOVERY_CODE
```

## Install

Download Couch or Couch Preview from
[releases](https://github.com/avoid-quest/couch/releases); it updates itself
afterwards. On a Mac choose Apple Silicon (`-arm64.dmg`, macOS 14+) or Intel
(`-x64.dmg`, macOS 13+); system audio sharing needs macOS 14.2.

Couch isn't notarized, so before the first launch on a Mac run once
(`Couch Preview.app` for the preview):

```sh
xattr -dr com.apple.quarantine /Applications/Couch.app
```

On Windows, SmartScreen asks **More info > Run anyway** the first time.

The installed app keeps its data in `quest.avoid.couch` under the platform's
data directory: `~/Library/Application Support` on macOS, `%APPDATA%` on Windows,
`$XDG_DATA_HOME` (`~/.local/share`) on Linux. Its log is `<data dir>/logs/couch.log`,
with the previous run in `couch.1.log`; both hold Main's and Core's output.

## Run from source

```sh
bun install --frozen-lockfile
bun run app       # builds and starts the app with data in .data
bun run dev       # browser-only loop: Core under node --watch, Vite on port 1420
```

`COUCH_DATA_DIR` and `COUCH_PORT` (default 4100) select another data directory
and port. The installed app also uses 4100, so give a source run its own port
while it runs. `bun run package` builds installers into `.artifacts/app`; see
[checks and releases](ci.md).
