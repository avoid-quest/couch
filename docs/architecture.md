# Current architecture

Couch is one Electron app. Core, the Node coordinator, owns the household queue,
playback intent, authorization and persistent state. A remote never resolves
private playback URLs or becomes another playback authority.

The app runs in one of two modes, chosen on first run and in the **Playing here**
popover:

- **Full** (`operating-mode.json` `"local"`): Main starts Core in an Electron
  [`utilityProcess`](https://www.electronjs.org/docs/latest/api/utility-process)
  and the window loads Core's own UI from `http://localhost:<port>`.
- **Client** (`"remote"`): Core stays stopped, so no hidden Couch plays. The window
  loads the other Couch's own UI, so both always run the same build. That page
  pairs like any browser.

Main and Core talk over the utilityProcess parent port (`ready`, `addresses`,
`display` and `shutdown`). The window's preload (`app/preload.ts`) exposes
`window.couchApp`: the mode choice, the host token for this computer's Core (Full
mode, localhost page only), the desktop interface size and TV presentation. The
window sets `autoplayPolicy: "no-user-gesture-required"` and
`backgroundThrottling: false`.

No renderer plays yet: libmpv left with Tauri and the app window becomes an
ordinary renderer in #644 ticket 6.

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
    [BtbN](https://github.com/BtbN/FFmpeg-Builds) on Windows.

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
