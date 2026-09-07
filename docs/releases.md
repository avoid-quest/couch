# Private releases and the LAN feed

`main` is the Preview integration branch in `.github/workflows/package.yml`. Package runs qualify the native `.deb` on clean Ubuntu before uploading `couch-release-RUN.ATTEMPT`. Pull-request artifacts remain qualification evidence and cannot enter the feed. Packaging is explicit: dispatch on `main` with release notes. Main pushes do not build packages.

Each release contains `couch` and `couch-appliance` at `PRODUCT+build.RUN.ATTEMPT`. The run and attempt are positive decimal integers, so later attempts and runs sort forward under Debian version comparison. The application product version must also never decrease. Source revision remains separate from the Debian version. A changed package or manifest cannot replace an existing release identity. Stable promotion does not rebuild, rename, or repack either package.

`release.json` records the exact source, Debian version, CI attempt, Ubuntu 24.04/amd64 compatibility, helper versions and hashes, package sizes and hashes, qualification checks, display limitations, data-preservation requirements, and notes. GitHub keeps qualified artifacts for 30 days; retain downloaded release directories and the feed in backed-up administrator storage before that expiry.

## Download through the authenticated Mac

Keep the source repository private. The TV never receives GitHub authentication or a source checkout. On the Mac, use the existing `gh auth` session to list the artifacts for a successful Package run, then select the exact numeric artifact ID:

```sh
gh api repos/avoid-quest/couch/actions/runs/RUN_ID/artifacts --jq '.artifacts[] | {id,name,digest,expired}'
bun scripts/download-release.ts ARTIFACT_ID /absolute/private-releases/RUN.ATTEMPT
```

The downloader checks the successful `main` Package run, GitHub's archive SHA256, exact source identity, every package hash, and the archive file list. It refuses to overwrite an existing destination. A new build gets a new attempt and version. Retrying only qualification preserves the original build identity; the downloader requires the latest overall run attempt to succeed. Qualification-only dispatch against saved binaries produces evidence without publishing a release.

## Provision the private signer once

The publisher needs Bun 1.4.2, Debian `apt-utils` (`apt-ftparchive`), `dpkg`/`dpkg-deb`, util-linux (`flock`), and GnuPG. Run it on Ubuntu, including a dedicated Ubuntu container on the Mac. Keep release storage and the signing directory on separate persistent Mac bind mounts. Do not use the project's native build cache or preview container. Install `apt-utils gnupg` on Ubuntu 24.04 and the pinned Bun runtime; `dpkg` and `flock` are already present. APT generates Packages and Release indexes, while Bun retains release identity and atomic promotion policy.

Use a persistent private directory such as `$HOME/Library/Application Support/Couch/releases`. Set its mode and the `gnupg` subdirectory to `0700`. Keep `gnupg` outside the HTTP-served `feed` directory and outside any source checkout. Create the key from an interactive terminal so its passphrase remains private:

```sh
export GNUPGHOME=/private-release-storage/gnupg
umask 077
mkdir -p "$GNUPGHOME"
gpg --quick-generate-key 'Couch LAN release signing' ed25519 sign 1y
gpg --list-keys --with-fingerprint
```

Record the full fingerprint with the installation evidence. Back up the private directory and GPG revocation certificate in encrypted administrator storage. Keep an offline copy of the public key and fingerprint. The fixture generates a disposable passphrase-free key for tests only; never enroll that fixture key on a real installation. The signer must be unlocked when publishing. Signing failure leaves the advertised channel unchanged.

Export only the public key for enrollment:

```sh
gpg --armor --export FULL_FINGERPRINT > couch.asc
sha256sum couch.asc
```

Transfer that file from the trusted Mac through the already verified SSH host connection during initial installation. Compare its SHA256 on the TV to the value obtained locally on the Mac. Do not fetch a replacement trust key from the LAN feed during an update. Pass the transferred public key, its trusted SHA256, the feed URL, and the channel to the same installer during initial installation:

```sh
sudo bash /absolute/staging/install-couch /absolute/staging/couch_VERSION_amd64.deb /absolute/staging/couch-appliance_VERSION_all.deb --release-key /absolute/staging/couch.asc --release-key-sha256 TRUSTED_SHA256 --release-feed http://MAC_LAN_ADDRESS:8765/ --release-channel preview
```

The installer checks the key hash before changing services, then installs it at `/etc/apt/keyrings/couch.asc` and creates `/etc/apt/sources.list.d/couch.sources`:

```text
Types: deb
URIs: http://MAC_LAN_ADDRESS:8765/
Suites: preview
Components: main
Architectures: amd64
Signed-By: /etc/apt/keyrings/couch.asc
```

Use `stable` for Stable installations. Enroll one channel, since enrolling both makes APT choose the higher version. Never add `trusted=yes` or an insecure-repository override. The initial administrator enrollment establishes trust before any channel checks. APT authenticates the signed index and package hashes after that.

## Publish and promote

Run the publisher with the verified artifact directory, persistent feed directory, channel, and full signing fingerprint:

```sh
bun scripts/publish-release.ts /private-release-storage/RUN.ATTEMPT /private-release-storage/feed preview --key FULL_FINGERPRINT
bun scripts/publish-release.ts /private-release-storage/RUN.ATTEMPT /private-release-storage/feed stable --key FULL_FINGERPRINT
```

Stable requires a successful prior Preview publication. A feed-wide file lock serializes all publishers. Inside that lock the publisher validates the artifact, rejects backwards channel movement using `dpkg --compare-versions`, writes immutable packages, prepares and verifies the signed index, then atomically replaces the channel symlink. Older jobs cannot undo a newer publication. A failed publication may leave an unadvertised immutable release directory, which is safe to retain and retry.

Serve only `feed`, for example with Caddy’s `caddy file-server --listen MAC_LAN_ADDRESS:8765 --root /private-release-storage/feed`. The HTTP server must follow the relative channel symlinks. The publisher retains old snapshots, packages, and by-hash indexes so clients can finish requests begun before a channel switch. Do not garbage-collect them during the private development phase.

Metadata expires after seven days. Re-publish the same immutable release to renew the signature and expiry without changing the package. When the Mac sleeps or leaves the LAN, the feed is unavailable. Failed or missed APT checks leave the installed Couch package running. Expired metadata also fails closed. This publisher installs no timer or updater; channel selection and update policy belong to the later appliance tickets.

## Install a verified package and demonstrate a second build

Copy the verified release packages from the Mac through the known SSH connection to the TV's existing administrator staging directory. Include a `SHA256SUMS` file made from those verified local files and the reviewed `install-couch` entry point from the same source revision. On the TV, compare the transferred hashes and invoke the supported installer with absolute package paths:

```sh
sha256sum --check SHA256SUMS
sudo bash /absolute/staging/install-couch /absolute/staging/couch_VERSION_amd64.deb /absolute/staging/couch-appliance_VERSION_all.deb
```

Retain an existing custom data directory according to `docs/install-couch.md`. The installer calls APT and preserves the appliance configuration. Do not place source, compilers, GitHub tokens, or the signing key on the TV. For a feed acquisition check, run `sudo apt-get update` and use `apt-get download couch=VERSION couch-appliance=VERSION` in the staging directory, then invoke the same installer with those exact verified files.

For real acceptance, qualify and download two distinct successful CI attempts, publish the first to Preview, install it, then publish and install the second. Record both artifact IDs, archive/package hashes, source commits, selected channel, installed `dpkg-query` versions, running `/api/build` identity, preserved profile/pairing/data, and the Package workflow elapsed time plus local publication elapsed time. Promote the second to Stable and show that its hashes stay unchanged. Coordinate all T480 changes with its current owner. Do not substitute repacked or fixture packages for this real-build evidence.

Run the disposable integration test only inside a throwaway Ubuntu container with Bun, `apt-utils gnupg`; it installs dummy packages named `couch` and `couch-appliance`:

```sh
bun scripts/test-publish-release.ts
```

It exercises signed APT installation of two fixture builds, exact-byte promotion, publication failure and tamper rejection, monotonic versions, and retained by-hash indexes. It is software evidence, not real-device acceptance.

## Move distribution to public hosting later

Keep the signing identity, packages, manifest format, `dists` paths, and by-hash indexes. Upload immutable `releases/` and `snapshots/` content completely, verify remote sizes and hashes, then switch channel references using a host's atomic pointer operation. A flat object store needs an adapter that publishes by-hash and package objects first, then updates each channel's `InRelease` last with a conditional write; this local symlink publisher must not be copied unchanged onto such a backend.

Move the source URL to the public HTTPS feed through an authenticated configuration update while preserving `Signed-By`. Making GitHub source public does not create an APT repository. Key rotation requires the already trusted path to deliver the replacement key before switching signers.

APT owns index generation through [apt-ftparchive](https://manpages.ubuntu.com/manpages/noble/man1/apt-ftparchive.1.html). The optional LAN server uses [Caddy’s static file command](https://caddyserver.com/docs/command-line#caddy-file-server). The implementation follows [APT archive authentication](https://manpages.debian.org/bookworm/apt/apt-secure.8.en.html), [immutable GitHub artifacts](https://github.com/actions/upload-artifact), and [GitHub artifact metadata and downloads](https://docs.github.com/en/rest/actions/artifacts).
