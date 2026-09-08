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

## Actual Couch baseline and EVENT start correction

Three subsequent native debug attempts used the same Ant image with Couch source `4a166ef1d236e335b5cac53447dcd6c77dc937d6`. Native binary SHA256 was `b21a73b3b524a03bf72da5c872f5bb309b665e29490d77bda90b68e35b163a62`; sidecar SHA256 was `c67350aa9634748aeeb5b62c756bd5c6a4f8e0b637f26ccfbea28f4c13b3ea1b`. The private Bun fixture imported generated M3U/XMLTV into the existing Guide and paired two actual 390-pixel HTTP browsers. Ant had 2 GiB and native Couch 4 GiB, each with two CPUs, no extra swap and isolated networking.

| Attempt | Result | Evidence manifest SHA256 |
| --- | --- | --- |
| `baseline-prN4h8` | Copying the debug binary exceeded the per-file limit before startup. The fixture now mounts the immutable binary directly. | `7dcc14234d4415589beba1d4acb4dc758b5696e5b8dcc3c3cfb6091f29953231` |
| `baseline-RdEizb` | Native playback started, but the screenshot encoder could not initialize its threads. The private capture helper now explicitly limits its FFmpeg threads. | `23d5125f6b8de4a590263fda5de620553e1a7bd8e6c20773c14fb11e0b2b5b37` |
| `baseline-TTXH1v` | Advancing native pixels and same-load pause passed. An invalid absolute-target assertion then failed. | `53d18b84f276dba576c161a88dd515e250c09334443eae14654efa835758883d` |

The final attempt ran from 02:19:54.940 to 02:20:40.889 UTC. Its first native segment request covered backend time 14–16 seconds. Screenshot clocks advanced from 14.04 to 14.76 seconds, while the retained Couch phase reported position 0.72 and duration 7.995 seconds. The second HTTP browser paused that same load at native position 2.84, and Ant extended its EVENT history to 32 seconds. A requested native target of four seconds was therefore neither a backward seek nor backend time four seconds. Requiring a new backend request also ignored cached media. The failed assertion remains failed; appended-content seek, Go live and the final Stop/backend-independence phase did not execute.

The follow-up source change recognizes fresh, valid direct EVENT playlists only at URLs whose path ends in `.m3u8`. Other URLs retain ordinary playback without a probe. The existing bounded Guide fetch and cancellation checks produce a private `eventStart` load hint. Native `live_start_index=0` requests the first segment; explicit Go live still selects `-1`, and subsequent ordinary loads restore their original defaults. FFmpeg defines this option as a segment index, with negative values counting from the end. This is a native start policy, not a generic timestamp offset. [FFmpeg HLS options](https://ffmpeg.org/ffmpeg-formats.html#hls).

The corrected fixture requires the first backend segment request and actual pixel/native timeline alignment, then rewinds after passing the target. Cached rewinds need no new request. An appended target must lie beyond the retained initial window, with subsequent native requests for its bytes and actual target pixels on the same load. The three failed baselines remain under `/tmp/couch-timeshift-app-20260908/`; each attempt removed both owned containers with independent exact-ID absence checks.

## Paced Couch EVENT sequence

The source change was built with the reviewed onboarding, Search and Bluetooth changes on base `d77af244cf6d1f6aab872e2fee0a11897284815f`. The exact staged tree was `814545ce4abd51cfff990e13a2d939669b7c2ea8`, patch SHA256 `fa80ebc523c42211a3a1a59f5551fa1d57fbd3940b59ad63e71cdb10b19b22ca`. Normal build metadata correctly reported dirty source and an unpackaged debug build. Rust and Cargo were both 1.98.1. The native SHA256 was `57d2df64b84a2f44d9da15177890259b7cb15c28733bf5b4e8641bdbba9e2b0a`; sidecar SHA256 was `890e6f6bb21dea1b8d11e15db2f1846a1403a8106f1a0bded9566aecd73593ff`.

Full Linux application compilation and 30 host Rust tests passed, with one ignored test. The first native HLS test failed with every case sharing its request log and URL, allowing late requests from earlier loads to contaminate the next assertion. The fixture now uses unique case paths and explicit EVENT tags for the EVENT cases. The strict ordinary/EVENT/Go-live/ordinary expectations remained segments 3/0/5/3 and passed on test tree `83a62d52a6d44753b65166b7dc7e4bd7b77650c5`. This changed only test code. The original failed build result remains intact; its exact compiled binaries were recovered from the private build cache without rebuilding. The passing isolated-test evidence manifest is `d07f0b854751558a845171cba04e53f86906e8e6247e65e42ab6d9ced8b84759`.

| Attempt | Result | Evidence manifest SHA256 |
| --- | --- | --- |
| `baseline-rKCsN3` | Stopped before pairing because the fixture's data-directory environment did not reach the native child, leaving onboarding open. The wrapper now exports the directory before Bun starts and seeds that same disposable installation. | `c8eaf0526e6494b7d62377275118e21838d36ab6b99b6c3dd3310fff5db27fb6` |
| `baseline-zaiztm` | Origin segment, matching source/native clocks and pause passed. Rapid Home plus four Right keys finished at 13.02 instead of 4 seconds. This exposed a control bug. | `5605c8b2e2687da084ddfe7038ed9abda58657ea4c6bfca44d7082014fa11419` |
| `baseline-XiBaK4` | The paced sequence passed all 36 named waits and its pixel, identity and backend assertions. | `6b8a519a582803b57b3c13a37091727b24cd78b91e4a95c27048776baafe40df` |

The passing run lasted from 03:28:29.187 to 03:29:31.871 UTC. Ant retained its 2 GiB limit and Couch its 4 GiB limit; no host ports were published. Both actual HTTP browsers used 390-pixel viewports. The fixture started after explicitly seeded setup and exercised real pairing and administrator claim.

| Observation | Result |
| --- | --- |
| Timeline origin | The first native segment covered backend seconds 0–2. Actual video clocks advanced from 8.76 to 10.44 seconds and aligned with native position. |
| Pause and rewind | Native held at 12.38 while Ant reached 42 seconds. Paced HTTP keyboard input reached native 4.02 and actual video time 4 on the same load. |
| Appended media | The retained initial backend window ended at 30 seconds. The same load reached native 32.02 and actual video time 32. Its target bytes were fetched after that initial window, before the seek action through prefetch. |
| Go live | A new load presented advancing video at 43.28 and 44.52 seconds. Conservative measured lag bounds were 3.787 and 4.469 seconds. |
| Stop | The second HTTP browser stopped the native load; the backend subsequently appended at least two more seconds. |
| Cleanup | Both browsers, native player and fixture closed successfully. Both owned containers were removed with independent exact-ID absence checks. |

Pacing waited for both the displayed value and native position after each key. It does not qualify rapid input. Passive browser instrumentation confirmed that a successful seek acknowledgement cleared the optimistic slider value before the target state arrived. Home briefly returned from displayed 0 to the old 12.38. The follow-up below tests the separate control correction without those per-key waits.

The passing baseline contains 65 manifest members totaling 1,068,258 bytes before the manifest. Build attempts and the failed shared-log test are retained alongside it. The compiled-binary evidence manifest is `348dd3d1c985e4f2378fd28cc51f2b245054381bed218a77f219d9300bc22b12`. Software-rendered X11 pixels and a clocked PulseAudio null sink establish this bounded playback result. They do not establish packaged delivery, audible continuity, physical hardware, durable growing-recording identity, temporary-end recovery, all required viewports or complete issue acceptance.

## Rapid Couch controls and EVENT sequence

The controlled slider now retains the keyboard target while focused and releases it on blur. Independent React/Radix tests reproduced the old acknowledgement race, including outgoing targets `[0,13,13,13,13]` from a paused position of 12.38. The corrected native build includes that change on the same base. Its staged tree is `36657fd28d59bf6efd034ea90e4b4e8e3d5d661f`, patch SHA256 `77d0441e54fcc3993aa2368f60890ad8f09d071e356979a421287059e5be85c1`. Native SHA256 is `10ef0d0d85746c66f2ddc9b829f33cb06ad88d9acccba04d42a5428cc4386de0`; sidecar SHA256 is `d3e0891d11350e1111ad8385ac52913b9aef50bad8d1fc07e09ad0d4a5ea3a50`.

Incremental native compilation passed in 16.11 seconds, with the bounded build taking 18.6 seconds overall. The earlier host and strict HLS tests were not repeated for this frontend change. Build metadata still reports dirty source and an unpackaged debug build. Build evidence is retained at `/tmp/couch-timeshift-app-20260908/native-build-keHEJo/`, with manifest SHA256 `32a919e2db9fe280ec8b716461434f2c1e471cc02a36a9e7b39c3d1468b4199b` covering 14 files and 442,052,973 bytes.

`baseline-l0fws6` passed all 37 named waits and its pixel, backend, command and cleanup assertions from 03:38:58.018 to 03:40:02.892 UTC. It used the same Ant image, isolated networking, two actual 390-pixel HTTP browsers and 2 GiB Ant plus 4 GiB native limits.

| Observation | Result |
| --- | --- |
| Timeline and pause | First segment covered backend seconds 0–2. Video advanced from 8.64 to 10.44 seconds. Native pause held at 12.78 while Ant reached 42 seconds. |
| Rapid keyboard rewind | Home followed by four Right keys, without per-key target waits, sent exactly `[0,1,2,3,4]`. Native reached 4.02 and actual video showed 4.00 on the same playback ID. |
| Slider blur | Tab moved focus away and the slider returned to the actual observed position, 4.02. |
| Shared Volume control | Home, Right and End sent `[0,1,100]`. Published system volume and independent `pactl` reads of both null-sink channels reached each value. The original level of 100 was restored and observed. |
| Appended media | Beyond the initial 30-second window, the same load reached native 32.02 and actual video time 32.00. The target bytes were fetched after that initial window and prefetched before the seek. |
| Go live | A new playback ID presented advancing video at 43.2 and 45.0 seconds. Conservative lag bounds were 4.433 and 4.803 seconds. |
| Stop and cleanup | The second HTTP browser cleared the native playback ID and reached idle; Ant then appended at least two more seconds. All fixture cleanup passed, and both owned containers were removed with independent exact-ID absence checks. |

Evidence is retained at `/tmp/couch-timeshift-app-20260908/baseline-l0fws6/`. Manifest SHA256 `f8953fd8598bff2807bca305c0b5d5aba7ce6118fdf3927ca7eb15e14be833aa` covers 65 files and 1,076,559 bytes. The earlier rapid failure and paced pass remain separate evidence. This run proves actual software-rendered pixels and the bounded null-sink control sequence. It does not qualify audible continuity, physical hardware, packaged delivery or the full growing-recording contract.

## Interruption recovery gap

A subsequent actual-Couch lifecycle run reached a real underrun but failed recovery. `lifecycle-sxcZWj` used the unchanged `36657fd` debug pair from 03:57:32.832 to 03:58:41.051 UTC. With the generated publisher suspended, Ant retained a 24-second EVENT without ENDLIST. Couch remained loading at 23.26 seconds, with identical separated native video-clock captures at 23.24 seconds. This was buffering within the final published segment, 0.74 seconds before its end, rather than proof of an internal decoder EOF.

After publisher resume, native HTTP received the expanded 26-second manifest and segment 13 at 03:58:25.795 UTC. Neither manifest contained ENDLIST, and the relay recorded no unexpected error. Couch briefly advanced, then published ended at 24.008 seconds with stale duration 23.999 at 03:58:26.747 UTC. Ant continued appending. Same-load recovery therefore failed; the later appended seek, final ENDLIST completion and held-response cancellation phases did not execute. Both owned containers were removed with exact-ID absence checks.

The failure is retained privately at `/tmp/couch-timeshift-app-20260908/lifecycle-sxcZWj/`. Manifest SHA256 `f4c79a40a44f4881f4e46a4fb948ef1adfeec910e089828d7193a83462fff6f9` covers 53 files and 926,242 bytes. Two preceding attempts remain failed: `lifecycle-ZDM0bd` omitted the replacement channel's XMLTV definition, and `lifecycle-hILp6r` required underrun within an unsupported half-second distance from the backend edge. Their manifests are `d5d0d5378434f0daf385d8fa06bfb3705698a443c4609d259052df0a3a5e6a8e` and `1e9ba78eff5a7dcdac773fd6303c4506c300f8d19008f9c9933a4e9e9e7175b9`.

Diagnosis is comparing FFmpeg's bounded HLS reload option with the current defaults through the existing libmpv interface. The pinned upstream 6.1.1 source defaults `max_reload` to 3 and can return EOF when that per-read reload budget is exceeded; `m3u8_hold_counters` is a separate counter defaulting to 1000. This is a candidate cause, pending installed-library readback and a causal regression. No automatic source reload or new transport is implemented. [Pinned HLS demuxer](https://github.com/FFmpeg/FFmpeg/blob/n6.1.1/libavformat/hls.c).

## Remaining Couch increment

Complete qualification of **one finite EVENT channel through the existing guide and packaged player**. Use generated input on the already tested separate Ant server, imported through the ordinary M3U/XMLTV fixture. Keep the current channel ID, queue entry, profile and paired controls. This gives a reviewable product increment without installing Ant inside the AppImage or introducing another decoder.

The private Bun fixture now supplies Ant setup and generated input, and the corrected debug sequence passes. Integrate the necessary checks into the existing native IPTV and packaged qualifications. Add no repository Python or new test framework. Change only the narrow interfaces where actual playback exposes a gap.

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

The EVENT start correction builds on the merged native/session changes. Successful finite-channel delivery advances the parent gate and does not close the growing-recording identity, long retention or physical/service acceptance requirements.

Full acceptance still requires private authentication and retention policy; packaged repetition of the demonstrated pause, seeks, live return and Stop sequence; same-load underrun/recovery and final EOF in Couch; cancellation during backend wait; durable growing-recording identity and completion; audio continuity; and the TV/two-controller journeys specified by the issue. Keep one playback/reporting owner. No physical sound, T480 playback or external channel rights follow from these software tests. Issue #67 remains open.

Tvheadend master is now `4ffbc07e6da1a0c0d5e8004f8ac72d701716c4cc`. Its timeshift reader still matches the previously tested SHA256 `ba0bcbab1afe1bf814911e2c5996108e55360e370cf8f28c4c8ab2321b25a441`. The live-return proposal remains open at unchanged head `3239e33515e587fe0c7feed34be48cad648c2157`. This adds no fix or new runtime result to the separate retained ARM64 failures and AMD64 readiness failure. [Current reader](https://github.com/tvheadend/tvheadend/blob/4ffbc07e6da1a0c0d5e8004f8ac72d701716c4cc/src/timeshift/timeshift_reader.c), [upstream proposal](https://github.com/tvheadend/tvheadend/pull/2093).

## Existing Ant recordings in Couch

The accepted workflow attaches an existing Ant broadcast in Recording setup. Ant owns capture, scheduling and storage; Guide scheduling continues to use Tvheadend. [The Ant adapter](../../src/server/ant-recordings.ts) stores a Couch recording UUID and the exact application/account, broadcast creation time, publishing start time and planned end. Reusing or restarting that broadcast cannot silently replace the recording. Completed playback retains the same EVENT playlist and timeline.

Use a dedicated read-only Basic-authenticated reverse proxy over HTTPS, or loopback HTTP, protecting both broadcast API reads and every HLS object. Ant Community's permissive token service is not an authentication substitute. Attachment checks anonymous rejection for the broadcast, playlist and first/last listed segments. These checks sample the proxy policy; the backend administrator must protect the entire application path. Credentials remain in Bun. Native playback receives a random lease on the existing hub's loopback-only media route. Browser-origin requests, redirects, nested manifests, keys, nonzero starting sequences and child paths outside the selected direct TS recording are rejected. The adapter reads no backend watch-state mutation endpoints.

The route permits four concurrent media reads per playback, eight seconds per upstream request, a 512 KiB manifest and 16 MiB per TS segment. Segment bodies stream with backpressure and a measured byte ceiling even without Content-Length. Background reconciliation shares an eight-second budget and rotates its starting job after a slow backend. Stop, replacement, credential changes and shutdown revoke leases and cancel their requests. These limits are application contracts, not measurements of a packaged native run.

The administrator declares finite capture hours, retention days and backend storage quota. Couch requires a started broadcast with a finite planned end within that capture limit and computes the attachment's expiry from its planned end plus retention days. These settings do not install or verify a backend quota/deletion policy. Ant must retain HLS after capture, use a fresh stream ID for each capture, enforce the declared limits and keep API identity metadata for retained files. Couch never deletes backend media. An exceeded deadline, expired retention, replaced generation, denied access or missing file produces an explicit unavailable state; Refresh can recover transient failures. The manifest/segment ceilings still apply before a declared time limit is reached.

Local resume remains owned by the active Couch profile. Ant recordings require actual native EOF after a same-generation terminal backend state and ENDLIST before watched completion or automatic queue advancement. Stop near a growing or completed Ant recording's current end preserves resume. Premature EOF produces an explicit error with Play-to-resume, without inventing an endless transport retry. Existing Tvheadend job/account verification and completed-recording behavior are unchanged.

Focused tests cover durable attachment/completion, HTTP Range bytes, private-media access, replacement/expiry, byte/concurrency limits, pending Stop, source/profile progress and paired-remote controls. This increment still needs reviewed packaged qualification against the actual authenticated Ant deployment, including its storage policy, generated media, native pixels/audio and required controller widths. Software tests do not close issue #67.
