# Linux desktop Close and reopen check for #480

`bun run test:linux --desktop-smoke` builds the committed Tauri app and runs the
existing native video check, then `tests/linux/desktop-lifecycle.ts` in an Xvfb,
Openbox and D-Bus session. Each journey uses a separate app data directory. The
test writes its source revision and passed checks to
`.artifacts/linux/desktop-lifecycle.json`.

| Journey | Native check |
| --- | --- |
| No tray watcher | Close minimizes the desktop window while its owned host stays alive. A second launcher invocation restores that window without a second app or host process. Reopen also recovers an offscreen window. |
| Quit | Ctrl+Q shows the sharing interruption prompt. Cancel preserves the host; Confirm stops the app and owned host. |
| Unavailable selected host | The trusted window shows Retry and Use this computer. Close and launcher reopen restore the recovery controls without starting a local playback host. |
| TV presentation | The native window remains fullscreen, keeps labelled navigation, and Close exits as before. |
| Usable tray | A standalone StatusNotifier watcher exposes Couch's tray item and labelled Show Couch and Quit Couch actions. Close hides the window, Show Couch restores it, and Quit follows the same Cancel and Confirm path. |

The tray journey uses the test container's AppIndicator backend. This is a
source-built, software-rendered native check; it does not qualify an installed
Debian package, a particular physical panel's tray, display hardware, or audio
hardware.
