# Actions preparation for native Debian work

The owner requested removal of every unexpired GitHub Actions artifact and local workflow checks before a fresh Preview release. This record covers cleanup and the existing AppImage workflow baseline. The native Debian workflow must run its own act checks after its changes land.

## Artifact cleanup

[The receipt](artifact-cleanup.json) records 107 successful deletions totaling 14,985,935,405 bytes, about 13.96 GiB. The paginated GitHub API reported zero unexpired artifacts at 2026-09-15T11:15:12Z. No active workflow run existed when deletion started. Actions caches, GitHub releases, CrabNebula assets and local qualified files were untouched. GitHub's billing/quota recalculation may lag the artifact inventory; zero artifacts does not establish that a new upload will succeed immediately.

## Local checks

[The results](act-results.json) record successful syntax validation, all 11 mocked act scenarios and all 19 exact-shell fixtures. Tested workflow SHA-256 is `1aa9875113d637366e960aa4777e468d6ed1d08bab808bef6865936e3badfa91`. The tracked file still matched that hash after the run. Scenario execution took 23.202 seconds in total.

The checks cover default inputs, Preview publication flow, qualified Stable promotion, unqualified retry, readiness only, rejection of fresh Stable/readiness-only builds, branch/release gates, builder failure and qualification failure. Qualified reuse skips the builder and tests. Both failure cases prevent downstream publication.

The existing builder-cache harness matches step names, avoiding the older harness's obsolete numeric step positions. It preserves workflow dependencies, conditions and input defaults. It replaces remote actions and provider/build commands with inert markers. Actual input assertions and the jq receipt predicate run with inert git. Exact-shell fixtures use temporary files and inert docker/git commands. No privileged installer fixture ran on the Mac.

The official retained act 0.2.89 archive passed its recorded checksum; its binary matched the archive entry. Bun 1.4.2 ran by absolute path without changing the global default. Docker Desktop started, reused the existing native arm64 shell fixture, and all task containers were removed. It remains available for the packaging agent.

Job containers had no network, Docker socket or credentials, and used isolated homes. These checks do not establish Linux compilation, native package qualification, GitHub artifact capacity, runner availability, protected environments, artifact transport, real publication, CDN readiness or installation. [act's official limitations](https://nektosact.com/not_supported.html) include ignored permissions, environments, concurrency and timeouts.

No workflow was dispatched or release published by this preparation task.

## Private detailed receipts

The per-artifact inventory/deletion receipts remain under `/var/folders/67/zq1gjvy1637g8sn3kl3qpr180000gn/T/couch-artifact-cleanup-20260915-t6ylbe63`.

Full act commands, generated inert workflows and logs remain under `/var/folders/67/zq1gjvy1637g8sn3kl3qpr180000gn/T/couch-actions-replay-20260915-qf6cb59e`. Its README contains replay instructions. These are local temporary files, not public release assets or durable backups.
