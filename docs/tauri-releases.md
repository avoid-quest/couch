# Signed AppImage publication

The Tauri application feed is separate from Ubuntu/APT session management.
Use the official Tauri signer with a private key in protected administrator
storage. The trusted installer enrolls its public key and feed address; the TV
never discovers trust from an update response. Keep the private key off CI,
source control and the HTTP-served directory. Back it up before enrolling TVs.

GitHub Actions remains the intended path for PR checks, builds and releases.
During the temporary capacity pause, build with the same package scripts in
Ubuntu 24.04 x86_64 Docker on the Mac, from a clean committed source revision.
The T480 only installs and runs the result. The publisher also accepts an already
qualified local directory without a GitHub download. It checks the clean
packaged build identity and the AppImage hash against the matching runtime
qualification before invoking `bunx --no-install tauri signer sign`.

## Build and qualify on the Mac

Use a trusted source checkout, Git, host Bun for reading the pins, and Docker
Desktop with Linux containers. The compiler runs as `linux/amd64`, including on
Apple Silicon. Configure Docker Desktop's [host networking](https://docs.docker.com/engine/network/drivers/host/)
before qualification. It requires Desktop 4.34 or later and the setting is under
Resources > Network. Coordinate any Desktop restart and reserve the Mac for
these runs. The qualification scripts start sibling containers through the
Docker socket and share loopback ports; do not run two qualifications together.
Docker socket access gives this trusted runner control of the local Docker daemon.

First finish the [ordinary local checks](ci.md), commit the intended source and
choose a new release identity as described below. Run the following blocks in
one Bash shell from that clean checkout. They build an isolated tool image from
[the compiler Dockerfile](../packaging/Dockerfile.mac), using the source's Ubuntu
image/snapshot, Bun and Rust pins. The historical local compiler snapshot is not
required. Ubuntu's [snapshot service](https://snapshot.ubuntu.com/) supplies the
reviewed build libraries; package preparation records their resolved versions.

```bash
set -euo pipefail
: "${COUCH_RELEASE_ID:?Set an unused positive BUILD.ATTEMPT before building}"
couch_revision=$(git rev-parse HEAD)
test -z "$(git status --porcelain)"
couch_work="$HOME/Library/Application Support/Couch/builds/$COUCH_RELEASE_ID"
mkdir -p "$(dirname "$couch_work")"
mkdir "$couch_work"
git clone --no-hardlinks --no-checkout "$PWD" "$couch_work/source"
git -C "$couch_work/source" checkout --detach "$couch_revision"
cd "$couch_work/source"
couch_image="couch-mac-builder:$COUCH_RELEASE_ID"
docker build --platform linux/amd64 -f packaging/Dockerfile.mac \
  --build-arg "UBUNTU_IMAGE=$(bun -p '(await Bun.file("packaging/inputs.json").json()).runtimeImage')" \
  --build-arg "UBUNTU_SNAPSHOT=$(bun -p '(await Bun.file("packaging/inputs.json").json()).ubuntuSnapshot')" \
  --build-arg "BUN_VERSION=$(bun -p '(await Bun.file("package.json").json()).packageManager.split("@")[1]')" \
  --build-arg "RUST_VERSION=$(bun -p 'Bun.TOML.parse(await Bun.file("rust-toolchain.toml").text()).toolchain.channel')" \
  -t "$couch_image" packaging 2>&1 | tee "$couch_work/compiler-image.log"
docker image inspect "$couch_image" > "$couch_work/compiler-image.json"
```

The output directory is new for this attempt and stays in private Mac storage.
Use the same absolute path inside the runner and on the Mac. The Docker daemon
resolves the qualification scripts' sibling bind mounts on the host; mapping
the checkout only to `/work` would leave those mounts pointing at absent files.
No signing key is mounted into a build or qualification container.

```bash
couch_container="couch-mac-build-$COUCH_RELEASE_ID"
docker run -d --init --name "$couch_container" --platform linux/amd64 \
  --cpus 2 --memory 4g --memory-swap 4g --pids-limit 512 \
  --network host --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
  --mount "type=bind,source=$couch_work,target=$couch_work" \
  --workdir "$couch_work/source" -e COUCH_RELEASE_ID "$couch_image"
trap 'docker rm -f "$couch_container" >/dev/null' EXIT

docker exec -i "$couch_container" bash -euo pipefail 2>&1 <<'BUILD' | tee "$couch_work/package-build.log"
  test "$(uname -m)" = x86_64
  docker version
  test "$(bun --version)" = "$(bun -p '(await Bun.file("package.json").json()).packageManager.split("@")[1]')"
  bun install --frozen-lockfile
  bun run package:build
  mkdir -p .artifacts/package-release
  cp src-tauri/target/release/bundle/appimage/*.AppImage .artifacts/package-release/
  cp src-tauri/build-info.json src-tauri/resources/build-inputs.json .artifacts/package-release/
  git archive --format=tar.gz --output=.artifacts/package-release/couch-source.tar.gz HEAD
  version=$(bun -p '(await Bun.file("src-tauri/build-info.json").json()).version')
  sh scripts/build-appliance.sh .artifacts/package-release "$version"
  cp install-couch .artifacts/package-release/
  dpkg-deb -f .artifacts/package-release/couch-appliance_*.deb Package Version Architecture
BUILD
```

`package:build` runs the existing helper/notice preparation, locked Tauri Debian
and AppImage build, and final helper-byte verification. The companion comes
from `build-appliance.sh` at the same source revision and application version.
Keep both artifacts and the installer together. Building does not qualify them.

Run the companion installer fixture in a separate fresh container because it
changes system files. It uses real companion packaging with fixture versions and
doubled APT/service commands, not an installation of the final release `.deb`.
The next runner uses the exact AppImage and the existing real systemd/APT fixture.
That fixture also rebuilds the companion from this checkout at its fixture
version. Keep this distinction in the release evidence.

```bash
docker run --rm --init --platform linux/amd64 --network none \
  --cpus 1 --memory 1g --memory-swap 1g --pids-limit 256 \
  --mount "type=bind,source=$couch_work,target=$couch_work,readonly" \
  --workdir "$couch_work/source" "$couch_image" \
  bash scripts/test-appliance.sh 2>&1 | tee "$couch_work/companion-fixture.log"

docker exec -i "$couch_container" bash -euo pipefail 2>&1 <<'QUALIFY' | tee "$couch_work/qualification.log"
  artifacts=("$PWD"/.artifacts/package-release/*.AppImage)
  test "${#artifacts[@]}" = 1
  bun tests/package/qualify.ts "${artifacts[0]}"
  bash scripts/test-appliance-systemd.sh --appimage "${artifacts[0]}" \
    "$PWD/.artifacts/appimage-qualification/installed"
QUALIFY
```

The runner and its sibling runtime containers use Linux host networking for
loopback-only WebDriver and generated-media ports. Only the real systemd fixture
uses a privileged container and the host cgroup mount. Apple Silicon emulation
can fail at AppImage execution or systemd startup. A failure is failed
qualification: retain its logs and resolve the emulator problem before
continuing.
Do not label an unqualified package ready or build it on the T480 to bypass this
gate. Package software-rendering/null-audio checks do not qualify physical TV
picture, speakers or hardware decoding.

Only after both commands pass, assemble the directory consumed by the publisher:

```bash
docker exec "$couch_container" bash -euo pipefail -c '
  mkdir .artifacts/qualified-release
  cp .artifacts/package-release/* .artifacts/qualified-release/
  cp -R .artifacts/appimage-qualification .artifacts/qualified-release/
  cd .artifacts/qualified-release
  sha256sum ./*.AppImage ./*.deb ./*.json ./*.tar.gz ./install-couch > SHA256SUMS
  sha256sum --check SHA256SUMS
'
docker rm -f "$couch_container"
trap - EXIT
```

Keep `$couch_work` and its image ID, logs, exact source archive, package hashes
and qualification results in backed-up private storage. A failed run also keeps
those files; the EXIT trap removes only its runner. The qualification scripts
clean up their own runtime containers. After an interrupted run, inspect Docker
and remove only containers identified by that attempt's logs. Do not prune shared
images or caches. The [validation record](qualification/mac-build-251.md) states
which recipe checks have actually run; it does not claim a fresh release build.

## Publish an already-qualified directory

The private directory must contain exactly one `.AppImage`, `build-info.json`,
`couch-source.tar.gz`, and one `appimage-qualification/ATTEMPT/result.json` from
`tests/package/qualify.ts`. Keep that source and evidence outside the feed.
Run from an installed source checkout on the Mac:

```sh
export TAURI_SIGNING_PRIVATE_KEY_PATH=/absolute/private/tauri-signer/couch.key
bun scripts/publish-appimage.ts /absolute/private/qualified-release \
  /absolute/feed/tauri https://updates.example/tauri/ preview \
  'Release notes for the qualified build'
```

The signer also accepts `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` for a protected key.
Never put a private key or password in command history. The temporary LAN feed
can use its enrolled HTTP address; moving hosting does not change the format.

For a new local build, set `COUCH_RELEASE_ID` to an unused positive
`BUILD.ATTEMPT` above the published release and below newer hosted build IDs.
The historical build `34172088325.1` followed `34172088324.1`; do not reuse it.
The [14 September readback](qualification/current-status-2026-09-14.md) reports
installed build `34172088349.1`. Recheck the feed and retained identities before
choosing a new number; a dated installed readback is not an allocation. Do not
use a wall-clock timestamp that would prevent future hosted releases from
advancing the channel. Changed bytes need a
new identity; requalification, signing and promotion keep it. Preserve the source
revision, inputs, hashes and qualification evidence with every local build.

The original artifact command is retained for hosted builds:
`bun scripts/publish-appimage.ts ARTIFACT_ID NEW_PRIVATE_DIRECTORY FEED_DIRECTORY BASE_URL stable|preview NOTES`.
It still verifies the authenticated archive digest and successful main build.

The installed A-to-B runner accepts either its original artifact ID or a local
qualified B directory. In the Linux qualification environment, run:

```sh
bun scripts/test-installed-update.ts /absolute/retained-A.AppImage \
  /absolute/private/qualified-B /absolute/private/installed-evidence
```

It uses the same publisher with a disposable key and feed, then the existing
systemd Docker fixture. It does not install on the real TV. The current fixture
still requires a Linux x86_64 runner and real installed qualification; the Mac
publisher alone does not establish that acceptance.

Publication retains immutable AppImage bytes and their original signature under
`releases/BUILD.ATTEMPT/`. It signs standard Tauri JSON plus Couch's exact revision,
data format, release ID, size and seven-day expiry. JSON and its adjacent `.sig` switch through
one directory symlink. Separate HTTP requests can straddle publication; clients
reject a JSON/signature mismatch and retry. Republishing renews metadata for the
same archive; promoting to Stable reuses its bytes and signature. A lock serializes
publication, and an older build cannot move a channel backwards. Retain signed
metadata snapshots and private source/evidence. After forced termination, confirm
no publisher is running before removing `.publish.lock`; normal failures release it.

The native client verifies metadata before using the official updater, compares
its parsed response with that verified metadata, and verifies stored downloads
again before use. Tauri's install API does not repeat download verification.

Publication does not enroll a TV or activate installation. Qualify signed staging,
systemd shutdown/restart, stopped-writer backup and SSH recovery before migrating
an installed appliance or removing its existing updater.
