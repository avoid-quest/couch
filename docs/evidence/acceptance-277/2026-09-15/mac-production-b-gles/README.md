# Corrected production B: 0.1.0

Qualified candidate from clean committed source `61739ad7ce782da5482067f16a5727306cd65d6a`, correcting the missing Debian GLES host dependency. Old production B, production A and their evidence remain preserved. The parent release task subsequently published the corrected bytes to Preview; the receipts below record that step.

## Candidate and build

- Retained manifest and receipt: `hosted-release/`; candidate binaries remain in the private original directory.
- AppImage SHA256: `dd50813112c9643faddeedee46889e8102965c97f5d77bfd43d45756a20c6a05`.
- Manifest SHA256: `71092f2544deca180fd7279676de8ed617902871b9b517f1ee54f562522db6d0`.
- Original qualification receipt SHA256: `fb8ccdc765acb6beba621f5621a1c47532377dcedae2da9a8cfef0d4ca0f3854`.
- Build, signing, inventory and sealing: **299.611 seconds**, including **1m16s** native release compilation.
- Production key matches the permanent enrolled public key. Private values were supplied only to the build process environment, not printed or saved in logs.
- The private original `run.ts` orchestrates the build; retained `timings.json`, `source.bundle.sha256`, `cache-image-id.txt`, and `container-provenance.txt` identify source, cache and execution limits. A new snapshot/container reused old B's compile cache. Native Linux tests ran from the same committed source with Bun 1.4.2.

## Qualification

[The matrix](MATRIX-QUALIFICATION.md) records six real checks. The official final verifier passed after receipt creation (`final-verify.log`). Before/after hashes show all six public files and the manifest were unchanged throughout qualification. The original unchanged `hosted-qualify.sh` is not claimed to have passed under Mac emulation.

`packaged-host-requirements.json` verifies that the signed setup archive contains the exact committed package list, including `libgles2`. `host-graphics-regression-reference.json` ties the source script and list to the real-APT regression: original list failed to load GLES; adding only libgles2 passed. Its original logs and package delta remain in `../host-gles-regression/`.

## Limits and cleanup

The qualification checks establish source and signed-byte qualification; separate receipts below establish Preview publication and public readiness. Neither establishes pristine installation of corrected B, GUI rendering, playback, an A-to-B update, Mac-offline acceptance or Stable promotion. The native T480 first failure remains preserved separately, and this collector made no T480 changes. The extraction-only diagnostic VM preserved its installed application and package state; the fresh minimal clone was not used for extraction.

The corrected B builder, native Bun test container, old B, A and original cached containers are stopped; `cleanup.json` records their state. The guest helper owns diagnostic shutdown and fresh-clone startup. No completed prior candidate was overwritten.

## Evidence handling

These are sanitized copies of the local corrected-B evidence. No candidate binaries, source archive or credentials are included. `evidence-files.json` maps original file hashes to retained hashes. Hashes embedded in the qualification receipt refer to private original logs; sanitized copies can differ. User home paths and private IPv4 addresses are replaced where present. Public signatures and the enrolled public key are intentionally retained. `sanitization-audit.json` records the exact signing-value and common credential-pattern checks on these copies. The separate archive scan report describes checks on the actual public archives.

## Preserved content-scan failure

`public-archive-checks-first-failure.json` records a failed scan of a Mac filesystem copy: one icon appeared to differ. The inventory contains both regular `Couch.png` (256px, 5,085 bytes) and lowercase `couch.png` (a symlink to the 32px icon). Copying onto the case-insensitive Mac filesystem merged those names. This does not establish a change in the Linux staging directory or signed candidate. The failed report's generic scope sentence incorrectly says every file matched; its `passed: false` and mismatch count are authoritative for that attempt. Final content verification must use the case-sensitive Linux extraction of the sealed AppImage.

The final `public-archive-checks.json` passes: both actual public archives have zero secret matches or unsafe paths, and all 2,033 inventory entries from the sealed AppImage match in case-sensitive Linux, with zero secret matches or sensitive paths. The prior Mac copy failure is retained separately; no candidate bytes were changed to obtain this result.

Content-scan extraction logs preserve the Mac case-collision attempt (`sealed-content-extraction.log`), initial Linux collector setup error (`sealed-content-linux-extraction.log`), and successful Linux extraction (`sealed-content-linux-extraction-2.log`). These are separate from the already-passing standard-runtime metadata extraction.

## Preview publication and public readiness

[Publication](hosted-release/receipts/publish-preview.json) records corrected B published to **Preview at 2026-09-15T01:27:37.909Z**, with all six assets. The asset names, sizes and signatures match the qualified manifest. [Public readiness](hosted-release/readiness-preview.json) passed at **2026-09-15T01:29:22.138Z** for nine URLs: six public files, the installer selector, updater metadata and its selected AppImage. The release task reported one 60-second retry after HTTP 429 using the already-committed bounded retry code; source and candidate bytes were unchanged.

[The original draft](hosted-release/draft-preview.json) was created empty before the GLES correction. The same provider release record was later populated with the corrected assets shown in [the upload receipt](hosted-release/receipts/upload-preview.json), then published. The old B files from source `bb03a3a54f5ca2a1664cd6235c61cf39e4fa5a7e` remained private and unused; this publication does not identify those superseded bytes. The draft's earlier notes are retained exactly as provider evidence, not as a statement that the corrected setup is identical to old B.

These receipts establish Preview availability at the recorded time. They make no Stable, A-to-B update, GUI/playback, fresh-installation or website-deployment acceptance claim.
