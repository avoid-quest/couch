# Video metadata corrections and export

The host API supports administrator corrections for local movies and episodes.
Existing libraries need one rescan to retain their import snapshot before the
first correction. Corrections use each item's current revision; another edit or
a changed scan makes an older edit fail with HTTP 409. Correction values, origin,
artwork and the searchable catalog commit in one SQLite transaction. Source
media and sidecars are never written. Rescans reapply saved per-field corrections.
Cached metadata remains available when the source folder or provider is offline.
Malformed, oversized or unreadable NFO reads keep the last valid snapshot of that sidecar. Other valid episode or show sidecars still update. This preserves the import snapshot
and video classification; they do not discard unknown fields before export.

The supported editable fields are title, original title, plot, release year/date,
genres, artwork, and episode season/number and series title. A release year and
date must agree. Correcting an episode's series title changes its description;
its existing local show-folder identity stays stable. Watching profiles, playback
progress and queue identities stay separate from metadata matching.

## TMDB setup and matching

Configure an authorized **TMDB API Read Access Token** with the administrator's
provider control. It is stored in the host's private database and is never
returned by status, metadata, catalog or controller snapshots. Clearing the token
disables online lookups and clears pending previews. Requests use the official
HTTPS API and a bearer header; image downloads receive no API credential.

Movie matching searches movies. Episode matching searches series, then requests
the explicit season and episode. Search returns at most 20 candidates in English.
A detail preview expires after five minutes and includes the exact fields and
artwork that a later explicit match operation will apply. Applying a match
replaces the previewed fields, including existing manual values. Inspect it first.
A later manual edit changes only its submitted fields; clearing the saved match
keeps the current values and suppresses any older imported TMDB ID on export.
No lookup automatically applies a match.

At most two provider operations run together. Each has a ten-second deadline,
a 1 MiB JSON bound and a 2 MiB image bound. Redirects and arbitrary artwork hosts
are rejected. Invalid or failed details/artwork leave persisted metadata unchanged.
PNG/JPEG dimensions must meet the existing local-artwork limits. There is no
background enrichment or new dependency.

The owner reported no authorized TMDB access on 2026-09-06. Deterministic API
contract tests use generated responses. Live search, matching and artwork
qualification remain open until an authorized token is available; these tests
do not claim a live service pass.

## Explicit download export

An export downloads `couch-metadata-<item-id>.tar` to the requesting browser's
download destination. It never replaces a file on the TV. Extract into an empty
folder and inspect `placement.json` before manually placing sidecars beside the
media. Back up existing sidecars before choosing to replace them.

The archive contains:

- `metadata.nfo`, with corrected title, originaltitle, plot, year,
  premiered or aired, and genre. Episodes also export season, episode and
  showtitle. A confirmed match exports a TMDB uniqueid.
- `show.nfo` for episodes, with the corrected series title. Place it as
  `tvshow.nfo` in the original show folder, as described in the manifest.
- Available PNG/JPEG poster or episode thumb and fanart. The manifest gives the
  corresponding sidecar names. Show fanart and a show-poster fallback belong in the show folder; a chosen episode image uses the episode thumb destination.
- Byte-identical `original-*.nfo` import snapshots, which are reference copies.
- `placement.json` with source basenames, destination instructions and value
  origins, plus a short README.

The corrected NFO itself preserves unknown imported elements, attributes and
comments. Supported direct fields are replaced, XML formatting may change, and
runtime remains imported. Original snapshots are included in addition to that
preservation. Export rejects an oversized or invalid resulting NFO. Export uses
fixed archive entry names, so media filenames never become extraction paths.
No source media, provider key or absolute host path enters the archive.

References checked 2026-09-06: [TMDB authentication](https://developer.themoviedb.org/docs/authentication-application),
[movie search](https://developer.themoviedb.org/reference/search-movie),
[series search](https://developer.themoviedb.org/reference/search-tv),
[episode details](https://developer.themoviedb.org/reference/tv-episode-details),
[image configuration](https://developer.themoviedb.org/docs/image-basics), and
[Bun Archive](https://bun.sh/docs/runtime/archive).
