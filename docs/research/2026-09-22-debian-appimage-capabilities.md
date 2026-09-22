# Debian and AppImage installation capabilities

Research for [#425](https://github.com/avoid-quest/couch/issues/425), checked 22 September 2026. This records repository state and platform documentation. It is not a fresh-install, update, boot, or hardware qualification.

## What exists today

| Concern | Debian package | AppImage |
| --- | --- | --- |
| Current build and release policy | **Proved in source.** `scripts/package-prepare.ts` forces the `deb` target and [`scripts/hosted-policy.ts`](../../scripts/hosted-policy.ts) accepts only `deb`. The hosted build signs and publishes the `.deb`. | **Gap.** The runtime adapter remains, but no current build/publication policy admits an AppImage. |
| Dependencies | **Proved in source.** [`packaging/debian.json`](../../packaging/debian.json) declares the runtime packages. The root-owned broker verifies a staged Minisign-signed package, then runs `apt-get install -y --no-install-recommends --no-remove` on Debian 13 amd64. This is Couch's broker, not raw Tauri `dpkg`. | **Partly proved in source.** The signed AppImage requirements name Debian 13, amd64, X11 and host packages, and the adapter blocks an unsupported host. No current AppImage installer installs those packages. |
| Unattended dependency changes | **Limited, proved in source.** The broker is a narrowly authorized `couch-package-update@USER.service` and Polkit action. APT may resolve declared dependencies. It can still fail on held, unauthenticated, or removal-requiring changes. | **Gap.** Replacing a user-owned AppImage needs no root operation, but it cannot install host dependencies. Administrator setup remains necessary. |
| Service/session changes | **Partly proved in source.** `couch-setup --tv` uses noninteractive APT and manages the TV unit. The package-update broker only runs a user-unit `daemon-reload`; it does not prove a Couch restart. | **Partly proved in source.** The adapter has a supervised restart path, but requires Couch to be the active `couch-tv.service` owner with the expected restart policy. Ordinary desktop restart is a separate path. |
| Update and recovery | **Proved in source.** The native sidecar stages a signed `.deb`, waits for the broker receipt, and verifies the installed digest before relaunch. The broker records a receipt and APT log. | **Proved in source, not current release proof.** The adapter verifies downloaded bytes, retains the current AppImage and transaction data, and can inspect signed requirements before replacement. |
| Installed evidence | **Historical acceptance only.** [`docs/evidence/native-deb-updates/2026-09-16/result.md`](../evidence/native-deb-updates/2026-09-16/result.md) records a disposable Debian/X11 broker fixture. [`tests/package/debian-desktop.ts`](../../tests/package/debian-desktop.ts) covers a fresh Debian desktop, helpers, playback, launcher and data preservation. | **No installed acceptance found.** Existing AppImage tests exercise sidecar behavior and filesystem transactions, not a released AppImage on a prepared host. |

The present packaging surface is not neutral. Debian is the only format that the release policy can build, qualify and publish now. Keeping AppImage code is not enough to advertise the format.

## Platform constraints

Tauri's Debian bundler generates desktop integration and permits declared Debian dependencies and extra package files. It does not make those dependencies available by itself. [Tauri Debian packaging](https://v2.tauri.app/distribute/debian/) documents both configuration points. The stock Tauri updater signs update artifacts and provides download, install and relaunch APIs, but Couch deliberately uses its broker for Debian so that APT, rather than raw `dpkg -i`, resolves dependencies. [Tauri updater](https://v2.tauri.app/plugin/updater/).

`apt-get --assume-yes` answers confirmation prompts but aborts for held-package changes, unauthenticated packages, and essential-package removals. `DEBIAN_FRONTEND=noninteractive` uses debconf defaults and does not make arbitrary maintainer scripts or conffile conflict handling unattended. [APT manual](https://manpages.debian.org/trixie/apt/apt-get.8.en.html), [debconf manual](https://manpages.debian.org/unstable/debconf-doc/debconf.7.en.html).

An AppImage Type 2 runtime mounts its SquashFS image with FUSE and runs `AppRun`. The AppImage project documents `libfuse2` installation for Debian derivatives and an extract-and-run fallback when mounting is unavailable. That fallback is explicitly expensive; it is not a release-grade substitute for supported host setup. [AppImage architecture](https://docs.appimage.org/reference/architecture.html), [FUSE troubleshooting](https://docs.appimage.org/user-guide/troubleshooting/fuse.html).

Dependency installation does not restart Couch. Debian package-policy service actions go through `invoke-rc.d`, which can be filtered by runlevel or `policy-rc.d`; `restart` starts a stopped service, while `try-restart` leaves it stopped. A format claiming a post-update restart must invoke and verify the intended Couch supervisor explicitly. [Debian policy](https://www.debian.org/doc/debian-policy/ch-opersys.html#writing-the-scripts), [invoke-rc.d](https://manpages.debian.org/bookworm/init-system-helpers/invoke-rc.d.8.en.html).

## Smallest complete qualification slices

1. **Debian.** On a fresh Debian 13 amd64 X11 desktop, install the signed `.deb` through APT, prove all declared dependencies resolve, then run a signed broker update that adds a dependency. Verify the specified Couch session restarts, reaches backend/frontend health, preserves user data, and leaves an actionable receipt after an APT or restart failure. Repeat for the explicit TV profile if it remains supported.
2. **AppImage.** Build and publish an AppImage update channel again, then on each supported fresh profile prove the administrator-owned host preparation, a user-owned signed replacement, retained data and recovery after failed replacement. Test FUSE availability and the selected supervisor. Do not call extract-and-run unattended support without an explicit decision and evidence.
3. **Release policy.** Permit a format only after its own signed build inventory, hosted artifact, fresh-install evidence, dependency-change evidence, restart evidence and recovery evidence exist. Both formats can share user outcomes, but their authorization boundary differs: APT changes need an administrator-authorized Debian path; AppImage replacement cannot add host packages.

## Unrun cases and decision needed

No Debian 13 machine, booted desktop or TV session, physical hardware, AppImage build, AppImage install, FUSE probe, AppImage migration, or hosted publication was run for this research. The owner of [#426](https://github.com/avoid-quest/couch/issues/426) needs to decide whether parity means identical mechanics or these equal outcomes: authorized update, declared dependency handling, explicit restart verification, preserved state and actionable recovery. The evidence supports the latter. It does not support promising automatic AppImage host-dependency installation or rollback for either format.
