# couch

## 0.1.5-preview.4

### Patch Changes

- [#384](https://github.com/avoid-quest/couch/pull/384) [`97b8756`](https://github.com/avoid-quest/couch/commit/97b87561565e113920e0ce7f8597b2a90f5f66f4) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Wire the installable PWA shell ([#338](https://github.com/avoid-quest/couch/issues/338)): vite-plugin-pwa precaches the built app
  shell only, registration stays in the browser path, and the Tauri webview keeps
  its native update path. Every API and WebSocket request remains on the network.
  LAN installs still wait on a trusted HTTPS origin.

## 0.1.5-preview.3

### Patch Changes

- [#349](https://github.com/avoid-quest/couch/pull/349) [`373efa7`](https://github.com/avoid-quest/couch/commit/373efa7edfeb0d9599de2bec375a5a0d5152d301) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Automate release versioning and changelogs with changesets: release notes are
  assembled from per-PR changesets into CHANGELOG.md, and merging the Version
  Packages PR publishes the preview release and tags it on GitHub.
