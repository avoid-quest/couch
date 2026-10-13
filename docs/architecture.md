# Current architecture

Couch is one Electron app. Core, the Node coordinator, owns the Playbacks,
playback intent, authorization and persistent state. A remote never resolves
private playback URLs or becomes another playback authority.

The app runs in one of two modes, chosen on first run, in the header's Couch
switch, or in Settings → Devices' **Couch** section:

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
Deliberate server switches carry the public device name and saved server
labels/addresses in the URL fragment: the whole saved list to a server already on
it, only the current server to a newly typed address. The destination keeps the
labels only when the page that sent it there is one of them, then removes the
hints from the URL. A name from any other page only fills in the pairing form's
name field. That unsubmitted suggestion is a page draft: reloading before
pairing discards it. Submitting pairing saves the chosen name; an existing
saved name survives reload and Forget, which removes a server connection.
Pairing credentials and keys remain in their original storage.

Client devices opt into letting other devices use their speakers and screen
independently in General; both start off. Like the name, the choice belongs to the device: the Couch app keeps one
in `<data>/device-sharing.json` for every Couch it joins, and a browser keeps it in
the origin's storage. The authenticated WebSocket advertises it. Core accepts
changes only from that device's own connection, keeps the last choice while the
device is offline (so it resumes what it played), checks target consent for
playback and mixer commands, and rechecks it after source resolution and before a
native mpv fallback. An Output's `local` flag records an explicit self-play or
self-join. Only here is exclusive, across the queue too: Core refuses it, changing
nothing, while another device's private output, or a publisher's private `held`
output, would stay behind or return, checking again where the move lands after the
item resolves. Joining a Playback is allowed only where
the joining device could already control it, because joining brings its group
transport and queue controls; direct output changes still require that device's
sharing consent. A fully private Playback can only be controlled by its output
devices, and joining one is refused. A publisher's output held out of its own
source (`held`) is part of that Playback's mix: it counts for control, joining,
what the publisher looks at and what its ordinary Play keeps, so a private device
joining the publisher's playback does not take it over. Consent applies to it per
channel as to an output. It is retired when the device is unpaired or plays
elsewhere, and returns when another item becomes current. The last Sendspin delay each speaker reported
is kept in `device_sync_delay`, so its row shows it after a restart until the
speaker reports again; the speaker's own player keeps the value it applies.
Revoking sharing removes remote output channels and stops their renderer or
Sendspin membership at once. Sharing speakers or a screen never grants permission
to update or restart the app; that stays with administrators. Full-mode host
outputs retain the existing server network-sharing policy, and turning it off
keeps what the host plays; Devices manages server sharing, while the client
switches appear only when joining one. A Device that shares neither can still
control playback. Where it plays lists it, this window's own Device included,
only while it is an output, which Play on can still make it.

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
`devices` table; it renders a Playback's sound at
`sound && !muted ? round(volume * effectiveTrim / 100) : 0`. All applies the
Playback's `mixTrim` only to speakers its caller may control. Private speakers
retain their own chosen attenuation through foreign All changes; new private
sound and revoked foreign influence return to their own level. Regranting audio
joins the current All. These per-output trims live with the outputs, so a restart
restores queues and All without outputs or an All actor. Restored All applies to
shared audio; private sound starts at its Device's own level until a fresh All
from that Device establishes its choice. Resuming playback does not adopt saved
All authority. The Playback's `mixTrim`,
saved with it in the `playback` table, starts at 100 and attenuates its selected
sound; zero keeps those outputs selected so raising it restores their sound, and
the band then shows 0. Raising a volume, a fader, the TV's system volume or
unmuting a muted Device in its sound while it is 0 sets it back to 100, which
leaves muted and 0-level Devices silent; raising the band then changes only the
trim, and lowering it changes nothing. On the Linux TV with system audio its volume
and mute are the system's, and Couch applies the trim to its stream instead.
The band's volume shows the loudest in-sound Device's saved level and scales
them all proportionally, and its mute mutes them all.

The header selects a server. Within that server, each controller looks at the
Playback its selected output Device serves. Core keeps that choice in memory
while it runs: an explicit choice stays selected while it is shared, and Remote
keeps its selected TV through idle and disconnects. Without a valid explicit
choice, a Device receiving a Playback shows that Playback; an idle controller
selects the server's own Device. While that Device is offline and idle, Play and
the view use the controller's own Device without changing the choice. Outputs
stay with the live Playback; a server restart restores queues
without outputs. Ordinary Play keeps the current mix, and playing a waiting
Playback moves that whole mix to it. Explicit Play on a Device (`deviceId` on
WebSocket Play now, `?on=` on REST play requests; the item menus' "Play on" and
"Play on {name}") isolates that Device and selects it once the item checks out
(a list loaded, a source or history item still there), with a "Playing on
{name}" toast. A selected output that stops serving (fader to 0, sharing
withdrawn, unpaired) moves its controllers to another output in its mix,
including controllers away on another server; one that moves to another
Playback keeps them, and a Playback that ends moves no one.
`solo` leaves one Device
with the Playback's picture and sound, and `allSpeakers` is Where it plays' All
fader: it changes only the Playback's trim, preserving output selection and Device
levels and mute. A Device that joins reloads the item where it was with its pause
state, speed, tracks and subtitle delay, and windows controlling a Device the
Playback left follow it. An output that goes offline
pauses its Playback until it returns, and a Playback ends when its queue does.
After Stop it keeps its queue for 10 s, so the controller's Undo can play the
stopped item again.
Each Playback keeps its Up next in the `playback` table.

Every Device renders playback the same way (`src/client/session/renderer.ts`),
the app window included: Core sends `{ type: "player", command }` over the
Device's WebSocket and listens to `{ type: "player", state }` only from the tab it
chose. A Playback renders on its output Device; the newest tab of that Device
takes over and reloads the item where it was, and when that tab closes the next
newest one does. The Device fetches the source itself (Direct delivery, no bytes
through Core): URLs play in `<video>`, YouTube's separate audio in an `<audio>`
that follows the video, Couch-hosted HLS through hls.js where supported with
native HLS as the fallback, and raw MPEG-TS through mpegts.js. Direct cross-origin
HLS retains native playback with hls.js as the fallback because a provider's
segments may not permit CORS. Synced live pictures use hls.js to map source
timestamps where supported. Chromium Devices get YouTube's VP9 and Opus,
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

Live device inputs are captured in the publishing window and exist only while
that capture is active. The authenticated Device session owns each publication.
Direct playback attaches a WebRTC MediaStream to the ordinary renderer's video
element. Core grants signaling only between the exact publishing and receiving
connections. ICE configuration, including optional authenticated TURN, is returned
only after pairing and never appears in public discovery.
One MediaRecorder also uploads the capture over a separate WebSocket using a
publication-scoped upload token. Core converts it into rolling HLS with FFmpeg
(`src/server/live-stream.ts`) for Synced playback; media addresses are signed for
the current Playback. Moving between Direct and Synced replaces the renderer's
media while preserving the ordinary queue, output selection and capture ownership.
The short-lived capture entry can share an ordinary queue with other media, but
is excluded from persistent queues and removed when its publication ends. Capture
cleanup closes the upload, stops its encoder and removes its temporary segments.
For publishing, receiving and capture checks, see [Share a live device](live-inputs.md).

When a Playback has outputs on several Devices, its sound is Synced
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
picture that joins the stream anywhere lines up with the sound. A screen's report
adds its picture and subtitle tracks to the Playback's only when it has a video
track: a screen still loading, or a tab that just reconnected, has none yet.

Grouped captured inputs use that same sound and picture clock. Encoding and the HLS and
Sendspin buffers add capture-to-output delay so devices can schedule shared
playback. Clock agreement does not measure physical output alignment; test the
actual speakers and screens, and use the existing per-device timing adjustment
where their hardware introduces extra delay. Direct capture bypasses that buffered
pipeline; a single MediaStream maintains its own audio/video synchronization.

Core prints one line per event, each starting with an ISO timestamp, which the
app keeps in `<data>/logs/couch.log`: `device online <name>` and `device offline
<name>` for each tab, `playback <id> Direct|Synced on <names>` when a Playback's
delivery or outputs change, and `player error <id> on <name> host=<host>:
<message>` once per error a tab reports for each load. Core also logs a Sendspin
FFmpeg failure as `player error <id> Synced host=<host>: <message>`, even without
a reporting tab; stop and pause stay quiet. Error text is bounded to 300 characters
and stripped of controls and line separators. A source appears only as its host,
because its URL can carry a token.

Main also records timestamped, bounded failures from Main and the updater, plus
renderer error-level messages Electron attributes to the main frame. URLs retain
only their host; credentials and filesystem paths are removed before controls
are flattened and the message is bounded. Routine renderer messages and events
attributed to child frames are excluded. Electron 44 can attribute unsandboxed
same-origin `srcdoc` errors to the main frame, so those are included; the app
currently creates no iframes. The existing stdout/stderr tee remains raw for
other output, with current/previous-run rotation and its 10 MB write gate.

IPTV MPEG-TS channels with MPEG-2 video or AC-3/E-AC-3/MP2 audio, which Chromium
can't decode, play in an mpv process on the Device that runs Core
(`src/server/mpv.ts`, JSON IPC). ffmpeg reads the channel's codecs when it
starts. mpv comes from `PATH` or, on macOS and Windows, from mpv's GitHub
releases (SHA-256 checked); Linux uses the system's package.

Sources include live device inputs and external internet media: yt-dlp sites
(YouTube, Twitch, RaiPlay, Bandcamp and others), StreamingCommunity, radio and
IPTV playlists.
Couch serves no local files.

## Helpers

Core runs three helpers: yt-dlp, QuickJS-NG (yt-dlp's JavaScript runtime for
YouTube's challenges) and ffmpeg. The app ships none of them
(`src/server/helpers.ts`).

- Core uses the copy on `PATH` when it is recent enough: yt-dlp at its latest
  release, QuickJS-NG 0.12 or later, ffmpeg 7 or later.
  If yt-dlp's release check fails, it uses the newer runnable copy from `PATH`
  or its own cache, preferring `PATH` when the versions match.
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
