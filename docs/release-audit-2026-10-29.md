# Main release audit, 29 October 2026

Base: `8beabc5dbf137bf90740446bdebee9cab52e1a11`, fetched from origin/main.
The latest published build during this audit was preview.5 (`73668e3`), not
current main. The audit covers the 40 merged PRs after the previous claims
baseline `3e603a5`, plus the fixes in this checkout. Live audio mode is excluded.

This is not complete release qualification. Tests here use Linux/WSL,
native Windows on an RTX 4060, Electron/Chromium and synthetic receivers.
Native Linux GPU validation is explicitly deferred; the owner is checking Mac
separately. Phones, locked-screen playback, routed LANs and multiple physical
screen-sharing receivers still require their own runs.
No release was published and the installed Couch and its data were untouched.

## Changes found by this audit

- RaiPlay collection expansion used the 24-item UI page size even though each
  response downloaded the entire season. It now reads each season once, follows
  actual cursors and enforces 500 unique episodes across seasons, including a
  final page that exceeds the limit. Browsing still uses 24-item pages. A real
  174-episode season used eight requests before and one after; three alternating
  trials gave median 403 ms before and 51 ms after. This measures collection
  expansion, not playback startup. Four regressions cover the optimization,
  final-page overflow, cross-season overflow and cursor handling.
- Saved constructed possible full reorders for every rendered item's Move
  up/down controls. It now checks neighboring positions and constructs an order
  only on a move. Store boundaries and persistence remain covered by browser
  regressions. The 100-item For later regression reads 40,293 item IDs on
  unchanged main and 397 with the change; the original fails the linear-work
  guard. This counts redundant work, not overall application FPS.
- StreamingCommunity's series detail link without `?e=` rejected the episode
  selected by the provider, although media extraction succeeded. It now reads
  that default episode's metadata and keeps its season/episode context.
- A publisher silently discarded a failed peer-connection constructor, leaving
  the receiver to wait for the ten-second fallback deadline. It now reports
  failure immediately. Late tracks belonging to a retired receiver are stopped.
- Public copy now describes one Up next per playback and distinguishes shared
  transport controls from private playback. The claims/specification documents
  distinguish preview.5 from current main and requested FPS from achieved FPS.
- Two browser fixtures had stale expectations: update availability now occupies
  the documented measured status row, and a completed radio-guide check must
  return serializable results instead of its closed fixture's functions.
- The historical speaker-only relaxed-microphone join defect is no longer
  reproduced on current main. A new production-mixer-to-Core regression adds
  shared sound without requesting the private screen, keeps the first receiver
  connected and still rejects an explicit unauthorized picture request.

## Provider evidence

Actual production adapters, anonymous requests from this network, on the audit
date. Search timings are single observations in milliseconds, not percentiles
or latency guarantees. Page two follows the returned cursor. A dash means the
selected query had no further results. No playback URLs or tokens are retained
in the result summaries. Helper binaries were provisioned before playback
measurements; initial helper-download latency is not included or qualified.

| Provider | Search page 1 | Page 2 | Resolution | Protected read |
| --- | ---: | ---: | ---: | --- |
| YouTube | 2279 | 3475 | 8260–9448 | Both video and audio HTTP 206 |
| Bandcamp | 370 | — | 1815 | HTTP 206 |
| Twitch | 633 | 543 | 1732 | HLS HTTP 200 |
| RaiPlay | 280 | 91 | 1866 VOD / 1246 live | HTTP 206 / HLS HTTP 200 |
| StreamingCommunity | 635 | 166 | 1315–1800 | HLS HTTP 200 |
| SoundCloud | 1519 | 1088 | 861 | HLS HTTP 200 |
| 123MoviesFree | 200 | — | 1866 | HLS HTTP 200 |
| AnimeSaturn | 430 | 245 | 2621 | HTTP 206 |
| AnimeUnity | 1111 | 526 | 1755 | HLS HTTP 200 |

YouTube and AnimeUnity each repeated one item across these upstream pages;
the existing client merges by identity. A separate raw Bandcamp endpoint
returned a challenge, but Couch's production adapter succeeded. That raw probe
is not evidence that Couch search failed. Online results depend on geography,
provider availability and changing catalogues. YouTube/StreamingCommunity
resolution used two rounds; other resolution samples used one. StreamingCommunity's
cold sample includes origin discovery. Relay preparation stayed below 1.4 ms
in the YouTube/StreamingCommunity run, with no discarded upstream probes.
An HLS HTTP 200 proves a manifest read, not decoded playback or sustained FPS.

Bandcamp keyword search is a bounded autocomplete result, with no continuation;
it is not an exhaustive paginated catalogue. Twitch keyword search follows a
cursor, while its directories and channel lists remain bounded. The audit does
not add pagination that the adapter's upstream API cannot safely provide.
Additional 123MoviesFree queries exercised two actual search pages (24 each)
and two catalogue pages (40 each), with no overlap. YouTube/SoundCloud use
24-item pages, RaiPlay search combines 12 programmes and 12 videos,
AnimeSaturn returns 10 and AnimeUnity 30 per search page. Existing limits remain;
none of these observations establishes exhaustive catalogue coverage.

The follow-up production-renderer smoke run played all nine providers, with
separate RaiPlay VOD/live samples. Every sample advanced; all eight VOD samples
sought and advanced afterwards. Twitch and RaiPlay live were not seek-tested.
Video samples reported no dropped frames over roughly 1.2 seconds of playback.
This is a short decoding/transport check, not sustained FPS, physical audibility
or cross-device A/V alignment validation. The environment had no physical
audio output.

| Provider | First frame / audio playback ready | Decoded picture |
| --- | ---: | --- |
| YouTube | 8.555 s | 1280×720, separate audio |
| Bandcamp | 1.524 s | Audio only |
| Twitch | 2.424 s | 1920×1080 |
| RaiPlay VOD | 3.157 s | 1280×720 |
| RaiPlay live | 1.909 s | 1280×720 |
| StreamingCommunity | 2.605 s | 1280×545 |
| SoundCloud | 1.977 s | Audio only |
| 123MoviesFree | 2.257 s | 1920×816 |
| AnimeSaturn | 5.305 s | 1280×720 |
| AnimeUnity | 4.856 s | 1920×1038 |

One sample per provider, including catalogue work and extraction; caches were
cleared between renderer samples. YouTube selected 720p in this run, so its
timing must not be presented as an improvement over earlier 1080p results.
The first YouTube attempt exposed a scratch-harness bug (querying the separate
audio element before the renderer attached it). The first StreamingCommunity
attempt exposed the real default-episode browse defect described above. Both
were rerun successfully; the failed observations remain in the logs.

## Video and UI performance

Production Electron renderer, Ryzen 5800X, WSL2 and software Xvfb, three
eight-second steady samples per workload after warm-up. Playback and timeline
hover delivered 59.94–60.05 FPS at 1920×1080 with zero dropped frames during
the sampling windows. The UI's p95 frame interval stayed 16.7–16.8 ms.

Screen sharing at the same resolution with a 60 FPS target delivered
54.26 / 54.76 / 54.37 FPS with 5.84 / 5.39 / 6.03% drops. It **fails** the
55 FPS / maximum 1% drops gate. Capture supplied about 59.5 FPS,
encoding/decoding about 57.8, and presentation about 54.4; UI animation stayed
around 60 FPS. Software libvpx was in use, with no reported resolution
adaptation. This does not identify a single codec or UI bottleneck. No quality
reduction, forced codec or hardware startup flags were applied to disguise the
failure. Sustained 60/120 FPS sharing remains unqualified for release claims.

An initial X11-over-TCP sharing run was excluded because that transport disables
shared-memory capture. The reported sharing runs use local X11. This correction
changes the test environment, not production code. Neither capture frame age
nor software frame counters measure physical capture-to-display latency.

The controlled startup check passes all six MP4/split/HLS samples at 1280×720,
including advancing playback and seeks, with zero dropped frames and zero
discarded upstream preparation requests. With 200 ms delay per upstream read,
first frames were 217–246 ms for MP4, 223–227 ms for split media and 451–455 ms
for extensionless HLS. Provider resolution is excluded from this experiment.

## Automated checks

Baseline frozen install, all three TypeScript projects, 751 unit tests,
production app build and website build passed. The broad Node run covered
75 integration files (772 cases). After correcting the scratch directory and
providing real helper binaries, 754 passed and 18 remained skipped; no failing
case remained. Those skips are hardware/environment qualification gaps, not
passes. Separate checks passed the HTTP latency regression, the 12 real-FFmpeg
screen-stream cases and five native production-player regressions.
After the fixes, all three TypeScript projects, 758 unit tests across 99 files,
the production app build and website build passed again.
Another 140 screen/relaxed-sharing Core cases across 14 suites passed without
skips, including direct delivery, fallback, multiple receivers, picture/sound
routing, privacy, revocation, upload failure and startup cancellation. The new
speaker-only test initially read a paired device before its online update;
its corrected suite passed 57/57, with the other 83 already passing.

Production-renderer UI coverage finishes with 25 distinct desktop checks
(including the new Saved render-work check), 13 phone-sized checks, 16 TV
focus journeys, and 54 TV route/state reachability cases with no unreachable
or obscured controls. This includes search/filter/pagination state, navigation,
Saved actions, cache freshness, settings, pairing dialogs, updates and radio.
Phone checks found a fixture focusing a hidden desktop rail link; it now
asserts that its unrelated focus target is actually visible and focused.
TV reachability needed to enter controls by Up from the intentionally focused
loading heading, instead of recording a missing graph entry as a navigation
trap. Concurrent Electron windows invalidated an earlier focus run; serial
reruns passed without a production-navigation change. None of these fixture
corrections is reported as an application performance improvement.

The runtime check exercises real yt-dlp with restricted system Node, Electron
as Node and missing-Node QuickJS fallback. Real extractor selection and MPEG-TS
tests passed with the downloaded, checksum-verified helpers. The HTTP listener
retains sub-millisecond loopback median responses in this run; this says
nothing about physical LAN latency.

Covered Core journeys include pairing/identity, permissions, independent
outputs, queue and playlist operations, history/resume, provider errors and
cache cancellation, subtitles/language selection, protected media delivery,
preview authorization, remote controls, source settings, radio guides and
recognition, updates, LAN selection, and TV setup/health/diagnosis fixtures.
The tests simulate endpoints and devices where stated by each fixture; they do
not establish physical sound, Bluetooth, AirPlay or TV installation success.

## Windows and Linux package follow-up

Both platform builds use the same audited source and fixes, in isolated scratch
directories. They are unpublished development packages, not a new release.
The installed Couch, its data and system package registrations were untouched.

Windows 11 (build 26300), Ryzen 5800X and NVIDIA RTX 4060 passed frozen install,
all three typechecks, app build, 757 unit cases (one Linux-only skip) and the
full NSIS package build with the native relay. The unpacked production ASAR app
completed first-run setup, hosted Core and reached Home. Closing its window
kept hosting; a second launch exited normally and restored the first window;
Quit stopped Core. Main's native lifecycle, capture-consent and quit probes
also pass. The NSIS installer was built, not installed; clean install, upgrade
and signed-release behavior are not established. The development version's
missing stable update feed is not reported as an updater regression.
The real yt-dlp runtime check also passes portable Node, packaged Electron
through a path containing spaces, and missing-Node QuickJS fallback.

Native Windows passed 26 desktop UI journey functions and five player checks.
Ordinary playback's compressor also passes its 17 desktop and 17 phone-layout
check groups plus five short native mode samples. Its fixture had assumed
clearing a fake follow clock would resume media that the missing clock paused.
It now observes that pause, sends the normal resume command and waits for the
graph, while retaining the rapid follow/Direct transition check. This changes
the fixture, not the production compressor or its playback policy. The same
desktop/phone correctness checks pass on Linux after the correction.
The selected Core integration run finishes with 156 passing cases, 11 explicitly
Windows-skipped executable fixtures and four group-language cases blocked by
their POSIX executable fixture. The separate source-language cases pass.
Initial missing-helper/download failures were rerun with real Windows helpers;
their failed logs remain. All 12 buffered-video cases pass with real Windows
FFmpeg, including actual 10/30/60/120 frame preservation and encoder cleanup.

All nine actual providers plus RaiPlay live pass a native Windows playback,
advancement and VOD-seek smoke. yt-dlp used the packaged `Couch.exe` as Node,
through its native Windows drive path. YouTube decoded 1920×1080 VP9 with
separate advancing audio. Single first-frame/play-ready observations were:
YouTube 9.00 s, Bandcamp 1.75 s, Twitch 2.63 s, RaiPlay VOD/live 2.43/2.00 s,
StreamingCommunity 2.78 s, SoundCloud 2.97 s, 123MoviesFree 2.56 s,
AnimeSaturn 5.23 s and AnimeUnity 4.91 s. These include extraction and, where
needed, catalogue requests. They are not latency percentiles or a comparison
against Linux's different resolutions. Every video smoke had zero drops over
its approximately 1.2-second playback observation.

A separate native Windows run extends every provider to 15 seconds of steady
playback after three seconds of warmup. All eight video samples have zero
dropped frames: Twitch delivers 59.98 FPS at 1920×1080, RaiPlay VOD/live 24.99
FPS at 1280×720, and the film/anime/YouTube sources about 24 FPS at their source
cadence. Both audio-only samples advance for the full observation and all VOD
seeks pass. YouTube's separate audio remains ready and playing. This establishes
short sustained provider decoding on this Windows machine, not long-duration
playback, physical audibility or synchronization between different devices.
Twitch dropped seven frames during warmup before its zero-drop steady interval;
those frames are retained in the total counters.

The default Windows GPU path uses ANGLE/D3D11 without forced flags or GPU
crashes. Local 1080p H.264 uses `D3D11VideoDecoder`. Three eight-second samples
after three seconds of warmup give:

| Windows workload | Delivered FPS range | Dropped frames range |
| --- | ---: | ---: |
| 1920×1080 playback | 59.98–60.08 | 0% |
| Playback with timeline interaction | 59.88–60.08 | 0% |
| Sharing, 1080p/60 target | 43.64–45.08 | 5.07–6.44% |
| Sharing, 1080p/30 target | 28.10–29.82 | 0.41–6.61% |
| Sharing, 720p/60 target | 58.50–59.22 | 1.04–2.28% |

The 2560×1080 display is 60 Hz. Windows limits the captured source window to
its 1032-pixel-high work area, so actual sharing frames are 1920×1032 and
1280×688, not exactly 1080p/720p. The source remained visible and unminimized,
with background throttling disabled; the receiver overlays part of it. One
loopback receiver uses production live-session/player code with fixture
signaling. This is not a physical multi-device or routed-network test. No
tested 60 FPS sharing configuration passes both at least 55 delivered FPS and
at most 1% dropped frames. The 30 FPS setting also has one failed drop sample.
This display cannot qualify 120 Hz presentation.

Repeated diagnostics used the same captured dimensions and retained the raw
failures. They do not change production settings:

- Default VP8 uses libvpx even with hardware acceleration enabled. Its source
  supplies about 60 FPS, while only 47–48 frames/s are encoded; the target
  bitrate stays near 2.5 Mbit/s. Removing the UI still delivers 44.39–44.49 FPS,
  which does not identify the application UI as the primary bottleneck.
- H.264 uses the NVIDIA hardware encoder and D3D11 decoder. Median process CPU
  falls from 110% to 45% of one logical CPU, but FPS remains 44.96–50.72 with
  5.98–15.78% drops. Hardware support alone does not qualify smooth sharing.
- Raising only the sender's maximum bitrate to 8 Mbit/s delivers 55.96–57.79 FPS
  at the same dimensions, with 3.52–6.43% drops. This identifies the default
  bitrate ceiling as a contributor, but does not satisfy the release gate.
- Adding a 50 ms video jitter-buffer target gives 56.48–58.97 FPS and
  1.25–5.42% drops. Browser-reported median frame age rises from about 67 to
  83–84 ms. It adds delay without a stable gate pass, so it is not adopted.

The bitrate and jitter experiments use the standard
[WebRTC sender/receiver APIs](https://www.w3.org/TR/webrtc/). The latter exposes
a delay/smoothness tradeoff; its requested target is not an achieved delay.
No forced codec, higher bandwidth ceiling or extra receiver buffering is
included in the production fixes.

Linux produced complete AppImage and deb packages, including the Go relay and
patched UxPlay, their licenses and required source payload. The unpacked
production app reached renderer-ready, returned HTTP 200 from Core and quit
with exit code zero. AppImage extract-and-run verified its embedded Node and
both helpers. The deb's dependencies and TV scripts were inspected; it was not
installed. This Ubuntu 26.04 WSL build does not qualify Debian 13 installation
or its runtime dependencies.

On Linux, six Go relay tests and seven Core relay lifecycle cases pass with
real sockets. All 17 AirPlay integration cases now pass without skips using
the packaged UxPlay and real GStreamer/FFmpeg, including pairing authentication,
RTP framing and receiver restart/shutdown. Their sender is synthetic; reception
from a physical Apple device remains unverified. These follow-ups cover the
eight AirPlay cases skipped in the earlier broad run.

Real Main/Core checks on WSLg also pass startup/renderer state, second-instance
restoration, mount/error gates, capture-consent cancellation and graceful quit.
The consent test uses synthetic media. WSLg itself reports failed accelerated
compositing and falls back to software; Mesa reports llvmpipe. It therefore
cannot establish native Linux GPU or physical capture performance. Native Linux
GPU validation remains pending by the owner's choice.

The native test servers had assumed `/` path separators, causing fixture loads
to fail on Windows. They now use Node's `basename` and `sep` across video,
startup, player, compressor and UI harnesses. Main's lifecycle probe keeps the
Linux kernel-identity assertion on Linux and permits its documented absence on
other platforms. These are test portability changes, not runtime optimizations.
The buffered-video regression now observes the real FFmpeg child directly
instead of requiring a POSIX shell wrapper, retaining frame/timestamp, content,
startup-cancellation and process-cleanup assertions on either platform.
Linux's full ported suite passes 12/12. One initial 60 FPS A/V assertion failed
during concurrent typechecking; the serial rerun and 40 repeated frame-rate
cases pass. That observation remains in the evidence and its cause is not
established; no assertion threshold was relaxed. The renderer-status probe also
now starts its fixture listener only in the primary instance, so a second
Windows launch reaches Main's single-instance lock instead of a fixture port
collision. The revised probe passes on both platforms.

## PR and claim review scope

- Providers/startup/previews: #944, #929, #928, #926, #904.
- Screen-sharing frame rate: #941, #940. Targets remain 30/60/120; previous
  measurements already failed sustained 60 FPS in software sharing.
- Browse/player/navigation: #939, #935, #933, #930, #927, #925, #924, #923,
  #903, #902, #900, #896.
- Radio: #901, #895, #894; ordinary media compressor: #888, #887.
- Network, shell, release and platform work: #934, #922, #917, #916, #899.
  Platform package evidence is recorded above; Intel Ventura remains a separate
  hardware check.
- Website, positioning and repository metadata: #898, #892, #891, #890.
  No production analytics events were sent and no deployment was performed.
- #918/#919 were examined for ordinary playback delivery, authority and
  interaction with screen sharing. Live audio qualification in those PRs and
  #920/#932/#936/#937/#938 is excluded. The macOS audio-buffer change in #936
  also affects ordinary playback and remains a Mac hardware check.

Read these claims with [the capability inventory](product/claims.md),
[startup methodology](media-startup-performance.md) and
[video methodology](video-performance.md). Historical PR results describe
their original machines and revisions; they are not automatically current-main
results or platform-wide promises.

## Reproduction and evidence

Use the commands in [CI](ci.md), with Bun 1.4.4, Node 24.22.2,
Electron 45.1.0, yt-dlp 2026.10.26, FFmpeg 9.0.2 and QuickJS-NG 0.17.0
used here. Build Node integrations individually, then use `node --test` as
documented. Supply `COUCH_TEST_YT_DLP`, `COUCH_TEST_QJS`,
`COUCH_TEST_ELECTRON` and `COUCH_TEST_FFMPEG` to enable optional checks.
Run timings serially, after builds and other tests have stopped.

Local, ignored evidence lives in `.artifacts/audit/`: `merged-prs.json`,
`pr-inventory.md`, `releases.json`, `providers.json`, `provider-playback.json`,
`raiplay-expansion.json`, `media-resolution/result.json`,
`integrations/summary.json`, the environment/real-helper rerun logs,
`runtime-rerun.log`, `http/`, `live-stream.log`, and `player-checks/result.json`.
Video samples are in `video-summary.json`, `video-local/result.json` and
`video-current/result.json` (only playback/controls from the latter).
Controlled startup is in `media-startup/result.json`.
The sharing batch and corrected outputs suite are in
`live-integration/results.log` and `live-integration/outputs-current.log`.
Actual-provider renderer results are in `provider-renderer/combined.json`;
the scratch reproduction harnesses are under `.artifacts/platform-audit/`.
UI results are in `ui-desktop/`, `ui-saved/`, `ui-recheck/`, `ui-phone/`,
`ui-phone-focus/`, `ui-tv-serial/` and `ui-tv-reachability/`. Use the corrected
focused results for the initial failures as described above. The unchanged-main
Saved negative control is in `ui-saved-before/`.
Initial integration failures from an absent scratch parent directory and
missing FFmpeg are retained beside their successful reruns.

The worktree started without Linux runtimes or native display libraries.
Portable tools and extracted distribution libraries were used only for these
scratch checks. The package follow-up is recorded in
`.artifacts/audit-linux-packaging/summary.json`, with installer hashes in
`artifacts.json`, package startup evidence and native-helper logs alongside it.
WSLg diagnostics and native Main/Core evidence are in `.artifacts/audit-linux/`.
Windows evidence is in `.artifacts/audit/windows/`, including package hashes,
native lifecycle/UI/player results, actual-provider results, Core logs and
`performance-summary.json`. Diagnostic FPS runs retain their own directories
(`h264`, `bare`, `bitrate`, `jitter`, `default30`, `lower60`). The Windows source
mirror's production files were byte-compared with this worktree; its export has
no `.git`, so the runtime revision field is empty and the separate package
metadata records the base commit and dirty audit provenance.
These runs do not qualify package installation or upgrades. CI/release
workflows require manual dispatch; no workflow or release is claimed from a
local build.
