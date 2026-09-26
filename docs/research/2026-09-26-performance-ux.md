# Performance and UX audit — 2026-09-26

This audit traces search input through React, TanStack Query, HTTP and the session WebSocket; production route loading; authenticated artwork; and native playback updates. Five implementation layers address concrete unnecessary work. The final layer records evidence and remaining opportunities. It builds on `couch/home`; it does not change the previous release stack, dependencies, workflows, native packaging, or the visual design system.

## Findings and changes

| Area | Finding | Implemented behavior |
| --- | --- | --- |
| Search requests | Search **already** had a 300 ms trailing debounce and cancellation. It did not normally request results for every keystroke. Supporting queries nevertheless refetched on successive searches, and Library/Jellyfin results were immediately stale. | Keep debounce/cancellation. Give results and supporting metadata/favorites a 30 s freshness window; provider results retain their existing 60 s window. Keep pushed-domain invalidation, per-connection QueryClient ownership, and explicit Enter refresh. |
| Library / Jellyfin | Each first Library page fetched folder status again. Each Jellyfin page first requested connection status. | Share existing Query source/status keys. Library data and folder status load concurrently; Jellyfin pages reuse connected status. Status failures remain visible and independently retryable. |
| Radio | Every query downloaded the entire built-in radio catalogue and filtered it locally. | Cache the catalogue under a query-independent key and filter with Query's observer `select`. Other radio sources keep query-specific keys. Explicit refresh still works. |
| Input rendering | Every draft change rebuilt the interleaved hits array and all result rows. The global type-to-search listener was also replaced after each edit. | Memoize the derived hits and `HitList`; use an Effect Event for the listener's latest values. Input remains immediately controlled. Result updates still invalidate the memo. This does not claim to isolate every facet or context render. |
| Input composition | The debounce and Enter could search unfinished IME composition. | Suspend automatic search during composition; restart debounce after composition ends. Suppress composing Enter, including the WebKit keyCode 229 case. Clear and ordinary Enter retain their behavior. |
| Route startup | File-based routes were all imported eagerly despite having the Router Vite plugin. | Enable official automatic route splitting and `defaultPreload: "intent"`. Keep route guards and hash/browser histories. |
| Activity traffic | Every keydown/pointerdown could POST `/api/activity` once the previous response completed, independently of search debounce. | Send immediately, then at most once per second with a trailing update. Abort pending I/O and clear the timer on disconnect, unpair, or credential change. |
| Artwork | Authenticated images fetched blobs eagerly, before a browser could apply image lazy loading. | Enable the Query request within a 300 px viewport margin, use lazy/async image decoding, and preserve cancellation and object-URL cleanup. Browsers without IntersectionObserver fall back to loading. |

Freshness windows are not hard refresh prohibitions: explicit invalidation and retries still fetch. The existing session gate invalidates the relevant domains on server changes and revalidates on reconnect. Cache ownership continues to change on credentials, installation, and authority, so these optimizations do not share private results across connections.

The artwork observer is a deliberate small customization: native `<img loading="lazy">` cannot delay a separate authenticated `fetch()` that has already started. Existing Query, image placeholders, shadcn InputGroup, rows, and focus behavior are reused; no new UI component or visual system was introduced.

## Local validation and measurements

Final targeted run:

```sh
bun run typecheck
bun --bun vite build
bun test --isolate \
  src/client/sections/find/SearchPanel.test.tsx \
  src/client/sections/find/SearchQueries.test.tsx \
  src/client/sections/find/SearchSource.metadata.test.tsx \
  src/client/sections/find/BrowseCatalog.test.tsx \
  src/client/sections/find/FindPage.navigation.test.tsx \
  src/client/session/connection-lifetime.test.tsx \
  src/client/components/AuthArtwork.test.tsx \
  src/client/routes.test.tsx \
  src/client/sections/shell/AppShell.test.tsx
```

**50 tests passed, 0 failed, 473 assertions, about 6.1 seconds.** TypeScript and production build passed. Existing pagination fixtures emit duplicate-key warnings because their mock pages repeat IDs; these warnings are not a new runtime assertion failure. Some asynchronous fixture updates also emit React act warnings. Neither is counted as evidence of clean browser diagnostics.

Behavioral checks establish:

- Two different searches use one request each for provider favorites, radio favorites, saved items, folder status, Jellyfin status, and the built-in radio catalogue within the freshness window.
- Returning to the first fresh query sends no additional requests; Jellyfin pagination does not re-fetch status.
- Enter still refreshes provider, local, and radio results. Superseded provider reads abort and cannot replace current results.
- During a 350 ms composition pause, even a form submit sends no search requests. Composition end starts the ordinary debounce.
- A 12-key burst produces one immediate and one trailing activity report; unpair cancels a subsequent scheduled report.
- Offscreen authenticated artwork sends zero requests until intersection, sends the bearer header when needed, and aborts on unmount. The unsupported-observer fallback also works.
- Existing connection retirement, revoked-socket callbacks, offline-indicator behavior, role changes, merged search actions, pagination, collection focus, and both route histories remain covered.

### Production bundle

Measured with the same local Vite build before enabling route splitting and after all implementation layers. The baseline already includes the first cache layer; this isolates loading changes more closely than a comparison against an older release. Values are Vite's decimal kB, except precache totals, which Workbox reports in KiB.

| JavaScript / offline assets | Before | After |
| --- | ---: | ---: |
| Entry plus eagerly module-preloaded shell, minified | 912.91 kB | 796.54 kB |
| Same, gzip | 279.65 kB | 249.34 kB |
| Entry + shell + first `/find` route dependencies, minified | 912.91 kB | 846.74 kB |
| Same `/find` dependency set, gzip | 279.65 kB | 265.80 kB |
| Full PWA precache, all assets | 1223.05 KiB / 19 entries | 1237.61 KiB / 48 entries |

The core graph is about 12.7% smaller; a direct Find visit loads about 7.2% less minified JavaScript. This is **not** a claim that the full offline download shrank: splitting adds small chunk overhead, and the worker still precaches all routes. No wall-clock startup, CPU, battery, or native frame-rate gain is claimed from these size measurements.

### Collaborative production browser

Used an isolated local coordinator on port 4197 with a temporary database and a simulated idle player, serving the actual Vite output. No user installation was modified.

- Loaded `/find` directly, paired through the UI, and observed connected Find content.
- Navigated to Saved and observed its separate route chunk load and render.
- Loaded `/settings/appearance` directly and observed its controls render.
- Typed a 29-character media URL at 20 ms per character: **2 activity requests**, **0 catalogue searches**, and the pasted-link controls appeared after debounce. This complements, rather than replaces, the search query tests.
- Find's pasted-link view had no document horizontal overflow at 1280 px or 390 px widths.

The collaborative preview's snapshot/screenshot operation failed repeatedly; DOM evaluation, text insertion, form submission, route navigation, resource inspection, and resizing worked. No screenshot or broad visual-qualification claim is made. This checks the browser build, not physical TV focus hardware, native mpv playback, or every settings screen.

No GitHub Actions were dispatched. Stack commits carry `[skip ci]` to suppress push/pull-request workflows when the PRs are published. Packaging and workflow files were not changed.

## Native WebSocket decision

Couch currently uses the browser WebSocket API for both remote browsers and Tauri WebViews. The official Tauri plugin opens a socket in Rust and forwards events through Tauri IPC/Channel. It is a supported native transport, **not a documented performance shortcut**. Both browser and native transports ultimately deliver state into the same React tree. See the [official plugin guide](https://v2.tauri.app/plugin/websocket/) and [plugin JavaScript source](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/websocket/guest-js/index.ts).

A transport migration was not made without native evidence. It must account for:

- asynchronous connect/send failures and command-confirmation bookkeeping;
- native capability scopes, WSS/TLS support, and retained browser fallback;
- the server's Origin checks, without broadening trust to make native requests work;
- Close messages 4001 (pair again) and 4002 (invalid response), while the plugin's convenience disconnect sends 1000;
- initial message delivery: Couch sends state immediately when a socket opens; the plugin's listener registration happens after asynchronous connect;
- late connection completion after unmount, stale credentials, reconnect backoff, and revocation.

Before choosing that migration, compare actual WebView versus native transport on the same queue and playback workload. A native transport cannot by itself remove oversized snapshots or React context updates.

## Further opportunities, ordered by expected value

1. **Playback snapshot/render scope.** The native player polls every 250 ms. `hub.ts` serializes the full SessionState including queue; `useSession` replaces the state object; SessionGate exposes it through one context. The server already suppresses live radio/IPTV position-only ticks, but ordinary playback can still update unrelated consumers. Capture React commit costs and socket bytes with a realistic long queue on target hardware before splitting contexts or introducing protocol deltas. Delta messages require a compatible desktop protocol/reconnect design, not an unversioned optimization.
2. **Root-shell imports.** The split build still eagerly loads a roughly 472 kB shell chunk, including shared dialogs/settings dependencies. A later measured pass can defer infrequently opened settings/dialog contents, with loading, error and focus-return behavior preserved. Do not confuse a small entry file with a small total initial graph.
3. **Long result lists.** Providers cap displayed items and paginate; local/radio lists can still grow. Profile scrolling and keyboard navigation with large real catalogues before adopting TanStack Virtual. Virtualization needs an explicit TV-focus strategy; removing offscreen focus targets without one would regress UX.
4. **Cross-source fan-out.** Find intentionally queries hidden source panes to compute all-source results and facet counts. Disabling everything outside the selected filter would change product behavior. The short caches and shared metadata remove redundant work without that semantic change. `BrowseHome` itself currently has no queries; its separate `SourcesStatus` component does. Hidden DOM alone is not proof of hidden network work.
5. **React Compiler / additional TanStack packages.** React is already 19.2.8. Existing Query cancellation, scoped cache ownership, domain invalidation, Effect Events, and controlled inputs are useful modern foundations. Compiler adoption deserves a measured integration against the current Vite plugin, not a dependency/configuration change assumed to fix broad context subscriptions. Pacer would become useful if debounce lifecycle is shared widely; a cleaned-up timer remains sufficient here. No package upgrade is required for these improvements.

## Official references

Research used React and Tauri's official sites plus Markdown from the official TanStack repositories when the docs site blocked retrieval. The web search connector was unavailable, so primary documents were fetched directly over HTTPS.

- [React controlled-input render performance](https://react.dev/reference/react-dom/components/input#optimizing-re-rendering-on-every-keystroke), [memo](https://react.dev/reference/react/memo): a stable result boundary can skip unrelated draft renders.
- [React useDeferredValue](https://react.dev/reference/react/useDeferredValue): deferral does not debounce network requests; it is not a replacement for the existing timer.
- [React useEffectEvent](https://react.dev/reference/react/useEffectEvent): effect-owned listeners can read latest callbacks/state without resubscribing.
- [TanStack Query defaults](https://github.com/TanStack/query/blob/main/docs/framework/react/guides/important-defaults.md), [cancellation](https://github.com/TanStack/query/blob/main/docs/framework/react/guides/query-cancellation.md), [render optimization/select](https://github.com/TanStack/query/blob/main/docs/framework/react/guides/render-optimizations.md), [invalidation](https://github.com/TanStack/query/blob/main/docs/framework/react/guides/query-invalidation.md): intentional freshness, consumed abort signals, observer-level selection, and explicit revalidation.
- [Router automatic code splitting](https://github.com/TanStack/router/blob/main/docs/router/guide/automatic-code-splitting.md), [preloading](https://github.com/TanStack/router/blob/main/docs/router/guide/preloading.md): first-class Vite splitting and intent preloading.
- [Pacer React debouncing](https://github.com/TanStack/pacer/blob/main/docs/framework/react/guides/debouncing.md): an available abstraction when the app needs shared debounce lifecycle controls.
- [Intersection Observer API](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API): asynchronous visibility observation and root margins, used here to defer authenticated network reads.
