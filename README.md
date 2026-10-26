# Player modes evidence at the owner-requested pause

Preservation only. This recovery snapshot is independent of the four implementation branches and must stay outside their PR diffs. It does not claim completion, passing final checks or physical qualification.

Implementation checkpoint: `61a73b450e23522ca29ce236eeec5c59408f724e` on `player-modes/validation-20261026`. Its `docs/player-modes-pause-20261026.md` names the exact stack heads, unfinished test failure, physical comparison and resume conditions.

The archive contains 421 selected files (657,398,441 bytes before compression): new known-stimulus physical recordings including failing/confounded intervals, results and metadata, gain readings, diagnostic source/controllers, the un-deployed Core ingress overlay and its offline checks, current focused check receipts, and older-work assessment/implementation receipts. Every archived member was decompressed and verified against its SHA-256 before this snapshot. Original local data and original recovery refs remain intact.

`manifest.json` lists source paths, sizes, SHA-256 values and omissions. `parts.json` identifies the ordered gzip-stream pieces. `verification.json` records the completed archive verification. Reproducible downloaded installers, browser/toolchain caches, local profiles, credentials, installed software, duplicate stimulus copies, bundled tests and older broad-check logs are omitted; they remain local or have their earlier recovery references. This is a selected evidence backup, not a whole-machine backup. The token-shaped literal in `sdk-comparison/verify.ts` was inspected and is a static fake receiver identity used only in an offline admission fixture.

## Restore into a new empty directory

Fetch `recovery/player-modes-pause-20261026` into an existing clone, export that recovery tree to a new owned directory, and verify each part against `parts.json`. Concatenate `evidence.tar.gz.part000` through `evidence.tar.gz.part007` in that order, decompress the combined gzip stream, then extract it into a different new directory. Verify restored files against the embedded manifest before use. The archive paths are relative and contain no profiles or credential files.

The un-deployed ingress overlay is diagnostic scratch. Its input hash is pinned; its patcher only accepts the recorded worker bytes. Do not deploy it merely because its offline checks pass. The ordinary-browser Mac Chromium/native HOST comparison has not run. Testing and acquisition remain paused until the owner resumes them. No PR, merge or release is authorized by this backup.
