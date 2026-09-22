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

The native remote-target transition, Windows desktop window, and physical TV were not exercised in this session.
