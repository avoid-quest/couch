# Interactive Linux preview

With Docker running, start the actual Linux app from a Mac or Linux checkout:

```sh
bun run preview:linux
```

The command builds the app, starts a persistent container, and opens the [real web remote](http://127.0.0.1:4100) in the default Mac browser. This is the app's React interface over HTTP and WebSocket. The first build downloads the Linux toolchain and dependencies. Later builds reuse the Linux acceptance-test image and caches.

The [Linux TV screen](http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=scale) shows the native app through noVNC for this Docker preview. Enter its pairing code in the web remote. On the Linux screen, open `/mnt/fixtures/multitrack.mkv` with the app's **Open file** button to try the generated video. To use a folder from your computer, start with `bun run preview:linux --media /path/to/folder` and choose `/media/host` in Settings → Sources. That mount is read-only. On the next preview start with `--media`, existing `/media` source paths are moved beneath `/media/host` in the saved preview database. Catalog IDs, relative file paths, drive identities, queue and watching history are retained. Older sources still require **Verify original folder** before scanning; use the same host media directory and confirm it is the original. Couch does not scan a replacement directory automatically. A saved migration marker identifies the new layout and prevents repeat migration. Without that marker, an existing `/media/host` source or descendant is ambiguous: it may have been a real subfolder of the old mount. Startup stops without changing source paths or committing the marker. Keep the data volume and inspect the previous container’s `Mounts` (`docker inspect couch-preview`) or retained configuration to establish whether the supplied directory was mounted at `/media` or `/media/host`. Resolve the saved paths against that proven layout before retrying; do not infer the layout from the path prefix.

For an ambiguous saved layout, keep the preview stopped and back up its SQLite database before editing it. Establish the old mount destination from the previous container's retained `Mounts` output or launch configuration:

- If it was `/media`, all those source paths belong to the old layout. Relocate the `/media` prefix to `/media/host`, including `/media/host` to `/media/host/host`, in one offline transaction. Preserve source IDs, relative item paths and saved identities; write the `preview_migrations` marker `media-child-v1` only when every relocation commits.
- If it was `/media/host`, leave the source paths unchanged and record that marker in an offline transaction.
- If the old destination cannot be established, retain the backup and volume and restore the previous preview configuration. Do not mark the migration complete or confirm a replacement folder as the original.

These recovery edits belong to the preview database only. They must not delete media, catalog items, queue entries or watching history. Existing drive identities must still pass the normal check, and unverified legacy sources still need explicit confirmation in Sources.

The paired remote listens on port 4100 on your computer's network interfaces. Open the printed phone URL on another device on the same LAN and enter the pairing code from the Linux window. `--local-only` keeps both ports on localhost. The desktop always stays on localhost. Its bridge accepts WebSocket connections only from `http://127.0.0.1:6080` or `http://localhost:6080`, so an unrelated website cannot connect to the desktop. VNC has no separate password; port 5900 is not published.

```sh
bun run preview:linux logs
bun run preview:linux stop
```

Closing the browser leaves the container running. The stop command removes only this checkout's named preview container. Settings, paired devices and library records remain in the `couch-preview-data` Docker volume. Stop and start again after source changes; rerunning the start command while the preview is active reopens the web remote.

With the preview running, `bun tests/preview/origin.ts` checks that normal noVNC connections work and unrelated, missing or opaque origins receive HTTP 403. It sends no desktop input.

This preview uses Xvfb, software video rendering and a silent PulseAudio sink. It can show the Linux player and its controls on a Mac. It does not test Mac native playback, audible output, hardware decoding or HDMI. The [Linux acceptance suite](../linux/README.md) runs separate automated checks.

To try local history, open Library → Manage folders in Sources and choose
`/mnt/fixtures`. Play the scanned clip, pause or seek, then stop. Library offers
Resume and Play from start; History shows the saved point. The Household button
opens watching profiles. Stop before selecting another viewer. Phones share
that selection, while each phone keeps its own browsing view.

Playback settings can add `/mnt/fixtures/external-tv.srt` or
`/mnt/fixtures/external-phone.ass` on the TV. A phone chooses a subtitle file from
its own storage. Settings, Playback saves language, subtitle mode and speed for
the selected watching profile. Current speed and track choices end with the
item unless you use Save as default. Volume and audio delay belong to this TV.

Add `/mnt/music-fixtures` in Settings → Sources to try the tagged MP3, FLAC and M4A compilation.
Artists and Albums show its embedded cover and disc/track ordering. Use Saved
playlists beside Queue to keep and edit a named mix. The fixture also includes
two lossless tracks used by the acceptance suite to measure queue transitions.

## How the preview works

Xvfb supplies the Linux display, Openbox manages its window, and x11vnc exports
that existing display. noVNC renders it in the Mac browser. websockify serves
Ubuntu's `/usr/share/novnc` assets and forwards the WebSocket connection to
container-local VNC. See the [Xvfb manual](https://manpages.ubuntu.com/manpages/noble/man1/Xvfb.1.html),
[x11vnc options](https://manpages.ubuntu.com/manpages/noble/man1/x11vnc.1.html),
[Ubuntu noVNC package files](https://packages.ubuntu.com/noble/all/novnc/filelist)
and [noVNC deployment options](https://novnc.com/noVNC/docs/EMBEDDING.html).

The bridge listens on all container interfaces so Docker Desktop can forward
the host's loopback port into its VM. Docker publishes only `127.0.0.1:6080` for
the screen; it never publishes port 5900. The real app remote uses port 4100
with its own pairing checks. See [Docker Desktop forwarding](https://docs.docker.com/desktop/features/networking/#how-exposed-ports-work)
and [port publication](https://docs.docker.com/engine/network/port-publishing/).

The installed websockify `ExpectOrigin` plugin checks an exact list of local
preview origins before accepting a WebSocket. Ordinary static requests need no
Origin header. This protects against unrelated webpages connecting to local
VNC; programs already running on the computer can forge those headers.
See the [upstream plugin](https://github.com/novnc/websockify/blob/v0.10.0/websockify/auth_plugins.py#L74)
and [WebSocket origin model](https://datatracker.ietf.org/doc/html/rfc6455#section-10.2).
