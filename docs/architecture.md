# Current architecture

Couch is one Electron app. Core, the Node coordinator, owns the Playbacks,
playback intent, authorization and persistent state. A remote never resolves
private playback URLs or becomes another playback authority.

The app runs in one of two modes, chosen on first run, in the header's Couch
switch, or in **Settings → This device**:

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
bridges without `deviceName` do the same. This device edits the name and pairing asks for
it only while there is none. A connected device gives each Couch its name; an
unnamed one adopts the name it paired with instead. An administrator
renames the Couch from any paired device in Devices & network
(`/api/settings`); every other device names only itself.

A TV pairs without typing (`src/server/tv-pairing.ts`). Unauthenticated, it
asks `POST /api/pair/tv` with its device ID and name, under the same origin,
sharing and rate limits as `POST /api/pair` (20 a minute), and gets a six-digit
code and a 256-bit secret. The request lives in Core's memory for ten minutes.
Whoever may read the pairing code, the host or an admin, reads the TV's name
(`GET /api/pair/tv/<code>`) and approves it (`POST`), which pairs the device
through the same `store.pair` as `/api/pair`. The TV polls
`POST /api/pair/tv/poll` with its code and secret and collects its token once.
A device that is already paired can't ask, so an approval never re-keys
another device. Whether a device last connected as a TV (`/api/ws?tv=1`)
is kept in its `devices` row (the host's in `installation`), so a TV that's off
is still one after Core restarts.

Settings that change the Couch for everyone (Share on network, HTTP, network
address, the live relay, TV mode, sources, hardware, updates) accept the host
or any paired admin and refuse controllers; writes recheck the role after
reading the body. TV mode lives in Main, so Core forwards an admin's request
(`/api/settings/tv-mode`) as a `tvMode` parent-port message; Main saves it,
replies, then restarts the app, and a TV launcher's lock stays read-only.
When a device turns sharing or HTTP off over the connection it would cut, Core
sends that reply first, then stops the LAN listener or closes the plaintext
socket (`afterResponse` in `src/server/http.ts`).

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
independently in This device; both start off. Like the name, the choice belongs to the device: the Couch app keeps one
in `<data>/device-sharing.json` for every Couch it joins, and a browser keeps it in
the origin's storage. The authenticated WebSocket advertises it. Core accepts
changes only from that device's own connection, keeps the last choice while the
device is offline (so it resumes what it played), checks target consent for
playback and mixer commands, and rechecks it after source resolution and before a
native mpv fallback. An Output's `local` flag records an explicit self-play or
self-join. Move here (`solo`) is exclusive, across the queue too: Core refuses it, changing
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
channel as to an output, and moving it to another Playback needs the same consent
as moving an active output. It is retired when the device is unpaired or plays
elsewhere, and returns when another item becomes current, whether by Next or Play. The last Sendspin delay each speaker reported
is kept in `device_sync_delay`, so its row shows it after a restart until the
speaker reports again; the speaker's own player keeps the value it applies.
Revoking sharing removes remote output channels and stops their renderer or
Sendspin membership at once. Sharing speakers or a screen never grants permission
to update or restart the app; that stays with administrators. Full-mode host
outputs retain the existing server network-sharing policy, and turning it off
keeps what the host plays; Devices manages server sharing, while the client
switches appear only when joining one. A Device that shares neither can still
control playback. Where it plays lists every Device; one that shares neither
offers Picture and Sound only to itself.

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
with the Playback's picture and sound, and `allSpeakers` is the All fader older
clients offer: it changes only the Playback's trim, preserving output selection and Device
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
timestamps where supported. VP9-capable Devices prefer YouTube's VP9 and Opus;
other Devices require H.264 and AAC, including separate audio and progressive
fallbacks, or receive the fixed no-playable-format error. YouTube quality uses
yt-dlp's smaller-dimension resolution (including portrait Shorts): Auto caps at
1080p, explicit 480/720/1080p caps fall back to lower available resolutions,
and Best has no cap. The smallest known positive dimension must fit the cap;
if only width or height is known, that dimension must fit. Formats with neither
dimension known remain eligible. Other sites keep their existing height selection.
Uploaded SRT/VTT subtitles are served to the `<track>` as
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

Live device publications belong to the authenticated Device session and end
with its sharing owner. Ordinary display/audio capture stays in the publishing
window. For Live audio, Main owns capture independently of that window's event
loop: native Mac inputs use the bundled PortAudio/CoreAudio helper, while
explicit browser input IDs use an isolated hidden capture page with a restricted
preload. Native capture uses the selected UID, optional exact device-rate request,
callback-buffer request and same-process readback. Permission is granted before
opening the input. Main stops owned capture on cancel, navigation, renderer loss,
window close and quit, and waits for retirement before another preparation.
Direct playback attaches a WebRTC MediaStream to the ordinary renderer's video
element. Core grants signaling only between the exact publishing and receiving
connections. ICE configuration, including optional authenticated TURN, is returned
only after pairing and never appears in public discovery.
Captured video and audio without timestamped PCM retain Direct WebRTC peers
unless their Playback is In sync
([ADR 0001](adr/0001-live-inputs-play-over-webrtc-unless-in-sync.md)).
Only while such a Playback plays the source In sync, or to a receiver that couldn't connect
directly, does Core ask the publisher (`livePeers.upload`) for one MediaRecorder upload
over a separate WebSocket using a publication-scoped upload token, and convert it into
rolling HLS with FFmpeg (`src/server/live-stream.ts`); it stops both once nothing plays
it buffered. Fallback needs a connected receiver; In sync retains its stream while
paused, including while waiting for offline outputs to reconnect. Each media address
is signed for the current Playback and its Device, and
works only while that Device's output shows the picture, or while that Device is relayed;
Core's own decoder reads one that no Device receives, from this machine. A relayed
receiver plays its address in the ordinary player with its sound, outside any group.
Moving between Direct and Synced replaces the renderer's media while preserving the
ordinary queue, output selection and capture ownership.
The short-lived capture entry can share an ordinary queue with other media, but
is excluded from persistent queues and removed when its publication ends. Capture
cleanup closes the upload, stops its encoder and removes its temporary segments.
For publishing, receiving and capture checks, see [Share a live device](live-inputs.md).

On Linux, an admin can also turn on an AirPlay receiver ([Receive AirPlay](airplay.md)).
Core runs the pinned UxPlay it ships as a separate process, only while that switch and
Share on network are on, and reads the decoded sound of an admitted sender from a private
pipe. Core owns that publication (`airplay`, never a Device): every receiver plays it
through relaxed scheduled PCM after rate normalization, without audio-only HLS. It ends when the
sender leaves, and an admitted sender counts as playing for unattended updates.

Core chooses Sendspin scheduled sound for Live audio, related relaxed outputs
across Devices, and timestamped Audio input and AirPlay even with one listener. Its shared implementation lives in `scheduled-audio.ts`,
with read-ahead URL decoding and capture-timestamped sending as separate sender policies.
When a Playback has outputs on several Devices, its sound is Synced
(`src/server/sendspin.ts`). Core exposes `/sendspin` with unmodified Node SDK sessions, behind Couch token
authorization. It binds the SDK's `client/init` (or a Node client's plaintext `client/hello`) to the token's stable Device ID. The newest tab of every Device whose sound is in the mix
plays it with the official player (`@sendspin/sendspin-js`,
`src/client/session/sendspin.ts`), and a browser that needs a gesture shows "Tap to
hear". One FFmpeg per Playback reads the audio-only rendition (YouTube's separate
audio, an HLS master's audio playlist or audio-only variant) with network protocols
only and a 10 s read timeout, decodes once and encodes once per wire format: Opus in
60 ms packets, and 100 ms PCM chunks for players that don't take Opus (Firefox). Every
speaker on a wire gets the same chunk with the same timestamp; each applies its Device's
volume and its own delay (Sendspin static delay). Pause, seek and speed restart FFmpeg where
the Playback is; when the outputs are back on one Device, it plays directly again.

Timestamped native/browser audio enters the publication-scoped upload with the
local HTTP Origin, owner token, upload key and generation checked by Core.
The native helper receives no credentials: Main brackets Core clock exchanges
with the helper's clock, and keeps the PortAudio ADC-time estimate in each PCM
packet. Bounded native/pipe/socket queues, sequence/sample validation and source
format conversion preserve the source mapping. Both Live and relaxed audio-only
capture use Sendspin without MediaRecorder/AAC/HLS. FFmpeg supplies PCM/Opus;
presentation timestamps retain measured capture-block times.

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

Captured video inputs In sync use that same sound and picture clock. Encoding and the HLS and
Sendspin buffers add capture-to-output delay so devices can schedule shared
playback. Clock agreement does not measure physical output alignment; test the
actual speakers and screens, and use the existing per-device timing adjustment
where their hardware introduces extra delay. Direct capture bypasses that buffered
pipeline; each receiver's MediaStream keeps its own audio/video synchronization, but
Direct receivers are not aligned with each other.

Live audio sources use the same Sendspin groups as other scheduled audio.
The [capability contract](audio-video-use-cases.md) separates acquisition from
delivery and control. The current Mac-only native helper remains wired to local
desktop Live publication; this coupling is an implementation limit.
Couch establishes an authenticated HttpOnly `/sendspin` cookie, binds the SDK's
encrypted `client/init` to that Device, and leaves reconnect, decoding, buffering
and correction to the unmodified SDKs. One FFmpeg process per captured source
converts to PCM and Opus; the sender maps encoded offsets to measured capture
blocks and uses player-declared buffers and output delays. See
[Live audio](live-audio.md) for the adapters and correctness checks.

Core prints one line per event, each starting with an ISO timestamp, which the
app keeps in `<data>/logs/couch.log`: `device online <name>` and `device offline
<name>` for each tab, `playback <id> Direct|Synced on <names>` when a Playback's
delivery or outputs change (a live input's relayed receiver is marked `(buffered)`, or `(unavailable)` once its buffered stream failed),
`live <id> buffered stream stopped: <reason>` when a buffered live stream fails, with a `player error` line for each receiver it relayed, and `player error <id> on <name> host=<host>:
<message>` once per error a tab reports for each load. Core also logs a Sendspin
FFmpeg failure as `player error <id> Synced host=<host>: <message>`, even without
a reporting tab; stop and pause stay quiet. Error text is bounded to 300 characters
and stripped of controls and line separators. A source appears only as its host,
because its URL can carry a token.

Main also records timestamped, bounded failures from Main and the updater, plus
renderer error-level messages Electron attributes to the main frame. URLs retain
their host only. Before Electron serializes console arguments, the app's client
formats a logged DOMException with its name, message and stack when available;
otherwise Electron passes only `[object DOMException]`. This retains errors
from dependencies too, without suppressing them. Credentials and filesystem
paths are removed before controls are flattened and the message is bounded.
Routine renderer messages and events
attributed to child frames are excluded. Electron 44 can attribute unsandboxed
same-origin `srcdoc` errors to the main frame, so those are included; the app
currently creates no iframes. The existing stdout/stderr tee remains raw for
other output. Each run starts `couch.log` afresh and keeps the previous run's as
`couch.1.log`. A run that fills 5 MB moves it to `couch.log.1` and continues, so
the newest 5–10 MB of each run survive, late failures included (the previous
run's earlier file is `couch.1.log.1`). Every file begins with a header naming
the Couch version, run ID and process ID.

IPTV MPEG-TS channels with MPEG-2 video or AC-3/E-AC-3/MP2 audio, which Chromium
can't decode, play in an mpv process on the Device that runs Core
(`src/server/mpv.ts`, JSON IPC). ffmpeg reads the channel's codecs when it
starts. mpv comes from `PATH` or, on macOS and Windows, from mpv's GitHub
releases (SHA-256 checked); Linux uses the system's package. On Intel macOS
13–14, automatic mpv downloads are blocked because the official build needs 15.
A compatible runnable `PATH` or cached copy can serve those channels; without
one, only the channel needing mpv reports the compatible-install requirement.
Manual helper checks also preserve a compatible cached copy on those systems.

Sources include live device inputs, AirPlay senders and external internet media: yt-dlp sites
(YouTube, Twitch, RaiPlay, Bandcamp and others), StreamingCommunity, radio and
IPTV playlists.
Couch serves no local files.

YouTube channel metadata supplies a validated `/channel/UC…` identity for new
channel Saves and section links, with the requested address as the fallback.
Favorites reads do not resolve existing alias bookmarks. Opening a saved alias
normalizes that bookmark only after its channel resolves, preserving its position
or merging an already saved canonical channel. A metadata failure keeps the alias
and its Saved/Remove state. Other aliases stay as saved until they resolve.
Only a channel's own Videos, Shorts and Live streams inherit its verified creator
when flat entries omit it; playlist owners never stand in for video creators.
Full playlists retain each occurrence's containing list and zero-based index
after completeness and availability validation, including repeated videos.
Browsing still offers the page at offset 2400; its final index, 2423, is accepted
by Details routes, Save and playback commands. Whole-list loading keeps its
500-video limit.

SoundCloud Details reuse track metadata from Core's one-minute provider cache.
Its bundled [yt-dlp extractor plugin](https://github.com/yt-dlp/yt-dlp#developing-plugins)
uses SoundCloud's known JPEG artwork sizes, up to 500px, instead of probing each
original image with a serial HEAD request. Search still uses yt-dlp's flat
extraction; playback retains its full format extraction and public-network proxy.

## Updates

The shared update UI coordinates this native app, its current server and that
server's connected native apps through the existing update bridge. Its small
batch record lives in browser storage, scoped to the server installation and
viewer; it is not a server-side queue. It checks media tools first, confirms each
connected app's running version before restarting the server, and restarts this
app last. Reload resumes observation of an accepted install rather than resending
it. A failed step stops later restarts; pending intent expires after 30 minutes.
The native owner and remote API recheck playback before manual installation unless
the user explicitly chose to interrupt it; live publishers count even without
receivers. The TV's overnight update policy stays.

Every paired viewer can read cached GitHub release history; update and helper
maintenance endpoints remain administrator-only. History is fetched on demand and
separate from installer availability, so a notes failure cannot block an update.

## Helpers

Core runs three helpers: yt-dlp, QuickJS-NG (yt-dlp's JavaScript runtime for
YouTube's challenges) and ffmpeg (`src/server/helpers.ts`). Mac packages ship
QuickJS-NG 0.17.0, built from pinned upstream source for their actual CPU and
macOS 13 rather than using upstream's macOS-26-only binaries
([build and signing](ci.md#bundled-mac-javascript-runtime)). Main passes its
path as `COUCH_QJS_PATH`; compatible system copies still take precedence.
Otherwise Core selects this bundled copy ahead of downloaded copies, including
during manual checks. It updates only with Couch and a broken bundle reports
a reinstall rather than downloading an incompatible runtime.
The AirPlay receiver is not one of them: Linux packages
ship its pinned UxPlay build, like the live relay, and nothing updates it apart
from Couch ([Receive AirPlay](airplay.md)).

- Core uses the copy on `PATH` when it is recent enough: yt-dlp at its latest
  release, QuickJS-NG 0.12 or later, ffmpeg 7 or later.
  If yt-dlp's release check fails, it uses the newer runnable copy from `PATH`
  or its own cache, preferring `PATH` when the versions match.
- Otherwise it downloads the official build into `<data>/helpers/<name>/<version>`,
  checks the SHA-256 and runs it before switching to it:
  - yt-dlp's own `yt-dlp_macos.zip`, `yt-dlp_linux*.zip` or `yt-dlp_win*.zip`.
    These unpacked builds start in a fraction of a second; the one-file builds
    unpack themselves on every run.
  - QuickJS-NG's `qjs-*` release binary, except when using the bundled Mac copy.
    A source/development Mac on an older OS needs a compatible system copy or
    `COUCH_QJS_PATH` pointing at the [local build](ci.md#bundled-mac-javascript-runtime).
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
- An administrator's manual update also refreshes managed QuickJS-NG and ffmpeg
  builds, and mpv where already installed or needed. Compatible system copies stay
  under their package manager, bundled QuickJS stays with Couch, and a held
  yt-dlp stays held. Checks share the
  existing per-helper queues, retain copies in use and report a failed lookup or
  download even when a working fallback remains. Status reads alone do no work.
- Core records what it actually selected in `<data>/helpers/status.json`
  (`HelperStatus` in `src/server/helper-status.ts`, `schema: 1`): per helper its
  origin (`system`, `managed` or `bundled`), version, path, the SHA-256 it verified when it
  downloaded that copy, when the check last ran it and the latest yt-dlp release
  that check saw. Under `managed`, each copy on disk has its digest and, for
  yt-dlp, `worked`: the last time Couch resolved playable media with that copy,
  per provider. Listing a site, reading a page's details or printing its
  version doesn't count.
  Reading the file never checks, downloads or selects a helper. Entries of the
  wrong shape are dropped when it is read, so a damaged file never stops selection.
- Couch writes `status.json` and `hold.json` to a temporary file, flushes it,
  renames it into place and flushes the directory; removing the hold flushes
  the directory too. On Linux, with storage that honours flushes, a power cut
  after a write returns keeps it. macOS `fsync` can leave it in the drive's
  cache (Node has no `F_FULLFSYNC`), and Windows can't flush a directory, so
  there the rename relies on NTFS's journal.
  Either way a reader sees the old file or the new one, never part of one.
- Couch keeps one previous yt-dlp copy beside the selected one, also while it
  uses the copy on `PATH`: the newest that has worked, else the newest, never a
  copy of the selected version. A copy a run is using when a check decides what
  to keep stays until the next check; playback records that its copy worked
  once Couch has accepted its media, before letting go of it, so that check
  sees it. Core
  renames a copy to `<version>.removing` before removing it and puts it back if
  it is held or pinned by then, or, after Core stopped in between, at its next
  check. `--helpers previous` pins the copy in `<data>/helpers/pins` before its
  last look at it and until its hold is written, and Core reads pins before the
  hold, so a hold it reports names a copy that is still there; it writes nothing unless the copy passes, so it
  never undoes another command. A pin a stopped command left lapses after ten
  minutes. Commands aren't serialized: Core uses whatever the last write to
  `hold.json` left. Each command reports its own change as it last saw it,
  and fails if it already sees another command's; a command overlapping after
  that look can still replace the reported outcome, and `--helpers status`
  shows the hold as it is when read. A website failing,
  even with a 403, never changes the selection: an update can break one site
  while others work.
- When an update breaks a website, recover from the account Couch runs as, with
  its `COUCH_DATA_DIR`: `node build/core.mjs --helpers previous [days]` (the
  installed app: `ELECTRON_RUN_AS_NODE=1 <Couch executable> <resources>/app.asar/build/core.mjs`)
  holds the previous copy that still runs for 1–30 days, 7 by default, in
  `<data>/helpers/hold.json`. Core uses it from its next yt-dlp run, across
  restarts, without checking for releases, then returns to the latest;
  `--helpers latest` returns sooner and `--helpers status` prints the record and
  the hold. Run during a hold, `previous` renews it, with the held copy while it
  still runs, even before Core has applied the hold or once an older copy has
  worked since. A held copy that has gone missing is replaced by the latest as usual.
  Couch never changes a system yt-dlp; its package manager does.
- SoundCloud runs use yt-dlp's cache at `<data>/yt-dlp-cache`, so the extractor
  retains its public client ID between searches and playback. yt-dlp refreshes
  that ID on HTTP 401/403. This does not cache signed audio URLs or account
  credentials. Other sites keep the extractor cache disabled.

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
