# Public media requests

Web extraction and its resolved media are restricted to public internet
destinations. A provider's playlist cannot authorize access to Core's loopback,
LAN, link-local, or other reserved addresses. Explicitly configured direct HTTP, IPTV and radio sources keep their existing
network access, including LAN media. The public-only policy is assigned by Core
to web extraction; a client cannot disable it with a flag.

`public-network.ts` implements HTTP(S) requests with Node's socket lookup callback.
Every DNS answer must be public, and the connection uses those same checked
addresses. Numeric addresses are checked before Node can bypass lookup. Redirects
repeat the check; Host and TLS SNI retain the original hostname. Separate socket
pools, streamed responses, cancellation, and 2 MiB playlist bodies keep this
usable for media. IPv4-mapped and transition IPv6 ranges are rejected conservatively.

yt-dlp uses an authenticated, temporary loopback proxy whose outbound connections
use checked numeric addresses. Its explicit proxy option and environment override
inherited proxy bypasses. The proxy closes with the extraction. This constrains
yt-dlp's own manifest fetches, rather than checking one copy of a manifest before
yt-dlp downloads another.

Resolved web media always uses Core's protected relay, even when the upstream
allows browser CORS. Every HLS variant, segment, key, map and rendition is rewritten
through the same boundary. Playlist reloads and redirects remain protected.
Extensionless playlists with an incorrect MIME type are detected from their
prefix. Non-HTTP references, variable substitution and content steering fail closed.
Source subtitles use the same public-only HTTP transport.

Core stores protected loopback media for Synced playback. A media-only loopback
listener keeps native decoding independent of the UI listener’s bind address and
TLS configuration; it closes with Core. FFmpeg also uses the
restricted proxy and a media format allowlist; its only local exception is the
current playback's relay subtree on the media listener's exact loopback port. Core still checks
the signed capability and active playback before serving it. A seek, quality
change, screen handoff or expired-stream recovery must prepare the route again.
Native media processes cannot use the local exception to reach unrelated Core routes.

Validation covers literal and DNS private addresses, mixed DNS answers, rebinding
on redirects, cancellation, proxy authentication, HLS child types, mislabelled
playlists, recovery and intentional LAN playback. The optional real FFmpeg test:

```sh
bun build tests/public-media-proxy.integration.ts --target=node --outfile=build/public-media-proxy.integration.mjs
COUCH_TEST_FFMPEG=/absolute/path/to/ffmpeg node --test build/public-media-proxy.integration.mjs
```

Implementation references: [Node HTTP request options](https://nodejs.org/api/http.html#httprequesturl-options-callback),
[Node DNS lookup](https://nodejs.org/api/dns.html#dnslookuphostname-options-callback),
[yt-dlp network options](https://github.com/yt-dlp/yt-dlp#network-options),
[FFmpeg HTTP and TLS protocols](https://ffmpeg.org/ffmpeg-protocols.html),
and [HLS URI rules](https://www.rfc-editor.org/rfc/rfc8216).
