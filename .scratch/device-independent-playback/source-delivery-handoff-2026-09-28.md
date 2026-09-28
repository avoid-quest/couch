# Source delivery: stop-point handoff

The user requested this pass stop after the current changes are built and pushed.
This document records evidence and remaining work; [the product contract](../../docs/playback-product.md)
remains the single active specification. Do not interpret the PR, build or tests as
completion. Latest user observation: **mobile is not working**.

## Stack and runtime

- Worktree: `/Users/devit/.t3/worktrees/modern-kodi/t3code-7ba35ec6`.
- Owning layer: `t3code/playback/source-delivery`, [PR #643](https://github.com/avoid-quest/couch/pull/643),
  above [app qualification #642](https://github.com/avoid-quest/couch/pull/642).
- Built standalone app: `src-tauri/target/debug/bundle/macos/Couch Mixer.app`,
  bundle ID `quest.avoid.couch.mixer`; library `http://10.10.2.96:4100`.
- Persistent library/pairings: `~/Library/Application Support/quest.avoid.couch.mixer`.
  Do not replace these to make a test pass. Browser pairing is origin/profile scoped.
- T3 browser `tab_18` is the paired Mac browser. The phone was disconnected during
  this pass. The older Couch Playback instance/Core on port 4414 is unrelated;
  preserve it, all prior receipts, stashes, archives and secondary worktrees.

## Architecture blocker: required media work on Core

The user clarified that efficient direct client playback is required, and that Core
must not be required to stream actual media to clients. **The implementation still
violates this:** `sendspin-playback.ts` starts `pcm-decoder.ts` on Core and distributes
48 kHz, stereo, 16-bit PCM through Sendspin, per Playback. That is 192,000 bytes/s
per listener before transport overhead; this is format arithmetic, not a resource
measurement. No Core video relay was added. The browser fetches picture/media directly.

Do not solve Twitch/mobile by adding a Core relay. Revisit source/producer placement
using maintained Sendspin facilities and capable selected clients, while preserving
the optional Core host and external-server capabilities. No replacement architecture
has been implemented or qualified in this layer. Additional timestamp plumbing below
does not settle that design question.

## What changed

- Web extraction retains audio-only classification (Bandcamp's extensionless MP3
  had incorrectly required a picture screen).
- Browser destinations choose compatible upstream renditions instead of receiving
  the native player's split-media command. Known generic extractor headers are
  omitted for browser delivery; required custom headers still fail closed.
- HLS uses maintained hls.js 1.7.3, including software AES over ordinary LAN HTTP;
  DASH still uses Shaka. Split HLS gets a client Blob master referencing upstream
  audio and video. Silent shared picture loads drop the separate audio URL.
- Explicit live metadata prevents finite-duration/VOD progress handling of live
  sources. Live PCM captures the first source PTS from the same FFmpeg process;
  native silent live picture uses mpv `rebase-start-time=no`, and the browser maps
  hls.js `INIT_PTS_FOUND.initPTS / timescale` to its media element timeline.
- Packaging stages FFmpeg beside ffprobe on desktop targets and supplies
  `COUCH_FFMPEG`, fixing an undeclared dependency on the development machine's PATH.
  Mac retains the existing `ffmpeg` formula; no ffmpeg-full switch was made.

## Observed through the built app

Build `84e926c0`, standalone Mac hosting its normal saved library; Mac native and
paired T3 browser selected throughout. Find → paste link → Webpage → Play was used.
These are short software/visible-output checks, **not physical mobile acceptance**.

| Source | Observation | Limit |
| --- | --- | --- |
| Bandcamp, `blazo.bandcamp.com/track/intro` | Shared SDK stream started; 19-second track advanced and ended. No picture screen required. | Mac fader was muted; no fresh physical audibility measurement. |
| YouTube, `youtube.com/watch?v=YE7VzlLtp-4` | Shared audio SDK active; browser showed Big Buck Bunny, 1280×720, advancing frames/time. | Short sample; full quality/track/performance matrix untested. |
| StreamingCommunity, `/it/watch/7989` | Browser picture advanced with both devices selected; forward seek resumed at 42 seconds. Mac participant subsequently changed shared media through Find. | One uncaught-promise console event occurred during replacement; no stack captured. Direct/mobile Move and alternate tracks unqualified. |
| Twitch, `twitch.tv/lofigirl` | **Failed** before picture preparation: playlist CDN returned HTTP 403. | Same extracted URL returned 200 without Origin and 403 with Couch LAN Origin in isolated HTTP probes. All extracted formats were HLS. No relay/fallback added. |
| RaiPlay, `/dirette/rainews24` | Shared PCM started but picture stalled at 24 frames with repeated play/pause AbortErrors. | This motivated the source-PTS mapping follow-up; see PR for the final built check. |
| Radio / direct HLS | Earlier Sygma and Mux journeys remain in the shared-video observations. | Not re-qualified across every device/provider transition in this pass. |
| DASH | Not accepted. | Installed Mac FFmpeg 9.0.2 lacks the DASH demuxer; a generated MPD failed the isolated PCM probe. Bundling that binary does not add DASH support. |

The first native window launch after replacing the running app bundle was blank;
Cmd-R restored it. A shared Play before the reload failed with “did not confirm audio
output”; retry afterward worked. Record this as a restart/build-replacement issue,
not a successful seamless restart. A T3 click on Player → Find while its auto-hidden
header was `inert` did nothing; an ordinary pointer wake is needed before judging
the navigation handler broken.

Earlier isolated FFmpeg probes decoded ten seconds from YouTube, Twitch, Bandcamp,
RaiPlay and StreamingCommunity. Those prove extraction/PCM on this development Mac,
not built-app playback, mobile support, cleanup or physical synchronization. Retained
receipt: `/tmp/couch-provider-pcm-20260928.json` (host Bun 1.4.0, not the pinned gate).

## Remaining work, in order

1. Resolve mandatory Core media processing against the updated contract before
   extending this architecture. Measure efficient client paths and resource use.
2. Reproduce the user's mobile failure through actual setup and source playback.
   No mobile browser/version/error was established in this final pass. Native-HLS
   fallback has no hls.js PTS event, so shared-live mapping is not qualified there.
   Generated split-HLS Blob playback on iOS is also unqualified.
3. Qualify Twitch through a supported direct client path. Native picture + shared
   audio remains a candidate, not an observed result here. Native browser HLS may
   avoid CORS requests, but capability advertisement alone is insufficient. Official
   Twitch embeds require an SSL parent and lack live seek/current-time control;
   do not assume they fit the shared timeline.
4. Check live discontinuities, timestamp wrap, meaningful live Move, long-running
   playback, source replacement cleanup and A/V alignment. Current first-PTS mapping
   is not evidence of those guarantees.
5. Verify packaged Mac/Windows/Linux helpers and DASH capability on actual packages.
   Packaging changes have not had fresh act/package qualification; no hosted workflow
   was dispatched. Follow docs/ci.md before dispatch. Keep PRs draft; do not merge/release.
6. Finish the broader active acceptance matrix, especially tracks, quality caps,
   direct↔shared moves, revocation, concurrent shared Playbacks and performance.
   Jellyfin/local files remain excluded from this source pass by user instruction.

Official references used: [hls.js](https://github.com/video-dev/hls.js/blob/master/README.md),
[FFmpeg ashowinfo](https://ffmpeg.org/ffmpeg-filters.html#ashowinfo),
[mpv timestamp rebasing](https://mpv.io/manual/master/#options-rebase-start-time),
[Twitch embedding](https://dev.twitch.tv/docs/embed/).
