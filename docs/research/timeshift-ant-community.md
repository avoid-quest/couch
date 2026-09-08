# Ant Media Community timeshift investigation

Continuation of [Qualify a stable live/growing-timeshift backend and maintained host client](https://github.com/avoid-quest/couch/issues/67), from Couch `351eb9ee52f9fea2b91c4db92fff9d042a1c95eb`, checked 2026-09-08. The product gate remains open. This report establishes a local backend/client control result and does not claim packaged playback.

Ant Media Community 3.1.0 and the retained libmpv 0.37.0 passed the generated real-backend EVENT-HLS sequence after two fixture startup failures. All 69 recorded client assertions passed, followed by verified container cleanup. Missing Flussonic access does not block this account-free route. Outputs were null; this proves controls and clocks under the measured limits, not presented pixels, audible continuity or the packaged product.

## Supported route and exact inputs

The vendor documents HLS in Community and Enterprise, including the `event` playlist setting. The pinned server's HLS muxer passes playlist options to FFmpeg. This supplies a plausible path through Couch's existing libmpv HTTP/HLS demuxer without an HTSP packet bridge. Compatibility, authentication, retention and lifecycle still require measurement. [Vendor HLS guide](https://docs.antmedia.io/guides/playing-live-stream/hls-playing/), [pinned HLS muxer](https://github.com/ant-media/Ant-Media-Server/blob/28448068fabe087f7cf67f98c593acb3409fa04c/src/main/java/io/antmedia/muxer/HLSMuxer.java).

The live GitHub release API reported `ams-v3.1.0` as latest, published 2026-08-31. Its public Community ZIP is 371,115,505 bytes and declares SHA256 `bdf1ebba54837d06aad950c16c896c7c40c4ddeb1be04b506bfc1ad19ea2ac0d`. The local retained ZIP matches. A web search cache still redirected `latest` to 3.0.3, so the live API and exact asset identify this probe. This verifies release-metadata hashes, not a separate publisher signature. [Community release](https://github.com/ant-media/Ant-Media-Server/releases/tag/ams-v3.1.0).

| Input | Retained identity |
| --- | --- |
| Assembled Linux ARM64 image | `sha256:df8d825bbf2293048958904163c84d3160c154dc5611595151a9f4daf6366d59` |
| Original assembly source manifest | `31eab995c5e0b6ba56da75f86e6eafe13bae16e2957a2bbb7c3bc6eb9d29f0a9` |
| Temurin ARM64 JRE | `jdk-21.0.12.1+1`, archive SHA256 `14be1f35ebdbd1f6e8d57eb911a3ffb74d6d9aa255abc5daf2b1302002cf2cf2` |
| Client filesystem ancestor | Ubuntu image `979fbf19f90e61d22a6c37704755a8a5f9cc53d3cca3261a88d23ed106a1829e` |

Assembly had already succeeded on 2026-09-06 at 22:47:39 UTC after the last public issue update. Fresh readback verifies the image, ARM64 architecture, package/JRE/source labels, all nine ancestor layers plus one assembly layer, and no automatic volumes. The original ancestor image ID is now absent locally. Both probe containers therefore use the assembled image. The assembler adds Ant and Java files and leaves `/usr/bin/python3`, FFmpeg and libmpv intact. The client runs only the retained client entrypoint. Image provenance continues to check the original assembly manifest; copied runtime scripts have their own manifest.

The private fixture retains the Community package notices, JRE notices and dependency inventories. It installs no backend in Couch and changes no repository runtime. Backend distribution, component obligations and an actual private deployment remain separate from this evaluation.

## Bounded first real launch

The coordinator reserved two isolated containers for at most 600 seconds. Server limits were two CPUs, 4 GiB memory, no extra swap and 256 PIDs; client limits were two CPUs, 1 GiB and 128 PIDs. Both had read-only roots, dropped capabilities, no-new-privileges and 512 file descriptors. Server writable configuration/native/log directories used bounded tmpfs. Server networking was `none`, with the client joining that namespace. No host ports, target access, preview changes or native build caches were involved.

Evidence storage uses sampled stop thresholds, not a hard aggregate filesystem quota. Fresh review reduced the client threshold to 64 MiB and client file-size limit to 4 MiB. The server retained a 64 MiB file-size limit because JavaCPP extracts native files larger than 4 MiB. Host sampling stops at 124 MiB with cleanup headroom. Concurrent writes can exceed a sampled threshold; the coordinator explicitly accepted that limitation for disposable research.

The exact first runtime manifest was `7142826a3b70cf12cd37f77afe77f7c7b991c2e215c09785cf4c7e9104445079`. Independent review accepted it after source/asset verification and nine static tests. An intermediate proposed 4 MiB server file limit was rejected before execution because it would prevent extraction of the 27,931,312-byte ARM64 `libavcodec.so.61`.

The run started at approximately 00:53:20 UTC and ended at 00:53:25 UTC. Java 21.0.12.1 started and the launcher identified `Ant Media Server Community Edition 3.1.0 20260904_1146`. Spring then failed to initialize `vertxCore` with `failed to create a child event loop`. The launcher child exited zero despite the bootstrap error. The host correctly returned failure because the backend exited before the client completed. No dashboard API, broadcast or media playback was qualified.

Server sampling observed a 574,156,800-byte memory peak and 146 tasks, with no recorded OOM events. Sampling is not proof that a short resource-limit event never occurred. Both owned containers were independently removed. Successful empty exact-name listings verified absence; Docker's lowercase missing-object diagnostic was not treated as sufficient evidence on its own.

The pinned packaged `red5-common.xml` hardcodes 128 event-loop threads and 128 worker threads on each of two Vertx instances. These settings override the intended two-CPU sizing. They suggest resource pressure as a cause of the startup failure, but the retained exception does not establish its nested cause. [Pinned configuration](https://github.com/ant-media/Ant-Media-Server/blob/28448068fabe087f7cf67f98c593acb3409fa04c/src/main/server/conf/red5-common.xml), [Vertx options](https://vertx.io/docs/4.5.22/apidocs/io/vertx/core/VertxOptions.html).

## Second launch and native extraction mount

A reviewed retry set the existing Vertx XML properties to four event-loop and eight worker threads per instance. It retained applied configuration hashes, server log tails and cgroup PID-limit events. Limits and image identity stayed unchanged. Runtime manifest `863aedbba46a15f8b601e5e7135cd021b8e25600c46c91bbf34b89d97f4c8c9d` also lowered the launcher's minimum accepted reservation from 300 to 175 seconds to fit the coordinator's 180-second window; the maximum and cleanup reserve were unchanged.

This run started at 00:57:22 UTC and ended at 00:58:54 UTC. Startup passed the earlier Vertx point and reached Tomcat, then failed with `no jniavutil in java.library.path`. Dashboard readiness timed out. Both owned containers were removed with verified absence. No backend API or media acceptance passed.

Read-only inspection during this attempt found the extracted 1,297,024-byte `libjniavutil.so` and 5,930,816-byte `libavutil.so.59` in `/runtime/native`. Static ZIP/JAR inspection confirms both are AArch64 ELF binaries. The dynamic-loader diagnostic returned `not a dynamic executable`; it did not identify a missing dependent library.

The fixture requested `/runtime` with `rw,nosuid,nodev,size=384m`, despite its README describing executable native storage. Docker adds `noexec` to tmpfs defaults before merging requested options. The correction adds explicit `exec` only on this bounded native extraction mount, and records actual mount options before Java starts. Other writable tmpfs mounts stay `noexec`. This uses Docker's supported options and requires no backend patch or new image. The first two attempts did not retain actual mountinfo; the corrected run verified the mount and successfully loaded native libraries. [Docker tmpfs options](https://docs.docker.com/engine/storage/tmpfs/), [Moby mount-option handling](https://github.com/moby/moby/blob/master/daemon/oci_linux.go).

## Passing real-backend sequence

The third run used reviewed source manifest `63bcc305bdcbd1e163eab24378a581f57c2cee5cf7f4eb4c07a6e269c750d148`. It started at 01:06:52 UTC and completed at 01:08:44 UTC within its 180-second reservation. Both original host and client results are `passed: true`. The 69 assertions include repeated command checks, not 69 independent scenarios.

The actual server API reported Community 3.1.0 build `20260904_1146`. It created an ephemeral local administrator, authenticated its cookie session, accepted the full read/modify/write settings request, returned matching EVENT settings, and created generated RTMP broadcasts. Media input was 320×180 H.264/AAC at 25 fps with a generated 500 Hz tone. Management authentication passed; media access was protected by isolated loopback networking, not a qualified production token policy.

The client used libmpv 0.37.0 with FFmpeg `6.1.1-3ubuntu5`, a 4 MiB forward-cache setting, zero backward cache and disabled seekable cache. A bounded four-worker relay returned Ant's bytes, HTTP status and Range semantics unchanged. It logged completed backend segment fetches after source seeks. The fixture did not manufacture manifests or implement a packet transport.

| Observation | Measured result |
| --- | --- |
| Pause during growth | Position held for six seconds while the backend appended segments. |
| Backward and forward server seek | Targets 4 and 10 seconds reached 4.02 and 10.02 seconds, with completed backend Range requests. |
| Newly appended content | Initial native-open manifest ended at 20 seconds. The same load sought to 22 seconds, reached 22.02 and fetched the corresponding new segments. |
| Published live edge | Edge was 28 seconds; native position reached 26.02, a 1.98-second distance. This is the newest published HLS segment, not zero-latency capture. |
| Temporary end | Input suspension lasted 4.822 seconds, including the wait for actual client underrun. The subsequent four-second hold retained EVENT without ENDLIST; the same native load resumed clocks after input resumed. |
| Completion | Final EVENT retained 45 segments and 89.960011 seconds despite configured list size 15. Exactly one main start and one successful final EOF occurred. |
| Cancellation | Stop and destroy during actual backend wait completed in 0.239 seconds. The backend then published more media independently of that stopped player. |
| Client buffering | Across 422 native-reply cache snapshots, maximum demuxer bytes were 233,136 and maximum cache duration was 2.006 seconds. Largest logged HTTP response was 156,228 bytes. These are sampled observations. |
| Runtime resources | Sampled server memory peak was 1,018,437,632 bytes and 69 tasks; client memory peak was 79,728,640 bytes and 53 tasks. No recorded OOM or server PID-limit events occurred. |
| Evidence and cleanup | All 72 manifest members verified, totaling 2,783,453 bytes before the manifest itself. Both containers were removed and independently verified absent, with no cleanup diagnostic errors. |

The generator printed `VBV maxrate specified, but no bufsize, ignored`. Its requested lowercase `-bufsize 1m` did not establish the intended VBV ceiling. The result retains that warning. Do not describe the configured 500 kbit/s maximum as enforced; correct the fixture to `1M` and verify effective VBV before using it for bitrate or burst qualification. The measured cache, response sizes and fixed-duration behavior above remain separate observations.

Audio PTS and estimated frame progression came from `ao=null` and `vo=null`. They establish timeline/control progression only. No video continuity, audible output, physical reception, T480 performance or packaged TV/controller journey follows from this run.

## Retained evidence and remaining work

The original generated EVENT preflight remains in `/tmp/couch-media-fresh-backend/.artifacts/event-preflight/run-x68kx8r_/`. It passed 81 recorded client-control assertions with both outputs null. Its original host result remains failed due to cleanup classification, with separate reviewed absence reconciliation. It does not prove Ant behavior, pixels, audible continuity or packaged Couch playback. The [issue evidence comment](https://github.com/avoid-quest/couch/issues/67#issuecomment-5562690452) retains its exact hashes and limits.

Real Ant runs are retained privately under `/tmp/couch-timeshift-ant-driver-20260908/`, with source snapshots, image readback, ordered client events, Java identities, cgroup samples, failure and cleanup records. No raw investigation artifacts or Python fixture are added to the repository.

| Attempt | Evidence manifest SHA256 | Original host-result SHA256 |
| --- | --- | --- |
| `run-o4096zn0` | `d950644bb70d676fce98920973b9c5275152185b40270377e4771444e7baff2f` | `b241e505afe8329fa21a9e6c3ba924ad4e1ef150961f44144a7340a908bdede2` |
| `run-4351grk9` | `a2e74afe72dd57f24e675c6349558359f6e4a93abb4df4ca4819afbb93fdb0df` | `b65a0d180872c9587108b5cd2943962c7640356b35c7b973a042fb5035bb6696` |
| `run-h1d0si5a` | `dae95e97fe697020cd2b70bb861e12117516beecbd59d924e63a3d2505baa5b5` | `7f823c18a8d920f718e2a87f14f5042e1a73bdb21888f134aead5b15aa921a4f` |

## Smallest next Couch increment

Implement and qualify **one finite EVENT channel through the existing guide and packaged player**. Start with generated input on the already tested separate Ant server, imported through an ordinary M3U/XMLTV fixture. Keep the current channel ID, queue entry, profile and paired controls. This gives a reviewable product increment without installing Ant inside the AppImage or introducing another decoder.

The first change belongs in the existing native IPTV qualification, with a small Bun fixture for Ant setup and generated input. Port only the needed private probe operations; add no repository Python or new test framework. First exercise the current application behavior. Then change the narrow interfaces where the real packaged test exposes a gap.

| Existing interface | Work in the increment |
| --- | --- |
| [Guide source resolution](../../src/server/iptv.ts) and [playlist admission](../../src/server/iptv-feeds.ts) | Reuse `getPlayable`, `getLivePlayable`, private `streamUrl` storage and bounded five-second/512 KiB capability reads. Distinguish a fixed-start EVENT timeline from ordinary live HLS if controls need that distinction. Keep URLs, API cookies and tokens out of public channel data and snapshots. Current imports reject embedded credentials/custom playback headers, so do not silently add either through M3U metadata. |
| [Session dispatch](../../src/server/session.ts) and [hub ownership](../../src/server/hub.ts) | Preserve `playbackId` fencing and source-change cancellation. Existing `goLive` starts a new load; test and document that behavior separately from the growing-recording requirement, which must consume new media on one load. Reuse the current owner; do not add a second progress observer or native instance. |
| [Native HLS options](../../src-tauri/vendor/tauri-plugin-video/src/mpv_iptv.rs), [native observations](../../src-tauri/vendor/tauri-plugin-video/src/desktop.rs), and [shared protocol](../../src/shared/protocol.ts) | Qualify the ordinary load's timeline origin and changing `duration` against actual backend segments. The probe explicitly used `live_start_index=0`; current Go live uses `-1`. Add only the native option/state fields needed by observed failures. Never turn a fresh backend edge into an assumed seekable native target when the demuxer's playlist may be stale. Restore defaults on source replacement and Stop. |
| [Playback controls](../../src/client/PlaybackControls.tsx) and [guide actions](../../src/client/GuidePanel.tsx) | Use the existing controls and mounted video stage. Verify that growing duration updates enable useful backward/forward seeks and that LIVE/Go live distinguish delayed playback from the measured edge. Show pending/error state for expired windows; reconnect must receive the same current bounds. |
| [Local progress](../../src/server/progress.ts) and [recording identities](../../src/server/recordings.ts) | Preserve the existing exclusion of live entries from local watched history. Do not relabel a running Tvheadend job as an Ant recording or replace its completed-recording/account verification. Durable growing-recording identity, transition to completed media, and backend watch-state semantics need a subsequent explicit integration after this finite channel works. |
| [Native IPTV qualification](../../tests/linux/iptv.ts) and [packaged qualification](../../tests/package/qualify.ts) | Repeat the real Ant sequence in Couch, then verify native pixels, two real HTTP controllers at the issue's required widths, source replacement, Stop, reconnect and restart without autoplay. Correct generator `bufsize` before claiming a bitrate ceiling. Keep null-output, software-rendered, packaged and physical evidence separate. |

Use a finite upstream publishing interval with retained EVENT segments and final ENDLIST for this increment. List size 15 did not bound EVENT history in the probe. Before exposing indefinite live capture, implement and test an explicit maximum duration/storage policy and expired-segment behavior; do not silently rotate playlists and claim continuity. Longer paused sessions also need a fresh-edge test because the short probe does not establish how libmpv refreshes a stale manifest after prolonged pause.

The backend for initial packaged tests remains on an isolated private network and continues recording after client Stop. Management cookie authentication passed locally; production media authorization, session expiry and redirect/child-URL credential handling are still unqualified. The later deployment handoff must name the exact Ant endpoint/build, private access method, writable retention storage and authorized input. No external subscription is needed to execute the generated local increment.

Implement after the current native/session owners merge. The session, native playback and shared protocol files overlap their active work; the research branch changes only this report. Successful finite-channel delivery advances the parent gate and does not close the growing-recording identity, long retention or physical/service acceptance requirements.

Product work still requires private authentication and retention policy; actual pause, server seeks, appended-content seeks and measured live return; same-load underrun/recovery and final EOF; bounded cancellation and independent recording; one playback/reporting owner; packaged native pixels and audio continuity; and the TV/two-controller journeys specified by the issue. No physical sound, T480 playback or external channel rights are inferred from null-output software probes.

Tvheadend master is now `4ffbc07e6da1a0c0d5e8004f8ac72d701716c4cc`. Its timeshift reader still matches the previously tested SHA256 `ba0bcbab1afe1bf814911e2c5996108e55360e370cf8f28c4c8ab2321b25a441`. The live-return proposal remains open at unchanged head `3239e33515e587fe0c7feed34be48cad648c2157`. This adds no fix or new runtime result to the separate retained ARM64 failures and AMD64 readiness failure. [Current reader](https://github.com/tvheadend/tvheadend/blob/4ffbc07e6da1a0c0d5e8004f8ac72d701716c4cc/src/timeshift/timeshift_reader.c), [upstream proposal](https://github.com/tvheadend/tvheadend/pull/2093).
