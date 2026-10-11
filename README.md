# couch.avoid.quest

Streams and radio on one screen. Every phone is a remote.

Couch is a shared media player for the living room, part of **avoid.quest**.
Run it on the computer connected to your TV, or on your own Mac or PC. Pair
phones and laptops as remotes and build one queue together.

Couch runs as one Electron app where every client is a full Device.

## Take a seat

- **Pick something online.** Browse YouTube, Twitch, RaiPlay or
  StreamingCommunity, open Bandcamp albums and tracks, or play other website
  links through yt-dlp. Automatic quality is up to 1080p.
- **Tune in.** Add avoid radio in one click, import a radio M3U playlist, find
  stations through Radio Browser, or add IPTV playlists with an XMLTV guide.
- **Share the controls.** Scan the pairing QR or enter its six-digit code.
  Everyone can browse independently, add to the shared queue, and control
  playback.
- **Come back later.** Save playlists and items for later, and resume where you
  left off.

**This computer** hosts Couch in the app; **Another Couch** shows a paired host's
own page in the app window. Browser remotes connect on your local network.

## Install

Download the macOS `.dmg`, Windows `.exe`, or Linux `.AppImage` / `.deb` from
[Releases](https://github.com/avoid-quest/couch/releases).
See the [installation notes](docs/usage.md#install) for macOS's first-launch
command and Windows's SmartScreen prompt.

On Linux Mint, Ubuntu and Debian, install the `.deb` with APT so its sound
dependencies are installed too: `sudo apt install ./couch_<version>_amd64.deb`.
Couch needs `pulseaudio-utils` and either PulseAudio or `pipewire-pulse`; an
installed alternative satisfies the dependency without requiring both sound
servers. AppImage users must provide these packages and `libgbm1` themselves. Check
`pactl info` in the desktop user's session before playing. ALSA drivers alone
do not provide Couch's sound controls. FFmpeg is downloaded separately by
Couch when a suitable copy is not already installed.

## Develop

Couch uses React for the TV and browser remote, Core on Node for the shared queue
and SQLite storage, and Electron for the app.

```sh
bun install --frozen-lockfile
bun run app       # Build and start the Electron app on .data
bun run dev       # Browser UI and Core, with Vite hot reload
bun run typecheck
bun run build     # Frontend assets and the Core and app bundles (build/)
bun run package   # Installers with electron-builder (.artifacts/app)
```

See [usage and development](docs/usage.md) for prerequisites, ports and data
directories, and [checks and releases](docs/ci.md) for which CI workflow does
what, how to start it, and how to publish a preview or production release.

| Directory | Responsibility |
| --- | --- |
| `src/client` | TV interface and paired browser remote |
| `src/server` | Queue, catalogs, providers, and persistence |
| `src/shared` | Messages shared by client and server |
| `app` | Electron main process and window preload |
| `apps/web` | The couch.avoid.quest website |

Environment overrides use the `COUCH_` prefix, including `COUCH_PORT` and
`COUCH_DATA_DIR`. The installed app keeps its
data in the platform data directory under the `quest.avoid.couch` identity, as
the Tauri app did. Development uses `.data/`.

## Website

`apps/web` is an Astro workspace using the existing UI styles. Run
`bun run web:dev`; `bun run web:build` builds it and `bun run web:deploy`
publishes it to Cloudflare Workers at `couch.avoid.quest`. The download page
finds the newest release and preview on
[this repository's releases](https://github.com/avoid-quest/couch/releases) through
GitHub's API, with `apps/web/src/releases.json` as fallback.

- [Usage and development](docs/usage.md)
- [Checks and releases](docs/ci.md)
- [Current architecture](docs/architecture.md)
- [Design system](docs/design.md)
