# Desktop payload inventory

`scripts/build.ts` produces one Vite graph for Tauri and the Bun coordinator. A
packaged build writes `release.json` with target and host metadata plus the hash
of `payload.json`. The payload lists installed paths and SHA-256 hashes. The list
includes the compiled coordinator, any enabled `yt-dlp`, Deno and `ffprobe`,
helper metadata, build inputs and redistribution notices. `native` records bundled
shared-library paths and declared host packages. Executable headers must match
the selected architecture. `scripts/desktop-payload.ts` verifies the same paths
and bytes after extraction; the Debian verifier calls it on the `.deb`.

| Package | Coordinator | Tauri resources | Notices |
| --- | --- | --- | --- |
| Debian or AppImage | `usr/bin/couch-server` | `usr/lib/Couch/` | `usr/share/doc/couch/` |
| macOS DMG app | `Contents/MacOS/couch-server` | `Contents/Resources/` | `Contents/Resources/notices/` |
| Windows NSIS | `couch-server.exe` | install root | `notices/` |

The paths are relative to an extracted package, AppDir, `.app` root or NSIS
installation directory. Tauri's
[sidecar](https://v2.tauri.app/develop/sidecar/) and
[resource](https://v2.tauri.app/develop/resources/) facilities own placement.
The bundle identifier remains `quest.avoid.couch`; no data directory or frontend
identity changes here. Installer tickets must call `verifyPayload` against their
actual artifact layout and include notices in their resource map.

## Current dependency closure

| Capability | Current native and helper dependencies | Packaging status |
| --- | --- | --- |
| Client-only, all targets | Tauri/WebView runtime and Bun maintenance coordinator. The existing Debian package also carries the three local-media helpers. | A limited Client-only artifact may omit those helpers; its payload records an empty enabled-helper list. The target installer tickets must prove their installed runtime closure. |
| Full on Linux | Client-only closure plus `yt-dlp`, Deno, `ffprobe`, GTK/WebKit, `libmpv2`, FFmpeg libraries, GL/video drivers and audio libraries. The Linux video plugin's `mpv-runtime` feature is linked into the app even when the user selects a remote host. | Debian declares host packages in `packaging/debian.json`; its artifact verifier checks those dependencies and rejects bundled shared libraries missing from the payload inventory. The current Debian archive bundles no shared libraries; APT supplies them and the installed fixture checks their linkage. `src-tauri/tauri.package.conf.json` lists AppImage native file inputs, which [#477](https://github.com/avoid-quest/couch/issues/477) must verify after bundling. |
| Full on macOS | Client-only closure plus the selected libmpv runtime and its transitive libraries. | [#478](https://github.com/avoid-quest/couch/issues/478) owns the Client-only DMG's installed closure; the production Mac player and native dependency bundle belong to the Mac playback and helper tickets. A development Homebrew link is not installed proof. |
| Full on Windows | Client-only closure plus the native player and its DLL closure after the Windows composition decision. | [#479](https://github.com/avoid-quest/couch/issues/479) owns the Client-only NSIS artifact's installed closure. No production Windows native player is present yet; the Windows installer and player tickets must record the selected binaries and notices. |

`packaging/inputs.json` pins the current Debian helper archives, Bun notice,
Tauri AppImage tools and builder images. `resources/tools.json` records each
staged helper's version, installed hash and archive hash. `build-inputs.json`
records the source locks, Bun/Rust revisions and builder inputs; Debian also
ships `build-packages.tsv` and the complete copyright/license files gathered by
`package-prepare.ts`. The release payload checks that the bundled helper bytes
match `tools.json`. Native libraries copied by a future installer need their own
target-specific inventory and license evidence before Full qualification.

The Debian payload records its direct APT requirements as declared host packages
and an empty bundled-library list. `package-deb-verify.ts` compares that list
with every shared library found in the extracted archive. A target installer must
repeat this artifact-level check for its own package: source configuration alone
cannot establish which libraries Tauri or the installer actually bundled.

The current Debian package and TV setup remain on `package:build deb` and their
existing qualification path. This source inventory cannot establish a clean
installed launch on macOS, Windows or broad Linux. Those checks belong to the
target installer tickets and their downloaded-artifact acceptance tests.
