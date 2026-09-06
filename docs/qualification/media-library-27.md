# Local movie and episode library, issue 27

Ticket: [Browse local movies and episodes with Kodi NFO and nearby artwork](https://github.com/avoid-quest/couch/issues/27).
Initial base: `209c95741dca0dcf6e269687f0a66968826b54da`.

Catalog and browsing source reviews passed before integration onto `fec8e70341ec19260ce1616debcc89d61c08e291`. The native run and focused library replay below provide software evidence. The chooser helper correction is accepted; representative in-app browser qualification passed in the recovery window below; final integration, corrected native build/full official run and preview remain pending. The ticket is not complete.

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
- Native/HTTP playable movie and multi-season fixture, decoded artwork, queue/play, source switching/cancellation, two-controller reconnect and offline stopped restart: passed in the focused private replay below. The original full-suite attempt remains a failure.
- Representative in-app browser flows: passed in the coordinated recovery window below. The private runs do not alter shared preview data.

### Browsing source checks

For the upper review corrections, above unchanged catalog `29a93a44f2b54b42d9157e27c33fc7bcb1b134eb`, these commands completed with exit status **0**:

| Command | Output artifact |
| --- | --- |
| `bun run check` (308 pass, 6 skip, 2,433 assertions) | `.artifacts/browsing/review-check.log` |
| `bun run build` | `.artifacts/browsing/review-build.log` |
| `bun x tsc --ignoreConfig --noEmit --target ESNext --module Preserve --moduleResolution Bundler --types bun --skipLibCheck --strict tests/linux/video-library.ts tests/linux/video-library-fixture.ts` | `.artifacts/browsing/review-helper-typecheck.log` |

The helper typecheck emits no output on success; its observed exit status is recorded here. The build produces the frontend and Darwin ARM Bun sidecar. These historical source checks provide no native evidence by themselves; the later execution record is below.

Selected show details refresh by stable ID through the existing `GET /api/library/items?showId=...&limit=1` route on library invalidation or reconnect. Current navigation and matching Back history receive the new description while retaining season, query and pagination. No catalog API changed. The native helper edits the actual show NFO and fanart, rescans through Folders, and asserts updated native/phone headings, preserved independent seasons and phone query, then updated Back-view plot and newly decoded fanart. These assertions passed in private replay4 below.

After host restart with the source unavailable, the HTTP helper requests the expected movie artwork with authentication and `cache: no-store`, decodes it in a new `Image`, and checks HTTP 200, JPEG MIME type, SHA-256 matching the expected artwork ID, and 240×360 decoded dimensions. A 404, corrupt payload or different image fails this assertion even if an old movie card still has a decoded blob. The eventual result is saved as `freshArtwork` in `video-library-after-restart.json`; the result passed in private replay4 below.

The video fixture retains its local five-case queue-entry-to-action conversion. Sharing it would also edit the music fixture helper, which is under concurrent harness ownership, without changing the queue restoration behavior needed by this ticket. The existing controller interactions and stopped-state assertions remain in their respective fixtures; no generic provider abstraction was added.

## Native execution and helper correction

The product binary source is upper `43dd58ae24d795a79a79992e30aa67740f55a503`, above catalog `69e43a06da000c836bff4fa36f17d8161d78e4fc` and landed base `fec8e70341ec19260ce1616debcc89d61c08e291`. Chooser-only helper correction `584d2802d0b3efdd4ec97171c5b2a877c2ef80ee` has parent `43dd58ae`; it changes only `tests/linux/video-library.ts` (+12/-3). Its focused peer review accepted the correction and the documentation/source distinction. Production source and binaries are unchanged by this correction.

Artifacts are retained in the assigned worktree under [the exact-head record](/Users/devit/Code/couch-media-library/.artifacts/media-library-27/43dd58ae24d795a79a79992e30aa67740f55a503). Each attempt has its own directory; failed attempts were not overwritten.

| Attempt | Result and boundary | Evidence |
| --- | --- | --- |
| `attempt-1` | Authorized `bun run test:linux --jellyfin` exited **1** at the first new video-folder selection. It logged 491 passed checks before timing out with GTK still open. It is not a full-suite pass. | `run.log`, `exit-code.txt`, `partial-checks.json`, `linux/failure.txt`, `linux/native-failure.png` |
| `private-replay` | Reproduced the same chooser failure with copied binaries. Verified the movie exists inside that container; an extra Return left it stuck. Leaving Recent with Alt+Home, then entering the absolute folder, closed the real picker and scanned six videos. | `fixture-files.txt`, `fixture-manifest.json`, `chooser-red.png`, `chooser-extra-return.png`, `chooser-home-location.png`, `run.log` |
| `private-replay-2` | Corrected chooser and all pre-restart library assertions passed. The private runner connected its WebSockets before the restarted host was ready; runner failure retained. | `run.log`, `failure.txt`, `saved-library.json` |
| `private-replay-3` | Fresh authenticated artwork retrieval/decoding passed after offline restart. The private runner then encountered the unclaimed setup dialog before rescan; runner failure retained. | `run.log`, `failure.txt`, `http-video-offline-restart.png` |
| `private-replay-4` | Focused replay completed with **81 recorded checks** plus direct field, identity, artwork and pixel assertions, and both 390px HTTP sessions reconnecting. | `results.json`, `exit-code.txt`, `run.log`, `replay.ts`, `start.sh`, `video-library-before-restart.json`, `video-library-after-restart.json` |

Attempt1 passed Linux `bun run check` (323 pass, 2 opt-in provider skips, 0 failures, 2,575 assertions), the native build, 10 app Rust tests, 2 ABI tests, and the explicit DASH (1), resume/reset (1), external-subtitle (1) and radio (2) regressions. Before its chooser failure it exercised real Jellyfin authentication/playback/reporting/resume/subtitle pixels, native DASH color checks, both HTTP quality/preference sessions, local progress and music. Those partial checks do not qualify the remaining full-suite restart/claim flows.

Shared Cargo/cache access was released only after all Cargo commands finished and the process list showed private `/work/bin` executables without Cargo/rustc. Each replay uses an isolated container with read-only source/binary mounts, no shared cache volumes and no host browser access. The replay scripts are retained artifacts, not changes to the shared runner. The original native Xvfb display remains 1600×1000 and the two HTTP controllers remain 390 CSS pixels.

| Executed input | SHA-256 |
| --- | --- |
| Native `couch` binary | `e71e1969983880f6d9015dd0b484c0fdda4b866e76e3ced67cd56e20dafe4313` |
| Compiled Bun `couch-server` | `3b7b9a664bc220f0da8d717ea618f325d40177b16a090b241f3633bb19e01bee` |
| Corrected `tests/linux/video-library.ts` | `578a40684f34ed60e01dbc103dc8b48dd077993f78c6d06750cbef5ca04074a7` |

All 240 repository-source entries in the original binary source manifest match the worktree at `43dd58ae`; four additional entries are generated Tauri schemas. Replay4's `binaries.sha256` matches the original copies exactly. The corrected helper's strict TypeScript command above and `git diff --check` both exited **0**; the helper compiler emitted no output.

The actual fixture has one NFO movie, a show with episodes 1.2, 1.10, 2.1 and 2.10, and one malformed-sidecar movie. Each video is a real 20-second H.264/AAC file with two audio tracks, subtitles and chapters. The malformed item remains playable through embedded-title fallback. JPEG/PNG posters, fanart and thumbnails were decoded by native and HTTP views. The real movie's 20-second probe duration wins over NFO runtime 99, and imported watched/resume values do not alter Couch progress. The per-run fixture manifest records original sidecar/artwork/media hashes.

Replay4 verifies native folder selection, movie/show/season/episode browsing, numeric order, search, TV Queue/Play, phone Play from start, native pixels and two audio tracks, independent TV season2/phone season1, source replacement and late-load cancellation, stopped state, mounted VideoStage, fresh reconnect snapshots, rescan UUID/progress preservation, NFO title edits, current/back-stack show title/plot/fanart refresh, source unavailability, cached browsing and disabled playback. After real host shutdown/restart, a new authenticated artwork request returns HTTP200/JPEG with SHA-256 `28b09204fac86c78d605c22b52590908e2e0438ecc22c31208bed6ed3d6822ae` and decodes 240×360. Restoring the folder enables the same movie UUID and resumes its saved seven-second point on the native player.

Native screenshots include `native-video-folder-location.png`, `native-video-movie-details.png`, `native-video-seasons.png`, `native-video-show-rescanned.png`, `native-video-offline.png` and `native-library-movie-playback.png`. HTTP screenshots include `http-video-movies.png`, `http-video-episodes.png`, `http-video-show-rescanned.png`, `http-video-offline.png` and `http-video-offline-restart.png`. These show generated samples using software rendering and silent audio; they do not establish hardware decoding, physical sound or HDMI behavior.

### Wide viewport and warning-copy follow-up

The private WebKit extension passed actual CSS widths **320, 375, 390, 768, 1024, 1440 and 1920** on a separate Xvfb display. Each width exercised movie search/detail, decoded poster/fanart, show/season browsing, numeric episode order, episode search and a Queue action observed in the native TV. A native rescan after unplugging the fixture verified cached artwork, disabled Resume and the Unavailable source dialog at every width; the source was restored afterward. Original native 1600×1000 and both390px HTTP sessions were preserved. Logs, layout measurements, source-error captures and settled artwork screenshots are in `private-replay-4/matrix-*`; `image-manifest.json` records paths/hashes. The disposable matrix's initial desktop44px assertion failure and its initial320px pre-paint screenshot are retained separately; corrected captures wait for paint and visibly show the decoded fanart. Parent inspection covered representative images at every required width and native movie playback. Container WebKit does not count as in-app browser qualification.

The parent found an inaccurate cached warning in the unavailable-folder screenshot: “Media is still playable.” UI-only commit `7fec38b340b73cbe866ed00e6e24cccac92319c9` (parent `e90c24c5c485e539cf1bc2c6246ac2303d232327`) removes this unconditional sentence when displaying a folder warning, keeping its skipped-sidecar count. Removing it at display time also corrects already-cached warnings while the drive remains unavailable. No scanner, data model, layout, playback or native code changed.

The frontend and Linux Bun sidecar were rebuilt using the existing script in the private container, without Cargo or shared cache mounts. New sidecar SHA-256: `ed5754c12abf2ee49f01028aa424a3e36e9de2bb8b26417fc78112b10639c3cf`. Native executable remains `e71e1969983880f6d9015dd0b484c0fdda4b866e76e3ced67cd56e20dafe4313`; its embedded native frontend is the prior43dd build. The corrected frontend was verified through the **actual reloaded390px HTTP browser** served by the new sidecar, not claimed as a rebuilt native frontend.

With the same cached source data, the corrected dialog shows **Unavailable**, six items and “Skipped 3 invalid or oversized NFO/artwork sidecar reads.” It does not claim playback availability; the offline movie still has disabled Resume. The browser test also reads the old cached API warning containing the removed sentence, proving the frontend handles retained data without re-importing sidecars. Source recovery was rescanned afterward. Typecheck, build and actual-dialog verification all exited0. Evidence: `private-replay-4/copy-correction-7fec38b/{build-identities.sha256,frontend.sha256,build.log,build-exit.txt,verify.log,process-exit.txt,verified-dialog.json,http-390-unavailable-corrected.png}`. Earlier images and binaries remain intact.

## CI budget measurements

These are existing GitHub job timestamps, with elapsed execution rounded up per Linux job. Queue delay is job start minus run creation, reported separately; it is not counted as execution. Raw run/jobs API responses and calculations are in `ci-<run>.json` and `ci-measurements.json` under the exact-head record.

| Revision / run | Path and result | Elapsed | Rounded Linux minutes | Queue delay |
| --- | --- | --- | --- | --- |
| Catalog `69e43a0` / [33998623761](https://github.com/avoid-quest/couch/actions/runs/33998623761) | Native, Cargo dependencies reused; success | 180s | 3 | 2s |
| Browsing `e90c24c` / [34000625295](https://github.com/avoid-quest/couch/actions/runs/34000625295) | Ordinary helper/documentation revision; success | 80s | 2 | 3s |
| Browsing `43dd58a` / [33998624758](https://github.com/avoid-quest/couch/actions/runs/33998624758) | Ordinary, Rust steps skipped; success | 52s | 1 | 3s |
| Browsing `43dd58a` / [33998624327](https://github.com/avoid-quest/couch/actions/runs/33998624327) | Superseded/cancelled before steps | 1s | 1 | 1s |

The successful jobs fit the agreed ordinary 2-minute/3-rounded and warm-native 3-minute/5-rounded budgets. No extra CI run was started to obtain these measurements. Warning-copy/documentation head `6a70f8f` passed [Check 34001368139](https://github.com/avoid-quest/couch/actions/runs/34001368139) in 44 seconds, one rounded Linux runner minute.

## In-app recovery qualification

On 2026-09-06, the actual Codex in-app browser paired through its form with the retained native TV's displayed code. The subagent's browser was hidden because visible IAB is unsupported there; it was not a visible app panel or a container WebKit replacement. The accepted 7fec HTTP sidecar served the page through a disposable loopback-only raw TCP relay.

At 390×844, the movie detail showed imported fields and decoded 240×360 poster and 640×360 fanart without document overflow. Explicit From start produced Playing then Finished on the real host, and the movie became Watched. Show navigation displayed two seasons and numeric episode 2 before 10. Searching `tenth` narrowed to one episode, and Queue increased the shared queue count. A 768×1024 screenshot showed the filtered result/queue feedback. At 1440×1000, season 2 displayed episode 1 before 10 with two decoded 320×180 thumbnails and no document overflow.

The existing native fixture helper made only the private source unavailable and clicked the actual native rescan. In-app Folders showed six items, the source error and the retained skipped-sidecar count without the inaccurate playable sentence. Offline movie artwork remained available while Play/Queue were disabled. Restoring the folder and rescanning returned Up to date and enabled playback. Screenshots are retained in the library_completion subagent CUA transcript only; the tool supplied no documented screenshot file export. Detailed outcomes and runtime disposition are in `.artifacts/media-library-27/cua-recovery-20260906/record.md`.

The existing success notice for the earlier Play request persisted after playback finished; the separate current player correctly showed Finished. At 11:32:35 UTC the worker reset the viewport, closed its tab and removed only the relay. Host 4100 was free. Existing replay 4 runtime/data remained, with source restored and playback finished. Shared preview/cache/T480 were untouched.

Independent final source/evidence review accepted `e90c24c → 7fec38b → 6a70f8f` without findings. The native executable still embeds 43dd. The original full attempt remains failed, and replay 4 omits administrator claim plus the complete runner's later shared restart checks. Final integration, corrected native build and full official `bun run test:linux --jellyfin`, reviewed delivery and preserved-data preview remain required.

## Integrated runner correction

The stack joined landed main `d729e162179fdfd2f1dd9a0f124e49775004079d` without conflicts. Independent integration review confirmed all three catalog and eight browsing patches were unchanged at lower `46b49262d3a0dbb4aa7873c3c505e96a863102db` and upper `9b231c26419c97907d195d81445a7d3b7f3cc5e4`. Both hosted checks passed.

The full official attempt at `9b231c2` started on 2026-09-06 at 11:51:26 UTC and exited 1 before tests or native compilation. The launcher copied the landed `scripts/package-prepare.ts` but omitted its imported `packaging/inputs.json`; Linux typechecking reported TS2307. The prior `.artifacts/linux` directory was archived before this run, and this new failure is retained separately under `.artifacts/media-library-27/fullrun-9b231c2`.

The correction includes `packaging` in the existing source-copy list and source-hash manifest. A disposable Linux container executed the corrected actual copy commands and `bun run typecheck` with no shared caches, Cargo or Jellyfin. It exited 0, and copied `packaging/inputs.json` matched the source SHA-256 `d114820abdecb007909dcbb9ceba9ff3c63343a4e0367fac53407953ff6048c4`. This proves the copy/typecheck correction only. A complete native run remains required. Evidence is in `.artifacts/media-library-27/launcher-copy-fix`.

Before this attempt, the earlier replay 4 container was stopped with `AutoRemove=false` to release memory. Its restored fixture and writable layer remain intact, and its private data directory was copied and hashed after shutdown. No retained runtime was removed.

## Official references

- [Kodi movie NFO](https://kodi.wiki/view/NFO_files/Movies), [episode NFO](https://kodi.wiki/view/NFO_files/Episodes), [TV show NFO](https://kodi.wiki/view/NFO_files/TV_shows)
- [Kodi movie artwork](https://kodi.wiki/view/Movie_artwork), [TV show artwork](https://kodi.wiki/view/TV-Show_artwork)
- [fast-xml-parser options](https://github.com/NaturalIntelligence/fast-xml-parser/blob/master/docs/v4%2C%20v5/2.XMLparseOptions.md)
- [image-dimensions API](https://github.com/sindresorhus/image-dimensions#api)
