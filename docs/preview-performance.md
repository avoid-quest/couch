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
