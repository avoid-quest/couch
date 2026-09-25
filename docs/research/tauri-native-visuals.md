# Native desktop visuals in Tauri v2

Checked 25–26 September 2026 against Tauri's official v2 docs and the versions in this repository. This note records the selected implementation and its source.

## Couch baseline

- `src-tauri/tauri.conf.json` defines one decorated, transparent, black-backed window, with no explicit `theme` or `titleBarStyle`; `app.macOSPrivateApi` is enabled. At runtime, `src-tauri/src/lib.rs` makes the window opaque on Windows and Linux so the transparent video WebView has a solid backing. Couch's CSS sets `color-scheme: dark`, and `docs/design.md` requires black ground, white ink, flat surfaces, and no blur.
- `src-tauri/src/desktop_lifecycle.rs` already installs a macOS default native application menu and a macOS/Windows tray menu. `src-tauri/src/lib.rs` already installs the window-state plugin with a custom state file. These are foundations to refine, not features to add from scratch.
- `src-tauri/Cargo.toml` pins Tauri `=2.11.5`; `src-tauri/Cargo.lock` has `tauri-utils 2.9.3`. Tauri's [release listing](https://v2.tauri.app/release/) and [2.11.5 effect enum](https://docs.rs/tauri/2.11.5/tauri/window/enum.Effect.html) are the compatibility baseline for implementation.

## Options, in priority order

### 1. Match native chrome to Couch's dark appearance (small)

Set the main window's initial `theme` to `"Dark"`, using a platform config if this should affect only macOS and Windows. Tauri otherwise follows the system theme, while Couch's content is always dark; on a light desktop, that can leave the native title bar and content visually disconnected. `backgroundColor: "#000000"` is already aligned. [Window theme config](https://v2.tauri.app/reference/config/#windowconfig), [platform-specific config merging](https://v2.tauri.app/reference/config/#platform-specific-configuration).

Keep native decorations and controls. Tauri's `theme` is implemented on Windows and macOS 10.14+; a later light theme setting could use `setTheme(null)` to return to system appearance, but on macOS that changes the app-wide theme. [Window theme API](https://v2.tauri.app/reference/javascript/api/namespacewindow/#settheme), [window customization guide](https://v2.tauri.app/learn/window-customization/).

On Windows, `scrollBarStyle: "fluentOverlay"` is another small first-class polish option. It requires WebView2 Runtime 125.0.2535.41 or newer and is ignored on older runtimes; all WebViews sharing a data directory must use the same setting. [Tauri scrollbar config](https://v2.tauri.app/reference/config/#windowconfig), [Tauri scrollbar API](https://v2.tauri.app/reference/javascript/api/namespacewindow/#scrollbarstyle).

### 2. Integrate the macOS title bar with the black window (small/medium)

Try macOS `titleBarStyle: "Transparent"` with `decorations: true` and the black window background. Tauri says this retains the native traffic lights and avoids the custom drag-region and title-bar-height problems of `"Overlay"`. The current title remains visible; `hiddenTitle` is a separate macOS option if the title is redundant with on-page navigation. Verify the appearance on macOS 14 and 26, active and inactive, including fullscreen and native video. [Title-bar styles](https://v2.tauri.app/reference/config/#titlebarstyle), [window fields](https://v2.tauri.app/reference/config/#windowconfig), [Tauri guide's native-titlebar alternative](https://v2.tauri.app/learn/window-customization/#macos-transparent-titlebar-with-custom-window-background-color).

`"Overlay"` is a larger design change: content reaches under the chrome and needs a deliberate top inset and drag region. Tauri documents variable title-bar height and inactive-window drag limitations, so use it only if an actual toolbar must live in that space. Do not remove decorations just to mimic a title bar; Tauri warns that a custom title bar loses native macOS window moving/alignment behavior. [Tauri config](https://v2.tauri.app/reference/config/#titlebarstyle), [window customization](https://v2.tauri.app/learn/window-customization/#creating-a-custom-titlebar).

### 3. Make existing native menu and tray feel intentional (small/medium)

Extend the existing macOS default menu with Couch actions that genuinely belong there (for example Open, Show Couch, playback, or Settings), keeping Tauri's predefined native Edit/Window/About behaviors. Tauri's menu API supports native menu items, shortcuts, check items and context menus. On Windows, use a native context or window menu only where it improves discoverability; a permanent menu bar would consume space above Couch's content. [Window menu guide](https://v2.tauri.app/learn/window-menu/), [menu API and platform split](https://v2.tauri.app/reference/javascript/api/namespacemenu/).

Use a dedicated monochrome macOS menu-bar asset and `TrayIconBuilder::icon_as_template(true)`, rather than reusing the full-color/default app icon as the tray icon. Tauri exposes this as a macOS-only first-class option; Windows can retain a purpose-designed small tray glyph. [Tray icon builder](https://docs.rs/tauri/2.11.5/tauri/tray/struct.TrayIconBuilder.html#method.icon_as_template), [Tauri tray guide](https://v2.tauri.app/learn/system-tray/).

### 4. Test OS materials as a deliberate alternative (medium, design approval)

The released Tauri effect enum supports semantic macOS materials such as `sidebar`, `headerView` and `underWindowBackground`, plus Windows 11 `mica`/`tabbed` and Windows 10/11 `acrylic`. `windowEffects` requires a transparent window. Couch's macOS window is transparent, but its Windows runtime deliberately makes the window opaque for video composition; Mica therefore needs more than a config change. Use a limited prototype, checking text contrast and video composition. The material affects the window, so a broad effect would conflict with Couch's documented flat, blur-free black design. [Released effect enum](https://docs.rs/tauri/2.11.5/tauri/window/enum.Effect.html), [window effects config](https://v2.tauri.app/reference/config/#windoweffectsconfig), [platform config](https://v2.tauri.app/reference/config/#platform-specific-configuration).

The docs call out poor drag/resize performance for Acrylic on Windows 10 v1903+ and some Windows 11 builds, and Blur on Windows 11 build 22621. Prefer Mica for a Windows 11 experiment. `windowEffects` is unsupported on Linux. [Effect variants and cautions](https://docs.rs/tauri/2.11.5/tauri/window/enum.Effect.html), [Tauri window API](https://docs.rs/tauri/2.11.5/tauri/window/struct.Window.html#method.set_effects).

### 5. Liquid Glass through Tauri's window-vibrancy crate (selected)

The live [configuration reference](https://v2.tauri.app/reference/config/#windoweffect) lists `liquidGlassRegular`/`liquidGlassClear` for macOS 26+, but Couch's pinned [Tauri 2.11.5 effect enum](https://docs.rs/tauri/2.11.5/tauri/window/enum.Effect.html) lacks those variants. The [official release list](https://v2.tauri.app/release/) still shows 2.11.5 as the published core version, so updating Couch's Tauri pins would not supply the documented core API.

The Tauri organization has since published [window-vibrancy 0.8.1](https://github.com/tauri-apps/window-vibrancy/releases/tag/window-vibrancy-v0.8.1), whose [Liquid Glass API and Tauri example](https://github.com/tauri-apps/window-vibrancy#macos-liquid-glass-effect-macos-26) support macOS 26+. Couch adds this macOS-only dependency and embeds the WebView in the glass view, following the [upstream example](https://github.com/tauri-apps/window-vibrancy/blob/window-vibrancy-v0.8.1/examples/tauri/src-tauri/src/main.rs). The native player inserts its video view beneath the WebView's current parent, so moving both into the glass container retains their ordering. That last point is an integration inference from [Couch's renderer](../../src-tauri/vendor/tauri-plugin-video/src/desktop/macos.m) and needs playback qualification.

This is a deliberate exception to Couch's [flat, blur-free design](../design.md), requested for Mac native chrome. A single dark tint covers the desktop shell, including first-run screens, so the header and page have no abrupt glass-to-black seam. The player still clears its video region. The effect is skipped on macOS 14–15, which Couch still supports.

## Implementation notes

- `transparent: true` on macOS requires Tauri's `macos-private-api` feature and prevents Mac App Store acceptance; Tauri says `windowEffects` can provide translucent backgrounds through public APIs. Do not remove the current flag without verifying Couch's native video composition and startup behavior. [Tauri window transparency config](https://v2.tauri.app/reference/config/#windowconfig).
- On Windows, `noRedirectionBitmap` can reduce a white flash before a transparent webview paints. It is relevant only if Couch later uses a transparent Windows window and a flash is observed. [Tauri window config](https://v2.tauri.app/reference/config/#windowconfig).
- Tauri's window-state plugin already handles size/position restoration in Couch. Its official guide suggests creating the window hidden to avoid restore-time flash; check current creation flow before proposing another plugin or state store. [Window State plugin](https://v2.tauri.app/plugin/window-state/).

**Selected first pass:** dark native theme, Windows Fluent overlay scrollbars, macOS Transparent title bar, and macOS 26 Liquid Glass beneath one dark desktop surface. Native menu changes and Windows Mica are separate options. Verify Mac playback after the WebView reparenting and check the window on macOS 14 as well as 26.
