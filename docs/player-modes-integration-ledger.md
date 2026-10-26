# Player modes integration ledger

This is the current completion tracker for the recovered refactor. It accounts for
P0–P7, M1–M11, all 17 use cases and every retirement responsibility. **Live
performance is reopened as an integration completion gate; PR submission is
pending.** [The scoped performance plan](player-modes-live-performance.md) records
the owner's corrected browser PCM/roughly 50 ms reference and comparison gates.
[Final validation](player-modes-integration-validation.md) records fresh commands,
revisions, package/browser receipts and the precise remaining prerequisites.

Read [historical scope and recovery](player-modes-recovery-reference.md) for the
execution contract, unchanged original plan/code map/use cases, accepted ADR and
selective evidence retrieval. Historical passes apply to their recorded source,
not to the integrated product.

## Baseline, layers and ownership

Integration base: `4a194e35cedb30f5ba3e664b4c9734b087051825` (`origin/main`,
2026-10-26). Common ancestor: `59ac6cd6a510ca96bf60dfc9a3628cc635be22e1`;
original tip: `27e580cc3d0b3fc7b4925100777af38324f2b5e3`; later source:
`8147fc98fbeda5b415c3351a10a98c7cab816d4a`. Preserve intervening main's radio
recognition, overlay fixes, fullscreen black bars and Intel Mac/QuickJS support.
There are 11 overlapping paths to reconcile, including Hub, PlayerPage, packaging,
manifest/lock and built-state docs.

Correction to the kickoff record: `gh-stack rebase` automatically fast-forwarded
the owner's clean main checkout from `9240ea9` to `4a194e3`. Main did change;
recovery refs and original investigation worktrees remain intact. Their archival
history and blobs stay outside the implementation ancestry.

| Layer / owner | Branch | Integrated input / remaining responsibility |
| --- | --- | --- |
| Core / parent + scheduler child | `player-modes/integration-20261026` | Foundation `1213ff8`, routed access/sound guards `60ff1cb`, AirPlay fixture `4b52c5c`, scheduler `743206a`: routing/authority, preparation, shared worker and retained adapters. Earlier head `1b07af3` includes captured-video PTS continuity, scheduler fixes and per-operation FFmpeg leases. Restored immediate PCM alongside Opus is tracked under G1–G3. |
| Browser / parent | `player-modes/browser-20261026` | `3685efc` + `9e869de`: renderer, audience/TV controls, pre-native SDK patch, clock/rate/unit fixes and radio cleanup. `85b9f85` corrects the SDK type comment; it changes the maintained patch hash, not its recovered provenance. Earlier head `2ccb203` includes Details queue rights. Browser remains Opus-first and prepares Opus; codec comparison is pending G3. |
| Host / native child | `player-modes/host-20261026` | Earlier head `bc02df3` includes capture `6c62a51`, worker budget `c848407` and explicit Live input selection. Native/hidden-browser capture, grants/IPC/settings and dual-architecture resources are retained. Restored low-lead choices and strict reserves require current package evidence under G3. |
| Validation / parent + R4 and documentation children | `player-modes/validation-20261026` | Earlier checked code/tests head `bd25f9a`: real-media R4, native lifecycle and helper regressions. The reopened Live gate requires updated checks, packages and fixed-head reviews before a readiness verdict. |

Earlier receipt revisions below remain explicit; F1–F6 record the `bd25f9a`
checkpoint. Current heads and receipts for the reopened gate belong in
[validation](player-modes-integration-validation.md). Children use GPT-6.1 Sol xhigh/default and bounded
ownership. Serialize shared Hub/protocol/scheduler/settings edits and stack
mutations. Browser introduces `src/shared/audio-settings.ts` for its first consumer;
Host extends/wires that contract. Current maintained source keeps Browser independent of later Host implementations.

## Packages and module responsibilities

Evidence IDs below refer to the run tables. F1–F6 record the earlier integration
checkpoint; G1–G3 track reopened Live work across P4/P7, M5 and L1–L4.

| Package | Disposition and implementation | Owner | Checks / remaining gate |
| --- | --- | --- | --- |
| P0 | Retain contract/defaults; adapt baseline/drift and runtime intent/units/generations in policy/protocol/ADR 0002. | Core + Validation | E0, exact 213-path inventory; F1/F5 final review. |
| P1 | Combine routing/authority in policy + Hub; recheck async consent/generation; separate controller, publisher and receiver. | Core + Browser | E1/E3/E4/E5: routing, audience, revocation, remote, restart, Stop/Undo; F1. |
| P2 | Retain receiver decoding/protected relays; combine rendition selection and cancellable renderer loads. | Core + Browser | E1/E3/E5: sound-only fetch, picture restore, language, independent Direct/Move; provider/expiry/subtitle/mpv checks under F1. |
| P3 | Retain common relaxed timeline, independent groups and picture follower; expose mapping limitations. | Core + Browser + R4 | E1/E2/E4; actual split/picture-only/fallback/re-ingest checks F2; F1. |
| P4 | Adapt native host + browser capture into clock normalization/shared Opus plus immediate Live PCM; retain fixed deadlines, prewarm/reset/queue/isolation fixes. | Core + Browser + Host | E2/E3; native authority/upload and packaged host→browser F3/F4; reopened software/physical comparison G1–G3. |
| P5 | Retain Play on isolation, exclusive Move/TV menu and source-owned Live audience; bound pairing/setup/fanout/state work. | Core + Browser | E1/E3/E5/E6: UI/legacy/REST/remote authority, actual browser Move, routed peers; synthetic fanout E2; F1/F4. |
| P6 | Replace timestamp-capable audio-only/AirPlay HLS with scheduled PCM ingress; retain coherent captured A/V and WebRTC/TURN. | Core + Browser + Host + R4 | E1/E2/E4; R5/R6 no-HLS and cleanup; hidden capture F3; R4 continuity F2. |
| P7 | Account for retirements and source provenance; package matched frontend/Main/Core/worker; maintain truthful built-state docs. | Validation + Host | E0–E6 and F1–F6 retain their recorded revisions; G1–G3 and current validation gate readiness. |

| Map | Disposition / concrete seam | Owner | Check responsibility |
| --- | --- | --- | --- |
| M1 | Adapt shared policy/protocol and runtime admission; preserve durable queues/history/defaults and ordinary restart; absent intent is relaxed. | Core; Host settings extension | media-shape, playback-policy, consent-restart, history/Stop-Undo; E1/E4, F1. |
| M2 | Combine delivery/authorization in Hub; one Playback per receiver, held publisher/newest-tab rules and recipient filtering stay. | Core | routing/device-sharing/live-audience/output-admission/remote; E1/E3, F1. |
| M3 | Combine `source-preparation` selection; retain providers/yt-dlp/signed Range/playlist/public-destination access. | Core | source-preparation/language, real fetch counters, YouTube/relay/expiry/quality; E1/E3, F1. |
| M4 | Adapt renderer/SDK/picture mapping; retain host-only mpv, selected tracks, optional Direct/relaxed DSP and one volume stage. | Browser + Core | renderer-hls, output-clock, SDK, compressor/mpv/playback screens; E3/E5, F1/F4. |
| M5 | Combine worker/clock/receiver/fanout; keep URL read-ahead versus fixed-capture policies. Shared Live PCM/Opus with independent bounded fanout; browser remains Opus-first. | Core + scheduler child; Host policy extension | capture-clock/continuity/reset, late-join, relaxed queue, encrypted isolation and synthetic 50-client fixture; E2/F1 are earlier receipts; restoration/comparison G1–G3. |
| M6 | Adapt native host capture/upload plus selected hidden browser capture; keep local grants, ownership, explicit mute/stop and upload generations. | Host + Browser + Core | native-capture/authority, capture-format/consent/close/quit, upload/revocation; E2/E4, F3/F4. |
| M7 | Retain WebRTC/ICE/STUN/TURN and one buffered recorded A/V ingest per publication; retain container AAC-PTS clock only inside that adapter. | Core + Browser + R4 | live stream/delivery/channels/tracks, relay allocation/revocation; E4; real fallback/third viewer/re-ingest F2. |
| M8 | Adapt decoded AirPlay PCM at 44.1 kHz into relaxed scheduling; retain one-sender takeover/lifecycle and OS sound/Bluetooth routing. | Core | AirPlay/sound-session/device-volume/output controls; E1/E3; actual Apple sender/hardware F4. |
| M9 | Adapt routing/player/queue/share/Remote/hotkey/Media Session consumers to Core rights; reuse existing discovery and consent UI. | Browser; Host settings/Share readback | audience-ui/Where-it-plays/Play-on/menu/TV/keyboard; E3/E5; final journey F1. |
| M10 | Retain identity/certificates; adapt pairing budgets, setup/socket/retry bounds, state deduplication and source cleanup. | Core + Browser | identity/pairing/startup/revocation, zero-volume/permission freshness, isolation/scale; E1/E2/E4/E6, F1. |
| M11 | Adapt pinned patches, worker/helper packaging and docs onto current-main shell/QuickJS/platform floors. | Core + Browser + Host + Validation | frozen install/three TS projects/build, package-hooks, act, signed resources/packaged smoke; F1/F3/F5. |

Map-listed unchanged consumers remain retained responsibilities: provider/proxy/
subtitle/history adapters, `MediaContext`/player-control/remote-session helpers,
ICE/STUN/TURN/native relay, sound/Bluetooth, device identity and startup/helper-update
activity tracking. Their shared policy integration is checked through public
behavior; absence from the recovered changed-file union is not a retirement.

## All 17 use cases

| Case | Implementation / owner | Acceptance check and evidence / remaining work |
| --- | --- | --- |
| D1 | Independent local-decode Playbacks / Core + Browser | E5: two actual H264/AAC browser decoders with separate queues; E1 policy/isolation; F1 final regression. |
| D2 | Sound-only rendition/own listening / Core + Browser | E1 sound-only request counters, muxed fallback and picture restore; E3 renderer/volume; F1 provider/quality coverage. |
| D3 | Explicit Play on isolates destination / Core + Browser | device-sharing/routing + Play-on checks E1/E3; other listeners/queues survive; F1 final journey. |
| D4 | Captured source reception / Core + Browser | Retain selective RTC and existing-source join semantics; E4 tracks/delivery/revocation; actual fallback F2. |
| D5 | Permitted remote single destination / Core + Browser | E1 consent/controller routing; E3 Remote; host-only mpv and denied/stale destination coverage F1. |
| D6 | Exclusive queue-preserving Move / Core + Browser | E5 actual second browser retains paused Playback ID, two-entry queue and 37.240293 s; E3 TV OK-menu logic, E1 async denial/generation; F1. |
| R1 | Shared collaborative music / Core + Browser | E1/E2 joins, shared queue/transport/levels, one encode per required format; F1 final runtime. |
| R2 | TV picture / separate phone sound / Core + Browser | Common timeline/channel-only fetch; E1/E3 mapping/delay checks; actual split buffered A/V F2; physical alignment F4. |
| R3 | Several following pictures / Core + Browser | E4 sync/clock plus picture-only timer E2; native-HLS/MPEG-TS source-PTS mapping limits stay visible; F1/F2. |
| R4 | Delay-tolerant screen/window A/V / Core + Browser + R4 | E4 Node suites pass; actual third viewer, failed RTC fallback, split/picture-only and single-ingest cleanup F2. Source PTS continuity fix is integrated at `e5063df`; final actual-media evidence remains F2. |
| R5 | AirPlay input / Core | E1 corrected fixture passes one-sender/host takeover/disable/departure/recovery and scheduled no-audio-HLS; actual Apple sender F4. |
| R6 | Relaxed audio input / Core + Browser + Host | E2/E4 timestamped ingress/relaxed PCM/retry/cleanup; native or selected hidden capture with no second mic/recorder F3; unsupported publishers retain explicit compatibility. |
| R7 | Independent shared programmes / Core | E1 language/routing and separate queue/timeline tests; F1 simultaneous-group/Next regression on final build. |
| L1 | Native host → normalized capture → shared PCM/Opus sender; browser Opus-first / Host + Core + Browser | E2 synthetic 50-client fanout; F3 earlier signed capture/upload/browser path; G1–G3 restored transport and physical codec comparison; F4 broader physical/scale goals. |
| L2 | Join present without retiming audience / Core + Browser | E2 ready time + required lead + positive correction, original healthy bytes/timestamps unchanged; E3 decoder/output admission; F1. |
| L3 | Own level/mute and Leave / Core + Browser | E1 crafted/legacy programme rejection; E3 UI/Remote/hotkey/Media Session; leaving preserves source and other listeners; F1. |
| L4 | Reconnect/output change / Core + Browser | E2/E3 generation/token/clock/output invalidation and fresh admission; failed/slow receiver isolated; actual route/background states F4. |

## File inventory and retirement

[The CSV](player-modes-file-disposition.csv) is the exact union of 131 original
changed paths and 112 later paths (30 overlap): **213 unique rows**. Provenance
comes from `59ac6cd6..27e580c` and `27e580c..8147fc9`, not file naming or time cuts.
Dispositions are **103 retain / 67 adapt / 43 exclude**. Restoring
`src/server/live-pcm.ts` and `tests/live-pcm.test.ts` changes two exclusions to
adaptations; the path inventory and provenance stay fixed. Browser Live PCM
predates the excluded native audience implementation.
`retain` preserves a responsibility; `adapt` requires selective integration;
`exclude` stays on the recovery ref with its reason/replacement. Ownership can
span sequential layers. Rows describe disposition/check ownership; final import, retirement and passing
checks are reconciled in the validation receipt. Large historical docs/tools are explicitly excluded
from maintained guidance, with pointers in the recovery reference.

Host retains `src/client/session/native-audio.ts`, `src/client/capture-audio.html`
and `tests/native-live-authority.test.ts`: they produce/protect host capture.
Browser owns output-clock fixture/radio/Where-it-plays tests and its SDK patch.
Host's settings/capture extensions follow the first Browser shared contract.

| Retirement responsibility | Disposition, stage/clock/resource owner | Replacement check / remaining gate |
| --- | --- | --- |
| Ordinary Direct decoding/providers/bytes | Retain selected encoded tracks → receiver decode/native position; Core resolves/relays, renderer owns load generation. | Source/relay/renderer/mpv checks E1/E3; F1. |
| Hidden video for sound-only | Replace with available audio rendition; retain muxed fallback. Restore picture by re-resolution without replacing queue. | Real request counters E1; renderer/quality/Move E3/E5; F1. |
| Scattered routing/authority/capability inference | Combine Core policy/actor controls/Hub rechecks; retain `inSync` only for relaxed captured compatibility. | REST/socket/remote/legacy/OS, consent/stale-generation E1/E3; F1. |
| URL and capture scheduling | Shared worker/clock/fanout; URL decode once + encode once per needed format/Playback; normalized capture → immediate Live PCM plus shared Opus. Core owns independent bounded wire queues and receiver cursors. Relaxed PCM and distinct sender policies stay. | Continuity/prewarm/reset/late-join/queue/isolation E2/F1; restored dual-wire checks and physical comparison G1–G3. |
| Audio-only recorder → AAC/HLS | Replace on timestamp-capable browser/native capture and decoded AirPlay; publisher/Main owns acquisition, Core publication/worker owns ingress/encoder. Unsupported relaxed publishers keep recorder compatibility. | No-HLS/lifecycle E1/E2/E4; Host hidden-capture F3. |
| Captured A/V HLS/delayed fallback | Retain recorder → shared rolling video/AAC HLS → group audio/muted pictures; AAC PTS clock and picture-only `anullsrc` stay localized. Core owns one encoder/temp tree per publication. | E4; actual timeline/re-ingest/third viewer/fallback and cleanup F2. |
| WebRTC/ICE/TURN | Retain captured tracks → peer codecs/local A/V; peer generation, Core signaling consent and relay helper own resources. Removal needs replacement evidence/agreement. | Tracks/delivery/ICE/STUN E4; real TURN allocation/revocation and fallback F1/F2. |
| mpv, hardware/Bluetooth routing, optional DSP | Retain focused host helper/output adapters; Direct/relaxed opt-in compression remains separate from Live. Output changes invalidate Live admission. | mpv/compressor/sound/output checks E1/E3; physical routing F4. |
| Lab tuning, duplicated mono, test capture, unbounded campaigns | Exclude from product; bounded deterministic fixtures and supported public SDK corrections replace useful mechanisms. Measurement tools/licenses remain together on recovery ref. | Runtime/build dependency and maintained-source search F1/F5; Live rejects mono. |
| New native audience output | Exclude native peer/output/helper/IPC/settings/credential export and playback build; browser SDK owns audience decode/output. Keep native host capture, shared browser-compatible Live PCM and existing OS routing. | Mixed-file/Host bridge/package removal searches F3; shared PCM/Opus admission and healthy-peer isolation G1/G3. |

Useful later fixes retained individually: ±100 ppm browser correction, independent
200 ms Chrome clock anchor, finite 0–10 ms clock-uncertainty guard, browser latency
preference, exact routed IPv4 peers, upload Origin, native UID/rate/buffer readback,
late-join lead, relaxed PCM pending-versus-sent bounds, missing-pactl guard, radio
idle unsubscribe, encoder prewarm/prompt fanout and capture-generation continuity.
Integrated Host policy retains **100 ms default lead / 70 ms receiver budget**
and **10 ms Opus packets**. Restored Live PCM sends available normalized samples
immediately in packets of **at most 240 frames**, independently of encoder lookup.
Lead choices are **45/50/55/75/95/100/150/250 ms**; source reserves are 20 ms through
55 ms, 25 ms below 100 ms, and 30 ms thereafter. **45 ms keeps a strict 25 ms
receiver budget**. Each publication freezes its policy; relaxed capture keeps one
second. PCM admission retains its **65,536-byte** capacity floor versus Opus's
**4,096 bytes**, with timing, identity, preparation and correction guards intact.
Browser clock/rate fixes, Opus prewarm, FFmpeg leases and capture continuity remain.
Core transport restoration alone does not complete browser codec or physical qualification.

## Evidence and outstanding gates

Parent scratch root: `/home/avoid/.t3/worktrees/couch/player-modes-integration-20261026/.scratch/player-modes/`.
These earlier receipts retain their original revisions and limits. The completed
F1–F6 table and [final validation](player-modes-integration-validation.md) supersede
their original pending-work notes. G1–G3 and the scoped performance plan track the
reopened gate; earlier passes remain scoped to their checked source.

| ID | Observed result / receipt | Limit |
| --- | --- | --- |
| E0 | Base `4a194e3`: frozen install, three-project typecheck, production build and **78 separate unit files** pass; `baseline-{install,typecheck,build,units}.log`. Node 24.21.0 / repo Bun 1.4.2. | Baseline only; unit files run separately because module mocks interfere. |
| E1 | Parent `core-integrations/results.json`: policy/routing/device-sharing/audience/isolation/source-language/live-output/capture-upload pass. Initial group-language and AirPlay failures have successful `core-group-language/` and `core-airplay/` reruns. | Initial output-admission could not build before Browser; E3 supplies the later pass. Preserve initial failures and fixes. |
| E2 | Scheduler `743206a`; child `.scratch/player-modes/checks/receipt.json` at `/home/avoid/.t3/worktrees/couch/t3-71b70af4`: **26/26 Node tests, 10/10 unit tests**, all three TS projects/focused checks and build pass; four causal negative controls fail as expected. Node patch matches pre-native hash. | Receipt base `1213ff8`; output-admission public integration then required Browser. Initial sendspin-ahead mismatch passed standalone and final rerun; initial log retained. 50 encrypted clients are synthetic, not physical receivers. |
| E3 | Core+Browser through `9e869de`: **88 separate unit files** pass (`browser-units/results.json`); SDK/output-clock/admission logs pass. `browser-admission/results.json`: all six Node suites pass (public admission, SDK preparation, receiver lifecycle, Remote controls/queue, sound-session). | Final Host/settings/package and integrated frozen-install/build reruns F1/F3 remain. |
| E4 | `retained-av/results.json`: **15 Node suites pass**, covering stream/clock/sync/delivery/channels/input/tracks/upload failure/reporter retry/revocation/startup/ICE/STUN/Stop-Undo/consent-restart. | Does not close actual-media R4 continuity/fallback gaps; F2. |
| E5 | Actual T3 preview Chrome, source `9e869de`; `browser-receipts/core-browser.json`: five React radio subscription checks, eight desktop keyboard checks, two actual H264/AAC decoders with independent queues; exclusive Move keeps paused Playback ID, two-entry queue and **37.240293 s** on second browser. | Localhost/127 origins; no physical timing qualification. Final-tip/TV/Host coverage remains separate. |
| E6 | Parent real-Hub routed test at `9e869de`: Docker peer `172.17.0.2` → `10.10.10.11:49726`, exact allowlist: connection 200, bad Host/Origin 403, tokenless settings/private host-token 401; allowlist containing only `.3` refuses `.2` with 403. Disabling sharing closes listener and refuses the same allowed peer. `routed-peer-{allowed.json,denied.log,sharing-off.json,sharing-off.log}`. | Specific routed topology/security behavior, not Wi-Fi/audio qualification. Parent reports all owned scratch Core/media PIDs stopped. |
| E7 | Parent reports current Host `f07fe9f` over Core `e5063df` / Browser `1050968`: **92 separate unit files / 688 tests pass**, **eight Host/scheduler Node bundles pass**. Per-source budget real-worker regression passes and its red control fails. `act` Check passes at `f07fe9f`. | Full `act` Package is still building; exact final receipts/commands/skips and independent reviews remain parent-owned. New `tests/live-source-budget.integration.ts` is post-recovery coverage, outside the fixed 213-path source union. |

| Marker | Final disposition and evidence |
| --- | --- |
| F1 — integrated checks | Closed on `bd25f9a`: every layer passes frozen install/three-project typecheck/build; 92 unit files / 688 tests pass; 59 Node bundles cover 533 checks after the real AirPlay rerun. Exact commands, original failures, reruns and counts are in [validation](player-modes-integration-validation.md). |
| F2 — R4 continuity | Closed: Core `e5063df` and Validation `e77463a`; real WebM→HLS, forced RTC fallback, split/picture-only sound, independent late browser viewer, absolute PTS across re-ingest and owned resource cleanup pass. Successful ordinary RTC video decoding also has a separate packaged-browser receipt. Physical A/V alignment stays F4. |
| F3 — Host/package/settings | Closed software/package gate: final Linux act and hosted Linux/Windows/signed dual-arch Mac Package pass; 94 Linux package assets match the maintained build. Real packaged hidden stereo input→Core→Opus→Chrome passes at 250 ms lead. All five native lifecycle checks pass; final hidden-Live rerun passes on `bd25f9a`. After the owner granted Microphone, the same signed Mac package's actual UMC404HD native input delivered stereo Opus to Linux Chrome: 14,436 buffers, 703 after rejoin; Stop and explicit Quit clean up. See validation for the default-profile relaunch exception and audit. |
| F4 — physical/platform qualification | Open: the earlier signed native Mac capture/delivery receipt and 141/70 ms refusal remain in validation. The 141 ms admission estimate is not a physical floor. Fresh known-stimulus `maintained-r2` is G2; codec comparison and low-latency reliability remain G3. Physical skew/fidelity/dropout, 50 physical receivers, Intel Ventura execution, Apple sender, Bluetooth and locked/background Wi-Fi phones remain unqualified. |
| F5 — review/handoff | Earlier checkpoint closed: independent spec and standards reviews of `4a194e3...bd25f9a` report no actionable findings after all three round-1 fixes. The stack is pushed; [PR handoff](player-modes-pr-handoff.md) records proposed bases/descriptions. Reopened changes require current fixed-head reviews and evidence under G3; PR readiness and submission remain pending. |
| F6 — historical separation | Closed accounting: Browser R4 `5ce1d68e…` and Native R4 `ee16cdca…` are distinct archived payloads. Recovery archive and original investigation trees remain intact and outside implementation ancestry. Historical browser PCM predates native audience output; neither its passing interval nor native-output trials qualify the restored product. |

The following receipts live under the parent's `.scratch/live-performance/`, beside
the earlier `.scratch/player-modes/` evidence. See the
[performance gate](player-modes-live-performance.md) and validation for exact
source/package identities, commands and current results.

| Gate / owner | Current disposition and evidence |
| --- | --- |
| G1 — transport restoration / Core + Host | `transport-audit/` demonstrates the earlier loss of browser-compatible PCM and five public lead choices; `browser-audit/` identifies r15's executed PCM override versus maintained Opus preparation. Core restores `live-pcm.ts`, immediate PCM alongside Opus and independent bounded fanout; Host restores choices/reserves above. Shared source, authority, admission, Opus and relaxed behavior remain required checks. |
| G2 — physical witness / parent | `maintained-r2/evaluation/result.json`: 100 ms Opus lead, both channels 55/55 accepted windows, **102.4696 ms median**, failing the **50 ms gate**. Restored-codec comparison remains G3. Historical r15 passes at about 48.543 ms; r16 fails and stays alongside it. The exact old ad-hoc Mac package's fresh repeat is TCC-blocked by its different signing identity; current signed capture and physical wiring work. |
| G3 — completion / parent + Browser + Host + Validation | Open: browser remains Opus-first and prepares Opus. Physical codec comparison, restored-source validation, same-source hosted Package result and fresh independent reviews must be reconciled before readiness. Package dispatch is in progress; dispatch alone is not a passing receipt. Performance and PR readiness remain unresolved. |
