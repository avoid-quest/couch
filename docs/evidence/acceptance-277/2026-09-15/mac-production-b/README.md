# Production B package qualification

This candidate was **never published**. The later physical T480 run exposed the missing `libgles2` prerequisite shared by A and this B. PR #291 fixes that omission; a separately identified B from source `61739ad7ce782da5482067f16a5727306cd65d6a` supersedes these bytes. The original qualification evidence below remains unchanged in scope.

Production B is `0.1.0`, built locally from clean committed source `bb03a3a54f5ca2a1664cd6235c61cf39e4fa5a7e` in the Debian 13 amd64 builder on the Mac. Build, signing and inventory took **292.809 seconds**, including 1m14s native release compilation. The build reused a snapshot of A's preserved cache in a separate container.

[manifest.json](hosted-release/manifest.json) identifies the six public files. The AppImage is 289,114,616 bytes, SHA-256 `0148ccd715d94061cd7593156ce6823cbcfa3e4b9137b10963d497a7ebee0df5`. The original manifest SHA-256 is `fb518513856b936fee92084122a91ddfe921a3c946d6d8c0e5c7f841de7a0f02`; the original qualification receipt SHA-256 is `28a8baa6c67d79eda6cd0b198ec5832cfc3e544bf2a80f9f1b36662fb83954b0`. [Build identity](build-info.json), [inputs](build-inputs.json), [tool and lockfile provenance](native-bun-provenance.log), [container provenance](container-provenance.txt), and [timings](timings.json) retain the build details.

## Qualification

[The matrix](MATRIX-QUALIFICATION.md) records six completed checks against the source and signed bytes. It does not claim the unchanged `hosted-qualify.sh` passed under Mac emulation; the reasons for using the matrix are preserved in production A evidence.

| Check | Result |
| --- | --- |
| Signatures and inventory | Official verification passed on the retained candidate, including after receipt creation; [final verification](final-verify.log) |
| Typecheck | Passed in Debian amd64 with private signing/provider variables unset |
| Bun suite | Native Debian arm64, pinned Bun 1.4.2, 1,249 passed; 12 inventory cases passed separately on amd64, giving 1,261 passing main cases |
| Clock tests | Three passed in a separate native Linux process |
| Native Rust | Locked release suite passed, 39 tests; one existing ignored test |
| Signed manifest extraction | Minisign and standard amd64 AppImage runtime passed in the diagnostic VM; exact generated metadata bytes matched |
| Disposable installer fixture | Passed on Debian amd64 without network, using real signatures, permissions and locks with package/service/FUSE test doubles |

[Named coverage](test-coverage-matrix.json) reconciles all 20 arm64 skips: 12 amd64 inventory cases, their two lifecycle hooks, and the same six optional live-provider tests. Every additional named case is covered by the amd64 run. The six optional yt-dlp/Twitch/RaiPlay cases establish no live-provider result.

[The VM summary](diagnostic-minimal-extraction/summary.json) verifies the AppImage signature and extracts `usr/lib/Couch/release.json` using the standard runtime. Extracted SHA-256 `3d72d55e742f3c0999648d415a56b09151ba9c95196999a3253043f1473e6a5b` matches the generated resource exactly and identifies version `0.1.0`, source `bb03a3a54f5ca2a1664cd6235c61cf39e4fa5a7e`, target `x86_64-unknown-linux-gnu`, packaged true. The original summary SHA-256 is `dc9e7777603da6cf383b9a9d547f115d5cc8f9b9e4770693e6533978ced56113`. The installed application and package manifest remained unchanged; AppRun was not invoked. The guest shut down afterward.

The [before](before-matrix-hashes.log) and [after](after-matrix-hashes.log) hashes confirm the six public files and manifest stayed unchanged during qualification. [The archive check](public-archive-checks.json) records zero secret matches or unsafe paths in both public archives, and zero sensitive paths among 2,033 AppImage inventory files.

## Cleanup and evidence handling

[Cleanup](cleanup.json) confirms that the B builder, native test container, A builder and original cache container were stopped at collection time. A and original cached bytes remain preserved. The diagnostic VM shutdown receipt and stopped-state snapshot are included.

These are sanitized evidence copies, with no application binary, source archive or credentials. [evidence-files.json](evidence-files.json) maps each original hash to its retained hash. Embedded receipt hashes identify the private originals; sanitized copies can differ. User home paths and private IPv4 addresses are replaced where present. Public signatures and the enrolled public key are intentionally retained. [sanitization-audit.json](sanitization-audit.json) records the checks performed on these copies; archive scanning is separately reported above.

## Limits

This evidence establishes B package qualification only. **No B publication, public readiness or A-to-B acceptance is established here.** It does not establish a pristine B installation, installed GUI behavior, playback, Mac-offline updating, Stable promotion or website deployment. Publication and device acceptance remain separate steps owned by the parent task.
