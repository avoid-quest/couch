# Queued audio continuity

Issue [32](https://github.com/avoid-quest/couch/issues/32) prepares one successor inside the existing libmpv instance. Bun retains the queue and adopts the prepared track only when native observations identify it. Queue changes, a newer Play request, Stop and shutdown invalidate preparation. Jellyfin keeps the current progress reporter until that adoption and sends its final observation once.

Preparation is limited to ordinary local and Jellyfin audio with no saved resume position, cue segment, separate audio stream or subtitles. Current and next HTTP headers must match. Other transitions keep the ordinary EOF/load path. Paths, headers and preparation messages stay on the host. Restart restores the saved queue stopped.

The adapter uses supported [playlist prefetch](https://mpv.io/manual/stable/#options-prefetch-playlist) and the default `gapless-audio=weak` behavior. It keeps the audio output for compatible consecutive formats. It does not force sample conversion or promise continuity if a slow open exhausts the available buffer. libmpv's wakeup callback drains playlist events on the GTK thread so loading hooks do not wait for the host observation interval.

## Measurement

`tests/linux/continuity.ts`, selected by `bun tests/linux/cue-run.ts --continuity`, reuses the native TV and two paired HTTP browsers. The adjacent mono 44,100 Hz FLACs decode byte for byte to a nonperiodic six-second s16le reference, split at sample 132,300. `music-audio.ts` records the actual native PulseAudio monitor, correlates both tracks against the reference, checks interior windows and retains unmatched edge regions in the loss/repetition bounds. Boundary uncertainty is 128 samples, about 2.90 ms.

The qualification environment needs `/work/bin/couch` and its matching sidecar, a clocked PulseAudio sink named `couch` with flat volumes disabled, the generated fixtures at `/mnt/music-fixtures`, an actual read-only folder mount at `/mnt/continuity-mounted`, and the unsplit files at `/transition-reference`. Set `COUCH_TEST_JELLYFIN` to the private JSON returned by `startJellyfinFixture` with its `continuity` fixture paths. The runner keeps authenticated opens and lifecycle identifiers, but never writes credentials into its result JSON. A four-second delayed response and a 503 next-track response exercise slow and failed preparation.

## Retained results

The final ARM64 Ubuntu software run passed 84 native/HTTP checks from 02:13:21 to 02:15:24 UTC on 2026-09-08. It reused the sound-output worker's exact combined source `4a166ef1d236e335b5cac53447dcd6c77dc937d6`, which includes this continuity implementation, expiry recovery and sound-output controls. The clean debug build used Bun 1.4.2 and the existing `couch-library-native:20260907-2f89ec1` image, ID `sha256:d6ee346fcadb8a466236d0e3dd174895c6be3e2d10387a3fbfb99fb2aecde798`. The native container used 4 GiB alongside the 2 GiB official Jellyfin 10.11.11 fixture. Both were removed afterward.

| Source | Net inserted samples | Inserted silence | Whole-capture missing/repeated sample bounds |
| --- | ---: | ---: | --- |
| Local FLAC | 0 | 0 | 0 to 448 / 0 to 448 |
| Read-only mounted FLAC folder | 0 | 0 | 0 to 1,280 / 0 to 1,280 |
| Authenticated Jellyfin FLAC | 0 | 0 | 0 to 1,792 / 0 to 1,792 |

All first-track tails and second-track heads matched reference sample 132,300. The wider whole-capture bounds include unmatched recording edges; these results do not establish sample-perfect output. The mounted source was a read-only `virtiofs` mount verified by `findmnt`, not a NAS protocol qualification.

The four-second delayed Jellyfin open exhausted the buffer. It measured 57,507 net inserted samples, 1,304.014 ms, and 59,553 inserted-silence samples, 1,350.408 ms. Missing samples were bounded at 0 to 3,582 and repeated samples at 0 to 1,536, with the same 128-sample boundary uncertainty. Slow-source continuity is not qualified.

The failed successor remained the current queue error with a useful message, and Next worked. Removing the delayed successor let the current track finish without late autoplay. One actual phone paused playback and another stopped it; both retained the same queue and reconnected stopped after a desktop restart. All native Jellyfin opens retained host authentication. The normal run reported exactly one start and one stop for the preflight and each measured track, with separate session identities. Source tests also cover reorder, queue replacement, a newer pending Play and canceled preparation without retiring the active Jellyfin reporter.

Native SHA-256 is `b21a73b3b524a03bf72da5c872f5bb309b665e29490d77bda90b68e35b163a62`; sidecar SHA-256 is `c67350aa9634748aeeb5b62c756bd5c6a4f8e0b637f26ccfbea28f4c13b3ea1b`.

| Capture | SHA-256 |
| --- | --- |
| Local | `719fd7205eb81b15cf6c182bdf4ae8d41baaee8d2a39ef9fcda1e5057e9c8e8d` |
| Mounted | `158c7d68748af9840a6b11e11ee172399ff2bddc7958a656d5a3613c3cf7f0f5` |
| Jellyfin | `465b7e59da8a17e84e60754caca2496ec2f68b4174cb6cf34917ca1ba96111c4` |
| Delayed Jellyfin | `3d0da90635f47e5e813d24237a20ceea6200ae4b767a832edcdea530e43c4758` |

Full JSON, WAVs, screenshots, lifecycle reports, fixture scripts and binary manifests remain under `/tmp/couch-gapless-20260908/.artifacts` on the qualification host. Earlier attempts remain in `attempt1`, `attempt2` and `attempt3`. The last failed attempt caught a raw libmpv load error that bypassed the end-file event handler; the adapter now maps that supported error code to useful guidance. An actual missing-file native regression passed on the combined build.

The clean gapless delivery source passed 63 Bun tests with 285 assertions, app TypeScript checks and strict Linux runner checks. Its native build passed 29 app Rust tests; the existing native adapter regression suite had passed before the final integration. A focused continuity review and the final error-path review found no remaining actionable findings.

Physical TV/speaker output needs a separate approved device window and recorded loopback or capture compared with the same reference and uncertainty method. This PulseAudio monitor run qualifies neither HDMI/speaker timing nor other sample rates, formats, account configurations, cue segments or public web sources. Crossfade is outside this change.
