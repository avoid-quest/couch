# Desktop updater handoff

Issue #473 connects the existing Couch update controls, idle/work checkpoint, and
durable transaction to Tauri replacement. It does not publish new artifacts.
The supervised Linux TV AppImage and Debian broker keep their current paths.

The desktop adapter accepts these CrabNebula update targets:

| Installation | Update target | Signed bytes passed to Tauri |
| --- | --- | --- |
| User owned Linux x86_64 AppImage | `linux-x86_64-appimage` | AppImage with `usr/lib/Couch/release.json` |
| Apple Silicon Mac app from DMG | `darwin-aarch64` | Tauri `.app.tar.gz` with `Contents/Resources/release.json` |
| Per user Windows x64 NSIS | `windows-x86_64-nsis` | Tauri supported NSIS ZIP with one i686 installer stub (containing the x64 app) and a root `release.json` |

The Windows packaging ticket must put `release.json` beside the NSIS executable
inside the ZIP and sign the final ZIP bytes with the enrolled Tauri key. A
standalone signed `.exe` has no Couch manifest for the pre-install version,
target, and data-format checks, so the desktop adapter will reject it. Mac and
AppImage packaging must keep their existing embedded resource manifest. The
manifest uses `schemaVersion: 1`, `version`, a 40-character `revision`, `target`
as the Rust target triple, `dataFormat`, `readableDataFormats`, and `packaged: true`.
The signed manifest must match the feed version and the current data format must
be readable by the new release.

Couch rechecks staged bytes and that manifest before it stops data writers.
For AppImages, it reads the embedded SquashFS without executing the candidate.
Linux desktop updates continue using `updates/appimage` so a trial written by the
previous updater is verified and completed on the first relaunch into this code.
Tauri verifies the signature during download and performs replacement. On
Windows, Tauri exits when it starts NSIS, so Couch writes the trial transaction
first. After relaunch, the one bundled window and Bun coordinator must acknowledge
the same running build as the native app. In remote mode the window reaches this
installation's private maintenance coordinator even if the selected host is offline;
the health check does not probe a local player or send the local update token to
the selected host.

Each target package ticket still owns a real signed artifact, dependency closure,
installed update and recovery qualification, and its release feed. Those checks
must precede any release claim. Existing data stays in the app data directory
across a compatible reinstall; no update path resets it.
