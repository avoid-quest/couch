# Bundled desktop client protocol

The desktop window always loads Couch's bundled assets. In **This computer** it uses the local host token and exact frontend build identity. In **Another Couch** it uses only the selected address and that address's paired Controller or Administrator token. This installation starts no local host.

`desktopClientProtocol` in the public `/api/connection` response is the compatibility version. Version 1 covers the HTTP endpoints used by the desktop client, pairing and role responses, WebSocket commands, results and session state. A bundled client checks this field without a token before it sends a stored pairing. For a matching version it opens `/api/ws?clientProtocol=1`; the server accepts different app build revisions from the bundled Tauri origin. Browser pages still send their exact `build` key and retain exact asset/server matching. Missing or different protocol versions stop before the client sends its pairing and show update and target-switch guidance.

Keep changes to version 1 additive: preserve existing fields, meanings, authorization rules and WebSocket messages for older clients. Bump the protocol on both sides when a required field or command changes incompatibly, and test an older and newer app revision against the new server. The marker is a compatibility claim, not an authorization grant. Every HTTP request and WebSocket still requires the selected host's own pairing and current role; revocation closes the socket. Pairings are stored by exact selected origin and checked against the public installation ID before use. Changing a host at the same address requires pairing again.

The bundled page's [Tauri CSP](https://v2.tauri.app/security/csp/) allows HTTP(S) and WebSocket connections to user-selected LAN targets because its configuration is static. The server still checks Host and Origin, paired authority and LAN policy. Native commands remain limited to the bundled `main` window; local playback commands also require **This computer**. Plain HTTP LAN transport and target-machine webview behavior need platform qualification.

## Playback clock

Every socket receives a complete `state` baseline before controls are ready,
including reconnects. It may then receive
`{ type: "clock", playbackId, position, duration }` for changes limited to the
observed playback clock. Position is finite; duration is finite or null; the
playback identity is a string or null. The client rejects malformed clocks,
ignores clocks before its baseline or for another playback identity, and ignores
all messages from retired sockets. Every other Session change still publishes a
complete snapshot. Live radio and IPTV positions travel only in `state`.
