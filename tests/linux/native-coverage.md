# Native coverage after the four-destination UI

`playback.ts` runs the retained helpers against the compiled Tauri app. A passing
run must reach its final receipt and exit zero. `connection-journey.ts` is a
separate configured-local run. `built-remote.ts` uses a simulated native pipe peer
and does not qualify libmpv. `diagnostics.ts` is a separate native run.

| Area | Retained execution | Retired UI assertions |
| --- | --- | --- |
| Transport and queue | Native play/pause/seek/volume, independent HTTP remotes, inline upcoming removal, native pixel checks | Queue popover and full queue rows; current Now shows upcoming occurrences |
| Pairing | First-use UI and QR, Close/Escape opener focus, separate connection/role/revocation journey | General-settings pairing card |
| Radio | Native HTTP/ICY metadata, phone track label, replacement, bounded retries and real-clock cancellation; fresh subscriber snapshots prove clock advancement | TV track label, which is intentionally absent on the native host; old Radio source page |
| Progress | Find result Resume and detail From start, native checkpoints/EOF, Now history, shared history across profile changes and restart | Library History tab and profile picker focus |
| Profiles | Paired API create/select/rename/remove, stale rename rejection, native loading/paused/playing guards, persistent history/preferences | Removed profile picker, rename draft and removal confirmation presentation |
| Music and CUE | Existing album commands, Find track Play, native relative seek/EOF/next/replacement, audio transitions and restart | Artist/album drill-down, album-card Back focus and removed Move up/down buttons. Saved-list reorder uses the existing API; current drag-handle keyboard/pointer gestures are not qualified by this journey. Browser rename/remove/load/play remain exercised |
| Video library | Find artwork/details/Play, native movie/episode playback, resume, source rescans/offline state, authenticated artwork and restart | Movies/Shows tabs, season drill-down and Back focus; metadata refresh remains checked through the catalog API |
| IPTV | Authorized coordinator import/play, generated native HLS color/clock captures, Go live, delayed/stalled segment cancellation, source replacement and cached guide persistence. `--iptv-public-sample` separately checks the Apple sample after restart. | Removed Guide source page, channel search, program dialog and channel-card logos |
| Source administration | Current Sources routes, folder picker/scan, radio import/refresh/failure, Jellyfin login/replacement/revocation and password clearing | Browse-page source-settings shortcuts |
| Authority | Native protected folder control and server authorization; connection journey handles role/revocation | Retired source-tab focus traversal, nested Library dialog and Open file button from the unmounted QueuePanel |
| Preferences | Routed Playback settings, independent browser defaults, native audio/subtitle/speed and ReplayGain capture | Saved preferences as a dialog; saved-provider per-item quality selector. Add-media overrides remain exercised |
| Diagnostics | Native report/export, ordinary-controller denial, secret/path redaction, playback continuity | General pairing codes and Advanced tab |

IPTV progression and stall recovery use captured frame clocks because live position-only
updates do not broadcast. This wall-clock fixture uses normal playback speed and
restores the previously saved speed afterward. Generated HLS fixtures prove advancing
frames and recovery timing. The optional Apple sample checks native startup with
audio/video tracks after the ordinary restart coverage.

The final evidence must list which commands actually passed. This mapping is not
a qualification receipt. Null-sink audio capture and Xvfb pixels do not qualify
physical T480 audio, display, Wi-Fi, or an installed package.
