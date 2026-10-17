# AnimeSaturn

The provider reads the public AnimeStream pages at https://animesaturn.ro/.
The catalogue is `/anime/`, title pages are `/anime/<slug>/`, and episodes
have their own root page: `/<slug>-episode-1/`, `/<slug>-ep-1/`, or legacy
`/<slug>-episodio-1-streaming-sub-ita/`. Search uses `/?s=<query>`.
Catalogue pagination uses `/anime/page/2/`; search uses `/page/2/?s=<query>`.
Only canonical public page references are saved, never player or signed links.

Observed on 2026-10-17:

- [One Piece](https://animesaturn.ro/anime/one-piece/) advertises 1,180
  episodes in 24 chunks of 50. The first chunk is HTML. Its public script
  loads the rest with a form POST to `/wp-admin/admin-ajax.php`, passing
  `action=miruro_load_eplchunk`, `nonce`, `series`, and zero-based `page`.
  The nonce and series ID come from the fetched title page. Responses are
  `{ "success": true, "data": { "html": "<li>…</li>…" } }`.
- [Episode 1180](https://animesaturn.ro/one-piece-sub-ita-episode-1180/)
  includes a same-origin iframe and base64 iframe strings in `loadMi` buttons.
  The iframe route is `/wp-content/themes/animestream-child/player/` with
  `source`, `url`, and optional `poster` parameters.
- `source=animesaturn_live` takes an `/episode/<slug>/ep-1180` reference.
  Its response publishes a JSON string in `var src`, pointing to a signed
  HLS manifest at `srv30.sake.streampeaker.org`. That manifest returned 200
  and listed five resolutions from 720p to 144p. Couch’s full yt-dlp playback
  resolution also returned a working HLS stream for this episode. An isolated
  Couch Core and Chromium browser played it at 1280×720 with advancing video
  and no media error.
- `source=megavid_panel` takes an opaque base64 reference. Its response
  embeds `https://cdn2.megaplay.su/e/<hex>?autoplay=1`. That public page
  publishes `var primary`, an HLS master on the same origin. The page
  loaded successfully during the smoke check, but its manifest returned
  Cloudflare HTTP 502; the HD stream remained available.

Couch reads those literals without running site scripts or loading player
libraries. It tries HD first, then Mega, validates the HLS response, and
passes a browser user agent and AnimeSaturn referer to playback. Hostnames,
embed paths, requests, response sizes, and timeouts are bounded. Redirects
are rejected. The observed episode is labelled Sub ITA; these player pages
expose no separate subtitle tracks.

Browsing returns at most 50 episodes with the exact zero-based position in
the title. Queue loading gathers every chunk for titles with at most 500
episodes. Larger titles return an explicit error because Couch queues are
limited to 500 entries; their individual episodes remain browsable/playable.

Live smoke checks also covered the public catalogue, search, an empty
search, the final One Piece chunk, and a single-episode title
[Blades of the Guardians 2](https://animesaturn.ro/anime/blades-of-the-guardians-2/).
