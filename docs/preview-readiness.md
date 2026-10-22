# Preview review, 22 October 2026

Scope: the five latest published previews (`v0.3.1-preview.7` through `.11`)
and unreleased main at `b28db6d`. The comparison starts at
`v0.3.1-preview.6` (`3bdd95b`), so it includes everything shipped in `.7`:
421 changed files, 23,698 additions and 4,529 deletions. Earlier code was
included when a journey exposed a problem. This audits the combined source
at the endpoint, not five separately installed preview binaries.

GPT-6.1-Sol with xhigh reasoning ran functional, focus, rendering and provider
journeys. GPT-6-Astra with high reasoning reviewed platform behavior and the
fixes. Features, page layout, styling, pagination and media controls are
preserved. The only interaction changes repair focus and native text editing.
No merge or release was performed.

## Measured improvements

- Artwork: twelve concurrent cold readers of one 256 KiB image previously
  fetched 3 MiB across twelve downloads. They now share one 256 KiB download:
  91.7% less upstream traffic in this workload. Independent cancellation,
  abandoned downloads, retry cleanup and the ten-second upstream timeout were
  checked. This is a request/traffic result, not a whole-app speedup.
- Search departure: leaving Search while Saved loads previously cleared the
  outgoing query and launched ten blank catalogue reads. It now retains the
  query/filter and makes zero extra source reads.
- Collection rendering: desktop repeated runs improved from 47–47.5 fps with eight
  long tasks per four seconds to 59.5–59.75 fps with zero long tasks. A
  390×844 viewport improved from 51.25 fps to 58.75–59.75 fps, again with zero
  long tasks. Paired eight-second renderer CPU sampling fell from 37.75% to
  29.12% of one core (22.9% relative reduction). DOM size remained 509
  elements, with 24 visible items plus the header navigation row; the glass
  effect remained `blur(28px) saturate(1.5) brightness(0.5)`.

Rendering uses a minified production fixture in Chromium 154 on Linux with
software compositing. It has real routes, components and styles, deterministic
API data and no media decoding. The workload is 1,000 collection items, the
unchanged 24 visible items, scrolling and two equivalent full session snapshots
per second. This is a controlled replay, not a claim about ordinary Core update
frequency. CPU figures are percentages of one core. Phone-sized checks use
Chromium CSS viewports, not physical phones. The previously reported high idle
glass CPU was not reproduced, and no visual effects were removed.

## Fixed journey failures

- Back restores the exact page/bar link when both have the same destination.
- Home radio Play transfers lost focus to the playing title.
- Stop returns focus from a disappearing now-playing bar to the same page.
  Deliberate focus moves and destination navigation take precedence.
- Modified arrows retain native caret and selection behavior in Search.
- AnimeUnity Open in browser maps former `.so` links to the current `.to`
  site while preserving canonical saved identities. AnimeSaturn accepts the
  progressive MP4 format published by its HD player without downloading the
  media as text. The source layer passes 61 integration tests and four
  original-page unit tests, including both new regressions. A fresh guarded
  yt-dlp resolution of Suikoden Episode 1 also returns MP4 successfully
  (5.4 seconds including scratch helper installation; not playback latency).

The focus regressions pass twelve cases in both desktop and TV modes; the
existing TV suite passes fourteen, and thirteen original reproduction loops
pass. Desktop interaction checks pass eight cases, including all four arrow
keys with Shift/Ctrl/Meta/Alt. Search-field checks cover IME, submitted versus
draft searches, scope, recents, Back/Forward and native modified-arrow handling.

## Validation coverage

Pinned Bun 1.4.2, Node 24.21.0 and Electron 44.4.5 were used. Each scratch Core
had its own data directory and port; owned processes were stopped by PID. The
installed Couch and its data were untouched.

- All 64 unit files passed in separate Bun processes. A combined invocation
  shares module mocks and is not the reliable command for this suite.
- The initial 16 Core integration suites passed 110 tests: queue/Undo,
  controls, output movement/volume/consent, reconnect/revocation, device
  identity, history URL handling, cache sharing and update authority.
- The expanded provider/helper/playback review passed 154 tests across the
  passing cases in 14 suites. Eight historical failures belonged to the shutdown
  harness: it replaced global fetch while production uses guarded Node HTTP.
  An explicit in-process request dependency repairs the same nine cases; the
  final checkout passes all nine with zero external requests. A separate
  strictly offline baseline failed all nine and blocked 27 request attempts.
  This repairs test coverage, not a newly confirmed production shutdown bug.
  Three mutations prove the suite catches missing shutdown cancellation,
  shared pending work across Core lifetimes and missing post-body checks.
  Real fixture executables cover helper rollback; the actual pinned yt-dlp runs the SoundCloud plugin check.
- Five platform suites passed 66 tests with three explicit AirPlay native
  skips. All 53 TV setup, health, session and diagnosis tests passed. Linux
  procfs and fixture-root namespace/permission behavior were exercised.
- Sendspin ahead integration passed both cases with actual managed FFmpeg:
  Opus lead 8.0 s and late-speaker response 47 ms; PCM lead 2.5 s and 69 ms.
  These local tests do not qualify Android locked-screen behavior.
- Native Linux/Xvfb journeys passed editing/copy/paste/undo, history, Quit,
  close-to-tray, readiness and updater shutdown in ready/pending staging.
  The macOS installer boundary is simulated, not a real Squirrel install.
- Desktop/phone routes cover Home, Saved tabs/lists, Radio, Live TV, Search,
  Details, provider collections, Remote and Settings. Loading/empty/error,
  retry, save/disconnect/reconnect, filtering, output and player transitions
  passed. The production route layouts had no horizontal overflow in the
  checked viewports.
- Real Core browser journeys cover first-queue confirmation with delayed
  snapshots, toast expiry and replacement, Up next and remote Stop/Undo. The
  test waits for the new playback's rendered state after command acknowledgement;
  those events need not arrive together.
- A real Core TV journey played local finite video, hid controls while idle,
  revealed them on remote OK without pausing, retained deliberate focus,
  navigated timeline/transport/Volume/Playback/Up next and advanced the queue.
- Production renderer checks decoded local MP4 and HLS, paused and changed position,
  retained a real HTTP 503 media error, recovered on a valid load, and preserved
  playback identity/tracks through a controlled network stall and resume.
- The actual yt-dlp metadata pipeline reduced an oversized caption fixture
  from 11,001,375 to 1,303 output bytes while retaining requested subtitles.
  This validates the existing output-limit fix offline, not live YouTube extraction.

Live provider observations verified AnimeUnity catalogue/search/episodes/HLS,
AnimeSaturn catalogue/search/HLS and its MP4-format failure, plus SoundCloud
search/More/details/fresh audio resolution. Warm catalogue/search requests took
1 ms in these individual runs. Those are source/cache observations, not new
release-to-release gains or audible playback latency measurements.

## Review axes

**Standards:** no confirmed breach of documented repository standards in the
assigned areas. The large provider summary effect was noted as a possible
divergent-change heuristic; the measured fix stabilizes its inputs without a
broad refactor. Platform review consulted t3code's menu, window, lifecycle and
native-resource patterns before assessing Couch's corresponding changes.

**Spec:** confirmed focus, search, artwork and source-compatibility failures are
addressed by the stack. Two pre-existing documentation discrepancies were
recorded: For later can repeat the hero's media, and bar Up next opens the
player queue rather than a panel above the bar. Current UI behavior is retained.
Independent artwork/search, focus and collection reviews found no actionable
Standards or Spec issues. Focus review passed 60 focused checks. Collection
implementation passed 57 new browser assertions, 110 existing journey checks
and 14 production checks; independent review repeated correctness and freshness
journeys. Final source/shutdown reviews ran on separate axes: Standards passed
74 tests with zero findings; Spec passed 78 local checks and both production
and shutdown-test typechecks with zero findings. The integration guards recorded
zero external requests in both final reviews. Final pinned typecheck and
production build passed, as did a fresh build and run of the portable benchmark.

## Reproduce

```sh
./node_modules/.bin/bun --version # 1.4.2
./node_modules/.bin/bun run typecheck
./node_modules/.bin/bun run build
./node_modules/.bin/bun test tests/artwork-route.test.ts
./node_modules/.bin/bun test tests/original-page.test.ts
./node_modules/.bin/bun build tests/<name>.integration.ts --target=node --outfile=build/<name>.integration.mjs
# Run from an isolated scratch CWD, with its own COUCH_DATA_DIR/COUCH_PORT:
node --test /absolute/path/to/build/<name>.integration.mjs
```

Browser regression modules document their exported entry points and fixture
requirements. Import them into an empty Vite page with `#fixture`, the app CSS
and Vite's React refresh preamble, then call the exported function. Any returned
`passed:false` is a failure even if the function itself resolves. Run TV variants
with `?tv=1`, desktop with `?tv=0`, and use isolated scratch data/ports.
The [production benchmark](../tests/collection-benchmark/README.md) records
the fixture preparation, build, browser assertions and optional CPU sampler.
[Machine-readable evidence](preview-readiness-evidence.json) retains the
baseline, workload and repeated measurements.

## Remaining release qualification

- Physical TV GPU/remote/HDMI/standby and Linux sound-server behavior.
- Android locked-screen audio and real multi-device audible synchronization.
- Real UxPlay/GStreamer and Apple sender discovery/password/reconnect/latency;
  three native AirPlay cases were explicitly skipped here.
- macOS/Windows gestures, native installer/update/relaunch and packaged binaries.
- An early-OK TV startup variant was inconclusive: its first picture-focus sample
  failed without capturing the focused element; later picture focus and hidden
  controls were correct. The complete normal TV journey passed.

No new packaging/workflow code was changed. No fresh installer, act Package run,
signed bundle or release is claimed. Manual Check workflows validate the PR
branches; final run links are in the PRs. These limits should remain explicit
when deciding whether to publish a preview.
