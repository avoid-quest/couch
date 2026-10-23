# Intel macOS support

Researched 2026-10-23, with the implementation below added on the same date.
Intel support needs a small packaging and website change, deliberate helper
compatibility and target-device testing. The relay was cross-compiled on Linux;
no Mac app was executed during this audit or implementation. No CI/release was
dispatched by the implementation agent, and installed Couch/data were untouched.

## Implemented choice

- **Separate signed arm64 and x64 DMGs plus ZIPs**, in one existing Mac
  electron-builder invocation. Architecture remains in artifact names; the
  pinned builder aggregates the channel's single Mac update YAML, and the
  pinned updater selects its architecture's ZIP. No custom merger, universal
  app, second Mac job, signing-identity change or automatic workflow trigger.
- **Apple Silicon macOS 14+, Intel macOS 15+.** Apple's
  [`LSMinimumSystemVersionByArchitecture`](https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/LaunchServicesKeys.html#//apple_ref/doc/uid/TP40009250-113253-BAJDHACB)
  sets arm64 to 14.0.0 and x86_64 to 15.0.0, alongside the existing common 14.0
  minimum. Intel's 15 floor covers the selected official mpv distribution
  without promising native TV codec support on 14. System audio remains 14.2+.
- **Build and bundle unmodified official QuickJS-NG 0.17.0 source**, pinned to
  commit `6d46d07d04041b40f4f49eaa7fdebe44c314c699`. Upstream documents
  [CMake builds](https://quickjs-ng.github.io/quickjs/building); its pinned
  [CLI target](https://github.com/quickjs-ng/quickjs/blob/6d46d07d04041b40f4f49eaa7fdebe44c314c699/CMakeLists.txt)
  needs no target executable to generate code while cross-compiling. Use
  CMake's [deployment target](https://cmake.org/cmake/help/latest/variable/CMAKE_OSX_DEPLOYMENT_TARGET.html)
  14.0 and explicit arm64/x86_64 architecture. The before-signing `afterPack`
  hook verifies emitted architecture and deployment target, includes the MIT
  license/source notice, and runs the host-native CLI. The runtime is signed
  with the app and updated with Couch. Main supplies `COUCH_QJS_PATH`; helpers
  record `bundled` origin and keep it during startup/daily/manual checks rather
  than fetching upstream's incompatible Mac binaries. Compatible PATH copies
  can still take precedence. A missing/broken bundle reports a repair. After
  packaging, the Mac job strictly verifies both apps' signatures recursively
  and both QuickJS signatures explicitly. The architecture-specific app globs
  also fail if either architecture is missing.
- **Explicit download choices** per channel, from actual `-arm64.dmg` and
  `-x64.dmg` assets. Do not infer CPU from a Mac browser's user agent. The
  fallback file has no invented Intel URL; add it only after publication.
- **FFmpeg supplier migration deferred:** today's verified Intel binary fits
  the 15 floor. Its supplier's January 2027 end of new Intel builds remains a
  concrete maintenance deadline. It does not justify a distribution framework
  or supplier/signature-policy change in this packaging addition.

Linux checks exercise the pinned update-metadata merger/architecture selector,
catalog channel separation and missing-asset/offline behavior, and real
executable fixtures for bundled helper selection/manual checks. They do not
prove the Mac C build, signing or runtime behavior. Parent-owned `act` checks
and an unpublished signed Mac Package run remain required. Before shipping,
validate a clean Intel macOS 15 installation, first-use YouTube/native TV
playback, FFmpeg, relay, capture, pairing and signed updates; retain a macOS 14
Apple Silicon check for the existing supported floor.

### Implementation verification on Linux

With Bun **1.4.2** via mise: frozen install, typecheck, app build and web build
passed. Package-hook/catalog tests passed (5); update/UI regressions passed
(42); Node helper-update integration passed (29, including the two new bundled
runtime cases); Node helper-selection integration passed (8).

The broader helper-recovery integration passed 21 of 22. Its existing
“media rejected after yt-dlp's output was read” case fails with “Missing
expected rejection” for `/Web media must use/`. The same isolated case fails
against an untouched `32a79d3` source archive with the same dependencies; this
is pre-existing and outside the Intel changes.

The real download page was inspected with T3's Chromium preview at **1440×900**
and **390×844 CSS pixels**, using temporary Node SSR and GitHub-release fixtures
for both channels (no product catalog edits). Both architectures, correct
channel URLs, minimum OS, first-open commands and mobile button geometry were
checked; neither width overflowed horizontally. The devserver was stopped by
its verified PID. This browser check and the successful production web build
do not validate Mac execution. Parent-owned act and hosted Package validation
remain separate, and hosted ARM cross-packaging is not physical Intel testing.

## Couch audit and recommendation

Checked against Couch commit `32a79d37d006fff770c2b19a222afa994612af00` on 2026-10-23.

Intel support is feasible without changing Couch's application architecture. The
current release workflow requests only `--arm64` on macOS; the website accepts
only `-arm64.dmg`. Core and Main are JavaScript bundles running on Electron's
Node, and SQLite comes from `node:sqlite`, so there is no application-owned
SQLite addon to port. Media-helper selection already includes `darwin-x64`.
The bundled relay maps x64 to Go's amd64 and disables CGO. Sources:
[Package workflow](../.github/workflows/package.yml),
[website catalog](../apps/web/src/release-catalog.ts),
[download page](../apps/web/src/pages/download.astro),
[Core bundler](../scripts/core.ts), [SQLite](../src/server/sqlite.ts),
[helpers](../src/server/helpers.ts), [relay builder](../scripts/build-relay.ts).

### Actual macOS limits at audit time (before the implementation above)

- **App launch:** Couch configures `minimumSystemVersion: 14.0`. Adding an x64
  installer alone would not change this. The implementation now adds the
  architecture-specific Intel 15 floor. [Configuration](../package.json).
- **System audio capture:** Couch enables it at macOS **14.2**, regardless of
  CPU. Earlier versions can still share a screen or audio input.
  [Capture owner](../app/capture.ts).
- **YouTube's JavaScript runtime:** Couch currently downloads the latest
  QuickJS-NG. The actual v0.17.0 `qjs-darwin-x86_64` binary declares **26.0** in
  `LC_BUILD_VERSION`. The arm64 asset also declares 26.0, so this deserves a
  separate compatibility fix for the existing Mac build too. The release
  workflow uses `macos-latest` without an explicit deployment target. We cannot
  promise a fresh installation works on macOS 14/15 without a compatible
  runtime or real target-OS validation. A working system/cached helper may hide
  this problem. Couch explicitly passes `quickjs:<path>` to yt-dlp. Sources:
  [v0.17.0 assets](https://github.com/quickjs-ng/quickjs/releases/tag/v0.17.0),
  [release workflow](https://github.com/quickjs-ng/quickjs/blob/6d46d07d04041b40f4f49eaa7fdebe44c314c699/.github/workflows/release.yml),
  [runtime invocation](../src/server/yt-dlp.ts),
  [helper selection and verification](../src/server/helpers.ts).
- **Native playback for certain TV codecs:** Couch selects
  `mpv-v0.41.0-macos-15-intel.zip`. Its actual mpv executable declares **15.0**;
  some bundled libraries also require 15.0. This affects channels requiring
  MPEG-1/2 video, AC-3/E-AC-3 or MP2, rather than every playback. Keeping full
  feature coverage on Intel macOS 14 needs a compatible mpv distribution/build.
  Sources: [mpv asset](https://github.com/mpv-player/mpv/releases/tag/v0.41.0),
  [helper mapping](../src/server/helpers.ts), [codec routing](../src/server/iptv.ts).
- **FFmpeg supply:** the current Intel FFmpeg 9.0.2 binary declares **12.0**,
  below Couch's floor. Its distributor announces **no new Intel release builds
  starting January 2027**. Existing downloads do not necessarily stop working
  on that date, but ongoing maintained support needs another verified build
  source or builds of our own. Couch additionally verifies this supplier's
  code-signing identity, so changing the URL alone is insufficient. Sources:
  [supplier and timeline](https://ffmpeg.martin-riedl.de/),
  [inspected release](https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffmpeg.zip),
  [verification](../src/server/helpers.ts).
- **Performance:** there is no Intel-specific restriction in Couch's media
  path. Codec support, available hardware decoding/encoding and simultaneous
  live streams still need measurement on the actual Intel machine. A build
  passing does not establish high-resolution playback or capture performance.

### Smallest implementation

1. Build signed x64 **dmg and zip**, alongside arm64 in the same Mac
   electron-builder invocation (`--mac dmg zip --arm64 --x64`). This avoids a
   second runner setup and permits electron-builder to aggregate both
   architectures into the shared update manifest. Keep the existing signing
   certificate for update/permission continuity. A universal binary is not
   needed.
2. Expose separate Apple Silicon and Intel downloads in the website catalog,
   page and documentation. Populate fallback downloads only after an Intel
   installer has actually shipped.
3. Choose the supported macOS/feature floor and use compatible verified helper
   builds. Resolve QuickJS before advertising reliable 14/15 support; resolve
   mpv as well if all TV playback is promised on Intel macOS 14. Plan the Intel
   FFmpeg replacement before the supplier's January 2027 cutoff.
4. Prove packaging/workflow edits with `act` as [CI](ci.md) requires, then run a
   manually dispatched signed Package build. Test a clean Intel installation,
   helpers, playback, capture, pairing and an update from one signed build to
   the next on Intel hardware. Linux act cannot prove Mac signing, permission
   persistence, GPU performance or the Squirrel update install.

Couch's pinned app-builder-lib **26.15.3** already merges `info.files` from the
architecture build tasks into the shared channel YAML in
`writeUpdateInfoFiles`. Its pinned electron-updater **6.8.9** already selects
matching Mac architecture files, including Apple Silicon running through
Rosetta. Do not create independent Mac jobs that overwrite the same
`preview-mac.yml`/`latest-mac.yml` during the current `--clobber` uploads without
aggregating their contents. Exact published source inspected:
[app-builder-lib 26.15.3](https://registry.npmjs.org/app-builder-lib/-/app-builder-lib-26.15.3.tgz)
(`out/publish/updateInfoBuilder.js`) and
[electron-updater 6.8.9](https://registry.npmjs.org/electron-updater/-/electron-updater-6.8.9.tgz)
(`out/MacUpdater.js`). [Current upload step](../.github/workflows/package.yml).

### Verification performed

- Cross-compiled the current pure-Go relay with Go **1.27.2**, CGO disabled,
  `GOOS=darwin GOARCH=amd64`, `-mod=readonly`, `-trimpath` and
  `-buildvcs=false`. `file` identified an x86_64 Mach-O executable; its declared
  minimum macOS is **13.0**. This is a compilation check, not a runtime test.
- Downloaded official current helper assets and read their Mach-O load
  commands on Linux. QuickJS v0.17.0 x64 SHA-256:
  `9e5e101b4fd13cda3204222ca9f8be35412c41dcdef3745829633b7a67245412`;
  mpv v0.41.0 Intel zip SHA-256:
  `41003617ab4f7784394b5ddea7ce51b3e0838e8cfc8166ad1a378b2eda3b583c`.
  Both matched GitHub's release-asset digests. mpv's zip contains `mpv.tar.gz`;
  deployment targets were read from the executable and dylibs inside it.
- The current yt-dlp `2026.10.21` Intel archive contains an executable declaring
  macOS 10.13 and a Python runtime declaring 10.15, below Couch's floor.
  [Release](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.21).
- QuickJS v0.16.0, v0.16.1 and v0.16.2 x64 assets also declare macOS 26.0.
  v0.15.1's universal `qjs-darwin` declares 15.0 for both architectures; blindly
  pinning the previous release would not restore macOS 14 support.
  [Releases](https://github.com/quickjs-ng/quickjs/releases).
- At the audit stage no application/workflow files changed, no CI/release was
  dispatched, and no Mac app executed. The subsequent implementation is
  recorded above. The owner's installed Couch and its data were untouched.

### Effort estimate

This is an engineering estimate, not a measured delivery schedule:

- **Packaging and website:** roughly half a day to one day for the second
  architecture, catalog/download changes and checks. Reuse the existing runner,
  signing identity and electron-updater.
- **A release worth supporting:** budget roughly **2–3 engineering days** for a
  deliberately chosen Intel macOS baseline, helper compatibility work and a
  signed install/update/capture smoke test, assuming access to an Intel Mac
  and compatible helper builds. Hidden target-OS failures can extend this.
- **Full coverage on older systems:** retaining macOS 14 for every TV codec may
  require sourcing or building compatible mpv and QuickJS; scope that work
  before promising the same estimate. Supporting pre-14 systems is a separate
  compatibility project and should not be bundled into Intel packaging.

Start by choosing and testing the OS baseline, then ship separate architectures
through one Mac packaging job. Avoid a universal bundle or a custom updater.


## What t3code ships

Sources below use upstream HEAD **`9a391eb3f55b738113b61768cf2d8263b4f3ac2e`**, checked out read-only under `/tmp`, rather than assuming Couch's pinned versions match it. The latest stable release observed was **v0.1.2**, published 2026-10-22, at **`044f07257c9684ae4543bd1e1ebf9c394e9e3830`**.

- **Desktop matrix:** macOS arm64 and x64, Linux arm64 and x64, Windows arm64 and x64. Both Mac jobs use **`blacksmith-12vcpu-macos-26`**. The Intel job selects `arch: x64`, `rust_target: x86_64-apple-darwin`, and `resource_key: darwin-x64`; the Apple Silicon job uses the corresponding arm64 targets. These are separate architecture-specific apps, not a universal release. [Release jobs][t3-release].
- **This is published support, not just configuration:** v0.1.2 has both `T3-Code-0.1.2-x64.dmg` / `-x64.zip` and arm64 equivalents, plus their blockmaps and one `latest-mac.yml`. [Published release][t3-assets].
- **Desktop and CLI differ:** the Intel desktop build remains enabled, but its standalone CLI archive is disabled. The workflow records Node SEA support/startup trouble on x64 macOS; that comment does not imply Electron's Intel desktop target is unsupported. [Intel job][t3-release].
- **Versions:** HEAD pins Electron **44.9.3**, electron-builder **26.16.1**, and declares electron-updater **`^6.8.9`**. The v0.1.2 source declares the same versions. Couch currently pins **44.4.5 / 26.15.3 / 6.8.9** respectively, so HEAD's configuration is a reference, not proof of identical implementation in Couch's packages. [HEAD package][t3-package], [release package][t3-release-package], [Couch package](../package.json).

## Architecture-specific resources and minimum OS

t3code makes the **requested target architecture** drive packaging:

- Its staged dependency workspace sets pnpm `supportedArchitectures.os` and `.cpu` for the target. It explicitly resolves architecture-specific native packages, including Clerk passkeys, keyring, and fff; for a single-architecture Mac app it excludes the other architecture's `node-pty` prebuild. This avoids treating the ARM build host as the runtime target. [Staging/native selection][t3-build].
- Its Rust resource monitor is built for the selected Cargo target and staged as an extra resource. The build script can also combine both monitor slices with `lipo` for a universal target, but the release matrix selects separate x64 and arm64 builds. [Monitor staging][t3-build], [workflow build][t3-desktop].
- Mac DMG packaging also creates a **ZIP**, with architecture in artifact names (`T3-Code-${version}-${arch}.${ext}`). ZIPs are the updater payload; offering a DMG alone is insufficient. [Build configuration][t3-build].
- **Verified declared minimum:** the published v0.1.2 **x64 ZIP** contains `T3 Code (Beta).app/Contents/Info.plist` with `LSMinimumSystemVersion = 13.0` and `CFBundleShortVersionString = 0.1.2`. This was read from the official ZIP using HTTP byte ranges, without executing it. The HEAD Mac build configuration has no explicit `minimumSystemVersion` override. [Exact inspected asset][t3-x64-zip], [configuration][t3-build].

The plist proves the app's declared launch floor, **not the minimum OS of every bundled executable/library**, nor successful execution on macOS 13. No physical Intel Mac or old-OS validation was performed. Couch's helpers require their own audit; t3code's resources cannot establish their compatibility.

## Both architectures share an updater feed

t3code's two Mac jobs would otherwise produce the same channel manifest name:

1. The Intel job renames `*-mac.yml` to `*-mac-x64.yml` while collecting its artifacts. [Collection step][t3-desktop].
2. The release job merges it with the arm64 manifest back into one channel feed, e.g. **`latest-mac.yml`**, then removes the temporary Intel manifest. [Merge step][t3-release].
3. The merger checks matching versions, combines `files` by URL, rejects conflicting hashes/sizes or scalar metadata, and retains the later release date. The published v0.1.2 feed contains both architectures' ZIPs and DMGs. [Merge implementation][t3-manifest], [published feed][t3-feed].

**Do not copy the custom merger automatically:** it solves t3code's separate-job artifact layout. The requirement is a final feed containing both file sets; whether custom merging is needed depends on electron-builder's invocation/layout. The Couch audit above covers its exact builder version and single-invocation behavior.

The exact **electron-updater 6.8.9** npm distribution's `out/MacUpdater.js` already filters files by architecture: Intel hosts exclude arm64 files; Apple Silicon hosts, including Rosetta, prefer arm64 files when available, then select a ZIP. Architecture-bearing filenames therefore matter. t3code additionally disables differential downloading when switching an Intel app running under Rosetta to arm64. [Exact updater package][updater-package], [t3code updater setup][t3-updates]. No new architecture-routing updater implementation is implied.

t3code's website offers an Apple Silicon DMG and an explicit **“On an Intel Mac?” x64 download**. It resolves asset links by their `-arm64.dmg` / `-x64.dmg` suffixes for the selected stable/nightly channel; this page does not need browser CPU detection. [Download page][t3-download].

## Couch's pinned runtimes and build infrastructure

- **Electron 44.4.5 supports Intel macOS.** Its official release publishes `electron-v44.4.5-darwin-x64.zip` alongside arm64. The exact release source says macOS Ventura and newer, provides 64-bit Intel binaries, and asserts a **13.0** deployment target. Its pinned Chromium 152 source sets both the deployment target and `LSMinimumSystemVersion` input to **13.0**. This establishes the Electron floor precisely, without substituting standalone Node's OS requirements. [Release assets][electron-release], [Electron README][electron-readme], [build assertion][electron-build], [Chromium minimum][chromium-mac].
- **Go 1.27.2 supports `darwin/amd64`.** Official downloads include both an Intel archive and installer. Go 1.27 requires **macOS 13 Ventura or later**; the exact 1.27.2 linker source defaults to **13.0.0** (`macOS = macVersionFlag{13, 0, 0}`). The ARM host can target a pure-Go Intel binary with `GOOS=darwin GOARCH=amd64 CGO_ENABLED=0`; this does not establish compatibility of unrelated C/Swift helpers. [Official downloads][go-downloads], [Go 1.27 notes][go-notes], [exact linker][go-linker].
- **CPU/AVX:** Go's default `GOAMD64=v1` baseline does not impose AVX/AVX2; `v3` does. Setting or inheriting a higher value can raise the generated binary's CPU requirement. Couch's pinned **Bun 1.4.2** documentation says its single x64 build targets **Nehalem/SSE4.2**, uses AVX2/AVX-512 paths conditionally, and requires **macOS 13.0**. Older “Bun needs Haswell/AVX2” guidance must not be applied to that pin. This is a Bun requirement, not automatically a requirement for Couch's shipped Electron process. The checked Electron sources do not establish a separate exact AVX baseline for the complete app; native dependencies can impose their own. [Go CPU requirements][go-cpu], [Bun 1.4.2 documentation][bun-install].
- **Blacksmith Mac runners are ARM64 Apple M4 machines.** Its current catalog lists 6/12-vCPU Mac runners for macOS 15, 26, and 27, with `macos-latest` resolving to 26; no Intel Mac runner is listed. Couch's `blacksmith-6vcpu-macos-26` is therefore ARM64, despite its architecture-neutral label. t3code demonstrates x64 **cross-packaging** on that runner family. This is not physical Intel testing. [Runner catalog][blacksmith], [t3code jobs][t3-release].
- **The host need not become Intel.** electron-builder officially supports separate macOS x64/arm64 and universal targets; signing requires macOS. Native dependencies still need target-compatible prebuilds or deliberate cross-compilation. Its current documentation is newer than Couch's pinned builder, so t3code's pinned workflow is stronger evidence of the particular ARM-to-Intel release pattern than a generic promise that every native dependency can cross-build. [Architecture docs][builder-arch], [cross-platform caveats][builder-cross].

## Support horizon and limits of this research

Apple explicitly announced **macOS Tahoe 26 as the final macOS release for Intel Macs**. Its current Rosetta guidance says general translation is available through **macOS 27**; starting with **macOS 28**, functionality is limited to certain older, unmaintained games. Rosetta's sunset concerns running Intel software on Apple Silicon, not native x64 execution on existing Intel Macs. It also affects the future ability to smoke-test Intel apps on newer ARM runners. [Apple WWDC25 transcript][apple-wwdc], [Apple Rosetta guidance][apple-rosetta].

These sources establish a finite platform horizon, **not a specific Electron or Go Intel-removal date**. No such deadline was established here. Electron supports its latest three stable majors, so freezing an old Electron indefinitely is not an upstream-supported maintenance strategy. [Electron support policy][electron-policy].

**Proved:** current upstream runtimes and t3code's shipped architecture matrix permit Intel desktop apps; ARM Mac runners can package them; update selection already supports both architectures. **Still unproved here:** execution of the complete Couch app on Intel, media/capture performance, the oldest CPU that can run the complete bundle, signed install/update behavior, and validation on the intended minimum macOS. Those decide product coverage. The local audit above distinguishes the small packaging task from helper compatibility work and device validation.

[t3-release]: https://github.com/pingdotgg/t3code/blob/9a391eb3f55b738113b61768cf2d8263b4f3ac2e/.github/workflows/release.yml
[t3-desktop]: https://github.com/pingdotgg/t3code/blob/9a391eb3f55b738113b61768cf2d8263b4f3ac2e/.github/workflows/release-desktop.yml
[t3-package]: https://github.com/pingdotgg/t3code/blob/9a391eb3f55b738113b61768cf2d8263b4f3ac2e/apps/desktop/package.json
[t3-release-package]: https://github.com/pingdotgg/t3code/blob/044f07257c9684ae4543bd1e1ebf9c394e9e3830/apps/desktop/package.json
[t3-assets]: https://github.com/pingdotgg/t3code/releases/tag/v0.1.2
[t3-x64-zip]: https://github.com/pingdotgg/t3code/releases/download/v0.1.2/T3-Code-0.1.2-x64.zip
[t3-build]: https://github.com/pingdotgg/t3code/blob/9a391eb3f55b738113b61768cf2d8263b4f3ac2e/scripts/build-desktop-artifact.ts
[t3-manifest]: https://github.com/pingdotgg/t3code/blob/9a391eb3f55b738113b61768cf2d8263b4f3ac2e/scripts/lib/update-manifest.ts
[t3-feed]: https://github.com/pingdotgg/t3code/releases/download/v0.1.2/latest-mac.yml
[t3-updates]: https://github.com/pingdotgg/t3code/blob/9a391eb3f55b738113b61768cf2d8263b4f3ac2e/apps/desktop/src/updates/DesktopUpdates.ts
[t3-download]: https://github.com/pingdotgg/t3code/blob/9a391eb3f55b738113b61768cf2d8263b4f3ac2e/apps/marketing/src/pages/download.astro
[updater-package]: https://registry.npmjs.org/electron-updater/-/electron-updater-6.8.9.tgz
[electron-release]: https://github.com/electron/electron/releases/tag/v44.4.5
[electron-readme]: https://github.com/electron/electron/blob/694f45852a0f1726cd23bfd379854de489cccb65/README.md#platform-support
[electron-build]: https://github.com/electron/electron/blob/694f45852a0f1726cd23bfd379854de489cccb65/BUILD.gn#L54
[chromium-mac]: https://github.com/chromium/chromium/blob/2c592105bbcd9490a9894df48d0fe59b2c512651/build/config/mac/mac_sdk.gni
[go-downloads]: https://go.dev/dl/#go1.27.2
[go-notes]: https://go.dev/doc/go1.27#darwin
[go-linker]: https://github.com/golang/go/blob/022c8636110ebac86a9b88724cda168ed713c21f/src/cmd/link/internal/ld/macho.go
[go-cpu]: https://go.dev/wiki/MinimumRequirements#amd64
[bun-install]: https://github.com/oven-sh/bun/blob/744846f844374847c902b5e7fd59b4342a51ef99/docs/installation.mdx#cpu-requirements
[blacksmith]: https://docs.blacksmith.sh/blacksmith-runners/overview#macos-runners
[builder-arch]: https://github.com/electron-userland/electron-builder/blob/85046a004d40132b8607645c903c0669fe77a5cf/website/docs/architecture.md
[builder-cross]: https://github.com/electron-userland/electron-builder/blob/85046a004d40132b8607645c903c0669fe77a5cf/website/docs/features/multi-platform-build.md
[apple-wwdc]: https://developer.apple.com/videos/play/wwdc2025/102/
[apple-rosetta]: https://support.apple.com/en-us/102527
[electron-policy]: https://github.com/electron/electron/blob/694f45852a0f1726cd23bfd379854de489cccb65/docs/tutorial/electron-timelines.md
