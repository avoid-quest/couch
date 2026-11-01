# Providers

Each provider reads a public site's pages and published player protocol.
Couch never executes a site's scripts, loads its iframes or copies its markup:
it reads literal values from HTML and reimplements published request formats.
Requests have fixed origins, bounded bodies, per-request timeouts and an overall
25-second deadline, omit credentials and reject redirects unless noted. Saved
items keep canonical public page URLs, never player or signed links. Providers
break when sites change; a failure reports an unavailable stream with
**Try again**.

## Public network boundary

Web extraction and the media it resolves reach only public internet addresses
(`src/server/public-network.ts`). A provider's playlist can't point Core at
loopback, LAN or reserved addresses; explicitly configured direct, IPTV and
radio sources keep LAN access.

- Every DNS answer must be public, and the socket connects to those checked
  addresses; redirects repeat the check, keeping Host and SNI.
- yt-dlp and FFmpeg go through an authenticated temporary loopback proxy that
  applies the same check, so their own manifest fetches are constrained too.
- Resolved web media always goes through Core's signed relay; every HLS child
  (variants, segments, keys, maps) is rewritten through it. Credentials stay
  bound to the source's exact origin; cross-origin children get only provider
  context (User-Agent, Referer reduced to its origin, Origin).
- YouTube keeps yt-dlp's `--check-formats`: a fresh googlevideo URL can 403
  until checked.
- Bandcamp playback allows only MP3, AAC, FLAC and WAV: yt-dlp may otherwise pick
  ALAC, which Chromium rejects after a successful response.
- `couch.log` records `media resolve`, `media resolved` and `media response`
  lines per attempt, with hosts and fingerprints but no signed URLs, cookies or
  IPs. To report a failure, send those lines for one failure and one Try again.

## Previews

Scene previews are optional and never block playback. Core accepts a yt-dlp
`mhtml` storyboard (YouTube, Twitch), a declared timed-image manifest
(StreamingCommunity and AnimeUnity's `window.thumbnailsUrl`, RaiPlay's
`vtt_poster_thumbs_url`) or an HLS `EXT-X-IMAGE-STREAM-INF` track on finite VOD.
Nothing is guessed or extracted from frames. `/api/playback-preview` checks
pairing, playback and output consent; Core alone keeps manifest and image URLs.
Image acceptance uses the bytes' signature and dimensions, not the URL or
Content-Type (Twitch and YouTube mislabel theirs).

## 123MoviesFree

Catalogue at `https://ww8.123moviesfree.net`: films `/movie/<slug>-<id>/`, TV
seasons `/season/<slug>-<id>/`; Couch marks the selected episode as `?episode=N`.

- Player metadata (`https://ployan.me/watch/`, `/get/<token>`): the token is
  salt-IV-ciphertext in hex, AES-GCM with a PBKDF2-SHA256 key from the public
  string `player` (1,000 iterations), over `id+episode+server+timestamp`.
- Server 1 answers `mode: "direct"` with `/hls/<info>/master.m3u8`; for some
  titles that manifest returns HTTP 502 from the provider. Couch then tries
  Server 2 once: its `embed` answer maps through Emboser to VidNest Beta
  (`new.vidnest.fun/flixhq/...`, nonce-checked AES-GCM). Only that path is
  implemented; other embed players were unreliable or need script execution.
- Subtitles: `/sub/<token>/index.json`, WebVTT only, at most 16 tracks.

## AnimeSaturn

`https://animesaturn.ro/`: catalogue `/anime/`, titles `/anime/<slug>/`, episodes
at their own root page. Episode lists load in chunks of 50 via
`POST /wp-admin/admin-ajax.php` (`action=miruro_load_eplchunk`, with the nonce and
series ID from the title page). Players publish their source as a literal
(`var src`, `var primary`); Couch tries HD (Streampeaker HLS or progressive MP4,
probed with a one-byte range) before Mega.

## AnimeUnity

The site moved to `https://www.animeunity.to/`; saved IDs stay canonical to
`.so`, and the transport maps them. Titles are `/anime/{id}-{slug}`, episodes add
a database ID (not the episode number).

- Search: `/archivio?title=` (`records` on `<archivio>`); more pages:
  `POST /archivio/get-animes` with the page's CSRF token and session cookies.
- Episodes come in ranges of 120 (`/info_api/{id}/{n}?start_range=&end_range=`).
- The player embeds `vixcloud.<tld>`; Couch reads `window.masterPlaylist` and
  builds the HLS URL as the site's script does (adding `h=1` for FHD).
- On a failure, Couch looks for a domain move via the catalogue redirect or the
  [domain tracker](https://domains-tracker.server66.workers.dev/get) shared with
  StreamingCommunity, validating real catalogue records before adopting it.

## Queue limit

Whole-series queueing stops at 500 episodes (Couch's queue limit); longer series
return an error, and their episodes stay playable one by one.
