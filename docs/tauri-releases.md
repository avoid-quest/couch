# Mac packaging and release status

The current Debian 13 amd64/X11 path builds one AppImage on the Mac. GitHub
Actions remains paused. The T480 only installs and runs Couch.
[Package build and installer checks](packaging.md#isolated-mac-build) are local
implementation checks for [#275](https://github.com/avoid-quest/couch/issues/275).
The hosted release implementation belongs to
[#276](https://github.com/avoid-quest/couch/issues/276), and pristine Debian and
Mac-offline update acceptance belongs to
[#277](https://github.com/avoid-quest/couch/issues/277).

## Build and qualify on the Mac

Use the [Debian Mac recipe](packaging.md#isolated-mac-build). It reads the source
pins, builds with the existing `package:build` script on a Linux filesystem and
retains the AppImage, helper/library inventory, build inputs and logs privately.
Host Docker runs the containers. The builder does not need a Docker client,
Docker socket, host networking or `tauri-driver` for these checks.

The package layer in [PR #278](https://github.com/avoid-quest/couch/pull/278)
provides the AppImage. The upper
[PR #279](https://github.com/avoid-quest/couch/pull/279) supplies setup/archive
assembly, Debian installation and recovery instructions, and the disposable
installer fixture. Continue with the
[setup and installer commands](packaging.md#setup-archives-and-installer-check)
only when that layer is included in the checkout. It assembles allowlisted setup
and dependency-material archives, with no runtime companion `.deb` or repository
source export in the distribution.

The installer fixture verifies signatures using a disposable key and fixture
AppImage. It doubles APT, services and successful FUSE access. A passing fixture
or package inventory does not qualify a booted Debian desktop, native playback
or physical TV hardware. The
[retained #275 record](https://github.com/avoid-quest/couch/blob/61e610c73777d74d284fbfaaa2596b0cd5b7edf6/docs/evidence/debian-package-275/README.md)
identifies the actual candidate bytes, source revisions and limits of its checks.

## Debian publication

The current recipe stops at private candidate artifacts. The new release line,
starting at `0.1.0-preview.1`, needs the enrolled signing key, authenticated public
downloads, signed update metadata and hosted A-to-B integration from #276.
The existing Ubuntu Package workflow remains paused and needs that Debian
migration before it can deliver this package. Restored Actions capacity alone
does not make its old build and qualification jobs compatible.

The [official Tauri updater](https://v2.tauri.app/plugin/updater/) requires signed
artifacts. Keep private keys outside source control and public files. Isolated
#275 checks use disposable test keys. A local test
signature does not enroll a production release or complete #277 acceptance.

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
