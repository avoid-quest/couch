# Windows desktop lifecycle check for #481

The source check passed `cargo xwin check`, `cargo xwin build`, and `cargo xwin test --lib --no-run` for `x86_64-pc-windows-msvc` with the locked Cargo graph. The cross-build uses an empty, ignored sidecar placeholder because Tauri's build script requires a target-named file. That artifact is not an installable Couch package and says nothing about WebView2, tray behavior, or host shutdown on Windows. The Linux desktop smoke covers native Close, second launch, Quit/Cancel, and offline selected-host recovery in the one-window design. Tray and dialog interactions on Windows require the installed checks below.

## Installed Windows checks

Run these on an installed Windows 11 25H2 x86_64 build with a real bundled coordinator. Record the package identity, WebView2 version, process IDs, listening ports, and results. Keep a separate reachable Couch host for Client-only checks.

| Journey | Required observation |
| --- | --- |
| Close and reopen | Close the one `main` window in Local and Client-only mode, including Alt+F4. It leaves the taskbar, Couch stays in the tray, playback or remote control continues, and the tray's Show Couch command restores the same selected mode and bundled recovery controls. Minimize keeps the window reachable from the taskbar. |
| Second launch | Launch the same installed app while it is hidden, including with an offline selected host. The same window and saved mode reopen. One app process and no duplicate owned coordinator or listener remain. |
| Local Quit | With local playback active and then with sharing enabled, use the tray's Quit Couch command. Cancel preserves work. Confirm stops the owned coordinator, native player and listener, and retains saved state on relaunch. Repeat idle, when no prompt is needed. |
| Client-only Quit | Select the separate host, then Quit Couch. The selected host and its playback keep running. This installation exits its own maintenance coordinator; no local player or duplicate local host starts. |
| Disconnected recovery | Stop the selected host while Client-only is selected. Close and reopen from the tray and second launch. The saved address and bundled Retry/Use this computer controls remain usable; reconnecting restores the selected host session without a local switch. |

Compilation and Mac tests cannot close these target-only checks. Installed Windows Client-only and updater qualification belongs to #492; this ticket does not publish a release.
