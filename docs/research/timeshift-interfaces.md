# Standard media interfaces for live and growing playback

Source review for [Qualify a stable live/growing-timeshift backend and maintained host client](https://github.com/avoid-quest/couch/issues/67), checked 2026-09-06 at Couch base `cd9b6e9a841ac66d5e8fbcbaf0abc2a3cb4864f3`. Both native prerequisites are closed; the product issue remains open. This adds no runtime qualification to the retained [backend investigation](timeshift-integration.md) or [original DVR measurements](dvr-timeshift.md).

The useful standard-media candidate is **HLS EVENT playback**, with a fixed beginning and an advancing end. Flussonic documents this interface. Its sliding rewind HLS and live DASH are poor first probes for the retained client versions because FFmpeg rejects their server seeks. EVENT avoids that particular gate, but fresh-edge seeking, temporary stalls, completion and packaged Couch controls still need measurement. No backend or client is selected by this review.

## Refreshed upstream evidence

| Source | Current result |
| --- | --- |
| [Tvheadend master](https://github.com/tvheadend/tvheadend/commit/68c867a85d0bca82678b53f5e46803bd2509827d) | Head `68c867a85d0bca82678b53f5e46803bd2509827d`, committed 2026-09-06 19:14:28 UTC. The [two-commit comparison](https://github.com/tvheadend/tvheadend/compare/f7f114e9b7d80e4b32b2f708c8520e2a414a2533...68c867a85d0bca82678b53f5e46803bd2509827d) changes WebUI/theme files. Its timeshift reader remains byte-identical to both tested revisions, 26,261 bytes, SHA-256 `ba0bcbab1afe1bf814911e2c5996108e55360e370cf8f28c4c8ab2321b25a441`. This supplies no new reader fix and is not a runtime result. |
| [Tvheadend live-return proposal](https://github.com/tvheadend/tvheadend/pull/2093) | Still open and unmerged at `3239e33515e587fe0c7feed34be48cad648c2157`. The author's [decoder-restart warning and near-edge workaround](https://github.com/tvheadend/tvheadend/pull/2093#issuecomment-4189432461) remain applicable. Near-edge skip does not pass the retained exact `subscriptionLive` sequence. |
| [HTSP release metadata](https://repo.maven.apache.org/maven2/at/bernhardberger/tvheadend/htsp/maven-metadata.xml) and [SDK metadata](https://repo.maven.apache.org/maven2/at/bernhardberger/tvheadend/sdk-core/maven-metadata.xml) | Latest published versions remain `htsp:0.7.0` and `sdk-core:0.6.1`. Source heads remain HTSP `991ae11326666fa7e70855dade9c71232a6a7879` and SDK `8f30f58e8d501d8099b25a744d3904426bbd4bbf`. The retained Java 17/GPLv3 package analysis and Android Media3 integration gap remain unchanged. No supported libmpv adapter was established. |

Preserve the ARM64 exact-live crashes, AMD64/Rosetta readiness failure, restart/mapping failures and separate unexplained exit independently. The reader comparison neither identifies a crash root cause nor rejects native x86_64 qualification. Published JVM client maintenance alone does not resolve its packet-to-libmpv boundary. See the [client contracts and measurements](timeshift-integration.md#maintained-client-and-libmpv-boundary).

## What the HTTP interfaces actually promise

These are vendor contracts, not observed manifests. `from` is UTC seconds and durations are seconds.

| Flussonic request | Contract and implication |
| --- | --- |
| `/{stream}/archive-{from}-{duration}.m3u8` | Default catchup is static VOD. It cannot establish following a growing recording. |
| Same request with `?event=true` | While its requested end is present/future, retains old segments and appends new ones. The documented response becomes VOD after the period ends. Probe the actual completion tags and same-load behavior. |
| `/{stream}/index-{from}-now.m3u8` | EVENT playlist retains segments from a fixed start and appends new segments. Vendor guidance says initial playback is near live; seeking accesses history. This is the first client candidate. |
| `/{stream}/rewind-{seconds}.m3u8` | Wide sliding live window. A larger advertised window does not make this seekable in the retained FFmpeg. |

Source: [Flussonic HLS playback](https://flussonic.com/doc/fms/protocols/hls/). Its warning about nonstandard extensions means the emitted child playlist, tags and segment URLs must be inspected. An EVENT window is also an ever-growing segment list; bound its duration and backend retention before considering long sessions.

[RFC 8216 section 6.2.1](https://www.rfc-editor.org/rfc/rfc8216.html#section-6.2.1) permits appending to EVENT, including final `ENDLIST`, while preserving earlier content. The vendor's "becomes VOD" wording does not establish those exact wire semantics. Retain before/after playlists at completion instead of assuming a compatible transition.

The [streaming API](https://flussonic.com/doc/api/streaming/) also offers `rewind-{seconds}.mpd` and time-addressed DASH archive requests. Its HLS/DASH methods declare query-token authentication. A production adapter must keep tokens, child URLs and authentication private to the host, measure session reuse across manifest/segment requests and expire them on Stop. No session policy or backend watched-field behavior was qualified here. A switch from Tvheadend's job store to archive time windows would need an explicit programme/job identity mapping; the URL is not a recording identity.

## The retained libmpv boundary

The earlier measured environment used Ubuntu `libmpv2 0.37.0-1ubuntu4` and FFmpeg `6.1.1-3ubuntu5`. This review reads their upstream version sources, not a newly extracted Ubuntu source package or current target binaries. Verify actual loaded libraries and distribution patches before attributing a runtime result.

- FFmpeg `n6.1.1`, commit `e38092ef9395d7049f871ef4d5411eb410e283e0`, marks HLS unseekable unless the first variant's first playlist has finished or is `EVENT`. `hls_read_seek` returns `ENOSYS` for that flag. EVENT seeks must still resolve within the segment list already known to the demuxer, so a requested fresh live edge can fail until playlist refresh. [Flag assignment](https://github.com/FFmpeg/FFmpeg/blob/e38092ef9395d7049f871ef4d5411eb410e283e0/libavformat/hls.c#L1036), [seek implementation](https://github.com/FFmpeg/FFmpeg/blob/e38092ef9395d7049f871ef4d5411eb410e283e0/libavformat/hls.c#L2429).
- The same version's DASH demuxer returns `ENOSYS` when `c->is_live`. A server's DVR DASH feature list does not remove this client gate. [DASH seek implementation](https://github.com/FFmpeg/FFmpeg/blob/e38092ef9395d7049f871ef4d5411eb410e283e0/libavformat/dashdec.c#L2293).
- mpv `v0.37.0`, commit `818ce7c51a6b9179307950e919983e0909942098`, honors `AVFMTCTX_UNSEEKABLE`. Seeks satisfied inside mpv's own cache cannot prove server DVR access. [libavformat integration](https://github.com/mpv-player/mpv/blob/818ce7c51a6b9179307950e919983e0909942098/demux/demux_lavf.c#L1159).

This makes native HLS EVENT a plausible way to retain the existing decoder and HTTP demuxer without maintaining an HTSP packet bridge. That is an inference, not a supported Flussonic/libmpv compatibility claim. Normal host integration still has to represent the archive start, refreshed live edge, seek bounds and pending operations.

Couch already clears and applies HTTP headers before loads and has explicit cache budgets. Its IPTV live return configures `live_start_index=-1` for a new load; it does not prove same-load growing playback or refreshed EVENT seeks. Reuse these contracts deliberately. [Network and buffer configuration](https://github.com/avoid-quest/couch/blob/cd9b6e9a841ac66d5e8fbcbaf0abc2a3cb4864f3/src-tauri/vendor/tauri-plugin-video/src/desktop.rs#L1571), [IPTV live-start configuration](https://github.com/avoid-quest/couch/blob/cd9b6e9a841ac66d5e8fbcbaf0abc2a3cb4864f3/src-tauri/vendor/tauri-plugin-video/src/mpv_iptv.rs#L12).

## Commercial access and the owner decision

The vendor's [26.08 release note](https://flussonic.com/blog/changelog/version-26-08) is dated August 7, 2026 and describes Catena's Sapsan core and migration from Flussonic v3. It does not identify an immutable FMS artifact that this review can qualify. The FMS HLS URLs above must not be assumed to be the same interface on a Catena deployment. Select the exact product, supported package version and manifest API with the vendor before a trial.

FMS [licensing documentation](https://flussonic.com/doc/fms/admin/licensing/) requires a purchased or trial key. Online activation needs outbound HTTP/HTTPS and a stable licensing connection; offline USB activation is version-specific. Without a key the UI is limited. This worker has no supplied entitlement or server endpoint. The cited page establishes access mechanics, not permission to redistribute the server or the terms of a particular trial. Keep a trial server separate from the Couch package and obtain the applicable vendor terms with its entitlement.

The owner has three concrete alternatives after the cheap client preflight below:

| Alternative | Next action and cost of choosing it |
| --- | --- |
| Evaluate commercial EVENT HLS | Owner supplies an existing licensed endpoint or authorizes obtaining a trial with the vendor. Required handoff: exact FMS/Catena product/build, credentials through host-private configuration, generated input rights, DVR storage, manifest/token contract and trial limits. This tests a maintained HTTP path; it commits neither to purchase nor to a custom transport. |
| Stay with maintained Tvheadend and seek upstream support | Reserve native x86_64 qualification of the retained build; separately ask the maintainer about a supported standalone libmpv integration. A passing server sequence would still leave that integration unqualified. Carrying unmerged PR 2093 requires a separate maintenance decision. |
| Maintain the missing HTSP adapter | Owner explicitly accepts the JVM/native bridge or another packet adapter, its license/runtime delivery, time mapping, decoder resets, byte budgets and lifecycle responsibility. Create bounded implementation children only after that decision. The orchestrator and worker cannot choose this obligation for the owner. |

I recommend testing the existing client's EVENT behavior before asking for a commercial trial. That can reject an unsuitable client path without a vendor account. It cannot qualify Flussonic or close the product issue.

## Bounded next probe

This is a proposed resource window, not an executed run. The media orchestrator can assign a worker to a fresh private artifact directory and reserve at most ten minutes, two CPUs, 1 GiB memory and 128 MiB media/evidence. Use the already retained generator and Ubuntu libmpv environment only after appliance coordination. No T480 access, new package installation or shared native build is required for this client preflight.

Generate 90 seconds of authorized MPEG-2/MP2 EVENT HLS with two-second segments using the existing FFmpeg capabilities. The generator command is executable inside that reserved fixture directory:

```sh
ffmpeg -nostdin -re -f lavfi -i testsrc2=size=320x180:rate=25 \
  -f lavfi -i sine=frequency=500:sample_rate=48000 -t 90 \
  -c:v mpeg2video -g 50 -b:v 400k -c:a mp2 -b:a 96k \
  -f hls -hls_time 2 -hls_playlist_type event \
  -hls_flags temp_file -hls_segment_filename 'segment-%03d.ts' event.m3u8
```

The selected flags exist in the pinned [FFmpeg HLS muxer](https://github.com/FFmpeg/FFmpeg/blob/e38092ef9395d7049f871ef4d5411eb410e283e0/libavformat/hlsenc.c); preflight their availability in the actual generator binary before running.

Serve that directory on a reserved loopback-only HTTP port with request logging. Use one libmpv instance via its existing API, with 4 MiB forward cache and zero backward cache, so the test can distinguish server requests from cached seeks. Capture versions, loaded-library hashes, manifests, segment requests, commands, events, packet/timestamp observations, memory samples and shutdown results. The generator fragment is not a complete test runner; the worker must implement and review the bounded lifecycle driver before execution.

| Phase | Required observation |
| --- | --- |
| Open after 20 seconds of production | One load receives real audio/video tracks and advances. Retain `EVENT` and absence of `ENDLIST` in the served media playlist. |
| Pause for six seconds | Presentation position stays fixed while the server manifest grows. Record all continued prefetch and actual memory use. |
| Seek backward to four seconds, then forward | Real HTTP segment requests prove retrieval outside cache. Record requested versus observed timestamps and failure codes, not only command acceptance. |
| Seek into media produced after initial open | Same load reaches new content. Record playlist-refresh timing and old-list seek failures. Keep this distinct from seeking an already buffered range. |
| Catch the producer and suspend only that generator for four seconds | Playlist stops advancing without `ENDLIST`; libmpv waits and resumes audio/video when that same generator resumes. No replacement load or final EOF is allowed. Resume it in cleanup even on failure. |
| Reach live edge and then normal generator completion | Seek to the newest published segment after refresh, measure edge distance, then observe final `ENDLIST` and native EOF on the same load. An HLS segment edge is not HTSP exact-live mode. |
| Stop and destroy while waiting, in a separate fresh run | Cancellation completes within the worker's five-second ceiling, sockets/handles/processes disappear and the log records any escalation. Source recording must remain independent of player Stop. |

This software preflight supplies neither physical audio nor native pixels. After it passes, a licensed real-backend run must repeat the sequence with backend storage limits, authentication expiry, stalled input, retention expiry and archive completion. Packaged TV/two-controller state, reporting, continuity and target acceptance remain in the owning issue. A fixed EVENT window may suit a programme; rolling a long live session into another window still needs a separately verified continuity policy.

## Retained evidence

Only this report changes. Earlier evidence archives remain referenced by the [original report](dvr-timeshift.md#evidence-and-replay) and [timeshift manifest](timeshift-evidence.md). Their recorded SHA-256 values remain `8d8692b41c9c9465c5ee1e4ddf5498e3fb90fd4ce27ebeb584951801e8e050a7`, `14c66b7b6c828da9ae02452c05e6d0bea89d1408ecb0fb344a670a2a33b6db30`, `f0ca4656388d389fba8165594109e0c5ef04785afef28a39e63028aa8274030c` and `542e540c3bfa73a11b45045ebcf91728aa9a5bb331f77ae94e0e1dfd2572d206`. This review did not reopen or reverify those archives.

Ten public source snapshots and their URL/byte/SHA-256 manifest are retained in `/tmp/couch-media-fresh-backend/.artifacts/timeshift-interfaces/`. Pinned source hashes are HLS `2a64f72edfe065f8692525f2fd875c9f33fc99de9da941946346319cc6a71f4f`, DASH `ddc9e46a4f691123a23ad0a0f195aebb204c66b08a4dc62d75af13b9a7787b60` and mpv lavf `48073c981a29e4a8863dbb2fdfc54666bd9b435fec0dcf662e4ea11c5d835b8d`. Vendor HTML snapshots record what was read, not a server binary identity. No container, media generator, client, native test, browser, preview or target ran during this review.
