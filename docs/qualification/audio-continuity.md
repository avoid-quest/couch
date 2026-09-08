# Queued audio continuity

Issue [32](https://github.com/avoid-quest/couch/issues/32) prepares one successor inside the existing libmpv instance. Bun retains the queue and adopts the prepared track only when native observations identify it. Queue changes, a newer Play request, Stop and shutdown invalidate preparation. Jellyfin keeps the current progress reporter until that adoption and sends its final observation once.

Preparation is limited to ordinary local and Jellyfin audio with no saved resume position, cue segment, separate audio stream or subtitles. Current and next HTTP headers must match. Other transitions keep the ordinary EOF/load path. Paths, headers and preparation messages stay on the host. Restart restores the saved queue stopped.

The adapter uses supported [playlist prefetch](https://mpv.io/manual/stable/#options-prefetch-playlist) and the default `gapless-audio=weak` behavior. It keeps the audio output for compatible consecutive formats. It does not force sample conversion or promise continuity if a slow open exhausts the available buffer. libmpv's wakeup callback drains playlist events on the GTK thread so loading hooks do not wait for the host observation interval.

## Measurement

`tests/linux/continuity.ts`, selected by `bun tests/linux/cue-run.ts --continuity`, reuses the native TV and two paired HTTP browsers. The adjacent mono 44,100 Hz FLACs decode byte for byte to a nonperiodic six-second s16le reference, split at sample 132,300. `music-audio.ts` records the actual native PulseAudio monitor, correlates both tracks against the reference, checks interior windows and retains unmatched edge regions in the loss/repetition bounds. Boundary uncertainty is 128 samples, about 2.90 ms.

The qualification environment needs `/work/bin/couch` and its matching sidecar, a clocked PulseAudio sink named `couch`, the generated fixtures at `/mnt/music-fixtures`, an actual read-only folder mount at `/mnt/continuity-mounted`, and the unsplit files at `/transition-reference`. Set `COUCH_TEST_JELLYFIN` to the private JSON returned by `startJellyfinFixture` with its `continuity` fixture paths. The runner keeps authenticated opens and lifecycle identifiers, but never writes credentials into its result JSON. A four-second delayed response and a 503 next-track response exercise slow and failed preparation.

## Retained results

The 2026-09-08 ARM64 Ubuntu software run on source `55641e773631791266e0cecee3792db24a02d25d` measured these boundaries:

| Source | Net inserted samples | Inserted silence | Whole-capture missing/repeated sample bounds |
| --- | ---: | ---: | --- |
| Local FLAC | 0 | 0 | 0 to 2,368 / 0 to 2,368 |
| Read-only mounted FLAC folder | 0 | 0 | 0 to 1,152 / 0 to 1,152 |

Both first-track tails and second-track heads matched reference sample 132,300. The wider whole-capture bounds include unmatched recording edges; these results do not establish sample-perfect output. This run passed phone Pause and another phone's Stop, then failed in the disposable Jellyfin connection fixture. Authenticated playback, delayed/failed opens and stopped restart remain pending qualification on the final source.

Native binary SHA-256 was `80606cd566a84563696a84127609f0bb36bae26249644eebcb975c2c732e791b`; sidecar SHA-256 was `60d7bae9890a5b62a6d428a0ee706e0e0ce683c1251c77220c74a46a6f451f2c`. Local capture SHA-256 was `6a5d56b939a1dd53713838f6db3f0ec678723873a7cc0066f48d870550e56247`; mounted capture SHA-256 was `97de986bd62eae2f86148b420a1d8733b40a28934e138eb82254888c9079c3f2`. Full JSON, WAVs, screenshots and the failed fixture log remain under `/tmp/couch-gapless-20260908/.artifacts/attempt2` on the qualification host.

Physical TV/speaker output needs a separate approved device window and recorded loopback or capture compared with the same reference and uncertainty method. This PulseAudio monitor run qualifies neither HDMI/speaker timing nor other sample rates, formats, account configurations, cue segments or public web sources. Crossfade is outside this change.
