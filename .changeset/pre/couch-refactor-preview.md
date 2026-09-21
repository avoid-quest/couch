---
"couch": patch
---

Share one production frontend between the TV app and browser remotes. Keep provider Play and queue ownership in the Bun coordinator, with native transport in Tauri/libmpv. Improve pairing, connection replacement and query lifetime. Keep recently played actions inline and transport controls available while Now Playing is hidden.

Software qualification covers the reconciled refactor stack and exact release source. Native execution uses the actual Tauri app and libmpv in disposable Linux fixtures, including Jellyfin, playback, connection and diagnostics journeys. Publication requires the signed Debian package to pass installation, playback, desktop relaunch and data-preservation checks in a fresh disposable container.

Physical T480, hardware audio and installed native-update acceptance remain pending. Software rendering and a null audio sink do not establish hardware acceptance. No installed TV was changed.
