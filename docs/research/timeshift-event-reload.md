# Reproduce and isolate EVENT premature EOF

The retained [timeshift failure](https://github.com/avoid-quest/couch/issues/67) now reproduces in Couch and an independent libmpv owner while the Ant publisher stays alive. Changing only the direct owner's `max_reload` from its default to 30 prevents premature EOF on that reproduced input. No application fix or packaged qualification ran in this comparison.

## Controlled input

The relay preserved actual Ant Community 3.1.0 TS bytes while delaying the visible EVENT playlist. It exposed ten segments initially, eleven at 2.034 seconds, twelve at 4.093 seconds and thirteen at 21.631 seconds, relative to the first native manifest request. Subsequent segments appeared every two seconds. Full backend manifests and modified client manifests are retained separately. This isolates client-visible interruption from Ant's previously measured 20-second RTMP publisher timeout.

Full TS responses for segments 1 through 13 were checked against the original failure's SHA256 and lengths. Both players received segment 13 without ENDLIST, with the same 46,436-byte body and SHA256 5fee96877273ac89aa90deb946ca2bd2d9a841da67b3cca6e20630338adb4879. Backend manifests continued growing. No producer reconnect, image change, application rebuild or payload substitution occurred.

The original evidence records state transitions rather than command-send timestamps. Replay pause and unpause targets were 6.397 and 6.502 seconds; seek at 6.450 was reconstructed within that interval. Actual send offsets were 6.397/6.451/6.530 seconds in the default run, and 6.398/6.473/6.575 in the option comparison. These small measured deviations remain part of the evidence.

## Differential result

| Run | Couch, unchanged defaults | Direct libmpv |
| --- | --- | --- |
| `duplex-eSfJn0` | Ended at 24.0169 seconds on its existing load. | Default `live_start_index=0` reached EOF at 24.020333 seconds. |
| `duplex-6oC9XM` | Ended again at 24.008 seconds. | Only `max_reload=30` was added. It continued on the same load through 44.46 seconds with `eof-reached=no`. |

The Python driver, all other direct options, relay schedule, native binaries and source media were unchanged. Both whole runs remain failed because Couch's default control failed its same-load recovery assertion. The second run supplies positive option evidence, not a passing application acceptance result.

The pinned [FFmpeg 6.1.1 HLS reader](https://github.com/FFmpeg/FFmpeg/blob/n6.1.1/libavformat/hls.c) returns EOF when its reload counter exceeds `max_reload`. The supported option therefore addresses the demonstrated insufficient-playlist failure. The earlier generated six-second test did not reproduce this 24-second, seek-and-delayed-growth pattern and remains insufficient evidence on its own. Thirty is a reload-attempt bound; it does not promise a particular wall-clock timeout.

The native change is limited to verified EVENT loads, with the existing per-load restoration preserving ordinary-media defaults. Its focused native test adds EVENT-to-non-EVENT transitions and restoration of a caller's `max_reload=7` after EVENT override. That Linux-only test is prepared but has not run with the changed source; the coordinated Docker allocation moved to amd64 provisioning. Actual updated Couch replay, final ENDLIST/EOF and Stop/replacement while waiting also need qualification. This report does not establish arbitrary interruption recovery, audio continuity or durable growing-recording identity.

## Receipts

All directories below are under `/tmp/couch-timeshift-diagnosis-fresh-20260908/.artifacts/`. They retain executed source/bundles, actual response bodies and ranges, native/direct snapshots, command timing and cleanup.

| Directory | Manifest SHA256 | Members / bytes | Elapsed |
| --- | --- | --- | --- |
| `duplex-replay/duplex-BPXDD7` | c569b3cd7a83b109f4e0585352f9e93399d418ea8fabb2f005a88960d7c63b7a | 54 / 855,746 | 63.942 seconds |
| `duplex-replay-range/duplex-eSfJn0` | c5209c7178cb9055106e554dd25a9073d0c6c2e7b020b8244eff76cc18726725 | 89 / 1,964,898 | 87.174 seconds |
| `duplex-replay-maxreload/duplex-6oC9XM` | dd4d9701e4f80353c48afbcbf68d8176004f50e89d0282a28154fff3a384b7f4 | 116 / 2,470,661 | 87.022 seconds |

The first receipt is a preserved fixture failure: the relay incorrectly rejected libmpv's `Range: bytes=0-` manifest request. The corrected fixture preserves HTTP 206 and calculates Content-Range for the shortened client manifest, retaining the backend range separately. That failed-open attempt provides no product evidence.

All 259 manifest members were verified. Both diagnostic runs completed every inner cleanup check and removed both owned containers, with exact-ID absence confirmed. The earlier fixture failure propagated its validation error through fixture cleanup; host removal still succeeded. Each run stayed inside the established 300-second, Ant 2 GiB plus native 4 GiB allocation. There were no builds, pulls, host ports, hosted actions or changes to preserved previews.

The native pair remains the dirty debug tree 36657fd28d59bf6efd034ea90e4b4e8e3d5d661f on d77af244cf6d1f6aab872e2fee0a11897284815f. Native SHA256 is 10ef0d0d85746c66f2ddc9b829f33cb06ad88d9acccba04d42a5428cc4386de0; sidecar SHA256 is d3e0891d11350e1111ad8385ac52913b9aef50bad8d1fc07e09ad0d4a5ea3a50. Direct libmpv is 0.37.0 with FFmpeg 6.1.1-3ubuntu5 and null outputs. Presented Couch pixels and null-sink audio remain separate from audible, packaged or physical-target acceptance.
