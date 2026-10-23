# Preview performance measurements

Measured on Linux, 22–23 October 2026, while reviewing the five previews
`v0.3.1-preview.7` through `.11` and unreleased main at `b28db6d`.
These are controlled workloads, not whole-app or physical-device speed claims.

| Workload | Before | After |
| --- | --- | --- |
| Twelve cold readers of one 256 KiB artwork | 12 downloads / 3 MiB | 1 download / 256 KiB |
| Leave Search while the next route loads | 10 blank catalog reads | 0 extra reads |
| Collection scrolling, desktop | 47.5 fps; 8 long tasks / 4 s | 59.5–59.75 fps; 0 long tasks |
| Same collection, paired renderer CPU sample | 37.75% of one core | 29.12% |
| Untitled pasted YouTube Play | 2 yt-dlp launches | 1 launch |

Collection measurements used a minified production fixture in Chromium 154 with
software compositing: 1,000 items, 24 visible rows, scrolling and two equivalent
session snapshots per second. DOM size stayed at 509 elements; glass effects,
layout and pagination were unchanged. CPU samples lasted eight seconds.
At 390×844, scrolling improved from 51.25 to 58.75–59.75 fps with no long tasks.
This viewport represents a phone layout, not phone hardware.

One managed-helper YouTube pair measured sampled parent-helper CPU of
2.15 → 1.05 seconds and JSON output of 170,362 → 86,159 bytes. Load dispatch
was 10.67 → 10.87 seconds: extraction work decreased, startup did not improve.
It used yt-dlp 2026.10.21, QuickJS-NG 0.17.0 and FFmpeg 9.0.2; descendant CPU
was excluded. Network variation prevents generalizing this single pair.

Behavioral regressions remain in `tests/artwork-route.test.ts`,
`tests/search-navigation.browser.tsx`, `tests/collection-rendering.browser.ts`
and `tests/web-intake.integration.ts`. They protect download sharing, stable
outgoing search state, collection derivation/action freshness and extraction
reuse; they do not assert timing thresholds. PRs [860](https://github.com/avoid-quest/couch/pull/860),
[861](https://github.com/avoid-quest/couch/pull/861), [864](https://github.com/avoid-quest/couch/pull/864)
and [868](https://github.com/avoid-quest/couch/pull/868) retain the comparisons.

No performance gain is claimed for media decoding, physical TV GPUs, native
mobile playback, cross-device synchronization or packaged installers.

## Player navigation on the MacBook, 23 October 2026

The installed app was `0.4.0-preview.1`. Measurements below use the checkout at
`a7dc5371` and these fixes, in an isolated Electron 44.4.5 / Chromium 152 renderer
on the same M5 Pro, built-in display at 120 Hz, device pixel ratio 2. They do not
modify the installed app, its playback, or its data. Its window was displaying a
remote Couch, so the installed shell version alone does not identify its served
renderer revision.

The initial pass below builds the production shell and router, opens a playing radio item
from Home, then uses the actual Back button. It uses a long title, locally served
artwork and deterministic API responses. Both routes, fonts and artwork are warm;
there is no media decoding, real stream, Core, or periodic session traffic.
Viewport: 1440 × 868 CSS pixels. Three runs per revision, 12 open/return cycles per
run. Each run uses a separate Electron profile; hardware acceleration stays on.

| Measurement | Before | After |
| --- | --- | --- |
| Cached 3:1 artwork remount, React commits | 3, initially square | 1, correct proportions immediately |
| Artwork reads during two playback-clock updates, including the OS media-session bridge | 11 | 2 (same as the bridge outside the player) |
| Animation-frame gaps above 12.5 ms, 36 round trips | 63 (22 / 20 / 21) | 54 (14 / 19 / 21) |
| Estimated missed 120 Hz intervals, same runs | 71 | 55 |
| Median frame interval | 8.3 ms | 8.3 ms |
| Per-run p95 frame interval | 8.6–8.9 ms | 8.9–9.1 ms |
| Worst observed gap | 25.3 ms | 25.0 ms |
| Per-run median transition capture-to-ready time | 11.0–11.2 ms | 12.5–12.6 ms |
| Tasks over 50 ms / rejected transitions | 0 / 0 | 0 / 0 |

The estimated missed intervals decreased about 23% in this sample. This is **not
stable 120 fps**: route boundaries still miss one or two refresh intervals, and
neither tail frame time nor capture latency consistently improved. A browser
`requestAnimationFrame` gap is a scheduling signal, not proof that the GPU failed
to present a frame. The estimate sums `max(0, round(gap / (1000 / 120)) - 1)`;
12.5 ms allows timestamp jitter while detecting a missed 120 Hz interval.

That initial pass retained the artwork and controls' native view transitions;
the deeper pass below replaces them after a longer comparison:

- Loaded artwork caches its proportions as well as its fade state. Mounting a
  known image no longer synchronously corrects its fallback size and load state.
- The player's end-time label owns its clock subscriptions. Clock updates keep
  the timeline and end time current without re-rendering the whole player; live
  radio does not mount an end-time label.
- Footer clearance is measured in the commit that restores it, including Back
  from the player and Remote to Home, instead of waiting for ResizeObserver.

The separate Windows/Linux fix keeps Electron's native caption buttons at 40px,
following [t3code's window options](https://github.com/pingdotgg/t3code/blob/main/apps/desktop/src/window/DesktopWindow.ts).
The removed header-height IPC had stretched them to 72px or more as the interface
scaled. Native controls, safe-area environment variables, drag regions and OS
maximize behavior remain. **Windows 11 visual/DPI validation is still needed**;
a Mac test cannot verify those native buttons.

### Repeat the measurements

```sh
COUCH_PERF_WIDTH=1512 COUCH_PERF_HEIGHT=982 bun tests/player-performance.native.ts .artifacts/player-performance --rounds=40 --assert-budget=60
bun tests/player-performance.native.ts .artifacts/player-checks --checks
COUCH_PERF_WIDTH=390 COUCH_PERF_HEIGHT=844 bun tests/player-performance.native.ts .artifacts/player-checks-phone --checks
COUCH_PERF_REDUCED_MOTION=1 bun tests/player-performance.native.ts .artifacts/player-checks-reduced --checks
```

The first command writes raw frame/transition samples, actual display frequency,
GPU feature status and runtime versions to `result.json`. Add `--trace` for an
Electron/Chromium `trace.json`. `--assert-budget=60` checks cold and repeated
navigation against 16.67 ms plus 1 ms of scheduling jitter. `--assert-budget=120`
uses 12.5 ms to detect a missed 120 Hz interval; that stricter target still fails.
Clock updates arrive every 250 ms by default (`--clock-ms=0` disables them).
Set `COUCH_PERF_AUDIO` to a local MP3 to include continuous, silent decoding;
the report verifies that playback keeps advancing. Run timing samples serially,
without another build or test competing for the CPU.

`--checks` uses React's profiling build for commit assertions and runs artwork,
clock isolation, player transitions/Remote navigation/footer clearance, and player
status regressions. Performance samples use the ordinary minified React build.
The harness uses an ephemeral loopback port and its own data directory, exits its
own Electron process, and leaves the owner's installed Couch untouched. Narrow
windows exercise phone layout, not phone hardware.

### Player polish follow-up

The collapsed player no longer renders `Level`; its title stays on one line,
including keyboard focus, above its metadata. In the production Electron visual
fixture at 1440 × 868, the reported long title made the bar 104.375px tall before
and 90px after. At 390px wide the updated bar is 64px tall. The full title remains
in the accessible name, tooltip and player. The transition regression now uses
that long title with a creator link and checks focused height too.

The transport's apparent glass contour was overlapping translucent SVG fill and
stroke. Opaque ink with opacity on the whole SVG keeps Play/Pause, Stop and Next
flat, including disabled states. Channel artwork in the large header now keeps a
square circular mask instead of inheriting a non-square image's proportions or
the transparent-logo exemption. A 2:1 avatar fixture changed from 576 × 288px to
576 × 576px, without stretching its contents.

Desktop and 390px native regression checks, typechecking, and 17 unit tests pass.
Before/after screenshots and geometry are under `.artifacts/player-polish/`.
A fresh 12-round timing sample (`.artifacts/player-polish-performance/result.json`)
has a median interval of 8.3ms, p95 9.1ms, maximum 17.4ms and 20 intervals above
12.5ms, with no long tasks or rejected transitions. The strict 120Hz budget still
fails; this single follow-up run does not establish another frame-rate improvement.

### Platform guidance checked

[React's effect guidance](https://react.dev/learn/you-might-not-need-an-effect)
recommends deriving render data without a second effect-driven render, while
keeping effects that synchronize external systems. Removing all player effects
would also remove necessary focus, fullscreen, timer and media synchronization.

[React 19.3's ViewTransition](https://react.dev/reference/react/ViewTransition)
is now stable and coordinates rendering and snapshots itself. This repo uses
19.2.8 and previously used [TanStack Router's native view-transition integration](https://tanstack.com/router/latest/docs/framework/react/examples/view-transitions).
A 19.3.1-only upgrade did not improve the fixture; replacing the router trigger
with a shared React boundary did not activate that transition in this app's
current routing path. Neither experiment is included. A complete integration
would need to preserve shared artwork, controls, reduced motion and Back/Remote
semantics, with fresh measurements rather than assuming the API is faster.

[Chromium's view-transition documentation](https://developer.chrome.com/docs/web-platform/view-transitions/same-document)
explains the old/new snapshot capture. Removing control morphs alone did not
remove the navigation gaps; temporarily disabling the bar's blur improved one
sample but did not meet the budget. The trace and React profiler directed these
fixes toward mount/layout work. [Electron's title-bar documentation](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)
confirms that overlay height sizes the native controls; it is independent of the
renderer header and can also be omitted to use the system default.

### Deeper pass: a repeatable 60 fps navigation floor

Reviewed [Vercel's React best practices](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices)
again, especially narrowing subscriptions, deriving render data without effects,
conditional work and avoiding layout thrashing. The retained changes are:

- Home's progress and Up next timetable own their clocks. A clock tick no longer
  renders Home's hero and shelves. The player end-time isolation remains.
- Closed Playback, Volume and Where it plays panels do not calculate their
  trigger geometry. The overlay queue measures its origin only while open.
- ResizeObserver callbacks consume the delivered border-box size instead of
  forcing another `offsetHeight` read after publishing CSS sizes. The initial
  footer measurement remains in a layout effect because clearance must be right
  in the same commit that restores the bar.
- Player entry and the restored bar use a 160 ms CSS opacity animation. The
  native shared-element snapshot path is removed. Reduced motion skips the fade.
  Routing, menu behavior and focus restoration retain their existing APIs.

The regressions failed before these fixes: closed panels performed three
geometry reads on playback updates; Home read current artwork six times for two
clock ticks instead of the two reads from its OS media-session bridge. Both now
pass while progress/end times still advance. Necessary effects for external
systems and focus remain; removing effects indiscriminately would break those
contracts. [React's layout-effect guidance](https://react.dev/reference/react/useLayoutEffect)
and [ResizeObserver's borderBoxSize](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserverEntry/borderBoxSize)
explain the distinction between same-commit measurement and using sizes already
provided by the browser.

Longer controlled trials ruled out artwork-only snapshots, a root snapshot
crossfade and removing the bar's blur: each still produced gaps around 25 ms.
The native capture path was the remaining repeatable cost. This final comparison
isolates that change: **both sides already include clock isolation, lazy panels
and the ResizeObserver fixes**. The before side restores the previous native
transition; the after side uses the retained opacity animation.

Same M5 Pro and 120 Hz display, full-size 1512 × 950 CSS-pixel viewport at DPR 2,
production React build, hardware acceleration, one fresh Electron profile per
run. Three serial runs per variant, 40 open/Back round trips per run, plus the
first cold player open and return. A local stereo 48 kHz MP3 decodes continuously
at zero volume and the real clock context receives updates every 250 ms. Both
variants observe each navigation for 450 ms. API/session data and artwork remain
deterministic; this is not a live-network or Core/Sendspin end-to-end test.

| Measurement | Native snapshots | Opacity entry |
| --- | --- | --- |
| Repeated round trips | 120 | 120 |
| Warm frame samples | 12,786 | 12,928 |
| Warm gaps above the 60 fps floor | 31 (8 / 14 / 9) | **0 / 0 / 0** |
| Cold gaps above the floor | 1 | **0** |
| Worst warm gap | 25.9 ms | **17.6 ms** |
| Median interval | 8.3 ms | 8.3 ms |
| Per-run p95 interval | 8.8–8.9 ms | 8.8–8.9 ms |
| Per-run median click-to-DOM-commit | 16.3–17.2 ms | **12.3–13.6 ms** |
| Warm gaps above 12.5 ms | 160 | 47 |
| Estimated missed 120 Hz intervals | 190 | 47 |
| Tasks over 50 ms / transition errors | 0 / 0 | 0 / 0 |

The 60 fps floor is 16.67 ms plus 1 ms for timestamp/scheduling jitter on this
120 Hz display; it detects gaps beyond two refresh intervals. All three after
runs pass including cold entry. This finite sample supports the tested 60 fps
floor, **not a guarantee for every workload, nor stable 120 fps**. rAF samples
measure scheduling cadence rather than GPU presentation. Click-to-DOM-commit
uses a MutationObserver and does not claim that the new page was already painted.

Raw results: `.artifacts/perf-deep/before-audio-{1,2,3}/result.json` and
`.artifacts/perf-deep/final-audio-{1,2,3}/result.json`. Earlier diagnostic traces
and rejected variants are also under `.artifacts/perf-deep/`. To recreate the
silent decoding workload locally:

```sh
ffmpeg -f lavfi -i sine=frequency=440:sample_rate=48000 -t 16 -ac 2 -codec:a libmp3lame .artifacts/benchmark.mp3
COUCH_PERF_AUDIO=.artifacts/benchmark.mp3 COUCH_PERF_WIDTH=1512 COUCH_PERF_HEIGHT=982 bun tests/player-performance.native.ts .artifacts/player-audio --rounds=40 --assert-budget=60
```

The broader `--shell-navigation` workload visits Saved, Settings and Remote from
Home and returns through the real navigation links. Three full-size, 40-round
runs with the same audio and clock load also pass including the first visit to
each page: no gaps above the floor, worst warm gap 17.1 ms, no long tasks.
Evidence: `.artifacts/perf-deep/final-shell-{1,2,3}/result.json`.

At 390 × 812 CSS pixels on this same Mac, three 40-round player runs had no warm
gaps above the floor, worst 17.6 ms. **The first run failed cold Back at 24.7 ms**;
the next two passed cold and warm. The failed sample remains in
`.artifacts/perf-deep/final-phone/result.json`, with repeats in `final-phone-2`
and `final-phone-3`. Additional traced/probed runs found the required footer
measurement and Stage's subsequent scroll-position check; they did not reproduce
the gap. No further change is claimed from that diagnostic. This is a narrow
web layout (below the native desktop window's 800px minimum), not measured phone
hardware or an unconditional cold-navigation guarantee.

Final validation: typechecking and 18 unit tests pass. All four browser regression
suites pass at desktop width, at 390px, and with reduced motion: cached artwork
mounts, clock/closed-panel isolation, navigation/focus/footer clearance, and player
status. The earlier Windows caption-height fix and player visual polish remain;
Windows 11 native/DPI validation still requires a Windows machine. These changes
are in the checkout and have not replaced the installed preview.
