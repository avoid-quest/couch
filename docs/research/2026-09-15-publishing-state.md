# Publishing state on 15 September 2026

## Current release and infrastructure

Stable 0.1.0 is public. A fresh read of the [Stable updater endpoint](https://cdn.crabnebula.app/update/avoid-quest/couch/linux-x86_64-appimage/0.0.0) returned version `0.1.0` and publication time `2026-09-15T10:40:54.316Z`. The [closure of #276](https://github.com/avoid-quest/couch/issues/276#issuecomment-5678866142) records promotion of the same six qualified Preview files, without rebuilding or resigning. Its AppImage source is `61739ad7ce782da5482067f16a5727306cd65d6a`, SHA-256 `dd50813112c9643faddeedee46889e8102965c97f5d77bfd43d45756a20c6a05`.

The Mac remains the working build and publication fallback. It builds Linux binaries in the pinned Debian 13 container. CrabNebula serves downloads and updates independently of the Mac. The T480 only installs and runs Couch. The [acceptance closure](https://github.com/avoid-quest/couch/issues/277#issuecomment-5678866699) records a real signed A-to-B update during an independently recorded Mac-offline interval. [The production build record](../evidence/acceptance-277/2026-09-15/mac-production-b-gles/README.md) and [packaging instructions](../packaging.md#build) describe the retained Mac path.

Live GitHub state differs from the older pause documentation:

- `gh api repos/avoid-quest/couch/actions/permissions` returned `enabled: true`.
- `gh variable get COUCH_RELEASES_ENABLED` returned `true`.
- The latest run remains [Package 34909480229](https://github.com/avoid-quest/couch/actions/runs/34909480229), created `2026-09-14T23:34:33Z`. Build, signing, qualification and candidate verification succeeded. `actions/upload-artifact` failed because artifact storage quota had been hit. CrabNebula upload, publication and readiness jobs were skipped.
- A paginated read of [the repository artifacts API](https://api.github.com/repos/avoid-quest/couch/actions/artifacts) found 107 unexpired artifacts totaling 14,985,935,405 bytes, about 13.96 GiB. This is the repository inventory, not the organization's billing meter or an assertion about the current account-wide allowance. No artifacts were deleted and no workflow was dispatched during this investigation.

[docs/ci.md](../ci.md) is stale where it says Actions is disabled and the Package workflow still needs its Debian migration. The live [Package workflow](../../.github/workflows/package.yml) already uses Blacksmith 4-vCPU runners and the pinned Debian builder. The older acceptance preparation documents also preserve historical blocked states; their later issue closure comments supersede those states.

## Why six public files exist

The six-file set is an explicit Couch choice in [hosted-policy.ts](../../scripts/hosted-policy.ts), not a CrabNebula requirement.

| File | Size in 0.1.0 | Purpose |
| --- | ---: | --- |
| `Couch_0.1.0_amd64.AppImage` | 289,110,520 bytes | The application and the Tauri update payload. |
| AppImage `.sig` | 416 bytes | Detached update/bootstrap signature. |
| `couch-setup-0.1.0.tar.gz` | 16,604 bytes | Installer, recovery command, desktop/TV setup files and Debian host-package list. |
| Setup `.sig` | 412 bytes | Verifies the setup archive before executing its installer. |
| `couch-distribution-material-0.1.0.tar.gz` | 3,159,850 bytes | Third-party notices, licenses and approved dependency material. |
| Distribution material `.sig` | 436 bytes | Verifies that separately downloadable archive. |

Sizes and identities come from [the signed release manifest](../evidence/acceptance-277/2026-09-15/mac-production-b-gles/hosted-release/manifest.json). [package-setup.ts](../../scripts/package-setup.ts) shows the two archive allowlists. The distribution archive does not contain Couch's private application source. Its purpose is explained in [packaging/NOTICE](../../packaging/NOTICE); this investigation does not make a license-compliance assessment.

Tauri's supported Linux updater reuses the normal AppImage and verifies its signature. Signing cannot be disabled. It does not require end users to manually operate `minisign` or `jq`. Those are dependencies of Couch's current shell bootstrap and installer. `minisign` verifies the downloaded files; `jq` reads the host-package list and build identity. See [Tauri updater documentation](https://v2.tauri.app/plugin/updater/) and [install-couch](../../install-couch).

## Smallest useful simplification

The page should expose one installation entry point. Users should not have to understand sidecar signatures, base64 wrappers, archive extraction or JSON tools. Keep dependency notices available through a secondary link. The initial low-change proposal was to automate the existing installer. The owner's follow-up requested a first-class Tauri solution; the [official installation investigation](2026-09-15-tauri-installation.md) evaluates native Debian packaging and its update implications. No installation change was implemented.

One download presented to a user does not require one physical object in release storage. AppImage plus its updater signature is the normal Tauri pair. Setup could later be bundled into the AppImage or another single installer, but that changes bootstrap and recovery behavior and needs a new signed release. Third-party notices are also packaged as app resources; deleting or merging the separate material archive should follow a content/distribution review, rather than assuming it is required for installation. See [Tauri package resources](../../src-tauri/tauri.package.conf.json), [resource generation](../../scripts/package-prepare.ts) and [the setup archive builder](../../scripts/package-setup.ts).

Keep the current release files intact while simplifying the public page and install entry point. There is no need to change the working updater protocol to make the page usable.

## Removing the Actions storage bottleneck

The present workflow uploads the complete candidate as `hosted-release-*`, then downloads it into separate upload, publication and readiness jobs. It uploads another complete copy as `hosted-ready-*` after success. Even one 0.1.0 release retained twice is roughly 585 MB, before receipts or older releases. That already exceeds the documented 500 MB GitHub Free artifact allowance. Seven-day retention limits growth but does not solve this mismatch. The account's precise billing status was not read. Sources: [workflow](../../.github/workflows/package.yml), [manifest](../evidence/acceptance-277/2026-09-15/mac-production-b-gles/hosted-release/manifest.json), [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

Changing runner providers does not remove `upload-artifact` from this workflow. The Blacksmith build already succeeded; the handoff into GitHub artifact storage failed.

The smallest structural change is to build, qualify and upload to a CrabNebula draft in the same job, then publish the verified draft. GitHub artifacts can retain small receipts only. CrabNebula's [official Tauri workflow](https://docs.crabnebula.dev/cloud/ci/tauri-v2-workflow/) uploads directly after building and publishes separately; it does not require the app payload to pass through GitHub artifacts. Couch would still need to adapt its retry and Stable-promotion commands, which currently require retained GitHub run artifacts. Keep the signed build and qualification receipt in existing private retained storage until that retrieval path is settled.

Deleting obsolete artifacts after preserving needed recovery evidence, or enabling paid storage, are operational alternatives. Neither was performed here. Until capacity or the workflow changes, the established Mac build-to-CrabNebula path remains usable and public delivery remains independent of that machine.
