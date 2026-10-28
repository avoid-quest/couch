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
Stored media credentials are bound to the original media source's exact origin,
including its scheme and port. Cross-origin children, separate audio sources and
redirects receive only media negotiation, provider context (User-Agent, Referer
and Origin) and body-framing headers; authorization, cookies and custom API-key
headers stay at the original origin. A redirected playlist cannot grant its new
origin access to those credentials. Cross-origin Referer values are reduced to
their HTTP(S) origin, removing credentials, paths, queries and fragments; invalid
or non-HTTP(S) values are omitted. Same-origin requests retain the source context.
Signed relay paths preserve media extensions so native HLS checks still apply
when the upstream URL has signed query parameters.
Extensionless playlists with an incorrect MIME type are detected from their
prefix. Non-HTTP references, variable substitution and content steering fail closed.
Source subtitles use the same public-only HTTP transport.

YouTube resolution uses yt-dlp's [`--check-formats`](https://github.com/yt-dlp/yt-dlp#video-format-options)
before returning selected streams. An advertised format is not proof that its
fresh URL can be downloaded: on the Mac network, new `TVHTML5` video/audio URLs
returned 403 through curl and Core even with per-format headers and matching
IPv4 egress, then worked when replayed later. yt-dlp's downloadability check made
the immediate relay requests succeed, without cookies or a pinned player client.

Bandcamp can advertise free downloads alongside its MP3 preview. yt-dlp's default
audio ranking can select ALAC (`falac`), which Chromium rejects after a successful
HTTP response. Playback restricts Bandcamp to MP3, AAC, FLAC and WAV, keeping the
best supported audio, including lossless formats, without an unrestricted fallback.
The Device's VP9 capability does not imply ALAC support. See
[yt-dlp format filtering and sorting](https://github.com/yt-dlp/yt-dlp#filtering-formats)
and [Chromium's audio decoder support](https://github.com/chromium/chromium/blob/main/media/base/supported_types.cc).
Offline selection regressions use the real extractor with sanitized format fixtures:

```sh
bun build tests/youtube-playback.integration.ts --target=node --outfile=build/youtube-playback.integration.mjs
COUCH_TEST_YT_DLP=/absolute/path/to/yt-dlp node --test build/youtube-playback.integration.mjs
```

Core prepares protected loopback media for relaxed scheduled playback through the common source-preparation and audio-worker path. A media-only loopback
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
[W3C origin-only referrers](https://www.w3.org/TR/referrer-policy/#referrer-policy-origin),
and [HLS URI rules](https://www.rfc-editor.org/rfc/rfc8216).

## Playback diagnostics

`Direct` in `couch.log` describes device-owned playback, as opposed to synchronized
sound. It does not mean a browser fetches a public site's media directly. For a
YouTube video, Chromium fetches the signed local relay and Core fetches Googlevideo;
FFmpeg is not involved in this Direct route. Electron's Googlevideo-only Range/CORS
hooks do not apply to the local relay. Core forwards the receiver's Range unchanged.

`media resolve` links the Playback ID to a new transport attempt. `media resolved`
records yt-dlp's selected formats/codecs, age/availability metadata, CDN hosts,
known Googlevideo client (`c`), seconds to expiry, IP family/fingerprint, and
presence of `n` and `pot`. These parameters are observations, not proof that a
challenge or token is valid. Header fingerprints compare yt-dlp's per-format
context, the top-level headers Core retained, and the headers Core actually sent. Browser hints contain
only family and platform labels. Fingerprints use a random per-process key:
compare them only within the same run. Cookie and authorization
values, signed URLs, raw IPs, Referer/Origin values and arbitrary header values
are never printed. IP-literal hosts are recorded only as `IPv4` or `IPv6`. A URL's
IP fingerprint does not establish Core's outbound IP.

`media response` records the first answer for each stream/status on a relay route,
including later refusals, even if the renderer never reports an error. It records
the final connection's IP family and headers after redirect stripping, and names
Core as the fetcher, the receiving Device/Core, upstream host, sent Range, and HTTP
status. Child HLS successes stay quiet, repeated statuses are deduplicated, and
each route has a 12-line budget. A locally generated 502 is marked separately
from an upstream HTTP response. `media resolve-failed` records the safe extractor
error or cancellation. Try again creates a new attempt and re-runs extraction;
it does not reuse the previous signed URL.

For a failure in the Mac test instance, capture
`~/Library/Application Support/quest.avoid.couch-test/logs/couch.log` immediately
after one failure and one **Try again**. Include the `media resolve`,
`media resolved`, `media response` and `player error` lines for both attempts,
helper selection lines, Couch version and the failure's local time. If the app
was restarted, include `couch.1.log` too. Note VPN/proxy/network changes during
playback. Do not send an unredacted HAR, yt-dlp JSON, cookies or signed URLs.
