# Four-platform Preview assembly

This path prepares one CrabNebula `preview` release version with six assets:
Debian, AppImage, Mac DMG and updater tarball, Windows NSIS installer and updater
ZIP. [Cloud supports repeated uploads to one draft](https://docs.crabnebula.dev/cloud/cli/upload-assets/).
The [Tauri updater](https://v2.tauri.app/plugin/updater/) uses the Mac tarball
and Couch's Windows compatible NSIS ZIP; the DMG and NSIS EXE are public
installer downloads. Each file has its own Tauri signature. The Mac DMG is
signed explicitly during receipt sealing because Tauri signs its updater
tarball, not the disk image.

## Gate and build identity

Wait for the desktop Wayfinder implementation list and required source/package
checks to pass before dispatching. The Release workflow has no push trigger.
Its manual dispatch produces an unpublished Debian draft. Package and the
single-format release script reject direct Preview publication, including
retries from signed receipts. Use one committed
`main` revision and one `X.Y.Z-preview.N` version for all four formats. A
different source revision or signing key blocks assembly. Do not reuse a Cloud
draft after an upload failure with different bytes; retain the same candidate
or create a newer version.

The enrolled Tauri private key and its password stay in GitHub's
`couch-release` environment for the Linux Package and native desktop jobs.
The Cloud API key is also available to the `couch-publication` environment,
which publishes the assembled release without access to the updater private key.
No production signing or Cloud key is needed on an owner's Mac; local Mac work
is limited to unsigned/headless checks.
Enable `COUCH_RELEASES_ENABLED` only after the implementation and source/package
gates pass. Keep signed receipts beyond GitHub's 90-day artifact/log retention
window. No package payload goes through GitHub artifacts.

## Build and upload

After the gate, dispatch Release or Package once for the Debian draft:

```sh
gh workflow run release.yml --repo avoid-quest/couch --ref main
# Or dispatch Package directly with format=deb, channel=preview, publish=false.
```

Record the successful Package run and attempt and its 26-character draft ID
from the small `release-receipts-RUN.ATTEMPT` artifact. The signed manifest
records the revision, version, package hashes and updater key. The later jobs
download these small receipts and, if artifact storage failed, recover them
from the bounded `COUCH_RELEASE_RECEIPTS=` run log. They check signatures and
the original GitHub run before using either copy.

Build AppImage from that same `main` revision and attach it to the Debian draft:

```sh
gh workflow run package.yml --repo avoid-quest/couch --ref main \
  -f format=appimage -f channel=preview -f publish=false -f release-id=DRAFT_ID
```

Record its successful run and attempt. The Package job verifies and uploads
the exact AppImage on its Debian builder.
It accepts the recorded Debian asset in the draft and still refuses AppImage
publication. The pinned builder's clean package and disposable runtime checks
remain the source/package proof; installed AppImage update behavior is a
separate target check.

Dispatch each native package on the GitHub Apple Silicon `macos-26` runner:

```sh
gh workflow run package-desktop.yml --repo avoid-quest/couch --ref main \
  -f format=dmg -f deb-run=DEB_RUN -f deb-attempt=DEB_ATTEMPT -f release-id=DRAFT_ID
gh workflow run package-desktop.yml --repo avoid-quest/couch --ref main \
  -f format=nsis -f deb-run=DEB_RUN -f deb-attempt=DEB_ATTEMPT -f release-id=DRAFT_ID
```

The jobs check the Debian signed receipt against their checkout, build and
inspect their package, seal the exact bytes and upload directly to the same
Cloud draft. The Mac DMG contains Full capabilities, including a switchable
Client-only mode; the Windows NSIS stays Client-only. Record each successful
native run and attempt. These jobs retain only signed manifests, qualification
receipts and Cloud upload metadata. `act` can exercise their guards and control
flow, but cannot execute a macOS runner or prove a native package build.

## Publication and target checks

After the coordinating task confirms the implementation list and signed
source/package checks, dispatch the assembly job with all four successful run
IDs and attempts:

```sh
gh workflow run publish-preview.yml --repo avoid-quest/couch --ref main \
  -f deb-run=DEB_RUN -f deb-attempt=DEB_ATTEMPT \
  -f appimage-run=APPIMAGE_RUN -f appimage-attempt=APPIMAGE_ATTEMPT \
  -f dmg-run=DMG_RUN -f dmg-attempt=DMG_ATTEMPT \
  -f nsis-run=NSIS_RUN -f nsis-attempt=NSIS_ATTEMPT -f release-id=DRAFT_ID
```

The job rejects mismatched versions, revisions, keys, source runs, formats and
Cloud asset metadata before publishing. `readiness` hashes all six public downloads, checks the four platform download
routes and updater metadata-selected bytes, writes per-format readiness
receipts, and mirrors the changelog to one GitHub prerelease. If CDN
propagation delays readiness after publication, dispatch the same workflow
with the same inputs and `-f readiness-only=true`. Keep the receipts and Cloud
release ID. The T480 only installs and runs Couch; it never
builds. Mac and Windows static package verification does not replace installed
Mac DMG and Windows 11 NSIS launch, updater, trust and state-preservation
acceptance. AppImage FUSE/Wayland and real installed upgrades also remain
separate from its container fixture. The owner will perform installed and
physical/UI acceptance after Preview publication; those open checks do not
block this release path.
