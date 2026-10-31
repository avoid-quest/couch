# Main release audit, 29 October 2026

Base: `8beabc5dbf137bf90740446bdebee9cab52e1a11`, fetched from origin/main.
The latest published build during this audit was preview.5 (`73668e3`), not
current main. The audit covers the 40 merged PRs after the previous claims
baseline `3e603a5`, plus the fixes in this checkout. Live audio mode is excluded.

This is not complete release qualification. Tests here use Linux/WSL,
native Windows on an RTX 4060, native macOS,
Electron/Chromium and synthetic receivers. Native Linux GPU validation is
explicitly deferred; the Mac follow-up is recorded below. Phones, locked-screen playback, routed LANs and multiple physical
screen-sharing receivers still require their own runs.
No release was published and the installed Couch and its data were untouched.

## Changes found by this audit

- The Mac follow-up completes native window entry before HTML fullscreen,
  restores the previous native mode on exit, corrects physical capture dimensions,
  and includes Homebrew Go's runtime license when packaging. The fullscreen
  reproduction, fix and remaining qualification limits are recorded below.
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
  also affects ordinary playback; its Mac hardware check is recorded in the
  follow-up below.

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

## Native macOS follow-up

Evidence lives in `.artifacts/audit-mac-2026-10-29/` (ignored local artifacts).

### Environment and provenance

The Mac checkout began clean on `main`, fetched origin, and switched to
`origin/t3/platform-performance-audit` at
`bd763d76820992cee2f445b84b4c4431cf68778d`. It preserves the earlier provider,
Saved and sharing-recovery fixes. These measurements are source runs of the
checkout's Electron and production code, with fixture boundaries stated below.
The installed Couch and its data are excluded; every scratch app uses separate
data and ports, with shutdown restricted to owned PIDs. Live audio mode is
excluded. Ordinary playback, its compressor and screen-sharing sound are in scope.

Host hardware, architecture, OS/build, display characteristics and audio-device
inventory are intentionally omitted from this shareable report. Raw environment
and diagnostic evidence remains local under the git-ignored artifact directory;
it must not be included in commits, pull requests or uploads.

Runtime: Bun 1.4.4; Electron 45.1.0, Chromium 156.0.8078.49 and Electron's
embedded Node 24.22.1. The application reports ANGLE Metal and
`GraphiteDawnMetal`; composition, video decode/encode and WebGPU feature flags
are enabled. Actual H.264 local playback and every tested provider video use
`VideoToolboxVideoDecoder`, with `kIsPlatformVideoDecoder=true`. Default WebRTC
VP8 uses software `libvpx` for both encoding and decoding. The explicit H.264
benchmark uses `VideoToolbox` encoding and
`ExternalDecoder (VideoToolboxVideoDecoder)` decoding, both reported power efficient.
No hardware implementation is inferred from capability flags alone.

Frozen install, all three typechecks, app build and 757 unit cases pass, with
one Linux kernel-identity case skipped and no unit failure. The baseline suite
contains 758 cases across 99 files. These results precede the parent's later
working-tree changes; final checks must cover those changes separately.

### Provider playback on this Mac

The scratch provider harness uses the real production adapters, resolver,
protected relay and renderer. It mirrors Main's 128-frame Mac audio setting,
but does not run Main or the complete Core session. It uses anonymous real
upstream requests and provisioned helpers. Each completed sample has three
seconds of warmup and approximately 15 seconds of steady playback. Timings
below are single observations in milliseconds, not latency percentiles.

First-frame and Ready timing begins just before resolution, includes extraction
and relay preparation, and excludes search/catalogue and initial helper setup.
Ready waits for advancing readyState ≥3 media, including separate audio where
present. Audio-only Ready does not measure physical sound arrival.

| Provider | Search page 1 / page 2 ms | Resolution ms | First video frame ms | Ready ms | Decoded picture; steady video FPS |
| --- | ---: | ---: | ---: | ---: | --- |
| YouTube | 2112 / 3480 | 9208 | 9578 | 9965 | 1920×1080 VP9; 24.00 |
| Bandcamp retry | 439 / no continuation | 975 | — | 1696 | Audio only |
| Twitch | 656 / 592 | 1589 | 2753 | 3032 | 1920×1080 H.264; 30.00 |
| RaiPlay VOD | 237 / 98 | 1193 | 2182 | 2452 | 1280×720 H.264; 25.00 |
| RaiPlay live | 233 / — | 972 | 1502 | 1519 | 1280×720 H.264; 25.00 |
| StreamingCommunity | 271 / 223 | 1401 | 2017 | 2280 | 1280×545 H.264; 23.93 |
| SoundCloud | 1397 / 595 | 663 | — | 1359 | Audio only |
| 123MoviesFree | 350 / 238 | 1712 | 2115 | 2387 | 512×288, codec not reported; 23.93 |
| AnimeSaturn | 406 / 231 | 2503 | 4619 | 4881 | 1280×720, codec not reported; 24.00 |
| AnimeUnity | 1177 / 613 | 1595 | 3380 | 3657 | 1920×1038 H.264; 24.00 |

RaiPlay live's first request is the live catalogue, not keyword search.
Bandcamp retry searches `tycho`, receives 43 results, browses the ten-track
*Dive* album in 2443 ms and selects the 316.9-second *A Walk*. Bandcamp's
bounded autocomplete has no continuation. StreamingCommunity also spends
513 ms discovering its current origin and 303 ms expanding the default episode
from a series link without `?e=`. That default-episode path works. AnimeUnity
repeats one identity across pages; the other tested two-page samples have no
overlap. This is adapter pagination evidence, not a UI deduplication test.

All nine providers plus separate RaiPlay VOD/live samples now pass sustained
advancement and pause/resume. All eight VOD samples pass seeking and subsequent
advancement; Twitch and RaiPlay live intentionally skip seek. Every video has
zero warmup drops and zero steady-state drops. Their measured cadence is the
source cadence, not 60/120 FPS qualification. The selected Twitch stream is
30 FPS; the Windows stream was 60 FPS. The 123MoviesFree picture is only 512×288,
so its lower CPU/startup figures cannot be presented as equal-quality gains
over Windows' 1920×816 sample.

YouTube uses separate 1080p VP9 picture and AAC audio (`mp4a.40.2`). In a
15.001-second steady interval, picture advances 15.001 seconds and separate
audio 15.111 seconds, finishing 12.6 ms behind the picture's media clock.
Both remain ready and playing, pause/resume together and advance after seeking.
This is media-clock evidence, not acoustic A/V alignment. YouTube and the other
non-Bandcamp samples use `FFmpegAudioDecoder`, platform-audio=false. Bandcamp
uses `SymphoniaAudioDecoder`, platform-audio=false. Steady Electron CPU is
approximately 8.36–11.61% for video, 1.25% for SoundCloud and 0.99% for the
Bandcamp retry; the separate Node resolver/relay is excluded and 100% represents
one logical CPU.

Retained failures: the initial provider harness waited for CDP `Media.enable`
before its first navigation and produced no samples (`providers/fixture-failure.json`).
The first Bandcamp selection was a valid 0.75-second percussion sample. It
became ready in 1554 ms, played and naturally ended during warmup, failing the
unchanged sustained-advancement assertion. The long-song retry passes with
15.0025 seconds of progress during 15.0024 seconds of observation. Neither
failure establishes a production provider regression. The original logs remain.

Evidence: `providers-02/result.json`, `providers-02/server-results.json`,
`provider-bandcamp/result.json`, `provider-bandcamp/server-results.json` and
`provider-findings.md` (the latter predates the successful Bandcamp retry).

### Playback and sharing performance

Native playback and timeline interaction use production renderer/player code,
an unchanged generated 1920×1080 H.264 60 FPS clip and three serial eight-second
samples after three seconds of warmup. All six samples have zero warmup and
steady drops. Playback delivers 60.00–60.02 FPS at 17.38–18.80% summed Electron
CPU; timeline interaction delivers 59.95–60.06 FPS at 42.09–45.15%. UI-animation timing remains in the private evidence; it is separate from video FPS.

The initial sharing benchmark asked for a 1920×1080 **point** source window.
macOS clamped it to the available display area, reducing the encoded picture. Its 57.53–57.66 FPS with zero drops therefore does not qualify the
1920×1080 gate. The harness now accounts for display scale when sizing the source window, preserving the requested physical capture dimensions. It also
requires the requested source rather than silently falling back to a screen.
This corrects measurement geometry and source identity, not production quality.

At corrected 1920×1080 dimensions, three eight-second samples give:

| Sharing configuration | Delivered FPS, each run | Presented FPS range | Steady drops, each run | Mean CPU range |
| --- | --- | --- | --- | --- |
| Production defaults, VP8, target 60 | 33.95 / 34.33 / 33.45 | 33.33–34.20 | 1 / 0 / 5 (0.37 / 0 / 1.83%) | 72.07–73.13% |
| H.264 diagnostic, target 60 | 57.65 / 57.80 / 58.16 | 57.40–58.04 | 0 / 0 / 0 | 48.13–49.72% |
| VP8, 8 Mbit/s diagnostic, target 60 | 57.79 / 57.66 / 57.79 | 57.54–57.67 | 0 / 0 / 0 | 86.81–88.23% |
| Production defaults, target 30 | 29.46 / 29.34 / 29.33 | 29.21–29.34 | 0 / 0 / 0 | 67.33–72.08% |

All these samples have zero warmup drops. The corrected default target-60 run
captures 57.53–57.79 FPS, encodes about 34.08–34.33 FPS, decodes about
34.07–34.33 FPS and presents 33.33–34.20 FPS. Requested 60, captured cadence,
encoding and presentation must remain distinct. The sender reports libvpx and
about 2.5 Mbit/s. The default path **fails** the release gate of at least
55 delivered FPS and at most 1% drops in every sample at unchanged dimensions.

Both diagnostic configurations pass these three Mac samples at 1920×1080.
H.264 uses actual VideoToolbox hardware. The bitrate experiment retains VP8
libvpx and raises only sender maximum bitrate to 8 Mbit/s. These results do not
justify adopting either globally: Windows measurements already failed both
configurations, and cross-device/quality/regression qualification remains open.
They remain benchmark-only. The 30 FPS control passes its 28 FPS/minimum and
1%/maximum-drop check; it is not a 60 FPS gate pass.

The benchmark uses one same-Mac WebRTC receiver, production live session/player
and in-memory fixture signaling. CPU includes Electron's source, sender and
receiver. It excludes physical networking, Core signaling and audible sharing.
No 120 FPS source was tested; 1440p and multiple physical receivers remain gaps.
Browser capture timestamps do not measure filmed capture-to-display latency.

Evidence: `video-local/`, `video-live60/` (wrong initial geometry retained),
`video-live60-corrected-geometry/` (corrected failing default), `video-h264/`,
`video-bitrate/`, `video-default30/`, and `video-summary.json`.

**30 October sharing remediation.** Fresh serial defaults → bitrate-only →
defaults samples at unchanged 1920×1080 support sender bitrate pressure: about
57 captured FPS become about 34 encoded at defaults, about 57 with the 8 Mbit/s
diagnostic, then about 34 again after returning to defaults. Sender readbacks
confirm no application bitrate/frame-rate/scale cap in the default controls.
This identifies the effective bitrate-budget effect, not the exact internal
browser dropper. Production defaults remain unchanged.

The bitrate-only correction is incomplete: one same-renderer sample drops 20
steady frames (4.33%); a separate-renderer sample drops 21 (4.61%) and delivers
54.21 FPS. Both have zero inbound RTP drops/loss. Generated-source presentation
stays steady, while receiver timing gaps widen. The exact downstream cause and
diagnostic probe sensitivity remain unresolved. Other limited diagnostic samples
pass; none erases those failures or qualifies Windows/WSL.

| Fresh condition | Delivered FPS by sample | Steady drop % by sample | Result |
| --- | --- | --- | --- |
| Original defaults, 1080p60 | 34.54 / 34.56 / 34.69 | 0 / 0 / 0.36 | Fail FPS |
| Bitrate-only, same renderer | 55.09 / 57.46 / 57.23 | 4.33 / 0 / 0 | Fail drops |
| Bitrate-only, separate renderers | 57.44 / 54.21 / 57.34 | 0 / 4.61 / 0 | Fail FPS/drops |
| Defaults, 720p60 | 57.05 / 57.08 / 57.07 | 0 / 0 / 0.22 | Pass this control |
| Defaults, 1080p30 | 29.28 / 29.30 / 29.29 | 0 / 0 / 0 | Pass this control |
| Actual Main/Core with sound, defaults | 35.40 / 34.14 / 35.78 | 0 / 0 / 0 | Fail FPS |
| Actual Main/Core with sound, bitrate-only | 57.46 / 57.11 / 57.58 | 0 / 0 / 0 | Limited diagnostic pass |

Actual Main/Core pairing with generated sound advances audio bytes, energy and
sample counts in all three intervals without concealed samples. This measures
transport, not physical audibility or acoustic alignment. Benchmark diagnostics
now optionally record bounded per-peer counters, sender parameters, frame timing
and dimensions, with separate pre-warmup/steady boundaries. Older uninstrumented
runs expose cumulative pre-steady drops only. No diagnostic changes the original
delivered-FPS/drop formula, production media path or gate.

Live-client tests pass 46/46; speaker-only routing passes; real FFmpeg passes
12/12, preserving actual 10/30/60/120 cadence and cleanup. The historical FFmpeg
A/V flake does not recur but remains unexplained. Six playback/controls samples
deliver 59.92–60.05 FPS with zero startup/warmup/steady drops. Ordinary Main/Core
journey checks pass all 17 checkpoints. Compressor checks pass desktop/phone
groups and one timing round per mode; this does not replace the earlier three
rounds. Typechecks/build pass and all owned processes stop. Exact commands,
per-sample rates, startup/warmup drops and failures are retained in
`.artifacts/audit-remediation-2026-10-30/screen-sharing/execution-01/handoff.md`
and its allowlisted counters. Native Windows/WSL execution remains unavailable.

### Mac journeys and ordinary compressor

Visible errors during validation have different causes; a passing test does
not mean its app window displayed no error. These are the cases confirmed by
the saved logs and harness code:

| Category | Visible/logged examples | Meaning |
| --- | --- | --- |
| Deliberate startup failures | Couldn't read its mode; Core did not start; null `length` TypeError; mount failed; connection refused | `renderer-status.native.ts` injects rejected/malformed state, broken HTML and a refused port to check that a failed page is never reported ready. |
| Deliberate UI/capture failures | Source unavailable; source stopped responding; season unavailable; `NotAllowedError` | UI fixtures and consent tests exercise error, denial, cancellation and recovery states. They are not live-provider availability results. |
| Deliberately blocked packaged update check | `ERR_TUNNEL_CONNECTION_FAILED` | The package-smoke proxy blocks external downloads. That run does not qualify updates. |
| Unintentional test-driver defects | Object could not be cloned; target closed while handling command; controls not found | Early harnesses returned DOM/functions, initialized CDP too early or tried closed panels. Those runs failed; corrected follow-ups are recorded separately. |
| Recorded product/intermittent failures | Fullscreen hangs; sharing below the FPS gate; initial consent/focus failures | The original fullscreen restore fix passed the earlier source runs; the later J1 change remains unqualified natively. Sharing and the initial consent/focus observations remain open; none was an intentionally injected error. |

The completed ordinary journey, window-with-sound capture and screen-with-sound
capture runs have no `renderer error` or `main error` entries in their saved
app logs. This is evidence for those specific runs, not a blanket explanation
of every error visible during the audit.

`renderer-status` and `app-quit` pass with actual Main/Core: startup gates,
second-instance restoration, Close continuing to host, and Quit stopping Core
before Main. The intentional malformed/missing renderer and refused-connection
errors are test inputs. All 26 original desktop UI functions and five player
regression groups pass. Saved retains the 100-item linear-work result (397 ID
reads). The six controlled MP4, separate A/V and HLS startup samples pass with
zero drops; at 200 ms injected read delay first frames take 224–340, 222–223
and 445–450 ms respectively, excluding provider resolution.

`journey-04` passes the actual Main/preload/Core journey from empty data:
host/name/share onboarding, Home/Saved, real form pairing of a second production
renderer, queued Play, ordinary Direct A/V, compressor enabled/bypass, pause
suspending the graph, resume, seeking, selecting the second renderer's sound,
synchronized delivery with advancing Sendspin audio, and return to Direct with
the local compressor restored. It also selects Italian from a generated
two-language HLS stream, uploads/selects VTT subtitles with active cues, stops
playback, closes/reopens the window and shuts down its Core/listener. This is
one-Mac pairing and transport evidence, not physical speaker synchronization.
The run uses production Main's 128-frame buffer and reports no AudioContext
underruns. Earlier journey attempts remain: the first hung before navigation
on CDP Media initialization; the next two tried closed output panels. Opening
the panel before each independent action fixes those fixture errors.

`compressor-128` records the actual 128-frame switch: 17 desktop and 17 phone
layout check groups, real-time transition/pause/bypass checks, and three serial
eight-second samples per mode after three seconds warmup. Mean summed Electron
CPU is 4.61% native/no graph, 5.72% bypass, 6.19% enabled, 9.25% advanced edits,
6.08% stress, 3.10% paused graph, 3.44% paused native, and 5.98% toggling.
Available Web Audio counters show zero steady underruns in every sample; native
media-only modes expose no such counter. Bypass error is 2.98e-8 and the measured
dynamic ratio is 8.267. The earlier `compressor` run lacked the Mac buffer
switch and is retained without attributing its CPU figures to production Main.
These are software signal/counter results, not a physical listening test.

TV focus initially passes 15/16 cases and all 54 reachability cases, failing
Up from search results to Kind. Two unchanged-logic serial reruns pass all 16
at requested 1440×900 and 1920×1080. The latter was clamped by the OS and does not qualify that requested viewport; actual display geometry remains private. The original unexplained failure remains; no assertion
was relaxed and this is not external-TV or physical-remote qualification.

The 30 October remediation continuation adds three full serial runs, each
passing 16/16 focus and 54/54 reachability checks, and 17 targeted Search paths.
Those paths vary fresh/warm entry, prior late-content navigation and controlled
YouTube/StreamingCommunity/Twitch response arrival before or during Up navigation.
The original failure does not recur. Traces keep the selected All node connected,
visible and focused, with sampled window focus intact. This does not establish
the cause of the original failure, which remains open. Temporary diagnostics
were removed; no navigation or fixture correction was retained.

TV and desktop companion suites each pass 15 checks, and the phone sound-focus
case passes. Saved retains its render-work and persistence assertions: 397
Saved ID reads and 298 favorite reads for 100 items. Evidence and exact commands
are in `.artifacts/audit-remediation-2026-10-30/tv-focus/handoff.md`; all owned
processes stopped. The larger requested viewport was not honored, so that
requested size and physical TV/remote behavior remain unqualified.

### Mac capture and screen-sharing sound

`capture-window-external-first` passes real capture through Main/preload/Core
from an exact generated window in a separate process: requested 60 FPS, actual
1920×1080, moving picture, minimize preserving capture, stop/restart, Couch Close
ending capture while hosting continues, reopen, cancellation during preparation,
source-window process close retiring the publication, and recovery with a new
source window. Every final track ends and owned Core/listeners exit. The first
same-process source-window close failed retirement; the separate-process
control passes the unchanged assertion when its source process exits. It does
not establish window-only close while that process stays alive. The original
failure remains retained, and that distinct lifecycle case needs qualification.

`capture-window-audio-04` also passes a paired production WebRTC receiver at
every lifecycle step. It receives moving picture, Opus packets, advancing RTP
audio energy and the generated 997 Hz tone after initial start, restart, reopen
and source recovery; stop/Close retires receiver peers/tracks. Capture is actual
stereo 48 kHz loopback. Receiver output is held at 1% to control feedback. The
preceding zero-volume run had decoded tone RMS about 0.0167 and tone −46.3 dB
but zero RTP audio energy; changing volume to 1% yields advancing energy around
1e-7 without changing that assertion. This is decoded transport/signal evidence,
not physical audibility or acoustic A/V alignment. Initial audio attempts also
retain a non-cloneable DOM predicate and a missing receiver-device target; both
were scratch harness defects. No production audio/capture policy was changed.

`capture-screen-04` passes real full-display capture with the generated window
covering the display, plus sound and the paired receiver. Its full-display geometry differs from the fixed-resolution benchmark and remains private. Start/restart/reopen
local observers report 58/57/56 presented callbacks in one second with 58/59/58
decoded frames and no drops; initial observer readiness is 63–88 ms. Receiver
observers report 45/42/44 callbacks, with 1/8/3 drops in these short startup
samples. These are lifecycle observations, not steady-state 60 FPS gate passes.
The first three screen runs retained only one callback after a low-level
`BrowserWindow.restore()`. Adding separate warmup did not fix it. Using actual
Main's second-instance restore/show/focus path passes every unchanged assertion.
This isolates the fixture's incomplete restoration; the failed observations
remain under `capture-screen`, `capture-screen-02` and `capture-screen-03`.

macOS access was already granted for these source runs. No TCC reset or installed
app permission change was performed. Actual first OS grant/denial and release
package attribution remain untested. The synthetic consent harness uses native
Couch prompts but fake media: its first Close reports Allow with no abort and
fails; two unchanged reruns and a minimal native-dialog probe pass. Preserve
that unexplained observation; it is neither a qualified OS denial test nor a
basis for a speculative production fix. No screen pixels, raw audio or unrelated
window titles are retained by the real capture harness.

The 30 October consent continuation traces native sheet begin/end, Close
request/delivery, abort, response and preparation settlement. Two runs with the
original 500 ms delay pass, followed by two runs using sheet readiness and
settlement events. The harness now waits for those events and reads the abort
state after preparation settles; cancellation, denied access and Don't Allow
assertions remain unchanged. This improves the fixture without establishing a
cause or production fix for the historical Allow/no-abort observation.

**Window-only source Close is a reproduced open defect.** Two full external
source runs and reduced controls keep the source process alive after its last
window closes. Capture tracks, publication and receiver remain active beyond
the unchanged retirement deadline. Raw `getDisplayMedia`, without Couch's live
session, also leaves the video track live/unmuted with no end event. Explicit
stop and recovery succeed, including generated picture and sound; process-exit
and screen-audio controls pass. The prior process-exit pass therefore does not
resolve window-only retirement. Source-list snapshots also omit valid hidden
and minimized windows, so absence is not a safe Close signal. No production
workaround has been adopted.

The focused lifetime-signal follow-up reproduces the sole retirement failure
again in the original full sound/picture scenario and in a smaller production
call-path control. Targeted Quartz description queries retain the closed window
beyond the retirement deadline; alternative exact-ID queries omit valid hidden
and minimized windows. An Accessibility probe has no existing trust, and no
permission was requested. These controls rule out the proposed small native
workaround. No applicable released upstream correction was identified. Closure
requires an upstream end notification for the existing capture stream, or a
permission-compatible lifetime signal proven to preserve hidden/minimized
capture. No native helper, polling, bridge or dependency change was retained.
The full process-exit/audio control, 21 capture tests, 46 live-client tests,
typechecks and build pass after this investigation. Exact probes and failures
are in `.artifacts/audit-remediation-2026-10-30/window_retirement/handoff.txt`;
all owned processes stopped.

A separate signed test-only package verifies isolated bundle identity, strict
signature validity and a stable designated requirement before calling the real
OS microphone permission API. Three launches establish initial `not-determined`,
a pending real request when the test app quits, and `not-determined` again after
same-identity relaunch. No grant/deny decision or OS-dialog cancellation was
observed; native UI automation lacked existing accessibility trust and no such
permission was requested. First grant/deny, their persistence, screen/system-audio
decisions and release-identity behavior remain unqualified. This isolated probe
does not establish full packaged Couch capture.

Evidence and exact commands are in
`.artifacts/audit-remediation-2026-10-30/capture_consent/handoff.txt`.
Capture and live-client unit suites pass 21 and 46 tests respectively. All
owned processes stopped, with no owner installation, data, TCC or security-policy
changes. Failed controls and fixture startup failures remain in local artifacts.

### Mac fixes and retained fullscreen observations

The rapid player toggle reproduces with real Main/Core in `fullscreen-main`: an
HTML fullscreen promise resolves before macOS finishes entering, and a second
toggle leaves Exit fullscreen permanently pending. The Main/preload bridge now
keeps that control and shortcut pending until Electron's native completion
events arrive. `fullscreen-main-pending` passes the same real-app journey. The
initial strict `player-fullscreen.native.ts` additionally passes disabled/ignored
repeat clicks during entry and exit, subsequent normal toggles, and preserving
an already-fullscreen native window when HTML fullscreen ends. Its later
re-entry after leaving that native window fails in two initial runs
(`fullscreen-regression-02/03`): native fullscreen is true, DOM fullscreen is
false, and the Enter control remains pending. This edge was a release
blocker; the failed regression remains retained alongside the later fix.
`fullscreen-baseline-restore` reproduces the same edge using the original
`bd763d7` Main, isolating it from the new pending guard. The first regression attempt also
retains its scratch non-cloneable function return, corrected before those runs.

The resize-option/manual-window experiment in `fullscreen-main-trial` also
fails and was discarded. No animation delay, forced codec, bitrate, buffering
or GPU flag is shipped. The native UI queue harness now tests HTML fullscreen
without window resizing; real native transitions remain covered separately by
the stricter Main regression. All seven queue checks pass in `ui-queue-final`.

Electron documents that macOS fullscreen completion is asynchronous and callers
should use native completion events; its 45.1.0 source also distinguishes native
and HTML fullscreen. Sources inspected: [BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window),
[webContents](https://www.electronjs.org/docs/latest/api/web-contents),
[Electron fullscreen implementation](https://github.com/electron/electron/blob/v45.1.0/shell/browser/api/electron_api_web_contents.cc),
and [t3code's desktop window](https://github.com/pingdotgg/t3code/blob/main/apps/desktop/src/window/DesktopWindow.ts).

The first package attempt (`package.log`) builds the relay but fails reading
`GOROOT/LICENSE`. Homebrew Go 1.27.3 reports a `libexec` GOROOT and stores LICENSE
in its parent prefix. The helper builder now falls back to that parent only
when the original file is missing and GOROOT is named `libexec`; other errors
still fail packaging. It retains the actual toolchain license and all linked
dependency notices. [Homebrew's official formula](https://github.com/Homebrew/homebrew-core/blob/master/Formula/g/go.rb)
and the installed layout were checked. Ordinary builds still require no Go.

`fullscreen-regression-final` runs Escape before the OS-fullscreen cases. Rapid
repeats, normal cycles and renderer Escape pass, but immediate native entry after
Escape emits no entry event and times out. Core/listeners still shut down
cleanly. That historical run is not a passing full fullscreen suite. No
assertion was weakened to hide either failure sequence.

**30 October fullscreen remediation.** Main now completes native entry before
the renderer requests document fullscreen. It records the previous completed
native mode and restores it on HTML exit, including Escape. The button and
shortcut remain pending through native completion; document fullscreen still
contains the portaled playback controls. Browser and older-bridge paths retain
HTML fullscreen without the optional native preparation method. No animation
delay, dependency or window preference was added.

The final driver reproduces native-on/DOM-off/disabled-button re-entry against
the starting Main/preload in `baseline-active-restore`. A minimal Electron
hidden-titlebar reproduction fails independently; native-first ordering passes
with the default window preference. In `suite-final-02`, five fresh serial
Main/preload/Core scenarios pass all 42 steps: rapid toggles, repeated native
restore cycles, Escape, a combined sequence with playback portals, and TV.
Both ordinary browser and older-bridge queue fixtures pass all seven checks.
These cover the updated page with an older app bridge. An older remote page
loaded by a new app in Client mode retains its own fullscreen ordering; that
reverse version combination is untested and is not qualified by this fix.
Typechecks, build and owned Core/listener shutdown pass. Evidence is under
`.artifacts/audit-remediation-2026-10-30/fullscreen/`; `handoff.txt` records all
commands, failed controls and scope limits.

The historical immediate-entry-after-Escape timeout remains separately
qualified: it does not recur at that step against the starting implementation
when the driver waits for application activation and native exit completion.
That baseline then reproduces the original restore/re-entry hang. Current
strict Escape and immediate native entry pass, but this does not establish an
independent production fix for the old no-entry observation. Green-button
gestures, Space switching, Windows/Linux native execution and packaged
release-identity fullscreen remain untested.

```sh
bun run typecheck
bun run build
COUCH_QJS_PATH="$TEST_QJS" bun tests/player-fullscreen.native.ts .artifacts/audit-remediation-2026-10-30/fullscreen/suite-final-02
bun tests/ui-journeys.native.ts .artifacts/audit-remediation-2026-10-30/fullscreen/browser-queue --only=queue
```

These are retained run paths; choose new directories when repeating. `TEST_QJS`
points to the independently provisioned scratch helper, not installed Couch data.

### Portable fixture and packaging regression follow-up

The 30 October fixture correction replaces POSIX executable assumptions at the
actual child-process boundary, including the separate audio worker. Only marked
scripts inside each private fixture directory redirect to real Node children;
platform-specific executable names, arguments, environment, stdio and cleanup
remain exercised. Real-media paths still launch actual FFmpeg. The eleven named
Windows-skipped behaviors and four group-language cases now use this boundary,
as do helper recovery, web intake, scheduled language and delayed-relay races.
LAN eligibility and genuine Linux guards remain unchanged. Native Windows/WSL
execution remains unqualified; these local passes do not rewrite the earlier
platform results.

Final records for 30 distinct Node integration files total 252 passes, zero
failures and zero skips. All four group-language cases preserve input/invocation,
paced PCM, selection, seek/restart, takeover/collapse and Direct-return assertions.
Actual FFmpeg retains 12 cadence/PTS/content/A/V/cleanup cases. A negative control
that disables only worker redirection fails at the real worker launch boundary.
Oversized decoder output must actually exceed its limit, terminate, release its
lease and close its proxy.

The narrow Go-license production fix is unchanged. Nine focused real-filesystem
cases now cover normal/fallback layouts, precedence, error propagation and module
notices; removing or broadening the fallback fails negative controls. The real
local relay build retains the exact toolchain license. Unit tests pass 757 cases
with one Linux-only skip; typechecks, focused RaiPlay/episode/package regressions
and 18 Go cases pass. No whole package was rebuilt in this phase.

Retained failures include missing initial test prerequisites and one transient
Up-next output assertion observing `loading` before `paused`. The latter also
reproduces with the original fixture (one of 20 comparison trials); the final
full suite passes 57/57. A subsequent controlled follow-up establishes the
ordering: command admission publishes `loading` and its successful result
before asynchronous preparation publishes `paused`. Holding only that real
terminal publication makes the old assertion fail twice; waiting for the same
entry and exact playback generation passes three controlled runs. The corrected
test retains every final routing/private-output assertion and its existing
timeout, without added sleeps. This closes the fixture timing defect.

Seven further test callers now use the portable boundary and actual fixture
executable. All 26 shared-live-fixture callers were inspected; no remaining
instance of that extensionless/POSIX pattern was found in that set. The focused
synthetic native-capture case tests its real protocol child only, not app Live
audio mode. Latest affected/related Node runs pass 110 checks without skips.
Project typechecks pass; a broader integration typecheck still reports 39
identical pre-existing optional assertion-message diagnostics, with no new
diagnostics. Those are assigned to the cleanup review rather than claimed green.
Exact commands and all failed controls remain in
`.artifacts/audit-remediation-2026-10-30/portability_packaging/implementation-handoff-final.md`.
The caller continuation and controlled red/green evidence are in
`.artifacts/audit-remediation-2026-10-30/portability_callers/implementation-handoff-final.md`.
All owned processes, workers and listeners stopped. Native Windows validation
remains outstanding.

### Local Mac package

`package-02.log` builds DMG and ZIP (0.4.0) with a local development
signing identity. The app, relay, capture helper and QuickJS match the requested
package target and pass strict signature verification; the app passes
`codesign --verify --deep --strict`. The bundled Go notice exactly matches this
toolchain's license. Artifact hashes and command results are retained in
`package-verification.json`. Release signing was unavailable for this audit. Notarization is skipped, consistent with the repository's self-signed
distribution policy; this development identity cannot establish release update
or permission continuity. Building the capture helper is not testing Live audio
mode, which remains excluded.

`package-smoke-first` launches the actual unchanged app binary/ASAR from the
packaging output with fresh data and ports. It passes local-only onboarding,
Home/Saved/General settings and the real Quit Couch control; Main, Core and its
listener stop. It records Electron 45.1.0, Chromium 156.0.8078.49,
ANGLE Metal and bundle identity; host-specific metadata remains private. A rejecting loopback proxy prevents
automatic update/provider/helper downloads during this local smoke; expected
network errors are not startup regressions. This packaged run does not qualify
provider playback, capture permissions, DMG installation, quarantine/Gatekeeper,
upgrades, or the installed owner's profile. Source provider and performance
results above must not be relabeled packaged-app results. No installed bundle
was replaced, and no release, tag, push or CI dispatch was performed.

### Final Mac checks and release gates

The earlier package snapshot passed frozen install, typechecks, build, 757 unit
tests (one Linux-only skip), package-hook checks, signature verification and
packaged smoke. Those package results predate the later remediation. The later
background unit suite passes 765 tests with one retained skip; project and
expanded integration typechecks pass. Native GUI/focus and timing runs were
serial and have now stopped. The original fullscreen correction passed five
native scenarios (42 steps) before the additional J1 change. Current Main and the
six-scenario suite have no native green result; only the measured-event replay
validates J1. Latest-package qualification remains separate below. The owner's
installed app and data are preserved.

Remaining release blockers and qualification gaps:

- Default 1920×1080 sharing requested at 60 FPS fails the unchanged ≥55 FPS /
  ≤1% drop gate on both Windows and this Mac. Passing Mac H.264/bitrate
  experiments do not justify a global production change.
- The original fullscreen correction passed five source-run scenarios before
  the J1 overlap correction. Current Main and the six-scenario suite remain
  unqualified natively. Native-window-button exit during player fullscreen,
  Space gestures, packaged behavior and other platforms need validation; the
  original no-entry-after-Escape observation remains unresolved.
- Closing a shared window while its source process survives leaves capture,
  publication and receiver active. The raw capture control emits no end event;
  process-exit retirement and explicit recovery do not resolve this case.
- Real first OS capture grant/denial, release-identity permission persistence
  and signed install/update need dedicated qualification. Earlier source-run
  access does not establish first consent or release identity continuity. Initial
  non-reproduced consent and TV-focus failures remain visible in the evidence.
- Intel Ventura, Apple Silicon minimum macOS, native Linux GPU, 1440p/120 FPS,
  multiple physical receivers, routed LANs, physical remote pairing, external/
  Bluetooth outputs, acoustic A/V alignment and long-duration playback remain
  untested here. Physical audibility is not inferred from software counters.

Representative commands (historical paths; choose fresh paths to repeat and
substitute local package-target/signing placeholders):

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bun tests/renderer-status.native.ts .artifacts/audit-mac-2026-10-29/renderer-status
bun tests/app-quit.native.ts .artifacts/audit-mac-2026-10-29/app-quit
bun tests/ui-journeys.native.ts .artifacts/audit-mac-2026-10-29/ui-desktop
bun tests/ui-journeys.native.ts .artifacts/audit-mac-2026-10-29/ui-queue-final --only=queue
bun tests/player-performance.native.ts .artifacts/audit-mac-2026-10-29/player-checks --checks
bun tests/media-startup.native.ts .artifacts/audit-mac-2026-10-29/media-startup --rounds=2 --delay=200
bun tests/capture-consent.native.ts .artifacts/audit-mac-2026-10-29/capture-consent-third
bun tests/player-fullscreen.native.ts .artifacts/audit-mac-2026-10-29/fullscreen-regression-final
bun tests/compressor.native.ts .artifacts/audit-mac-2026-10-29/compressor-128 --warmup=3 --seconds=8 --rounds=3 --modes=none,bypass,enabled,advanced,stress,paused,paused-native,toggle --perf-checks
COUCH_PERF_MEDIA="$PWD/.artifacts/audit-mac-2026-10-29/media/1080p60.mp4" bun tests/video-performance.native.ts .artifacts/audit-mac-2026-10-29/video-live60-corrected-geometry --modes=live --seconds=8 --rounds=3 --assert-fps=55
bun .artifacts/audit-mac-2026-10-29/provider-harness/native.ts .artifacts/audit-mac-2026-10-29/providers-02 --warmup=3 --seconds=15
bun .artifacts/audit-mac-2026-10-29/provider-harness/native.ts .artifacts/audit-mac-2026-10-29/provider-bandcamp --only=bandcamp --warmup=3 --seconds=15
bun .artifacts/audit-mac-2026-10-29/journey-harness/run.ts .artifacts/audit-mac-2026-10-29/journey-04
bun .artifacts/audit-mac-2026-10-29/capture-harness/native.ts .artifacts/audit-mac-2026-10-29/capture-window-audio-04 --external-source --audio
bun .artifacts/audit-mac-2026-10-29/capture-harness/native.ts .artifacts/audit-mac-2026-10-29/capture-screen-04 --external-source --screen --audio
bun run package --mac dmg zip --<target-architecture> -c.mac.identity="<local-development-identity>" -c.directories.output=.artifacts/audit-mac-2026-10-29/package-02
bun .artifacts/audit-mac-2026-10-29/package-smoke-harness.ts "$PWD/.artifacts/audit-mac-2026-10-29/package-02/<target-output>/Couch.app/Contents/MacOS/Couch" "$PWD/.artifacts/audit-mac-2026-10-29/package-smoke-first"
```

The Main/Core scratch runs reuse only the audit's provisioned QuickJS binary via
`COUCH_QJS_PATH`, under `providers/core-data/helpers/qjs/v0.17.0/qjs`; data and
ports remain isolated. `COUCH_TEST_FFMPEG` optionally selects the native
fullscreen fixture generator. Detailed commands and outcomes also live in
`native-summary.json`, `native-followup-summary.json`,
`journey-followups-summary.json`, `sharing-diagnostics-summary.json`,
`final-checks.json` and the per-run logs. Failed runs are retained alongside
follow-ups. Installed Couch and its data are excluded from every scratch run.


**30 October review corrections (work still in progress).** Independent architecture
and cleanup reviews found a teardown-evidence defect: the executable fixture
force-stopped children before callers checked for leaks. Cleanup now records
surviving children and workers before either forced action, returns the same
evidence on repeated close, and restores fixture state before callers assert.
Controlled parent-child and worker-child leaks fail on the starting fixture and
pass with the correction; the safety net stops children before terminating their
worker so their exits can be reaped. The first intermediate ordering failure is
retained. The eight affected Node files pass 110 tests, and the focused synthetic
native-capture protocol case passes one. These checks exercise actual children
and real FFmpeg where stated; they do not qualify Windows execution.

The original 39 affected-integration TypeScript errors are corrected with the
existing optional assertion-message fallback. Checking the seven additional
files identified by cleanup exposed 14 more baseline errors: 13 optional
messages and one nullable playback ID. The same fallback and an explicit
non-null assertion on the playing screen resolve them; the expanded check,
project typechecks and diff check pass. No assertion or runtime gate was weakened.

Two ownership regressions reproduced cancellation on same-document browsing,
including during preparation. Main now preserves preparation on such navigation,
and active capture commands retain frame/local-origin checks without pinning the
route URL. Cross-document navigation and frame/origin/lifecycle controls remain.
The native authority, capture and live-client suites pass 79 tests. This was
mocked ownership/protocol validation: actual Live audio mode remains excluded;
the hidden capture-page branch shares the ownership check but was not independently
executed. Electron documents the same-document distinction in
[its navigation API](https://www.electronjs.org/docs/latest/api/web-contents#event-did-start-navigation).

Exact commands, red/green paths, limitations and process cleanup are recorded in
`.artifacts/audit-remediation-2026-10-30/final-reviews/fixes-parent/handoff.md`.
The 26 recorded runner PIDs are stopped. The full UI/UX verdict, separate final review and latest package rebuild remain
pending. Core authority and worker corrections are covered below.
These corrections do not close the sharing-FPS or window-only retirement gates.


**Worker review corrections.** Malformed encoder output now fails its own
Playback or Source. Retired FFmpeg stderr cannot change replacement metadata;
internal group generations prevent stale worker commands, state, output errors
and logs from reaching a replacement. After the worker stops, later loads and
source registrations report failure instead of remaining silently loading.
Sendspin close is idempotent and awaits worker, child and helper-lease retirement,
including its bounded worker fallback. The Hub awaits that completion alongside
independent producer cleanup; the separate authority lane owns its final
integration verification. No restart supervisor, public protocol change, codec
policy or DSP change was added.

The worker lane records 108 distinct passing tests, zero failures/skips, matched
private worker/test bundles and 401 owned PIDs stopped. Parent inspection confirms
the four source hashes still match that tested state. Original-source malformed
stream, stale reply/metadata and incomplete shutdown failures remain retained.
Fixture-only corrections wait for matching socket timestamps before byte
comparison and avoid a demonstrated baseline mono quantization boundary while
retaining exact channel, cadence, timestamp and PCM assertions. Commands, controls,
limits and cleanup are in
`.artifacts/audit-remediation-2026-10-30/final-reviews/fixes-worker/handoff.md`.
These tests did not exercise physical Live audio or qualify playback performance.

**Additional fullscreen overlap finding.** Two source-app probes reproduce a
player entry request during an unfinished native window exit: HTML entry works,
but HTML exit incorrectly restores native fullscreen. The real F-key request
precedes the native exit event. This extends the earlier passing fullscreen scope;
it is not covered by the original 42 steps. A one-line restore-state correction
and strict external-exit regression are present but remain unvalidated natively.
A deterministic replay of the measured native-event ordering fails the original
Main code and passes the one-line candidate; it does not replace native validation.
Other probes failed earlier at initial native entry; those failures remain separate and
unresolved. A first probe also used mismatched standalone Core/client build
identities and never reached the scenario; subsequent probes used matched private
bundles. No timeout or assertion was weakened. All recorded scratch Main/Core
processes stopped. Evidence and continuation details are in
`final-reviews/fixes-parent/fullscreen-race/` under the remediation artifacts.

The benchmark now explicitly reports its required fixture dimensions and any
mismatch. Its unchanged size gate intentionally qualifies a generated 1920×1080
source (1280×720 for Live 720p), including a controlled test display with
`--screen`; arbitrary desktop geometry is not qualified. A fixture mismatch alone
is not a production playback failure. The FPS/drop gate and all failed sharing
samples remain unchanged.


**Core authority review corrections.** Code-authorized re-pairing now grants
Controller access instead of retaining an admin role. First pairing and explicit
admin recovery remain; intentional token replacement still revokes the previous
connections. Remote volume/mute retains the selected TV's current consent, and
catalogue completion rechecks its selected TV and original Playback. Failed
synchronized picture preparation now exposes a per-output error while healthy
sound continues, with retry and stale-callback guards. In sync persists with the
retained queue; publications, admission and output assignments remain runtime-only.
Independent producer cancellation starts before buffered setup is awaited, and
shutdown waits for the audio worker's completion.

REST cleanup now retires a newly created empty Playback after a failed command.
Parent integration reproduced an additional race in its initial implementation:
a finishing catalogue browse could retire another command's pending queue.
Cleanup now follows the exact creating command on both REST and WebSocket paths.
The original fault and concurrent-request observations remain retained.

The authority lane recorded 36 focused passes, 112 affected passes and 68 unit
passes, with three existing conditional skips; all 241 recorded PIDs retired.
After the parent cleanup correction, 38 focused and 108 affected tests pass,
with the same three conditional skips. Expanded affected/project typechecks pass;
seven additional baseline fixture parameter annotations were corrected. The 63
parent runner PIDs retired. Commands and evidence are in
`final-reviews/fixes-authority/handoff.md` and
`final-reviews/fixes-parent/authority-integration-01/handoff.md` under the remediation
artifacts. These are Core/HTTP/socket, synthetic admission and injected-fault
checks; they do not qualify physical Live capture, GUI behavior, performance,
permissions or a packaged release. Subsequent UI/UX, independent review and
latest-package results are recorded below; the final native fullscreen check
remains unqualified.


**Background UI review and final focused checks.** The user stopped foreground
validation because it repeatedly took desktop focus. That GUI delegate was
cancelled, its apps stopped, and the UI/UX review completed from source and saved
evidence. Subsequent work uses background processes only. Interference during
the cancelled run does not establish TV focus regressions; historical serial
failures remain separately recorded.

The first Home Stop-focus candidate broke deliberate-focus cancellation and was
discarded. Its replacement reuses the bar's existing recovery when the focused
playing title disappears. An isolated
[headless Chrome](https://developer.chrome.com/docs/automation-and-testing/headless)
run now validates the actual renderer without visible platform windows. Original
Home code fails the new external-Stop case at desktop, phone and TV fixture sizes;
the replacement passes all 92 Home/focus-recovery checks. Phone fixtures were
corrected to select visible controls and verify deliberate focus before each
state change. Earlier unfocused-tab and changed-navigation-target fixture
observations remain retained. These are headless browser results, not native
Electron, physical TV, capture or packaged-app qualification.

HLS refusal messages now include the HTTP status when available and use the
existing unavailable-source message when the browser hides it. The 30 HLS unit
checks pass; captured before/after evidence matches that source. The complete
background unit suite passes 765 tests, with one retained conditional skip and
zero failures. Project and expanded authority/fixture typechecks pass. All 15
recorded headless PIDs and their listeners stopped. Exact commands, source hashes,
controls and limits are in `final-reviews/fixes-parent/headless-ui/handoff.md` and
`final-reviews/fixes-parent/combined-checks-01/` under the remediation artifacts.
Independent final Opus verification completed and identified the focused
corrections recorded below. The focused recheck and latest local package are
recorded below; native fullscreen J1 and the other release gates stay unqualified.


**Independent verification and focused corrections.** The final Opus review
accepted the combined remediation and found a Remote volume regression: the TV
exception also rejected other consented mixer outputs and the controller's own
volume while viewing Live. Two new tests fail on that source and pass after
restricting the exception to commands naming the selected TV. Existing permission
refusals remain covered. Screen-preparation logs now use the documented device
label.

A real worker-crash probe also confirmed a shutdown error: a killed encoder could
remain a dead, unreaped process and be reported as still running. After the existing
retirement deadline, shutdown now accepts only a confirmed owned dead child of an
exited worker on POSIX. Running or unknown states still fail. Graceful and fallback tests still require the encoder PID to disappear;
graceful close waits for its children before the worker exits. This correction does not claim
reaping before Core exits or add a worker restart. A deliberately unavailable
status check still fails, and fixture cleanup still reports genuinely running
survivors before stopping them.

The affected background integration selection passes 206 distinct cases, with
two retained conditional skips. A first native-capture protocol run failed because
the private runner changed the fixture's required repository working directory;
the same source passes all eight cases from that directory. The original failure
is retained. These tests use synthetic packets and real child/worker boundaries,
including real-FFmpeg media controls, with no physical capture. The unit suite
passes 765 tests with one retained skip; project and expanded integration types
pass. All 125 recorded follow-up PIDs retired. Commands, red/green controls,
limitations and cleanup are in
`final-reviews/fixes-parent/final-review-followup/handoff.md` under the remediation
artifacts. The focused independent recheck accepted V1–V6 without a code defect.
Its final worker-test typecheck passes, and the audit now separates production
retirement behavior from strict test assertions. No additional review was
required for those two closing items. Remaining release blockers are unchanged.


### Latest local build for manual review

After the focused Opus recheck, the complete app was rebuilt and packaged as
`Couch-local-audit.zip` with ad-hoc signing, notarization explicitly off and
publication disabled. The repository's release identity and signing policy were
not changed. ZIP packaging and file-only verification ran in the background;
no Main window, Finder window, capture or OS consent/signing prompt was opened.
The reviewed source stayed unchanged throughout build and package verification.

All bundled Main/preload/Core/worker and frontend files match the build outputs.
ZIP integrity passes, its ASAR matches the packaging output, and extracting the
ZIP preserves that ASAR. Strict signature checks pass for the built and extracted
apps plus relay, capture helper and QuickJS (five checks). The Go runtime license
section exactly matches the toolchain's upstream LICENSE. Two private verifier
mistakes (ASAR path format and combined-license layout) were corrected with their
failed observations retained; neither changed the product or package.

The extracted app's binary was used only in
[Electron's Node mode](https://www.electronjs.org/docs/latest/api/environment-variables#electron_run_as_node),
after a file-only check confirmed the corresponding fuse was enabled. Packaged
Core passes ten offline smoke checks: health, matching build identity, frontend,
assets, first pairing, socket state, queue write, In sync preference, device
volume, and re-pair token revocation. SIGTERM shutdown returns zero, the listener
closes, and no forced cleanup is needed. The first probe read In sync from the
wrong protocol object; the corrected probe uses PlaybackSummary against the same
package, retaining that fixture failure. External requests were deliberately
blocked in this smoke, so it does not qualify providers.

This is **packaged Core and archive evidence**, not packaged Main/renderer GUI,
playback performance, capture permissions, native fullscreen, installation,
Gatekeeper or release update evidence. Earlier GUI package smoke describes only
the earlier snapshot. No latest DMG/install/update test was performed. Native
Windows/Linux and minimum-OS/other-target execution, physical devices and actual
Live audio mode remain outside this run; Live audio mode was explicitly excluded.

Evidence, commands and hashes are under
`.artifacts/audit-remediation-2026-10-30/local-package/`: `build-record.json`,
`source-manifest.json`, `bundle-verification.json`, `package-verification.json`,
`smoke/run.json`, `smoke/probe-result.json`, `verification-notes.md`, and
`final-checks.json`. Raw logs remain private and ignored. `manual/Couch.app` is
extracted from the verified ZIP. The manual-only `Launch Couch Test.command`
launcher selects a distinct data directory and free port; it has been syntax
checked but not launched. The installed Couch and its data remain untouched.

The build is ready for **manual testing**, not release approval. The default
60 FPS sharing gate still fails; closing only a shared source window still
leaves sharing active; current native fullscreen/J1 and the original native
entry/consent observations remain unqualified or unresolved. These need their
own native/platform evidence and are not relabelled fixed by background checks.

### 31 October qualification of `f5e98cc`

Source: `f5e98ccd9b715f6277abf935f1c2dc2a2eedd5c2`, the PR head. All 80 reviewed
source, test and documentation files in the earlier package's source manifest
match this commit byte for byte; only this audit document has changed since.
The reviewed fixes therefore need no further review. Foreground GUI stayed
stopped: no Electron window, capture, focus change, OS prompt or signing prompt
ran on this Mac, and no linked test machine was available. The installed Couch,
its data and its permissions were untouched.

**Manual workflows on this branch.** [Check](https://github.com/avoid-quest/couch/actions/runs/41146522695)
passes on Linux with 766 tests and no skips.
[Package](https://github.com/avoid-quest/couch/actions/runs/41146525623) passes
on all three runners. Linux, Mac and Windows each pass the typechecks; Linux
runs 766 unit tests, Mac and Windows 765 with the one Linux-only skip, and each
passes all 18 Go relay tests without network skips. Mac signs both the arm64 and
x64 apps with the `Couch Releases` identity and passes the strict deep and
helper signature checks. The Linux, Mac and Windows installers are unpublished
run artifacts (expiring 13 November); none was installed. Windows tests on a
hosted runner are not native GUI, GPU or capture execution.

File-only signing continuity: the downloaded arm64 and x64 apps pass
`codesign --verify --deep --strict` and satisfy, with `codesign --verify -R`,
the designated requirement of the published preview.5 arm64 app. Both carry the
identical requirement: identifier `quest.avoid.couch` and the certificate root of
[`couch-releases.pem`](../packaging/couch-releases.pem). That is the condition
Squirrel.Mac and macOS permissions check. The combined `latest-mac.yml` lists
both architectures' ZIPs and DMGs. No artifact was launched or installed, so an
actual update and permission retention remain untested.

**Current local build.** A frozen install, typecheck, 765 unit tests (one skip),
the app build and an ad-hoc ZIP package all ran in the background from the
clean commit. The packaged build identity is now `f5e98cc` and not dirty,
replacing the earlier package's dirty revision. The ZIP, ASAR and the 87 bundled
Main/preload/Core/worker/frontend files match the build. Five strict signature
checks and the Go license comparison pass. Packaged Core in Electron's Node mode
passes the same ten offline smoke checks with a clean SIGTERM exit and closed
listener. This is Core and archive evidence only. The extracted app and its
isolated manual launcher are in `qualification/local-package/manual/` under
`.artifacts/audit-remediation-2026-10-31/`; the launcher was syntax-checked, not
run.

Electron 45.2.0 (released 30 October) lists no capture or fullscreen fix, so
it changes neither the window-retirement nor the fullscreen analysis.

**Gate status for this commit:**

| Gate | Status | Missing evidence or access |
| --- | --- | --- |
| Default 60 FPS sharing ≥55 FPS, ≤1% drops | **Fails** (Mac and Windows, unchanged) | A production change that passes every steady sample on Mac and Windows, measured natively with sound. No candidate passes on both; bitrate/codec/buffering stay benchmark-only. |
| Window-only Close with the source process alive | **Open defect** | An upstream end signal, or a permission-free lifetime signal shown to keep hidden/minimized capture, plus a native run. |
| Fullscreen J1 and six-scenario suite | **Unqualified** | A native run of `player-fullscreen.native.ts`, including external exit, native-button exit during HTML fullscreen, Escape, rapid toggles and restores; it needs visible windows. |
| First OS capture grant/deny/cancel, relaunch persistence | **Untested** | An isolated test identity on a machine where OS prompts and UI automation are permitted. |
| Native Windows/Linux GPU, minimum OS, physical devices, providers, compressor and YouTube rechecks | **Not rerun** | Linked Windows, native Linux GPU, Intel Ventura and Apple Silicon macOS 14 machines; physical receivers and remotes. The hub/Sendspin changes in this commit call for the compressor Direct/synchronized native recheck. |
| Builds, packaging, signing | **Pass** (CI, local, file-only requirement check) | Install, Gatekeeper, an actual update from preview.5 and permission retention need a GUI-permitted machine. |

Evidence: `qualification/` under `.artifacts/audit-remediation-2026-10-31/`
holds `steps.txt`, the local and CI logs, `local-package/` verification and smoke
results, and the signing comparison. Commands:

```sh
gh workflow run check.yml --ref t3/platform-performance-audit
gh workflow run package.yml --ref t3/platform-performance-audit
bun install --frozen-lockfile && bun run typecheck && bun run test && bun run build
CI=true CSC_IDENTITY_AUTO_DISCOVERY=false bun run package --mac zip -c.mac.identity=- -c.mac.notarize=false -c.directories.output=<scratch>
```

Not release-ready: the sharing and window-retirement gates fail, and the native
fullscreen, first-consent, platform and install/update gates lack evidence.
