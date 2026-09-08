# Should Couch move more work to Rust?

Research for [Full Rust port](https://github.com/avoid-quest/couch/issues/175), checked 2026-09-08 against source `351eb9ee52f9fea2b91c4db92fff9d042a1c95eb`. This records an investigation and recommendation. The owner has not selected a port. No runtime experiment, device change or rewrite was performed for this report.

## Recommendation

Keep Bun as the HTTP/WebSocket coordinator and SQLite owner. Keep the shared React TV/phone interface. Move another operation to Rust only after a profile identifies that operation as a material cost and a bounded comparison shows a useful improvement.

A full coordinator port could remove the Bun executable and its process lifecycle. That is a valid architectural goal, but the available evidence does not justify it as a playback performance fix. Most media processing already runs outside TypeScript. The strongest measured playback problem is in the native decoding/rendering path. Investigate the remaining visible-controls problem through [YouTube playback performance](https://github.com/avoid-quest/couch/issues/150), using its existing evidence and acceptance.

## What "Rust port" could mean

| Scope | What changes | What remains |
| --- | --- | --- |
| One expensive operation | Replace a measured parser, transform or native integration behind its existing interface | Bun coordinator, database ownership and shared UI |
| Coordinator port | Move LAN HTTP/WebSocket handling, authorization, providers, queue state and persistence into Rust | Shared web UI, WebKit, libmpv, SQLite and required external helpers |
| Native TV UI | Replace the Tauri webview interface with a native interface | A separately maintained browser remote and its network API |

These are different decisions. A Rust coordinator does not remove WebKit or the need to serve authenticated phone clients. Tauri uses a core process and webview processes, with WebKitGTK on Linux. Its local IPC is not a LAN server replacement. [Tauri process model](https://v2.tauri.app/concept/process-model/), [current network and native entry point](../../src/main.ts), [HTTP/WebSocket hub](../../src/server/hub.ts).

## Where work runs today

| Responsibility | Current implementation | Implication for a port |
| --- | --- | --- |
| Decode, audio, subtitles and frame presentation | Rust host, vendored video integration, libmpv and native graphics libraries | Translating the coordinator does not replace this processing path. [Player](../../src-tauri/src/player.rs), [video plugin](../../src-tauri/vendor/tauri-plugin-video/src/desktop.rs) |
| AppImage staging and installation, native display control | Rust modules and official Tauri updater integration | Already moved to the appropriate native owner. [Updater](../../src-tauri/src/appimage_update.rs), [display](../../src-tauri/src/display.rs) |
| Queue, profiles, authorization, durable progress, phone commands | TypeScript services over Bun HTTP/WebSockets and native SQLite | A port must preserve ordering, revocation, commit-before-broadcast and reconnect behavior. [Session](../../src/server/session.ts), [store](../../src/server/store.ts), [hub](../../src/server/hub.ts) |
| Local library | Asynchronous filesystem walk, at most two in-flight inspections, `music-metadata` for audio and a bounded ffprobe subprocess for video | Separate parsing CPU from disk access, process startup and SQLite writes before selecting a language. [Library](../../src/server/library.ts), [music metadata](../../src/server/music-metadata.ts) |
| Library search | SQLite FTS5 for text search; SQL filters and JSON queries for other views | The search engine already runs natively. Query/index design remains relevant in either language. [Library queries](../../src/server/library.ts), [SQLite FTS5](https://sqlite.org/fts5.html) |
| Guide import | Bounded HTTP reads, synchronous XML validation/parsing and synchronous transaction loops | Best concrete server candidate to measure: up to 16 MiB XML and 100,000 programmes. This is a code-derived hypothesis, not a measured bottleneck. [Parser and limits](../../src/server/iptv-feeds.ts), [refresh transaction](../../src/server/iptv.ts) |
| Website extraction | Bounded yt-dlp subprocesses with optional Deno runtime | Rewriting the launcher does not remove extraction/network work or those helpers. [Extractor](../../src/server/yt-dlp.ts), [host helper configuration](../../src-tauri/src/lib.rs) |

Bun's SQLite API is synchronous and calls native SQLite. Moving SQL to Rust can change scheduling and allocations, but does not by itself improve the SQL plan or storage latency. [Bun SQLite](https://bun.com/docs/runtime/sqlite).

## What measurements establish

The original T480 severe-drop baseline recorded native CPU at 674.8% of one core, WebKit at 43.6%, and server CPU at 1.1%. It dropped 84.43% of frames. The subsequent diagnostic identified 4K60 AV1 software decoding and costly composition. Those observations place that failure outside a CPU-bound Bun coordinator. They do not prove Bun is cheap under every workload. [Baseline](https://github.com/avoid-quest/couch/issues/150#issuecomment-5569411755), [decoder and rendering investigation](https://github.com/avoid-quest/couch/issues/150#issuecomment-5569874113).

The later signed `5922e3874dd1ebd9dad4ee635707ee21b44143ce` build at Automatic 1080p60 VP9 with vaapi-copy recorded 0.37% dropped frames with controls hidden and 13.46% with controls held visible. Startup was user-confirmed smooth. The held-controls criterion remains open. These are historical build-specific samples, not measurements of the current AppImage or a Rust comparison. [Signed-build result](https://github.com/avoid-quest/couch/issues/150#issuecomment-5572216049).

A debug container recorded about 59 MiB RSS for Bun. It was neither a release build nor TV hardware. Removing Bun would also add Rust implementations of its responsibilities, so 59 MiB is not a defensible savings estimate. [Recorded memory observation](../usage.md#check-and-build).

No current-release coordinator CPU profile, guide-import latency distribution, realistic large-library scan profile or Rust comparison was found in the inspected repository notes and issue evidence. Therefore there is no measured speedup, memory saving, package-size saving or migration-duration estimate to promise.

## Smaller options and their costs

First change a query, repeated parse or unnecessary allocation only when its profile warrants it. Keep scan ownership and cancellation inside the existing library service. Keep the guide's fetch/parse/replace operation behind its existing service interface. There is no need to add a general job system before identifying the expensive step.

If XML parsing causes observable command stalls, a bounded worker can preserve the TypeScript parser and move computation off the coordinator thread. Bun documents worker threads, but still labels its Worker API experimental, particularly termination. Qualification must cover shutdown and packaging before selecting that option. Moving only parsing would leave the synchronous database transaction to measure separately. [Bun workers](https://bun.com/docs/runtime/workers).

A Rust parser is another candidate if a maintained implementation matches Couch's accepted XMLTV semantics and limits. Compare output, cancellation, transfer costs and end-to-end latency, not only parser throughput. Large guide payloads should not be sent through the existing 64 KiB native-message input contract without a separate design. [Current protocol reader](../../src/main.ts).

Rust gives compile-time ownership rules for memory management without a garbage collector. It does not automatically bound work or make blocking operations cancellable. Tokio explicitly requires care with CPU concurrency; started `spawn_blocking` tasks cannot be aborted. A port must still specify operation limits, shutdown and database ownership. [Rust ownership](https://doc.rust-lang.org/book/ch04-00-understanding-ownership.html), [Tokio blocking tasks](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html).

A full coordinator port also replaces working provider SDK integration and requalifies pairing, concurrent edits, progress, update checkpoints and installed recovery. The shared TypeScript protocol and Rust protocol would still need agreement with browser clients. Removing the sidecar removes one supported packaging mechanism, while retaining WebKit and media helpers. Binary and runtime savings need an actual release comparison. [TypeScript protocol](../../src/shared/protocol.ts), [Rust protocol](../../src-tauri/src/protocol.rs), [build](../../scripts/build.ts), [Tauri sidecars](https://v2.tauri.app/develop/sidecar/).

## Reversible next measurement

If server responsiveness is the goal, use one disposable local data directory and a pinned source/build to profile the existing guide refresh. Start with a representative guide, then a generated guide near the accepted limits. Keep network fetch time separate from parse and transaction time. Run ordinary paired commands during the import and retain accepted/applied timestamps, failures, CPU profile, process RSS, corpus hash and row count. Repeat idle/import conditions to distinguish warm-up and run variance. No new CI job or benchmark framework is needed.

Bun supports `--cpu-prof`, `--cpu-prof-dir` and `performance.now()`. Compiled executables also accept profiling through `BUN_OPTIONS`. Use the existing operation and a throwaway driver, then remove the private corpus and temporary instrumentation. CPU sampling alone cannot attribute time waiting on disk or a provider. [Bun profiling](https://bun.com/docs/project/benchmarking), [compiled executable options](https://bun.com/docs/bundler/executables).

The prior architecture proposed under 100 ms p95 acknowledgement and under 250 ms p95 confirmed state for commands without media loading. Treat these as proposed targets for the owner to accept, not established performance. Retain worst stalls as well as percentiles. If import misses an agreed target, first identify whether parsing, SQL or I/O accounts for the delay. Only then compare one bounded alternative against identical inputs and behavior. [Existing experiment targets](architecture.md).

## Owner decision still needed

Choose the intended benefit before authorizing migration: measured playback or command responsiveness, or removing the Bun runtime as an architectural preference. My recommendation is to retain the current split, keep playback diagnosis with its existing ticket, and only investigate a bounded server change after measurement. A preference for a Rust coordinator can justify separate migration planning, but it should not be recorded as a demonstrated performance gain.

This report completes the available research. The ticket stays open for that choice; it does not authorize a worker extraction, new database owner or UI rewrite.
