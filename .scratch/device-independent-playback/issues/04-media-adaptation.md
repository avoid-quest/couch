# Choose media the client can render

> Historical issue record (2026-09-27). Its design and completion claims describe the earlier session/group model. Follow [the replacement product contract](../../../docs/playback-product.md) and [current acceptance matrix](../map.md).

Type: task
Status: implemented for supported direct sources; further provider selection deferred
Blocked by: none

## Goal

Use client capabilities and existing upstream renditions to keep fetching, decoding
and rendering on the selected client.

## Work

- Report useful renderer capabilities and choose existing compatible media.
- Preserve upstream adaptive quality and client quality limits.
- Explain unsupported media through existing playback UI with actionable output choice.
- Add processing only after a concrete source fails and client/provider-native options
  are exhausted. No new Core relay/transcode pipeline is currently selected.

## Done when

The tested source workflows choose a compatible client path and keep Core out of
ordinary media transfer. Document the remaining limitations and measured resource
costs. The abandoned Jellyfin experiment is not a dependency or a completion claim.

## Result — 2026-09-27

Direct HLS/DASH uses Shaka's codec/rendition selection on the client and preserves
adaptive quality with the requested height cap. Real browser checks cover audio,
subtitles and live DVR; unsupported sources produce an output-choice error. Core
does not proxy these resources. Resource measurements are in [validation](../validation.md).

Use the existing **Direct media** input for manifest URLs. The default **Webpage**
input invokes yt-dlp and can select separate audio/video URLs or required headers,
which direct browser playback intentionally rejects. Angel One works through Direct
media; forcing it through Webpage is not evidence for a new relay or header rewrite.
Capability flags are reported but do not yet customize yt-dlp format selection.
Reopen that narrow selection work for a demonstrated real webpage whose usable
upstream rendition is being missed. No such additional provider is qualified here.
