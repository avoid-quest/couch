# couch

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
