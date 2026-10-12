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

Couch implements that published metadata protocol with Node's cryptography
library. It does not download or execute the website's scripts, load its
iframes, or copy its advertising markup. The player origin is fixed, requests
omit credentials and reject redirects, metadata is capped at 16 KiB, and HLS
manifests are capped at 512 KiB. Every player request has a 12-second deadline;
the complete catalogue-to-manifest resolution has a 25-second deadline and
supports cancellation. A manifest must be valid-looking HLS before it is
passed to Couch's existing media resolver.

## Verification on 12 October 2026

Live [catalogue](https://ww8.123moviesfree.net/movies/), search,
[film](https://ww8.123moviesfree.net/movie/7500-100943/) and
[season](https://ww8.123moviesfree.net/season/animal-control-season-2-1630856705/)
requests returned HTTP 200. The public
metadata protocol also returned HTTP 200 and `mode: "direct"` for **7500**,
**Inception**, and **Animal Control, season 2, episode 2**.

The corresponding direct master manifests returned **HTTP 502** during these
checks, including fresh requests with the same User-Agent and Referer used by
the resolver. Successful media playback has therefore **not been verified**.
This is an observed upstream response from this environment, not proof that
the source fails for every user. The resolver reports the unavailable stream
and asks the user to retry or choose another source.

The focused integration tests use fixtures to verify the encrypted request,
film and episode selection, HLS validation, response limits, safe errors, and
cancellation. Those tests do not establish live playback availability. Verify
a fresh film and episode master before promoting playback support from draft.
