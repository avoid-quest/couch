# Signed AppImage updates

The running AppImage uses Tauri's official updater through its existing private native-sidecar pipe. The authenticated administrator phone retains Stable/Preview, Manual/Auto when idle, Check now, verified download, install and exact-current bundled-tool repair. Phones cannot supply URLs, paths, keys, packages or commands.

Trust comes from root-owned `/etc/couch/appimage-update.json`. Signed adjacent JSON binds the release identity, size, data format and seven-day expiry. Tauri verifies downloads; saved candidate bytes are independently reverified with the same enrolled key before installation. A fresh check is required after restart. Missing exact-current repair archives fail truthfully, and repair preserves a newer staged download.

The administrator API remains `/api/updates`, `/channel`, `/policy`, `/check`, `/stage`, `/install` and `/repair`. Downloads report byte progress. Installation reports durable phases and request-specific results across reconnects. Channel and policy remain in `updates/settings.json`. Auto when idle requires five continuous idle minutes and checks again immediately before closing admission; paused playback, reconnect, scans, recording work and new remote input defer it. Manual installation requires explicit interruption confirmation when playback is active.

Before replacement, the sidecar closes admission, saves progress, stops producers and closes SQLite. A nonce-correlated acknowledgement permits the native owner to save the current AppImage and consistent data under `/var/lib/couch/application/backups/REQUEST_ID`. The official plugin installs the verified bytes; Couch exits gracefully and systemd alone restarts it. No automatic database restoration or autoplay occurs.

Success requires matching running native/server/frontend builds, database integrity and fresh bundled-helper hash/version/smoke checks. Optional Ubuntu runtime repair uses only the separately installed fixed systemd service, followed by runtime smoke. A failed startup or interrupted installation requires the [operator SSH recovery procedure](update-worker.md); replacement alone is never reported as success.

Source tests: `bun test src/server/appimage-checkpoint.test.ts src/server/appimage-update-native.test.ts src/server/manual-update.test.ts src/server/updates.test.ts src/server/update-idle.test.ts src/server/readiness-native.test.ts`, plus native `appimage_update` tests. These do not establish installed systemd or physical acceptance; those require the exact qualified AppImage and retained phone journeys.

See the [official Tauri updater API](https://v2.tauri.app/plugin/updater/). The documented upstream check-response size limitation remains in [AppImage update notes](appimage-updates.md).
