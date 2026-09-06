# Jellyfin external PGS delivery

For [issue 34](https://github.com/avoid-quest/couch/issues/34), the qualified contract is intended to be an external PGS track in a Matroska `.mks` sidecar. Native qualification is still pending. The current API investigation establishes binary payload and timestamp behavior only.

## Supported API investigation

The disposable server was official Jellyfin 10.11.11, source tag commit `1fbd8739292cce610231be93daf43368733edf63`, container image ID `sha256:aefb67e6a7ff1debdd154a78a7bbb780fd0c873d8639210a7f6a2016ad2b35db`. The source [subtitle controller](https://github.com/jellyfin/jellyfin/blob/v10.11.11/Jellyfin.Api/Controllers/SubtitleController.cs) exposes `/Videos/{item}/{source}/Subtitles/{index}/Stream.pgssub?copyTimestamps=true`. The [subtitle encoder](https://github.com/jellyfin/jellyfin/blob/v10.11.11/MediaBrowser.MediaEncoding/Subtitles/SubtitleEncoder.cs) copies PGS from Matroska through FFmpeg. Its direct external-file path performs character decoding, which changes binary SUP bytes in this sample.

The fixture uses the [generated subtitle corpus](subtitles.md). No downloaded programme or third-party subtitle is required. Wrapping PGS with `-copyts -c:s copy -f matroska` changes its container only. The zero-origin variant prepends an empty composition and display-set end at zero; all original display events remain unchanged.

| Sidecar | Observed API response |
| --- | --- |
| Direct SUP | HTTP 200, 4,103 bytes from a 3,989-byte source. Its first packet declares a body longer than the response. |
| Original PGS in MKS | All packet types and bodies preserved. The first authored timestamp at two seconds becomes zero despite `copyTimestamps=true`. |
| Zero-origin PGS in MKS | All 16 packet types, display timestamps and bodies preserved. Decode timestamps differ. Fourteen offline rendered frame hashes match the source. |

| Artifact | SHA-256 |
| --- | --- |
| Original generated SUP | `987c17c2b9849ea422072bb15d1559385aa7dd70ae165ab40ea145a911b0318a` |
| Direct SUP API response | `68ac2335deefdd0095183275c81de15c4ce9fa784aa87dbe12ebd64fd2b0f95b` |
| Zero-origin SUP | `0eb54f107784c33a0480dfd08933d106f1e3ba7b1961c6900721f4b2cb9701ac` |
| Zero-origin MKS API response | `81f2252d5a0a8375257f75c1cfc69f64a1291bc16a19b94a6e3fe136827bc217` |
| Unanchored MKS API response | `dc5ca261eba7388427db13d1d6bd3e1199841daabf719f247ad7eec98e87167c` |

Original, wrapped, received and failed-attempt files remain under the owning worktree's private `.artifacts/jellyfin-subtitles/`, including `api-proof.json`, `alternatives.json`, `mks/`, `mks-zero/` and bounded frame comparisons. The initial unbounded FFmpeg comparison attempt was stopped and retained separately; only the subsequent explicit 14-second comparisons support the frame claim.

## Couch's contract

Couch requires upstream metadata to identify an external, non-text `pgssub` track whose original path ends in `.mks`. It downloads the supported API response with host-held authorization and maps a validated complete PGS stream to a private `.sup` file for libmpv. It checks exact packet framing before attachment and retains the existing limits of 2 MiB per file, 20 files, four concurrent downloads and eight seconds. Stop, replacement, failed replacement, disconnect and shutdown retain their native acknowledgement boundary for file cleanup.

The original path, API credentials and temporary filename never enter ordinary controller snapshots. Direct SUP and other unrecognized image sidecars stay unavailable. Text subtitle support remains intact.

The SDK's MediaStream and MediaSource metadata provide no authored subtitle start timestamp that would allow a reliable host correction. Couch therefore shows the upstream timing warning and leaves its existing manual subtitle timing control available. The zero-origin sample is the positive case; unanchored MKS timing is explicitly unqualified. Couch neither adjusts timestamps automatically nor transcodes these tracks.

## Replaying the native check

The opt-in [runner](../../tests/package/jellyfin-subtitles.ts) uses the [fixture](../../tests/package/jellyfin-subtitle-fixture.ts) to create a unique private Docker network and disposable official Jellyfin server. Only generated media is mounted. The server has a two-CPU, 2 GiB limit and an ephemeral loopback port. Generated credentials remain in the helper process. Cache and configuration use temporary filesystems. Normal completion and failures remove the server and network; preserve the evidence directory.

Prepare a separate disposable Ubuntu amd64 runtime with the exact reviewed Debian package installed. Use the prerequisites and unprivileged `subtitle` user from [the existing packaged subtitle instructions](subtitle-package.md#replaying-the-focused-check), including its [display fixture](../../tests/package/subtitle-display.sh). Give this run a fresh private data directory and evidence bind mount at `/evidence`. Publish container ports 45300, 45344 and 45345 on host loopback ports 45500, 45544 and 45545. The helper attaches this runtime to its new network and detaches it afterward. Do not point it at a retained or shared runtime.

After acquiring the scoped runtime slot, invoke from the repository with a 15-minute outer execution bound:

```sh
JELLYFIN_NATIVE_CONTAINER=couch-jellyfin-native-unique \
JELLYFIN_SUBTITLE_EVIDENCE=/absolute/private/evidence \
SUBTITLE_CORPUS=/absolute/generated/corpus \
JELLYFIN_EXPECTED_REVISION=full_reviewed_package_commit \
bun tests/package/jellyfin-subtitles.ts
```

The optional `JELLYFIN_NATIVE_PORT`, `JELLYFIN_NATIVE_DRIVER` and `JELLYFIN_PHONE_DRIVER` override the three host ports. The helper refuses a different package revision or official server image. Package source and installed binary hashes go in `identity.json`; API packet comparisons go in `upstream/api-result.json`; native results go in `result.json`, or partial checkpoints in `failure.json`. Evidence is private because screenshots and diagnostic state can contain pairing details.

The planned native checks cover real TV and HTTP phone selection and Off, phone settings at 390, 768 and 1440 CSS pixels, rendered/cleared cues at 1/4/7/10/13 seconds and a backward seek, two synchronized WebSocket remotes, one upstream Couch playback session, private complete files, direct SUP and broken/missing MKS rejection, and cleanup after Stop, successful or failed replacement, disconnect and shutdown. Xvfb pixels and null audio do not qualify a physical display or audio device.

The helper passes standalone TypeScript checking. Its native execution and independent qualification review remain required before issue completion. This document records no native pass for the new implementation.
