# StreamingCommunity extractor

Source from [Blu-Tiger/StreamingCommunity-yt-dlp-plugin](https://github.com/Blu-Tiger/StreamingCommunity-yt-dlp-plugin/tree/b05be8bb979283d8c485cb4918001fc01518f2d8), version 2026.07.27, commit `b05be8bb979283d8c485cb4918001fc01518f2d8`. MIT, copyright 2024 BluTiger; license included.

SHA-256:

- Upstream `streamingcommunity.py`: `c718694ea4d3b70e55e75037338d4b41d53071c09787cf916f3b368e1e254d72`
- Bundled `streamingcommunity.py`, after the correction below: `ac4ed1a6038e4d332b364ad3c8708ac1615248eba12f4313bebfbdd9c4b87be7`
- `LICENSE`: `5596c70c76886155f5758bf55346057206bdee650a07bd85149dfa93784d72f2`

Couch carries one downstream correction in `_real_extract`: its two route checks use `'/watch/' in urlsplit(url).path` and `'/titles/' in urlsplit(url).path`. The upstream full-URL substring check misroutes film titles such as `/it/titles/123-the-watchers` into video extraction before visiting the watch page. No URL is rewritten by Couch, and extraction logic remains upstream-owned. Remove this correction when a reviewed upstream version fixes dispatch. `python3 scripts/tests/streamingcommunity-dispatch.py` executes the actual vendored dispatch and movie redirect with only network/framework boundaries stubbed; the watcher-title cases fail on the upstream bytes and pass with this correction.

Couch embeds the source in its sidecar and loads it only for an item link on the administrator's exact configured HTTPS origin. Each extraction gets a private temporary plugin directory, removed when the process exits or is cancelled. `--no-plugin-dirs` clears yt-dlp's default directories before the one explicit directory is added; `--use-extractors StreamingCommunity,end` restricts extractor selection. Other website requests load no plugins.

The upstream extractor owns page, embed and manifest parsing. Its imports are Python standard library and yt-dlp only. It does not execute page JavaScript or shell commands. It uses the provider's advertised FHD availability. Couch supplies no account cookies. Upstream follows provider-supplied embed and manifest URLs, as other webpage extractors do; the configured origin is an admission policy, not a network sandbox.

Checked against the packaged yt-dlp 2026.08.19 plugin interface and a live episode metadata extraction on 2026-09-08. No full media was downloaded. Native playback still requires qualification. Upstream changes must be reviewed and pinned here, retaining its license and updating hashes. Signed Couch updates distribute and roll back the embedded extractor; administrators can update the website origin in Settings > Sources without replacing code. Old saved links are never rewritten.
