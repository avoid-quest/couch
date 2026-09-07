# TV display selection

An administrator opens Settings → Display on the existing authenticated phone interface. The native host reads X11 output connection state, current geometry and observed refresh through `xrandr --props`. Tauri moves Couch's fullscreen window and focuses it. Display selection does not set the global primary monitor, mode or rendering profile.

A preview lasts 20 seconds. Keep this screen confirms only after Tauri observes the window fullscreen on that output. The native host owns the deadline, so closing or disconnecting the phone does not keep an unconfirmed selection. Cancel and expiry restore the previous enabled output, then the laptop panel, then the first enabled output. If X11 inventory fails during the preview, expiry uses the last inventory filtered against Tauri's current monitors. A failure is reported rather than claimed as recovery.

Confirmed output identity is the full EDID plus connector name. This remains stable across enumeration, resolution changes and the disappearance of a second screen with an identical EDID. A connector name is used when EDID is unavailable. Moving a screen to another connector requires confirming it again. No enumeration index is persisted. The small `display-output` file lives in the existing application data directory and is replaced atomically only after confirmation. An unconfirmed preview is never saved.

Startup and topology changes try the saved screen. When unavailable or disabled, the host retains the saved choice and uses the laptop panel, then the first enabled output. With no saved choice, it starts on an enabled external screen when available, preserving the appliance's TV-first default. Reconnection returns to the saved output when X11 enables it. A connected but disabled output is listed honestly and cannot be selected until the desktop session enables it. Mirrored outputs must be arranged separately before a single physical target can be selected.

The Ubuntu session keeps a connected laptop panel enabled beside the external display. Its existing external 1080p preference remains; it no longer changes global primary or disables the recovery panel. The existing systemd supervision, SSH recovery and rendering environment are retained.

The qualification target is 1080p60 SDR. The displayed refresh is an observation, not a mode-setting guarantee. Resolution/refresh controls, HDR and multi-TV playback are outside this increment.

## Verification boundary

Unit checks cover inventory identity, connection/mode interpretation, fallback priority, administrator authorization, request validation and private reply correlation. TypeScript checks and frontend/sidecar build cover wiring. Native compile/tests are required before merge.

Installed acceptance remains open on #13. On an Ubuntu 24.04 X11 installation with both panel and TV enabled, verify preview, timeout with the phone disconnected, explicit cancel, confirm and app restart. Observe video/subtitles, fullscreen controls, interface scale and focus. Then coordinate a physical T480 unplug/replug and reboot without the TV, check the retained choice and recovery panel, and reconnect the TV. These journeys have not been established by source tests.

## Supported interfaces

- [Tauri 2.11.5 Monitor](https://docs.rs/tauri/latest/tauri/window/struct.Monitor.html) exposes geometry, scale and a human-readable name, but no EDID or refresh. Read-only XRandR supplies those facts on the supported X11 session.
- [X.Org xrandr manual](https://www.x.org/releases/X11R7.5/doc/man/man1/xrandr.1.html) documents connection/mode reporting, current refresh markers, output properties, and enabling/placing a panel with `--auto --left-of`.
