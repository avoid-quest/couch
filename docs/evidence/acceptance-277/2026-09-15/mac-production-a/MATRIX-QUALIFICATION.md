# Production A qualification matrix

Candidate version `0.1.0-preview.1`, source `3f91c0564bbbeea04eef421977f2e67b17c8fb14`. The complete production build/sign/inventory/seal passed in 301.866 seconds. This is a newly built local candidate, not the inaccessible hosted candidate and not the retained disposable-key artifact.

The unchanged `hosted-qualify.sh` did not pass in Mac Docker emulation. Its first run is retained, with two legacy signing failures caused by explicitly empty private-key variables and one missing-executable failure caused by emulated Bun returning exit 127 rather than throwing on missing exec. No failure was erased and no product source/assertion was modified.

The following split qualification checks the same source and signed bytes. Selected sanitized command logs are retained beside this document; original logs remain private.

| Required check | Execution and result |
| --- | --- |
| Signatures | Build seal and repeated `bun scripts/hosted-release.ts verify` pass in Debian amd64; parent separately verifies local signatures with Minisign 0.12 |
| Typecheck | `bun run typecheck` passes in the source's Debian amd64 container with signing/provider variables unset |
| Bun | Full suite on native Debian arm64, exact source/lockfiles, Bun 1.4.2+744846f84: 1249 pass, 20 skip, 0 fail; separate clock file: 3 pass, 0 fail |
| Architecture-specific Bun tests | Debian amd64 `scripts/package-inventory.test.ts`: 12 pass, 0 fail. Named union with arm64 is 1261 passing suite cases plus 3 clock cases |
| Native | `cargo test --manifest-path src-tauri/Cargo.toml --locked --release` passes in Debian amd64: 37 library tests plus 2 binary tests pass; one existing ignored test remains ignored |
| Signed manifest extraction | Pass in the retained diagnostic x86 Debian VM: Minisign and standard runtime extraction exit 0, exact generated release.json byte match. Existing app/package state unchanged. Mac Docker Exec format error remains recorded |
| Installer | Fresh disposable Debian amd64, no network, unchanged `tests/package/installer.sh`: passes real signature checks and documented doubled-host installer/recovery cases |

`test-coverage-matrix.json` reconciles every named skip. The 20 arm64 skips consist of the 12 amd64-only inventory tests, two unnamed skipped suite callbacks, and the same six optional yt-dlp/Twitch/RaiPlay cases reported in the hosted run. All 12 additional named tests passed on amd64. Both legacy signing tests and the missing-executable test pass in the full native arm64 suite. This does not turn the six optional skips into successful live provider playback.

The pure amd64 signing rerun also passes both tests, with 27 assertions, when `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `TAURI_SIGNING_PRIVATE_KEY_PATH` and `CN_API_KEY` are actually unset. No production credential was used for tests.

`before-requalification.sha256` and `after-matrix.sha256` are identical for all six assets and the manifest. The setup/archive bytes were not rebuilt or resigned during qualification. The full manifest public key matches the owner's enrolled public key. This qualification does not establish pristine installation, graphical playback, Mac-offline update acceptance or Stable promotion.

## Commands and provenance

Native arm64 tests ran in `couch-production-277-bun-native`, created from existing `debian:13-slim` arm64, with Debian test tools and the official Bun 1.4.2 arm64 binary. Source and lock digests are in `native-bun-provenance.txt`. Setup/package logs are in `native-bun-setup.log`. It is stopped after testing.

The build and amd64 checks ran in `couch-production-277-a3`, with source checkout `/work` and existing `/build-target` compiler cache. See `container-provenance.txt` for the cache identity; source preparation logs remain private.

```sh
# Native arm64 Linux, clean environment without signing/provider variables:
bun test ./tests/linux/iptv-clock.test.ts
bun test --path-ignore-patterns tests/linux/iptv-clock.test.ts

# Debian amd64, signing/provider variables explicitly unset:
bun run typecheck
bun test scripts/package-inventory.test.ts
cargo test --manifest-path src-tauri/Cargo.toml --locked --release
bun scripts/hosted-release.ts verify .artifacts/hosted-release

# Separate fresh disposable Debian amd64 container, no network:
bash tests/package/installer.sh
```

Final VM result: `diagnostic-minimal-extraction/decoded-signature-attempt/driver.stdout`, completed `2026-09-15T00:20:20Z`. Extracted release.json SHA-256: `c21213d223bc3200040d788e234fd0d6f5e46236aabcbaceee92f635640107ac`. The first VM collector failed to decode Tauri wrappers; its logs remain retained separately. This collector correction did not alter app bytes.

Final `hosted-release/qualified.json` records all six checks plus this explicit qualification matrix. `result.json` records manifest/receipt hashes and public file identities. No publication was performed by this build task.
