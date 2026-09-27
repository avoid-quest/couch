# Adapt only the media a target cannot play directly

Type: task
Status: open
Blocked by: 02

## Goal

Resolve concrete compatibility failures discovered in existing remote sources using
the least processing required. This issue does not block compatible-source handoff.

## Work

- Prefer an existing compatible or lower-bandwidth upstream rendition, including a
  negotiated Jellyfin rendition, before starting Couch conversion.
- Add remux/streamcopy for container-only incompatibility; audio conversion without
  video conversion where sufficient; simple subtitle conversion without video encoding.
- Preserve subtitle choice/fidelity explicitly. Don't silently turn ASS/PGS into missing
  captions. Use a maintained renderer or explain a necessary conversion/burn-in path.
- Add bounded FFmpeg video jobs only for demonstrated needs. Use available hardware
  support and account for the TV's own GPU use; don't assume every filter stays on GPU.
- Support seeking through original content time even when output timestamps restart.
  Keep existing upstream ABR; generate a new quality ladder only if measurements justify it.
- Cancel unused workers/buffers on stop, failure and handoff. Expose enough diagnostic
  information to tell direct access, relay, remux and encoding apart.

## Done when

At least the actual reported incompatibilities work, compatible video remains copied
or direct, seek/resume remains correct, and stopped sessions release workers. Record
CPU/GPU/bandwidth observations on available hardware and any untested acceleration path.

## Reference

[Browser media delivery](../../../docs/research/browser-media-delivery.md).
