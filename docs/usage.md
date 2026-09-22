# Couch usage and development

A Linux TV player controlled by everyone on the local network. Tauri embeds
libmpv; Bun owns the shared queue, catalogs and paired browser remotes.

![Playback settings over native video in the Linux app](screenshots/linux-playback.png)

The screenshot shows shadcn playback settings over a generated test video in the
fullscreen Tauri app on Ubuntu 24.04 under Xvfb with basic rendering.

## Connect a phone and find media

For a real TV, install the native Debian package from
[couch.avoid.quest/download](https://couch.avoid.quest/download) and run
`sudo couch-setup --tv`. Phones need only a browser.

1. Join the TV's local network. A fresh unclaimed TV shows its address, pairing
   QR and controller code on **Claim and name**. Scan that QR or type the address
   into your phone browser, including any port. On a configured TV, open
   **Pair a remote** for its address/code or **Settings > Connections** for the
   QR. Setup hides the normal Settings navigation until it finishes.
   The project website `couch.avoid.quest` is not your TV's address. The verified
   appliance uses `http://couch.avoid.local`; use the address your TV advertises.
2. Name the browser and enter the six-digit controller code, or use the code
   filled by the QR. Submit the pairing form to connect. On a fresh TV, continue
   through **Claim and name** with the separate administrator code shown on the
   TV, then finish the remaining setup steps before opening Search. An existing
   administrator remote can also show a pairing QR in **Settings > Connections**.
3. Open **Search** in the main navigation. Enter a title, artist, station or
   supported media link, then select **Search**. **All** groups results by source;
   select **YouTube**, **Radio**, **TV folders** or another source to narrow them.
   Bandcamp accepts an album or track link, not free-text catalog search.
4. Choose **Play** or **Play on TV** to start an item now. **Up next**, **Queue**
   and **Add to queue** append it without starting it. Local results open details
   with Play or Resume. A playlist can first open its tracks. Playback happens on
   the TV; your phone has no video player.
5. Return to **Home** for the current session and **Remote** controls. Confirm
   picture and sound on the TV, then pause. **Up next** shows the shared queue;
   **Saved** holds saved media. **Library** opens YouTube and other provider tabs,
   with Radio, Live TV, Jellyfin and TV folders as additional destinations.

If Search reports no configured folders or a disconnected Jellyfin server, ask
an administrator to open **Settings > Sources > TV folders** or **Jellyfin**.
Try a configured source or another provider. If disconnected, use **Settings > Connections >
Reconnect** and wait for both server and player availability before playing.
Reopen the same origin and browser profile to reuse your pairing.

The [dated check record](qualification/current-status-2026-09-14.md#browser-journey)
records which steps were followed on the installed app. A fresh physical phone
pairing, QR scan and picture/sound trial remain pending. Home discovery and the
Pair a remote QR are separate open work in [#248](https://github.com/avoid-quest/couch/issues/248)
and [#249](https://github.com/avoid-quest/couch/issues/249).

## Try it on this Mac

Start Docker, then run:

```sh
bun install --frozen-lockfile
bun run preview:linux
```

The command opens the real [web remote](http://127.0.0.1:4100), served by Bun
over HTTP. Its WebSocket connection keeps the queue, playback controls and saved
items current across devices. Open the separately printed
[Linux TV screen](http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=scale)
to read the pairing code and see video playback.

The Linux TV screen uses noVNC only to display the Docker development desktop.
On a Linux mini PC, Tauri displays the app and embedded video directly. Phones
and laptops use the web remote in both setups. The Docker preview has silent
audio and software video rendering.

Select **Library** to browse YouTube, Twitch, RaiPlay, StreamingCommunity or Bandcamp, then **Play on TV**.
The launcher also prints a LAN URL for your phone. It keeps running after you
close the browser; `bun run preview:linux stop` stops it. Restart after source
changes to rebuild. See [preview options](../tests/preview/README.md) for mounting
your media folder and limiting access to this computer.

## Run from source for development

Build on a development machine. The installed T480 only runs released packages.

Install Bun 1.4.x, Rust stable and the [official Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux).
On Ubuntu 24.04 the build dependencies are:

```sh
sudo apt-get install libwebkit2gtk-4.1-dev build-essential curl wget file unzip libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libmpv-dev libgl1-mesa-dev ffmpeg
bun install --frozen-lockfile
bun run setup:media
bun run desktop
```

The project pins Bun 1.4.2 and Tauri 2.x packages in its lockfiles. Project
scripts use the pinned Bun runtime and do not need Node.js. The desktop command
builds the UI and compiled Bun sidecar before starting Tauri. Frontend changes
currently require restarting that command; Rust changes use Tauri's watcher.

Use **Up next > Open file** on the TV, browse **Library > Radio**, or add a
local/mounted NAS folder or Jellyfin connection through **Settings > Sources**
on an administrator remote. Direct HTTP/HTTPS media URLs also work.
Press play in the shared queue. Open the LAN address shown in the app on another device
and enter its six-digit pairing code. Give the remote a name so Settings can
identify this browser. Every remote controls this one player.
The TV always fills its display. Home opens browsing over the mounted player;
Back closes the current menu, browsing view or playback controls. Phones and
laptops have a dedicated controller interface with no video surface.
See [Mac and Windows controllers](desktop-controllers.md) for pairing, Dock or
taskbar shortcuts, and reconnection. Controllers need only a browser.

In Settings > Sources > Radio, an administrator can use **Add avoid radio** to import
the station index from
[`radio.avoid.quest/playlist.m3u`](https://radio.avoid.quest/playlist.m3u).
The same page accepts another supported extended M3U radio URL and shows import
errors. Radio's **Manage radio sources** button opens this page. Playlists retain their
station order, IDs, groups and logos. Refresh updates the shared catalog and
saved favorites; queued stations resolve their current URL when played.
A failed refresh keeps the last usable list. Only administrators manage sources
and see feed URLs. Every paired remote can browse, search, favorite, queue or
immediately play stations. Removing a source removes its imported catalog and
keeps all favorites. Queued stations may become unavailable unless saved as
favorites; no media files are deleted.

The TV and remotes show a station's current track when the stream supplies ICY
or audio tags. The station name stays unchanged. Radio retries failed or ended
connections after 1, 2 and 4 seconds, then offers **Try again**. Stop, a newer
playback request and closing the TV cancel pending retries. Restart restores the
queue without reconnecting or playing automatically. Live rewind needs a buffer
and is not available.

**Library** provides YouTube search, channel sections and playlists; Twitch live
channels, categories and search; RaiPlay live TV, programs, episodes, search
and recent replays; StreamingCommunity catalogue browsing, search, seasons,
episodes and recent plays; and public Bandcamp albums and tracks. Save media, channels
and collections for every paired remote. Browsing remains local to each screen; queue changes and saved items
are shared. **Play** adds the selected item and starts it on the TV.

For other website links, use **Search**, or select **Up next > Add media >
Webpage**. A blank title requests the video's title and artwork automatically.
The default is **1080p (recommended)**. Choose **Unrestricted quality**,
**Up to 1080p**, **Up to 720p** or **Up to 480p** for an override. The queue
remembers the choice. The app resolves
the link when playback starts and sends the original streams to libmpv, including
separate video/audio when supplied. It does not download a media file or encode
video. Public single items are supported through yt-dlp's extractors; account
login, arbitrary webpage playlist expansion and DRM remain unsupported.

`bun run setup:media` installs pinned official yt-dlp and Deno releases into the
desktop's private data directory after checking their SHA-256 hashes and
versions. It needs `unzip`, with no Python environment to configure. The desktop
finds these helpers automatically; `COUCH_YT_DLP` and `COUCH_DENO`
can override their paths. YouTube needs Deno/EJS:
yt-dlp currently rejects Bun versions newer than 1.3.14 for that helper role.
The application itself stays on Bun 1.4.2. See the
[official yt-dlp releases](https://github.com/yt-dlp/yt-dlp#release-files) and
[EJS requirements](https://github.com/yt-dlp/yt-dlp/wiki/EJS).

The default port is **4100**. Paired devices, the queue and chosen volume survive
restarts, as do library catalogs, radio playlists/favorites, online saved items
and the Jellyfin connection.
Playback does not start automatically after a restart. Press Play or Resume to
continue from the saved position, or choose Play from start to restart an item.
Local progress belongs to the selected watching profile, initially Household.
Use the profile button beside Playback settings to create, select, rename or
remove a watching profile from the TV or a paired remote. Renaming keeps the
profile's saved preferences, resume points, watched marks and local history.
Removal asks you to confirm that those local records will be deleted; other
viewers keep theirs. The shared default can be renamed but cannot be removed,
and becomes selected when you remove the current viewer. Stop playback before
switching or removing profiles; pausing keeps that guard. Renaming is available
during playback. Paired phones and laptops remain controllers. These operations
leave Jellyfin's connected account and history, and administrator access unchanged.

For browser development without a native player:

```sh
bun run dev
```

Bun serves the UI with hot reload and prints the pairing code in the terminal.
Queue and pairing work; playback is explicitly unavailable. Run either this
server or the desktop app on port 4100. `COUCH_PORT` can select another
port, but keep it stable so remotes retain their address.

macOS can build and run the desktop UI/server, but this first native playback
implementation is Linux-only. To produce a local macOS debug app:

```sh
bun run desktop:build --debug --bundles app
```

## Administrator and connection settings

**Settings > Playback > Video quality** saves the default online-video quality
in this browser. Search, Library and Add media use it for new videos; an override
applies to one enqueue.
Existing queued videos keep their quality, and each remote keeps its own
default. This preference does not change the TV's display resolution.

An unclaimed TV opens setup at **Claim and name**, with its local address, a
controller-pairing QR code, the six-digit controller pairing code and a separate ten-digit
administrator code. Pair your phone first, then enter that administrator code
on the phone's **Claim and name** setup step. For administrator recovery on an
already configured TV, use **Settings > TV**. The code expires after ten minutes
and works once.
If it expires before use, select **Get new code** on the TV. Competing first
claims grant administration to one remote; existing paired devices remain ordinary
controllers.

The administrator phone can save the **TV name** in TV settings. The committed name
appears on the TV and other remotes, and survives restart. TV settings show the name
read-only on the TV and ordinary remotes. Administrator status belongs to the
paired browser credential. It does not change the watching profile, local history
or connected Jellyfin account.

During first-run setup, use the QR on **Claim and name**; Connections is absent
from the setup navigation. On a configured TV, **Connections** is available
before pairing and while disconnected. It shows the known TV name, address and
LAN links. When authenticated, it also shows this
remote's name and role; the host and administrators can see the pairing QR. Server and player availability are separate: a
reachable server can still have an unavailable player. Rejected or revoked
credentials return to pairing without repeatedly trying the same credential.

**Reconnect** retains this browser's credential and retries the same TV, including
its known LAN addresses if its hostname cannot be reached. Controls wait for a
current snapshot. The server accepts requests only from its allowed local
addresses and advertised origins; this does not enable Internet administration.
**Pair again** forgets only this browser's current credential and returns to
pairing. It does not revoke that credential on the server or change other remotes.

Administrators can rename paired remotes, approve another administrator, remove
administration, and revoke access in **Connections > Paired remotes**. Revocation
closes the device's existing sockets, rejects later requests and cancels admitted
mutations still waiting on a media lookup. Names and roles update on connected
views. Controller pairing always grants browsing and playback only. Ordinary
controllers can inspect their own connection and pair again, but cannot manage
other devices. Existing pairings retain their exact token hashes across migration
and restart, with stable IDs and names such as Remote 1.

The server rejects removing or demoting the last administrator. A connected sole
administrator must approve another administrator before using **Pair again**.
This browser safeguard cannot prevent lost browser storage or a lost device;
use recovery below if no administrator remains accessible. Rejected credentials
and disconnected browsers can still return to pairing.

Administrator phones can manage TV folders and Jellyfin in **Settings > Sources**.
For folders, choose **TV folders > Add TV folder**, browse a permitted location,
add it and choose **Start scan**. The folder must already be accessible on the TV;
entering a phone or laptop path does not transfer its files. Couch does not mount
NAS shares. Ordinary controllers can browse configured media, but cannot change
sources. Protected TV-local setup still requires local input when operated on
the TV; a remote's directional pad does not grant administration.
The software exists, while [#17](https://github.com/avoid-quest/couch/issues/17)
retains the real-folder scan/play/recovery acceptance.

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

Pair the replacement browser, open **Settings > TV**, and enter that secret
in **Administrator code**. Its ten-minute deadline starts when the server first
accepts the configured secret. Restarting with the same value neither extends
that deadline nor makes a consumed secret reusable. An expired or consumed secret
requires a fresh value and another local restart. Recovery grants administration
to the replacement browser; it does not revoke the old administrator.

For an installed appliance, run `sudo couch-session recover-admin` in a private
administrator terminal on the TV computer or over SSH. It generates a fresh code
and restarts the existing supervised TV application. Pair the replacement browser
and enter the printed code as described above. Keep the command output out of
logs and issue comments. See [Ubuntu TV session](appliance-session.md) for the
installed session's operation and recovery details.

Bun removes the recovery variable from its environment before starting media
helpers. The server stores a hash, and never sends the secret in a snapshot or
QR code. Recovery expiry, consumption and restart behavior are covered by the
server tests. The native/HTTP gate tests first-time phone claiming and persistence.

## Music and saved playlists

Add a music folder through Settings > Sources, then open **Library > TV folders**
and its **Artists** or **Albums** tab from any controller. Album artists keep compilations together. Tracks appear in
numeric disc/track order; **Play album on TV** appends the album and starts its
first track. **Add album to queue** leaves current playback running. Browsing
stays local to each screen.

Audio tags and embedded JPEG/PNG/WebP artwork use the maintained
`music-metadata` parser. Rescan existing folders to populate the new fields.
Metadata parsing is limited to files up to 512 MiB; covers are skipped above
64 MiB and limited to 2 MiB each. Larger or unreadable files remain playable
with a scan notice. Scans run at most two parser jobs and await them on shutdown;
a stalled mounted filesystem can delay shutdown because the parser has no
cancellation API. Video metadata still uses ffprobe.

Open **Saved playlists** in **Up next** to save, rename, reorder or remove items,
update a saved list from the queue, or delete it. **Add to queue** appends;
**Replace queue** stops playback and loads the list; **Play playlist** replaces
the queue and starts the first item. Saved playlists belong to everyone paired
with this TV. They preserve duplicate songs as separate entries and reject edits
from an obsolete revision. Up to 100 playlists with 500 entries each persist
across restart, without autoplay. Host paths and resolved provider streams do
not appear in playlist HTTP responses.

Consecutive ordinary local and Jellyfin audio tracks prepare the next source
inside the same native player. Queue edits and Stop cancel obsolete preparation.
The measured 44,100 Hz FLAC software captures had no inserted boundary silence
for local, mounted-folder and Jellyfin sources. Slow opens can still leave a gap;
other formats and physical speaker output need separate qualification. The
[continuity record](qualification/audio-continuity.md) preserves sample-loss
bounds, uncertainty and the tested controls. Crossfade remains outside this work.

### Bandcamp albums and tracks

In **Library > Bandcamp**, open a public album or track link, or choose a suggested
album. Albums show artwork and their returned track order. **Add album to queue**
appends all tracks; **Play album** appends them and starts the first. Individual
tracks have Play, Queue and Save controls. Shared saved albums and tracks are
available from every paired device.

The host uses the existing yt-dlp worker, with a 30-second album deadline and a
500-track limit. It resolves each public track page afresh when played. An album
that exceeds the queue's remaining capacity leaves the queue unchanged. A newer
Stop or playback request cancels an earlier album's pending play request.

This supports public artist-subdomain `bandcamp.com/album/…` and `/track/…`
links. Account libraries, full-text search, artist discographies and custom
domains are not implemented. The displayed album contains the tracks returned
by yt-dlp; its extractor omits entries without duration, and later tracks can
still fail when playback checks their current availability.

### StreamingCommunity

**Find > StreamingCommunity** browses the catalogue of the website source that
an administrator configures in **Settings > Sources**. The catalogue, a search
or a pasted title link loads sixty titles at a time. Films play directly; series
open into seasons and then episodes. A title's details show plot, year, quality,
runtime and genres without leaving the page. Episodes, films and seasons have
Play and Queue controls, and **Save as playlist** stores a film, a season or a
whole series in Saved playlists. Titles that match a search also appear in the
regular Find results.

The site publishes no API, so Couch reads the pages a browser would load and
updates ship when the site changes its layout. If the site moves domains, an
administrator updates the origin in **Settings > Sources**; saved playlists keep
the links they were saved with.

## Resume, watched state and history

TV folder cards show saved positions and watched marks, with Resume, Play from
start, watched controls and Clear resume point. **Home > Recently played** shows
shared playback history; provider catalogs also show their recent items.
Each watching profile has its own records. Individually opened files retain separate progress records from scanned library entries;
open the file on the TV again if it is no longer in the queue. Local progress is
separate from shared playback history, which also records provider playback and
the initiating controller.

Bun checkpoints native observations every ten seconds and on observed pause or
seek, then flushes on stop, source changes, errors and shutdown. End of file marks
the item watched and clears its resume point. Stopping at or beyond 90% does the
same for items at least one minute long. Rewinding saves the lower position;
watched marks remain independent and can be changed manually. An abrupt power
loss can lose the interval since the last checkpoint. Normal restart restores
profiles, progress and queue without autoplay.

Jellyfin has All media and Continue watching views. Resume reads the latest
upstream position before loading and passes it to native playback. One host
reports progress, and an immediate replay waits for the preceding stop report.
The connected Jellyfin account is shown in its panel; local profile selection
does not change that account.

## TV and remote interface

Settings, Playback shows the active watching profile and its saved language,
subtitle mode and speed defaults. The language lists use names and retain
existing saved values. Paired remotes share these defaults while keeping their
own browsing location. Beside playback, Playback settings contains the current
item's tracks, chapters, speed and subtitle timing. Choose
**Add subtitle file** on the TV or a paired phone to send an SRT, ASS, SSA or
WebVTT file from that device. Files are limited to 2 MiB, kept privately on the
host and removed after native playback acknowledges another source or Stop.
The subtitle selector shows libmpv's observed selection. Uploads apply to the
current playback only; reopening the item requires adding the file again.

Jellyfin text sidecars load through its authenticated subtitle API. Bun downloads
up to four at once, with an eight-second total deadline and a 2 MiB per-file
limit, before giving private files to libmpv. Stop cancels those downloads.
Unavailable subtitles leave the movie playable and show a subtitle error.
External image sidecars and subtitle search/download services remain unsupported.

The watching profile owns preferred audio/subtitle languages, default subtitle
mode and speed. Saved defaults apply when the next item starts, including when
the current item is still resolving. Current speed and track choices stay with
the item. Save as default explicitly records the observed speed or selected
track's language for the active profile. A subtitle file itself cannot become a
default. The TV device owns volume and audio
delay, shared by every profile. Subtitle delay and individual track choices apply
only to the current item. Every load resets them before applying profile defaults;
restarting restores preferences and the queue without autoplay.

The TV and HTTP remote use generated shadcn/ui Mira components, the neutral dark
theme and bundled Inter font from preset `b1D0dv72`. Phone controls have 44px
minimum touch targets; TV controls are larger. Arrow keys move between controls;
tabs, sliders and selects keep their keyboard behavior. Escape closes the topmost
menu or dialog and restores focus. The TV stays fullscreen throughout browsing,
playback and Stop, with one continuously mounted VideoStage.

Phones and desktop browsers use the same Home, Search, Library, Saved, Up next
and Settings navigation. **Home > Remote** opens transport, volume and the TV
directional pad. Home, Back, Info, arrows and OK operate the TV
through authenticated, ephemeral commands. These commands are never replayed
after reconnect. Each browser retains its own catalog navigation.

The exact preset was applied with `bunx --bun shadcn@latest apply --preset b1D0dv72`
in a temporary supported Vite scaffold, because the CLI does not recognize this
Bun-only project. Generated configuration, theme and components were integrated
with the app's accessible slider labels and native portal layers. Couch uses Bun's
build pipeline and sole HTTP/WebSocket server. `bun-plugin-tailwind` runs for
development HTML, static Tauri assets and the compiled server's HTML; `bunfig.toml`
and both `Bun.build` calls configure it. No Vite server ships with the app.
See the [shadcn CLI](https://ui.shadcn.com/docs/cli) and
[Bun Tailwind integration](https://bun.com/docs/bundler/fullstack).

## Check and build

```sh
bun run typecheck
bun test --parallel=4 ./tests/linux/iptv-clock.test.ts
bun test --parallel=4 --path-ignore-patterns 'tests/linux/iptv-clock.test.ts'
bun run build
cargo test --manifest-path src-tauri/Cargo.toml --locked
bun run test:linux
bun run test:linux --provider-catalogs
bun run test:linux --iptv-public-sample
```

`bun run build` creates static UI assets in `dist/` and a native-target Bun
executable in `src-tauri/binaries/`. Build on the target OS and architecture;
cross-compiling the Rust media dependencies is not configured.

The supported installation is the native Debian package; follow the
[release guide](hosted-releases.md) and [TV setup](native-tv.md). Keep validation
local using [the check guide](ci.md).

### Historical test evidence

The following runs describe their original sources and environments. They are
not a current-main test run or qualification of the installed TV. Preserve their
failures and limits when reusing them. See the [current status record](qualification/current-status-2026-09-14.md)
for the separately verified source and package identities.

The original README also recorded a migration of its development preview data
into `couch-preview-data`, retaining the old volume, queue, pairings, profiles and
catalogs. That describes the original operator checkout, not a new installation.

`bun run test:linux` uses Docker and the official Tauri WebDriver. It builds the
actual Linux app, generates local media and controls its native window plus one
paired controller. The smoke records compiled Tauri/libmpv startup, controller
Play, native video pixels, one queue restart check, and the exact running
revision. Cargo and package caches use named volumes; the repository is mounted
read-only. Logs, screenshots and the receipt go to `.artifacts/linux/`. The
container is removed after the run.

Feature behaviour remains in the ordinary focused suites and the documented
optional native checks. Debian package/update qualification remains independent.
The smoke does not qualify physical display, audio, Wi-Fi, external media, or
installed-package behaviour.

The 2026-09-05 administrator/Settings integration run passed 450 native/HTTP
checks with Jellyfin and live radio. Linux also passed 295 Bun tests with two
skipped and 2,295 assertions, twelve app Rust/ABI tests and five libmpv
DASH/resume/subtitle/radio regressions. Local checks passed 291 Bun tests with six
skipped and 2,260 assertions; the local build and eight macOS Rust tests passed.
The separate provider gate passed all eleven cases and restart persistence with
the same production binaries.

The HTTP phone checks use a 390px viewport; native screenshots verify video and
dialog/select composition. The first administrator claim, TV-name save and
restart ran through the real app with disposable data. API and store tests cover
claim races, expiry, recovery, unchanged legacy pairing hashes and authorization
rechecks before mutation. Native tests verify that paired D-pad input cannot
activate pre-opened local folder or Jellyfin controls. A separate DOM regression
covers the nested-portal case with an unguarded positive control.

General and Connection were visually inspected in the in-app browser at 320,
375, 390, 768, 1024, 1440 and 1920px widths; the native setup dialog and QR were
also inspected. The development preview keeps the original five queue entries
and pairings and remains unclaimed so the owner can claim their own phone.

The earlier catalog and Bandcamp increment was checked at the same seven widths, with no video surface, horizontal
page overflow or clipped action labels across all five catalogs. The Bandcamp
22-track album also passed those seven viewport checks with decoded artwork.

Bandcamp native playback passed for Mastodon's Hail to Fire, Blazo's Intro and
the album's next track, Kero One - Keep It Alive (Blazo remix). The TV and phone
queued the 22 returned album tracks in order. Source replacement, Stop and
reconnect worked, and 74 queue entries plus eight saved items survived a desktop
restart without autoplay. A deliberately missing track showed a provider error
and left the queue unchanged. This does not qualify every track in the album;
[provider evidence](research/providers.md#public-provider-checks) records the
tested links, artwork checks and upstream limits.

External-subtitle checks use real TV SRT and phone ASS uploads plus an
authenticated Jellyfin SRT sidecar. Native pixel comparisons verify visible
glyphs on an unchanged paused frame. The suite also checks upload failures,
private file permissions, source cleanup and observed preference selection after
a desktop restart.

Music checks cover tagged MP3/FLAC/M4A and persisted artwork in the compiled
sidecar, artist/album navigation and all saved-playlist operations on the TV and
phone. The native audio capture and its conservative sample-matching analysis
are retained beside the playback screenshots.

The Linux test uses `COUCH_BASIC_RENDERING=1` because default rendering
also produces corrupted frames in standalone mpv inside this Docker environment.
The option selects mpv's basic GPU rendering path and disables advanced scalers
and custom shaders. It leaves the decoder and GL driver unchanged. The app's
normal default remains the advanced renderer.

A clocked PulseAudio null sink lets audio-only streams advance without physical
speakers. Advanced rendering, HDMI sound, hardware decode, Wayland, HDR, refresh
switching and suspend/resume still need checks on the TV hardware.

The debug container measured the Bun coordinator at about 59 MiB RSS. WebKit
and native rendering used considerably more memory with software rendering;
this is a starting measurement, not a release or TV-hardware benchmark.
Each Linux run saves process memory and binary sizes beside its screenshots.

## How the pieces fit

- `src/client`: React UI and a small WebSocket connection hook, shared by TV and remotes.
- `src/server`: Bun HTTP/WebSocket routes, authoritative session and SQLite storage.
- `src/shared/protocol.ts`: typed application messages and the private playback contract.
- `src/main.ts`: Bun entry point, HTML import and native pipe lifecycle.
- `src-tauri/src`: window, file picker, sidecar owner and native playback worker.

Bun supplies [HTML bundling/HMR](https://bun.com/docs/bundler/fullstack),
[WebSocket pub/sub](https://bun.com/docs/runtime/http/websockets),
[SQLite](https://bun.com/docs/runtime/sqlite) and
[compiled executables](https://bun.com/docs/bundler/executables). Tauri supplies
the window and official sidecar, single-instance, dialog and logging plugins.
Rust sends observed playback state to Bun through a private pipe. Bun broadcasts
complete current-state snapshots. Disconnected clients do not queue old actions
for replay.

The app reuses a released native video plugin. Vendored patches expose its
Rust driver, supply missing observations, correct libmpv binding layouts and
lifetimes, and fix a GTK parent assumption in the released Tauri runtime.
Exact versions, archive hashes and changes are documented
in [native dependency patches](../src-tauri/vendor/README.md). Those patches should
disappear as compatible upstream releases become available.

Desktop data uses Tauri's application data directory. Standalone development uses
`.data/`; `COUCH_DATA_DIR` overrides it. Remote requests need a paired token;
the trusted TV app and paired administrators may configure folders or Jellyfin
credentials. Remotes
queue library IDs; the host checks file containment again when playback starts.
Arbitrary web content has no
Tauri command access.

## Remaining product work

The app has audio/subtitle selection, subtitle off, chapters, speed and timing
offsets. Library scanning uses music-metadata for audio, ffprobe for video and SQLite FTS5 for search;
missing mounts retain their catalog. Radio supports saved M3U station feeds,
Radio Browser search with mirror failover, and shared favorites. Jellyfin uses its official SDK for browsing,
direct-play negotiation and one host progress reporter. Credentials and resolved
stream headers stay on the host.

Implemented work includes profile editing/removal, CUE albums, ReplayGain,
measured lossless continuity, local NFO/artwork and metadata corrections,
collections, IPTV guides and Tvheadend scheduling/completed recordings. Read the
[dated capability and acceptance record](qualification/current-status-2026-09-14.md)
for evidence and the remaining display, sound, sizing, real-folder, first-run and
YouTube rendering checks. Existing software evidence does not finish those gates.

Growing timeshift is deferred in [#67](https://github.com/avoid-quest/couch/issues/67).
CEC is not planned. Native Mac/Windows playback and a full Rust port are not
delivered. Jellyfin remuxing/transcoding, DRM/account-login video, crossfade and
speaker multiroom remain outside the delivered scope. Live TMDB qualification
requires authorized access. HDR and refresh switching are unqualified.

The [feature matrix](research/feature-parity.md) retains the original parity
proposal separately from its updated checkpoint. The
[appliance map](https://github.com/avoid-quest/couch/issues/1) and
[media map](https://github.com/avoid-quest/couch/issues/25) retain the wider plan.

## Manual Couch updates

Settings > Updates is visible on the TV and remote. Use an administrator remote
for Check for updates, Download update, and Install update. Other controllers
and the TV explain where to administer updates without granting update access.
The page shows the running version/commit and available signed release. Download
verifies the signed Debian package before Install update becomes available. Manual installation
works with either Manual or Auto when idle selected.

Install update asks before restarting and offers explicit playback interruption.
Keep the remote open to reconnect and check the durable result. Success requires
the requested version and commit to match the running app; an old build reconnecting
is not success. A failed trial reports an actionable error. Data is never automatically restored from an older snapshot. The application database backup is consistent; auxiliary browser-profile copies are best-effort.

Installation uses the restricted root package-update service. It verifies the enrolled publisher's package before APT installs it; it does not upgrade Ubuntu or select arbitrary packages.

### Interface size

TV Appearance uses Default, Larger and Largest with 100%, 135% and 175% interface
scaling over the TV typography. Existing saved choices are retained. The remote
keeps its separate 100%, 115% and 130% choices. TV sizing also applies to Settings,
playback dialogs, icons and focus indicators; it does not zoom the native video
or subtitles. Try a TV size and confirm it within 20 seconds, or it returns to
the saved choice. Reset remains available from Appearance.

### YouTube startup buffering on Linux

Network video with a separate audio stream, including ordinary YouTube playback,
buffers three seconds before starting. This avoids playing the opening seconds and
then freezing while the network buffer refills. Uncached seeks use the same reserve.
Local files, single-stream sources, radio and explicit IPTV live returns retain
their normal buffering settings. Slow or interrupted connections can still rebuffer.

Automatic quality is capped at 1080p; existing queue entries keep their saved quality.
An old Unrestricted entry must be added again with Automatic to use the new default.

### Search across sources

Open **Search** to search public YouTube, Twitch and RaiPlay catalogs, Radio,
scanned TV folders and the configured Jellyfin library. Bandcamp opens pasted
album/track links. Select a source to narrow results. Each source has its own
results and retry control. A failed Jellyfin connection leaves local results available. Unavailable folders
keep their indexed results visible with playback disabled; folder administration
stays in Settings > Sources. Refresh checks the catalog again without starting a
scan or changing source configuration.

Local search matches word prefixes across titles, original video titles, show
titles, artists and albums. All query words must match. Exact titles come first,
then SQLite FTS5 relevance with title matches weighted above artist and album
matches. Empty browsing remains alphabetical, and episodes within a selected
show retain season/episode order. Jellyfin uses its existing account-scoped
server search and alphabetical ordering. The result groups are not a combined
ranking across different search engines.

Open a result's details to inspect, play, resume or queue it. Closing details
returns to the same result, query and scroll position. Each TV or phone retains
its own search while visiting another catalog. **Library**, **Radio**, **Live TV**,
**Jellyfin** and **TV folders** shortcuts open their catalogs when Search is empty.
Existing movie/show hierarchies, music albums, collections, metadata editing and
progress controls remain in their respective library views.
