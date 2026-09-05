# Local movie and episode library, issue 27

Ticket: [Browse local movies and episodes with Kodi NFO and nearby artwork](https://github.com/avoid-quest/couch/issues/27).
Initial base: `209c95741dca0dcf6e269687f0a66968826b54da`.

Catalog implementation and local checks are in progress. Native and HTTP UI qualification has not run yet. This note is the acceptance record; passing parser tests does not complete the ticket.

## Import contract

The scanner uses pinned `fast-xml-parser` 5.11.1 and `image-dimensions` 2.5.1. The supported NFO subset is deliberately smaller than Kodi's complete schema.

| NFO root | Imported fields | Meaning |
| --- | --- | --- |
| `movie` | `title`, `originaltitle`, `plot`, `premiered`, `year`, repeated `genre`, `runtime` | Movie description; runtime is minutes |
| `episodedetails` | `title`, `originaltitle`, `plot`, `aired`, `year`, repeated `genre`, `runtime`, `showtitle`, `season`, `episode` | One playable file per episode; aired maps to the public premiere date |
| `tvshow` | `title`, `originaltitle`, `plot`, `premiered`, `year`, repeated `genre` | Description of the containing show |

Strings are plain text, including CDATA. Titles are limited to 300 characters, plot to 4,000, and genres to 16 entries of 80 characters. Dates must be valid `YYYY-MM-DD`; their year takes precedence over legacy `year`. Seasons are integers 0–999 and episodes 0–9999. Season zero is Specials; missing numbers remain reachable as Unnumbered. Runtime accepts a positive decimal up to 10,000 minutes.

The scanner first reads `<video-stem>.nfo`. If no valid item is found, `movie.nfo` is accepted only when the directory contains one video. Episode NFO uses `episodedetails`. Without valid item NFO, a filename containing `SxxExx` identifies an episode. Remaining video files appear as movies using their embedded title or filename. Multi-episode files are not split into queue entries.

Shows occupy one directory, with episodes directly inside it or in `Season N`/`Specials` directories. `tvshow.nfo` in that show directory supplies the show title before episode `showtitle`, then the directory name. Each scan selects the highest-priority current description for the show; equal-priority candidates use the lexicographically first source-relative media path. Concurrent save order cannot replace an NFO title with a directory fallback. A source can contain multiple show directories. Different shows mixed directly in one directory are outside this subset.

For item titles the order is valid NFO, embedded ffprobe title, filename. Probed duration wins over NFO runtime. The host retains embedded tags separately, so removing an NFO restores the embedded title without re-probing unchanged media. File tags still provide artist/album values. Artwork and NFO are read again on every explicit scan; unchanged media avoids repeated ffprobe work.

Migrated video rows retain their legacy title, duration, artist and album while ffprobe is absent or fails on unchanged media. This fallback survives repeated scans and restart, and remains eligible for replacement by a successful probe. A file size/mtime change invalidates it.

Source files are read-only. NFO playback paths, URL artwork, external IDs, watched/playcount/resume fields, and other unlisted fields do not drive playback or overwrite Couch progress. Library items keep their existing UUID by source and relative video path. Show identity hashes the source UUID and relative show directory, independently of NFO/title changes. Renaming/moving a video or show directory is not identity-preserving in this slice. Episodes sort numerically by season and episode, unknown values last, then title and media UUID.

## Nearby artwork and bounds

Only local JPEG/PNG names with lowercase `.jpg`, `.png`, or `.jpeg` extensions are considered, in that order. Within each row, the first valid candidate wins.

| Item | Poster or thumbnail | Fanart |
| --- | --- | --- |
| Movie | `<video-stem>-poster`, then `poster`, in the video directory | `<video-stem>-fanart`, then `fanart`, in the video directory |
| Show | `poster` in the show directory | `fanart` in the show directory |
| Season | `seasonNN-poster`, or `season-specials-poster` for season zero, then the show poster | Show fanart |
| Episode | `<video-stem>-thumb` in the video directory, then show poster | Show fanart |

NFO is UTF-8, at most 256 KiB, 32 nested tags, and 4,096 elements. DTD/entity declarations are rejected before XML validation and parsing. Standard character references decode through the maintained parser with expansion limits. One root/item is required. Malformed or excessive input adds a count to the source warning and leaves media available with fallback metadata.

Artwork is at most 2 MiB, 4,096 pixels per dimension, and 12 million pixels. The maintained image parser checks headers without decoding image pixels on the host. Animated PNG, SVG and other formats are excluded. Browser decode failures display a fallback; header validation alone is not proof of complete pixel decoding. Native and HTTP tests must observe loaded image pixels.

The scanner constructs paths only from media/source locations and the fixed nearby filenames. It never follows artwork or playback references supplied by NFO. Actual sidecar reads check source containment, canonical path equality, regular-file type, size, `O_NOFOLLOW`, and the opened file's device/inode. The bounded read catches growth after the initial size check. Media discovery and playback retain their existing canonical containment and symlink checks.

Artwork bytes are content-addressed SQLite blobs. The existing authenticated `/api/library/artwork/<sha256>` route serves a MIME type and `nosniff`, never a host path. Public movie/show/season results also omit paths and original NFO data.

## Cached originals and offline behavior

Private table `library_video_nfo` holds the last valid bounded original UTF-8 bytes and source-relative sidecar path. Unknown tags, attributes, comments, whitespace and CDATA remain byte-for-byte intact. A completed scan marks originals not seen as unavailable/stale while retaining their bytes. An unavailable source keeps its prior catalog, artwork, and original NFO records; its source status distinguishes that case from a currently readable source. No public catalog route reads this table.

This is the retained input for later [metadata correction/export](https://github.com/avoid-quest/couch/issues/28), not an exporter or manual-correction implementation. Only the current valid version is retained; historical revisions are not archived. Normalized public descriptions are not a substitute for original XML when that later ticket exports unknown fields.

The scanner's SQLite transactions commit item, artwork, original NFO, and search changes before the library invalidation is published. Scans retain existing media rows and profile progress. Reconnect uses the existing fresh snapshot and query invalidation; a full restart retains catalogs and waits for an explicit Play command.

The selected current show description is applied to all retained episodes with the same directory identity, including missing episodes. The same transaction refreshes their search entries without changing their availability, episode numbers, IDs or progress. Selection starts fresh on each readable scan, so removed sidecars do not keep historical precedence. An unavailable source retains the last catalog without selecting new fallback descriptions. This keeps show titles and search counts consistent after a show NFO edit and retains the current description when the whole source goes offline.

## Validation record

- Local `bun run check`: 308 pass, 6 skip, 0 fail, 2,433 assertions. Skips cover missing local ffmpeg/yt-dlp and opt-in public Twitch/RaiPlay checks. These are not substitutes for native evidence.
- Scanner/catalog tests cover movie/episode/show fields, numeric ordering, FTS search, pagination, protected path-free artwork, malformed/deep/oversized XML, invalid/dimension-limited images, symlink escapes, sidecar edits/removal, embedded fallback without repeated probing, source unavailability/recovery, UUID/progress persistence, restart, and exact private NFO retention.
- Focused review regressions reproduce the original failures, then verify migration from a real legacy SQLite schema with absent/failing ffprobe, repeated scans, restart, successful reprobe and changed-file invalidation. A deleted-season episode plus `A show` → `Z show` NFO edit verifies stable identity, cached episode counts, current detail/search metadata and whole-source offline restart. Local frontend/sidecar build passes. Logs are under `.artifacts/catalog/review-{regressions-red,check,build}.log` in the assigned worktree.
- The follow-up precedence regression forces both actual SQLite save orders for mixed NFO/fallback and conflicting episode NFO titles. Both cases chose the last saved title before correction; all four cases now select the documented winner and remove that precedence on a later sidecar-free rescan. The original migration/deleted-episode/offline regressions still pass. Evidence is under `.artifacts/catalog/show-precedence-{red,green,check,build}.log`.
- Native/HTTP playable movie and multi-season fixture, decoded artwork, phone/tablet/desktop/TV screenshots, queue/play, source switching/cancellation, two-controller reconnect, and offline stopped restart: pending coordinated qualification.
- Shared preview rebuild and artifact links/source/binary hashes: pending coordinated qualification.

### Browsing source checks

At browsing source `cb4750b9d1465e47eee82322e8a375063b89349a`, above catalog `29a93a44f2b54b42d9157e27c33fc7bcb1b134eb`, these commands completed with exit status **0**:

| Command | Output artifact |
| --- | --- |
| `bun run typecheck` | `.artifacts/browsing/final-typecheck.log` |
| `bun run build` | `.artifacts/browsing/final-build.log` |
| `bun x tsc --ignoreConfig --noEmit --target ESNext --module Preserve --moduleResolution Bundler --types bun --skipLibCheck --strict tests/linux/video-library.ts tests/linux/video-library-fixture.ts` | `.artifacts/browsing/final-helper-typecheck.log` |

The helper typecheck emits no output on success; its observed exit status is recorded here. The build produces the frontend and Darwin ARM Bun sidecar. The new native fixture and UI flows have not run, so these checks provide no native playback or visual acceptance evidence. The rebased browsing source is unchanged by `git range-diff`; the corrected catalog's full check result is recorded above.

The video fixture retains its local five-case queue-entry-to-action conversion. Sharing it would also edit the music fixture helper, which is under concurrent harness ownership, without changing the queue restoration behavior needed by this ticket. The existing controller interactions and stopped-state assertions remain in their respective fixtures; no generic provider abstraction was added.

## Official references

- [Kodi movie NFO](https://kodi.wiki/view/NFO_files/Movies), [episode NFO](https://kodi.wiki/view/NFO_files/Episodes), [TV show NFO](https://kodi.wiki/view/NFO_files/TV_shows)
- [Kodi movie artwork](https://kodi.wiki/view/Movie_artwork), [TV show artwork](https://kodi.wiki/view/TV-Show_artwork)
- [fast-xml-parser options](https://github.com/NaturalIntelligence/fast-xml-parser/blob/master/docs/v4%2C%20v5/2.XMLparseOptions.md)
- [image-dimensions API](https://github.com/sindresorhus/image-dimensions#api)
