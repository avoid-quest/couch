# Standard UI visual evidence

These are captures of the real Couch UI ported from the accepted design in [PR #539](https://github.com/avoid-quest/couch/pull/539), not prototype fixtures.

| Screen | Capture | What was exercised |
| --- | --- | --- |
| Find | [find.jpg](find.jpg) | Live mixed YouTube, Twitch, and RaiPlay search, filters, and duration ruler in the browser |
| For later | [saved.jpg](saved.jpg) | Saved media from the local Couch test session in the browser |
| Channels and stations | [saved-channels.jpg](saved-channels.jpg) | Saving a RaiPlay channel from Find, then opening Saved in the browser |
| Playback preferences | [settings.jpg](settings.jpg) | Connected browser settings |
| Player | [player.jpg](player.jpg) | Local video playback in the built macOS app |
| Up next | [queue.jpg](queue.jpg) | Queue sheet over paused local video in the built macOS app |
| Player settings | [player-settings.jpg](player-settings.jpg) | Speed and sound sheet over paused local video in the built macOS app |
| Playback device | [device.jpg](device.jpg) | Output and volume popover in the built macOS app |
| First-run hover | [first-run-hover.jpg](first-run-hover.jpg) | “This computer” choice hovered in the rebuilt macOS app, with readable white text on the soft gray background |

The desktop captures used an isolated debug app and a generated local video. The video and its playback state are not part of this PR. The browser captures used a local Couch server; playback buttons there are unavailable because the native player was closed before the browser session was captured.
