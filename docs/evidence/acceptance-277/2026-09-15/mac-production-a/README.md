# Production A package qualification

Production A is `0.1.0-preview.1`, built locally from clean committed source `3f91c0564bbbeea04eef421977f2e67b17c8fb14` in the Debian 13 amd64 builder on the Mac. Build, signing, inventory and sealing completed in 301.866 seconds. This is a new production-key candidate after GitHub artifact quota prevented retrieval of the separately built hosted candidate.

[manifest.json](hosted-release/manifest.json) identifies the six signed public files. The AppImage is 289,114,616 bytes, SHA-256 `d67dab162272ab340d42a6ee70d7a35055696e99be2a8b0cb87edceb60c55ef7`. [build-info.json](build-info.json), [build-inputs.json](build-inputs.json) and the provenance files retain its source, tools and cache identity. [public-archive-checks.json](public-archive-checks.json) records the explicit archive inventory and secret scan.

## Qualification and preserved failures

The unchanged `hosted-qualify.sh` failed on Mac Docker emulation. [The original log](exact-byte-qualification.log) retains 1,258 passing tests, six optional skips and three failures. Two signing fixtures inherited explicitly empty signing variables. The missing-executable fixture encountered emulation returning exit 127 instead of the native error. Assertions and product sources were unchanged.

[The matrix](MATRIX-QUALIFICATION.md) and [named coverage](test-coverage-matrix.json) establish the completed checks:

| Check | Result |
| --- | --- |
| Signature and inventory verification | Passed on the actual retained candidate; [final verification](final-verification.log) |
| Typecheck | Passed in Debian amd64 with signing/provider variables unset |
| Bun suite | Native Debian arm64, pinned Bun 1.4.2, 1,249 passed; all 12 additional named inventory cases passed on amd64, giving 1,261 passing cases |
| Clock tests | Three passed in a separate native Linux process |
| Former signing failures | Both passed in the full native suite and clean-environment amd64 rerun |
| Native Rust | Locked release suite passed, 39 tests; one existing ignored test |
| Signed manifest extraction | Minisign and the standard amd64 AppImage runtime passed in the diagnostic VM; extracted bytes match the generated resource |
| Disposable installer fixture | Passed on Debian amd64 with no network; real signatures, permissions and locks, with package/service/FUSE test doubles |

The arm64 suite reports 20 skips. These are 12 amd64 inventory tests, their two suite hooks, and the same six optional yt-dlp/Twitch/RaiPlay cases as the hosted suite. All additional named skips are covered by the amd64 run. The six optional cases remain skipped and establish no live-provider result.

[The first VM collector](diagnostic-minimal-extraction/first-attempt-receipts/summary.json) failed before extraction because it passed Tauri base64 envelopes directly to Minisign. [The corrected collector receipt](diagnostic-minimal-extraction/decoded-signature-attempt/summary.json) decodes those envelopes, verifies the signatures and extracts through the standard runtime. The installed AppImage and package state remained unchanged. Both attempts are retained; the diagnostic VM was shut down afterward. The separate Mac Docker execution-format failure is retained in [signed-manifest-extraction.log](signed-manifest-extraction.log).

[qualified.json](hosted-release/qualified.json) records all six required checks and explicitly identifies the matrix. It does not claim one uninterrupted script pass. The before/after SHA-256 lists confirm all six assets and their manifest stayed unchanged during qualification.

## Evidence handling and limits

These are sanitized copies from private attempt 3. [evidence-files.json](evidence-files.json) maps original file hashes to retained hashes. Hashes embedded in the original receipt refer to private originals; sanitized copies can differ. The manifest and asset identities are unchanged. User paths and private LAN addresses are removed where present. Secret values from the production signing files, provider credentials, deployment credentials and guest password were checked in memory without printing them. Public signatures and the enrolled public key are intentionally retained inside the manifest; no private key, credential, candidate binary or source archive is included.

## Publication and public readiness

The [upload receipt](hosted-release/receipts/upload-preview.json) and [publication receipt](hosted-release/receipts/publish-preview.json) record production A published in Preview with all six assets. [The first readiness attempt](readiness-first-failure.json) failed when the metadata-selected final asset returned HTTP 429. The response advertised a 51-second retry delay. The subsequent readiness run made [one 60-second retry on the same URL](readiness-retry.log), then [passed all nine URL checks](hosted-release/readiness-preview.json) at `2026-09-15T00:27:35.497Z`. These cover the six assets, installer selector, updater metadata and metadata-selected AppImage, matched to the qualified candidate.

The qualification matrix establishes package qualification. The provider receipts separately establish Preview publication and public readiness at the recorded time. They do not establish a pristine installation, GUI playback, real host installer behavior, Mac-offline A-to-B updating, Stable promotion or website deployment. The existing diagnostic installation is not a pristine acceptance baseline.
