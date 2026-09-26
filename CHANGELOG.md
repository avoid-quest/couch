# couch

## 0.2.0-preview.16

### Patch Changes

- Fix Mac restart rendering and desktop update readiness. Bound stalled native initialization, explain signing-key recovery clearly, and prevent repeated downloads of an unchanged update that cannot be verified.

- Reconnect disconnected remotes promptly when they return to the foreground or regain connectivity, while preserving healthy connections and pending commands.

- Send compact playback clock updates to compatible remotes while retaining full snapshots for older clients and structural changes.

- Keep browsing and settings stable while playback clocks advance, and use the latest playback position for relative seeking and Undo.

## 0.2.0-preview.15

### Patch Changes

- Make Home's saved-radio loading and recovery reliable and keep the player's back label aligned with Find. Improve search responsiveness, defer authenticated artwork until it approaches the viewport, split route loading, and reduce redundant queries and remote activity traffic.

## 0.2.0-preview.14

### Minor Changes

- [#544](https://github.com/avoid-quest/couch/pull/544) [`2e74148`](https://github.com/avoid-quest/couch/commit/2e741481eafb5a7012ec467889ce4ebd10b9ae16) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Refresh Couch's brand and interface: the Shift icon and updated description, one Clock design system on shadcn components across Find, Saved, Settings, the player and the desktop app, shorter copy, and real-time updates for every settings and library change.

- [#548](https://github.com/avoid-quest/couch/pull/548) [`b71116c`](https://github.com/avoid-quest/couch/commit/b71116ce0074e5b065198016569adb86b5a036a3) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Add Home: what's playing, Up next laid out against the clock, what to continue, your radio stations and what you saved for later, each shown only when it has something in it. The player moves to its own page, and Find goes back to search and browsing.

### Patch Changes

- [#545](https://github.com/avoid-quest/couch/pull/545) Integrate native dark window chrome and Mac Liquid Glass, and improve pairing and browser navigation reliability.

- [#547](https://github.com/avoid-quest/couch/pull/547) Adopt the Shift icon across the desktop app, tray, web app and website.

## 0.2.0-preview.13

### Patch Changes

- [#528](https://github.com/avoid-quest/couch/pull/528) [`425857c`](https://github.com/avoid-quest/couch/commit/425857c195a836c02307264ddea691bd9ccfc91e) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Build Linux AppImages on Debian 12 so the desktop binary can run on an older glibc base.

- [#529](https://github.com/avoid-quest/couch/pull/529) [`cb239c0`](https://github.com/avoid-quest/couch/commit/cb239c0e4b525e6b9e878ca2a456a3fe5ac3fac0) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Clear the Mac video view when playback ends so it cannot cover the controls and library.

- [#531](https://github.com/avoid-quest/couch/pull/531) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Show verified Preview downloads for Debian, AppImage, Mac, and Windows on the website.

- [#534](https://github.com/avoid-quest/couch/pull/534) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Play local video inside the Windows Full app with native libmpv controls.

- [#535](https://github.com/avoid-quest/couch/pull/535) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Package the Windows Full runtime and fix the desktop video stage, dark background, and native Close behavior.

- [#538](https://github.com/avoid-quest/couch/pull/538) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Discover and pair Windows Bluetooth devices, select a sound output, and control its effective volume and mute.

- [#540](https://github.com/avoid-quest/couch/pull/540) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Bring the accepted Couch design to Find, Saved, Settings, first run, and the player, with buffering feedback and Undo for supported actions.

## 0.2.0-preview.12

### Minor Changes

- [#519](https://github.com/avoid-quest/couch/pull/519) [`5f637c6`](https://github.com/avoid-quest/couch/commit/5f637c6d0c3282ac73e639015103bf799f413f87) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Build and verify a signed Linux AppImage for the shared desktop app.

### Patch Changes

- [#523](https://github.com/avoid-quest/couch/pull/523) [`2b63220`](https://github.com/avoid-quest/couch/commit/2b632201718d35efc673f9207e5960f5763e299e) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Verify bundled Linux AppImage playback libraries and media helpers with a fresh local playback fixture.

- [#520](https://github.com/avoid-quest/couch/pull/520) [`65251b1`](https://github.com/avoid-quest/couch/commit/65251b1513c892402cd3645f44c1d2fd88a9c446) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Prepare one signed Preview release containing Debian, AppImage, Apple Silicon Mac and Windows NSIS packages.

- [#522](https://github.com/avoid-quest/couch/pull/522) [`4d7eb98`](https://github.com/avoid-quest/couch/commit/4d7eb982f4439c4b57a53b9dbc20419cb6f48996) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Bundle the production Mac player, its native libraries and enabled media helpers in the desktop app.

- [#511](https://github.com/avoid-quest/couch/pull/511) [`c642ff4`](https://github.com/avoid-quest/couch/commit/c642ff41aa22868e50650c41a192017e14447e78) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Add Mac native playback handling for split video/audio sources, radio metadata and IPTV live starts.

- [#512](https://github.com/avoid-quest/couch/pull/512) [`585ffbc`](https://github.com/avoid-quest/couch/commit/585ffbc7e6634caeadee61e8e391b02eab25e749) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Mac music playback now respects CUE track boundaries and ReplayGain settings, and prepares eligible local and Jellyfin tracks for the next queue transition.

- [#514](https://github.com/avoid-quest/couch/pull/514) [`aa89944`](https://github.com/avoid-quest/couch/commit/aa89944f94336fa4f6f62ba3a245c7bf8f580530) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Verify Mac audio tracks, subtitles, chapters and saved playback preferences, and stop oversized subtitle uploads at the size limit.

- [#513](https://github.com/avoid-quest/couch/pull/513) [`4647279`](https://github.com/avoid-quest/couch/commit/46472793fd6237812e1fa81ef1c10ea1554cb181) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Choose a Mac sound output and control its effective volume and mute from Couch or a paired Administrator remote.

## 0.1.5-preview.11

### Patch Changes

- [#412](https://github.com/avoid-quest/couch/pull/412) [`e4c11be`](https://github.com/avoid-quest/couch/commit/e4c11be70e0dfad836f269ca264c104d11312833) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Wait up to one minute for a newly published package to reach the download CDN before marking release verification as failed.

## 0.1.5-preview.10

### Patch Changes

- [#410](https://github.com/avoid-quest/couch/pull/410) [`684abad`](https://github.com/avoid-quest/couch/commit/684abad0369521ba834d451b80a24ff51d541cbe) Thanks [@fcastrovilli](https://github.com/fcastrovilli)! - Reload the active Couch user unit after a signed package update. Retry the first post-update helper verification before asking for SSH recovery, and name a persistent helper failure in Updates.

## 0.1.5-preview.9

### Patch Changes

- Share one production frontend between the TV app and browser remotes. Keep provider Play and queue ownership in the Bun coordinator, with native transport in Tauri/libmpv. Improve pairing, connection replacement and query lifetime. Keep recently played actions inline and transport controls available while Now Playing is hidden.

  Software qualification covers the reconciled refactor stack and exact release source. Native execution uses the actual Tauri app and libmpv in disposable Linux fixtures, including Jellyfin, playback, connection and diagnostics journeys. Publication requires the signed Debian package to pass installation, playback, desktop relaunch and data-preservation checks in a fresh disposable container.

  Physical T480, hardware audio and installed native-update acceptance remain pending. Software rendering and a null audio sink do not establish hardware acceptance. No installed TV was changed.

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
