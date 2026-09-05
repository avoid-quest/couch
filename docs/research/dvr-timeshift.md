# DVR and live-timeshift backend qualification

Tvheadend supplies real scheduling, recording and HTSP timeshift operations, but the tested path is not ready for Couch live timeshift. A documented return-to-live request reproducibly crashed the server. Growing-recording reads worked over HTSP; the existing libmpv played and sought within an HTTP recording whose response had a finite end. Those are different results.

This is the research artifact for [issue #36](https://github.com/avoid-quest/couch/issues/36), under the [media map](https://github.com/avoid-quest/couch/issues/25). Couch source was unchanged at `209c95741dca0dcf6e269687f0a66968826b54da`. The [closed CI prerequisite](https://github.com/avoid-quest/couch/issues/43#issuecomment-5555040631) and [successful validation of that exact SHA](https://github.com/avoid-quest/couch/actions/runs/33993872653) were checked before research. The native blocked-by list contained only closed #43. The orchestrator owns review, child creation and research closure. These probes close no product gate.

Measured on 2026-09-05, approximately 22:05 to 22:19 UTC, which is September 6 in Europe/Rome. All input was generated locally. No T480 connection, shared preview, shared build volume, public television service or protected account was used.

## Exact environment

| Component | Qualified configuration |
| --- | --- |
| Server | Tvheadend `4.3-2735~gfcd987f0b`, JSON API 19, server HTSP maximum 44; probe negotiated 41 |
| Server source | [`fcd987f0b4666c966e4bcfef52adf84def116d23`](https://github.com/tvheadend/tvheadend/tree/fcd987f0b4666c966e4bcfef52adf84def116d23), July 18, 2026 |
| Image | `lscr.io/linuxserver/tvheadend@sha256:ccd9f055f0eb5c78c43b40397e35ff30a884a40389222ef04f2e33efecbd3067`; ARM64, Alpine 3.20.10; image label `fcd987f0-ls285` |
| Container runtime | Docker Desktop 4.89.0, Engine 29.7.2, Linux ARM64; server limited to one CPU and 512 MiB |
| Input | Two IPTV `pipe://` inputs running FFmpeg 6.1.1. `testsrc2` and `smptebars`, 320×180 at 25 fps, MPEG-2 video, GOP 25, 400 kbit/s target; mono MP2 at 96 kbit/s with 500/600 Hz generated sine input |
| Resource conflict | One enabled IPTV network with `max_streams=1`, two different muxes/services, channels `Lab1` and `Lab2`; this is a stream-limit conflict, not a physical tuner test |
| Guide | Generated XMLTV delivered through Tvheadend's enabled external XMLTV Unix socket, explicitly associated with the two channels |
| Recording | Pass-through MPEG-TS profile; `/recordings` bind mount inside this worktree, minimum-free setting read back as 50 MiB, no pre/post padding, zero warm-up |
| Timeshift | Enabled, on-demand disabled, `/timeshift`, two-minute per-subscription limit, 64 MiB combined limit, disk storage, zero RAM buffer |
| Playback client | Ubuntu 24.04 ARM64 `libmpv2 0.37.0-1ubuntu4`, FFmpeg `6.1.1-3ubuntu5`, from the existing test image in a separate container; no native build or shared cache mount |
| Isolation | `couch-dvr-research-server`, `couch-dvr-research-repro`, `couch-dvr-research-client`, network `couch-dvr-research-net`; host ports `127.0.0.1:19981` and `127.0.0.1:19982` only |

The image is a LinuxServer distribution of Tvheadend, not an upstream-owned image. Its [packager documentation](https://docs.linuxserver.io/images/docker-tvheadend/) describes the HTTP/HTSP ports and persistent configuration/recording mounts. Upstream master at inspection was [`f7f114e9b7d80e4b32b2f708c8520e2a414a2533`](https://github.com/tvheadend/tvheadend/commit/f7f114e9b7d80e4b32b2f708c8520e2a414a2533), dated September 5. That newer source was inspected, not built or qualified; the report does not assume that it fixes the tested binary.

Binary SHA-256 values:

```text
tvheadend  4e288ca857d03caf759404192986a106ae8842cd86285b19c60eeeb72b93c84e
ffmpeg    052505d59cec5f2a24e58396ee5a000960e6c3d86b00fc79521ae62c68d5e625
libmpv    f48f5239267447aa37789708c737f560152aa4f854b2d15859c99ea37d1c7fea
```

## Authentication and protocol boundaries

Bootstrap briefly used `--noacl` on the isolated loopback-published instance. All reported authorization and playback probes followed removal of that flag and disabling the wildcard access entry. Disposable passwords were generated locally and removed after cleanup.

`lab-admin` configured inputs, storage, guide and timeshift. `couch-recorder` had streaming `basic`, `advanced`, `htsp`, DVR `basic`, `htsp`, WebUI access, and no administrator permission. `couch-viewer` had streaming/WebUI access and no DVR permission. Channel/profile restrictions were empty in this lab. HTTP Digest authenticated the recorder; HTSP used the server challenge and SHA-1 password digest. No password, digest, server URL containing credentials or generated credential file belongs in Couch's public DTOs.

Measured authorization was 401 for anonymous DVR listing, 403 for the viewing account's DVR listing, 403 for recorder access-entry creation, and 200 for recorder DVR listing. A Basic-only HTTP recording request returned 401; Digest succeeded. No minimal-permission reduction beyond this tested account configuration is claimed. See the pinned [API permission registration](https://github.com/tvheadend/tvheadend/blob/fcd987f0b4666c966e4bcfef52adf84def116d23/src/api/api_dvr.c#L568) and [HTSP method permissions](https://github.com/tvheadend/tvheadend/blob/fcd987f0b4666c966e4bcfef52adf84def116d23/src/htsp_server.c#L3179).

| Purpose | Supported path and measured limit |
| --- | --- |
| Schedule a guide event | HTTP POST `/api/dvr/entry/create_by_event`, `config_uuid` plus backend `event_id`; returns a list of recording UUIDs |
| Schedule explicit times | HTTP POST `/api/dvr/entry/create` with JSON `conf`; channel UUID and Unix seconds. The server sets recorder ownership. Successful HTTP status alone is insufficient validation |
| Observe/cancel | `/api/dvr/entry/grid` and `/api/dvr/entry/cancel`; status and error fields must survive reconciliation, even when an error later changes wording |
| Completed recording playback | Authenticated `/dvrfile/<recording UUID>` supports byte ranges usable by the existing libmpv |
| Growing file | HTSP `fileOpen`, `fileStat`, `fileSeek`, `fileRead`, `fileClose`; file paths use the HTSP numeric DVR ID, not the HTTP UUID |
| Server-backed live pause/seek | HTSP `subscribe` with `timeshiftPeriod`, `subscriptionSpeed`, `subscriptionSkip`, `subscriptionLive`, `unsubscribe`; elementary packet payloads and asynchronous state, not a media URL understood by libmpv |

The [official HTSP RPC documentation](https://docs.tvheadend.org/documentation/development/htsp/client-to-server-rpc-methods) identifies HTSP file access as the path for seeking growing recordings. The exact [file operations](https://github.com/tvheadend/tvheadend/blob/fcd987f0b4666c966e4bcfef52adf84def116d23/src/htsp_server.c#L2945) support repeated reads after temporary EOF. In contrast, [HTTP file serving](https://github.com/tvheadend/tvheadend/blob/fcd987f0b4666c966e4bcfef52adf84def116d23/src/webui/webui.c#L2414) takes the current file size and sends a bounded response. An HTTP scheduling API does not provide live transport control.

## Measured operations

| Test | Observation |
| --- | --- |
| Guide scheduling | Imported two real XMLTV events. Scheduling event 1 produced recording `effeeda04c39a86a7888e70f8fa4004f`, then `Waiting for stream` and `Running`, and a real `.ts` file |
| Future cancel | First future create returned a UUID; cancel returned 200 and the entry was absent in the subsequent grid. A later future entry was verified `scheduled`, but its cancel connection closed and the server exited 139. Cancellation reliability is unresolved, not a clean pass |
| Input validation | Missing `conf` returned HTTP 400. A nonexistent channel UUID returned HTTP 200 and created an entry with empty channel, `status=Invalid`, `sched_status=unknown`; the client must validate mapping and inspect resulting state |
| Conflict | Overlapping recordings on separate muxes with the one-stream limit produced `No free adapter` in server logs, `recordingError`, error code 200, zero file bytes. At completion the same failed job became `completedError`, `File missing`, error code 0. Preserve the earlier cause |
| Ordinary completion | A separate generated recording transitioned to `Completed OK`, `sched_status=completed`, 1,392,892 bytes. FFprobe decoded 487 video frames from that file |
| Restart | The original guide recording and invalid-entry status persisted. The recording restarted into a second file after the crash and eventually read back `completed`; uninterrupted recording or lossless crash recovery was not established |
| Growing HTSP file | `fileStat` grew from 5,577,208 to 5,913,728 bytes in five seconds. A read at current EOF returned zero bytes; a later read on the same handle returned 18,800 new bytes. Seek to zero returned bytes identical to HTTP |
| HTTP ranges | `bytes=0-187999` returned 206 and 188,000 bytes. A later range beginning at the old EOF returned 206 and 18,800 bytes. A range ten million bytes beyond current EOF returned 200 with a 137-byte non-media body, not 416 |
| HTSP handle cleanup | `fileClose` succeeded; another read returned `Invalid file`. The probe explicitly sent `playcount=0, playposition=0` to avoid incidental progress reporting |
| libmpv over HTTP | Observed MPEG-2 video and MP2 audio tracks. Position stayed at 7.010022 s during a three-second pause, moved to 2.010022 s on a paused seek, then advanced to 5.010022 s after resume |
| HTTP chase-play limit | The same libmpv load reported duration 125.56 s and `demuxer-cache-state.eof=true` while the server recording was still growing. It played the available HTTP content; continuous following of newly written bytes was not demonstrated |
| Direct HTSP in libmpv | Loading `htsp://…` left libmpv idle with no tracks or position. The installed FFmpeg protocol list contains no HTSP. Command acceptance alone was not counted as playback |
| Playback cleanup | Stop cleared libmpv tracks and position and made it idle; `mpv_terminate_destroy` returned in 0.7 ms. Output used `vo=null, ao=null`, so this establishes software decode/control and shutdown only |
| Unsubscribe | A separate ordinary HTSP subscription received 177 packets in three seconds. Unsubscribe acknowledged, emitted `subscriptionStop: OK`, then delivered zero packets in two seconds. An unrelated backend `epggrab` subscription still owned an FFmpeg input until server shutdown |
| Server/container cleanup | Normal Tvheadend SIGTERM shutdown took 882.67 ms, exit 0, no OOM. All three disposable containers and their network were removed successfully. No named volume was created; generated evidence remains in the assigned worktree |

The HTTP playback client was a small ctypes driver of the installed libmpv API, not a new playback engine. The HTSP probe reused Tvheadend's pinned [demonstration message codec](https://github.com/tvheadend/tvheadend/blob/fcd987f0b4666c966e4bcfef52adf84def116d23/lib/py/tvh/htsmsg.py) with a bounded socket/sequence driver. Neither is a proposed production HTSP implementation.

## Live-return failure and one reproduction

The first completed HTSP sequence received live packets, paused with zero packets for six seconds while the server buffer grew, sought backward to PTS 7,740,000 µs, and resumed with increasing PTS. `subscriptionLive` then acknowledged and the connection ended. Docker recorded exit 139, `OOMKilled=false`, at `2026-09-05T22:10:11.369472627Z`.

One follow-up reproduction used the same binary/image/input and a copied configuration with no DVR entries, removing concurrent recording as a prerequisite. It added the documented `clientversion` field to hello. The initial hello omitted that field, which the pinned server accepts; [its parser](https://github.com/tvheadend/tvheadend/blob/fcd987f0b4666c966e4bcfef52adf84def116d23/src/htsp_server.c#L1468) requires only protocol version and client name. All control fields and order were checked against [official HTSP documentation](https://old.tvheadend.org/projects/tvheadend/wiki/HTSP) and the [pinned subscribe/control handlers](https://github.com/tvheadend/tvheadend/blob/fcd987f0b4666c966e4bcfef52adf84def116d23/src/htsp_server.c#L2634).

The reproduction, after authenticated hello, was:

```text
subscribe         subscriptionId=1, channelName=Lab1, timeshiftPeriod=120
observe 12 s      live video PTS 740000 -> 12020000 microseconds
subscriptionSpeed subscriptionId=1, speed=0
observe 6 s       zero muxpkt packets, growing timeshiftStatus.end
subscriptionSkip  subscriptionId=1, absolute=1, time=8020000
observe 2 s       backward seek acknowledgement and paused video packet
subscriptionSpeed subscriptionId=1, speed=100
observe 5 s       packets resume from the earlier buffer position
subscriptionLive  subscriptionId=1
```

No `90khz` option was requested, so control timestamps used microseconds. Each synchronous acknowledgement matched its sequence number; asynchronous messages were read continuously. The full ordered request/response metadata is retained. This was not an unsupported opcode or an arbitrary malformed payload.

GDB caught `SIGSEGV` in thread `tvh:tshift-rd`:

```text
get_meta                         src/malloc/mallocng/meta.h:141
__libc_free                      src/malloc/mallocng/free.c:105
timeshift_reader                 src/timeshift/timeshift_reader.c:846
thread_wrapper                   src/tvh_thread.c:91
```

The pinned [line 846](https://github.com/tvheadend/tvheadend/blob/fcd987f0b4666c966e4bcfef52adf84def116d23/src/timeshift/timeshift_reader.c#L846) delivers a streaming message. This localizes a server-side failure without claiming a completed root-cause diagnosis. The debugger container exited 0 because batch GDB finished after reporting the inferior's SIGSEGV; that is not a passing server exit. No OOM occurred. An [existing upstream report about live-edge flushing](https://github.com/tvheadend/tvheadend/issues/2087) describes a related operation, but it does not prove the same defect. No upstream post, patch or alternate-version success is claimed.

The second ordinary-server exit 139 occurred at `2026-09-05T22:13:11.295875669Z`, when a future-recording cancellation lost its connection. There was no active HTSP timeshift session then. No backtrace was available for that exit, and it was not reproduced. Treat it as a separate unresolved cancellation concern.

## Client choice and Couch ownership

Keep existing libmpv for completed recording playback. Its packaged shared library loaded and shut down in this lab. This does not qualify the T480 package, embedded video pixels, physical sound or any Couch UI flow.

The maintained Kodi Tvheadend add-on was inspected at [`d908dd8b203f609630fc42d5197d55e3fe68e50e`](https://github.com/kodi-pvr/pvr.hts/tree/d908dd8b203f609630fc42d5197d55e3fe68e50e), dated August 23, 2026. Its [CMake configuration](https://github.com/kodi-pvr/pvr.hts/blob/d908dd8b203f609630fc42d5197d55e3fe68e50e/CMakeLists.txt#L4) requires Kodi and builds a Kodi add-on. Its HTSP demux/file code is useful reference material. No maintained standalone adapter with a verified Couch/libmpv interface was selected, packaged or lifecycle-tested. Adding the Kodi runtime would introduce another application/player contract and is not the proposed path.

Couch should retain Bun HTTP/WebSocket and SQLite authority, one native playback owner, and one host reporting path. Server credentials stay private. A recorder adapter reconciles backend job identity into committed Couch state before broadcasts; reconnect sends a fresh snapshot. Recording activity belongs to the backend and can continue independently of stopped playback. Browsing stays device-local. A future playback adapter must preserve cancellation, stopped restart, VideoStage mounting, native controls and resets. It must also explicitly control Tvheadend playcount/playposition updates, which [fileClose can change](https://github.com/tvheadend/tvheadend/blob/fcd987f0b4666c966e4bcfef52adf84def116d23/src/htsp_server.c#L3049), rather than creating a second progress reporter.

## Proposed children for orchestrator review

### Schedule one guide programme and play its completed recording

This is the smallest actionable implementation slice. It uses the real disposable backend, the accepted IPTV guide contract, the HTTP DVR API and existing native libmpv. It does not offer live pause or chase playback.

Native prerequisites should be this research issue after review, [the IPTV guide child #35](https://github.com/avoid-quest/couch/issues/35), and [the production package child #2](https://github.com/avoid-quest/couch/issues/2) before claiming packaged-target qualification. Retain #43 through the existing native dependency graph. The media orchestrator assigns one recording adapter/UI owner and coordinates shared playback contracts with appliance owners.

Acceptance:

- Administrator setup stores a private backend endpoint/account and an explicit mapping from Couch `sourceId/channelId/tvgId` to Tvheadend channel UUID. Exact mapping is required; names and stream URLs are not identity. Reuse #35's guide, without a duplicate guide store.
- Schedule one selected programme. Snapshot Couch programme identity/times and backend channel/event/job IDs. Keep a stable job when guide titles, stop times or start identity change. Use event scheduling only when the backend event mapping is verified; otherwise explicitly map times onto the configured backend channel.
- Show pending, running, completed and failed jobs from reconciled backend state. A one-stream conflict must retain its original cause. Reject invalid mappings before submission. Handle ambiguous responses by reconciliation, not blind resubmission.
- Cancel a pending job and verify its absence without server failure. Resolve the observed cancellation exit before this criterion passes; if it reproduces, keep this product slice blocked on a maintained backend correction/configuration. No cancellation success may be inferred from a dropped connection.
- After completion, Play on TV uses the existing native player and host-only authentication/reporting. Verify seek, Stop, replacement, cancellation, restart without autoplay, and one progress path. Recording may continue while playback is stopped.
- Demonstrate the generated XMLTV/MPEG-TS source through actual Couch TV and HTTP controls. Capture phone, tablet, desktop and TV screenshots, two-controller state/reconnect, durable jobs after app/backend restart, and source/binary evidence. Run relevant Bun/native/HTTP checks within the CI budgets. Hardware sound and provider reception need their own real evidence.

### Qualify a stable live/growing-timeshift backend and maintained host client

Keep this open product qualification gate distinct from ordinary recordings. Its outcome must be a selected, packaged and measured path or an exact external blocker. Native prerequisites should include reviewed #36 and the selected packaged host contract from #2. Add #35 if the eventual demo uses its guide/channel mapping; depend on the recording slice if it reuses its account/job adapter.

Acceptance:

- The backend owner supplies a pinned maintained server build/configuration where the retained `subscriptionLive` reproduction passes without crash, corrupted delivery or unbounded burst. Preserve the failing image and evidence for comparison. The untraced cancellation exit remains separately tracked until explained and resolved.
- The native integration owner selects a maintained standalone client/library and names its supported interface to existing libmpv. Prove packaging and license/runtime dependencies, cancellation, bounded queues, unload and process/thread cleanup. If none fits, return the missing maintained adapter/API and owner decision before scheduling custom transport work. pvr.hts alone does not satisfy this criterion.
- In the packaged Couch app, demonstrate server-backed pause, backward/forward seek, return to live, temporary growing-file EOF followed by new media, seeks into newly written content, source replacement, reconnect, Stop and stopped restart. Preserve one native playback/reporting owner and server-side recording continuity.
- Record real video pixels and observed native/HTTP controls at all four size classes, two-controller persistence/reconnect, transport/buffer limits, errors, source/binary hashes and cleanup. A raw `fileRead` or finite HTTP replay is not a passing chase-play result.
- Before target/service qualification, the owner supplies the actual Tvheadend endpoint, account rights, writable recording/timeshift storage and an authorized input plus guide. For DVB, this includes the tuner model, Linux device/driver access and permitted channels; for IPTV, the feed/account and concurrency allowance. None was supplied here. T480 access remains with the appliance owner until a named window is granted.

## Evidence and replay

All evidence is under `/Users/devit/Code/couch-media-dvr-research/.artifacts/dvr/`. `evidence-manifest.json` records SHA-256 and byte size for the retained, sanitized evidence set; `evidence.tar.gz` contains that set and the probe scripts. This local bundle is a review artifact, not a production fixture or a tracked implementation layer. Its SHA-256 is `8d8692b41c9c9465c5ee1e4ddf5498e3fb90fd4ce27ebeb584951801e8e050a7`, size 2,102,774 bytes. The manifest SHA-256 is `be01f86bde662a21da12693898bb9a658733a76126157ff43500e0bdc2fdfe16`.

| Evidence | What to inspect |
| --- | --- |
| `image.json`, `server-binaries.txt`, `client-binaries.txt`, `client-versions.txt` | Actual image, labels, binary hashes, package versions and available protocols |
| `http.jsonl`, `sanitized-config.json`, `guide.xml` | API requests/results, account bounds, exact inputs/storage, generated guide |
| `htsp.jsonl`, `htsp-phases.jsonl`, `htsp-summary-final.log`, `htsp-reproduction.log` | Ordered protocol metadata and payload hashes, pause/seek values, original failure and single reproduction |
| `server-exit-first.json`, `server-exit-second.json`, `server-exit-repro.json`, `gdb-reproduction.log` | Both direct exit-139 states, debugger exit distinction, SIGSEGV and all thread backtraces |
| `recording-summary-final.log`, `recording-phases.jsonl`, `active-recording.json`, `mpv-summary.log` | Growing HTSP bytes, HTTP range behavior, finite libmpv cache and observed transport state |
| `lifecycle-summary.log`, `server-first.log`, `server-second.log`, `server-final.log`, `gdb-final.log` | Completion/conflict/error progression and backend process logs |
| `decode-final.json`, `live.m2v`, `resumed.m2v`, `recording-head.ts`, `repro-recordings/Lifecycle recording.ts` | Real encoded/decoded samples. Final frame counts were 283, 126, 44 and 487; capture-boundary decoder warnings are retained |
| `normal-shutdown.json`, `restart-status.json`, `processes-after-unsubscribe.txt`, `cleanup.json` | Persistence, unsubscribe, remaining independent EPG capture, bounded normal shutdown and resource removal |

To replay in a separately authorized disposable Docker environment, use the pinned image and the configuration table above with fresh unique names/ports/storage and newly generated credentials. The raw network/mux/ACL definitions are in `sanitized-config.json`; no tuner or service account is required for the generated input. `lab.py` records bootstrap API setup, and `htsp_probe.py` records the exact reproduction. Extract the pinned Tvheadend source to `runtime-source` so the probe imports its original Python codec. Bind the private fixture directories to `/config`, `/recordings` and `/timeshift`, then run Tvheadend with `-c /config -u root -g root`. Use `--noacl` only during isolated bootstrap, then restart without it and verify 401/403/200 before testing. Map services to channels and feed `guide.xml` through `/config/epggrab/xmltv.sock`, updating its UTC times. First import created the XMLTV channel associations; a second import populated this lab's events.

For the single crash reproduction, copy the configured fixture while omitting Unix sockets and DVR log entries, use the same inputs/timeshift limits, and run the unchanged binary under `gdb -batch -ex 'set pagination off' -ex run -ex 'thread apply all bt' --args …`. Wait for authenticated `serverinfo` before running `htsp_probe.py`. An immediate startup connection failure is not a server crash. Stop and remove only these disposable resources afterward. No build of Tvheadend or Couch is needed for this protocol reproduction.

Earlier failed attempts remain part of the result. Bootstrap initially used the wrong network API parameter and disabled the wrong ACL entry; readback exposed both before authorization was claimed. The first HTSP probe assumed video stream index zero, while `subscriptionStart` reported index one; it stopped in the probe after pause, without a server crash. The corrected probe follows the observed stream ID. Basic HTTP auth failed before switching to Digest. An initial configuration copy encountered a Unix socket, and one post-GDB-start request arrived before readiness; those setup errors were corrected and are not backend failures. The absent `mpv` CLI led to testing the installed libmpv directly. Partial elementary/TS captures include decoder header/truncation warnings, so frame decoding is not a claim of pristine end-to-end presentation.

No Couch screenshots, two-controller test, native render test, audible-output measurement, T480 package run or authorized external television feed was performed in this documentation-only ticket. Those acceptance criteria stay with the proposed product children. The full Couch native suite and preview rebuild were unnecessary here because no product code or UI changed.
