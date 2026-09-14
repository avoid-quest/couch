# couch.avoid.quest

Your media. One TV. Everyone gets a remote.

Couch is the living-room player in the **avoid.quest** ecosystem. Run it on a
Linux mini PC connected to your TV, pair your phones and laptops, and build the
queue together. Movies, music, radio, and online video play on the same screen.

## Take a seat

- **Bring your library.** Play files from local disks or mounted NAS folders,
  browse music by artist and album, or connect Jellyfin.
- **Pick something online.** Browse YouTube, Twitch, and RaiPlay, open Bandcamp
  albums and tracks, or play supported website links through yt-dlp. Automatic
  quality defaults to up to 1080p; choose Unrestricted quality to request the
  highest available format. Existing explicit browser choices are retained.
- **Tune in.** Add avoid radio in one click, import a radio M3U playlist, or find
  stations through Radio Browser.
- **Share the controls.** Pair a browser with the TV's six-digit code. Everyone
  can browse independently, add to the shared queue, and control playback.
  The TV stays fullscreen; phones and laptops get a compact remote with TV
  navigation, built with shadcn/ui Mira. Claim the first administrator from your
  phone with the separate TV setup code, then name the TV in Settings.
- **Come back later.** Save playlists, track local viewing progress by profile,
  and resume where you left off.

Couch runs the player and its server on your TV computer. Browser remotes connect
on your local network. `couch.avoid.quest` is the project identity; the commands
below run a local app and do not deploy a hosted service.

On Mac or Windows, [connect as a browser controller](docs/desktop-controllers.md)
or save the TV's address as a Dock or taskbar app. The Ubuntu TV plays the media.

## Try it with Docker

On a development machine with Docker running and Bun installed:

```sh
bun install --frozen-lockfile
bun run preview:linux
```

The launcher opens the web remote and prints a Linux TV screen URL. Open that
screen to get the pairing code, then name and pair your remote. It also prints a
LAN address for your phone. An unclaimed TV opens Settings with a QR address and
separate administrator code. See [setup and recovery](docs/usage.md#administrator-and-connection-settings).

The preview runs the real Linux app in a container with silent audio and software
rendering. It keeps running when you close the browser. Stop it with:

```sh
bun run preview:linux stop
```

See the [preview guide](tests/preview/README.md) for media-folder mounts and network
options.

## Put it on your TV

The supported appliance is Ubuntu 24.04 Server on x86_64 hardware. An SSH
administrator installs an authenticated `Couch.AppImage` and `couch-appliance`
Debian package with the [installer](docs/install-couch.md). Obtain the release,
manifest and public-key fingerprint from the trusted publisher. Current private
delivery uses the signed LAN feed; the publishing Mac must be reachable for
checks and downloads. The TV only installs and runs Couch.

The [release guide](docs/tauri-releases.md) covers the temporary Mac build and
publication path while GitHub Actions is paused. For source development, use the
[Linux development instructions](docs/usage.md#run-from-source-for-development)
or Docker preview above.

On a fresh TV, scan the QR or use the address and six-digit controller code
on **Claim and name**. On a configured TV, **Pair a remote** shows its address
and code; **Settings > Connections** on the TV or an administrator remote has
the pairing QR. Use **Search** to find a title or paste a supported link;
**Library** opens the provider catalogs, Radio, Live TV, Jellyfin and TV folders.
An administrator manages folders and Jellyfin in **Settings > Sources**.

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

## Develop

Couch uses React for the TV and browser remote, Bun for the shared queue and
SQLite storage, and Tauri with libmpv for native playback.

```sh
bun run dev       # Browser UI and server, without native playback
bun run typecheck # TypeScript; see docs/ci.md for isolated test commands
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

## Where things stand

The [14 September 2026 status record](docs/qualification/current-status-2026-09-14.md)
compares remote main with installed application build `34172088349.1` and Ubuntu
companion `34172088347.1`. It separates source, package and physical evidence.

Implemented software includes signed installation and updates, shared search and
history, controller administration, phone source setup, profiles, local/NAS and
Jellyfin playback, subtitles, CUE albums, ReplayGain, measured lossless music
continuity, NFO metadata and corrections, collections, IPTV guides, scheduling
and completed recordings. Provider and format limits still apply. Software
captures do not qualify every physical display, speaker or media source.

Remaining acceptance belongs to [YouTube rendering #150](https://github.com/avoid-quest/couch/issues/150),
[display #13](https://github.com/avoid-quest/couch/issues/13),
[sound #14](https://github.com/avoid-quest/couch/issues/14),
[interface size #12](https://github.com/avoid-quest/couch/issues/12),
[real TV folders #17](https://github.com/avoid-quest/couch/issues/17) and
[first-run setup #23](https://github.com/avoid-quest/couch/issues/23).
The status record also links the open lid, guest discovery, pairing and diagnostics
work. These fixes are not part of the verified installed baseline.

Growing timeshift is [deferred #67](https://github.com/avoid-quest/couch/issues/67).
CEC was closed as not planned. Native Mac/Windows playback, a full Rust port,
DRM/account-login video, Jellyfin transcoding, crossfade and multiroom are not
delivered. Live TMDB matching needs authorized access; HDR and refresh switching
have no completed hardware qualification. The
[appliance map](https://github.com/avoid-quest/couch/issues/1) and
[media map](https://github.com/avoid-quest/couch/issues/25) retain the broader scope.

- [Usage and development details](docs/usage.md)
- [Linux test guide](tests/linux/README.md)
- [Feature matrix](docs/research/feature-parity.md)
- [Architecture](docs/research/architecture.md)
- [Native dependency patches](src-tauri/vendor/README.md)
