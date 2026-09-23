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
checks to pass before dispatching. The Release workflow has no push trigger and its
manual dispatch produces an unpublished Debian draft. Use one committed
`main` revision and one `X.Y.Z-preview.N` version for all four formats. A
different source revision or signing key blocks assembly. Do not reuse a Cloud
draft after an upload failure with different bytes; retain the same candidate
or create a newer version.

The production Tauri private key, its password and the Cloud API key remain in
their existing owner-held stores. The Linux Package workflow uses the
`couch-release` environment. The Mac builder needs the same enrolled Tauri
key and public key for its build and `seal` commands, and the Cloud API key only
for `upload`. The assembly machine needs `COUCH_UPDATER_PUBLIC_KEY` and
`CN_API_KEY`, not the private key. Keep `.artifacts/preview` private and retain
the signed receipts outside the 90-day GitHub artifact/log retention window.
No package payload goes through GitHub artifacts.

## Build and upload

After the gate, dispatch Release or Package once for the Debian draft:

```sh
gh workflow run release.yml --repo avoid-quest/couch --ref main
# Or dispatch Package directly with format=deb, channel=preview, publish=false.
```

Record the Package run and attempt. Download its small
`release-receipts-RUN.ATTEMPT` artifact into
`.artifacts/preview/deb`. If artifact storage fails, restore the bounded
`COUCH_RELEASE_RECEIPTS=` run-log record with `scripts/hosted-receipts.ts`,
then verify its signatures and original-run provenance as described in
[hosted releases](hosted-releases.md#gates-and-signing). Read
`draft-preview.json` there for the 26-character release ID. The signed
`manifest.json` records the exact revision, version, hash and updater key.

Build AppImage from that same `main` revision and attach it to the Debian draft:

```sh
gh workflow run package.yml --repo avoid-quest/couch --ref main \
  -f format=appimage -f channel=preview -f publish=false -f release-id=DRAFT_ID
```

Download its small signed receipts into `.artifacts/preview/appimage`. The
Package job verifies and uploads the exact AppImage on its Debian builder.
It accepts the recorded Debian asset in the draft and still refuses AppImage
publication. The pinned builder's clean package and disposable runtime checks
remain the source/package proof; installed AppImage update behavior is a
separate target check.

On an Apple Silicon Mac checked out at the same commit, build and inspect the
Mac package and Windows cross-built package. These commands require the
existing target toolchains, Bun 1.4.2 and enrolled Tauri key:

```sh
bun run package:mac
bun scripts/preview-release.ts seal dmg .artifacts/preview/dmg
bun run package:windows
bun scripts/preview-release.ts seal nsis .artifacts/preview/nsis
```

`seal` copies only the verified package files, checks the inventory hashes,
verifies the updater signatures, signs the DMG and two small receipts, then
checks those receipts against the enrolled public key. Keep the qualified
bytes on this Mac. With `CN_API_KEY` and `CN_BIN` set for the supported Cloud
CLI, upload each format to the same recorded draft ID:

```sh
bun scripts/preview-release.ts upload .artifacts/preview/dmg DRAFT_ID
bun scripts/preview-release.ts upload .artifacts/preview/nsis DRAFT_ID
```

The signed manifests and qualification receipts for all four formats must
exist under `.artifacts/preview/{deb,appimage,dmg,nsis}`. Keep each format's
`receipts/upload-preview.json`. Before any publication, from the exact source
commit, run:

```sh
bun scripts/preview-release.ts verify .artifacts/preview DRAFT_ID
```

The check requires six approved Cloud assets whose size, signature and
platform metadata agree with all four signed manifests. It does not claim
Cloud has served the bytes publicly. It leaves the draft unpublished.

## Publication and target checks

After the coordinating task confirms the implementation list and signed
source/package checks, explicitly publish the verified draft, then check every public download
and updater endpoint:

```sh
bun scripts/preview-release.ts publish .artifacts/preview DRAFT_ID
bun scripts/preview-release.ts readiness .artifacts/preview DRAFT_ID
```

`readiness` hashes all six public downloads, checks the four platform download
routes and updater metadata-selected bytes, writes per-format readiness
receipts, and mirrors the changelog to one GitHub prerelease. If CDN
propagation delays readiness, rerun `readiness` against the same ID. Keep the
receipts and Cloud release ID. The T480 only installs and runs Couch; it never
builds. Mac and Windows static package verification does not replace installed
Mac DMG and Windows 11 NSIS launch, updater, trust and state-preservation
acceptance. AppImage FUSE/Wayland and real installed upgrades also remain
separate from its container fixture. The owner will perform installed and
physical/UI acceptance after Preview publication; those open checks do not
block this release path.
