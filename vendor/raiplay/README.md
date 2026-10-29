# RaiPlay preview metadata

This small yt-dlp plugin augments the official `RaiPlayIE`; it keeps
`vtt_poster_thumbs_url` from the relinker XML the upstream extractor already
fetches. Stream selection, regional availability and DRM remain upstream.
No additional player-page request or extraction process is introduced.

Uses yt-dlp's [documented plugin override](https://github.com/yt-dlp/yt-dlp#plugins)
and the existing [`RaiBaseIE` relinker hook](https://github.com/yt-dlp/yt-dlp/blob/2026.10.26/yt_dlp/extractor/rai.py#L54).
Verified against managed yt-dlp 2026.10.26. The optional field resets for each
relinker result; absent and Live descriptors keep ordinary playback.

`tests/raiplay-preview.integration.ts` runs the real extractor with its XML
transport stubbed; `tests/preview-manifest.test.ts` covers the captured VTT.
The plugin directory is private, temporary and removed after extraction.
