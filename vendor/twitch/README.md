# Twitch preview timing

This first-party augmentation uses yt-dlp's documented [`plugin_name` subclass hook](https://github.com/yt-dlp/yt-dlp#developing-plugins), as Couch's SoundCloud augmentation does. It intercepts only the storyboard JSON already downloaded by `TwitchVodIE._extract_storyboard` and associates each upstream format with its native `count` and `interval`. There is no additional GraphQL, JSON or image request, and no replacement stream extraction.

Upstream [2026.10.26](https://github.com/yt-dlp/yt-dlp/blob/2026.10.26/yt_dlp/extractor/twitch.py#L539) derives `fps=count/duration`, losing the native interval. Public VOD 635475444 advertises 200 frames at 59 seconds but yields 58.215 seconds from fps; VOD 2911384262 advertises 200 frames at 128 seconds. Core uses `couch_frames` and `couch_interval` when present and validates them under the ordinary storyboard limits. Remove the augmentation when the reviewed upstream extractor preserves equivalent native timing.

The source is embedded in Core and loaded in a private temporary directory only for Twitch targets; default/user plugin directories remain disabled. `tests/provider-preview.integration.ts`, with `COUCH_TEST_YT_DLP` set, exercises the actual upstream method and asserts one JSON request per extraction. Python's standard library and yt-dlp are the only imports.
