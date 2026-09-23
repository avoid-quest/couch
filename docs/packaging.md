# Linux packaging

The shared coordinator, helper and resource inventory for desktop targets is
described in [desktop payload inventory](desktop-payload.md).
The [Mac Client-only package](packaging-macos.md) has its own target build and
artifact verifier.

Hosted Actions builds both Linux formats in the pinned Debian 13 amd64 container
(`packaging/Dockerfile.builder` — historically named, now the standard builder).

## Build

```sh
bash scripts/hosted-build.sh deb
bash scripts/hosted-build.sh appimage
```

Inside the builder this runs `bun run package:build deb`:
`scripts/package-prepare.ts` stages TV resources, the update broker, the enrolled
updater key and redistribution notices, then `scripts/desktop.ts` builds the
signed bundle and `scripts/package-deb-verify.ts` inspects the package without
running application code as root.

Select `appimage` to stage the desktop payload without Debian TV setup or update
broker files. Tauri builds and signs the AppImage; `package-appimage-verify.ts`
extracts its squashfs payload at the pinned runtime offset. It records every
packaged file, symlink, native library and SHA-256 in
`.artifacts/appimage-inventory.json`. The bundle includes the coordinator,
helpers, libmpv and redistribution notices. The build checks the pinned Tauri
AppImage tools and runtime before and after bundling. Its Linux ABI floor is set
by this Debian 13 builder. Compatibility with older distributions has not been
proven.
The optional external AppImage output plugin cannot execute in the arm64-hosted
amd64 builder. Tauri uses the output plugin bundled inside the pinned
`linuxdeploy` instead; an inert cache entry prevents a moving plugin download.

## Qualify

```sh
bash scripts/hosted-qualify.sh deb
bash scripts/hosted-qualify.sh appimage
```

Runs typecheck, Bun and Cargo tests, then compares the release identity inside
the package. `scripts/hosted-desktop.sh` (Docker host) qualifies the exact
package in a fresh Debian container with a real GUI session.
Apply the existing `qualify-package` label to an AppImage PR to run the
[native x86_64 PR check](../.github/workflows/appimage-qualification.yml) with
a disposable signing key and no release credentials. This proves the clean
launch on a native runner; the arm64 Mac's Docker emulator cannot execute the
AppImage's static PIE runtime.
For AppImage it starts the signed file through `APPIMAGE_EXTRACT_AND_RUN=1` in a
fresh runtime container, because Docker provides no FUSE mount. That fixture
checks the rendered first view before installing WebDriver, then selects
Another Couch in the bundled app window and checks remote Client-only
mode, its private maintenance coordinator, a separate selected host and pairing.
The same AppImage retains local playback. Installed FUSE, upgrade and Wayland
acceptance remain open.
Normal AppImage launch needs a FUSE 2 runtime; the container's extraction path
does not test it. A desktop also needs a DBus session, graphics drivers and an
audio service. Tauri bundles GTK/WebKit and selected GStreamer libraries, while
glibc and the display stack remain host requirements. The Debian 13 builder
sets the current glibc floor; older distributions require their own proof.

## Release

See [hosted releases](hosted-releases.md). The Mac is only a build fallback
using the same container; it never hosts the download or update feed.
