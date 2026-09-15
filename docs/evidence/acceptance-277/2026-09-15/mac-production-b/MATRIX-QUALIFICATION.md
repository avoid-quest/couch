# Exact-source and signed-byte qualification matrix

The following split qualification checks the same source and signed bytes. The prior A run established that amd64 Bun under Mac Rosetta changes the missing-executable error behavior, and the standard AppImage runtime cannot execute inside this Docker environment. This receipt therefore records the explicit matrix; it does not claim the unchanged `hosted-qualify.sh` passed.

| Check | Actual execution and evidence |
| --- | --- |
| Signatures | Official `hosted-release.ts verify` passed on all signed candidate assets; `verify-candidate.log` and `final-verify.log`. Independent VM Minisign also verified the full AppImage and comment. |
| Typecheck | Exact source in amd64 builder, private signing variables unset: `typecheck.log`, exit 0. |
| Bun | Native ARM64 Debian, Bun 1.4.2+744846f84, same source and lockfiles: 1249 pass, 20 skip, 0 fail; real-clock suite 3 pass, 0 fail. amd64 inventory suite 12 pass, 0 fail. Named union is 1261 main tests plus 3 clock tests; no uncovered additional named skip. |
| Native | amd64 Rust release tests: 37 library and 2 executable pass, one existing ignored test, no failures; `native-rust-tests.log`. |
| Signed manifest extraction | Actual x86_64 Debian VM standard `--appimage-extract usr/lib/Couch/release.json`: exit 0 and exact expected bytes; `diagnostic-minimal-extraction/summary.json`. |
| Installer | Fresh isolated installer fixture: all signature, target, package/FUSE, desktop/TV setup, repeated setup, recovery and contention cases passed; `installer-fixture.log`. |

The 20 ARM64 skips contain 12 named x86 inventory cases, two unnamed inventory lifecycle hooks and the same six optional live-provider tests. All 12 named x86 cases pass in the amd64 inventory run. `test-coverage-matrix.json` lists every case and optional skip; the missing-executable test passes on native Linux. No additional named tests were omitted.

The VM compared AppImage SHA256 `0148ccd715d94061cd7593156ce6823cbcfa3e4b9137b10963d497a7ebee0df5`, verified the decoded Tauri signature envelope, then extracted metadata SHA256 `3d72d55e742f3c0999648d415a56b09151ba9c95196999a3253043f1473e6a5b`. Metadata identifies version `0.1.0`, source `bb03a3a54f5ca2a1664cd6235c61cf39e4fa5a7e`, target `x86_64-unknown-linux-gnu`, packaged true. Its installed application and package state stayed unchanged; it did not launch AppRun. Summary SHA256: `dc9e7777603da6cf383b9a9d547f115d5cc8f9b9e4770693e6533978ced56113`.

This qualifies build source and candidate bytes. It is not a claim of B GUI acceptance or a pristine B installation. Existing first failures and their diagnosis remain preserved under production A evidence.
