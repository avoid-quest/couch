# AnimeUnity

Verified against the public site and its own player scripts on 2026-10-17.
Domain migration and live browsing/playback rechecked on 2026-10-19.

- As of 2026-10-19 the site is `https://www.animeunity.to/`. The former `.so` host fails normal DNS lookup here; reaching it with a cached public DNS address returns HTTP 302 to the new origin. Couch keeps public item IDs and saved URLs canonical to `.so`, preserving existing favorites and For later entries. The transport uses `.to` when requesting catalogue, anime or episode pages; Open in browser also maps former `.so` links to `.to`, retaining their path, query and fragment. The catalogue and player markup are unchanged.
- Public anime pages use `/anime/{animeId}-{slug}`. A selected episode adds `/{episodeId}`; this is a database ID, not the displayed episode number.
- `/archivio?title=...` supplies the first 30 search results in the `records` attribute of `<archivio>`, with the total in `tot_count`. The same page without a title is the catalogue.
- Further catalogue results use `POST /archivio/get-animes` with the site's JSON fields: `title`, `offset`, `type`, `year`, `order`, `status`, `genres`, `dubbed` and `season`. Unselected filters are `false`. The page's CSRF meta token and anonymous session cookies are required; Couch keeps them within the current browse request.
- `<video-player>` supplies `anime`, `episode`, `episodes`, `episodes_count` and `embed_url`. The site groups episode rows into ranges of 120. `GET /info_api/{animeId}/{selectedEpisodeNumber}?start_range=121&end_range=240` retrieves another range. The endpoint rejects ranges larger than 120.

Couch's catalogue cursors advance by the returned row count (normally `30`, `60`, ...), matching the site's own script; an empty page advertising remaining results is rejected. Anime cursors are range starts (`121`, `241`, ...). Browsing a further anime range needs only the title and that range. Later ranges omit an unknown collection occurrence index. Queue loading assembles complete lists up to the existing 500-episode queue limit and explicitly rejects longer anime. It checks all advertised episode numbers before excluding unpublished rows (`public: 0`), so truncated ranges cannot silently shorten a queue. Combined labels such as `121-122` cover both episode numbers with one queue item.

The public player now links `https://vixcloud.cc/embed/{scws_id}?token=...&expires=...&canPlayFHD=1` (previously `.co`). Couch accepts the HTTPS `vixcloud.<tld>` embed published by the anime page and requires its playlist to stay on that same origin. That page publishes `window.masterPlaylist` as literal `params` and `url` fields. Its own `animeunity-*.js` initializes the HLS source by appending nonempty parameters to the playlist URL, then adding `h=1` when `canPlayFHD` is present. Couch reads only those literal fields; it never executes remote scripts. A live One Piece episode returned an HLS master with 480p, 720p and 1080p variants. The HLS URL has `/playlist/{id}` as its path, without a `.m3u8` suffix.

The site's older player can use progressive MP4 files from `*.sweetpixel.org` directly. Couch supports that observed fallback when no Vixcloud ID is present. It returns the public anime episode title, image and runtime as playback metadata; subtitle renditions in an HLS master remain available to the normal playback pipeline.

Requests use bounded bodies and per-request timeouts, omit ambient credentials and share a 25-second browse/playback deadline. Normal page and player requests reject redirects. When a GET fails or catalogue/title validation rejects an HTTP 200 placeholder (except a missing page), Couch probes the catalogue for a domain redirect, then consults the same [domain tracker](https://domains-tracker.server66.workers.dev/get) as StreamingCommunity. Recovery follows at most three redirects between HTTPS `animeunity.<tld>` hosts, validates actual catalogue records before adopting a candidate, and retries the original path and query. Concurrent recovery shares one check with an independent 20-second deadline; each caller can stop waiting without cancelling the others. Checks, including recovery timeouts, have a ten-minute cooldown. The selected transport origin lives in Core memory, while public item identities stay canonical. POSTs are not replayed across a move; pagination acquires fresh anonymous cookies from the current origin. Recovery still depends on a reachable redirect or an updated tracker; the tracker was still advertising `.so` on 2026-10-19.

Signed embeds and playlists are temporary playback details; public references remain canonical AnimeUnity episode links.

Validation uses the Node integration-test commands in [ci.md](ci.md) with
`tests/animeunity.integration.ts`. Live checks covered catalogue/search and its second page, One Piece's second episode range, public Vixcloud master retrieval, and Couch’s complete yt-dlp playback resolution. No account or installed Couch process is required.

An isolated Couch Core and Chromium browser played One Piece episode 1 at
1920×1080 with advancing video and no media error. The installed app and its
data were not used.

Public player requests and all resolved media use the
[guarded public-media transport](public-media.md), including HLS descendants,
redirects, extraction and Synced playback.
