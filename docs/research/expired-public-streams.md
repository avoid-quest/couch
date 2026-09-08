# Expired public streams

Research for [Recover an expired public stream without replaying stale intent](https://github.com/avoid-quest/couch/issues/39). The product requirements and native dependencies remain on that issue. This document records the provider investigation and the checks needed before implementing recovery.

The research base is `b7031b9258b385371e1f09df0f325a19c3e2c093`. Its [main CI run](https://github.com/avoid-quest/couch/actions/runs/33996451171) passed. The prerequisite [CI gate](https://github.com/avoid-quest/couch/issues/43#issuecomment-5555040631) and its native prerequisite #44 were closed when checked on 2026-09-06 Europe/Rome. The [gate's landed validation](https://github.com/avoid-quest/couch/actions/runs/33993872653) also passed. No dependency was removed.

## Current finding

On 2026-09-08 the original retained Bandcamp selected MP3 returned HTTP 410 twice. A fresh anonymous extraction returned the same track, format, duration and media path, with HTTP 206 and the same first 4,096 media bytes as the original successful probe. This establishes a naturally aged selected-transport failure with a working refresh. The provider-scoped recovery implementation uses a past Bandcamp `ts`, a bounded same-URL HTTP 410 confirmation, and a fresh same-media transport. It does not treat an arbitrary 403, a master token, or an ordinary EOF as expiry.

The earlier Twitch result below remains negative for selected-transport expiry. A controlled native expiry transition now passes. Live-provider recovery and the remaining controller/restart checks are still outstanding.

## Initial investigation, 2026-09-05

Twitch LofiGirl reproduced a real master-token expiry, but the selected transport stayed healthy. The unchanged master returned HTTP 200 before its stated 20-minute deadline and HTTP 403 with `nauth_token_expired` afterward. Couch's exact selected 720p child playlist continued returning HTTP 200 with an advancing live window, including 90 seconds after that deadline. A fresh anonymous extraction of the same broadcast succeeded. This sample does not qualify a failure of the transport Couch actually loads. Do not implement a recovery trigger from this master TTL.

Bandcamp returned public audio with a timestamp one day ahead. Public RaiNews live and VOD returned playable transport responses without an expiry hint in the selected URLs. A concrete expired loaded transport is still unproven. None of the probes qualifies native recovery, decoded playback or sound.

## Naturally aged Bandcamp transport, 2026-09-08

The new worker started from `351eb9ee52f9fea2b91c4db92fff9d042a1c95eb` in `/tmp/couch-public-expiry-20260908`. It copied the original private extraction without changing its URL or headers. The bounded probe script is unchanged. Fresh extraction used the current Couch worker, Bun 1.4.2 and the official standalone macOS yt-dlp 2026.08.19 executable. Its SHA-256 `0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202` matched the release's checksum list. The [official latest release](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19) still identified that version on this date.

| UTC on 2026-09-08 | Selected transport result |
| --- | --- |
| 00:48:09.251 | Original URL, age 179,614 seconds, HTTP 410 in 118 ms, 409-byte generic Gone response |
| 00:49:00.799 to 00:49:09.825 | Fresh extraction of Mastodon - Hail to Fire, track `2584466013`, `mp3-128`, duration 120.79 seconds, Best quality, 9.025 seconds |
| 00:49:09.835 | Fresh URL, HTTP 206 in 84 ms, bytes 0–4095 of 2,245,808 |
| 00:49:09.930 | Unchanged original URL again, HTTP 410 in 86 ms, 410-byte generic Gone response |

The original URL SHA-256 remains `940511e72bfbedbb0f3c9a64cad323646b42bf1c0082202584ea2a8b276ac475`. The fresh URL hash is `517d6e422eb636a3ac902501d56f942623da3b0dcc892811a57e6413852e9a9a`; its timestamp is `1788914949`. Origin and media pathname are identical. The fresh media range SHA-256 is `c17790851889ead51ddd2df14955a9da427b2212b93ee29fd2e0ff57b9da7b89`, matching the original successful range. The generic 410 body does not itself assert token expiry. Expiry is inferred from the previously successful URL's natural ageing beyond its timestamp, its repeated rejection, and successful fresh access to the identical media.

The three new response records retain 4,915 bytes under `.artifacts/expiry/` in the new worktree. Extraction JSON and response bodies remain mode 0600 inside the mode 0700 directory. `provenance-current.json` records the copied extraction, worker-probe and tool hashes. No original evidence was overwritten. No signature, token, header, provider response or host clock was modified, and no native player ran during these response probes.

Recovery is restricted to the observed Bandcamp MP3 case. Its confirmation request has a five-second deadline, requests one byte, rejects redirects, cancels the response body and honors playback cancellation. Fresh extraction uses the existing worker limits and original quality. Changed media path, origin or duration, an unchanged URL, or an already stale replacement is terminal. Provider/account/DRM extraction failures retain their existing sanitized errors. The session removes the private recovery callback before native load and never includes it or transport credentials in controller snapshots.

## Controlled native transition, 2026-09-08

Source `874d1bd` passed the controlled test in the actual Tauri app with its compiled Bun sidecar, libmpv and two paired WebSocket controllers. Two independent HTTP browsers also paired at 390px through the real form. The disposable Ubuntu ARM64 container used Bun 1.4.2, Rust 1.98.1, WebKitGTK 2.52.6, libmpv API 2.2.0, software rendering and a PulseAudio null sink. This establishes software playback behavior, not physical audio output.

The fixture generated a 300-second MP3 and served it slowly over TLS. Its first URL worked before its eight-second deadline, then the connection closed and the unchanged URL returned HTTP 410. A test extractor supplied Bandcamp-shaped metadata for the local fixture; production source classification, bounded HTTP confirmation, session handling and native decoding were unchanged. The fixture used a disposable certificate and container-only hostname. It was not a public Bandcamp request.

The initial qualified attempt correctly failed. libmpv retried the expired range and then reported ordinary `ended` at 18.5898 seconds of a 300.024-second file. The revised handler therefore admits a premature VOD EOF to the same expiry confirmation. EOF alone still cannot trigger a replacement; normal completion advances the queue, and a second premature EOF after recovery leaves a terminal error.

The successful run advanced before expiry, confirmed the same URL's HTTP 410 at 01:10:13.973 UTC, and extracted exactly one replacement at 01:10:15.492. The second controller selected pause during resolution. Native playback resumed at the retained position with pause already applied, stayed within 0.5 seconds over a one-second pause check, then advanced after Resume from the first controller. The second controller stopped it. The source regression suite separately exercises all cancellation paths, late success and rejection, metadata/quality privacy, failed queue writes, pause races, retry exhaustion and stopped session construction.

The app SHA-256 is `de6799cc561fb5d31d8cda9e384c0b3205aa94435fca728fd819bd0863131152`; the sidecar SHA-256 is `9121cca9a2f79400ad215164a4bee147579668a351d2f55b37ebfaf46cb5dd20`. Private evidence remains in the new worktree's `.artifacts/native/`, including `early-end-run.log`, `expiry-checks.json`, `requests.jsonl`, the generated media, screenshot, fixture scripts and copied binaries. The container is `couch-expiry-20260908`, stopped between coordinated runs; its target cache is separate from every other worker's cache.

Ten native protocol tests passed. Three preliminary runner attempts failed before playback because copying binaries after Cargo tests replaced the Tauri-built executable with a differently configured binary. Their logs remain. The corrected runner copies the Tauri build before other Cargo commands and embeds a real source revision from a Git bundle. No production change was needed for those fixture failures.

## Probe provenance and limits

Probes ran on macOS 26.6.2 arm64 with Bun 1.4.2 and Python 3.12.14. They used the unchanged [bounded Couch worker](../../src/server/yt-dlp.ts) and its normal extraction flags. The Python runtime launched the official portable yt-dlp executable instead of the packaged Linux binary. Deno was unnecessary for these extractors. No native player ran during this phase.

yt-dlp 2026.08.19 was the [latest official release](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19) when queried. Its source commit is `3a08beaf031ab68f966401ead017ac81fe8486cf`. The portable executable SHA-256 is `1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6`, verified against the release's `SHA2-256SUMS` before execution.

Each extraction had the worker's 30-second total deadline, ten-second socket timeout, one extractor retry, 8 MiB output limit and 64 KiB error limit. Media download, user configuration, plugins, browser cookies, disk cache and remote components were disabled. Quality selection matched the product resolver. Each separate HTTP probe had a twelve-second deadline. Media requests used `Range: bytes=0-4095`; manifest reads stopped at 256 KiB. The probe canceled the response reader after the limit. These are response inspection limits, not decoded media measurements.

Private evidence is under `.artifacts/expiry/` in the owning worktree `/Users/devit/Code/couch-media-expiry`. The directory is mode 0700; extracted URLs, headers, tokens and response bodies are mode 0600 and Git-ignored. `provenance.json` records source and probe hashes. `*.summary.json`, `probes.jsonl` and `age.jsonl` contain sanitized identities, UTC timestamps, elapsed times, statuses, limits and body/URL hashes. Raw extraction and manifest files remain private. Reproduction scripts there are `extract.ts`, `probe.ts` and the finite `age.ts` observer. They start no server and use no shared port, container, cache, browser or target machine.

## Public samples

The [existing provider qualification](providers.md#public-provider-checks) already exercised these sources in Couch. That older native success establishes the choice of provider and sample; it does not qualify the new recovery behavior.

| Public item | Extraction, UTC on 2026-09-05 | Selected transport | Initial bounded response |
| --- | --- | --- | --- |
| [Mastodon - Hail to Fire](https://relapsealumni.bandcamp.com/track/hail-to-fire), Bandcamp track `2584466013`, duration 120.79 s | 22:54:34.943 to 22:54:36.463, 1.520 s | `mp3-128`, HTTPS, `t4.bcbits.com`, Best | 22:55:44.137, HTTP 206 in 115 ms; 4,096 bytes of a 2,245,808-byte response |
| [LofiGirl](https://www.twitch.tv/lofigirl), Twitch broadcast `317638324066`; extractor title `LofiGirl (live) 2026-09-06 00:54` | 22:54:41.879 to 22:54:43.138, 1.260 s | `720p`, HLS, `euc12.playlist.ttvnw.net` | 22:55:44.260, child HTTP 200 in 488 ms, 5,714 bytes; master HTTP 200 in 112 ms, 9,320 bytes |
| [Rai News 24 live](https://www.raiplay.it/dirette/rainews24), extractor title `Diretta di Rai News 24 2026-09-06 00:55`, item `d784ad40-e0ae-4a69-aa76-37519d238a9c` | 22:55:44.158 to 22:55:45.264, 1.106 s | `hls-2536`, HLS, 720p cap | 22:56:05.420, child HTTP 200 in 62 ms, 589 bytes; master HTTP 200 in 43 ms, 377 bytes |
| [RaiNews24 VOD](https://www.raiplay.it/video/2026/09/RaiNews24-b7db7659-d7db-42ef-89f9-e7bdd2a04b86.html), duration 7,191 s | 22:55:45.272 to 22:55:46.676, 1.404 s | `https-2400`, HTTPS relinker, 720p cap | 22:56:05.535, HTTP 206 after redirect in 316 ms; 4,096 bytes of a 2,389,158,184-byte response |

The Bandcamp timestamp `1788735276` corresponds to 2026-09-06 22:54:36 UTC. Its name `ts` and a signed URL are insufficient to establish an enforced expiry. The initial response also had a long cache age. Keep the exact original URL for a later same-header range probe, then compare a fresh extraction. Do not shorten or otherwise alter its signature or timestamp. The upstream [Bandcamp extractor](https://github.com/yt-dlp/yt-dlp/blob/3a08beaf031ab68f966401ead017ac81fe8486cf/yt_dlp/extractor/bandcamp.py#L159) reads the public page's track transport; it does not declare a TTL contract.

The Twitch master token declares `expires=1788650082`, or 2026-09-05 23:14:42 UTC. The selected child URL hash is `77c91b89dd38f93c85ecc1ce6941a0f4e6c3f180e54b143363c63b5703ab23bd`. The master URL hash is `e1e0a9434ba36270ee2b7ac13ac35d92b640a4efe76cc1e5682de56c0e065826`. The finite observer completed at 23:16:14.158 UTC. Couch's unchanged public catalog adapter independently returned LofiGirl live at 23:01:35.149 UTC with broadcast title `lofi hip hop radio 📚  beats to relax/study to`.

| Original token timing | Child response | Master response |
| --- | --- | --- |
| 23:04:26 UTC, age 585 s | HTTP 200, sequence 71,509, 148 ms | HTTP 200, 148 ms |
| 23:14:12 UTC, 30 s before expiry | HTTP 200, sequence 71,802, 147 ms | HTTP 200, 162 ms |
| 23:14:57 UTC, 15 s after expiry | HTTP 200, sequence 71,824, 177 ms | HTTP 403, `nauth_token_expired`, 136 ms |
| 23:16:12 UTC, 90 s after expiry | HTTP 200, sequence 71,862, 149 ms | HTTP 403, same error and response hash, 129 ms |

Both failed master responses state `expired token`. Their 1,630-byte JSON bodies share SHA-256 `1e0ec4d8afd4e31398f3877dc444c2891d3ac0b5f9a24fb5f242eaeadf481f3b`. Fresh extraction ran from 23:16:12.296 to 23:16:13.568 UTC, 1.272 s. It returned the same broadcast ID `317638324066`, 720p HLS and new transport hashes. Its child returned HTTP 200 in 462 ms and its master HTTP 200 in 118 ms, with a new stated expiry at 23:36:13 UTC. The original child stayed current through the complete observation window. This is an explicit negative qualification result for loaded-transport expiry, not proof that Twitch transports never expire.

Twitch's [extractor](https://github.com/yt-dlp/yt-dlp/blob/3a08beaf031ab68f966401ead017ac81fe8486cf/yt_dlp/extractor/twitch.py#L191) obtains an anonymous playback token, requests the master and selects a child. It separately recognizes subscriber-only entitlement errors. A master rejection with a continuing child is evidence against using this sample to qualify an active transport failure. An unavailable channel or subscription requirement is terminal for this ticket. HLS clients ordinarily reload a live media playlist and follow its changing segment window, as specified in [RFC 8216](https://datatracker.ietf.org/doc/html/rfc8216#section-6.3.4). An old segment disappearing from that window does not establish expired transport authorization. These sparse probes also do not reproduce an active player's request cadence.

The RaiNews VOD resolver returns a relinker address; following it already obtains a current media location. Its successful redirect is not evidence of expiry in the URL Couch stores for the active load. Public RaiNews remains within the accepted public RaiPlay scope. This work requires no protected title, account, DRM integration or regional workaround.

## Read-only implementation findings

These findings refer to the immutable research base. Re-read the landed preference and connection changes before implementation.

| Existing behavior | Recovery implication |
| --- | --- |
| [`hub.ts`](../../src/server/hub.ts) resolves `web:` entries through `resolveWebMedia` immediately before native load. [`web-media.ts`](../../src/server/web-media.ts) selects HTTP/HLS or the DASH manifest and keeps credentials in the private load. | Reuse the same resolver and queue quality. Recovery needs a fresh transport, not another queued item or another extractor pool. Retain any eligibility evidence privately. |
| [`yt-dlp.ts`](../../src/server/yt-dlp.ts) bounds workers, output, deadlines and cancellation. It distinguishes DRM, region, account, offline and runtime errors, then returns a generic extraction failure. | An extraction failure is not an expired transport. Keep these terminal categories and do not infer expiry from a generic 403 or a native error string. |
| [`session.ts`](../../src/server/session.ts) retires playback IDs and aborts resolution for Stop, replacement, shutdown and player loss. Its explicit play path creates a new ID, resets position and enriches metadata. | Reusing `play()` unchanged would lose the observed web VOD position and can change an automatic title during retry. A recovery must retain entry identity, metadata and current choices while retiring the failed native load. |
| Queue writes commit before broadcast. Queue move, append and removal of another entry currently do not invalidate play intent. | The ticket's newer queue-change cancellation needs explicit coverage for these successful mutations during recovery. A rejected mutation must not cancel valid playback intent. |
| Play reservations can outlive catalog lookup. Radio alone has retry scheduling, with 1/2/4-second delays and an earned fresh budget after advancing playback. | Reserve and recheck intent at every asynchronous recovery boundary. Keep webpage recovery limited to one replacement transport per explicit play; retain radio's separate policy. |
| [`player.rs`](../../src-tauri/src/player.rs) keeps the previous observed position when polling fails and reports a generic error. The native load currently starts with `autoplay: true`. | Capture the last valid native position and paused state before replacing the failed generation. Restoring pause after autoplay is too late to guarantee no unwanted playback. |
| [`libmpv2` events](../../src-tauri/vendor/libmpv2/src/mpv/events.rs) convert an `end-file` error into a library error. The plugin ignores successful `EndFile` reasons and separately reads `eof-reached`. | The current observation protocol carries no HTTP response status. Preserve error versus ordinary EOF and validate the actual failure signal before choosing a minimal protocol change. |
| The host owns one [`Jellyfin reporter`](../../src/server/jellyfin.ts). Web sources do not create one. Session construction restores the queue with no active item. | Recovery must not create an upstream reporter or alter unrelated reporting. Retry state stays ephemeral so process restart remains stopped. |

The [mpv C API](https://github.com/mpv-player/mpv/blob/f5bcfb195412e0ca733eac2e850879cd3b1ded18/include/mpv/client.h) defines a generic loading error, not a dedicated expired-HTTP-URL error. The [mpv event documentation](https://mpv.io/manual/stable/#list-of-events) also warns that EOF can include an incomplete file or broken connection. Neither an EOF event nor a generic loading error establishes expiry. The loaded transport's observed provider behavior must support the classifier.

## Qualification design

Implement only after the parent releases the playback join. The smallest eligible recovery is one fresh resolution after a demonstrated transport expiry. A source with uncertain eligibility keeps the existing terminal result. The final classifier must be justified by an actual selected-source failure, its earlier success, provider-specific expiry evidence, and a successful fresh resolution of the same public item. A changed URL alone is insufficient.

1. Preserve the original failed load's last finite observed VOD position, the user's current paused/playing choice, entry ID, public source, metadata and quality. For an explicitly qualified live source, resume at the fresh source's supported live edge without carrying over an arbitrary old numeric offset. Verify that live-edge behavior through the native app before claiming it.
2. Publish a sanitized retry status with attempt 1 of 1. Resolve privately through the existing bounded worker. Check the active intent and queue identity again before dispatching the replacement load. A newer successful Stop, replacement, Next, queue mutation, reservation or shutdown cancels pending work and ignores its late success and failure.
3. Preserve current playback settings from the landed preference contract. A paused recovery must start paused. Keep a single retry budget across loading, playback and repeated native observations; successful recovery does not earn another automatic attempt. A second failure leaves a clear terminal message and manual Play starts a new explicit intent.
4. Extend the existing session and worker regressions with controlled time and deferred promises. Cover queue move/append/removal, failed queue writes, stale observations, pause changes during recovery, rejection categories, repeated expiry, cancellation before and after resolution, same metadata/quality, credential privacy, and stopped restart. Retain the existing radio, play-intent, worker-deadline, source-reset and upstream-reporter regressions.

The controlled native fixture must expire a formerly working transport, not inject an arbitrary error. Give the generated public HTML page a first signed HLS URL that serves valid media before its deadline. Keep later segments unavailable to read-ahead until the timed expiry step, then return the fixture's documented expired response for that same issued URL. Re-resolving the unchanged page issues a second valid transport for the same media. Keep the gate shorter than the native network timeout and record the requests and response times. The fixture must show actual advancing native position before expiry and exactly one fresh resolution/load afterward. Use a fresh uncached position if exercising range-based VOD, and record the server request proving it was uncached. Account, DRM, unavailable-page and ordinary transport failures are separate negative controls.

At a VOD position beyond the initial frame, retain the final pre-failure native observation and require the recovered first observation to be within two seconds. A paused case must remain paused without advancing more than 0.5 seconds after native load settles. Then resume through the other remote and require advancing position and decoded output. For each cancellation case, hold the fixture's re-resolution response, issue the newer command from the second remote, release the old response, and verify no old native load or queue mutation occurs. Repeat with a late rejection.

For real-provider qualification, start from the public page in the actual Couch UI with two paired controllers. Record the provider title, extraction version, selected quality, source and binary hashes, native/mpv runtime, UTC issue/expiry/load times, observed tracks, position and paused state. Age the issued transport naturally. Reproduce its actual native failure and fresh resolution under the same public authorization, without editing the URL, token, headers or host clock. If the selected child remains healthy after its master expires, this run does not demonstrate recovery of an expired loaded stream. A longer observation or another existing public sample is then required.

## Acceptance evidence still required

| Issue criterion | Evidence now | Completion evidence still required |
| --- | --- | --- |
| Qualified expiry, fresh resolution and bounded retries | Naturally aged Bandcamp selected transport rejects twice; fresh identical media works; provider-scoped classifier and one-retry source tests pass | Live-provider native recovery and its failure limits |
| VOD position or supported live edge; current choice and cancellation | Controlled native VOD recovery starts paused at the retained 17.4569-second position; resumes through the other controller; source tests cover cancellation and newer choices | Remaining native cancellation/controller journeys; no live-edge recovery support is claimed |
| Queue, metadata, quality and reporter; clear remote status; stopped restart | Typecheck, build, 154 relevant source tests and 1,005 assertions pass; three unrelated opt-in extractor tests skipped; focused review accepted | Actual HTTP recovery controls, reconnect and process restart without autoplay |
| Controlled transition and affected public provider in the app | Controlled TLS MP3 expiry passes with actual app, two WebSocket controllers and two paired HTTP browsers | Same-binary native recovery of the naturally aged public transport; remaining layout screenshots |

The dated Bandcamp observation above completes the formerly pending natural-ageing response probe. Preserve the original and new private artifacts across sessions. Native public-provider recovery remains a separate gate; do not substitute the local controlled fixture for it.

The coordinated native run must follow [tests/linux/README.md](../../tests/linux/README.md), using the actual Tauri app, its Bun sidecar and native observations. Keep screenshot and observed-flow evidence for HTTP widths 320, 375, 390, 768, 1024, 1440 and 1920, plus the native 1600x1000 TV. Show retry, final failure, Stop, recovery controls and independent browsing. Disconnect one controller during recovery and reconnect it to the current snapshot; restart the process and verify persisted queue/quality with stopped playback on both controllers. Keep the mounted VideoStage and existing compact shadcn presentation.

Preview rebuilding requires a named coordination window and [tests/preview/README.md](../../tests/preview/README.md). Preserve its data volume. Software rendering and the silent sink establish software behavior only. This ticket has no new request for account credentials or protected RaiPlay content. Native/preview access and the implementation join remain coordination needs; an affected public transport remains an evidence gate. The research document does not complete or close #39.
