# couch.avoid.quest

A media player everyone shares.

Run Couch on the computer by the TV. Everyone else joins from their phone or
laptop by scanning a QR code: no app to install, no account. Together you choose
what plays, which devices play it, and whose screen or sound to share. Couch is
free and open source, one of the projects of [avoid.quest](https://avoid.quest).

## What you can do

- **Find something to play.** Search YouTube, Twitch, RaiPlay, Bandcamp and
  SoundCloud, browse film, series and anime catalogues, listen to radio (avoid
  radio, M3U playlists, Radio Browser) and identify the song playing, watch Live
  TV playlists with a guide, or paste a link from another site yt-dlp supports.
- **Queue it together.** Each playback has its own shared Up next that anyone
  who joined can add to and reorder. Save things for later and resume where you
  left off.
- **Play it where you want.** In **Where it plays**, give the picture to the TV
  and the sound to the kitchen laptop, or to several phones at once, playing in
  step. A device lends its screen or speakers only if it allows it.
- **Share live.** Send a screen, a window, this computer's sound or an audio
  input to other devices. Shared screens and windows play on each device as soon
  as they arrive; turn on **In sync** to have them play together, a little behind.
- **Keep it running.** An admin looks after the Couch from their phone:
  pairing, sources, sound outputs and updates, including updating a TV.
  On Linux, Couch can also pair Bluetooth speakers.

Not every source plays everywhere: see
[what plays where](docs/usage.md#what-plays-where). Local files, media folders
and Jellyfin were removed.

**Live audio** is on `main` but not yet in a release: the Couch computer shares
an audio input as **Live**, and listeners join with their own volume while the
source keeps control ([Live audio](docs/live-audio.md)).

## Install

Couch is in preview: there is no stable release yet, and current releases are
previews of 0.4. Download it from
[couch.avoid.quest/download](https://couch.avoid.quest/download) or
[Releases](https://github.com/avoid-quest/couch/releases). It updates itself.
Phones and laptops that only join don't install anything.

| Computer | Download | Needs |
| --- | --- | --- |
| Mac, Apple Silicon | `.dmg` | macOS 14 or later |
| Mac, Intel | `.dmg` | macOS 13 or later; some TV channels need a compatible mpv on macOS 13–14 |
| Windows | `.exe` | Windows 11, x86_64 |
| Linux | `.AppImage` | x86_64, FUSE 2, `libgbm1`, `pulseaudio-utils` and PulseAudio or `pipewire-pulse` |
| Linux Mint, Ubuntu, Debian | `.deb` | x86_64; installs its sound dependencies through APT |

Mac system audio sharing needs macOS 14.2 or later. See the
[installation notes](docs/usage.md#install) for macOS's first-launch command and
Windows's SmartScreen prompt.

On Linux Mint, Ubuntu and Debian, install the `.deb` with APT so its sound
dependencies are installed too: `sudo apt install ./couch_<version>_amd64.deb`.
Couch needs `pulseaudio-utils` and either PulseAudio or `pipewire-pulse`; either
sound server satisfies the dependency. Check `pactl info` in the desktop user's
session before playing: ALSA drivers alone don't provide Couch's sound controls. Couch downloads FFmpeg itself when no suitable copy is installed. To
make a Debian computer a dedicated TV, see the
[download page](https://couch.avoid.quest/download).

## Develop

Couch uses React for the TV and browser remote, Core on Node for the shared
queues and SQLite storage, and Electron for the app. Use the latest stable Bun
(1.4.4 or newer) and Node 24 or newer.

```sh
bun install --frozen-lockfile
bun run app       # Build and start the Electron app on .data
bun run dev       # Browser UI and Core, with Vite hot reload
bun run typecheck
bun run test      # Tests with each file isolated from other files' mocks and globals
bun run build     # Frontend assets and the Core and app bundles (build/)
bun run package   # Installers with electron-builder (.artifacts/app)
```

| Directory | Responsibility |
| --- | --- |
| `src/client` | TV interface and paired browser remote |
| `src/server` | Core: queues, catalogs, providers and persistence |
| `src/shared` | Messages and rules shared by client and server |
| `app` | Electron main process and window preload |
| `apps/web` | The couch.avoid.quest website |
| `native` | Live relay, Mac audio capture helper and the AirPlay patch |
| `packaging` | Icons, TV setup and installer hooks |
| `scripts` | Build, app, package and release scripts |
| `tests` | Unit, browser, integration and native tests |

Environment overrides use the `COUCH_` prefix: `COUCH_PORT` (default 4100) and
`COUCH_DATA_DIR` (`.data` in a checkout; the installed app uses the platform
data directory under `quest.avoid.couch`). The installed app also uses port
4100, so give a development run its own `COUCH_PORT` while it runs.

See [usage and development](docs/usage.md) for prerequisites, ports and data
directories, and [checks and releases](docs/ci.md) for the CI workflows and how
releases are published.

## Contribute

Fork it, open an issue, or send a pull request. Read
[usage and development](docs/usage.md) to run it and
[architecture](docs/architecture.md) to find your way around; the
[product docs](docs/product/vision.md) say what Couch is for and
[voice](docs/product/voice.md) how to write about it. PR titles are plain
sentences because they become the release notes.

Couch is released under the [MIT licence](LICENSE). Couch's patch to UxPlay
(`native/airplay/`) is GPL-3.0-or-later, like UxPlay itself, and each package
comes with its dependencies' notices.

## Docs

- [Usage and development](docs/usage.md)
- [Share a live device](docs/live-inputs.md)
- [Live audio](docs/live-audio.md)
- [Identify a song on radio](docs/radio-recognition.md)
- [Checks and releases](docs/ci.md)
- [Current architecture](docs/architecture.md)
- [Design system](docs/design.md)
- [Product: vision, positioning, voice and what we can claim](docs/product/vision.md)
