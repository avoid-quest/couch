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
extracts it and records every packaged file, symlink, native library and SHA-256
in `.artifacts/appimage-inventory.json`. The bundle includes the coordinator,
helpers, libmpv and redistribution notices. Its Linux ABI floor is set by this
Debian 13 builder. Compatibility with older distributions has not been proven.

## Qualify

```sh
bash scripts/hosted-qualify.sh deb
bash scripts/hosted-qualify.sh appimage
```

Runs typecheck, Bun and Cargo tests, then compares the release identity inside
the package. `scripts/hosted-desktop.sh` (Docker host) qualifies the exact
package in a fresh Debian container with a real GUI session.
For AppImage it starts the signed file through `APPIMAGE_EXTRACT_AND_RUN=1` in a
fresh runtime container, because Docker provides no FUSE mount. That fixture
checks first launch, the private Client-only coordinator, a separate selected
host and pairing. Installed FUSE, upgrade and Wayland acceptance remain open.

## Release

See [hosted releases](hosted-releases.md). The Mac is only a build fallback
using the same container; it never hosts the download or update feed.
