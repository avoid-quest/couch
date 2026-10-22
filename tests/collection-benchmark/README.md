# Collection rendering benchmark

This optional production fixture reuses the real routes, CSS and UI audit data.
It uses no Core, live playback or installed data. Requirements: pinned Bun,
Python 3, Chromium with the Long Tasks API, and an otherwise idle machine.
Run from the repository root:

```sh
python3 tests/collection-benchmark/prepare.py
./node_modules/.bin/bun tests/collection-benchmark/build-prod.ts
cp tests/collection-benchmark/measure.js build/couch-review-render/prod/
./node_modules/.bin/bun --bun vite preview --host 127.0.0.1 --port 1431 --strictPort --outDir "$PWD/build/couch-review-render/prod"
```

Record the server PID and stop that PID when done. All generated files live in
ignored `build/couch-review-render`. Open `http://localhost:1431/prod.html` in a
separate browser tab. Wait for `window.reviewReady === true`, set the viewport
to 1440×900, and evaluate:

```js
await import('/measure.js');
await window.runCollectionRenderRegression();
```

Repeat at 390×844. The assertion seeds 1,000 items, retains 24 visible items,
warms for one second, then scrolls for four seconds while replacing the session,
queue, devices and player with equivalent copies at 2 Hz. It requires fewer
than two long tasks and at least 55 fps. A failure retains its measurement in
`window.collectionRegressionResult`. Timing depends on host load; the companion
`tests/collection-rendering.browser.ts` checks redundant offscreen derivation
and action freshness without a frame-rate threshold.

For a baseline, build the same fixture in an isolated checkout at `cc98df0`
(the parent of the rendering fix), using these same benchmark scripts. Preserve
its output separately with `COUCH_RENDER_OUTPUT=/absolute/output/path`. Compare
on the same browser, viewport, DPR and host load; run sequentially. The
[recorded results](../../docs/preview-readiness-evidence.json) use Chromium 154,
Linux software compositing and DPR 2. This replay does not represent normal
Core update frequency or media decoding cost.

For optional Linux CPU sampling, identify the renderer PID for your own tab.
Start the replay before the eight-second sampler, run six seconds of scrolling
while it samples, then await sampling completion before clearing the replay:

```js
window.replay = setInterval(() => window.review.pulse(), 500);
// In a terminal: python3 tests/collection-benchmark/sample-cpu.py <renderer-pid> 8
await window.measureRender({ ms: 6000, scroll: true });
// After sampling finishes:
clearInterval(window.replay);
```

CPU percentages refer to one core. Never stop the shared browser process.
