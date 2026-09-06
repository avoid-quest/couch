# Live and growing playback qualification

Investigation for [Qualify a stable live/growing-timeshift backend and maintained host client](https://github.com/avoid-quest/couch/issues/67), checked on 2026-09-06. Couch base is `b7031b9258b385371e1f09df0f325a19c3e2c093`, whose [main CI run passed](https://github.com/avoid-quest/couch/actions/runs/33996451171). The [CI budget gate is closed](https://github.com/avoid-quest/couch/issues/43#issuecomment-5555040631). The [accepted DVR research](https://github.com/avoid-quest/couch/issues/36#issuecomment-5555352485) is the prerequisite, not an implementation branch. Packaging remains an open native blocker.

## Current result

The newer official Debian ARM64 Tvheadend build also exits 139 after the retained exact `subscriptionLive` sequence. It delivered live media, paused server delivery, sought backward, and resumed before that failure. This rejects this measured build/configuration for exact live return. It does not establish a root cause or a result for x86_64, other configurations, or an unmerged upstream patch.

A maintained standalone HTSP client does exist. Its published Kotlin/JVM library and companion SDK deserve further qualification. Their documented media integration targets Android Media3; no supported adapter to Couch's existing libmpv was selected or run here. This remains an integration investigation, not proof that no suitable client exists.

On a fresh server, raw growing-file reads passed temporary EOF followed by new bytes on the same handle. Omitting `playposition` while closing with `playcount=0` preserved backend watch state. HTTP delivery through the current file end incremented playcount without observed viewing completion. None of these checks establishes packaged Couch live or growing playback.

## Backend candidates and source evidence

Tvheadend identifies 4.3 as its supported rolling stable release and recommends its own packages and Debian container. The old 4.2 line is unsupported. The probe therefore tested the official image as a meaningful packaging/libc comparison with the earlier LinuxServer Alpine image. [Official downloads](https://tvheadend.org/p/downloads), [pinned Debian image recipe](https://github.com/tvheadend/tvheadend/blob/f7f114e9b7d80e4b32b2f708c8520e2a414a2533/Containerfile.debian).

| Candidate | Exact identity and disposition |
| --- | --- |
| Earlier failing LinuxServer ARM64 image | Digest `ccd9f055f0eb5c78c43b40397e35ff30a884a40389222ef04f2e33efecbd3067`, Tvheadend `4.3-2735~gfcd987f0b`. Retained unchanged through the [accepted report and ordered GDB evidence](https://github.com/avoid-quest/couch/blob/84edbdbf57c57dae4642e3290d06c2948ea099e9/docs/research/dvr-timeshift.md). |
| Official Debian ARM64, tested here | `ghcr.io/tvheadend/tvheadend@sha256:df54bdaa39de5311f127c538403894fcec7bc7b251fdefb7f40cbec013faea8c`. Actual runtime `4.3-2768~gf7f114e9b`, API 20. It advertises HTSP 44; this comparison requests and uses 41. Exact live return failed. |
| Official Debian x86_64 | Manifest `2f4e3a493f01d91c4f59a1d18aeee98ba7afcef85822583e4a072d25da1d174b` was inspected over the registry API, then pulled and confirmed locally as AMD64. Startup stopped at the missing generator prerequisite before any container was created. No runtime or target result is inferred from ARM64. |
| Upstream live-return proposal | [PR 2093](https://github.com/tvheadend/tvheadend/pull/2093), open and unmerged at head `3239e33515e587fe0c7feed34be48cad648c2157`. It replaces the flush-to-live path and adds a null guard. It was not built or tested here. Its author's later comment reports decoder restart concerns and a near-live workaround; the initial success report is insufficient qualification. |

The official multi-platform index is `a5c639542fa4c9b5222e903b2f564cc5a07b0220be4c57b0a66f43e23c5ce23b`. Its ARM64 layers total 337,589,190 compressed bytes. Registry config labels identify source `f7f114e9b7d80e4b32b2f708c8520e2a414a2533`, also confirmed by the runtime version. The executed server SHA-256 is `1cf1bb5e942e5e1514372cfbfcb498c8a9c24a9feae851f948d7712e8d405f3f`.

The old and current `src/timeshift/timeshift_reader.c` files are byte-identical, 26,261 bytes, SHA-256 `ba0bcbab1afe1bf814911e2c5996108e55360e370cf8f28c4c8ab2321b25a441`. This is a source comparison, not a causal diagnosis. [Old reader](https://github.com/tvheadend/tvheadend/blob/fcd987f0b4666c966e4bcfef52adf84def116d23/src/timeshift/timeshift_reader.c), [tested reader](https://github.com/tvheadend/tvheadend/blob/f7f114e9b7d80e4b32b2f708c8520e2a414a2533/src/timeshift/timeshift_reader.c).

## Real backend probe

The coordinated `timeshift-backend-debian-1` window used about eleven minutes of its twenty-minute ceiling, including retained setup failures and cleanup. Docker Desktop was `4.89.0`, Engine `29.7.2`, Linux ARM64. Each of the two containers had one CPU, 768 MiB memory with no additional swap allowance, and 128 PIDs. Before-start inspections verify those limits, the exact images, mounts, and port bindings.

The server and generator/probe containers were `couch-timeshift67-server` and `couch-timeshift67-probe`, on `couch-timeshift67-net`. Only `127.0.0.1:26781` and `127.0.0.1:26782` were published. Both image-declared volumes, `/var/lib/tvheadend` and `/var/lib/tvheadend/recordings`, had explicit private bind mounts. Timeshift, input, and evidence mounts also belonged to this worktree's `.artifacts/timeshift`. No named, anonymous, preview, native-cache, or source-checkout volume was mounted.

The existing test image was pinned to local image ID `sha256:3ef268e766f3f4c192f173cba086ab8a07e3ca75ddc1ba2862aae2a8d7f23366`. Its FFmpeg `6.1.1-3ubuntu5` generated one authorized MPEG-TS HTTP input on the isolated network. Input was 320×180 at 25 fps, MPEG-2 video with GOP 25 and 400 kbit/s target, plus mono MP2 at 96 kbit/s from a generated 500 Hz sine. Each generator request had a 180-second media ceiling. Recordings used the pass-through profile; the largest retained recording was 1,096,228 bytes. Scheduling used explicit times and fresh backend IDs. No imported XMLTV guide or external feed was tested in this probe.

Timeshift readback confirmed enabled, on-demand disabled, `/timeshift`, two minutes, 64 MiB, and zero RAM buffer. The client requested 120 seconds. The Python probe capped a decoded HTSP frame at 4 MiB and discarded packet bodies after logging metadata/hash and writing selected samples. It is a diagnostic client using the retained upstream Python codec, not a proposed product transport.

Generated admin, recorder, and viewer accounts used private random passwords. Bootstrap used `--noacl` only before restart; the measured probes ran after authenticated readiness without that flag. Anonymous DVR access returned 401; the viewer's DVR request and the recorder's access-control request returned 403; recorder DVR access returned 200. A future recording cancellation returned success, the job disappeared, and server health remained good in all four attempts.

### Attempt ledger

| Attempt | Observed result |
| --- | --- |
| 1 | The fixture mapped the first discovered service before metadata scan completion. After bootstrap restart, the channel had no services. HTSP denied playback and recording reported no assigned adapters. A subsequent missing-PTS assertion was a probe error. The vacuous zero-packet pause assertion is not playback evidence. Server normal exit was 0. |
| 2 | Waiting for `svcname=Lab1` and scan completion still did not preserve the channel/service mapping across restart. No playable channel was admitted. The restart/mapping problem remains unresolved; it was not attributed to credentials or a server crash. Server normal exit was 0. |
| 3 | Accounts were bootstrapped first, then fresh input/channel configuration was created after authenticated restart. The exact live sequence reached the server and failed at return to live. No recording was active during that failure. |
| 4 | Fresh authenticated input setup again; growing-file, watch-state, pending cancellation, and recording-after-unsubscribe checks passed. Exact live return was omitted because attempt 3 already retained that failure. |

Epoch timestamps in `events.jsonl` are wall-clock seconds. Monotonic values are nanoseconds within the emitting Python process; phase elapsed values use that process's clock. HTSP PTS/DTS/control coordinates use microseconds because `90khz` was omitted. File positions and payload sizes are bytes. Cross-process ordering uses epoch timestamps, not subtraction of different processes' monotonic values.

### Exact live sequence

The ordered request bodies, each logged before sending, were:

```json
{"method":"subscribe","seq":3,"channelName":"Lab1","subscriptionId":1,"timeshiftPeriod":120}
{"method":"subscriptionSpeed","seq":4,"subscriptionId":1,"speed":0}
{"method":"subscriptionSkip","seq":5,"subscriptionId":1,"absolute":1,"time":8780000}
{"method":"subscriptionSpeed","seq":6,"subscriptionId":1,"speed":100}
{"method":"subscriptionLive","seq":7,"subscriptionId":1}
```

| Operation | Measured result in attempt 3 |
| --- | --- |
| Subscribe and observe 12 s | 769 packets, 751,177 payload bytes; video PTS 740,000 through 12,780,000 µs. |
| Server speed 0, observe 6 s | Zero packets; timeshift end advanced to 17,900,000 µs and shift to 5,120,000 µs. |
| Absolute backward skip to 8,780,000 µs | Paused video packet at PTS 8,740,000 µs. |
| Server speed 100, observe 5 s | 400 packets, 357,590 bytes; video PTS 8,780,000 through 14,740,000 µs. |
| Exact `subscriptionLive` | Synchronous acknowledgement, then transport EOF about 3 ms into the observation. The server exited 139 at `2026-09-05T23:15:51.391625303Z`, `OOMKilled=false`. No exact-live media sample followed. |

The largest observed payload totals in epoch-aligned 100 ms buckets were 36,248 bytes while live and 58,540 while resumed. These are host receive/log timing measurements, affected by scheduling and bucket boundaries. They are not a wire capture, decoder latency, or proof of bounded return-to-live delivery. The crash prevents that acceptance.

FFprobe counted 279 frames in the retained live elementary sample and 126 in the resumed sample. Capture-boundary decoder warnings remain in the logs. No native video/subtitle pixels, measured audio continuity, or end-to-end presentation is inferred from these partial samples.

This run has no GDB trace. The earlier Alpine run's ordered SIGSEGV/backtrace remains the diagnostic baseline. Its separate second exit, historically associated with cancellation but missing the alleged request/exception, remains unexplained. The newly logged successful cancellations neither explain that exit nor prove long-term cancellation reliability.

### Growing files and reporting

Attempt 4 used one HTSP file handle. `fileSeek(SEEK_END)` followed by `fileRead` returned zero bytes. Five seconds later, `fileStat` had grown from 147,768 to 551,592 bytes, and the same handle returned 18,800 new bytes. Seeking to the old size also returned newly written bytes. This is raw file transport evidence; no libmpv instance consumed the growing file.

The backend started with `playposition=17`, `playcount=0`, `watched=0`. `fileClose` with `playcount=0` and no `playposition` preserved all three. A subsequent read on that closed handle returned `Invalid file`. An authenticated HTTP range through the current final segment then changed playcount to 1 and wrote a watched timestamp while the recording was still running. This confirms the [tested close handler's optional position write](https://github.com/tvheadend/tvheadend/blob/f7f114e9b7d80e4b32b2f708c8520e2a414a2533/src/htsp_server.c#L3049) and the [HTTP handler's transfer-completion side effect](https://github.com/tvheadend/tvheadend/blob/f7f114e9b7d80e4b32b2f708c8520e2a414a2533/src/webui/webui.c).

A live subscription received packets while recording, then unsubscribe stopped its delivery. Recording size still increased from 816,672 to 1,012,756 bytes across the next three seconds. The retained recording-head sample contained 44 MPEG-2 video frames and 70 MP2 audio frames, with truncation warnings. It does not establish continuous video/audio across temporary EOF in a player.

The last running sample measured server memory at 22.02 MiB with 28 PIDs and generator memory at 33.46 MiB with 38 PIDs. Docker reports PIDs including threads. These are point samples, not peaks. Normal server stop took 328 ms and exited 0. The Python generator ran as PID 1 and required Docker's five-second stop escalation, exiting 137 without OOM. All containers and their child processes were removed; graceful generator shutdown was not demonstrated. Exact-name inspection confirmed both containers and the network absent. Generated credentials and backend password records were deleted, with deletion events retained. Images and unrelated resources were preserved.

### AMD64 startup attempt and available generator

The granted `timeshift-backend-amd64-1` window started at `2026-09-06T00:03:31Z` and ended at `00:04:09.956346Z`, before its `00:18:31Z` deadline. The driver ran for 17.7 seconds; total window elapsed time was 38.956 seconds. The exact official AMD64 manifest pulled successfully and image inspection confirmed its architecture and digest. The next lookup returned `No such image` for the previously measured generator ID `sha256:3ef268e766f3f4c192f173cba086ab8a07e3ca75ddc1ba2862aae2a8d7f23366`.

The launcher returned exit 1 and retained a failed driver check. Both reserved container names and the network were absent at the initial checks, and no create/start/network-create operation occurred. No credentials or media were generated. The downloaded server image remains cached. This attempt produced no server runtime, emulation, live/growing-playback, or generator SIGTERM result. The prepared scripts had passed syntax preflight, including explicit failed-check handling, but those runtime behaviors were not exercised.

Authorized read-only discovery then found one available candidate, `couch-linux-test@sha256:3f6c58f34be506b1ca75ed7fbf67d4edc6e5a18322577a957991cae737e9e38f`, Linux ARM64. The repository's `scripts/linux-test.ts` uses its `couch-linux-test:ubuntu24.04` tag and `tests/linux/Dockerfile`. All nine RootFS layer hashes, the complete image configuration and creation timestamp match the previously measured generator. Its index identity differs. That supports an unchanged filesystem baseline, including the previously measured FFmpeg `6.1.1-3ubuntu5`; the candidate was not executed during discovery.

The prior filesystem ran Python's HTTP/subprocess generator and FFmpeg's `testsrc2`, `sine`, MPEG-2, MP2 and MPEG-TS pipeline, plus ffprobe frame counting. The Dockerfile installs FFmpeg through Ubuntu packages and does not pin its package version. Exact Python version and per-file Python/FFmpeg/ffprobe SHA-256 values were not captured previously and cannot be obtained from image inspection alone. The next granted runtime must record their real paths, versions, hashes and required capabilities before media generation. Any difference creates a new measured baseline. The missing cached ID is a local coordination gap; it requires neither user hardware nor an external account.

The separate AMD64/discovery bundle contains 27 files and its internal manifest, all 28 members verified. Archive SHA-256 is `f0ca4656388d389fba8165594109e0c5ef04785afef28a39e63028aa8274030c`, 26,089 bytes; internal manifest SHA-256 is `4c57ec05e8f38e658792e466218768bed79bf5bbe6251dc08ceb108938bf9f5d`. The [evidence manifest](timeshift-evidence.md#amd64-preflight-and-generator-discovery) identifies the prepared scripts, failed lookup, available image inspection and wrapper/Dockerfile snapshots. The copied `timeshift-amd64/evidence/probe-image.json` is prior input evidence, not a successful current lookup.

## Maintained client and libmpv boundary

The strongest standalone candidate found is [`at.bernhardberger.tvheadend:htsp:0.7.0`](https://repo.maven.apache.org/maven2/at/bernhardberger/tvheadend/htsp/0.7.0/). The companion [`sdk-core:0.6.1`](https://repo.maven.apache.org/maven2/at/bernhardberger/tvheadend/sdk-core/0.6.1/) and [`sdk-playback:0.6.1`](https://repo.maven.apache.org/maven2/at/bernhardberger/tvheadend/sdk-playback/0.6.1/) are also published. Their POMs, binary JARs, source JARs, and registry metadata were downloaded and hashed without installation or execution. All inspected class files target major version 61, Java 17. The libraries declare GPLv3, Kotlin stdlib 2.4.10, and coroutines core JVM 1.10.2. The core SDK additionally depends on the other two libraries. JVM distribution and any downstream redistribution obligations still need package review; this is not a legal conclusion.

| Artifact | Binary JAR SHA-256 |
| --- | --- |
| HTSP 0.7.0 | `4243755adac1e86177b7d5a76ab2a8282790ff1dfe63f32c7e4f70179cf7e44e` |
| SDK core 0.6.1 | `36f0ec6ab3fe9d4143aff1768181ba1cad8fcb57275d4f1495d06a6f61bc1f75` |
| SDK playback 0.6.1 | `6707a2546975958d5d33f575c4529506a383421241f414551c026967df92ef04` |

The current source heads inspected were HTSP `991ae11326666fa7e70855dade9c71232a6a7879` and SDK `8f30f58e8d501d8099b25a744d3904426bbd4bbf`, both committed September 5. Published source JARs were checked separately rather than assuming these checkout heads were the releases. The API is provisional during major version zero. [Client contract](https://github.com/bernhardberger/tvheadend-htsp/blob/991ae11326666fa7e70855dade9c71232a6a7879/docs/public-api.md), [compatibility policy](https://github.com/bernhardberger/tvheadend-htsp/blob/991ae11326666fa7e70855dade9c71232a6a7879/docs/versioning.md).

The published client has typed authenticated requests, ordered per-subscription events, generation fencing, cancellation propagation, socket closure, and job joins. Defaults are 10 s connect timeout, 5 s response timeout, 60 s socket-read timeout, and a 64 KiB socket buffer request. The codec rejects frames over 32 MiB. Metadata has a 1,024-event budget; each subscription has an 8,192-event budget with ordered packet-drop markers and control backpressure. Those event counts are not an appliance-sized byte/RSS budget. A stalled consumer, large packets, close during blocking I/O, and process/thread cleanup require actual runtime measurements before selection. [Published client sources](https://repo.maven.apache.org/maven2/at/bernhardberger/tvheadend/htsp/0.7.0/htsp-0.7.0-sources.jar).

`HtspEndpoint.toString()` redacts the password but includes endpoint and username. Its default socket is ordinary TCP. Host-private credential storage, transport protection beyond the local test network, and log handling remain Couch integration responsibilities. No raw endpoint, credential, backend locator, or authentication object should enter shared public state.

The SDK's growing reader has a 16 MiB maximum read and a 30-second no-progress timeout. It preserves a generation/file identity lease and waits through temporary EOF. Final EOF requires fresh completion and a final stat. When that stat supplies a size, the reader drains the known size; when it omits size, the reader continues until an empty read. Future client qualification must exercise both branches, including the unknown-size case. The approximate growing-TS index and decoder integration are in Android `sdk-media3`, using Media3 `TsExtractor`; they are not a libmpv adapter. [Published core sources](https://repo.maven.apache.org/maven2/at/bernhardberger/tvheadend/sdk-core/0.6.1/sdk-core-0.6.1-sources.jar), [Media3 extractor integration](https://github.com/bernhardberger/tvheadend-sdk/blob/8f30f58e8d501d8099b25a744d3904426bbd4bbf/sdk-media3/src/main/kotlin/at/bernhardberger/tvheadend/sdk/media3/GrowingTsExtractor.kt).

libmpv 0.37's documented `mpv_stream_cb_add_ro` accepts byte-oriented read/seek/size/close/cancel callbacks. Reads must block for new data; returning zero signals final EOF. Cancel runs on another thread and must not block. Callbacks must not call that same libmpv instance, and their registration survives until the mpv core is destroyed. The header marks this API unstable. It provides a possible native boundary, not HTSP demuxing, timestamp-to-byte mapping, live-edge state, or a JVM bridge. [Pinned libmpv callback contract](https://github.com/mpv-player/mpv/blob/818ce7c51a6b9179307950e919983e0909942098/libmpv/stream_cb.h).

For live HTSP, an adapter would still need to feed packet metadata and elementary streams into a maintained mux/demux path compatible with libmpv, coordinate time seeks and decoder resets, and fence replacement/cancellation. For growing recordings, it would need to connect the maintained byte reader to libmpv without exposing temporary EOF or stale file identity. Building these adapters is custom integration with maintenance obligations. No such architecture or implementation was authorized by an actual owner decision in this phase.

### Other candidates checked

| Candidate | Evidence and remaining mismatch |
| --- | --- |
| Kodi pvr.hts | Maintained, but its CMake requires Kodi and delivers a Kodi add-on. The [accepted inspection](https://github.com/avoid-quest/couch/blob/84edbdbf57c57dae4642e3290d06c2948ea099e9/docs/research/dvr-timeshift.md) remains applicable. |
| Tvheadend Python HTSP client | Standalone protocol code, but inspected default-branch commit `a281fb03818379d5117b87ec7faf3bcb426f34db` is from December 2016. No maintained libmpv transport/lifecycle contract was found in its [source](https://github.com/tvheadend/python-htspclient/tree/a281fb03818379d5117b87ec7faf3bcb426f34db). |
| tvhcc | Its [README](https://github.com/ChrisOboe/tvhcc) describes an HTTP API command-line launcher for external mpv, not HTSP timeshift. It does not meet the embedded-player requirement. |
| satTV | Recent source and useful author reports, but its [README](https://github.com/oliversluke/satTV) describes Apple-platform application builds, its own FFmpeg rendering pipeline, and source-available redistribution restrictions. No Couch adapter was selected from it. |
| Jellyfin HTSP Tuner | Its [upstream README](https://github.com/vk496/jellyfin-htsp-tuner) describes HTSP-to-MPEG-TS remux inside Jellyfin, a 100 MB ring, Jellyfin 10.11+/net9, and HTSP 43+. It delegates recording to Jellyfin and excludes Tvheadend-native DVR. It is a server plug-in, not a standalone Couch client. Its claimed support was not run here. |
| Flussonic DVR over HTTP | The [vendor streaming API](https://flussonic.com/doc/api/streaming/) documents authenticated DVR/time-shift manifests. A standard-media backend is an alternative direction to investigate before committing to custom HTSP transport. No build, license entitlement, account, storage, libmpv sequence, or growing-playback result was qualified here. |

The Kotlin client's near-live helper and the SDK's return control use an absolute skip behind the observed edge. Their documentation explicitly avoids guaranteeing exact live mode. This may be a useful separate experiment, but it cannot be relabeled as a passing exact `subscriptionLive` sequence. [Near-live contract](https://github.com/bernhardberger/tvheadend-htsp/blob/991ae11326666fa7e70855dade9c71232a6a7879/docs/public-api.md), [upstream author's later assessment](https://github.com/tvheadend/tvheadend/pull/2093#issuecomment-4189432461).

## Remaining decisions and product gates

The proposed next window is `timeshift-backend-amd64-2`, pending a new orchestrator resource grant. It would reuse the cached official x86_64 manifest with existing emulation and the newly pinned ARM64 generator candidate above, after binary/capability preflight. Allow fifteen minutes, one CPU, 768 MiB and 128 PIDs per container, and at most 2 GiB generated disk. No pull or build is needed. The official x86_64 manifest totals 346,472,467 compressed bytes. Stop if either pinned image is unavailable or existing emulation cannot execute it; installing emulation or substituting a build needs another proposal.

Use containers `couch-timeshift67-amd64-server` and `couch-timeshift67-amd64-probe`, network `couch-timeshift67-amd64-net`, and only loopback ports 26881/26882. All image-declared volumes and input/evidence/timeshift directories bind under this worktree's fresh private `.artifacts/timeshift-amd64-2`. Retain before-start architecture, binary/version, limits and mount inspection. Repeat the ordered live sequence and fresh growing/watch-state check with the same generated input, 32 MiB recording ceiling and two-minute/64 MiB timeshift limit. Verify channel/service mapping across one authenticated restart separately. The diagnostic generator's PID 1 signal handling is corrected in the prepared scripts; graceful cleanup still needs measurement. No product code, JVM runtime, source build, patch, preview or target access belongs to this proposal.

This comparison can reveal a build/architecture difference at modest download cost, but emulated timing does not qualify hardware performance or packaged playback. If it also fails, a separately bounded test of pinned upstream PR 2093 can examine its claimed repair. That patch is unmerged and would introduce a maintenance obligation if adopted. Keep restart/mapping persistence separate from exact live-return failure. No existing result qualifies a server build yet.

The next client task is to qualify the published JVM transport under realistic packet pressure and blocking-I/O cancellation, and establish whether its maintainer supplies or supports a libmpv adapter. A runtime probe alone would not fill that adapter gap. If maintained interfaces remain insufficient, the real owner must choose whether to maintain a host JVM/libmpv adapter, fund or wait for an upstream adapter/fix, or investigate a backend that supplies standard seekable media. The orchestrator and worker cannot choose that maintenance commitment for the owner. The orchestrator creates any resulting bounded implementation children and native dependencies after that decision.

| Issue 67 criterion | Evidence now and remaining acceptance |
| --- | --- |
| 1. Stable maintained backend | Official Debian ARM64 comparison performed; exact live return failed. Other builds/configurations, longer buffer/overload behavior, and cancellation reliability remain open. |
| 2. Maintained host client | Real published standalone candidates and package/source contracts identified. Supported libmpv integration, runtime auth/pressure/cancellation/unload/cleanup qualification remain open. |
| 3. Owner decision if custom work is needed | Concrete interface gaps and alternatives recorded. No real owner decision or implementation child has been created by this worker. |
| 4. Packaged live controls | Unrun. Requires a selected working transport and the appliance package, then TV and paired HTTP live/pause/seek/edge/error/replacement/Stop/reconnect/shutdown flows. |
| 5. Growing recording playback | Raw temporary EOF/new-byte/seek passed. Same logical libmpv playback, new-content seeks, video/audio continuity and buffering remain unqualified. |
| 6. Authority and reporting | Raw close-without-position policy and HTTP side effect measured; recording continues after unsubscribe. Couch/native progress ownership, profile/queue identity, cancellation, stopped restart, commit-before-broadcast and reconnect snapshots still require implementation and product checks. |
| 7. Native pixels and controllers | Unrun at all seven required HTTP widths: 320, 375, 390, 768, 1024, 1440, 1920. No 1600×1000 native test display or packaged target display was exercised. Subtitle pixels, controls/portals, mounted VideoStage and device-local browsing remain open. |
| 8. Authorized real input/service | Real disposable backend and generated authorized A/V input tested. No external service, imported guide, physical sound, tuner, hardware decode, or reception claim. Actual service qualification still needs its endpoint/version, rights/access, writable storage and authorized guide/input/concurrency or tuner/driver details. |
| 9. Delivery, CI and preview | This is a research/evidence layer. Product implementation, independent review, required CI, dependency-ordered gh-stack merge and coordinated preview rebuild remain open. |

Keep Bun HTTP/WebSocket and SQLite authoritative. Native playback, private credentials and upstream progress reporting remain host-owned. A JVM helper, if chosen later, must not introduce a second player or shared-state owner. Reuse landed guide/account/job identities when the chosen implementation needs them, then add those native dependencies. Preserve cancellation, stopped restart, mounted VideoStage, native controls/resets and the shadcn Mira presentation. [Canonical media map](https://github.com/avoid-quest/couch/issues/25).

## Evidence and replay

The private artifact root is `/Users/devit/Code/couch-media-timeshift/.artifacts/timeshift`. `attempt1`, `attempt2` and `attempt3` preserve their actual scripts, logs and configuration; top-level scripts and `evidence` are attempt 4. `measurement-summary.json` summarizes the retained events without replacing raw evidence. Source and Maven manifests record exact URLs, byte sizes and hashes. The previous failure bundle remains at its original path and SHA-256 `8d8692b41c9c9465c5ee1e4ddf5498e3fb90fd4ce27ebeb584951801e8e050a7`.

The tracked [evidence manifest](timeshift-evidence.md) hashes 291 files in the private `evidence.tar.gz`, 4,263,848 bytes, SHA-256 `14c66b7b6c828da9ae02452c05e6d0bea89d1408ecb0fb344a670a2a33b6db30`. Its internal manifest has SHA-256 `eb2d08f7aa6faacaf54ae750b61db1349dfea2fd23f21aa22b594c80e23417af`. All 292 archive members were verified, including that manifest. The bundle contains ordered logs, inspections, actual scripts, media samples and source/package snapshots. It excludes raw backend configuration, credentials and complete recording files. The archive remains private local evidence; the repository carries its manifest and this report.

The launcher is private diagnostic material, not a product test runner. A fresh coordinated replay needs Docker ARM64 and the exact existing test image, a fresh private artifact directory, copied probe scripts and `prior/runtime-source/lib/py` codec, the recorded official server digest, empty writable config/recordings/timeshift/evidence directories, the saved `evidence/probe-image.json`, and a new authorized `evidence/window.json`. Update names, network, ports and deadline to match that reservation before running `run.py` from the fresh root. It creates and inspects both containers before start, waits for authenticated readiness, discovers fresh service/channel IDs, logs requests before sending and exceptions afterward, and removes only resources it created. The current scripts reproduce the growing-only attempt. Copy attempt 3's probe script into the fresh root to reproduce the exact live sequence; keep the corrected post-authentication fixture order.

The retained `probe.py` catches failures and writes failed checks without returning a nonzero exit status. `run.py` also catches driver failures before cleanup. Process success and `CLEANUP FINISHED` therefore do not establish acceptance. Inspect `checks.json`, ordered events and container state together, including failed assertions, exceptions and exit/OOM state.

The two bootstrap failures are retained because serverinfo readiness and even discovered service metadata did not prove restart-stable channel mapping. A replay must verify channel services after any restart. Generated credentials are intentionally absent; setup creates new ones. The existing local test-image identity is a prerequisite rather than a portable published image. No clean-machine replay, long-running endurance test, or restart-persistence fix is claimed.

No product source, native/session/store/protocol/packager code, or test runner changed. Full native/HTTP tests and a preview rebuild did not run because this phase made no product change and held no native/preview/target reservation.
