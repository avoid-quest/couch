# Tauri installation options after the first release

Checked on 15 September 2026 against official documentation, upstream source and
the locally pinned Tauri CLI 2.11.4 / updater 2.11.0. This is research, not an
implemented or qualified replacement for the published installation.

## Recommendation

Use Tauri's native `.deb` as the direction for a conventional Debian desktop
installation. The happy path is one download, one Debian installation action,
then launch Couch from the application menu:

```sh
sudo apt install ./Couch_VERSION_amd64.deb
```

The page should generate the real filename. APT installs declared dependencies
from the machine's configured repositories. No Couch APT repository is necessary
for installing a downloaded package. A graphical package installer can provide
the equivalent experience when one is installed; do not assume pristine Debian
has one. [Debian handbook](https://www.debian.org/doc/manuals/debian-handbook/sect.apt-get.en.html#sect.apt-install)

This is a focused packaging and update-integration change. It is not a prerequisite
for ordinary UI work. It also is not a page-only change: the existing phone and
unattended update behavior depends on the user-owned AppImage. Do not silently
replace that behavior while fixing installation.

I would not introduce an AppImage-inside-a-`.deb` installer, a new installer
binary, or another shell download manager as the default response to this
request. Those preserve or add custom installation machinery when the user is
asking for the standard installation experience.

## What Tauri already provides

The stock Debian bundler creates the application package, desktop launcher and
icons. Additional runtime dependencies belong in `bundle.linux.deb.depends`.
Additional files belong in `bundle.linux.deb.files`.
[Tauri Debian packaging](https://v2.tauri.app/distribute/debian/)

Supported configuration includes `preInstallScript`, `postInstallScript`,
`preRemoveScript`, `postRemoveScript`, `desktopTemplate`, `depends`, `recommends`,
`conflicts` and `replaces`. These are Debian packaging hooks, not an installer
wizard or automatic TV provisioning feature.
[DebConfig reference](https://v2.tauri.app/reference/config/#debconfig)

The official bundler copies configured scripts to Debian's `preinst`, `postinst`,
`prerm` and `postrm`. Application-specific system configuration can therefore use
standard packaging hooks without implementing a new package manager.
[Tauri bundler source](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/linux/debian.rs)

AppImage is Tauri's portable alternative. Its documented basic use is to mark the
download executable and run it. The AppImage configuration offers bundled media
frameworks and additional files, not a first-run installer for desktop menus,
Debian prerequisites, runtime accounts or LightDM policy.
[Tauri AppImage guide](https://v2.tauri.app/distribute/appimage/),
[AppImageConfig](https://v2.tauri.app/reference/config/#appimageconfig)

## Correction: Tauri can update native Debian packages

The public updater guide mainly documents AppImage outputs for Linux. It is
incorrect to conclude that the installed Tauri version supports only AppImage.

The pinned updater source dispatches on the installed bundle type, including
`Deb`, and selects a matching target such as `linux-x86_64-deb`. Its Debian
installer checks the package format and invokes `dpkg -i`, first through `pkexec`,
then graphical or terminal `sudo` fallbacks. There is no separate `.deb` feature
flag. This is upstream functionality, not a proposed Couch fork.
[Updater 2.11.0 source](https://github.com/tauri-apps/plugins-workspace/blob/updater-v2.11.0/plugins/updater/src/updater.rs)

The pinned CLI's `sign_updaters` includes `PackageType::Deb` and
`PackageType::Rpm`. With updater artifacts enabled, it signs the native package
using the same Tauri signing mechanism.
[Tauri CLI 2.11.4 source](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-cli/src/bundle.rs)

CrabNebula supports the public platform `deb-x86_64` and bundle-suffixed Tauri
update platforms. Uploading a package with `--signature` supplies its updater
signature; the signature does not have to be presented to users as a second
download. `linux-x86_64-deb` follows the documented suffix convention.
[CrabNebula upload documentation](https://docs.crabnebula.dev/cloud/cli/upload-assets/)

Two limits matter. The upstream `.deb` installer uses `dpkg`, which does not
resolve newly missing dependencies like `apt install` does. Installation also
requires OS administrator authorization. A package should preflight new
requirements before stopping Couch; desktop elevation needs qualification on
the supported Debian session. The existing locked `couch-tv` account cannot be
assumed to complete those prompts.
[Pinned installer implementation](https://github.com/tauri-apps/plugins-workspace/blob/updater-v2.11.0/plugins/updater/src/updater.rs),
[Debian package management](https://www.debian.org/doc/manuals/debian-handbook/sect.manipulating-packages-with-dpkg.en.html)

## What changes inside Couch

The present restriction is in Couch itself:

- [`src-tauri/src/appimage_update.rs`](../../src-tauri/src/appimage_update.rs)
  checks for a running AppImage, hardcodes its two supported locations, extracts
  requirements through the AppImage runtime, and retains/replaces AppImage files.
- [`src-tauri/src/lib.rs`](../../src-tauri/src/lib.rs) reports `COUCH_APPIMAGE`
  to the backend; [`src/server/updates.ts`](../../src/server/updates.ts) reports
  updates unavailable outside the installed AppImage path.
- [`scripts/package-build.sh`](../../scripts/package-build.sh) explicitly builds
  `--bundles appimage`. Existing `deb` settings in the base Tauri configuration
  do not establish a qualified current Debian package.
- [`install-couch`](../../install-couch) and
  [`couch-recover`](../../packaging/appliance/root/usr/sbin/couch-recover) own
  bootstrap and retained AppImage recovery. They currently use `jq` and
  `minisign`; those are also declared signed host prerequisites.
- [`scripts/package-prepare.ts`](../../scripts/package-prepare.ts) prepares
  helper/resources and application libraries for AppImage assembly. A `.deb`
  needs explicit dependencies for libraries supplied by Debian, plus verified
  packaged helpers/resources. Changing a bundle flag alone does not qualify
  that closure.

Native packaging can remove manual Minisign and jq steps from fresh installation.
Actually removing the tools from the target requires replacing or retiring the
shell recovery/bootstrap uses too. Tauri's signature verifier already runs
inside the native updater; it does not call the system Minisign executable.

Local `.deb` installation does not verify a Tauri `.sig` automatically. The
simplest fresh-download path trusts the HTTPS download origin. Tauri signatures
continue authenticating later in-app downloads. A signed APT repository is a
different distribution option, with repository metadata and key enrollment;
it is not required merely to install a local `.deb`.
[APT authentication model](https://manpages.debian.org/trixie/apt/apt-secure.8.en.html),
[Tauri signing](https://v2.tauri.app/plugin/updater/#signing-updates)

## Desktop and TV choices

| Choice | Initial installation | Subsequent updates | Consequence |
| --- | --- | --- | --- |
| Native `.deb` | Download one package, install with APT, launch from menu | Signed Tauri `.deb` update with OS authorization, or administrator installs the next downloaded package | Standard desktop happy path; Couch integration must adapt |
| Current AppImage | Custom initial host setup remains necessary | Current unprivileged local, phone and idle updates | Preserves released behavior; no stock Tauri initial setup wizard exists |
| `.deb` containing an AppImage seed | APT plus custom per-user provisioning | Two ownership/version models unless carefully designed | A custom hybrid, not the stock Tauri solution; not recommended |

One native package can carry an optional `couch-setup-tv` command and existing
TV integration templates as inert resources. Desktop installation should not
enable TV login or install the full TV stack. A separate explicit administrator
action would install its extra Debian dependencies and enable the session. This
retains one app download, though Couch still owns the TV-specific setup logic.
Tauri does not provide TV account/session policy.

A dedicated companion Debian package is another conventional way to declare TV
dependencies, but adds a second package. It is unnecessary unless maintaining
TV setup itself through APT is worth that additional artifact. Do not put an
interactive desktop-versus-TV wizard into an automatically executed `postinst`
merely to combine both experiences.

Neither native choice automatically retains phone-only or unattended idle
installation as the locked runtime account. An owner decision is needed before
changing that behavior. Preserve the published path in the meantime; no broad
sudo/Polkit bypass should be introduced to make the old behavior appear intact.

## Why the current design exists

The [14 September installation decision](https://github.com/avoid-quest/couch/issues/265#issuecomment-5668666047)
explicitly selected a complete AppImage, user-owned app replacement without
recurring OS prompts, separate administrator host maintenance and no privileged
app updater. That supports unattended TV and paired-Administrator updates.

The [release decision](https://github.com/avoid-quest/couch/issues/266#issuecomment-5669079411)
then explicitly required the AppImage, setup and distribution-material archives,
each signed, and Debian's Minisign before executing setup. Those choices explain
the six assets and manual bootstrap. They were project policy, not limitations
of Tauri or CrabNebula. The present request is a reason to revisit that policy.

## Smallest native implementation scope

1. Produce and qualify one normal Tauri `.deb`, with accurate Debian dependencies,
   existing backend/helpers/resources and desktop integration. Remove AppImage
   host prerequisites from the native package where no longer used.
2. Adapt Couch's current update coordination to the native package installer:
   signed requirements, data backup, safe interruption, administrator elevation,
   native restart and post-restart health. Retain the current AppImage route for
   existing installations until a deliberate migration is offered.
3. Carry optional TV setup in the package and point its service at the packaged
   executable. Keep administrator activation separate. Decide native TV update
   authorization before making it the supported replacement.
4. Upload the `.deb` and its signature metadata to CrabNebula, then change
   readiness checks and the Astro page to one primary download. Keep dependency
   material available under a secondary link while reviewing whether the
   separate archive remains necessary. Do not delete it on the assumption that
   a different package extension resolves its purpose.
5. Verify fresh desktop installation, native playback/helpers, signed native
   update with elevation and failure/cancellation, data preservation and recovery.
   Add pristine TV setup/boot/update checks if that profile changes.

The resulting steady-state application download can be one `.deb`; Tauri still
produces signature metadata. Separate public `.sig` files and setup archives are
not inherently required for that native happy path. Existing AppImage users may
require a transition release, so reducing all hosted assets immediately is a
different promise from giving new users one download.

No builds, installations, updates, provider mutations or deployments ran for
this investigation.
