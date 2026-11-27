# Providers

Each provider reads a public site's pages and published player protocol.
Couch never executes a site's scripts or copies its markup: it reads literal
values from HTML (including the player pages AnimeSaturn and AnimeUnity embed)
and reimplements published request formats. Requests have fixed origins, bounded
bodies, per-request timeouts and an overall 25–30 second deadline, omit
credentials (except AnimeUnity's anonymous session cookie for paging) and reject
redirects unless noted. Saved
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

## Mixcloud

`api.mixcloud.com`, Mixcloud's public REST API: search (`/search/?type=cloudcast`),
a user's uploads (`/<user>/cloudcasts/`) with their playlists first, a user's
playlists and one playlist's mixes, 24 per page by `offset`. The API never gives
audio: a mix plays through yt-dlp from its page (`www.mixcloud.com/<user>/<mix>/`,
the URL Couch keeps). Play all and Autoplay take a user's or playlist's first 500
mixes. Mixcloud throttles with HTTP 403 and `Retry-After` (seconds, also in
`error.retry_after`); Core sends nothing to Mixcloud until that time has passed
and says how long to wait.

## Radio archives

Past episodes of the stations in avoid radio, each read from the station's own
public API by a small module in `src/server/providers/archives/`:

| Station | Search | Lists | Episode recording |
| --- | --- | --- | --- |
| Lyl Radio | `strapi.lyl.live/api/lyl/search?q=` | GraphQL `episodesByShow`; a residents page by style (`/shows/residents?styles=`) is `showsByStyles`, then every show's episodes | `audio.url`, else SoundCloud, else Mixcloud |
| NTS | `/api/v2/search` | `/api/v2/shows/<show>/episodes`, 12 per page | `audio_sources` (SoundCloud or Mixcloud) |
| Cashmere Radio | WordPress `episode?search=` and show pages | `episode?categories=` (the show's category) | `episode_mixcloud_link` |
| Sygma Radio | the catalogue embedded in its home page, kept an hour | `backend.radio.syg.ma/shows/<show>.json` | `mc_link` |
| HKCR | `cms.hkcr.live/shows/search` | `/shows?residents=` | `mixFile.url`, else the Mixcloud player's `feed`, else YouTube |
| Internet Public Radio | `/api/search` | Sanity GROQ by resident or series | `audioUrl` (SoundCloud or Mixcloud) |
| Radio BlackOut | WordPress `podcast?search=` (titles) | `podcast?podcastfilter=` (the show's filter) | the post's `<audio>`/`<source>`, else a SoundCloud or Mixcloud player |
| Resonance Extra | series names from `/api/series_index`, kept a day | `/api/series/<series>` | `mixcloud_stream_url`, or the original broadcast's for a repeat |
| Radio Alhara | its Mixcloud uploads, kept a day | — (Mixcloud items) | Mixcloud |

- Links classify without fetching (`archiveLink` in `src/shared/archives.ts`,
  `mixcloudLink` in `src/shared/mixcloud.ts`): an episode page is an atom; a
  show, resident, series or style page is a playlist, newest first, each
  episode once, at most 500. Episodes not yet aired are left out.
- A search asks every station at once; each has 3 seconds. A station that fails
  or is slow is named ("NTS didn't answer.") and the others still show.
- Playback resolves the episode page when it plays: the station's own file goes
  to yt-dlp as a direct file, a SoundCloud or Mixcloud copy as that page. Up
  next, Saved and history keep the station's episode page; Autoplay continues
  through the episode's show.

## Bandcamp fan pages

A fan's collection (`bandcamp.com/<fan>`) and wishlist (`/<fan>/wishlist`) read
the page's `pagedata` literal (fan ID, first items, paging token), then page with
the site's own `POST /api/fancollection/1/{collection,wishlist}_items`. bandcamp.com
challenges Node's HTTP client, so both requests go through the managed yt-dlp's
transport, as Bandcamp search does (`vendor/bandcamp`). **Play all** on a fan page
queues the tracks of the items the page shows first, each album's in order, listed
flat in one extraction; the rest stay on the page to open one by one.

## SoundCloud lists

Sets (`/<user>/sets/<set>`) and profiles (`/<user>`) list through yt-dlp's
`--flat-playlist`. A set's page lists only its first tracks in full;
`vendor/soundcloud` completes the rest with the same `tracks?ids=` request upstream
makes for private sets, so every entry has its public page, title and length.

## Spotify

Spotify plays only in its own DRM player. Couch reads the literal track list from
the public embed page (`open.spotify.com/embed/{track,album,playlist}/<id>`,
`__NEXT_DATA__`), with no account. Each track keeps its canonical
`open.spotify.com/track/<id>` link in Up next and Saved, and its meta line says it
plays from YouTube: at play time Couch searches YouTube for "artists title" and
plays the first video within 10 seconds of Spotify's length, else the item is
unavailable with **Try again**. There is no Spotify search.

## Queue limit

Up next holds 500 entries. A pasted or opened list (a YouTube playlist, a Bandcamp
album, a SoundCloud set or profile, a Spotify list) longer than that plays its first
500, or queues as many as Up next has room for, and says so. Whole-series queueing stops at 500 episodes; longer series
return an error, and their episodes stay playable one by one.
