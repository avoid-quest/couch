# Remote administrator updates for the native Debian package

The owner requires paired Administrators to install native Debian updates
remotely. This supersedes the SSH-only option in the earlier installation
research. This note specifies a proposed integration; no broker has been built
or qualified by this investigation.

## Decision

Keep Tauri's signed download and Couch's existing update coordination. For native
Debian installation, use one fixed root verifier invoked through a systemd
oneshot. After validating its own private copy, it invokes APT to install only
that Couch package and its dependencies. A narrowly scoped Polkit rule permits
starting this unit. It grants no general permission to run APT, dpkg, a shell or
arbitrary systemd units.

This is custom application authorization around standard systemd and APT. It is
justified by a specific upstream gap: Tauri's native installer requires local
OS authentication, while PackageKit cannot treat a local Tauri-signed package
as a trusted, application-scoped request. It is not a replacement package manager.

## First-class alternatives checked

Tauri updater 2.11.0 installs `.deb` bytes through `pkexec dpkg -i`, then sudo
fallbacks. It has no paired-Administrator-to-OS authorization bridge and does
not resolve missing dependencies through APT.
[Pinned Tauri implementation](https://github.com/tauri-apps/plugins-workspace/blob/updater-v2.11.0/plugins/updater/src/updater.rs)

Debian 13's PackageKit 1.3.1-1+deb13u1 supports local file installation and
dependency resolution, but its APT backend rejects local files with
`ONLY_TRUSTED`. Clearing that flag requires `package-install-untrusted`.
Authorization for local files does not expose a verified package ID on which
Polkit could enforce a Couch-only grant. An unprivileged caller's successful
Tauri verification does not change those facts.
[Debian PackageKit source distribution](https://packages.debian.org/trixie/packagekit),
[APT backend](https://github.com/PackageKit/PackageKit/blob/main/backends/apt/apt-job.cpp),
[PackageKit authorization](https://github.com/PackageKit/PackageKit/blob/main/src/pk-transaction.c)

PackageKit repository updates are viable with a signed Couch APT repository and
an exact-package authorization policy. That adds signed repository metadata,
source/key enrollment and origin policy. Requested package IDs precede dependency
resolution; their repository field is not sufficient to enforce origin in the
APT backend. This is a larger distribution change than retaining CrabNebula's
already verified candidate bytes.
[APT authentication](https://manpages.debian.org/trixie/apt/apt-secure.8.en.html)

## Minimum packaged additions

1. One root-owned helper under `/usr/lib/couch/`, built with the existing Rust
   signature-verification dependencies. It accepts only the validated account
   identity supplied by the unit instance, never a command, URL or file path.
2. One root-owned `couch-package-update@.service` template. It runs once per
   request and owns private state/staging. No daemon, timer or enabled background
   service is required.
3. One Polkit rule permitting only `start` for the requesting account's exact
   unit instance. Reuse the pattern already used for Couch's two autostart units.
4. The enrolled public key in a root-owned package resource. Native requests
   cannot select or replace this key.

Systemd exposes separate permissions for unit operations, unit-file changes and
manager environment changes. Starting a job is not its completion; the caller
must observe its result and a matching root-written transaction receipt.
[systemd D-Bus API](https://manpages.debian.org/trixie/systemd/org.freedesktop.systemd1.5.en.html)

## Root verification boundary

- Bind each template instance to the Polkit subject's real account name. Resolve
  its UID and home through the system account database. Use a single fixed inbox
  location under that home. Do not accept `HOME`, `XDG_*`, paths, executable names
  or environment settings from the request as root configuration.
- Acquire one root-owned lock shared by all unit instances. Open the fixed input
  files by descriptor, rejecting symlinks throughout the path, nonregular files,
  unexpected ownership and excessive sizes. The supported Debian kernel provides
  `openat2` with `RESOLVE_NO_SYMLINKS`; final-component `O_NOFOLLOW` alone does not
  protect intermediate directories.
- Copy bytes and signature into a new root-owned private directory before any
  package inspection or signature validation. All subsequent checks and APT
  installation use these same copied bytes. Mutation of the user's inbox can
  therefore only produce a failed signature or another independently valid
  package, not replace an already verified file under APT.
- Independently verify the Tauri signature against the root-owned key. Check
  package name `couch`, amd64 architecture, supported Debian host, increasing
  version, and signed release metadata. Compare package control identity and
  signed metadata; reject caller-supplied downgrade or alternate-package flags.
- Read signed metadata with `dpkg-deb --fsys-tarfile` and one bounded tar member,
  without running package code. Check current installed package state and other
  native Couch sessions before system-wide replacement.

[Linux descriptor resolution](https://manpages.debian.org/trixie/manpages-dev/openat2.2.en.html),
[Debian archive inspection](https://manpages.debian.org/trixie/dpkg/dpkg-deb.1.en.html)

APT receives fixed arguments for the root-owned local package, normal repository
authentication, no recommended-package expansion and `--no-remove`. Do not pass
`--allow-unauthenticated`, downgrade overrides, held-package overrides, arbitrary
configuration or repository URLs. Required dependencies come from the machine's
existing administrator-controlled Debian sources. APT owns dependency resolution
and package-manager locking. A failed install can leave packages unconfigured;
report that honestly and retain logs instead of promising an atomic rollback.
[APT command reference](https://manpages.debian.org/trixie/apt/apt-get.8.en.html)

## Application lifecycle

Couch continues enforcing paired-Administrator permission, manual interruption
confirmation, idle policy, recording/import protection, signed staging, stopped
writers, data backup and post-restart health. The broker installs packages only.
It neither trusts a caller's assertion that bytes were verified nor accepts
browser input directly.

Local processes running as the authorized Couch account can also request this
specific signed Couch upgrade. The root checks must remain safe under that
assumption. The account receives no general OS-administrator authority.

Use a bounded request identity and a root-owned result containing that identity,
package digest, installed version and terminal outcome. Native code matches this
result to its candidate before advancing to trial/relaunch. Keep the transaction
serialized until APT actually finishes; a disconnected phone or dropped future
must not be treated as cancellation of dpkg.

Keep the AppImage implementation unchanged. Native recovery stays an explicit
administrator action using retained package material and preserved current data;
this proposal adds no automatic rollback or exact-current CDN downloader.

## Required security and installed tests

- Paired Administrator can update from a phone; Controller and unpaired requests
  fail before native admission. Approved idle behavior still waits for ten idle
  minutes and stops when late activity arrives.
- Polkit allows only the account's exact start action. Another account's instance,
  another unit, restart, stop, kill, property changes, manager environment changes
  and transient-unit/property injection cannot obtain unattended permission.
- Bad/missing signatures, wrong keys, wrong package/architecture, mismatched
  signed/control identity, non-increasing versions and oversized metadata fail
  before any maintainer script or APT mutation.
- Symlinks at every input path component, hard links, FIFOs, devices, wrong owners,
  renamed parents and concurrent content replacement cannot redirect root reads
  or change the bytes installed after verification.
- Replayed/mismatched request IDs, forged user-writable results and two concurrent
  desktop/TV requests cannot cause a false success or overlapping replacement.
- Genuine Debian dependency installation succeeds; unauthenticated repositories,
  removal-requiring solutions, held packages, unavailable dependencies and APT
  lock contention fail without a silent trust or policy override.
- A second active native Couch session blocks replacement. The initiating
  installation preserves data, observes the real broker result, relaunches, and
  reports success only after native/backend/frontend health agrees.
- Kill/disconnect the caller during APT and restart after broker failure. Preserve
  the transaction and logs; never reinstall automatically because the HTTP
  response was lost.

The broker/unit/Polkit integration must be exercised on a booted Debian system.
Mocked commands cannot establish this privilege boundary.
