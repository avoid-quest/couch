# Signed AppImage updates

Couch uses Tauri updater 2.11 for AppImage checks and verified downloads. The native host selects this path only when Tauri reports a running AppImage. Application updates require the installed AppImage path; Ubuntu session and dependencies are managed separately by the appliance installer.

The administrator phone uses the existing Updates routes. Stable/Preview and Manual/Auto when idle remain separately persisted. Startup, 15-minute and explicit checks continue. Downloads expose byte progress and leave playback running. Installation uses a stopped-writer backup and systemd restart; saved idle preferences are retained. Source tests alone do not qualify installed updates.

The installer enrolls a root-owned, non-symlink `/etc/couch/appimage-update.json`, not writable by group or others:

```json
{"endpoint":"http://publisher:8765/tauri/","pubkey":"BASE64_TAURI_PUBLIC_KEY"}
```

HTTP is supported for the explicitly enrolled LAN endpoint. TLS certificate verification remains enabled for HTTPS. Neither browser requests nor feeds can replace trust. The native private pipe accepts only fixed channel checks, exact-current repair, staging, installation, status and checkpoint acknowledgements. No updater permission is granted to browser Tauri IPC.

Each `stable.json`, `preview.json` and retained `releases/RUN.ATTEMPT/release.json` is standard Tauri static JSON with top-level `releaseId`, `revision`, `dataFormat`, `bytes` and `expiresAt` in Unix milliseconds. Its adjacent `.json.sig` is produced by the same official Tauri signer as the AppImage. The initial metadata fetch is limited to 64 KiB and its signature to 4 KiB; validity is limited to seven days and archives to 2 GiB. The native verifier authenticates metadata first, then requires Tauri's returned raw JSON to match it before accepting a candidate. This preserves signed identity and expiry even on the LAN HTTP feed.

Documented upstream exception: updater 2.11 checks the endpoint again and buffers that second JSON response without a size cap. Its request has a 30-second timeout, but an oversized response can exhaust memory before equality verification. The supported plugin API offers neither a response-body cap nor a check-from-verified-JSON method. Couch retains the official plugin without adding a fork or proxy. Track this resource-risk limitation in #174 and revisit when Tauri exposes either supported API. Signature, metadata equality and identity checks remain mandatory.

Tauri verifies downloaded archive bytes. Couch syncs those bytes to `COUCH_DATA_DIR/updates/appimage/candidate.AppImage` through a temporary file and rename. Checks after restart verify retained bytes again with the enrolled key and current signed metadata. A partial file never becomes ready. Renewing metadata for the same version, revision and archive signature preserves the candidate ID. Changing or corrupting bytes clears readiness. The plugin receives the archive download, not a separate Couch acquisition engine.

Versions retain `0.1.0+build.RUN.ATTEMPT`. Rust semver's total ordering compares numeric build components, covered by tests of 9/10 and attempts 2/10. Exact repair requires both the current full version and the native compiled revision and reads the retained release URL derived from that version. Missing or expired current metadata is a failure. The administrator repair route reinstalls the verified exact-current archive and preserves a newer staged candidate.

Tauri's `install(bytes)` does not reverify persisted bytes. Couch repeats verification before replacement, checks backup/replacement storage, retains a consistent stopped-writer backup and known-good archive, leaves restart to systemd and verifies the resulting native/server/frontend build and bundled tools. Package and installed-device journeys remain separate from source tests.

Official references: [Tauri updater](https://v2.tauri.app/plugin/updater/), [updater source](https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/updater).

## Backup boundary and WebKit exception

Couch checkpoints its authoritative application SQLite database and stops its Bun producers before copying data. Tauri's Linux WebKit profile can share that directory. Its auxiliary browser files are copied only as best-effort material: that copy is **not guaranteed consistent or crash-consistent**. Installation leaves the current profile in place, and operator recovery does not automatically restore the database or browser profile from this copy.

The supported `WebviewWindow::destroy()` closes a window, but does not provide complete persistent-profile teardown while retaining the updater host. The [pinned Tauri runtime](https://github.com/tauri-apps/tauri/blob/tauri-v2.11.5/crates/tauri-runtime-wry/src/lib.rs) deliberately retains Linux WebContext for the application's lifetime because WebKitNetworkProcess survives closed WebViews; see [upstream issue 14626](https://github.com/tauri-apps/tauri/issues/14626). Closing only the window therefore would not establish a stopped-writer profile snapshot.

This is the accepted documented exception where no supported replacement exists. External owner: Tauri/WebKit maintainers. Resume condition: a supported flush or full persistent-profile teardown API that keeps the updater host alive becomes available; qualify it against actual profile writes before strengthening the backup claim. Couch retains its consistent application database backup and current untouched browser profile without adding a runtime fork or snapshot framework.
