# 123MoviesFree

Couch reads the public catalogue at `https://ww8.123moviesfree.net`, prefers
the site's advertised direct playback server, and supports one advertised
Server 2 fallback when the direct manifest is unavailable. Film pages are
`/movie/<slug>-<id>/`; TV collections are individual seasons at
`/season/<slug>-<id>/`. The website selects episodes with buttons without
changing the page URL. Couch records the selected number as `?episode=N` and
removes that marker before fetching the season page.
Public history and progress references use the catalogue origin so accepted
alternate hostnames share the same film or episode progress.

## Public contracts

- Search uses `/searching?q=<query>&limit=<count>&offset=<offset>`. Each `data`
  row supplies `t` (title), `s` (slug with ID), `d` (`m` for a film, `s` for a
  season), `e` (episode count), `n` (season number), `q` (quality), and `y` (year).
- Detail pages identify the title with `#mid[data-mid][data-mode]`, where mode
  is `movie` or `serie`. Episode buttons use `.episode#ep-N`; server buttons
  use `.server#srv-N`. The observed servers are 1, 2 and 5.
- The published player at `https://ployan.me/watch/` requests `/get/<token>`.
  Its token is the hex encoding of an 8-byte salt, a 12-byte IV, and AES-GCM
  ciphertext with the authentication tag, separated by hyphens. The AES key
  is 32 bytes from PBKDF2-HMAC-SHA256 with the public string `player` and 1,000
  iterations. The request text is `id+episode+server+unix_timestamp`.
- A successful metadata response is `{code: 200, mode: "direct", info: ...}`.
  Its `info` value is used unchanged in `/hls/<info>/master.m3u8`. Couch only
  tries servers listed on the public detail page. Server 1 remains preferred;
  an unavailable direct manifest can fall back once to Server 2. Malformed
  metadata, oversized bodies and timed-out requests do not start another attempt.
- Server 2 returns `mode: "embed"` with `info` encrypted using the same
  PBKDF2/AES-GCM scheme and public string `player`. Its plaintext is
  `movie/<TMDB ID>-<timestamp>` or
  `tv/<TMDB ID>/<season>-<episode>-<timestamp>`. The published player maps
  these to `https://emboser.com/movie/?mid=...` or `/tv/?mid=...&s=...&e=...`.
  Emboser's published `/js/watch.js` advertises VidNest alongside four other
  players. Couch implements only VidNest's Beta HLS contract, retaining the
  returned ID and season and requiring the selected episode to match.
- VidNest's published movie and TV player chunks request
  `https://new.vidnest.fun/flixhq/movie/<ID>` or `/flixhq/tv/<ID>/<season>/<episode>`.
  Each request has a fresh 16-byte base64url `_n` nonce. The response is
  `{v: 2, n, d}`: `n` must match the request; `d` is base64url containing a
  12-byte IV and AES-GCM ciphertext/tag. The key is SHA-256 of
  `<nonce>|<public cipher string>` from the published player. Authenticated
  plaintext must report `status: "success"`, `type: "hls"` and a stream URL
  on the observed `noisy-king-5904.streamed-7.workers.dev` worker under
  `/hls/<payload>/master.m3u8`. Only its `/sub/<payload>` subtitle URLs are
  accepted. Host or protocol changes fail closed and need a contract update.
- Direct-player subtitles are listed at `/sub/<token>/index.json`, with
  `file`, `label`, `lang` and `default` fields. This token is the hex encoding
  of `id-episode` after XORing each byte with the XOR of the bytes of `player`.
  Couch accepts WebVTT files only within that title and episode's subtitle
  directory on the fixed player origin. Alternate, SDH and forced labels are
  preserved; duplicate labels are numbered. As with other external subtitles,
  the profile's language comes first and at most 16 tracks are offered.

Couch implements these published metadata protocols with Node's cryptography
library. It does not download or execute the websites' scripts, load their
iframes, or copy their advertising markup. Metadata origins are fixed, requests
omit credentials and reject redirects, metadata is capped at 16 KiB, and HLS
manifests are capped at 512 KiB. Every player request has a 12-second deadline;
the complete catalogue-to-manifest resolution has a 25-second deadline and
supports cancellation. A manifest must be valid-looking HLS before it is
passed to Couch's existing media resolver.
The fallback shares that same deadline and limits, with no server rotation or
retry loop. Its CDN requests use the existing DNS-checked public network,
extractor proxy and signed media relay, including HLS child playlists, maps,
keys and segments. Catalogue title, artwork, duration, history and episode
references remain those of the selected item.

Subtitle discovery is optional, capped at 64 KiB with its own five-second
deadline after the video manifest succeeds, and supports caller cancellation.
An unavailable, timed-out or malformed index does not prevent
video playback. The files use Couch's existing signed subtitle endpoint and
playback controls; they are fetched only when selected, with the existing
2 MiB subtitle limit and redirects rejected. Profile preferences continue to
control language and whether subtitles are shown.
When the fallback lists subtitles, Couch uses those tracks for that stream,
including SDH/forced labels, duplicates and the same language preference and
16-track limit. Otherwise it retains the title/episode's optional player index.

## Verification on 12 October 2026

Live [catalogue](https://ww8.123moviesfree.net/movies/), search,
[film](https://ww8.123moviesfree.net/movie/7500-100943/) and
[season](https://ww8.123moviesfree.net/season/animal-control-season-2-1630856705/)
requests returned HTTP 200. The public
metadata protocol also returned HTTP 200 and `mode: "direct"` for **7500**,
**Inception**, and **Animal Control, season 2, episode 2**.

The corresponding direct master manifests initially returned **HTTP 502**,
including fresh requests with the same User-Agent and Referer used by the
resolver. A later Salvation request recovered without a resolver change:
the manifest returned HTTP 200 and a media segment returned HTTP 206 with
MPEG-TS data. In the isolated macOS build, **Salvation**, **Almost Dead**, and
**Get Jiro, season 1, episode 2** then played video with advancing timelines.
Almost Dead recovered using the existing **Try again** action. These checks
establish live playback at that time, but the observed upstream failures can
still recur; the resolver reports an unavailable stream and asks the user to
retry or choose another source.

The focused integration tests use fixtures to verify the encrypted request,
film and episode selection, HLS validation, response limits, safe errors, and
cancellation. Those tests do not establish live playback availability.

Live subtitle indexes listed three English tracks for Almost Dead (including
SDH), English SDH for Get Jiro episode 2, and Norwegian forced subtitles for
Salvation. These WebVTT files returned HTTP 200 with subtitle cues. Subtitle
selection and on-screen SDH rendering were verified in the rebuilt isolated
macOS app. Availability is title-specific; a rich language list is not guaranteed.

The reference extension
[123movies-downloader at 69ce900](https://github.com/serpapps/123movies-downloader/tree/69ce9001382073930eec797dd6769dd0027a80e7)
was inspected as source text only. Its background worker observes media
responses, and its content script scans page markup and video elements for
stream URLs. HLS downloads reuse the page's Referer and Origin. This captures
streams loaded by a website player rather than implementing the site's
metadata protocol. No extension code was installed, executed, or incorporated
into Couch.

## Windows audit follow-up on 27 October 2026

Read-only requests from Linux at 21:20–21:21 UTC reproduced the Windows
preview.4 failure for
[The Substance](https://ww8.123moviesfree.net/movie/the-substance-3261/).
Couch's current resolver fetched the detail page and Server 1 metadata with
HTTP 200, including `code: 200` and `mode: "direct"`. The advertised
`/hls/<info>/master.m3u8` then returned HTTP 502 instead of HLS.

The same resolver reached valid HTTP 200 HLS media playlists for
[Salvation](https://ww8.123moviesfree.net/movie/salvation-2069/) and
[Almost Dead](https://ww8.123moviesfree.net/movie/almost-dead-2083/), with one
and three subtitle tracks respectively.
[7500](https://ww8.123moviesfree.net/movie/7500-100943/) failed at the same
manifest step as The Substance. These checks establish title-dependent
resolution; they did not launch a player or verify advancing video.

An independent WebCrypto implementation of the published metadata request
reproduced those results with fresh tokens. The failing manifests also
returned 502 to HTTP/2 requests with a Windows Chrome User-Agent, both without
a Referer and with the player Referer and Origin. The Node response was
Cloudflare's `502: Bad gateway` page. The Substance's advertised Servers 2 and
5 returned `mode: "embed"`, so they provide no supported direct fallback.

No resolver defect or supported alternative was demonstrated. The remaining
blocker is the provider's direct HLS response for the affected titles; the
existing unavailable-stream error and manual retry remain appropriate. The
34 catalogue, client and playback integration tests and the repository
typecheck passed. No Windows app or owner data was accessed during this
follow-up. Recheck The Substance and a comparison title in the isolated
Windows dev app before claiming that playback has recovered.

## Supported fallback on 28 October 2026

The direct failures above still reproduced: The Substance and 7500 returned
HTTP 200 metadata followed by HTTP 502 HLS. The missing recovery path was
Server 2's encrypted embed instruction, previously rejected by Couch. Fresh
requests through its published Emboser → VidNest Beta path returned valid HLS
for both selected films. This adds recovery; it does not repair Server 1.

The production resolver, existing yt-dlp extraction and signed Core relay
were exercised in an isolated Linux scratch directory. Both films returned
HTTP 200 playlists and short media samples at 1080p. The full playlists ran
about 141 and 93 minutes respectively; three-second samples decoded 72
advancing video frames each. The Substance's stream supplied English/SDH and
other subtitles; 7500 retained its available title subtitle. These are bounded
live checks, not a full-film or native Windows acceptance run.

Salvation, Almost Dead and Animal Control season 2 episode 2 kept their
working direct route and decoded advancing samples. The episode also resolved
through the live Beta API with an injected direct-manifest 502, preserving
the advertised series ID, season 2 and episode 2. Fixture tests independently
cover film/episode routing, nonce and authentication failures, destination
restrictions, body limits, whole-resolution timeout and cancellation.

Other concrete alternatives were investigated without executing provider code.
Server 5 requires removing the encrypted instruction's timestamp and mapping
its file ID to the published `vxcagb.com/e/` origin. The Substance's file was
still waiting for an encoder; 7500's advertised file had only about 16 minutes
of content, so Couch does not use that path. Emboser's VidSrc path returned a
404 inner player, VidFast's page required further bundled extraction,
VidZee timed out and VidLink's player chunk returned 403. VidNest Prime did
provide a full-length, decodable AES-128 HLS alternative for The Substance,
but its other probed films/episode returned 502. Beta covered both failing
films and the episode, so only that smaller recovery path is implemented.

Published source evidence, read as text on this date:

- [Ployan player](https://ployan.me/watch/)
- [Emboser server map](https://emboser.com/js/watch.js?v=918d718be928a94b459a56184d1d34e3)
- [VidNest public cipher protocol](https://vidnest.fun/_next/static/chunks/aaf74806d510df4c.js)
- [VidNest movie player](https://vidnest.fun/_next/static/chunks/f83c819c1d11f1dc.js)
- [VidNest TV player](https://vidnest.fun/_next/static/chunks/cc62b77974ba459a.js)

Player bundle hashes and bounded probe results are kept in the implementation
scratch evidence. Signed temporary media URLs are omitted from this document.
