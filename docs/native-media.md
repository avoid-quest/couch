# System media controls

The app window's title is `Couch · instance · current item`, falling back to
`Couch · instance`; the page sets `document.title` and Electron shows it.

Couch feeds the [Media Session API](https://developer.mozilla.org/docs/Web/API/Media_Session_API)
from the session state (`src/client/session/media-session.ts`): title, artist
(the programme's host, the song's artist, else the station or channel), album (the station or
the series) and artwork, playback state and position, and play, pause, stop,
next and seek handlers that run the existing session actions. Chromium maps it
to macOS Now Playing, the Windows media controls and Linux MPRIS, but only while
one of the page's media elements holds sound. Synced sound and Live play through
Web Audio, which drops out as soon as it pauses, so a silent element at volume 0
(no audio stream, so the computer can still sleep) holds the page's place and
follows Play and Pause. An item this Device hears through the player's own
element, without the compressor, needs none. It runs on a Device that plays the
Playback and in the desktop app, which also shows a Playback its window controls
on another Device; a phone or a browser tab that only controls doesn't claim the
system's audio. A station or a share reports a zero-length position, as Chromium
does when it knows none.

The desktop app's tray (`app/tray.ts`) leaves what plays to Now Playing. It
shows the Couch's name, its connection and Share on network, then **Open
Couch**, **Pair a device…** for an admin, **Settings…**, what this window shares
and where with **Stop sharing** (its icon gains a dot meanwhile), the update
state with **Check for updates** or **Restart to update**, and **Quit Couch**.
The page reports its part through the preload bridge (`trayStatus`) and handles
the actions that open its pages (`onTrayAction`).

The idle player and TV cursor hide with `html[data-cursor-hidden]`, and the
player's fullscreen button uses the page's Fullscreen API, which Electron applies
to the window.
