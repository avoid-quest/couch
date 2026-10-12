# 123MoviesFree

Couch reads the public catalogue at `https://ww8.123moviesfree.net` and attempts
the site's advertised direct playback server. Film pages are
`/movie/<slug>-<id>/`; TV collections are individual seasons at
`/season/<slug>-<id>/`. The website selects episodes with buttons without
changing the page URL. Couch records the selected number as `?episode=N` and
removes that marker before fetching the season page.

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
  tries Server 1 when the public detail page lists it. An `embed` response
  requires another player and produces a clear unsupported-source message.
- Direct-player subtitles are listed at `/sub/<token>/index.json`, with
  `file`, `label`, `lang` and `default` fields. This token is the hex encoding
  of `id-episode` after XORing each byte with the XOR of the bytes of `player`.
  Couch accepts WebVTT files only within that title and episode's subtitle
  directory on the fixed player origin. Alternate, SDH and forced labels are
  preserved; duplicate labels are numbered. As with other external subtitles,
  the profile's language comes first and at most 16 tracks are offered.

Couch implements that published metadata protocol with Node's cryptography
library. It does not download or execute the website's scripts, load its
iframes, or copy its advertising markup. The player origin is fixed, requests
omit credentials and reject redirects, metadata is capped at 16 KiB, and HLS
manifests are capped at 512 KiB. Every player request has a 12-second deadline;
the complete catalogue-to-manifest resolution has a 25-second deadline and
supports cancellation. A manifest must be valid-looking HLS before it is
passed to Couch's existing media resolver.

Subtitle discovery is optional, capped at 64 KiB with a five-second deadline,
and supports cancellation. An unavailable or malformed index does not prevent
video playback. The files use Couch's existing signed subtitle endpoint and
playback controls; they are fetched only when selected, with the existing
2 MiB subtitle limit and redirects rejected. Profile preferences continue to
control language and whether subtitles are shown.

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
