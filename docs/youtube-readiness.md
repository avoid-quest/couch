# YouTube preview audit

Audit dated 23 October 2026 (Europe/Rome), starting at `8941565c967c02706ed41fcdbc3a77fd47149a81` above the six-PR preview audit. Historical context spans the same five previews, back to `3bdd95b7b439ea585dbf22c7308c6faaf06583b0`. Findings include earlier defects exposed by current journeys. The audit used GPT-6.1-Sol at xhigh and GPT-6-Astra at high, with separate browser, provider-contract and playback reviews.

## Measured change

Playing an untitled pasted link previously started two full yt-dlp extractions, one for playback and one for metadata. Core now reuses its pending playback metadata: **two helper launches become one (50% fewer)**. Queue-only intake remains immediate; failed/cancelled playback falls back to inspection. Ten retained real-Core/WebSocket/helper-process regressions cover both intake commands, missing/failed metadata, cancellation, Stop, removal, shutdown and supplied titles. A real Core/managed-helper before/after pair on the same public video measured sampled parent-helper CPU **2.15 → 1.05 s** and JSON output **170,362 → 86,159 bytes**, with identical public metadata. Load dispatch was **10.67 → 10.87 s**. This single pair demonstrates reduced extraction work, not a startup-speed improvement; descendant-process CPU is excluded.

## Repaired behaviors

- Saved channel Play, Play on and Queue resolve Videos; all four supported root-channel forms are covered. A live 3Blue1Brown sample loads all 153 videos in 3.087 seconds.
- Details actions consistently use the displayed canonical video and selected playlist occurrence; Resume keeps position and From start remains explicit.
- Related videos use the selected duplicate occurrence, rather than the first matching URL.
- Channels use verified canonical identity and inherit their known creator only on Videos/Shorts/Live streams. Opening an existing saved alias lazily normalizes that bookmark, preserving Saved/Remove and ordering or merging an existing canonical favorite; unrelated aliases receive no background lookup. Complete playlists retain each raw occurrence context, including repeats. All 24 positions on the last advertised page remain actionable.
- YouTube selection honors the receiving Device's codec support and portrait resolution; unavailable live recordings receive an availability message.

## Live service observations

The managed yt-dlp 2026.10.21, QuickJS-NG v0.17.0 and FFmpeg 9.0.2 ran only in isolated scratch data, with explicit CWD and port. Network requests used Couch's existing guarded public pipeline. Samples used ordinary public content, no account or access workarounds. Media URLs and proxy credentials are excluded from retained evidence.

| Journey | Observation |
| --- | --- |
| NPR search | 24 results in 2.679 s; identical cached read 1 ms |
| Search next page | 24 results in 3.202 s |
| NPR channel / Videos / playlist | 1.080 / 1.210 / 1.876 s |
| Me at the zoo | Real Chromium video, separate audio and six English caption cues decoded; pause, seek/resume and Stop passed |
| TED / NPR music | Guarded video/audio byte samples succeeded; resolution about 11 s |
| NASA Short | Guarded video/audio samples succeeded; exposed portrait-size defect |
| Blender, non-VP9 capability | Guarded bytes succeeded; exposed incompatible VP9 selection |
| Current public live stream | Resolved in 3.10 s; HLS master returned 200; no segment/decode claim |

Times are single observations, not comparative performance improvements. The actual renderer journey used production resolver, Pass-through, subtitle route and renderer in a focused harness. Post-seek audio/video drift was observed at 62–81 ms; audible quality was not judged.

## Browser and lifecycle coverage

Desktop 1280×800 and phone 390×844 each passed eight YouTube journey groups: four channel tabs and Back, unavailable holes, duplicate occurrences, Save/remove, list actions, reconnect/fresh preferences, rejected saves and Search More. Watch+list, Shorts and short links passed Queue/Open page/Back/palette Play. TV 1920×1080 passed 14 existing focus cases plus two targeted section/duplicate Back journeys.

A synthetic 2,400-position playlist stayed at 24 rows and 429 DOM elements at five checkpoints. Only offsets 0, 24 and 2376 were read once each; warm Back and equivalent snapshots caused zero reads. This is bounded DOM/query evidence, not a new CPU benchmark.

Eleven extractor lifecycle checks passed, including cancellation before/after spawn, queued cancellation, retry, three-process concurrency, deadline and output limits. Existing provider/history checks passed 79 tests; the browser audit additionally exercised cache, search, rendering/action freshness, history freshness and Save regressions. Counts overlap with other suites; do not sum them into a unique total.

## Deliberately rejected optimization

`youtube:skip=translated_subs` showed no reliable improvement in a controlled-source pair (10.91 vs 12.16 s, identical 1.13 sampled helper CPU seconds). It is not added. Human subtitle selection remains available. No cache change is justified by this audit.

## Retained regression results

| Surface | Final evidence | Scope |
| --- | --- | --- |
| Pasted Play | 10/10 real Core/WebSocket/helper-process tests | One extraction; fallbacks, superseding Play, Stop/removal/shutdown |
| Channel queues | Four root-channel forms | Loader parsing and Videos selection |
| Selected item and occurrence | 5 neighbour + 9 action groups on each desktop, phone and TV viewport | Real route tree and UI commands, deterministic API data |
| Resume and From start | 4/4 parsed-intake/Session tests | Saved 45 seconds versus explicit zero; selected list retained |
| Catalog | 15/15 retained, 10/10 original audit contracts | SQLite restart, alias races/order/removal, creator metadata, duplicates, all final-page positions |
| Playback quality | 51/51 with real yt-dlp 2026.10.21 | Offline selection via `--load-info-json`; 43 selector cases skip without the explicit helper |
| Adjacent behavior | 41 public history URL cases, 11 extractor lifecycle checks; existing browser cache/freshness/Save/focus journeys | Overlapping suites, not an aggregate test total |

The integrated catalog + Resume + Hub command suites passed 29/29. Source, scripts and app typechecks passed. These counts describe distinct invocations and must not be added together.

## Independent final review

Both reviews compared `8941565c967c02706ed41fcdbc3a77fd47149a81...7596d02113779531be02df745d7334f3d44e5a05`.

| Axis | Reviewer | Result |
| --- | --- | --- |
| Standards | GPT-6-Astra, high | No documented standards violations or actionable code smells. Optional benchmark traceability improvement implemented: source revision and actual helper versions/origins are retained. |
| Spec | GPT-6.1-Sol, xhigh | No confirmed remaining findings across all twelve repairs. Independently passed 80 integration tests with zero skips, 7 channel tests, and 42 browser groups across the three viewports. |

The Spec review additionally ran the production UI against an actual isolated Core with a fixture channel extractor. Opening a legacy saved alias received the real WebSocket invalidation, refetched favorites (200), retained the pressed Save state and canonical section links. Removal from Details and Saved each returned DELETE 204; saving again returned POST 200. Only one channel extraction occurred. This proves the local refresh/removal interaction, not live channel playback. The integrated tests and browser groups overlap the earlier results; they are independent reruns, not additional unique cases. All owned review servers/tabs were closed.

## Stack and automated checks

The five implementation layers extend the earlier six-PR preview stack. All remain open for review; `main` is unchanged.

| PR | Change | Source revision | Manual Check |
| --- | --- | --- | --- |
| [867](https://github.com/avoid-quest/couch/pull/867) | Saved channel playback | `c6633d5` | [Passed](https://github.com/avoid-quest/couch/actions/runs/39866139593) |
| [868](https://github.com/avoid-quest/couch/pull/868) | Reuse pending playback metadata | `8463efa` | [Passed](https://github.com/avoid-quest/couch/actions/runs/39866691811) |
| [869](https://github.com/avoid-quest/couch/pull/869) | Selected media and playlist context | `5bf9302` | [Passed](https://github.com/avoid-quest/couch/actions/runs/39868225411) |
| [870](https://github.com/avoid-quest/couch/pull/870) | Codec and portrait quality | `eb55d54` | [Passed](https://github.com/avoid-quest/couch/actions/runs/39868604521) |
| [871](https://github.com/avoid-quest/couch/pull/871) | Catalog identity and occurrence contracts | `7596d02` | [Passed](https://github.com/avoid-quest/couch/actions/runs/39869096411) |

Hosted Check performs frozen install, typecheck and production build. Regression tests above were run separately. No workflow or packaging code changed.

## Reproduce

Use repository Bun 1.4.2 and Node 24+. Set `COUCH_TEST_YT_DLP` to an explicitly selected yt-dlp 2026.10.21 executable before the commands below; the selector suite does not download one. Inspect skips, not only the exit status.

```sh
repo="$PWD"
scratch=$(mktemp -d /tmp/couch-youtube-tests.XXXXXX)
mkdir -p "$scratch/data" "$scratch/build"
./node_modules/.bin/bun build \
  tests/web-intake.integration.ts tests/provider-resume.integration.ts \
  tests/youtube-catalog.integration.ts tests/youtube-playback.integration.ts \
  --target=node --outdir="$scratch/build"
cd "$scratch"
COUCH_DATA_DIR="$scratch/data" COUCH_PORT=43731 \
  node --test --test-concurrency=1 "$scratch"/build/*.js
COUCH_DATA_DIR="$scratch/data" COUCH_PORT=43731 \
  "$repo/node_modules/.bin/bun" test "$repo/tests/youtube-channel.test.ts"
```

For browser fixtures, follow the [existing setup](preview-readiness.md#reproduce), load `tests/youtube-context.browser.ts`, and call `runYouTubeNeighboursRegression()` then `runYouTubeDetailActionsRegression()`. Require each returned `passed` field to be true. Repeat at 1280×800 and 390×844 with `?tv=0`, and 1920×1080 with `?tv=1`; the TV Play on menu opens with OK, desktop with ArrowDown. These suites make no real playback/API writes. Stop the owned Vite PID and close its tab afterward.

The [opt-in live measurement](../tests/youtube-benchmark/README.md) documents the exact load-dispatch/CPU sampling method and its limitations. [Machine-readable evidence](youtube-readiness-evidence.json) retains the observed pair, source revisions, toolchain, catalog observations and large-playlist workload. It excludes signed transport URLs and credentials. The retained measurement harness was bundled, typechecked and run once against the final production source: it recorded one extraction and the selected toolchain, then closed its Core and removed its generated database. That smoke run is separate from the original before/after comparison.

## Limits

Linux and Chromium fixtures/viewport modes are not physical TV, Safari, native mobile, macOS or Windows qualification. No live-stream segment decoding, multi-device hardware synchronization, long-lived URL-expiry soak, authenticated media or release packaging was proved. Hosted Check runs cover typecheck/build only. No merge or release is performed by this audit.
