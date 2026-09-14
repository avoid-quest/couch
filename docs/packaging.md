# Debian AppImage

The supported package is one signed Debian 13 amd64/X11 Tauri AppImage. It carries
the native app, local/remote UI, compiled Bun backend, yt-dlp, Deno, ffprobe and
application libraries. The installer provisions Debian's host packages and optional
small TV session. See [installation and recovery](install-couch.md).

`packaging/inputs.json` pins the Debian image, dated Debian/security snapshot,
helper downloads, AppImage tools/runtime and notice inputs. JavaScript and Rust
use their existing lockfiles. `bun run package:build` requires committed source,
Debian 13 amd64 and the pinned Bun. It prepares Tauri sidecar/resources, uses the
standard AppImage bundler and checks the resulting helpers and library closure.

Tauri CLI 2.11.4 uses linuxdeploy. Its default exclusion list omits libraries such
as libstdc++, X11 and font libraries. The package configuration includes those
application-owned libraries through Tauri's `appimage.files`, along with libmpv,
NSS modules and ALSA plugins. Tauri copies WebKit processes and its GTK/GStreamer
plugins copy their dynamically loaded modules. Kernel, glibc and device-side
GL/EGL/graphics drivers remain host prerequisites.

The verified linuxdeploy output plugin is extracted with Debian's `unsquashfs`.
Tauri's tool cache points to its unchanged executable because the plugin's static
PIE AppImage wrapper cannot run under the Mac's container emulation. This changes
only build-tool execution. The final app keeps the pinned standard AppImage
runtime. Build AppDir on a Linux filesystem; the Mac bind mount failed while
linuxdeploy copied ELF dependencies. A Docker volume is suitable.

The generated inventory records every bundled file/hash, ELF linkage, explicitly
loaded components, build packages and input versions. Unexpected host-library
fallbacks or changed helper hashes fail the build. The executable's `--version`
output records the same app/backend identity and helper hashes. FUSE-mounted
execution still needs a booted host; container extraction does not test FUSE.

## Isolated Mac build

GitHub Actions remains paused. Use the existing container builder locally:

```sh
docker build --platform linux/amd64 -f packaging/Dockerfile.mac \
  --build-arg BUN_VERSION=1.4.2 --build-arg RUST_VERSION=1.98.1 \
  -t couch-debian-builder .
mkdir -p .artifacts
git bundle create .artifacts/build-source.bundle HEAD
docker run -d --init --platform linux/amd64 --name couch-package \
  --cpus 6 --memory 10g couch-debian-builder
docker cp .artifacts/build-source.bundle couch-package:/source.bundle
docker exec couch-package git clone /source.bundle /work
docker exec -w /work couch-package sh -c 'bun install --frozen-lockfile && bun run package:build'
docker cp couch-package:/work/src-tauri/target/release/bundle/appimage .artifacts/
docker cp couch-package:/work/.artifacts/appimage-inventory.json .artifacts/
```

The source bundle is private build input. Never upload it as distribution material.
The selected source timestamp supplies `SOURCE_DATE_EPOCH`. Keep the container
until setup/material archives, signing and checks finish, then stop it.

Run `bun scripts/package-setup.ts <version> <output-directory>` in that checkout
to assemble the explicitly allowlisted setup and dependency-material archives.
Sign each archive and the AppImage with the pinned Tauri signer. Isolated checks
use a disposable local signing key; only the release ticket owns enrollment and
production signing/publication. Do not publish diagnostics, source bundles,
private documentation, user configuration, databases, backups or keys.

The ordinary installer and TV setup have a disposable Debian fixture at
`tests/package/installer.sh`. It uses real Minisign verification and doubles APT,
services and successful FUSE access. It is a logic check, not pristine-machine
acceptance. Release acceptance, including GUI/playback, boot, actual library loads
and signed hosted A-to-B updates with the Mac offline, belongs to #277 after the
hosted-release implementation in #276.

Official references: [Tauri AppImage packaging](https://v2.tauri.app/distribute/appimage/),
[sidecars](https://v2.tauri.app/develop/sidecar/),
[the pinned bundler](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle/linux/appimage/linuxdeploy.rs).
