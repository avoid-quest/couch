# Mac host capture decision

Status: open. This is an integration completion gate for P4/P5/P7, M5/M6/M10
and L1–L4. PR submission remains pending. Native capture is a desktop-only
candidate; browser clients continue to use browser capture and output APIs.

## Bounded protocol

Use the two existing input selections in the same signed maintained Mac app:
Chromium capture and PortAudio/CoreAudio capture. The preserved experiment is
`recovery/player-modes-20261026:docs/audio-native-device-controls-research.md`,
section “One next controlled experiment: native ownership at 48 kHz”, plus
`docs/audio-native-reuse-options.md` on that ref. Both were read before setup.

1. Establish one ordinary Chrome/Chromium receiver using the maintained Couch
   browser client and supported public Web Audio preferences. Record its version,
   owned profile, constructor preferences, actual base/output latency and output
   timestamps. Keep Linux audio settings fixed; Electron command-line buffer
   switches and the earlier Electron benchmark do not qualify this route.
2. Freeze package/Core/assets, wire codec/packetization, lead/reserve, browser/
   profile, route/network, levels, identifiable stimulus and coherent witness.
   Use 48 kHz/stereo and request 128 native user frames, matching Chromium's
   delivered frames where supported. Log native HAL readback, native user blocks,
   Chromium delivered blocks and witness blocks as separate observations.
3. Run Chromium then native sequentially, with one producer per generation.
   Require identifiable nonzero input before scoring. Retain capture→Core
   age/jitter/gaps with explicit clock offset/uncertainty, separately from actual
   source→browser analog roundtrip, accepted coverage and waveform defects.
   File-start offsets are not capture latency. Keep all failures.
4. Run one confirmation pair after valid setup. Stop after these two matched
   pairs. A persistent unavailable prerequisite gets one actionable retry, then
   a precise blocker and the available host-stage comparison. A receiver blocker
   ends physical qualification for this pass; continue independent integration
   work. Defer output tuning, rate/buffer sweeps and new receiver implementations.

A common diagnostic lead may make the backend comparison observable; it does
not waive the roughly 50 ms usability reference or change strict admission.
Adopt native capture only for a demonstrated useful improvement in latency,
integrity, robustness or device behavior, with timing uncertainty and repeat
limits included. Controls/readback alone do not prove a latency improvement.
If no useful improvement is established, record that verdict without forcing
native adoption. Preserve both implementations and evidence while deciding.

## Prior evidence and accounting

The earlier Electron codec comparison remains separately identified in
[Live performance](player-modes-live-performance.md). Its passing intervals and
bad repeats do not answer this host-backend decision.

The read-only older-work audit is
`/home/avoid/.t3/worktrees/couch/t3-9cb20eb2/.scratch/mac-host-capture-audit-20261026/README.md`
and `older-draft-prs.json`. The ledger's G5 tracks the seven drafts and four
follow-on branches, including missing bounded publisher setup. Native receiver
results, the earlier opposite-host stereo experiment and synthetic scale work
remain historical evidence with their original limits.

## Result

Pending setup, matched captures, uncertainty analysis and adoption verdict.
