# couch.avoid.quest

Your media. One TV. Everyone gets a remote.

Couch is the living-room player in the **avoid.quest** ecosystem. Run it on a
Linux mini PC connected to your TV, pair your phones and laptops, and build the
queue together. Movies, music, radio, and online video play on the same screen.

## Take a seat

- **Bring your library.** Play files from local disks or mounted NAS folders,
  browse music by artist and album, or connect Jellyfin.
- **Pick something online.** Browse YouTube, Twitch, and RaiPlay, or play supported
  website links through yt-dlp.
- **Tune in.** Add avoid radio in one click, import a radio M3U playlist, or find
  stations through Radio Browser.
- **Share the controls.** Pair a browser with the TV's six-digit code. Everyone
  can browse independently, add to the shared queue, and control playback.
  The TV stays fullscreen; phones and laptops get a compact remote with TV
  navigation, built with shadcn/ui Mira.
- **Come back later.** Save playlists, track local viewing progress by profile,
  and resume where you left off.

Couch runs the player and its server on your TV computer. Browser remotes connect
on your local network. `couch.avoid.quest` is the project identity; the commands
below run a local app and do not deploy a hosted service.

## Try it with Docker

On a development machine with Docker running and Bun installed:

```sh
bun install --frozen-lockfile
bun run preview:linux
```

The launcher opens the web remote and prints a Linux TV screen URL. Open that
screen to get the pairing code, then enter it in the remote. It also prints a LAN
address for your phone.

The preview runs the real Linux app in a container with silent audio and software
rendering. It keeps running when you close the browser. Stop it with:

```sh
bun run preview:linux stop
```

See the [preview guide](tests/preview/README.md) for media-folder mounts and network
options.

## Put it on your TV

Native playback currently requires Linux. Install Bun 1.4.x, Rust stable, and the
[Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/). On Ubuntu
24.04:

```sh
sudo apt-get install libwebkit2gtk-4.1-dev build-essential curl wget file unzip libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libmpv-dev libgl1-mesa-dev ffmpeg
bun install --frozen-lockfile
bun run setup:media
bun run desktop
```

Add a media folder, connect Jellyfin, or choose **Online** or **Radio**. Open the
LAN address shown on the TV from a phone or laptop and enter the pairing code.

The default port is `4100`. Settings, pairings, and the queue survive restarts;
playback waits for you to press Play. The [usage guide](docs/usage.md) covers
subtitles, profiles, saved playlists, playback settings, and media helpers.

## Develop

Couch uses React for the TV and browser remote, Bun for the shared queue and
SQLite storage, and Tauri with libmpv for native playback.

```sh
bun run dev       # Browser UI and server, without native playback
bun run check     # TypeScript and Bun tests
bun run build     # Frontend assets and native Bun sidecar
cargo test --manifest-path src-tauri/Cargo.toml --locked
bun run test:linux
```

| Directory | Responsibility |
| --- | --- |
| `src/client` | TV interface and paired browser remote |
| `src/server` | Queue, catalogs, providers, and persistence |
| `src/shared` | Messages shared by client and server |
| `src-tauri` | Desktop window and native playback |
| `tests/linux` | Native playback and remote integration tests |

Environment overrides use the `COUCH_` prefix, including `COUCH_PORT`,
`COUCH_DATA_DIR`, `COUCH_YT_DLP`, and `COUCH_DENO`. Desktop data lives in Tauri's
application data directory under the `quest.avoid.couch` identity. Browser-only
development uses `.data/`.

This checkout’s existing preview data was copied into `couch-preview-data`,
including the queue, pairings, profiles and catalogs. The original preview volume
is retained. Browser remotes carry an existing local pairing into the Couch name.
Fresh installations use `quest.avoid.couch` for desktop data.

## Where things stand

Couch is under active development. Local playback, shared controls, music
libraries, radio, online catalogs, subtitles, and resume support are implemented.
The Linux integration suite exercises the native app and browser remotes in
Docker. Physical TV hardware still needs qualification for HDMI audio, GPU
decoding, HDR, refresh switching, CEC, and suspend/resume.

Gapless music, ReplayGain, richer video metadata, TV guides/DVR, and multiroom
audio remain future work. Account login and DRM video are unsupported; Jellyfin
currently uses direct play.

- [Usage and development details](docs/usage.md)
- [Linux test guide](tests/linux/README.md)
- [Feature matrix](docs/research/feature-parity.md)
- [Architecture](docs/research/architecture.md)
- [Native dependency patches](src-tauri/vendor/README.md)
