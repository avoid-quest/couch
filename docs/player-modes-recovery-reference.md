# Playback scope and recovery references

Use the [integration ledger](player-modes-integration-ledger.md) for current owners,
implementation dispositions, fresh results and pending checks. The
[file inventory](player-modes-file-disposition.csv) accounts for all 213 recovered
changed paths. This index preserves access to historical scope/evidence without
copying archives or turning experimental results into support claims.

## Scope to read when implementing or reviewing playback

The following local imports preserve the historical scope text. Their “current”
and “proposed”, original baseline and workspace instructions refer to October
24–25 inputs. Their notices point back to the current ledger.

- [Execution plan](audio-video-refactor-plan.md): all P0–P7, acceptance rows and
  simplification obligations.
- [Code map](audio-video-refactor-code-map.md): all M1–M11, unchanged dependencies
  and the original nine retirement rows.
- [Use cases](audio-video-use-cases.md): D1–D6, R1–R7, L1–L4 and action meanings.
- [ADR 0002](adr/0002-playback-delivery-and-authority.md): accepted delivery,
  authority, units and generation model; fresh validation is separate.

The execution contract is
`recovery/player-modes-20261026:docs/player-modes-integration-handoff.md`
(commit `3df02949cbfeb4f9f43ac73379e66b58fb6f1afd`). Read it before changing
integration ownership or gates. The immutable recovery README/history audit explain
which later host/browser fixes survive and which native audience paths are excluded:

```sh
git show recovery/player-modes-20261026:docs/player-modes-integration-handoff.md
git show recovery/player-modes-20261026:docs/playback-recovery/2026-10-26/README.md
git show recovery/player-modes-20261026:docs/playback-recovery/2026-10-26/history-audit.md
```

Browser Live PCM predates the excluded native audience implementation. The current
integration restores the shared PCM producer/fanout and low-lead settings while
retaining native host capture, Opus and strict admission. Native audience
helpers/IPC/credential export remain excluded. Read the
[Live performance gate](player-modes-live-performance.md) before treating transport
restoration or a historical pass as preserved physical performance; browser
preparation remains Opus-first and the codec comparison is still open.

## Provenance and selective retrieval

| Input | Identity / use |
| --- | --- |
| Original refactor | `27e580cc3d0b3fc7b4925100777af38324f2b5e3`, after ancestor `59ac6cd6a510ca96bf60dfc9a3628cc635be22e1`; 131 changed paths. |
| Later source | `8147fc98fbeda5b415c3351a10a98c7cab816d4a`; 112-file overlay, 30 overlap with original. Read source directly with `git show`; import selected responsibilities onto current main. |
| Frozen evidence | `f2af19fa24c8c60ed5909639dc6945c42773e87e`; recovery `evidence-index.json`, `source-checkpoints.json`, `manifest.json`, `checkpoints.json` and `native-helper.json` locate exact source/artifact identities and redactions. |
| Assigned-checkout trap | The later 23:19 checkpoint is identical to `27e580c`; the actual edited checkout supplied the later overlay. A timestamp cutoff cannot separate overlapping host/client work. |

For an omitted document linked by the historical scope, use its original repo
path on the recovery ref:

```sh
git show recovery/player-modes-20261026:docs/audio-video-refactor-validation.md
```

Consult that historical validation for old check meaning and known gaps, not for
final integration status. Other recovery-only references are selected by concern:

| Concern | Original `docs/` path(s), available through `git show` |
| --- | --- |
| Prior architecture/cost/review rationale | `audio-video-architecture-proposal.md`, `audio-video-costs.html`, `audio-video-independent-review-{opus,sol}.md` |
| Official API/transport choices and experiment mechanisms | `audio-video-alternatives-evidence.md`, `audio-video-experiment-evidence.md` |
| Native host devices/platform controls | `audio-native-device-controls-research.md`, `audio-linux-defaults-research.md` |
| Excluded native audience alternatives | `audio-native-receiver-reuse-research.md`, `audio-native-reuse-options.md` |
| Large experimental history/measurement limits | `audio-roundtrip-performance.md` (1,910 lines), `sync-test-evaluation.md`; detector `scripts/audio-roundtrip.py`, its license and `tests/audio-roundtrip.test.py` stay together on recovery. |
| Deferred video research | `audio-video-moonlight-sunshine.md`; zones/private mode/remote game input/new low-latency video are outside this integration. |

Use the evidence index to select archive members and verify their archived hashes;
read only the relevant members, with no need to extract the whole archive. The
pre-native patches are under `audio-native-desktop-output-r1/`:

- `browser-patch.before`: SHA-256
  `10f9c3c499587832ed5ac8bfeed6d70d361f287e62c2574108d41711f05cd890`.
- `node-patch.before`: SHA-256
  `eb4a8654e780e0767fed92bebaff5f6fb7a0a4ba72245c8961a6cc1aa3cb7734`.

These are **recovery source hashes**. The maintained browser patch's corrected
rate-bound type comment changes its final file hash. Consult
[patch guidance](../patches/README.md) for current semantics/removal gates.
Other useful indexed prefixes are `audio-roundtrip-sync/live-rate-correction-cap100-r1/`,
`wifi-clock-replay-r1/`, `routed-peer-r1/`, `advanced-audio-settings-r1/`,
`relaxed-pcm-queue-fix-r1/`, `latency-probes-prewarm/`, plus
`audio-live-join-lead-r1/`, `audio-native-desktop-r2/` and `audio-supported-live-core-r1/`.
The shortened prefixes before “plus” share `audio-roundtrip-sync/`.

Browser `Couch Audio Lab R4.app` (`5ce1d68e…`) and
`Couch Audio Lab Native R4.app` (`ee16cdca…`) belong to separate sequences.
ASAR identity and native capture sample coherence are reference evidence.
Historical browser PCM r15 passes at roughly 48.543 ms; its r16 repeat fails.
Those browser results remain separate from excluded native audience output.
Neither establishes restored packaged browser performance, physical
latency/skew/fidelity, Wi-Fi/background behavior or 50 physical receivers.
Recovery refs, original investigation trees and frozen evidence remain intact.
