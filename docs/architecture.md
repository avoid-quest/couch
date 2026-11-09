# Architecture

Couch is one Electron app. **Core** (`src/server`, Node) owns the Playbacks,
authorization and persistent state (`couch.sqlite`). The client (`src/client`,
React) is the same UI on the TV, the desktop window and phone browsers. A remote
never resolves private playback URLs or becomes another playback authority.

## Modes

Chosen on first run or in **Settings → This device** (`operating-mode.json`):

- **Full** (`"local"`): Main starts Core in an Electron `utilityProcess` and the
  window loads Core's UI from `http://localhost:<port>`.
- **Client** (`"remote"`): Core stays stopped and the window loads the other
  Couch's own UI, so both run the same build. It pairs like any browser and pins
  that Couch's certificate key (`pins`), so it shows no warning.

Main and Core talk over the parent port (`ready`, `addresses`, `display`,
`renamed`, `shutdown`, `tvMode`). The preload (`app/preload.ts`) exposes
`window.couchApp`: the mode choice, `deviceName`, the host token (Full mode,
localhost page only), the interface size and TV presentation.

## Devices, pairing and rights

- A Device has one name for every Couch it joins. The app's name is the
  `installation` name in `couch.sqlite`, written by Main (`app/device-name.ts`)
  whether or not Core runs; a browser keeps its own in storage.
- A TV pairs without typing (`src/server/tv-pairing.ts`): it asks
  `POST /api/pair/tv`, the host or an admin approves its code, and the TV polls
  for its token. A device that's already paired can't ask.
- Settings that change the Couch for everyone accept the host or an admin, and
  writes recheck the role after reading the body. When a device turns off the
  sharing or HTTP its own request uses, Core replies first (`afterResponse` in
  `src/server/http.ts`).
- A client Device opts in separately to sharing its screen and its speakers;
  both start off. The choice belongs to the device (`<data>/device-sharing.json`
  in the app, origin storage in a browser), and Core accepts changes only from
  that device's own connection. Core rechecks consent after resolving a source
  and before an mpv fallback. Sharing never grants update or restart rights.

## LAN and certificates

The LAN reaches Core over HTTPS with a self-signed certificate (`<data>/tls`),
so browsers get a secure context for WebCodecs and Wake Lock. Browsers don't
register a service worker over a self-signed certificate.
Plain HTTP on the same port serves only this machine; the LAN is redirected to
HTTPS. Reissued certificates keep their key so client pins survive. An HTTPS page
can't load `http://` media, so Pass-through relays those streams. See
[LAN address](lan-origin.md).

## Playbacks

Many Playbacks run at once (`src/server/session.ts`, one session each). A
Playback is a queue, current item, position, pause, speed and tracks, plus its
outputs: each Device's `Output { picture, sound }`. A Device's outputs serve one
Playback at a time.

- Each controller looks at the Playback its selected Device serves. Core keeps
  that choice in memory; a restart restores queues without outputs.
- **Play on** a Device isolates that Device; ordinary Play keeps the current mix.
  Move here (`solo`) is refused, changing nothing, while another device's private
  output would stay behind.
- A Device owns one volume and mute (`devices` table). The Playback's
  **Volume** scales the sounding devices the actor may control, so the loudest
  reaches the chosen level. On the Linux TV, volume and mute are the system's.
- A Playback ends when its queue does. After Stop it keeps the queue for 10 s for
  Undo. Up next is saved in the `playback` table.
- Core decides delivery and programme authority
  ([ADR 0002](adr/0002-playback-delivery-and-authority.md)).

## Rendering

Every Device renders the same way (`src/client/session/renderer.ts`). Core sends
`{ type: "player", command }` over the Device's WebSocket and listens only to the
tab it chose (the newest one). The Device fetches the source itself:

- URLs play in `<video>`; YouTube's separate audio plays in an `<audio>` that
  follows it. Couch-hosted HLS uses hls.js (native HLS as fallback); direct
  cross-origin HLS prefers native, because provider segments may not allow CORS.
  Raw MPEG-TS uses mpegts.js. The app preloads hls.js while idle.
- VP9-capable Devices prefer VP9 and Opus; others need H.264 and AAC. YouTube
  quality caps the smaller dimension, so portrait Shorts work.
- In the app, Main caps googlevideo's open-ended `Range` requests at 10 MB,
  because YouTube sends those at about playback speed.
- A browser that needs a gesture plays muted and shows "Tap to hear".

**Pass-through** (`src/server/pass-through.ts`): at Play, Core tries each stream
with the Device's Origin and User-Agent and relays only what fails there but
works for Core (Twitch answers 403 to a browser on a LAN origin). HLS playlists
are rewritten so nested playlists go through Core; nothing is transcoded. Relay
addresses are signed for one Playback.

**mpv** (`src/server/mpv.ts`): IPTV channels with codecs Chromium can't decode
(MPEG-2, AC-3, E-AC-3, MP2) play in mpv on the Core machine. mpv comes from
`PATH`, or from mpv's GitHub releases on macOS and Windows; Intel macOS 13–14 need
a compatible copy on `PATH`, because the official build needs macOS 15.

## Synced sound (Sendspin)

When a Playback has sound on several Devices, Live audio, Audio input or
AirPlay, its sound is **Synced** (`src/server/sendspin.ts`,
`src/server/scheduled-audio.ts`). Core serves `/sendspin` with the unmodified
Sendspin Node SDK behind Couch token authorization, and the client plays it with
the official player (`@sendspin/sendspin-js`).

- For ordinary media, one FFmpeg per Playback decodes the audio once and encodes
  once per wire format: Opus in 60 ms packets, or 100 ms PCM chunks for players
  without Opus (Firefox). Captured sources (Live, audio inputs, AirPlay) have one
  encoder per source with 5 ms frames ([Live audio](live-audio.md)). Every speaker gets the same timestamped chunk and applies its own
  volume and delay.
- Pause, seek and speed restart FFmpeg where the Playback is.
- Screens showing a synced picture fetch the video themselves, play it muted and
  follow Sendspin's clock (`src/client/session/picture-clock.ts`): small drift by
  playback rate, a large one by one seek into buffered picture. A picture with no
  data where the sound is waits a little ahead for the clock instead of chasing it.
- For an endless URL stream (Twitch or YouTube live, Live TV; Live audio captures
  are separate, see [Live audio](live-audio.md)) the position is the source's own
  timestamp (`-copyts`, mapped by hls.js per discontinuity), so a screen that joins
  anywhere lines up. FFmpeg starts where hls.js starts a picture (`HOLD-BACK`, else
  three target durations from the end), which gives it that much audio in hand. A
  gap of up to three minutes, such as a Twitch ad FFmpeg drops, plays as silence and
  the clock runs on; audio that arrives after its time is dropped.
- Web media on HLS, except YouTube's checked formats, plays its master: each Device
  adapts to its link, capped at the chosen quality, and Core decodes an audio-only
  rendition when there is one.
- Clock agreement doesn't measure physical alignment: test real speakers and use
  the per-device delay where hardware adds latency.
- Shutdown waits for the audio worker and its encoders, with a three-second
  graceful budget.

See [Live audio](live-audio.md).

## Shared screens and inputs

Live publications belong to the publishing Device's session and end with it;
AirPlay sources belong to Core and end when the sender leaves.
Direct playback attaches a WebRTC MediaStream to the receiver's video element;
Core only relays signaling between the exact two connections, and ICE servers
(including TURN) go only to paired devices. Only In sync, or for a receiver that
couldn't connect directly, does Core ask the publisher for a MediaRecorder upload
and turn it into rolling HLS with FFmpeg (`src/server/live-stream.ts`)
([ADR 0001](adr/0001-live-inputs-play-over-webrtc-unless-in-sync.md)).

For Live audio, Main owns capture outside the window's event loop: native Mac
inputs use the bundled PortAudio helper, browser inputs a hidden capture page.
Screen and window capture take resolution and 30/60/120 FPS targets
(`defaultLiveFrameRate`, `src/shared/live-input.ts`). See
[Share a live device](live-inputs.md).

On Linux, an admin can turn on an AirPlay receiver ([Receive AirPlay](airplay.md)).

## Helpers

Core manages yt-dlp, QuickJS-NG and FFmpeg (`src/server/helpers.ts`):

- It uses the copy on `PATH` when it's recent enough (yt-dlp at its latest
  release, QuickJS-NG 0.12+, FFmpeg 7+), otherwise downloads the official build
  to `<data>/helpers/<name>/<version>`, checks its SHA-256 and runs it before
  switching. FFmpeg comes from Martin Riedl (macOS, Linux) and BtbN (Windows).
- Martin Riedl's FFmpeg carries its own OpenSSL, so Core sets `SSL_CERT_FILE` to
  the system's certificates for helpers; without it every `https` read fails.
- yt-dlp prefers Core's Node runtime for YouTube's JavaScript challenges
  (`COUCH_NODE_PATH`, with `ELECTRON_RUN_AS_NODE=1`), with QuickJS-NG as fallback.
  Mac packages ship QuickJS-NG built for macOS 13, because upstream's binaries
  need macOS 26 ([ci.md](ci.md#bundled-helpers)).
- Core checks helpers at start and daily, and records what it selected in
  `<data>/helpers/status.json`. It keeps one previous yt-dlp copy.
- When a yt-dlp update breaks a site, hold the previous copy for 1–30 days:
  `node build/core.mjs --helpers previous [days]` (installed app:
  `ELECTRON_RUN_AS_NODE=1 <Couch executable> <resources>/app.asar/build/core.mjs`).
  `--helpers latest` ends the hold; `--helpers status` prints it.

## Updates

The update UI coordinates this app, its server and that server's connected
apps through the update bridge. Its batch record lives in browser storage, not
on the server. It updates media tools first, confirms each connected app's
version before restarting the server, and restarts this app last. Manual
installs recheck playback first unless the user chose to interrupt it.

## Logs

Core prints one line per event with an ISO timestamp; the app keeps them in
`<data>/logs/couch.log` with Main's own failures. Each run starts afresh and
keeps the previous run as `couch.1.log`; a run past 5 MB rotates to
`couch.log.1`. Sources appear only by host, because URLs can carry tokens.

## Browser remote

Phones and laptops use Couch as a PWA (`vite-plugin-pwa`; navigation fallback
covers only frontend routes). `src/client/register-sw.ts` registers `/sw.js` only
in production browsers with a secure context, never in the app window. Nothing
keeps a backgrounded page alive, so the client relies on reconnecting. **Keep
screen awake** holds a Screen Wake Lock while this device plays.

## Build

```
src/client     -- Vite -->               dist              (served by Core)
src/main.ts    -- Bun.build node -->     build/core.mjs    (Core)
app/main.ts    -- Bun.build -->          build/main.mjs    (Electron main)
app/preload.ts -- Bun.build -->          build/preload.cjs (sandboxed preload)
```

electron-builder packages only those files, `dist` and the icons (`build` in
`package.json`); the app ships no `node_modules`. `bun run dev` runs Core under
`node --watch` and Vite on port 1420, proxying the API to Core on 4100.
