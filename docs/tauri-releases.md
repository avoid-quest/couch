# Mac build fallback

Use [hosted releases](hosted-releases.md) for the current release procedure.
GitHub Actions is enabled and builds the native Debian package in the pinned
Debian 13 container. If hosted capacity is unavailable, run that same container
on the Mac. The T480 only installs and runs Couch.

## Build and qualify

The [isolated Mac recipe](packaging.md#isolated-mac-build) supplies the pinned
builder and source checkout. Run `bash scripts/hosted-build.sh deb` inside the
builder with the enrolled release credentials, followed by the qualification
steps from the release guide. `scripts/hosted-desktop.sh` runs on the Docker host
and qualifies the exact package in a fresh Debian container.

Retain the package, signed receipts and qualification evidence privately.
Disposable test keys qualify fixtures only. Production publication requires the
enrolled signing key, public readiness verification and installed native-update
acceptance. Never include signing credentials in source or published assets.

## Distribution

CrabNebula serves the package and signed updater metadata. The Mac is only a
build fallback; it does not host the download or update feed. Fresh candidates
enter Preview using a final SemVer such as `0.1.1`. Promote those exact bytes to
Stable after acceptance, without rebuilding or signing again.

The public download page links one `.deb`. Tauri signatures live in the hosted
update metadata, and dependency notices are inside the package. Users do not
need the setup archive, Minisign or jq for native installation.

## Historical Ubuntu qualification and publication

The [previous Mac recipe](https://github.com/avoid-quest/couch/blob/34757770ebe02ff5de1ccebb8a68944f35c86968/docs/tauri-releases.md)
and [Mac recipe validation record](qualification/mac-build-251.md) describe the
Ubuntu POC. The [installed-status record](qualification/current-status-2026-09-14.md)
retains its dated installed build and pending physical checks. These records are
historical evidence, not current Debian build instructions.

That flow used `BUILD.ATTEMPT` release IDs, a companion `.deb`, a private source
archive and a Mac-hosted feed. Its `tests/package/qualify.ts` needs Linux Docker
host networking and the official `tauri-driver`; its installed lifecycle checks
use the companion/systemd fixture. `scripts/publish-appimage.ts` and
`scripts/test-installed-update.ts` consume that POC qualification format.
Those assumptions are outside the current Debian package and installer contract.
Retain the scripts for their historical scope; do not use their publisher or
qualification result as the new Debian release path. Migration of hosting and
installed update checks belongs to #276 and #277.
