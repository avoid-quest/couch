# Debian AppImage

The supported package is one signed Debian 13 amd64/X11 Tauri AppImage. It carries
the native app, local/remote UI, compiled Bun backend, yt-dlp, Deno, ffprobe and
application libraries. The installer provisions Debian's host packages and optional
small TV session. [PR #278](https://github.com/avoid-quest/couch/pull/278) owns the
AppImage build. The upper [PR #279](https://github.com/avoid-quest/couch/pull/279)
adds `scripts/package-setup.ts`, `tests/package/installer.sh` and the installation
and recovery guide. Those files require the installer layer of the stack.

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

GitHub Actions remains paused. Use Git, host Bun and Docker Desktop with Linux
containers on the Mac. The T480 only installs and runs Couch. Run these blocks
in one Bash shell from a clean committed checkout after the
[ordinary local checks](ci.md). The source's Debian, snapshot, Bun and Rust pins
configure the builder. `/work` lives on the container's Linux filesystem.

```bash
set -euo pipefail
test -z "$(git status --porcelain)"
couch_revision=$(git rev-parse HEAD)
mkdir -p .artifacts
couch_work=$(mktemp -d "$PWD/.artifacts/mac-package.XXXXXX")
couch_image="couch-debian-builder:${couch_revision:0:12}"
couch_container="couch-package-${couch_revision:0:12}-$$"
git bundle create "$couch_work/source.bundle" HEAD
docker build --platform linux/amd64 -f packaging/Dockerfile.mac \
  --build-arg "DEBIAN_IMAGE=$(bun -p '(await Bun.file("packaging/inputs.json").json()).debianImage')" \
  --build-arg "DEBIAN_SNAPSHOT=$(bun -p '(await Bun.file("packaging/inputs.json").json()).debianSnapshot')" \
  --build-arg "BUN_VERSION=$(bun -p '(await Bun.file("package.json").json()).packageManager.split("@")[1]')" \
  --build-arg "RUST_VERSION=$(bun -p 'Bun.TOML.parse(await Bun.file("rust-toolchain.toml").text()).toolchain.channel')" \
  -t "$couch_image" packaging 2>&1 | tee "$couch_work/compiler-image.log"
docker image inspect "$couch_image" > "$couch_work/compiler-image.json"
docker run -d --init --platform linux/amd64 --name "$couch_container" \
  --cpus 6 --memory 10g --memory-swap 10g --pids-limit 1024 "$couch_image"
trap 'docker stop "$couch_container" >/dev/null' EXIT
docker cp "$couch_work/source.bundle" "$couch_container:/source.bundle"
docker exec "$couch_container" git clone --no-checkout /source.bundle /work
docker exec -w /work "$couch_container" git checkout --detach "$couch_revision"
docker exec -i -w /work "$couch_container" bash -euo pipefail <<'BUILD' 2>&1 | tee "$couch_work/package-build.log"
  unset COUCH_RELEASE_ID
  bun install --frozen-lockfile
  bun run package:build
BUILD
docker cp "$couch_container:/work/src-tauri/target/release/bundle/appimage/." "$couch_work/"
docker cp "$couch_container:/work/.artifacts/appimage-inventory.json" "$couch_work/"
docker cp "$couch_container:/work/src-tauri/build-info.json" "$couch_work/"
docker cp "$couch_container:/work/src-tauri/resources/build-inputs.json" "$couch_work/"
docker cp "$couch_container:/work/src-tauri/resources/build-packages.tsv" "$couch_work/"
```

This builds an isolated candidate at the committed product version. It clears
the POC's `COUCH_RELEASE_ID`; allocating the new release line belongs to
[#276](https://github.com/avoid-quest/couch/issues/276). The selected source
timestamp supplies `SOURCE_DATE_EPOCH`. Keep `$couch_work` private, including its
source bundle, compiler identity, logs, build inputs and inventory. A source
bundle is never distribution material.

## Setup archives and installer check

Continue only from a checkout containing the upper installer layer, PR #279.
The following commands use the same source revision as the AppImage. Archive
assembly uses its generated dependency notices and an explicit public-file
allowlist:

```bash
docker exec -i -w /work "$couch_container" bash -euo pipefail <<'SETUP' 2>&1 | tee "$couch_work/setup-build.log"
  test -f scripts/package-setup.ts
  couch_version=$(bun -p '(await Bun.file("src-tauri/build-info.json").json()).version')
  bun scripts/package-setup.ts "$couch_version" .artifacts/distribution
SETUP
docker cp "$couch_container:/work/.artifacts/distribution" "$couch_work/"
docker run --rm -i --init --platform linux/amd64 --network none \
  --cpus 2 --memory 2g --memory-swap 2g --pids-limit 256 \
  --mount "type=bind,source=$couch_work,target=/input,readonly" \
  -e "COUCH_SOURCE_REVISION=$couch_revision" "$couch_image" \
  bash -euo pipefail <<'FIXTURE' 2>&1 | tee "$couch_work/installer-fixture.log"
  git clone --no-checkout /input/source.bundle /work
  cd /work
  git checkout --detach "$COUCH_SOURCE_REVISION"
  bash tests/package/installer.sh
FIXTURE
```

The installer fixture changes accounts and system files only inside that fresh
disposable container. It uses real Minisign verification with a disposable key
and fixture AppImage, and doubles APT, services and successful FUSE access.
It checks installer logic, not installation of the built candidate.

After copying the outputs and completing the checks, stop the builder. The EXIT
trap also stops it on failure. The stopped container retains `/work` for inspection:

```bash
docker stop "$couch_container"
trap - EXIT
```

These steps need neither a Docker client nor `tauri-driver` inside the builder.
Host Docker starts both containers. No Docker socket, host networking or
privileged container is required for these package and installer checks.

## Build and qualify

The [retained #275 evidence](https://github.com/avoid-quest/couch/blob/61e610c73777d74d284fbfaaa2596b0cd5b7edf6/docs/evidence/debian-package-275/README.md)
records the checked revisions, repeated AppImage/archive builds, disposable
signatures and installer diagnostics. It does not establish pristine-machine
acceptance for another revision. The commands above build and check local
candidates; they do not publish a release.

Sign the AppImage and both public archives with the pinned Tauri signer when
checking a candidate, using a disposable local key. Production key enrollment,
version allocation, signed hosting and the Debian Actions release workflow belong
to [#276](https://github.com/avoid-quest/couch/issues/276). Publish only those
allowlisted assets through that release path. Diagnostics, source bundles, private
documentation, user configuration, databases, backups and keys stay private.

Pristine Debian GUI/playback, boot, actual loaded-library traces and signed hosted
A-to-B updates with the Mac offline belong to
[#277](https://github.com/avoid-quest/couch/issues/277), after #276. The retained
Ubuntu runtime/companion fixtures are
[historical POC checks](tauri-releases.md#historical-ubuntu-qualification-and-publication).

Official references: [Tauri AppImage packaging](https://v2.tauri.app/distribute/appimage/),
[sidecars](https://v2.tauri.app/develop/sidecar/),
[the pinned bundler](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle/linux/appimage/linuxdeploy.rs).
