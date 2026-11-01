# couch.avoid.quest

A media player everyone shares.

Run Couch on the computer by the TV. Everyone else joins from their phone or
laptop by scanning a QR code: no app to install, no account. Together you choose
what plays, which devices play it, and whose screen or sound to share. Couch is
free and open source, one of the projects of [avoid.quest](https://avoid.quest).

## What people use it for

- **Movie night**: find a film or series, play it on the TV, steer it from your
  phone, and pick up next time where you stopped.
- **A party queue**: everyone adds songs and videos from their own phone.
- **Music through the house**: the kitchen and living room in step, then into
  the shower on your phone.
- **A late film**: picture on the TV, sound in your headphones.
- **Game night**: your screen and its sound on the TV and on friends' laptops.
- **A gig in everyone's ears**: the sound desk's mix on the audience's phones,
  close to live.

Each of these is a [story](docs/stories/README.md) with its journey and what
works today. Sources: YouTube, Twitch, RaiPlay, Bandcamp, SoundCloud, film and
series catalogues, radio, Live TV playlists, and links from other sites yt-dlp
supports ([what plays where](docs/usage.md#what-plays-where)).

## Install

Couch is in preview; there's no stable release yet. Download it from
[couch.avoid.quest/download](https://couch.avoid.quest/download) or
[Releases](https://github.com/avoid-quest/couch/releases). It updates itself.
Phones and laptops that only join don't install anything.

| Computer | Download | Needs |
| --- | --- | --- |
| Mac, Apple Silicon | `.dmg` | macOS 14 or later |
| Mac, Intel | `.dmg` | macOS 13 or later |
| Windows | `.exe` | Windows 11, x86_64 |
| Linux | `.AppImage` | x86_64, FUSE 2, `libgbm1`, `pulseaudio-utils` and PulseAudio or `pipewire-pulse` |
| Linux Mint, Ubuntu, Debian | `.deb` | x86_64; `sudo apt install ./couch_<version>_amd64.deb` installs its sound dependencies |

See the [installation notes](docs/usage.md#install) for macOS's first launch,
Windows's SmartScreen prompt and Linux sound, and the
[download page](https://couch.avoid.quest/download) to make a computer a
dedicated TV.

## Develop

Use the latest stable Bun (1.4.4+) and Node 24+.

```sh
bun install --frozen-lockfile
bun run app       # build and start the app, with its data in .data
bun run dev       # browser UI and Core with hot reload
bun run check     # what to run before a PR
```

The installed Couch also uses port 4100: give a development run its own
`COUCH_PORT` and `COUCH_DATA_DIR`. [AGENTS.md](AGENTS.md) is the short guide to
working here; [architecture](docs/architecture.md) and
[checks and releases](docs/ci.md) go further.

## Contribute

Fork it, open an issue, or send a pull request. A new feature starts from its
[story](docs/stories/README.md). PR titles are plain sentences: they become the
release notes.

Couch is released under the [MIT licence](LICENSE). Its patch to UxPlay
(`native/airplay/`) is GPL-3.0-or-later, like UxPlay itself, and each package
comes with its dependencies' notices.
