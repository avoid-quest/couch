# TV display selection

In TV presentation (`COUCH_TV_PRESENTATION=1`) the app window is frameless and
fullscreen, and it returns to fullscreen if anything takes it out.

An administrator opens Settings → TV on a paired phone. Core forwards the
request to the app's main process, which lists screens with Electron's
[`screen`](https://www.electronjs.org/docs/latest/api/screen) API (name, pixel
size, position and refresh) and moves the fullscreen window.

A preview lasts 20 seconds. **Keep** saves the screen's id in the
`display-output` file; **Revert** and expiry return to the previous screen. The
main process owns the deadline, so a phone that disconnects cannot keep an
unconfirmed choice.

At startup and whenever a screen is added or removed, the window goes to the
saved screen, else the first external screen, else the primary one. Ids saved by
the Tauri app (EDID plus connector) do not match Electron's ids, so an old choice
falls back to the first external screen until it is confirmed again.

The Debian TV session uses one active screen: the first connected external output
at 1080p (or its preferred mode), primary at 0,0, with the laptop panel off. Without
a usable external output, it enables the laptop panel instead. It reapplies this
layout when the connected-output inventory changes, including disconnect and
reconnect (`packaging/tv/usr/lib/couch-appliance/session`). Resolution and refresh
stay with the desktop session. This controls placement; it does not certify
physical scanout tearing or cable hotplug behavior on a particular device.
