# Desktop window lifetime check for #464

## macOS native check

Built and ran a debug `.app` on macOS with a separate bundle identifier (`quest.avoid.couch.qualification464`), `COUCH_DATA_DIR=/tmp/couch-464-qualification/data`, and local port 49164. This kept the check away from the installed app's settings and pairing. The selected remote target used a second, separately started production `couch-server` on port 49165.

| Journey | Observation |
| --- | --- |
| First launch | Chose This computer and Keep private. The decorated desktop window opened with the local client ([capture](local.png)). |
| Resize and restart | Tauri wrote the main window's size and position to the isolated `window-state.json`; the next launch restored them. |
| Minimize, Close, reopen | Minimize kept the app and owned server alive. Close hid the window without exiting; reopening Couch from the Dock restored the selected view in the same process. The app menu also offered Show Couch. |
| Second launch | Starting the same app executable again exited the second process and focused the first. One app process, one owned server, and one listener remained. |
| Quit with sharing | After enabling remote control, both Quit Couch and Cmd+Q opened the native confirmation sheet naming sharing ([capture](quit-sharing.png)). Cancel kept the app, server, and listener. Confirm stopped the app and its owned server; the listener disappeared. |
| Client-only remote | Selected `http://127.0.0.1:49165` through the native desktop picker. The host-served window displayed the target's unpaired client ([capture](remote.png)). Close hid both the remote and trusted windows; Dock reopen returned to the remote view. Quit left the separately started host running. |
| Target unavailable | After stopping that host, relaunch kept its saved address and opened the trusted recovery window with Retry and Use this computer ([capture](offline-recovery.png)). |
| Saved display unavailable | With the app stopped, changed only its isolated saved position to `(10000, 10000)` and size to `4200 × 2400`. Relaunch recovered a visible, usable trusted window ([capture](offscreen-recovered.png)). This simulates stale display coordinates; it does not test a physical monitor disconnect. |

The Mac host reported `player: unavailable`, so the playback interruption prompt could not be exercised with native playback. No audio trial was run. The sharing prompt exercises the same Quit decision path. This is a source-built debug app check, not an installed or signed release check.

## Automated and Linux checks

The focused client test, TypeScript check, production frontend build, full Bun source check, and locked macOS Rust library tests (40 passed) passed during implementation. The PR records the exact committed-revision Linux result.

Windows desktop window behavior, physical Linux TV hardware, and installed-release behavior remain unqualified.
