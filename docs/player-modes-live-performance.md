# Live performance completion gate

Status: **open; integration completion and PR submission are pending**. This gate
supersedes the earlier claim that 250 ms scheduling plus decoded buffers was a
sufficient Live integration outcome. Preserve the useful Core/Browser/Host/
Validation stack and its correctness, retirement, packaging and review evidence.

## Reference and scope

The owner requires preservation of the observed roughly 50 ms browser capability.
Read-only recovery evidence is in the original investigation checkout
`/home/avoid/.t3/worktrees/couch/t3-3c4248e6/.scratch/audio-roundtrip-sync/`
and the archive indexed by `recovery/player-modes-20261026`.

- `mac-host-swap-r15/result.json`: both channels 55/55 accepted windows; median
  about 48.543 ms, p95 about 48.938 ms, maximum about 48.961 ms; zero waveform flags.
- `mac-host-swap-r16/result.json`: both channels 46/55 accepted; 4,747 / 4,727
  flagged waveform windows. Retain this failing repeat beside r15. A successful
  interval is not reliability qualification.
- r15's manifest names ordinary Mac UMC input 1/2 capture, Couch Core over wired
  LAN, Linux ALC892 browser output returned to UMC input 3/4; 48 kHz stereo /
  128-frame capture blocks, S16_LE PCM wire / maximum 240 frames / 45 ms lead,
  receiver 256 frames and Pulse latency request 1 ms.
- r15 used a package plus exact compiled browser-asset overlays. Freeze their
  individual identities and execution receipts; a candidate directory name alone
  does not establish the executable comparison.

Browser PCM predates the excluded native audience implementation. Assess its
transport, supported settings and low-lead reserve independently. Retain native
host capture and all useful integrated correctness fixes. Do not introduce native
audience output, weaken admission thresholds or select a codec before evidence.
The earlier 141 ms value is an admission estimate for its tested output/profile,
not a physical hardware floor. Existing Mac microphone access is now granted.

## Execution and completion criteria

1. Copy and hash selected harness, calibration, manifests and source/assets into
   owned scratch. Preserve original worktrees and archive. Record current stack
   heads, tool versions and read-only physical device/route availability.
   Done when both historical outcomes and their comparison inputs are identified.
2. Establish one agent-runnable physical-loop command with a known stimulus and
   actual analog return. Reuse the archived evaluator and its negative controls;
   first replay r15/r16 to prove the verdict catches defects. Freeze source,
   package/assets, profiles, wire, devices, clocks and evaluation intervals before
   acquisition. Check wiring with a bounded diagnostic before comparative runs.
   If unavailable, record the exact missing physical prerequisite, keep this gate
   open, and complete independent causal software comparisons.
3. Compare frozen prior and maintained source on the same physical topology.
   Record actual AudioContext constructor latencyHint, baseLatency, outputLatency,
   output timestamps, selected route, ALSA/Pulse buffers, capture rate/block sizes,
   wire codec/packet cadence/lead and scheduling. Minimize the red symptom, then
   rank falsifiable causes before one-variable probes. Done when matched evidence
   explains the 141 ms estimate and loss of low-lead usability.
4. Add focused causal regressions at the real boundary, demonstrate red, and fix
   supported behavior in its owning gh-stack layer. Preserve authority, admission
   integrity, source continuity, fanout bounds and cleanup. Run bounded matched
   fresh-start repeats, retaining every pass and bad repeat with waveform/coverage
   and timing verdicts; do not select only successful intervals.
5. Revalidate affected integration/package paths, obtain fresh independent reviews
   of fixed base/head, update ledger/dispositions/PR bodies and push all affected
   layers. Completion reports measured physical roundtrip and reliability results
   or a concrete unresolved blocker. PR submission remains pending.

Use `diagnosing-bugs` for the feedback loop and `writing-for-agents` for briefs
and receipts. Delegated diagnosis uses T3-owned GPT-6.1 Sol xhigh/default with
verified returned settings. Parent owns physical acquisition, shared interfaces
and stack mutations; children have bounded disjoint ownership. Every Couch launch
must carry explicit isolated `COUCH_DATA_DIR` and `COUCH_PORT`; own and stop each
PID. Preserve personal data and installed apps. This is the newly authorized Live
integration gate, not a resumption of the old stopped audio goal.
