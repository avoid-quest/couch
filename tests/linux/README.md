# Linux qualification

Run `bun run test:linux` with Docker available. The launcher requires a clean
commit, creates a Git bundle, and checks that exact revision out in a disposable
Ubuntu 24.04 container. It keeps Bun, Cargo, and build caches in named volumes;
application data and artifacts are disposable.

The default journey first runs `bun run check`, compiles the debug Tauri app and
sidecar, runs the locked Rust coverage, then starts the compiled-browser remote
journey. It next runs `playback.ts`, the current focused native journey. That
journey covers first-use sharing and pairing, browser controls, simulated
remote-side state, native libmpv playback, subtitles, focus and reconnect,
Stop, local-page yt-dlp intake, and DASH quality selection. It does not run the
retired Radio, Guide, old Library, or monolithic restart journey.

`bun run test:linux --built-remote` runs only the shared checks, production
build, and `built-remote.ts`. Its browser talks to the compiled sidecar and
checks exact Vite bytes, pairing, deep-link refresh, browser Play and Stop, and
worker registration on loopback. Its native pipe peer is simulated. It is not
libmpv, physical-display, or hardware-audio proof.

`bun run test:linux --connection` runs the same shared and built-browser checks,
then `connection-journey.ts`. It starts a configured TV with disposable data
and exercises Connection deep links while identity loads, ordinary-controller
restrictions, UI promotion and demotion, revocation and visible pairing-required
state, a fresh replacement credential, refresh-based reconnect, and a real
browser recovery claim after restarting the native app. The first paired browser
is intentionally the administrator; the focused
`src/client/session/connection-lifetime.test.tsx` suite separately proves query
cache retirement, stale-read cancellation, role/revocation transitions, and
same-address installation replacement. It is client-state proof, not a second
native installation at the same address.

The tests use Tauri WebDriver and WebKit WebDriver under Xvfb, Openbox, software
rendering, and a PulseAudio null sink. They use no production test endpoint.
Artifacts go to `.artifacts/linux/`; screenshots hide temporary pairing and
claim codes. This environment does not qualify a physical display, HDMI audio,
Wi-Fi, installed package, recovery over SSH, hardware decoding, HDR, CEC, or
real appliance restart behavior. Public-provider checks stay opt-in:

```sh
bun run test:linux --providers tests/linux/providers.example.json
bun run test:linux --provider-catalogs
```

Those checks depend on external services and are recorded separately from the
deterministic local journeys.
