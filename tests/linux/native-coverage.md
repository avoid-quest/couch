# Native qualification coverage

`smoke.ts` is the routine desktop-process proof. It starts the compiled
Tauri/libmpv app, pairs one controller, plays generated local media once,
captures actual X11 pixels, restarts, and records the exact running revision.
It is intentionally short. This ledger accounts for every area removed from the
former `playback.ts` journey without inventing a new runner.

| Removed broad check | Current owner |
| --- | --- |
| First-use mode, sharing, QR presentation, focus restoration and theme | `configured-fixture.test.ts`, `PairingDialog.test.tsx`, `ConnectionsSettings.test.tsx`, `session.test.tsx` and `connection-journey.ts` |
| Two-controller transport, queue editing, play/pause/seek/volume, attribution, reconnect, EOF and source errors | `hub.test.ts`, `session*.test.ts`, `PlaybackControls.test.tsx`, `QueuePanel*.test.tsx`, `built-remote.ts` and locked `tauri-plugin-video` Cargo tests |
| Browser routes, deep-link refresh, phone controls, stale controls and service worker | `routes.test.tsx`, `connection-lifetime.test.tsx`, `NowPage.test.tsx`, `built-remote.ts` |
| Native video overlay, fullscreen, portal layering and real pixels | `smoke.ts` owns the one routine real-pixel assertion; component tests own layout and controls. A regression that needs more real pixels belongs in a narrow native command, not the smoke. |
| GTK/libmpv render-thread responsiveness | Issue #421 remains a separate telemetry measurement with repeated seek, Stop, replacement and diagnostics. The smoke's pixel capture does not close that investigation. |
| Tracks, subtitles, chapters, speed, audio/subtitle delay and playback defaults | `playback-languages.test.ts`, `preferences.test.ts`, `subtitles.test.ts`, `subtitle-lifecycle.test.ts`, `PlaybackControls.test.tsx` and locked `tauri-plugin-video` Cargo tests |
| Local folders, scans, library search, progress/history, music, CUE, video metadata and profiles | `folder-settings.test.ts`, `library*.test.ts`, `progress.test.ts`, `music-metadata.test.ts`, `cue.test.ts`, `video-metadata.test.ts`, `profiles.test.ts` and their client panels |
| Radio metadata, favorites, retries, shutdown cancellation and settings | `radio*.test.ts`, `RadioSettings.test.tsx`, `AvoidRadioHome.test.tsx` |
| Jellyfin authentication, credentials, subtitles, resume, disconnect and retained settings | `jellyfin*.test.ts`, `jellyfin-settings.test.ts`, `SettingsSources.test.tsx`; `--jellyfin` remains focused integration evidence |
| Web extraction, DASH quality, provider favorites and source privacy | `yt-dlp.test.ts`, `web-media.test.ts`, `provider-play.test.ts`, `providers/*.test.ts`, `video-quality.test.ts`; `--providers` and `--provider-catalogs` remain opt-in external evidence |
| Generated IPTV import, live clocks, stalls, source replacement and cache restart | `iptv.test.ts`, `iptv-clock.test.ts`, `iptv-native-clock.test.ts`, `iptv-start.test.ts`; `--iptv-public-sample` runs the focused `iptv-public.ts` source/restart/Apple evidence |
| Source administration, authority, claims and connection recovery | `authorization.test.ts`, `controllers*.test.ts`, `folder-settings.test.ts`, `connection-lifetime.test.tsx`, `connection-journey.ts` |
| Diagnostics, redaction and playback continuity during collection | `diagnostics*.test.ts`, `diagnostics.ts` |
| ReplayGain routing and audio capture | `replaygain*.test.ts`, `replaygain-audio.test.ts`; a future audio-only device question needs its own narrow native check |
| Debian installation, signed package bytes, upgrade, retained release state and remote updater | `hosted-qualify.sh`, `hosted-desktop.sh`, `package.yml`, `deb-update-native.test.ts`, `apt-package-status.test.ts`, `updates.test.ts` and issue #424's independent qualification |

External providers, public IPTV, real devices, physical audio, HDMI, Wi-Fi and
the Debian installed-update path are outside the ordinary smoke. Xvfb pixels
prove that the native process rendered generated local media. They do not prove
a physical display or speaker.
