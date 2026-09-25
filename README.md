# couch.avoid.quest

Your files, streams and radio on one screen. Every phone is a remote.

Couch is a shared media player for the living room, part of **avoid.quest**.
Run it on the computer connected to your TV, or on your own Mac or PC. Pair
phones and laptops as remotes and build one queue together: local and NAS
files, Jellyfin, online video, music and radio all play on the same screen.

## Take a seat

- **Bring your library.** Play files from local disks or mounted NAS folders,
  browse music by artist and album, or connect Jellyfin.
- **Pick something online.** Browse YouTube, Twitch, RaiPlay or
  StreamingCommunity, open Bandcamp albums and tracks, or play supported website
  links through yt-dlp. Automatic
  quality defaults to up to 1080p; choose Unrestricted quality to request the
  highest available format. Existing explicit browser choices are retained.
- **Tune in.** Add avoid radio in one click, import a radio M3U playlist, or find
  stations through Radio Browser.
- **Share the controls.** Scan the TV's pairing QR or enter its six-digit code.
  Everyone can browse independently, add to the shared queue, and control
  playback. The TV stays fullscreen; phones and laptops get a compact remote
  with TV navigation, built with shadcn/ui Mira. The first remote claims
  Administrator access with the separate setup code.
- **Come back later.** Save playlists, track local viewing progress, and resume
  where you left off.

Couch runs the player and its server on your TV computer. Browser remotes connect
on your local network. `couch.avoid.quest` is the project identity; the commands
below run a local app and do not deploy a hosted service.

On Mac or Windows, [connect as a browser controller](docs/desktop-controllers.md)
or save the TV's address as a Dock or taskbar app. The native Mac app can run
from source with local playback or connect to another Couch. The Debian TV
remains the published playback package.

## Try it with Docker

On a development machine with Docker running and Bun installed:

```sh
bun install --frozen-lockfile
bun run preview:linux
```

The launcher opens the web remote and prints a Linux TV screen URL. On a fresh
TV, choose **This computer**, allow remote control, then open **Settings >
Connections** for the pairing QR and separate administrator code. Name and pair
your remote, then claim administration on that remote. The launcher also prints
a LAN address for your phone. See [setup and recovery](docs/usage.md#administrator-and-connection-settings).

The preview runs the real Linux app in a container with silent audio and software
rendering. It keeps running when you close the browser. Stop it with:

```sh
bun run preview:linux stop
```

See the [preview guide](tests/preview/README.md) for media-folder mounts and network
options.

## Put it on your TV

Download the native Debian package from [couch.avoid.quest/download](https://couch.avoid.quest/download).
Couch supports Debian 13 on amd64 hardware with an X11 session. Install the
package with APT, then open Couch from your applications menu. Dependencies and
license notices are included in the installation path.

For a dedicated TV, run `sudo couch-setup --tv` after installing the package.
This explicitly enables the dedicated account and TV login/power configuration.
See [TV setup](docs/native-tv.md).

The local host and paired Administrators can install signed native updates;
ordinary Controllers cannot. Manual updates are the default; optional automatic
updates wait for ten continuous idle minutes. A
restricted system service verifies the package before APT installs it. It does
not give the Couch account general package-manager privileges.

CrabNebula hosts downloads independently of the build machine. GitHub Actions
builds and qualifies releases in the pinned Debian container. The T480 only
installs and runs Couch. See [hosted releases](docs/hosted-releases.md).

On first launch, choose **This computer** for local playback. Enable remote
control, then open **Settings > Connections** to pair a phone using the QR or
six-digit code. Existing installations retain their operating mode and pairings.
An Administrator manages
folders and Jellyfin in **Settings > Sources**.

The coordinator's default port is `4100`; a configured named address can use
port 80. Use the address shown by your TV consistently. Settings, pairings and
the queue survive restarts; playback waits for you to press Play. Follow the
[basic phone journey](docs/usage.md#connect-a-phone-and-find-media) for setup,
search, playing now and adding next.

## Marketing site

`apps/web` is a static Astro workspace using the existing UI styles.
Run `bun install` from the repository root, then `bun run web:dev`.
`bun run web:build` builds the site; `bun run web:deploy` publishes it to
Cloudflare Workers at `couch.avoid.quest` with Wrangler authenticated.
The download page reads per-platform Stable and Preview feeds at runtime.
`apps/web/src/releases.json` holds the last publicly verified release as a
fallback. The hosted publication check in `scripts/hosted-site.ts` updates
that file for each verified format before a reviewed site deployment.

## Develop

Couch uses React for the TV and browser remote, Bun for the shared queue and
SQLite storage, and Tauri with libmpv for native playback.

```sh
bun run desktop   # Native development app, Vite hot reload and owned Bun server
bun run dev       # Browser UI and server, without native playback
bun run typecheck # TypeScript; see docs/ci.md for isolated test commands
bun run build     # Frontend assets and native Bun sidecar
cargo test --manifest-path src-tauri/Cargo.toml --locked
bun run test:linux
```

Start here for the [native Mac development workflow](docs/usage.md#native-mac-development),
including prerequisites, stop/restart, logs and checks.

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

## Where things stand

The [public download page](https://couch.avoid.quest/download) currently offers
a Debian 13 amd64 `.deb` for desktop or dedicated TV use. Merged source changes
are not automatically in that download. The [release guide](docs/hosted-releases.md)
records qualification and publication; earlier dated qualification records
describe their tested builds.

The [accepted desktop plan](https://github.com/avoid-quest/couch/issues/457#issuecomment-5782578695)
targets one switchable local/remote app per OS, with broad Linux AppImage,
macOS DMG and Windows NSIS delivery. Those installers and Desktop Full parity
still need implementation and downloaded-artifact qualification. A limited
Client-only release may come first, but it does not establish local playback.
See the [accepted installation gates](https://github.com/avoid-quest/couch/issues/447#issuecomment-5781937883).

Implemented software includes shared search and history, controller
administration, phone source setup, watching progress, local/NAS and Jellyfin playback,
subtitles, CUE albums, ReplayGain, NFO metadata, collections and IPTV guides.
Provider and format limits still apply.
Software captures do not qualify every physical display, speaker or media source.

Growing timeshift is [deferred #67](https://github.com/avoid-quest/couch/issues/67).
CEC was closed as not planned. Installed Mac playback, native Windows playback,
a full Rust port, DRM/account-login video, Jellyfin transcoding, crossfade and
multiroom are not delivered. Live TMDB matching needs authorized access; HDR
and refresh switching have no completed hardware qualification. The
[appliance map](https://github.com/avoid-quest/couch/issues/1) and
[media map](https://github.com/avoid-quest/couch/issues/25) retain the broader scope.

- [Usage and development details](docs/usage.md)
- [Linux test guide](tests/linux/README.md)
- [Feature matrix](docs/research/feature-parity.md)
- [Architecture](docs/research/architecture.md)
- [Native dependency patches](src-tauri/vendor/README.md)
