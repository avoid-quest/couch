# Jellyfin external PGS delivery

For [issue 34](https://github.com/avoid-quest/couch/issues/34), a zero-origin external PGS track in a Matroska `.mks` sidecar passed the packaged Ubuntu native check on 6 September 2026. Direct SUP remains unavailable, and timing for MKS sidecars whose first event starts after zero remains unqualified.

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

Prepare a separate disposable Ubuntu amd64 runtime with the exact reviewed Debian package installed. The successful run used two CPUs and 2.5 GiB for this runtime, plus two CPUs and 2 GiB for the Jellyfin fixture, within a 6 GiB shared usage budget. A 1.5 GiB native cap caused measurable memory pressure and a browser navigation timeout. Use the prerequisites and unprivileged `subtitle` user from [the existing packaged subtitle instructions](subtitle-package.md#replaying-the-focused-check), including its [display fixture](../../tests/package/subtitle-display.sh). Give this run a fresh private data directory with `COUCH_DATA_DIR=/evidence/data` and an evidence bind mount at `/evidence`. The helper reads that disposable host database privately to check that the actual Couch upstream token is absent from controller snapshots. It matches the stored user/device identity against the upstream session and never records the token. Publish container ports 45300, 45344 and 45345 on host loopback ports 45500, 45544 and 45545. The helper attaches this runtime to its new network and detaches it afterward. Do not point it at a retained or shared runtime.

After acquiring the scoped runtime slot, invoke from the repository with a 15-minute outer execution bound:

```sh
JELLYFIN_NATIVE_CONTAINER=couch-jellyfin-native-unique \
JELLYFIN_SUBTITLE_EVIDENCE=/absolute/private/evidence \
SUBTITLE_CORPUS=/absolute/generated/corpus \
JELLYFIN_EXPECTED_REVISION=full_reviewed_package_commit \
bun tests/package/jellyfin-subtitles.ts
```

The optional `JELLYFIN_NATIVE_PORT`, `JELLYFIN_NATIVE_DRIVER` and `JELLYFIN_PHONE_DRIVER` override the three host ports. The helper refuses a different package revision or official server image. Package source and installed binary hashes go in `identity.json`; API packet comparisons go in `upstream/api-result.json`; native results go in `result.json`, or partial checkpoints in `failure.json`. Evidence is private because screenshots and diagnostic state can contain pairing details.

The native checks cover real TV and HTTP phone selection and Off, phone settings at 390, 768 and 1440 CSS pixels, rendered/cleared cues at 1/4/7/10/13 seconds and a backward seek, two synchronized WebSocket remotes, one upstream Couch playback session, private complete files, direct SUP and broken/missing MKS rejection, and cleanup after Stop, successful or failed replacement, disconnect and shutdown. Xvfb pixels and null audio do not qualify a physical display or audio device.

## Completed packaged check

The successful scoped run lasted from `2026-09-06T23:10:26.548132Z` through cleanup at `23:11:57.857348Z`. It passed all 70 checkpoints using authenticated [Package run 34061588944](https://github.com/avoid-quest/couch/actions/runs/34061588944), build `0.1.0+build.34061588944.1`, source `872a6b915b7611e568fd959179dcebe39b710b05`. Its 16 standard package checks had already passed. The external qualification helper was separately reviewed at `8a5bf11f5a5825eba1599f3a2bbff8e30bb15dbc`; only that helper changed after the package source revision.

| Identity | SHA-256 |
| --- | --- |
| Debian package | `f8594654d335b952b27bb12dd5ad9465d3bdd3e107b7c014fa20e6367727c7e8` |
| Installed Couch | `3b72b5e80eef724a3aac98d6da1f88982ffe562efecd20068ff97591e9649bc2` |
| Installed coordinator | `ad1a8ab48b40de83f0ac7d55cb6462d909e65c7c57888af4740aeee4f42c8f22` |
| External qualification helper | `5621ba85644cf31817de9e9c0ff2edc0b2e14c6726aa68410aac8ad0e871a649` |

The disposable Ubuntu 24.04 amd64 image was `sha256:10c2ee750a19e1b679b933e6931f4c0d5e1e5beef27616ce28544bd2ef6949b0`. Before the helper ran, structured inspection verified its exact memory/CPU limits, four owned mounts, bridge address and three loopback mappings, followed by host listener checks. The official Jellyfin image and generated corpus matched the identities above.

Real TV and HTTP phone controls selected the external track and Off, with an actual native pointer target assertion for phone clicks. Settings fit at 390, 768 and 1440 CSS pixels. Two WebSocket controllers observed the same player, while Jellyfin reported exactly one Couch playback session. The downloaded PGS matched the complete supported-API response and had mode 600. Ordinary snapshots contained neither the actual Couch upstream credential nor native paths.

| Paused position | Expected cue | Pixels changed by selecting PGS | Darkened pixels |
| --- | --- | --- | --- |
| 1 s | Clear | 0 | 0 |
| 4 s | IMAGE 1 | 7,303 | 0 |
| 7 s | Clear | 0 | 0 |
| 10 s | IMAGE 2 | 7,525 | 0 |
| 13 s | Clear | 0 | 0 |
| 4 s, backward seek | IMAGE 1 | 7,303 | 0 |

Direct SUP, invalid framing and missing MKS sidecars left video playable with useful errors. Each retirement scenario first proved a fresh complete private PGS file. Successful replacement, failed-before-load replacement after native Stop acknowledgement, explicit Stop, disconnect and native shutdown removed retired files. Native shutdown also ended upstream playback reporting.

Private evidence is retained under `.artifacts/jellyfin-native-attempt-5-872a6b9/` in the owning worktree: `evidence/result.json`, `evidence/identity.json`, `evidence/upstream/api-result.json`, phone screenshots and native pixel pairs. `evidence-sha256.json` pins these results and the launcher/source manifests. `cleanup.json` confirms every owned container/network absent, with no failures; `termination.json` records no termination errors. Earlier failed attempts remain separate and support no completed qualification claim. The accidental fixture run is excluded.

This qualifies the generated zero-origin MKS sample on packaged Ubuntu with software rendering and null audio. It does not qualify unanchored MKS timing, direct SUP delivery, a physical display or an audio device.
