# Player modes integration ledger

Execution contract: `recovery/player-modes-20261026:docs/player-modes-integration-handoff.md`, commit `3df02949cbfeb4f9f43ac73379e66b58fb6f1afd`. Read the preserved plan, code map, use cases, ADR 0002 and recovery README/history audit through `git show` before implementation. Historical validation belongs to its recorded source; fresh results are recorded here separately.

## Baseline and ownership

Fetched integration base: `4a194e35cedb30f5ba3e664b4c9734b087051825` (`origin/main`, 2026-10-26). Refactor common ancestor: `59ac6cd6a510ca96bf60dfc9a3628cc635be22e1`; original tip: `27e580cc3d0b3fc7b4925100777af38324f2b5e3`; later source snapshot: `8147fc98fbeda5b415c3351a10a98c7cab816d4a`. Four intervening main commits add radio recognition, overlay fixes, fullscreen black bars and Intel Mac/QuickJS support. Preserve all four. The owner's main checkout remains on its existing commit; stack trunk is `main`, while implementation starts at the fetched remote head.

Baseline frozen install, three-project typecheck, production build and all 78 separate unit files pass. Node is 24.21.0; use repository-local Bun 1.4.2 (the shell default is 1.4.4). Unit suites run separately because this repository's module mocks interfere across files. Scratch receipts live under `.scratch/player-modes/`; every scratch Couch uses its own data and port and owned process cleanup.

The lead owns completion and shared interfaces. Two bounded independent assessments cover whole-scope retirement and native-host/browser recovery. All children use T3 delegation with `codex`, `gpt-6.1-sol`, `reasoningEffort=xhigh`, inherited `serviceTier=default`; returned settings are verified.

## Stack sequence

| Layer | Branch | Concern and completion criterion |
| --- | --- | --- |
| Core | `player-modes/integration-20261026` | Core-authorized delivery, source preparation and common scheduled audio; public routing/permission/clock tests and build pass. |
| Browser | `player-modes/browser-20261026` | Browser rendering, output clock and complete Direct/relaxed/audience controls; renderer, SDK and browser journeys pass. |
| Host | `player-modes/host-20261026` | Packaged native input lifecycle and truthful audio settings; host/bridge, frozen-install and packaging checks pass. |
| Validation | `player-modes/validation-20261026` | Remaining integration regressions, current docs, independent reviews and PR-ready receipts; every row has evidence or a named external prerequisite. |

Import source directly into its owning layer. Recovery refs, archival blobs and original investigation worktrees remain intact and outside implementation ancestry. Serialize shared protocol/Hub/renderer and stack mutations. Separate delegated implementation checkouts begin from committed parent inputs.

## Whole-scope tracker

All rows are owned by the lead until a bounded implementation brief assigns a disjoint path set. “Check” names denote repository tests, not historical passes. Implementation and fresh evidence are separate gates.

| Package | Responsibilities | Owning layers | Check / remaining work |
| --- | --- | --- | --- |
| P0 | Contract, drift, defaults, units, authority, source/output generations | Core | This ledger, ADR 0002, playback-policy tests; import and reconcile. |
| P1 | Atomic routing, consent, authority, lifecycle, reconnect | Core / Browser | playback-routing, device-sharing, live-audience, revocation, Stop/Undo. |
| P2 | Direct selection, local decode, renditions, protected relays | Core / Browser | source-preparation, renderer-hls, source/group-language, YouTube, public relay. |
| P3 | Relaxed shared/split A/V and independent programmes | Core / Browser | live-clock/sync/latency, scheduled-language, picture mapping, real buffered capture. |
| P4 | Native host capture, source normalization, common fixed deadlines | Core / Browser / Host | capture-clock, scheduled-capture, native-capture, SDK clock, admission, fanout. |
| P5 | Play on/Move, TV action, audience controls, bounded participation | Core / Browser | where-it-plays, audience-ui, remote/hotkey/OS consumers, scale fixture. |
| P6 | Audio-only and AirPlay migration, shared publication lifetime | Core / Host | AirPlay, capture-upload/continuity, source end and retained A/V fallback. |
| P7 | Retirement, distribution, fresh review and evidence | Validation | Frozen install/typecheck/build, act Package, hosted checks, independent fixed-head reviews. |

| Map | Implementation disposition | Check |
| --- | --- | --- |
| M1 | Adapt shared policy/protocol; runtime admission; retain durable queue defaults | media-shape, policy, restart/history |
| M2 | Adapt Hub orchestration; Core enforces live audience authority | routing, audience, output controls, consent |
| M3 | Retain provider/byte access; consolidate source/rendition selection | source-preparation/language, relay security, YouTube |
| M4 | Adapt native media and browser scheduled receiver; retain mpv/DSP | renderer-hls, SDK, compressor, playback screens |
| M5 | Combine URL and capture delivery; retain distinct sender policies | scheduled-capture/language, isolation, late join, queue bounds |
| M6 | Adapt native host capture/upload and browser publication lifecycle | native-capture, capture consent/close, upload/revocation |
| M7 | Retain WebRTC/TURN and one shared buffered captured-video ingest | delivery, stream, channels, ICE/STUN/relay, real R4 journey |
| M8 | Adapt AirPlay PCM; preserve hardware/Bluetooth routes | AirPlay, sound-session, device volume, output changes |
| M9 | Adapt every player/queue/routing/share/remote command consumer | audience-ui, menus, shortcuts, Where it plays, TV/browser journeys |
| M10 | Retain identity; adapt pairing/fanout/admission/lifecycle bounds | identity, pairing, startup, revocation, scale fixture |
| M11 | Package worker/helper and pinned patches; reconcile main packaging | package-hooks, act, Main/Core/worker smoke, docs review |

| Use case | Implementation / owner layer | Acceptance evidence required |
| --- | --- | --- |
| D1 | Independent queues and local decode / Core + Browser | Two concurrent Playbacks; controller adds no output. |
| D2 | Sound-only rendition and own queue / Core + Browser | Separate audio fetch only; muxed fallback; volume. |
| D3 | Explicit Play on isolates destination / Core | Other listeners and queues continue. |
| D4 | Captured viewing / Core + Browser | Retained RTC tracks and buffered fallback; publication lifecycle. |
| D5 | Permitted remote single destination / Core + Browser | Consent, controller context, mpv host restriction. |
| D6 | Exclusive queue-preserving Move / Core + Browser | TV action; async consent recheck; queue/position/speed retained. |
| R1 | Collaborative shared music / Core + Browser | Joins, levels, queue and transport; one encode per required format. |
| R2 | Split TV picture / phone sound / Core + Browser | Common timeline; channel selection; separate hardware/content delay. |
| R3 | Multiple pictures / Core + Browser | Pause/seek/rate and picture clock; mapping limitations exposed. |
| R4 | Buffered captured A/V / Core + Browser | Actual capture→HLS→browser, fallback, late join, cleanup. |
| R5 | AirPlay decoded PCM / Core | Host takeover, one sender, disable/departure/recovery; no audio HLS. |
| R6 | Relaxed audio input / Core + Host | Browser/native timestamped PCM; no duplicate capture/recorder; cleanup. |
| R7 | Independent groups / Core | Separate queues/timelines/encoders and unaffected Next. |
| L1 | Native source→Opus→browser / Core + Browser + Host | Stereo, fixed deadlines, bounded 50-client fixture; physical target separately qualified. |
| L2 | Join present / Core + Browser | Clock/decoder/output admission; late join never retimes healthy listeners. |
| L3 | Own listening and Leave / Core + Browser | Core denies crafted/legacy programme commands; leave keeps source alive. |
| L4 | Recovery and route change / Core + Browser | Fresh admission; current timeline; incompatible output isolated. |

## Recovery and retirement

[File disposition](player-modes-file-disposition.csv) accounts for every changed file in the original refactor and 112-file later source overlay. `retain` preserves the responsibility, `adapt` requires selective integration, and `exclude` identifies the maintained replacement or archival reason. Historical research remains evidence; current built-state claims follow this ledger and final validation.

| Responsibility | Disposition and replacement | Gate |
| --- | --- | --- |
| Scattered delivery/authority | Common Core policy and actor-specific controls | All REST/socket/remote/hotkey/OS consumers and stale preparation tests. |
| Hidden video for sound-only | Select existing audio rendition; preserve muxed fallback | Real fetch counters and source/renderer tests. |
| URL/capture scheduled delivery | Common worker/fanout; separate read-ahead and fixed policies | Both source kinds execute maintained module. |
| Browser/AirPlay audio recorder→AAC/HLS | Timestamped PCM→scheduled audio where supported | R5/R6 lifecycle and no audio-only HLS. |
| Captured A/V HLS | Retain shared video ingest and coherent delayed A/V | R4; no capability loss or live-video claim. |
| WebRTC/ICE/TURN | Retain selective fast viewing/connectivity | Relay allocation/revocation and delivery tests. |
| mpv, hardware routing, Bluetooth, optional DSP | Retain focused adapters and truthful capabilities | Existing output/compressor/route tests. |
| Native audience receiver/output | Exclude; browser SDK owns audience output | No output helper/native peer/protocol/settings consumers. |
| Lab tuning/measurement campaigns | Keep archival evidence on recovery ref | No lab dependencies in product; bounded fixtures only. |

Useful later fixes are explicit obligations: browser gentle rate correction (±100 ppm); exact routed LAN peers with original security checks; Chrome's independent 200 ms output-clock anchor; browser latency preferences distinct from requested native buffers; native device/rate/buffer readback, bounded capture and Node-upload Origin; output-clock ms/µs correction; late joins including required lead and positive correction; relaxed PCM retained-queue bounds; missing `pactl` guard; radio timer cleanup; encoder prewarm/cadence and capture continuity. Shared PCM/Opus and low-lead experimental hunks require individual review; live audience delivery remains Opus. Defaults favor reliable synchronization.

## Completion evidence

Pending integration. Record exact revisions, commands, results, skips, independent review findings/responses, remote branch heads and PR descriptions here as work completes. Physical Mac-host→Linux-browser/Wi-Fi/background/Bluetooth and 50 physical receivers require fresh evidence; neither synthetic load nor historical native-client trials qualifies them. An unavailable prerequisite gets one preflight and one actionable retry, then independent software work continues. Leave submission, merges and releases to the owner.
