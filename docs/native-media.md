# System media controls

The app window's title is `Couch · instance · current item`, falling back to
`Couch · instance`; the page sets `document.title` and Electron shows it.

Couch feeds the [Media Session API](https://developer.mozilla.org/docs/Web/API/Media_Session_API)
from the session state (`src/client/session/media-session.ts`): title, artist,
album and artwork, playback state and position, and play, pause, stop, next and
seek handlers that run the existing session actions. Chromium maps it to macOS
Now Playing, the Windows media controls and Linux MPRIS, but only while the page
itself plays media, which every Device does since #644 ticket 6.

The idle player and TV cursor hide with `html[data-cursor-hidden]`, and the
player's fullscreen button uses the page's Fullscreen API, which Electron applies
to the window.
