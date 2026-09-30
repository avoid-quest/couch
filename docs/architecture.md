# Current architecture

Couch is one Electron app. Core, the Node coordinator, owns the Playbacks,
playback intent, authorization and persistent state. A remote never resolves
private playback URLs or becomes another playback authority.

The app runs in one of two modes, chosen on first run and in Settings →
Devices, in its **Couch** section:

- **Full** (`operating-mode.json` `"local"`): Main starts Core in an Electron
  [`utilityProcess`](https://www.electronjs.org/docs/latest/api/utility-process)
  and the window loads Core's own UI from `http://localhost:<port>`.
- **Client** (`"remote"`): Core stays stopped, so no hidden Couch plays. The window
  loads the other Couch's own UI, so both always run the same build. That page
  pairs like any browser.

Each device has one name, reused with every Couch it joins. The Couch app's name
is the `installation` name in `couch.sqlite`, so the computer and the Couch it
hosts share it in both modes: Main reads it, and saves it with a short-lived
connection (`app/device-name.ts`) whether or not Core runs, then tells a running
Core that it was `renamed`. "Couch", the name Core gives a Couch nobody named,
counts as unnamed. A browser keeps its name in its own storage; older app
bridges without `deviceName` do the same. General edits the name and pairing asks for
it only while there is none. A connected device gives each Couch its name; an
unnamed one adopts the name it paired with instead. An administrator
renames another Couch's host in Devices (`/api/settings`); every other device
names only itself.

Every client's Sendspin key, which is its device ID, stays in the storage of the
origin that made it. The SDK's `storage` interface gives Couch and Sendspin the
same key, including when browser storage is unavailable. Sendspin admits the
host's device only from this machine.

Client devices opt into audio, video and native administration independently in
General; all three start off. The local identity persists these choices and its
authenticated WebSocket advertises them. Core accepts changes only from that
device's own connection, checks target consent for playback and mixer commands,
and rechecks it after source resolution and before a native mpv fallback.
An Output's `local` flag records an explicit self-play or self-join; that choice
works without granting another controller access. Revoking sharing removes
remote output channels and stops their renderer or Sendspin membership at once.
The receiving client also enforces its saved consent. Native administration is
separate: sharing speakers or a screen never grants permission to update or
restart the app. Full-mode host outputs and administration retain the existing
server network-sharing and administrator policy; Devices manages server
sharing, while client-specific consent switches appear only when joining one.

The LAN reaches Core over HTTPS with a self-signed certificate (key and certificate
in `<data>/tls`), so browsers get a secure context for WebCodecs Opus. Plain HTTP
on the same port serves only this machine (the app window's `localhost`); the LAN
is redirected to HTTPS. Browsers click through Chrome's or Safari's warning once.
Client mode pins the other Couch's key (SHA-256 of its SPKI, in
`operating-mode.json` `pins`) when it is chosen or first reached, and trusts only
that key, so its window shows no warning. The certificate keeps its key when Core
reissues it for new addresses or before its 825 days run out, so pins survive.
An HTTPS page can't load `http://` media, so Pass-through relays those streams.

Main and Core talk over the utilityProcess parent port (`ready`, `addresses`,
`display`, `renamed` and `shutdown`). The window's preload (`app/preload.ts`) exposes
`window.couchApp`: the mode choice, this computer's `deviceName`, the host token for this computer's Core (Full
mode, localhost page only), the desktop interface size and TV presentation. The
window sets `autoplayPolicy: "no-user-gesture-required"` and
`backgroundThrottling: false`.

Many Playbacks run at once (`src/server/session.ts`, one session each). A Playback
is a queue, current item, position, pause state, speed and tracks, with its own
outputs: each Device's `Output` `{ picture, sound }` in it. A Device's outputs
serve one Playback at a time. A Device owns one volume and mute, persisted in the
`devices` table; it renders a Playback's sound at `sound && !muted ? volume : 0`,
and on the Linux TV with system audio its volume and mute are the system's.
Nothing else stores a volume: the band's volume shows the loudest in-sound
Device's and scales them all proportionally, and its mute mutes them all.

Every window controls one Device (`control`, idle ones too; by default its own)
and looks at the Playback that Device serves; controlling never moves outputs.
Play, Queue, transport and volume act on it, and Play on a Device (`deviceId` on
Play now, the item menus' "Play on" and "Play on {name}") starts it there and
controls that Device, with a "Playing on {name}" toast. `solo` leaves one Device
with the Playback's picture and sound, and `allSpeakers` is the Mixer's All
fader: a level above 0 sets every online Device to it with its sound in, 0 takes
every Device's sound out, and it stores nothing; a Device that joins reloads the item where it was with its pause
state, speed, tracks and subtitle delay, and windows controlling a Device the
Playback left follow it. An output that goes offline
pauses its Playback until it returns, and a Playback ends when its queue does.
Each Playback keeps its Up next in the `playback` table.

Every Device renders playback the same way (`src/client/session/renderer.ts`),
the app window included: Core sends `{ type: "player", command }` over the
Device's WebSocket and listens to `{ type: "player", state }` only from the tab it
chose. A Playback renders on its output Device; the newest tab of that Device
takes over and reloads the item where it was, and when that tab closes the next
newest one does. The Device fetches the source itself (Direct delivery, no bytes
through Core): URLs play in `<video>`, YouTube's separate audio in an `<audio>`
that follows the video, HLS through hls.js where the engine has no native HLS, and
raw MPEG-TS through mpegts.js. Chromium Devices get YouTube's VP9 and Opus,
others H.264 and AAC. Uploaded SRT/VTT subtitles are served to the `<track>` as
WebVTT from memory. A browser that needs a gesture before sound plays the picture
muted and shows "Tap to hear". In the app, Main caps googlevideo's open-ended
`Range` requests at 10 MB, because YouTube sends those at about playback speed.

When a Device can't fetch a stream itself because of its Origin, CORS or headers,
Core relays it (Pass-through, `src/server/pass-through.ts`). At Play, Core asks
each stream once with the Device's Origin and User-Agent and hands out a relay
address only for what fails there but works for Core: Twitch's playlists answer
403 to a browser on a LAN origin. Relayed HLS playlists are rewritten so nested
playlists go through Core and segments stay direct when the Device may read
them; other bytes stream through with their `Range`. Nothing is transcoded.
Relay addresses are signed for one Playback and work while it plays that item.

When a Playback's outputs span Devices, its sound is Synced
(`src/server/sendspin.ts`). Core runs a Sendspin server on its own port at
`/sendspin` (`@sonn-audio/node-sendspin`, Noise with AES-GCM, because Electron's
BoringSSL has no ChaCha20-Poly1305); it admits only this Couch's Devices, whose
Sendspin key is their ID. The newest tab of every Device whose sound is in the mix
plays it with the official player (`@sendspin/sendspin-js`,
`src/client/session/sendspin.ts`), and a browser that needs a gesture shows "Tap to
hear". One FFmpeg per Playback reads the audio-only rendition (YouTube's separate
audio, an HLS master's audio playlist or audio-only variant) with network protocols
only and a 10 s read timeout, decodes once and encodes once per wire format: Opus in
60 ms packets, and 100 ms PCM chunks for players that don't take Opus (Firefox). Every
speaker on a wire gets the same chunk with the same timestamp; each applies its Device's
volume and its own delay (Sendspin static delay). Pause, seek and speed restart FFmpeg where
the Playback is; when the outputs are back on one Device, it plays directly again.

Every Device showing the picture of a synced Playback fetches the video itself,
resolved for its own engine and origin, and plays it muted. It connects to Sendspin
only for the clock: Core sends the group's position as Sendspin metadata progress,
and the picture follows it with `timingsrc` (`src/client/session/picture-clock.ts`),
which nudges the playback rate for small drift and seeks for large drift. For a live
source the position is the source's own timestamp: FFmpeg keeps it (`-copyts`) and
reports the first one, and hls.js maps it to its own timeline (`INIT_PTS_FOUND`), so a
picture that joins the stream anywhere lines up with the sound.

IPTV MPEG-TS channels with MPEG-2 video or AC-3/E-AC-3/MP2 audio, which Chromium
can't decode, play in an mpv process on the Device that runs Core
(`src/server/mpv.ts`, JSON IPC). ffmpeg reads the channel's codecs when it
starts. mpv comes from `PATH` or, on macOS and Windows, from mpv's GitHub
releases (SHA-256 checked); Linux uses the system's package.

Sources are external internet media only: yt-dlp sites (YouTube, Twitch,
RaiPlay, Bandcamp and others), StreamingCommunity, radio and IPTV playlists.
Couch serves no local files. The rebuild plan is
[#644](https://github.com/avoid-quest/couch/issues/644).

## Helpers

Core runs three helpers: yt-dlp, QuickJS-NG (yt-dlp's JavaScript runtime for
YouTube's challenges) and ffmpeg. The app ships none of them
(`src/server/helpers.ts`).

- Core uses the copy on `PATH` when it is recent enough: yt-dlp at its latest
  release, QuickJS-NG 0.12 or later, ffmpeg 7 or later.
- Otherwise it downloads the official build into `<data>/helpers/<name>/<version>`,
  checks the SHA-256 and runs it before switching to it:
  - yt-dlp's own `yt-dlp_macos.zip`, `yt-dlp_linux*.zip` or `yt-dlp_win*.zip`.
    These unpacked builds start in a fraction of a second; the one-file builds
    unpack themselves on every run.
  - QuickJS-NG's `qjs-*` release binary.
  - ffmpeg from [Martin Riedl](https://ffmpeg.martin-riedl.de) on macOS and
    Linux (its `.sha256`; on macOS also his Developer ID signature), and from
    [BtbN](https://github.com/BtbN/FFmpeg-Builds) on Windows. Martin Riedl's
    builds carry their own OpenSSL, so Core sets `SSL_CERT_FILE` to the system's
    certificates (`/etc/ssl/cert.pem` on macOS, `/etc/ssl/certs/ca-certificates.crt`
    on Debian) for its helpers; without it every `https` read fails.

  GitHub's recorded asset digest is the SHA-256 for GitHub releases.
- Core checks every helper at start and once a day. It updates yt-dlp when a
  newer release exists, and downloads again any helper that is missing or
  doesn't run. Before each yt-dlp run it also replaces a missing yt-dlp or
  QuickJS-NG, and a yt-dlp that won't start.

## Delivery

```
src/client -- Vite --> dist                         (served by Core from disk)
src/main.ts -- Bun.build --target=node --> build/core.mjs   (Core)
app/main.ts -- Bun.build --> build/main.mjs         (Electron main, ESM)
app/preload.ts -- Bun.build --> build/preload.cjs   (sandboxed preload)
```

`bun run build` writes the build identity, runs Vite once and bundles the three
entry points with their dependencies. electron-builder packages only those files,
`dist` and two icons (see `build` in `package.json`); the app ships no
`node_modules`. Core reads `dist` beside its bundle, inside `app.asar`.

Only browser remotes in a supported secure context register `/sw.js`; the app
window never does.

## Development

`bun run app` builds and starts the app from the checkout with data in `.data`
(set `COUCH_DATA_DIR` and `COUCH_PORT` for other scratch runs). `bun run dev` is
the browser-only loop: it rebuilds Core on every source change, runs it under
`node --watch`, and starts Vite on port 1420 with an API proxy to Core on port
4100 (`COUCH_PORT`).
