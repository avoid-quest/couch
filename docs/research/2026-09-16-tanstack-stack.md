# TanStack stack research — 2026-09-16

## Versions

The following are the npm `latest` dist-tags queried from registry.npmjs.org on 2026-09-16 at 18:00 UTC. Install the React adapter; the matching framework-agnostic core is normally a transitive dependency unless a vanilla use case calls for it directly.

- `@tanstack/react-router@1.170.36` is the Router React adapter. It requires `react` and `react-dom` matching `>=18.0.0 || >=19.0.0`. Its Router dependencies are `@tanstack/router-core@1.171.30` and `@tanstack/history@1.162.4`; it also depends on `@tanstack/react-store@^0.11.0`. File-based routing with Vite also uses `@tanstack/router-plugin@1.168.38` as a dev dependency. The plugin's Vite peer is optional and accepts Vite 5, 6, 7, or 8.
- `@tanstack/react-start@1.168.54` is relevant only if Couch adopts Start. Start depends on Router `1.170.36` and accepts Vite `>=7.0.0` or `@rsbuild/core@^2.0.0`; both bundler peers are optional. React and ReactDOM are also peers. TanStack markets Start as an RC-level product even though npm has a `latest` tag.
- `@tanstack/react-query@5.103.1` is the Query React adapter. It requires React `^18 || ^19` and depends on `@tanstack/query-core@5.103.1`.
- `@tanstack/react-pacer@0.23.0` is the Pacer React adapter; the product remains in beta. It requires React and ReactDOM `>=16.8` and depends on `@tanstack/pacer@0.22.0` plus `@tanstack/react-store@^0.11.1`.
- `@tanstack/react-db@0.4.1` is the DB React adapter and DB remains pre-1.0/beta. It requires React `>=16.8.0` and depends on `@tanstack/db@0.9.2`. REST integration adds `@tanstack/query-db-collection@1.2.15`, which peers with `@tanstack/query-core@^5.0.0` and TypeScript `>=4.7` and depends on `@tanstack/db@0.9.2`.
- `@tanstack/react-store@0.11.1` is the Store React adapter; the product is still labeled alpha. It requires React/ReactDOM `^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0` and depends on `@tanstack/store@0.11.1`.
- `@tanstack/react-hotkeys@0.10.0` is an official TanStack React adapter for Hotkeys, with core `@tanstack/hotkeys@0.8.0`; Hotkeys is alpha. It requires React and ReactDOM `>=16.8`.

## Router, Vite, and Tauri

TanStack Router supports both file-based and code-based routes. File-based routing is recommended: the Vite plugin scans `./src/routes`, generates `./src/routeTree.gen.ts`, and can auto-split route code. It must be ordered before the React plugin. Code-based routing constructs `createRootRoute`/`createRoute` objects and `addChildren`; the docs explicitly do not recommend it for most applications. Either way, the resulting tree is passed to `createRouter({ routeTree })`, and the router is rendered with `<RouterProvider router={router} />`.

For a pure Vite SPA, the Router Vite plugin is all that is needed; Start is not required. The native/Tauri build can use `createHashHistory()`:

```ts
import { createHashHistory, createRouter, RouterProvider } from '@tanstack/react-router'

const router = createRouter({ routeTree, history: createHashHistory() })
```

That is the right fit when the embedded environment does not rewrite arbitrary paths to `index.html`, which is exactly the use case TanStack identifies for hash routing. The web build should omit `history`, because Router creates `createBrowserHistory()` by default. If assets or a protocol mount are not at `/`, set `basepath`; Router otherwise uses `/` and derives origin from the browser, falling back to `http://localhost` for opaque origins or the server.

Router alone does not provide Start's SPA-shell/prerendering feature. A normal Vite Router app is client-rendered. TanStack Start has a separate `spa.enabled` mode that prerenders a `/_shell.html` root shell and can optionally crawl/prerender more routes through Start's prerender options. That is relevant only if Couch wants a Start-built web shell/SSG; it is not required for, and adds complexity to, a Tauri-only static SPA.

## Query and the WebSocket boundary

Use `@tanstack/react-query` directly with the existing React/Vite app. In a SPA, create one app-lifetime `QueryClient` outside the component tree (or in stable module/app state), wrap the app in `QueryClientProvider`, and use `useQuery`/`useMutation`. The provider calls `client.mount()` and `client.unmount()`, which subscribes Query to focus and online events. The current defaults treat cache entries as stale immediately, refetch on mount/focus/reconnect, garbage-collect inactive queries after five minutes, and retry failed queries three times with exponential backoff.

REST resources—playlists, recordings, and settings—belong in Query. They are request/response server state with identities, staleness, refresh, invalidation, and mutation semantics. Give each collection a stable query-key shape, use `useMutation` for writes, and invalidate or patch the corresponding query on success.

The single live WebSocket session-state channel should not be modeled as a Query. It is a long-lived, ordered subscription plus connection lifecycle, not a promise-shaped fetch; putting the socket object in Query's serializable cache is inappropriate. Keep the singleton socket and its connection state in a small service exposed through context, `useSyncExternalStore`, or TanStack Store. Its event handler can still call `queryClient.setQueryData` or `invalidateQueries` when events correspond to REST entities, so the WebSocket remains the transport while Query remains the REST cache. Query's core docs define server state and request synchronization, while its v4 community page explicitly says real-time notifications can use event subscriptions or pushed data, including the browser WebSocket API. Current Query core documentation has no first-class WebSocket resource type.

## Pacer

Pacer controls when functions execute: debounce, throttle, rate-limit, queue, and batch. The docs mark it beta. React helpers include `useDebouncedCallback`, `useThrottledCallback`, and `useRateLimitedCallback`; value-oriented helpers include `useDebouncedValue` and `useThrottledValue`; lower-level instance hooks include `useDebouncer`, `useThrottler`, and `useRateLimiter`, with async variants available. Pacer is useful for search input delays, expensive UI updates, and enforcing API/reconnect action limits, but it is not a substitute for Query caching or the WebSocket lifecycle.

## DB

TanStack DB is a reactive client data layer that extends Query with normalized collections, cross-collection live queries, and optimistic mutations. React integration uses `DbClient`/`DbProvider` and `useLiveQuery`; REST data can enter `queryCollectionOptions` collections through TanStack Query.

It should not be recommended for Couch right now. It is pre-1.0/beta, its React docs describe behavior that changes at 1.0, and the existing REST surface does not demonstrate a need for a normalized client graph, cross-collection joins, or transactional optimistic mutation machinery. Adding it now would violate YAGNI. Revisit it if endpoint sprawl, repeated client-side joins, or complex multi-entity optimistic writes become real problems.

## Store

TanStack Store is a small framework-agnostic reactive store used internally by many TanStack libraries and usable standalone. In React, create a store (or atom), read selected state with `useSelector`, and update through store APIs; `useStore` is a deprecated alias. Store fits client-local state, derived values, and the live WebSocket connection/session state. TanStack's own placement guidance says Query owns asynchronous server resources and freshness, Router owns URL/navigation state, DB owns relational API data, and Store owns reactive client state. It is alpha, so avoid introducing it merely to replace existing React state unless a concrete need appears.

## Hotkeys

TanStack Hotkeys is official and maintained under TanStack, not merely the unrelated `react-hotkeys` ecosystem. Official docs describe type-safe, framework-agnostic hotkey handling and explicitly state that it is alpha. The React quick start installs `@tanstack/react-hotkeys` and provides `useHotkey`, sequences, recording, key-hold tracking, platform display formatting, and optional devtools. Treat it as an option, but avoid adopting it before the API stabilizes unless keyboard customization is a near-term requirement.

## Sources

- npm registry metadata queried 2026-09-16: <https://registry.npmjs.org/@tanstack%2Freact-router>, <https://registry.npmjs.org/@tanstack%2Frouter-core>, <https://registry.npmjs.org/@tanstack%2Fhistory>, <https://registry.npmjs.org/@tanstack%2Freact-start>, <https://registry.npmjs.org/@tanstack%2Freact-query>, <https://registry.npmjs.org/@tanstack%2Freact-pacer>, <https://registry.npmjs.org/@tanstack%2Fpacer>, <https://registry.npmjs.org/@tanstack%2Freact-db>, <https://registry.npmjs.org/@tanstack%2Fdb>, <https://registry.npmjs.org/@tanstack%2Fquery-db-collection>, <https://registry.npmjs.org/@tanstack%2Freact-store>, <https://registry.npmjs.org/@tanstack%2Fstore>, <https://registry.npmjs.org/@tanstack%2Freact-hotkeys>, <https://registry.npmjs.org/@tanstack%2Fhotkeys>, and <https://registry.npmjs.org/@tanstack%2Frouter-plugin>.
- Router: <https://tanstack.com/router/latest>, <https://tanstack.com/router/latest/docs/installation/with-vite>, <https://tanstack.com/router/latest/docs/installation/manual>, <https://tanstack.com/router/latest/docs/framework/react/routing/file-based-routing>, <https://tanstack.com/router/latest/docs/framework/react/routing/code-based-routing>, <https://tanstack.com/router/latest/docs/framework/react/guide/creating-a-router>, <https://tanstack.com/router/latest/docs/guide/history-types>, and <https://tanstack.com/router/latest/docs/api/router/RouterOptionsType>.
- Start SPA/prerendering: <https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode> and <https://tanstack.com/start/latest/docs/framework/react/guide/static-prerendering>.
- Query: <https://tanstack.com/query/latest/docs/framework/react/overview>, <https://tanstack.com/query/latest/docs/framework/react/installation>, <https://tanstack.com/query/latest/docs/framework/react/quick-start>, <https://tanstack.com/query/latest/docs/framework/react/reference/QueryClientProvider>, <https://tanstack.com/query/latest/docs/framework/react/reference/QueryClient>, <https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults>, <https://tanstack.com/query/latest/docs/framework/react/guides/network-mode>, <https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr>, and <https://tanstack.com/query/v4/docs/framework/react/community/tkdodos-blog>.
- Pacer: <https://tanstack.com/pacer/latest/docs/overview>, <https://tanstack.com/pacer/latest/docs/installation>, and <https://tanstack.com/pacer/latest/docs/framework/react/reference/index>.
- DB: <https://tanstack.com/db/latest/docs/overview>, <https://tanstack.com/db/latest/docs/installation>, and <https://tanstack.com/db/latest/docs/framework/react/overview>.
- Store: <https://tanstack.com/store/latest/docs/overview>, <https://tanstack.com/store/latest/docs/installation>, <https://tanstack.com/store/latest/docs/framework/react/quick-start>, <https://tanstack.com/store/latest/docs/framework/react/reference/functions/useSelector>, and <https://tanstack.com/store/latest>.
- Hotkeys: <https://tanstack.com/hotkeys/latest/docs/overview>, <https://tanstack.com/hotkeys/latest/docs/installation>, and <https://tanstack.com/hotkeys/latest/docs/framework/react/quick-start>.
