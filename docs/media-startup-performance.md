# External media startup

Measured on 29 October 2026 against main `73668e36`, separately from the Live
frame-rate PR. This pass targets pressing Play on external media. It does not
measure application launch or claim sustained Live performance.

## Changes

- Resolved website media always goes through Core's protected relay. Preparing
  Core and Device routes no longer issues and discards CORS probes that cannot
  change that decision. Split video/audio previously made four such requests,
  in two sequential rounds. The selected extractor protocol supplies the HLS
  hint, including extensionless playlists and audio-only HLS. Actual media reads
  retain public-address checks, credential scoping, signed capabilities, playlist
  rewriting, MIME/prefix checks, cancellation and HTTP failure reporting.
- yt-dlp can use Core's existing Node/V8 runtime for YouTube's JavaScript checks,
  with QuickJS still configured as fallback. Desktop Main supplies its executable
  through `COUCH_NODE_PATH`; extractor children use `ELECTRON_RUN_AS_NODE=1`.
  yt-dlp's own Node provider runs with `--permission`. No new runtime download,
  custom challenge solver, codec change or quality reduction is involved.

YouTube's `--check-formats` remains enabled. Faster JavaScript does not establish
that a newly issued media URL is downloadable. The selected formats still have
to pass the check that prevented immediate 403s in the existing playback work.

## Controlled time to first frame

The production renderer and relay play generated 1280×720 H.264/AAC media in
Electron 45.1.0 / Chromium 156.0.8078.49 on Linux/Xvfb, Xeon E5-2690 v3. Each
upstream request has a controlled 200 ms response delay. Browser HTTP caches are
cleared between samples; the same files and quality are used before and after.
The HLS URL has no extension. Three samples per workload, with order reversed
on alternating rounds; medians below. Provider extraction is excluded here.

| Workload | Before first frame | After first frame | Improvement |
| --- | ---: | ---: | ---: |
| Combined MP4 | 659 ms | 269 ms | 59% |
| Separate video and audio | 654 ms | 252 ms | 61% |
| HLS | 954 ms | 541 ms | 43% |

Route preparation fell from about 401 ms to under 1 ms. Discarded upstream
requests fell from two per combined/HLS load, or four per split load, to zero.
All 18 samples retained 1280×720, reported no dropped frames, advanced playback,
and completed a seek. Split samples also required the separate audio element
to be ready, playing and advancing. This is not a physical A/V sync test.

The gain depends on network latency: the test isolates two removed network
round trips, not a universal 400 ms saving or a bandwidth/decoder improvement.

## Actual providers

Anonymous public sources: YouTube `YE7VzlLtp-4` and StreamingCommunity
`/it/watch/66337`, using the normal current-origin discovery. yt-dlp 2026.10.26,
QuickJS-NG 0.17.0; helpers were installed before timing. No cookies, fixed
YouTube player client, source cache or reduced quality. Source URLs, proxy
credentials and extracted tokens are omitted from evidence.

Three baseline runs found median YouTube resolution of **11.76 s** and
StreamingCommunity resolution of **1.62 s**. StreamingCommunity's first
current-address check added about 525 ms; later checks used its existing cache.
Before this change, preparation added a median **177 ms** for YouTube and
**279 ms** for StreamingCommunity. The protected first reads succeeded (206
for YouTube, 200 for StreamingCommunity's master).

An alternating runtime experiment held extraction settings constant and changed
only yt-dlp's JavaScript runtime, three runs each:

| YouTube stage | QuickJS-NG | Bundled Electron as Node |
| --- | ---: | ---: |
| JavaScript solver interval | 8.37 s | 1.31 s |
| Complete extraction, including downloadability checks | 11.51 s | 9.37 s |

The complete-extraction improvement is **19%**, about **2.1 seconds** on this
machine. The solver interval ends at the next manifest-download message; it is
an instrumented subprocess interval, not an isolated CPU benchmark. With Node,
the selected video downloadability check often consumed another 4–5 seconds.
That wait explains why a seven-second solver improvement does not translate
into seven seconds saved before playback.

A separate final-production run exercises both selected YouTube video and audio
through the relay, and StreamingCommunity's master. Results are in the artifact
paths below. Network measurements on these individual sources are observations,
not a provider-wide latency guarantee. Real macOS and Windows packaged startup
still need qualification; QuickJS fallback remains available.

An additional real-renderer smoke test included extraction, actual media downloads,
first-frame presentation, advancing sound and seeking. One matched 1080p YouTube
pair was **12.17 s → 9.95 s**. A second changed-path YouTube run selected 720p
after upstream availability checks, so its 8.93 s result is excluded from equal-
quality comparisons. All 12 selections in the alternating system/Electron Node
runtime experiments above retained video format `248-sr` and audio `258`.
StreamingCommunity stayed at 1280×545: the first pair was **3.41 s → 2.44 s**,
including origin discovery on the first baseline load; the warm pair was
**2.59 s → 2.62 s**, within observed network variation. All eight renderer
smoke samples played, sought and recorded zero dropped frames. These individual
internet samples do not establish a uniform end-to-end speedup.

## Experiments not shipped and next priorities

Enabling yt-dlp's filesystem cache did not improve this YouTube workload:
11.49 s without it versus 11.57 s with it, three alternating samples each.
The challenge solver remained dominant. Cache behavior stays unchanged.

No WebGPU work is justified by these startup measurements: the measured delays
are provider resolution, JavaScript checks and network requests. Native video
already owns decoding and presentation.

The next useful optimization is resolving the next queued item ahead of the
transition, with cancellation, bounded work, selected-quality/device keys and
fresh signed-URL expiry handling. That could move extraction out of the next
track's visible wait, but would not accelerate an arbitrary first click. Do not
cache successful playback URLs indiscriminately or skip availability checks.
A provider fixture matrix and slow-network first-frame tests should accompany
any such change. Keep renderer chunk preloading or buffer-size tuning behind
measurements: neither was established as the dominant cost here.

## Reproduction and validation

Deterministic regressions cover public route preparation without any network
request, selected HLS versus advertised alternatives, Core enqueue-to-load
without discarded probes, and the existing relay authorization/rewriting cases.
The optional real runtime regression loads a local extractor fixture through
Core's production launcher and yt-dlp. It executes JavaScript in system Node,
Electron as Node and the missing-Node QuickJS fallback; the Node provider must
retain filesystem and child-process permission restrictions. No website is
contacted by that regression.

Validation passed: typecheck, production build, 599 unit tests, and 133 targeted
Node integration cases across extraction, helper recovery/updates, previews,
public-media delivery and real FFmpeg. A pre-existing helper-recovery fixture
omitted the response socket now read by diagnostics; it also failed on unchanged
main. Supplying that fixture socket restores its intended 403 rejection check.
The startup Core assertions fail on main and pass with this change.

```sh
bun test tests/public-media-relay.test.ts tests/web-media.test.ts
bun build tests/web-intake.integration.ts --target=node --outfile=build/web-intake.integration.mjs
node --test build/web-intake.integration.mjs
bun build tests/yt-dlp-runtime.integration.ts --target=node --outfile=build/yt-dlp-runtime.integration.mjs
COUCH_TEST_YT_DLP=/path/to/unpacked/yt-dlp \
COUCH_TEST_QJS=/path/to/qjs \
COUCH_TEST_ELECTRON="$PWD/node_modules/electron/dist/electron" \
node --test build/yt-dlp-runtime.integration.mjs

COUCH_TEST_FFMPEG=/path/to/ffmpeg xvfb-run -a \
bun tests/media-startup.native.ts .artifacts/media-startup/run \
  --rounds=3 --delay=200 --assert-first-frame=750

bun build tests/media-resolution.performance.ts --target=node --outfile=build/media-resolution.performance.mjs
COUCH_NODE_PATH="$PWD/node_modules/electron/dist/electron" \
node build/media-resolution.performance.mjs .artifacts/media-resolution --rounds=3
```

Omit `xvfb-run -a` on a physical display. The external benchmark owns its data
under the evidence directory and installs managed helpers there; helper setup
is excluded from timings. Core's normal Node path can be tested by omitting
`COUCH_NODE_PATH`. Run timing trials serially, without concurrent builds/tests.
The 750 ms controlled first-frame budget distinguishes this run's improvement;
it is not a budget for internet extraction or a portable device certification.

Local evidence under `.artifacts/media-startup/`:

- `before/result.json`, `after/result.json`: controlled renderer comparisons.
- `external/result.json`: real provider resolution and alternating old/new relay.
- `external/extractor.json`: rejected cache experiment.
- `external/runtime.json`, `external/electron-runtime.json`: alternating runtime
  measurements with sanitized, timestamped extractor progress.
- `final-external/result.json`: final production resolver and relay, both selected
  YouTube streams and the StreamingCommunity master.
- `remote-native/result.json`: actual internet media in the production renderer,
  including the explicitly excluded lower-resolution YouTube sample.

Reference APIs: [yt-dlp JavaScript runtimes](https://github.com/yt-dlp/yt-dlp/wiki/EJS),
[its Node provider](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/youtube/jsc/_builtin/node.py),
[format checks](https://github.com/yt-dlp/yt-dlp#video-format-options),
[Electron's Node mode](https://www.electronjs.org/docs/latest/api/environment-variables#electron_run_as_node),
and [t3code's executable/environment pattern](https://github.com/pingdotgg/t3code/blob/main/apps/desktop/src/backend/DesktopBackendConfiguration.ts).
