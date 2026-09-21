# couch

## 0.1.5-preview.8

### Patch Changes

- [#393](https://github.com/avoid-quest/couch/pull/393) [`a6dc1f1`](https://github.com/avoid-quest/couch/commit/a6dc1f1fb965c9f994697e6f909bd0e96bf8bcbd) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Polish the now-playing hero and Recently played: the hero spans the full content width with the volume slider on the transport button row, and Recently played follows one shared merge rule on Home and Find. Every kind shows up with its own actions: live stations play immediately, media keeps resume, watching options and details. Find's Recently played cards fill their grid cell with real poster boxes, the Live radio rail lists every catalog station instead of the first eight, and the programme link, queue empty state and offline copy are settled.

- [#393](https://github.com/avoid-quest/couch/pull/393) [`a6dc1f1`](https://github.com/avoid-quest/couch/commit/a6dc1f1fb965c9f994697e6f909bd0e96bf8bcbd) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Rework the TV now-playing experience with Big-picture patterns: spatial keyboard/remote navigation on the TV shell, uniform interface scaling steps (the old TV-only multipliers double-scaled text over icons), settings presented as shadcn cards at full width, a single now-playing info surface with clamped programme metadata, a slim icon sidebar, a session bar that stays available on the TV home and returns to the playback view, and no playback-on select in the TV header. Also fix the Linux preview build, which could not resolve the client entry because `vite.config.ts` was missing from the copied sources.

## 0.1.5-preview.7

### Patch Changes

- [#390](https://github.com/avoid-quest/couch/pull/390) [`ba728d3`](https://github.com/avoid-quest/couch/commit/ba728d3984d23aed910477243ce897fa0e6e663a) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Query the Couch shell's logical size for settings navigation and oversized TV headers, and keep a remote's device name when a stale pairing must be replaced.

## 0.1.5-preview.6

### Patch Changes

- [`ebcc334`](https://github.com/avoid-quest/couch/commit/ebcc3342caefe7c03f0dad0acd7808052979a34b) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Let the TV host manage every admin settings page: Connections, Sound,
  Bluetooth, Display, TV appearance, Advanced, General, and Updates checked only
  for the `"administrator"` authority and ignored the TV's own `"host"` authority,
  so the TV saw "An administrator can manage..." instead of the management UI.

## 0.1.5-preview.5

### Patch Changes

- [`7e838ed`](https://github.com/avoid-quest/couch/commit/7e838ed5c5938f34b63470429164a1c6e8dd5f8d) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Replace `import.meta.env.DEV` in the Bun-embedded client build: the server
  binary's bundled copy of the client crashed with `Cannot read properties of
  undefined (reading 'DEV')` because Bun.build does not perform Vite's
  `import.meta.env` substitution. Adding the define to the server build fixes the
  production client served at the Couch server port.

## 0.1.5-preview.4

### Patch Changes

- [#384](https://github.com/avoid-quest/couch/pull/384) [`97b8756`](https://github.com/avoid-quest/couch/commit/97b87561565e113920e0ce7f8597b2a90f5f66f4) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Wire the installable PWA shell ([#338](https://github.com/avoid-quest/couch/issues/338)): vite-plugin-pwa precaches the built app
  shell only, registration stays in the browser path, and the Tauri webview keeps
  its native update path. Every API and WebSocket request remains on the network.
  LAN installs still wait on a trusted HTTPS origin.
- Rebuild the web client with Vite and file-based TanStack Router
  ([#367](https://github.com/avoid-quest/couch/pull/367),
  [#368](https://github.com/avoid-quest/couch/pull/368),
  [#370](https://github.com/avoid-quest/couch/pull/370)), then split and rewrite
  the scoped Now ([#373](https://github.com/avoid-quest/couch/pull/373)), Saved
  ([#374](https://github.com/avoid-quest/couch/pull/374),
  [#379](https://github.com/avoid-quest/couch/pull/379)), music and radio
  ([#375](https://github.com/avoid-quest/couch/pull/375)), Find
  ([#376](https://github.com/avoid-quest/couch/pull/376)), source settings
  ([#372](https://github.com/avoid-quest/couch/pull/372)), device and system
  settings ([#377](https://github.com/avoid-quest/couch/pull/377)), and shell
  ([#378](https://github.com/avoid-quest/couch/pull/378)) sections.
- Add the StreamingCommunity explorer, search, and saves
  ([#381](https://github.com/avoid-quest/couch/pull/381)), provider badges for
  source playlists ([#382](https://github.com/avoid-quest/couch/pull/382)),
  persisted drag-and-drop ordering
  ([#383](https://github.com/avoid-quest/couch/pull/383)), the web client UX and
  Connections page ([#386](https://github.com/avoid-quest/couch/pull/386)), and
  unified atom-and-list provider playback
  ([#387](https://github.com/avoid-quest/couch/pull/387)).
- Fix TanStack client boot and route rendering, connect the Vite dev server to
  couch-server, add a Playwright client memory accumulation loop, and sample TV
  cgroup memory into the journal every minute.
- Complete the GitHub mirror after delayed CDN readiness
  ([#354](https://github.com/avoid-quest/couch/pull/354)), write GitHub release
  notes only at creation ([#356](https://github.com/avoid-quest/couch/pull/356)),
  and point the StreamingCommunity default at streamingcommunityz.academy
  ([#351](https://github.com/avoid-quest/couch/pull/351)).

## 0.1.5-preview.3

### Patch Changes

- [#349](https://github.com/avoid-quest/couch/pull/349) [`373efa7`](https://github.com/avoid-quest/couch/commit/373efa7edfeb0d9599de2bec375a5a0d5152d301) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Automate release versioning and changelogs with changesets: release notes are
  assembled from per-PR changesets into CHANGELOG.md, and merging the Version
  Packages PR publishes the preview release and tags it on GitHub.
