Preview fixtures were captured anonymously from public provider assets on 2026-10-28 by the provider audit, then verified by the lower-layer implementation against yt-dlp 2026.10.26. They contain no cookies, account credentials or signed query parameters.

- `twitch-storyboard.json`: native JSON for https://www.twitch.tv/videos/2911384262; 200 frames, 160×90 tiles, 5×40 cells, 128-second interval.
- `twitch-preview.jpg`: its first low-quality 800×3600 JPEG sheet (409,245 bytes). The CDN served `binary/octet-stream`; this fixture locks signature sniffing and the real 200-cell geometry under the pixel cap.
- `preview-sheet.webp`: first storyboard sheet for https://www.youtube.com/watch?v=YE7VzlLtp-4 (43,112 bytes), served as WebP despite a `.jpg` URL. No frame extraction was used.
- `streamingcommunity-preview.vtt`: the declared preview track from https://streamingcommunityz.day/it/watch/66337; 210 cues, four sheets, through 3,360 seconds.
- `animeunity-preview.vtt`: the declared preview track from https://www.animeunity.co/anime/7874-super-cube-ita/110884; 80 cues, two sheets, through 1,280 seconds despite the catalog runtime of 1,200 seconds. Both VTT files contain only relative sprite references.

The Python extractor fixtures use scrubbed native metadata shapes and public `.example` URLs. The actual upstream extractor is exercised with network/framework calls stubbed; assertions count existing fetches. These tests are not a claim of full media playback or visual synchronization.
