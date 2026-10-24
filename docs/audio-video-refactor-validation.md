# Playback refactor validation and retirement

Implementation starts from `59ac6cd6a510ca96bf60dfc9a3628cc635be22e1`, exactly the audited baseline, on `refactor/couch-playback`. The checkout was clean. Planning documents were copied from the assigned research worktree before delegation; experimental source changes were not copied.

## Baseline before product edits

Pinned Bun 1.4.2 (`node_modules/.bin/bun`), Node 24.21.0, Linux x64. Frozen install, typecheck and build passed. Each of the 75 Bun test files passed in a separate process. A combined `bun test` run had 422 passes, 15 failures and 12 errors from cross-file module mocks; it is not the reliable test invocation for this repository.

Thirty-one affected Node integration suites were bundled against the unchanged source. The first run had 28 successful suite exits, two failures and one helper-download timeout. Some suites skipped real media because FFmpeg was absent from PATH. After isolating the test-downloaded helper and adding FFmpeg 9.0.2 to the test PATH, the frozen device-sharing, live-input and live-delivery bundles passed all 51 tests. Frozen live-clock, live-stream, sendspin-ahead and compressor-sendspin passed all 14 tests without skips, including Opus and PCM. These are software/fixture checks, not physical timing measurements. Other native/helper prerequisite skips remain gaps until rerun.

Raw baseline commands, per-suite logs and machine-readable results are retained in `.scratch/playback-baseline` in the implementation checkout. Scratch helpers and data are isolated there or in test-owned temporary directories; the installed Couch and its data were not used.

## Story completion checklist

This is an execution ledger. Pending rows are not completion claims. The final integrated revision and results will replace pending entries.

| Stories / acceptance | Owner | Planned evidence | State |
| --- | --- | --- | --- |
| D1/D3 independent programmes and queues | Core | real Hub Play/Play on, independent queue and output transitions | Pending integrated checks |
| D2 sound-only efficiency | Lead / UI | protected relay and renderer fixture with no video fetch; muxed fallback | Source preparation fixture passes; Hub/renderer pending |
| D4/D5 remote/TV and captured Direct | Core / UI | remote authority, native/WebRTC delivery, retained relay | Pending integrated checks |
| D6 queue-preserving moves, including TV | Core / UI | stale/denied handoff, TV keyboard/menu journey | Pending integrated checks |
| R1/R2/R3/R7 synchronized and split A/V | Audio / Core / UI | group clock, picture-only and split-device joins, transitions, independent groups | Pending integrated checks |
| R4 retained relaxed screen sharing | Audio / Core / UI | captured HLS timestamps, fallback isolation and lifecycle | Pending integrated checks |
| R5/R6 AirPlay and relaxed capture migration | Audio / Core | timestamped PCM source lifecycle, one/many receivers, no AAC/HLS intermediate | Pending implementation |
| L1 capture → stereo Opus → receiver | Audio | deterministic clock/drift/reset/queue/readiness tests and integrated product path | Pending implementation; physical qualification absent |
| L2/L4 admission, joins and recovery | Audio / Core / UI | incompatible/slow joins and output changes cannot retime or pause healthy audience | Pending implementation |
| L3 audience authority | Core / UI | crafted/legacy/REST denial, local leave and volume, owner source end | Pending implementation |
| All: generation/lifecycle | All owners | cancellation, consent revocation, newest tab, source end, disconnect, shutdown | Pending integrated checks |
| All: access and output | Lead / Core / Audio | protected relay, signed URLs, upload consent, Sendspin identity, retained TURN/sinks/DSP | Source-selection relay fixture passes; remainder pending |
| All: distribution and docs | Lead / Audio | integrated typecheck/build, native/browser checks, act where packaging changes | Pending integrated checks |

## Retirement ledger

| Responsibility | Planned disposition | Evidence required |
| --- | --- | --- |
| Ordinary Direct decode and provider/byte adapters | Keep; combine source selection/loading | Direct source and renderer suites, no server transcode |
| Hidden video with a separate audio rendition | Replace | Sound-only fetch fixture and picture restoration |
| Scattered delivery/authority inference | Combine in Core policy and actor controls | All entry points and stale transitions |
| URL group and capture audio delivery | Combine machinery; retain read-ahead/fixed-deadline sender policies | Both policies run through common module |
| Audio-only recorder/AAC/HLS | Remove where timestamped capture/AirPlay covers it | R5/R6 lifecycle and no intermediary codec pass |
| Captured A/V HLS and delayed fallback | Retain for existing screen-sharing compatibility | Common A/V timeline and cleanup; no capability removal authorized |
| WebRTC, ICE and TURN | Retain pending fast-path decision | Existing coverage; no new video implementation or silent removal |
| mpv, native/Bluetooth output, optional compression | Keep focused adapters with honest controls | Unsupported actions rejected/hidden; preserved native capability |
| Lab hacks, duplicate mono, global buffer tuning | Exclude | Supported SDK correction and truthful channel/timestamp contract |

For final retained stages, record input/output, clock, codec passes and resource owner. For final deletions, record replacing tests and remaining-consumer search. Current rows describe intended work, not finished retirement.
