# couch.avoid.quest

A media player everyone shares.

Run Couch on the computer by the TV. Everyone else joins from their phone or
laptop by scanning a QR code: no app to install, no account. Together you
choose what plays, which devices play it, and whose screen or sound to share.
Couch is free and open source, one of the projects of
[avoid.quest](https://avoid.quest). Forks and contributions are welcome.

## What you can do

- **Choose together.** Search YouTube, Twitch, RaiPlay, Bandcamp and
  SoundCloud, browse film, series and anime catalogues, play radio (avoid
  radio, M3U playlists, Radio Browser) or Live TV playlists with a guide, or
  paste a link from another site yt-dlp supports.
  Everything goes into one shared Up next; save lists for later and resume
  where you left off.
- **Play it where you want.** In **Where it plays**, give the picture to the TV
  and the sound to the kitchen laptop, or to several phones at once; their
  sound plays in sync with each other. A device lends its screen or speakers only if it allows
  it.
- **Share live.** Send a screen, a window, this computer's sound or an audio
  input to other devices. Each plays it as soon as it arrives, so they may be
  slightly apart; turn on **In sync** to have them play together, a few seconds
  behind the device that's sharing.
- **Keep it running.** An admin looks after the Couch from their phone:
  pairing, sources, sound outputs and updates, including updating a TV.

Not every source plays everywhere: see
[what plays where](docs/usage.md#what-plays-where). Local files, media folders
and Jellyfin were removed.

## Coming soon: live sound

A mixer plugged into the Couch computer, and everyone at the gig
listening on their own phone or headphones, close to live and in step. Couch
can already send a sound card's input to other devices, but you choose between fast
and in sync a few seconds behind; doing both at once is lab work today, not in
a release. Read
the [vision](docs/product/vision.md) and its
[experience specs](docs/product/specs/).

## Install

Couch is in preview. Download it from
[couch.avoid.quest/download](https://couch.avoid.quest/download) or
[Releases](https://github.com/avoid-quest/couch/releases): the `.dmg` for
Apple Silicon Macs (macOS 14+) or Intel Macs (macOS 13+), the `.exe` for
Windows 11, or the `.AppImage` or `.deb` for Linux (x86_64). It updates itself.
Phones and laptops that only join don't install anything.

On Intel macOS 13–14, some TV channels need a compatible mpv installation.
Mac system audio sharing requires macOS 14.2 or later.

See the [installation notes](docs/usage.md#install) for macOS's first-launch
command and Windows's SmartScreen prompt.

On Linux Mint, Ubuntu and Debian, install the `.deb` with APT so its sound
dependencies are installed too: `sudo apt install ./couch_<version>_amd64.deb`.
Couch needs `pulseaudio-utils` and either PulseAudio or `pipewire-pulse`; an
installed alternative satisfies the dependency without requiring both sound
servers. AppImage users must provide these packages and `libgbm1` themselves. Check
`pactl info` in the desktop user's session before playing. ALSA drivers alone
do not provide Couch's sound controls. FFmpeg is downloaded separately by
Couch when a suitable copy is not already installed. To make a Debian computer
a dedicated TV, see the [download page](https://couch.avoid.quest/download).

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

## Contribute

Fork it, open an issue, or send a pull request. Read
[usage and development](docs/usage.md) to run it and
[architecture](docs/architecture.md) to find your way around; the
[product docs](docs/product/vision.md) say what Couch is for and
[voice](docs/product/voice.md) how to write about it. PR titles are plain
sentences because they become the release notes ([checks and releases](docs/ci.md)).

Couch is released under the [MIT licence](LICENSE). Couch's patch to UxPlay
(`native/airplay/`) is GPL-3.0-or-later, like UxPlay itself, and each package
comes with its dependencies' notices.

## Docs

- [Usage and development](docs/usage.md)
- [Share a live device](docs/live-inputs.md)
- [Identify a song on radio](docs/radio-recognition.md)
- [Checks and releases](docs/ci.md)
- [Current architecture](docs/architecture.md)
- [Design system](docs/design.md)
- [Product: vision, positioning, voice and what we can claim](docs/product/vision.md)
