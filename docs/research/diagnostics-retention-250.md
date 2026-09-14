# Durable diagnostic errors, issue #250

Implementation is based on remote `main` at `f60f3daea2dd9e11c2ed483ce094866ec8d0ce8c`, fetched on 14 September 2026. This extends [issue #21](https://github.com/avoid-quest/couch/issues/21) for [issue #250](https://github.com/avoid-quest/couch/issues/250). No appliance deployment or restart was performed.

The 14 September audit recorded an in-memory limit of 80 entries and a displayed audio-output error with no calendar date. Its installed build 49 observation is historical context, not an identity for this change. The audit and its local evidence were read from `/Users/devit/Code/modern-kodi/docs/research/project-status-2026-09-14.md` and that checkout's `.scratch/status-audit-2026-09-14/current-observations.json`.

## Behavior

The existing playback, controller-command, helper and source error paths now save their sanitized history in one `diagnostic_history` row in Couch's existing SQLite database. The JSON payload has both an application limit and a SQL constraint of 64 KiB. At most 80 entries survive, with the oldest removed first. These limits apply to the diagnostic payload, not the database's unrelated data, SQLite pages or shared WAL.

Each entry carries its first and last UTC observation, source category, count, coordinator build and session identifier. The current session's start time and identifier are also exported. Advanced displays full UTC dates, the originating version and commit, and Current session or Earlier session. Unknown build fields remain unknown. The diagnostic export format is now version 2.

Entries expire seven days after their first observation. Cleanup runs on startup, on log access, and on a timer even while Advanced is closed. Shutdown flushes pending repeat counts. Consecutive equal sanitized source/message pairs are grouped within a session, preserving first and latest observation times. When the clock moves backward, a duplicate keeps the greatest previously observed timestamp. Expiry timers are capped at the signed 32-bit timer maximum and reschedule until the timestamp expires. Repeat-count writes are coalesced for up to one second; an abrupt process exit can lose that final second of repeat metadata. The first error is written immediately. A later session creates a separate entry even when its message is identical.

The existing redactor runs before persistence and again on retained text when loading. Build fields use the existing build validator and remove supplied secrets while preserving valid commit hashes. No URLs, raw exceptions from diagnostic storage, or controller tokens are added as metadata.

Diagnostic SQL does not wait for locks. Write failures leave the error in memory, report that persistence failed, and retry on the next new error, a pending repeat flush, shutdown, or within one minute. Read/init failure leaves the stored row untouched and falls back to current-session memory until restart. The report tells the administrator when retention is unavailable. A damaged history needs local repair before restarting; the diagnostics endpoint exposes no repair or delete action.

## Local acceptance results

| Issue criterion | Result and evidence |
| --- | --- |
| Real failed operation, restart, same dated/categorized error and build in diagnostics/export | Passed against the local coordinator. A paired controller sends an unavailable-radio command over WebSocket; the real lookup rejects it. After closing and reopening the hub on the same database, both administrator HTTP endpoints retain the exact error. A second test runs two separately compiled processes with different embedded build identities and verifies that the retained error still names the first build. Installed-TV repetition remains pending. |
| Calendar date, time, timezone and session distinction | Passed in the Advanced UI test with explicit UTC dates, earlier/current session entries, originating build and repeated-observation details. Current session start time is visible. |
| Seven days, count/size cap and useful duplicates | Passed with clock-controlled expiry at the seven-day boundary, reopen after expiry, idle timer cleanup without a diagnostic request, 120 distinct errors, multibyte messages, within-session repeats and separate entries after restart. Disk payload stays within 64 KiB. |
| Redaction before storage and in export | Passed with supplied host/pairing secrets, passwords, Cookie/Authorization headers, media URLs, RTSP URLs and encoded URLs. Tests inspect both SQL payload and raw database bytes. The compiled-process export test also verifies sanitized text after restart. |
| Administrator-only, read-only access and failure recovery | Passed for guest/native-host denial, mutation denial, authorization revocation during collection, database write locks, rejected diagnostic writes, invalid stored JSON, missing storage directory and restart after repair. Native command delivery continues during a diagnostic write failure. Physical playback through a storage fault remains pending. |

Tests live in [diagnostics-log.test.ts](../../src/server/diagnostics-log.test.ts), [diagnostics.test.ts](../../src/server/diagnostics.test.ts), [hub.test.ts](../../src/server/hub.test.ts), [diagnostics-build.test.ts](../../tests/diagnostics-build.test.ts) and [AdvancedSettings.test.tsx](../../src/client/AdvancedSettings.test.tsx).

Validation used Bun 1.4.2 and the frozen lockfile:

- `bun run typecheck` passed.
- Focused diagnostics, persistence, build and UI tests passed 27 tests with 289 assertions. The focused hub tests passed three tests with 45 assertions.
- `bun test ./tests/linux/iptv-clock.test.ts` passed one test and skipped two opt-in checks.
- `bun test --path-ignore-patterns 'tests/linux/iptv-clock.test.ts'` reported 1,065 passing tests, seven skips, zero failed assertions and two unhandled errors, exiting 1 in 91.69 seconds. Both errors are the recorded Happy DOM/Radix `dispatchEvent` teardown failure around SoundSettings and MetadataEditor. [Issue #247](https://github.com/avoid-quest/couch/issues/247) owns the repair and was notified. Its task reports a separate clean final run at fix commit `b235a0f689579e6d645dc91f8db86feda00e967b`, with 1,063 passing tests, seven skips, zero failures or unhandled errors, and exit 0. Its changes are not included here.
- `bun run build` passed for the frontend and macOS arm64 Bun sidecar. No Rust or Linux AppImage qualification is claimed.

The local run logs are in `.scratch/diagnostics-250/` in this task's worktree. GitHub Actions remains paused; no hosted checks were requested.

## Review corrections

Both reviewer findings were reproduced before changing the implementation:

- [Expiry timer overflow](https://github.com/avoid-quest/couch/pull/254#discussion_r4003926790): recording 60 days ahead and then correcting the clock requested a 5,788,800,000 ms timeout. Bun emitted `TimeoutOverflowWarning` and reduced it to 1 ms. The timeout now caps at 2,147,483,647 ms and reschedules. The regression verifies the bounded initial and subsequent delay, retained data before expiry, and eventual removal.
- [Backward duplicate timestamp](https://github.com/avoid-quest/couch/pull/254#discussion_r4003926807): moving from 12:01 back to 11:00 while repeating a 12:00 error made restart reject the entire history. Duplicate coalescing now preserves the maximum `lastAt`. The regression verifies the original and latest timestamps, all retained entries, the repeat count and continued persistence after restart.

`bun test src/server/diagnostics-log.test.ts --test-name-pattern clock` failed both regressions before the fix and passed both afterward. Final focused validation passed 29 diagnostics/persistence/UI/build tests with 300 assertions and three hub tests with 45 assertions. `bun run typecheck` passed. No full Mac suite or build was repeated for these two code-line corrections; the coordinating task owns the combined integration run. GitHub Actions stays paused and the installed-TV gates below remain pending.

## Remaining installed-TV actions

Keep issue #250's real-world criteria pending until a coordinated appliance window is available:

1. Build and deliver the candidate using the existing Mac delivery path. Record the installed coordinator/native version and commit before testing. The T480 only installs and runs the build.
2. With an administrator phone connected, attempt a genuinely unavailable media item or source. Record the resulting diagnostic category, UTC date, originating build and message, then export the report.
3. Restart Couch once during the reserved window. Reopen Advanced and export again. Verify the same error, build and dates remain and the entry says Earlier session. Confirm a normal playback operation recovers with picture and sound.
4. Using an isolated test database on the installed runtime, exercise diagnostic read/write failure and verify startup and playback still work. Do not damage the household database to induce a fault.
5. Record the observed installed results on #250. No changes to parent issues #1 or #25 are part of this task.
