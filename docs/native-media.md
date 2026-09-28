# Native media controls

The desktop window title is `Couch · instance · current item` with an active item, falling back to `Couch · instance` when idle. Tauri's native window title supplies OS window lists on every desktop; a public AppKit toolbar centers the same title on macOS. The selected session also owns system Now Playing, whether playback happens on this computer or another Couch. Its metadata, artwork, clock and transport capabilities use the same state as the visible player. OS commands return through the existing session actions with a session/playback identity; old commands cannot affect a newly selected Couch.

The macOS title toolbar hides in fullscreen and returns on exit. It follows AppKit's [fullscreen notifications](https://developer.apple.com/documentation/appkit/nswindow/didenterfullscreennotification), preserving Tauri's window delegate so native controls and keyboard shortcuts use the same behavior. Run `scripts/test-native-window-title-macos.sh` in a macOS desktop session when changing this lifecycle; it exercises real fullscreen transitions, title updates, window isolation, and toolbar installation while already fullscreen.

The player cursor follows its controls. On macOS, AppKit's [setHiddenUntilMouseMoves](https://developer.apple.com/documentation/appkit/nscursor/sethiddenuntilmousemoves(_:)) hides a stationary cursor that WKWebView can retain despite CSS and Tauri's parent-view cursor rectangles. Restoring controls or leaving the player explicitly restores the cursor; background windows cannot hide it. Other desktops retain Tauri's cursor API. Run `scripts/test-native-cursor-macos.sh` in a macOS desktop session when changing this behavior; it checks native visibility over WKWebView and needs foreground focus, so run it separately from other GUI tests.

| Platform | Integration |
| --- | --- |
| macOS | Apple's `MPNowPlayingInfoCenter` and `MPRemoteCommandCenter` |
| Windows | Microsoft's `SystemMediaTransportControls`, attached to the Tauri window with `ISystemMediaTransportControlsInterop::GetForWindow` |
| Linux | The `mpris-server` crate implements the standard MPRIS D-Bus interfaces |

Stopping, finishing, disconnecting, switching sessions and reloading the window clear the old item. Paused items remain available. Unsupported controls stay disabled. Artwork downloads have a timeout and size bound; changing the item cancels obsolete downloads. Authenticated artwork uses the selected session's credentials, which never enter OS metadata. Missing desktop D-Bus leaves playback working and logs the unavailable integration once.

Every active item starts with Couch's existing brand artwork, replaced only by a successfully decoded media cover. Missing, failed or invalid artwork therefore cannot leave an unspecified OS placeholder or retain the previous item's cover. Apple's [media artwork](https://developer.apple.com/documentation/mediaplayer/mpmediaitemartwork) is separate from the [bundle icon](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleiconfile); supplying the app icon in the bundle alone did not populate Now Playing artwork.

The [official Tauri plugin catalog](https://v2.tauri.app/plugin/) currently has no official system-media plugin. The community alternatives were checked before adding platform adapters:

- [`tauri-plugin-media`](https://github.com/Taiizor/tauri-plugin-media/tree/510c61c6b9b973f5834822b857cbaf1760cb3f89) has placeholder Linux transport methods and macOS callback/artwork implementation; its API cannot express Couch's dynamic transport capabilities.
- [`souvlaki` 0.8.3](https://docs.rs/souvlaki/0.8.3/souvlaki/) implements real cross-platform controls, but cannot set individual capabilities, live status or playback rate. Its Windows metadata setter leaves omitted fields/artwork unchanged. Adopting it would require a fork to preserve Couch's controls and stale-state behavior.
- [`mpris-server` 0.10.0](https://docs.rs/mpris-server/0.10.0/mpris_server/) supplies Linux's standard interface, property changes and capability setters without implementing D-Bus manually.

Platform references: [Apple Now Playing](https://developer.apple.com/documentation/mediaplayer/mpnowplayinginfocenter), [Apple macOS playback state](https://developer.apple.com/documentation/mediaplayer/mpnowplayinginfocenter/playbackstate), [Microsoft desktop SMTC interop](https://learn.microsoft.com/en-us/windows/win32/api/systemmediatransportcontrolsinterop/nf-systemmediatransportcontrolsinterop-isystemmediatransportcontrolsinterop-getforwindow), [MPRIS Player interface](https://specifications.freedesktop.org/mpris-spec/latest/Player_Interface.html).
