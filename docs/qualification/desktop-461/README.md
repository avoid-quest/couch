# Desktop presentation check for #461

Built the debug macOS app with `bun run desktop:build --debug --bundles app` and opened its native window. The window used desktop chrome and the full available width. In Settings → Appearance, each client size remained legible and reachable:

| Client size | Native macOS capture |
| --- | --- |
| Default (100%) | [mac-100.png](mac-100.png) |
| Larger (115%) | [mac-115.png](mac-115.png) |
| Largest (130%) | [mac-130.png](mac-130.png) |

The 115% capture includes a keyboard focus ring. The 130% choice remained selected after quitting and relaunching the app. These captures use the local playback host; the same client setting is stored in the native app data directory for use across local and remote targets.

Started `bun run preview:linux --local-only` and inspected the 1600 × 1000 Linux X11/WebKit TV window. [linux-tv-full.png](linux-tv-full.png) shows the TV presentation and TV size controls. Tried Larger, returned to the saved size, then tried Largest, confirmed it, and reset to Default. The TV preview changed only the TV size. This is a software-rendered preview with silent audio, not a physical TV check.

The [Linux desktop video capture](linux-desktop-video.png) comes from `bun run test:linux --desktop-smoke` with TV presentation off. The same smoke test confirmed that the compiled Tauri app sent a usable video rectangle to libmpv and displayed generated media pixels inside the desktop window.


## Native Mac target transition follow-up

On macOS 26.6.2 (25G83, Apple Silicon), built the debug app with `bun run desktop:build --debug --bundles app` and a temporary Tauri config setting the bundle identifier to `quest.avoid.couch.qual461`. `COUCH_DATA_DIR` pointed to a disposable local directory. Two Bun hosts at `127.0.0.1:44161` and `127.0.0.1:44162` used separate disposable databases. The first remote pairing was Administrator; the second was Controller. The default Couch data directory and existing pairings were not used.

The first native run found two defects: the local desktop header lacked the Play on control, and a size changed in the remote webview stayed stale in the local window after returning. The unavailable Mac player also triggered a false playback-interruption warning. After the fixes, the native journey showed:

| Step | Observed native state |
| --- | --- |
| Local Settings → Appearance | Largest selected; app-owned `desktop-interface-size` contained `1.3`. The Play on control was reachable in the header. |
| Switch to target A | No playback-interruption prompt while the local player was unavailable. The remote window opened at `127.0.0.1:44161`; Appearance showed Largest. |
| Change target A to Default | The remote window showed Default; the same app-owned file contained `1`. |
| Return to This computer | The local window's still-open Appearance page showed Default without an app restart. |
| Switch to target B, then back to A | Both remote windows showed Default. Target B identified the paired device as Controller and showed Playback, Appearance, Sources and General in Settings. Target A identified it as Administrator and also showed Sound, Connections, Bluetooth, Updates and Advanced. Display and TV appearance were absent because these hosts did not select TV presentation. |
| Relaunch check | A separate run saved Larger (`1.15`) from target A; the relaunched local app showed Larger. |

All three disposable databases retained `installation_appearance.scale = 1.0`; changing this desktop client's size did not write their TV appearance setting. Focused client tests, typecheck and the Rust interruption test passed. These loopback Bun hosts reported the player as unavailable, so this check covers native window transitions, pairing, roles and client size persistence, not remote playback, TV controls, audio or physical hardware. Windows desktop and a physical TV remain untested here.

After the desktop video and focus-refresh changes landed on the PR branch, rebuilt the isolated Mac app and repeated target A → Larger → This computer. The remote window showed Larger, then the local Appearance page showed Larger after the switch.
