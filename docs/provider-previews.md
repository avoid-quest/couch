# Provider previews

Preview availability is a source capability. Core accepts a bounded storyboard
or a declared timed-image manifest; the client has no provider allowlist.
Preview metadata is optional, independent of stream format selection, and never
blocks playback. A missing descriptor, cue gap or unreadable image leaves the
timestamp. Posters never stand in for scene previews, and Couch does not extract
frames or start another decoder.

## Discovery and normalized timing

- yt-dlp `mhtml` formats supply grids. YouTube uses their declared interval;
  Twitch's small plugin retains the native frame count and interval from the
  storyboard JSON upstream already downloads. A partial last sheet keeps its
  actual number of frames. Tiles nearest 160 pixels are preferred.
- StreamingCommunity and AnimeUnity retain the literal `window.thumbnailsUrl`
  from player HTML their adapters already read. No script is evaluated.
- RaiPlay's plugin retains `vtt_poster_thumbs_url` from the existing relinker XML.
  A page without this field has no preview; no sibling URL is guessed.
- Declared WebVTT loads lazily on the first authorized preview read. Relative
  image URLs use the final manifest response URL. Cues may supply full images
  or pixel `xywh` crops, fractional boundaries and gaps. Overlapping cues and
  mapped transport clocks are rejected rather than assigned an invented offset.

The public `PlaybackPreview` union contains a compact grid or timed image cues,
plus image indices. Core alone retains manifest URLs, image URLs and known
expiry. Unsigned assets have the admitted source's lifetime; Couch does not add
an arbitrary one-hour expiry. Preview failures do not trigger media extraction
or source renewal. Provider timestamps describe intervals, not exact frames.

## Authorization and resource lifetime

`/api/playback-preview?playbackId=…` checks pairing, active playback identity and
output consent. `image=N` uses the same checks, including after asynchronous
work. A controller does not have to be a receiver. Session strips private
preview descriptors from every renderer load, including reload and recovery.

The admitted source owns cancellation. Failed quality changes retain its
preview; a successful replacement or Stop retires it. Concurrent manifest/image
readers share pending work; the last departing reader cancels the fetch.
Shutdown and revoked access cannot return a late response.

All preview downloads use Core's guarded public-network fetcher, including DNS
and every redirect. They identify themselves as `Couch`, without inheriting
playback cookies or authorization. PNG, JPEG and WebP signatures and encoded
dimensions determine image acceptance; URL suffix and Content-Type are not
trusted. This accommodates Twitch's binary Content-Type and YouTube's WebP
behind `.jpg` URLs.

Bounds:

- Manifest: four concurrent requests, five-second deadline, 512 KiB body,
  20,000 lines, 8,192 characters per line, 4,000 cues/frames, 128 images and
  one-day timeline.
- Image: four concurrent requests, five-second deadline, 2 MiB compressed,
  4,000,000 raster pixels and 8,192 pixels per axis. Every declared crop must fit.
- Shared image cache: 16 MiB compressed bytes. Manifest results are weakly held
  by the source; temporary failures are retryable, and saturation returns 503.
- Client: four decoded object URLs plus at most one pending image. Hide cancels
  image reads/retry timers; source replacement also cancels metadata. Image
  network/503/decode failures retry at most twice while visible. Later hover may
  retry a missing image. Missing metadata is fresh for 30 seconds.

These limits bound inputs and retained assets, not measured whole-browser
memory or decoder CPU.

## Verified source coverage, 28 October 2026

Fresh anonymous production-Core resolution succeeded for all nine website
providers below. Preview delivery used the same protected response path; no
accounts, regional bypass or installed Couch data were used.

| Provider / sample | Observed timed previews | All demanded image bytes |
| --- | --- | ---: |
| YouTube `YE7VzlLtp-4` | 121 frames, 5 sheets, 597 s | 215,128 |
| Twitch VOD `2911384262` | 200 frames, one 5×40 sheet, native 128 s interval | 409,245 |
| RaiPlay Sassuolo–Lazio 27/10/2026 | 100 cues, 4 sheets, 280 s | 2,326,987 |
| StreamingCommunity `/it/watch/66337` | 210 cues, 4 sheets, 3,360 s | 490,230 |
| AnimeUnity Super Cube `110884` | 80 cues, 2 sheets, 1,280 s | 192,902 |
| AnimeSaturn One Piece episode 1180 | No supplied descriptor observed | 0 |
| 123MoviesFree `7500-100943` | No supplied descriptor observed | 0 |
| Bandcamp “Lanius (Battle)” | Audio; no timed descriptor observed | 0 |
| SoundCloud “Sideways (prod. Mad Real)” | Audio; no timed descriptor observed | 0 |

RaiPlay Report 31/05/2026 and Lo stato delle cose 26/10/2026 also delivered 100
cues and four PNG sheets each; Report 07/04/2014 explicitly supplied no preview.
The AnimeUnity catalog says 1,200 seconds while its preview ends at 1,280; Couch
preserves the track's actual times and clips interaction to the observed playback
duration. This discrepancy needs provider/media timing validation, not rescaling.

The integrated player displayed captured images from all five positive
providers with verified crop bounds and cue transitions, including fractional
boundaries. All nine source fixtures preserve controls/fallback and create no
local media element. These are fresh extraction/delivery plus rendered cue
checks, not proof of visual synchronization against decoded video, physical-TV
performance, authenticated catalogs or every item in a provider's library.
No guarantee is made for preview fields an upstream extractor never reports.

Deterministic fixtures and provenance are in `tests/fixtures/provider-preview-assets.md`.
Node route tests cover no-receiver controllers, output consent, token replacement,
source admission, quality failures, deadlines, cancellation and renderer privacy.
