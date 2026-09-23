# Desktop payload inventory

`scripts/build.ts` produces one Vite graph for Tauri and the Bun coordinator. A
packaged build writes `release.json` with target and host metadata plus the hash
of `payload.json`. The payload lists installed paths and SHA-256 hashes. The list
includes the compiled coordinator, any enabled `yt-dlp`, Deno and `ffprobe`,
helper metadata, build inputs and redistribution notices. `native` records bundled
shared-library paths and declared host packages. Executable headers must match
the selected architecture. `scripts/desktop-payload.ts` verifies the same paths
and bytes after extraction. The Debian and AppImage verifiers call it on their
artifacts. linuxdeploy changes AppImage executable RPATHs after their source
hashes are recorded. The AppImage verifier checks those hashes against the
original build inputs. It replays linuxdeploy's fixed RPATH edit and compares
every resulting executable byte with the signed AppImage before recording the
final packaged bytes in its separate inventory. Tauri and linuxdeploy add
libraries after `payload.json` is written. The AppImage inventory records every
extracted native library path, hash and architecture.

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
| Client-only, all targets | Tauri/WebView runtime and Bun maintenance coordinator. The Debian and AppImage packages also carry the three local-media helpers. | A later limited Client-only artifact may omit those helpers; its payload must then record an empty enabled-helper list. The target installer tickets must prove their installed runtime closure. |
| Full on Linux | Client-only closure plus `yt-dlp`, Deno, `ffprobe`, GTK/WebKit, `libmpv2`, FFmpeg libraries, GL/video drivers and audio libraries. The Linux video plugin's `mpv-runtime` feature is linked into the app even when the user selects a remote host. | Debian declares host packages in `packaging/debian.json`; its artifact verifier checks those dependencies and rejects bundled shared libraries missing from the payload inventory. The Debian archive bundles no shared libraries; APT supplies them and the installed fixture checks their linkage. The AppImage verifier inventories libraries after Tauri bundles them. Installed Full remains a separate acceptance gate. |
| Full on macOS | Client-only closure plus the selected libmpv runtime and its transitive libraries. | [#478](https://github.com/avoid-quest/couch/issues/478) owns the Client-only DMG's installed closure; the production Mac player and native dependency bundle belong to the Mac playback and helper tickets. A development Homebrew link is not installed proof. |
| Full on Windows | Client-only closure plus the native player and its DLL closure after the Windows composition decision. | [#479](https://github.com/avoid-quest/couch/issues/479) owns the Client-only NSIS artifact's static closure; [#492](https://github.com/avoid-quest/couch/issues/492) owns installed Windows runtime and trust checks. No production Windows native player is present yet. |

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
with every shared library found in the extracted archive. The AppImage verifier
checks source provenance and records all packaged bytes and libraries found in the extracted
AppDir. Its inventory is hashed in the signed release manifest. Source
configuration alone cannot establish which libraries Tauri actually bundled.

The current Debian package and TV setup remain on `package:build deb` and their
existing qualification path. `package:build appimage` builds the Linux desktop
artifact without Debian TV policy. The AppImage fixture checks a fresh
Client-only launch and pairing in disposable X11; downloaded-artifact upgrades,
Wayland and broad Linux installations remain separate acceptance work. This
source inventory cannot establish a clean installed launch on macOS or Windows.
Those checks belong to the target installer tickets and their
downloaded-artifact acceptance tests.

## Windows Client-only package

The [GitHub desktop package job](../.github/workflows/package-desktop.yml) installs
Rust's `x86_64-pc-windows-msvc` target, `cargo-xwin`, LLVM, NSIS,
`cargo-about`, Minisign and 7-Zip on an Apple Silicon runner. It uses the
enrolled signing key only inside the `couch-release` environment and runs
`bun run package:windows` on a clean commit. It uses Tauri's current-user NSIS
mode and downloaded WebView2 bootstrapper. The app identifier stays
`quest.avoid.couch`; the package contains no existing user database or selected
host state. This macOS command cross-builds a Windows artifact for static
qualification; it is not the Linux release delivery path. The existing Package
workflow keeps its pinned Debian builder, and the T480 never builds packages.

The command cross-compiles the Bun coordinator and Tauri app, then inspects the
real installer. It checks its extracted app and coordinator as x64 PE files,
payload hashes and paths, notices, native DLL list, direct PE imports, release
identity, and both Tauri signatures. Every direct import must resolve to a
bundled root DLL or the reviewed Windows system/API-set allowlist. Windows
[API sets](https://learn.microsoft.com/en-us/windows/win32/apiindex/windows-apisets)
are loader contracts, and the
[Universal CRT](https://learn.microsoft.com/en-us/cpp/windows/universal-crt-deployment)
ships with Windows 10 and later. This static check cannot find DLLs loaded by
name at runtime. NSIS itself uses a 32-bit installer stub. The updater ZIP
contains that installer and a root `release.json`; the final ZIP bytes are signed
again after the manifest is added. The feed target is `windows-x86_64-nsis`.
The receipt is `.artifacts/windows-inventory.json`. Windows 11 installation,
WebView2 startup, OS trust prompts and retained state after reinstall remain
the installed qualification in [#492](https://github.com/avoid-quest/couch/issues/492).
