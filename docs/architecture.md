# Current architecture

Couch has one TV playback instance and multiple independent browser remotes.
The Bun coordinator owns the household queue, playback intent, authorization and
persistent state. Tauri owns the native window and libmpv transport; native
observations return to the coordinator. A remote never resolves private playback
URLs or becomes another playback authority.

## Frontend delivery

```
src/client -- Vite (one transform / route / worker build) --> dist
                                                           |-- Tauri frontendDist
                                                           `-- Bun file imports --> compiled sidecar
```

`bun run build` writes the build identity, runs Vite once, and replaces
`src/frontend.ts` during the sidecar build with exact-byte file imports of `dist`.
Bun does not process the generated HTML, JavaScript or CSS again. The executable
contains all emitted assets, the manifest and worker; it does not read a mutable
`dist` directory after installation. The hub serves the known page paths and
explicit assets, leaving authentication, unknown requests and WebSockets with
the existing coordinator handlers. Tauri still packages `dist` directly.

Both delivery paths use root-relative URLs. Only browser remotes in a supported
secure context register `/sw.js` with root scope. Tauri never registers it.
The worker precaches the shell, not API data, and its navigation fallback is
restricted to the coordinator's known frontend paths. The loaded build identity
is still checked before opening the control WebSocket.

## Development and qualification

`bun run desktop` uses Tauri's `beforeDevCommand`, `devUrl`, and source watcher
for native development. `bun run dev` is the separate browser-only loop: it
starts the source-mode Bun coordinator and Vite together. Vite runs on port
1420 with an API proxy to the coordinator on port 4100; Client-only remotes use
Bun's hosted UI. Neither development loop proves that the production remote works.

After committing and building, run `bun tests/linux/built-remote.ts` inside the
existing Linux test environment with WebKitWebDriver, X11/Openbox, xdotool and
the configured null PulseAudio sink. It reuses `tests/linux/ui.ts`, checks every
served byte against `dist`, opens a deep link, pairs, navigates, and verifies
browser Play/Stop through the coordinator's private native pipe. It also checks
worker activation on loopback, a supported secure context. This journey uses a
simulated native peer, not libmpv or physical hardware. It writes the exact build
identity, asset hashes, checks and a screenshot to `.artifacts/built-remote`.
`COUCH_SIDECAR`, `COUCH_FRONTEND_DIST` and `COUCH_ARTIFACTS` can select the already
built paths. Run `bun run test:linux` for the existing actual Tauri/libmpv journey.

The dated [architecture research](research/architecture.md) records alternatives
and earlier delivery proposals, including the former Bun-only frontend build.
It is historical evidence, not the current build contract; this map and
[scripts/build.ts](../scripts/build.ts) describe current delivery.
