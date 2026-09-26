# Native titles, media and quiet feedback

Validated 26 September 2026 above the Clock consistency pass. The original [15-screen browser matrix and native player captures](../consistency/README.md) remain in the preceding layer.

## Verification

- `bun run typecheck` passed; `bun run test:core`: **1,508 passed, 10 skipped, 0 failed**. New tests cover native metadata and transport, stale commands/host switches, richer title changes, own host/remote activity suppression, retained Undo and bottom-right placement. Existing clock-isolation tests still pass.
- `cargo check` passed on Apple Silicon with the two existing unused-code warnings. `bun scripts/desktop.ts build --debug --bundles app` produced the native app with the compiled frontend, coordinator and libmpv integration.
- Launched the built app through macOS Launch Services with `COUCH_PORT=4178`, `COUCH_DATA_DIR=/tmp/couch-polish-native`, `COUCH_LAN_INTERFACE=en0`. A second native build used a temporary external configuration with identifier `quest.avoid.couch.validation-host`, port 4179 and `/tmp/couch-polish-host`. Paired the review app to this real player, resumed its generated H.264 fixture remotely, and confirmed the host actually played and paused. No simulated player was used.
- Verified local NTS radio, its programme title and artwork, remote video, session switching and clearing the retired item. Read Apple's public `MPNowPlayingInfoCenter` inside the running review app using LLDB and immediately detached: remote video was Playing with a 120-second duration; switching to idle local playback cleared metadata and set Stopped; local radio was Playing with live status and native artwork. [Observed fields](now-playing.txt).
- The user supplied the macOS Now Playing radio screenshot below, confirming real programme artwork. Their paused-video capture exposed a generic system placeholder when a file had no cover; that case received a separate fallback fix and native regression checks. The radio screenshot is included unchanged; the broader Control Center screenshot is omitted because it contains unrelated system information. Cua could read the rebuilt app's Control Center accessibility state, including title, artwork, Play and timeline, but could not reliably capture that system panel.
- Rebuilt the fallback fix as a separate **Couch Media Review** app with a temporary external bundle configuration and the same isolated data/port. Played and paused the exact same coverless H.264 fixture. Public Now Playing metadata now includes `MPMediaItemArtwork`, with the correct paused state, 120-second duration and 5.08-second position. [Published fallback image](published-fallback-artwork.png) was extracted from the production Apple adapter's public artwork object by the native regression harness; it is an API artifact, not a Control Center screenshot.
- The user then inspected that rebuilt app's actual Now Playing tile and confirmed **“Couch icon is visible.”** The native regression script passes all nine assertions, including an exact bitmap comparison with the existing Couch icon. Final native build and `cargo check` passed after this fix.
- The rich native title updates immediately on session/item/name changes, remains on pause and clears the item after stopping. Checked centered title and native controls at 1280px and about 800px window width, including a deliberately long test instance name. Fixed a discovered asynchronous title update race before these final captures. Restored the short test name and stopped test playback.
- Windows adapter and decoder test: API-checked against `windows` 0.61.3 for `x86_64-pc-windows-msvc` with thin Tauri shims. Linux adapter: four tests ran against real `mpris-server` before adding native GdkPixbuf decoding; all five final tests compile against the real APIs, but the decoder test could not run on this Mac. **No Windows or Linux desktop runtime was available**, so these are not full platform app/runtime validations. Title alignment remains OS-managed on those platforms.
- No verify, Docker, act or e2e suite ran. Official/community evaluation and platform boundaries are in [native-media.md](../../native-media.md).

## Screenshots

| Case | Capture |
| --- | --- |
| Local radio, rich centered title | [Native app](macos-local-title.png) |
| Remote video, rich centered title | [Native app](macos-remote-title.png) |
| Other device's activity, bottom-right toast | [Native app](macos-other-remote-toast.png) |
| Narrow native window | [About 800px](macos-title-800px.png) |
| Long instance name in narrow window | [About 800px](macos-long-title-800px.png) |
| Real macOS Now Playing | [User-supplied system capture](macos-now-playing-radio.png) |
| Same coverless video after rebuilding | [Native app](macos-coverless-video.png) |
| Native published artwork fallback | [Public API image](published-fallback-artwork.png) |

The toast capture is an action from the other native host. Clicking Play/Queue/Save and changing settings on the current remote stays quiet. Errors, diagnostic results, unexpected outcomes and removal/Stop Undo remain available.
