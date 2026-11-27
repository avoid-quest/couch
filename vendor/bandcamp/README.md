# Bandcamp search and fan page transport

This first-party yt-dlp plugin makes one GET to Bandcamp's app search endpoint,
`/api/fuzzysearch/1/app_autocomplete`. Node's direct HTTP client can receive
Client Challenge HTML even from this endpoint. The managed yt-dlp helper's
existing HTTP transport returns the JSON; its JavaScript runtime selection
(QuickJS or Node for YouTube) does not participate in this request.

`CouchBandcampFan` makes one GET to a fan's page (`bandcamp.com/<fan>`,
`/<fan>/wishlist`) and `CouchBandcampFanItems` one POST to the page's own paging
endpoint (`/api/fancollection/1/{collection,wishlist}_items`, with the fan ID, token
and count Core gives), for the same reason.

The plugin passes the raw response to Core's existing `providerJson` validation.
It does not visit result pages, follow a challenge or retry it. Core retains
query/result limits, URL validation and normalization, deduplication and art_id
covers. Album/track playback continues to use the upstream Bandcamp extractors.

Uses yt-dlp's [documented plugin mechanism](https://github.com/yt-dlp/yt-dlp#developing-plugins)
and [`InfoExtractor._download_webpage`](https://github.com/yt-dlp/yt-dlp/blob/2026.10.26/yt_dlp/extractor/common.py).
The source is embedded in Core and staged in a private temporary directory for
each search, then removed. User plugins stay disabled. No new dependency,
browser, impersonation or challenge solver is introduced.
