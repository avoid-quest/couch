# Mac build fallback

Use [hosted releases](hosted-releases.md) for the current release procedure.
GitHub Actions is enabled and builds the native Debian package in the pinned
Debian 13 container. If hosted capacity is unavailable, run that same container
on the Mac. The T480 only installs and runs Couch.

## Build and qualify

The [isolated Mac recipe](packaging.md#build) supplies the pinned
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
