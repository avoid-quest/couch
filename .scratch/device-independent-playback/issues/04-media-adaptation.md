# Choose media the client can render

Type: task
Status: open
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
