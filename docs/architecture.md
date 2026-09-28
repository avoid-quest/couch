# Current architecture

Couch has one TV playback instance and multiple independent browser remotes.
Core, the Node coordinator, owns the household queue, playback intent, authorization and
persistent state. Tauri owns the native window and libmpv transport; native
observations return to the coordinator. A remote never resolves private playback
URLs or becomes another playback authority.

The desktop app includes playback. **This computer** runs the local host and
player; **Another Couch** controls a selected host in the same bundled app window
while the local player and coordinator stay stopped. Browser remotes remain
controllers; Desktop/TV presentation and Controller/Administrator roles are
separate choices.

Sources are external internet media only: yt-dlp sites (YouTube, Twitch,
RaiPlay, Bandcamp and others), StreamingCommunity, radio and IPTV playlists.
Couch serves no local files. The rebuild plan is
[#644](https://github.com/avoid-quest/couch/issues/644).

## Frontend delivery

```
src/client -- Vite (one transform / route / worker build) --> dist
                                                           |-- Tauri frontendDist
                                                           `-- Core serves it from disk
src/main.ts -- Bun.build --target=node --> build/core.mjs (one ESM file, run by Node 24)
```

`bun run build` writes the build identity, runs Vite once, and bundles Core with
its dependencies into `build/core.mjs`. Core reads `dist` beside it at startup and
serves the known page paths and emitted files; `/api` routes, authentication,
unknown requests and WebSockets stay with the coordinator handlers. Tauri still
packages `dist` directly.

Both delivery paths use root-relative URLs. Only browser remotes in a supported
secure context register `/sw.js` with root scope. Tauri never registers it.
The worker precaches the shell, not API data, and its navigation fallback is
restricted to the coordinator's known frontend paths. The loaded build identity
is still checked before opening the control WebSocket.

## Development

`bun run desktop` uses Tauri's `beforeDevCommand`, `devUrl`, and source watcher
for native development. `bun run dev` is the separate browser-only loop: it
rebuilds Core on every source change, runs it under `node --watch`, and starts
Vite. Vite runs on port
1420 with an API proxy to the coordinator on port 4100 (`COUCH_PORT`).
[scripts/build.ts](../scripts/build.ts) describes current delivery.
