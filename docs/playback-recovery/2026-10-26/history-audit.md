# Playback history and recovery audit

The pushed playback refactor ends at `27e580cc3d0b3fc7b4925100777af38324f2b5e3`, before the Mac became the host. Substantial later Mac-host/Linux-browser work exists as uncommitted source, source snapshots, test receipts and deployed app bundles. Returning to that push would lose useful fixes. Keeping all later changes would also keep the unwanted native-client implementation.

This audit preserved the current source overlay and identified recovery boundaries. It does not certify a release-ready version. No audio services were started, no installed application or personal data was changed, and the stopped investigation remains stopped.

## Product scope to preserve

- Direct playback to a permitted destination, with independent queues, Play on and queue-preserving Move.
- Relaxed synchronized audio/video with collaborative queue/transport, shared or split picture/sound, consent, volume and correction.
- Live synchronized audio with native host capture and server processing, timed delivery to browser receivers, and audience Join/Leave/local volume. Slow receivers must not delay everyone.
- Browser clients use browser APIs assisted by Couch Core. The desktop host owns native sound-card access. Native-client output is outside the requested completion scope.
- Preserve WebRTC/TURN, buffered captured-video fallback, mpv compatibility and hardware/Bluetooth routing. Zones/private mode/new low-latency video remain excluded.

The full contract remains in `docs/audio-video-refactor-plan.md`, `docs/audio-video-refactor-code-map.md`, `docs/audio-video-use-cases.md`, `docs/audio-video-refactor-validation.md`, and `docs/adr/0002-playback-delivery-and-authority.md` in the refactor and investigation worktrees. Audio experiments do not replace that scope.

## Actual pushed commits

In order, on `main..refactor/couch-playback`:

```text
bb3aab2 Record the playback refactor contract and baseline
5a18b8c Unify playback routing and scheduled audio
9587595 Record final playback verification and physical test preparation
0a57f91 Record physical playback startup failure and measurement limits
bc40d15 Bound capture encoder input to preserve live deadlines
e7dad73 Track output preparation before admitting live listeners
cf267a2 Preserve initial playback when selected outputs change
f773922 Record playback package validation and physical startup results
a7a5d1d Record Mac startup and rejoin diagnostics
27e580c Record sustained Mac playback diagnostic
```

`27e580c` was committed at 2026-10-25 00:55:58 UTC. The Mac in those final commit titles was a receiver. The Mac-host switch happened later that day.

## Where the later work went

- Clean pushed refactor: `/home/avoid/.t3/worktrees/couch/t3-9bc48314`, branch `refactor/couch-playback`, at `27e580c`.
- Actual edited checkout: `/home/avoid/.t3/worktrees/couch/t3-3c4248e6`, branch `test/audio-roundtrip-sync`, still at `27e580c`, with 112 modified/untracked source files preserved here.
- Later audio thread's assigned checkout: `/home/avoid/.t3/worktrees/couch/t3-69a4c8d1`, branch `perf/reliable-audio-latency`, clean at `27e580c`. The agent continued editing the older checkout instead. Automatic T3 checkpoints of its assigned checkout therefore missed those changes.
- Mac source checkout `/Users/devit/Code/couch` remained at `6286732d` from October 11. Later builds were deployed as frozen app bundles, rather than committed in that checkout.

The audit covered all Git refs/reflogs, 2,313 T3 checkpoint refs and 429 unreachable commits. No later commits containing the new native-capture, late-join or browser-clock files were found. Both audio branch reflogs remained at `27e580c`. Read-only SSH inspection of the Mac found matching deployed bundles, not another post-Mac source history.

Relevant T3 threads:

- `996704fe-f08f-4864-b4a7-93f888b4a2c8`: original playback implementation.
- `a4d3bd39-3b6a-4528-a5ab-3a6948396f27`: earlier roundtrip investigation.
- `efaee1b0-95bc-4aeb-b7d0-24338531581f`: later audio work, now stopped.

## Post-Mac chronology

All times below are UTC on October 25, 2026, reconstructed from messages, tool activity, source snapshots and deployment manifests.

| Time | Change and evidence | Recovery implication |
| --- | --- | --- |
| 14:20–15:13 | User proposes, then adopts Mac host → Linux client as the continuing primary setup. | The pushed commit is too early to represent this setup. |
| 15:50–16:27 | Browser Live drift correction changes from sample insertion/deletion to gentle playback-rate adjustment, capped at ±100 ppm. Focused SDK checks pass. Some electrical trials have 55/55 windows and zero waveform flags; repeats still show defects. | Keep the browser correction; do not label it universally qualified. |
| 16:50–17:06 | Normal Linux settings and actual Wi-Fi browser testing requested. `COUCH_LAN_PEERS` adds an exact routed IPv4 allowlist while retaining Host/Origin/pairing checks. | Keep routed-browser connectivity. |
| 17:35–17:39 | A real Chrome 156 output-timestamp trace exposes false rejection from adjacent 40 ms samples. Validation moves to a separate 200 ms anchor, preserving slope bounds and stale/backward checks. Recorded 34 tests/821 assertions, including negative controls. | Keep the browser clock fix. |
| 17:47–18:14 | Actual Mac and Android Wi-Fi browser listening. Mac joins at a 37 ms budget and is reported continuous. Android first crackles, then has a clean unchanged repeat; the 55 ms comparison has one crackle. | These are real browser sessions, but subjective listening without an analog Wi-Fi return. |
| 18:15–18:43 | Persisted Live lead choices, local browser latency preferences and capture-rate requests/readback. Recorded 70 unit tests, 14 Node integration checks and typecheck. | Retain useful settings with browser hints distinguished from hardware buffer controls. |
| 18:33–20:36 | Native host controls and PortAudio/CoreAudio capture: device UID, rate/buffer request/readback, bounded queue, ADC clock mapping, permissions and Main lifecycle. A 60 s capture matches its coherent reference sample-for-sample. | This is the requested native host work. |
| 20:14:20 | First explicit exploration of reusable native receiver implementations; by 20:37 the agent proposes a native Pulse sink. | This marks the native-client detour; host work overlaps in time. A timestamp-only rollback is unsafe. |
| 20:33 | Node upload lacks WebSocket Origin. Real-Hub red/green regression and revoked-source rejection accompany the fix. Native desktop R2 delivers 7,036 consecutive 256-frame blocks over 37.5 s without sequence/sample gaps. | Keep the host upload fix. End-to-end browser playback was still blocked by mixed PCM/Opus deployment compatibility and Linux output admission. |
| 21:19 | Native trial exposes a generic join bug: listener cursor starts at now instead of now + required lead + positive correction. | Keep this late generic fix even though the native-client trial exposed it. |
| 22:47–22:55 | Source Core gains concurrent Live PCM/Opus and low-lead budget changes to support the native client. | Review shared hunks individually for browser/host requirements. |
| 23:09–23:19 | Native-client TLS fix and output trials. The final actual desktop output run fails 0/55 windows because of underrun. | Earlier native harness passes do not establish a usable browser version or qualify the final desktop output. |

## Exact deployed checkpoints

Local candidate root:
`/home/avoid/.t3/worktrees/couch/t3-3c4248e6/.scratch/audio-roundtrip-sync/`

The following local `app.asar` identities were matched to Mac deployments over SSH. Full paths and SHA-256 values are in [manifest.json](manifest.json).

| Candidate | What it preserves | SHA-256 prefix |
| --- | --- | --- |
| `candidate-owned45-r6-pcm-rate100-r1` | Browser rate correction served through Couch | `366ca7c1dee36ec8` |
| `candidate-owned45-r6-pcm-rate100-routed-r1` | Routed-peer Core fix | `32c96a1b48db13bb` |
| `candidate-owned45-r6-pcm-clock200-r1` | Browser clock validation fix | `cf696a8095e079aa` |
| `candidate-owned45-r6-pcm-clock200-budget37-r1` | Mac `Couch Audio Lab R3.app`; actual Mac/Android browser listening checkpoint | `d1f89ea59663a45e` |
| `candidate-owned55-r6-pcm-clock200-r1` | Mac `Couch Audio Lab R4.app`; 55 ms browser comparison | `5ce1d68ecb8ec96c` |

These were experimental PCM/timing overlays, not clean release source commits.

Native-host checkpoints under the investigation checkout's `.scratch/`:

| Candidate | Difference | SHA-256 prefix |
| --- | --- | --- |
| `audio-native-desktop-r1` | First native desktop host bundle | `200eb6d0e4fee82b` |
| `audio-native-desktop-r2` | Main WebSocket Origin fix | `9d1bb37a27d8d34` |
| `audio-native-desktop-r3` | Worker late-join fix | `9a608ffac878485e` |
| `audio-native-desktop-r4` | 55 → 45 ms lead adjustment | `ee16cdca9457f3db` |
| `audio-supported-live-host-r1` | Rebuilt source Core/worker/frontend, also including native receiver-related scope | `9a118bd6978897a1` |

Their Mac counterparts are under `/Users/devit/Library/Application Support/Couch Audio Roundtrip Sync/`, in `native-desktop-r1` through `native-desktop-r4` and `supported-live-host-r1`. Matching hashes establish artifact identity; they do not establish release qualification.

## Source recovery material

Under `.scratch/audio-roundtrip-sync/` in the investigation checkout:

- `live-rate-correction-r1/before/` and `live-rate-correction-cap100-r1/`: browser correction source/patch snapshots and checks.
- `routed-peer-r1/before/`: routed-peer source and red/green HTTP integration evidence.
- `wifi-clock-replay-r1/`: Chrome trace fixture, old/new replay, source patch and verification.
- `wifi-listening-r1/` through `wifi-listening-r4/`: real browser trial manifests/results.
- `advanced-audio-settings-r1/`: 22 before-source files, `changes.diff`, and 32-file source-hash manifest recorded at 18:43:46 UTC.
- `relaxed-pcm-queue-fix-r1/`: exact before/after scheduled-audio source, focused patch and regression proving retained-queue overflow.

Other preserved sources under the investigation checkout's `.scratch/`:

- `audio-native-desktop-r1/source-pins.json`: 340 source pins; 331 match the preserved latest source. The nine differences cover later Origin/output integration work.
- `audio-native-desktop-output-r1/browser-patch.before`: entire browser SDK patch before native-client integration, SHA-256 `10f9c3c499587832ed5ac8bfeed6d70d361f287e62c2574108d41711f05cd890`.
- `audio-native-desktop-output-r1/node-patch.before`: server SDK patch before that integration, SHA-256 `eb4a8654e780e0767fed92bebaff5f6fb7a0a4ba72245c8961a6cc1aa3cb7734`.
- `audio-supported-live-host-r1/source-pins.json`: 460 pins; 459 match the preserved latest source. The only difference is the subsequent native-client TLS change in `app/audio-peer.ts`.
- `audio-supported-live-core-r1/`: late-join, relaxed-queue, continuity and admission receipts.

Other generic fixes to retain during hunk review include the output-clock milliseconds/microseconds correction, relaxed PCM retained-queue overflow, missing `pactl` guard, idle radio timer work, encoder/prewarm/packet-cadence/capture-handoff fixes and browser output-latency preferences. Their usefulness does not depend on adopting native-client output.

## Preserved source overlay

This directory contains:

- [source-overlay.tar.gz](source-overlay.tar.gz): all 112 modified/untracked source files from the actual edited checkout, relative to `27e580c`.
- [tracked-changes.patch](tracked-changes.patch): binary-capable tracked diff.
- [manifest.json](manifest.json): base commit, per-file hashes, archive hashes and audit coverage.

The overlay SHA-256 is `4f99ba91f277fa4800b0f24351da6b75fd1f8de9c62eda1e678d4dcf3f383af0`. Source hashes were checked before and after capture. The archive is recovery material; applying it wholesale would include unwanted native-client changes.

## Recommended completion basis

Use the pushed entire-refactor implementation plus a selective reconstruction from the preserved latest source. Use the browser R3/R4 artifacts, the pre-native browser/server patches and native-host R2/R3 as comparison points. Preserve later generic correctness fixes. Remove the new native-client receiver/output path and review shared protocol, scheduling, settings and packaging changes individually.

Then validate the integrated product across Direct, relaxed A/V and Live, including the continuing Mac-host/Linux-browser setup and actual Wi-Fi browsers, before presenting the reviewable PR stack as usable. There is no single audited post-Mac commit that can simply be checked out to obtain that result.
