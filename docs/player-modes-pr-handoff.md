# Player modes PR handoff

Ready to open the four dependent PRs below. All branches are pushed, their
ancestry is linear on main `4a194e35cedb30f5ba3e664b4c9734b087051825`, and each
layer independently passes frozen install, typecheck and build. Validation's
checked code/tests head is `bd25f9a`; its later receipt commit changes documentation
only. Remote tip SHAs and `gh stack view --json` are retained in the final parent
scratch receipts and reported with the handoff.

PRs have not been submitted. Merges and releases remain owner actions. The
[validation receipt](player-modes-integration-validation.md) records the final
533 covered Node checks, 688 unit tests, package/runtime evidence, zero actionable
findings on both independent review axes, and external qualification limits.

| Layer | Branch | Intended base | Checked code head |
| --- | --- | --- | --- |
| Core | `player-modes/integration-20261026` | `main` | `1b07af30968e973c9697634c9287de8276f4d954` |
| Browser | `player-modes/browser-20261026` | `player-modes/integration-20261026` | `2ccb2039917438b0e7536b01ba96c40cc6eed9d9` |
| Host | `player-modes/host-20261026` | `player-modes/browser-20261026` | `bc02df38b5ddf4d90c1364bced8937f646ada05d` |
| Validation | `player-modes/validation-20261026` | `player-modes/host-20261026` | `bd25f9ad4966271859b9ed67a0840ede3f83e925` |

The recovery archive and experimental ancestry are outside all four PR diffs.
All 213 recovered changed paths have explicit dispositions, covering P0–P7,
M1–M11, all 17 use cases and every retirement. Native host input and browser
receivers remain; the newly introduced native audience/output implementation is
excluded. Existing WebRTC/TURN, buffered captured A/V, mpv and hardware/Bluetooth
routing are retained. Live physical qualification is explicitly pending.

The following titles are plain release-note sentences. Each body is self-contained
and uses the PR skill's Summary/Evidence/Merge Danger format.

## Core

Title: **Unify playback delivery and programme authority in Core**

Head: `player-modes/integration-20261026`. Base: `main`.

### Summary

Core now decides delivery and programme authority for Direct, relaxed A/V and Live audio. Play on isolates a destination; Move preserves the queue while transferring its outputs. Shared URL and timestamped capture audio use one scheduled worker, while captured video retains WebRTC/TURN and buffered HLS.

```text
Hub policy and consent
  source preparation → receiver decode (Direct)
  scheduled worker → shared sound and picture clock (Relaxed)
  timestamped capture → fixed Opus deadlines (Live)
```

### Evidence

- **Before:** recovered late joins could receive deadlines without enough declared lead; a buffered ingest restart reset source PTS.
  **After:** late-join, continuity and real-media restart regressions pass; healthy receiver timestamps remain fixed.
- Per-operation FFmpeg leases release on completion/cancellation/failure and refresh for the next encoder; real worker lifecycle regressions pass.
- Validation receipts and retained adapter coverage: `docs/player-modes-integration-validation.md` on the top layer.

### Merge Danger

**Door:** two-way

**Blast Radius:** Playback

Touches routing, source preparation and scheduled delivery. Existing mpv, hardware routes, AirPlay and captured-video adapters remain. Browser and host layers complete the product integration.

## Browser

Title: **Integrate browser playback and Live audience controls**

Head: `player-modes/browser-20261026`. Base: `player-modes/integration-20261026`.

### Summary

Browser receivers use the Core-selected rendition and actor controls. Live listeners can join, leave and set their own level; ordinary Direct and relaxed controls retain their permitted queue and transport actions. Clock validation and bounded rate correction support Live output readiness.

```text
Core instruction
  media renderer → selected picture/sound rendition
  Sendspin browser player → output preparation and scheduled sound
  actor controls → menus, hotkeys, Remote and Media Session
```

### Evidence

- **Before:** Live audience surfaces exposed programme actions, and clock uncertainty used the wrong millisecond boundary.
  **After:** audience UI/authorization and clock regressions pass, with finite 0–10 ms uncertainty required for admission.
- Actual browser receivers decoded independent programmes; Move preserved playback identity, queue and paused media position. Radio subscriptions and desktop keyboard regressions passed.
- Details queue actions respect audience rights, including their initial focus.
- Final receipts: `docs/player-modes-integration-validation.md` on the top layer.

### Merge Danger

**Door:** two-way

**Blast Radius:** Receivers

Pinned SDK patches affect browser scheduling and preparation. Physical latency, Wi-Fi/background and Bluetooth qualification are separate from these software checks.

## Host

Title: **Add native host audio capture and input settings**

Head: `player-modes/host-20261026`. Base: `player-modes/browser-20261026`.

### Summary

The packaged Mac app captures a selected native stereo input through Main and uploads timestamped PCM to Core. Browsers receive Opus. Input rate/buffer controls show requests and readback; browser output buffering remains a preference. Each publication freezes its scheduling lead.

```text
Main permission and publication owner
  native CoreAudio helper (Mac) or hidden browser input
  authenticated local upload → scheduled worker → browser receivers
```

### Evidence

- **Before:** native capture depended on recovered lab wiring, and its builder rejected the second Mac architecture.
  **After:** maintained packaging builds static PortAudio and capture for arm64/x64, preserving Intel Ventura, QuickJS and the combined Mac update feed.
- Capture authority/upload/settings tests, both Mac helper architecture/deployment/signature checks, and the source-specific worker budget regression pass.
- Live Start requires an explicit input. Final hosted Linux, Windows and signed arm64/x64 Mac Package jobs pass. After the owner granted Microphone, the matched signed Mac package's UMC404HD native capture→Core→Opus→Chrome passes at 250 ms lead, including Leave/rejoin and Stop/Quit cleanup. Near-noise-floor input does not qualify physical latency or fidelity.
- Full packaging and runtime receipts, including exact unavailable qualification: `docs/player-modes-integration-validation.md` on the top layer.

### Merge Danger

**Door:** two-way

**Blast Radius:** Desktop

Native input is Mac-only; Linux/Windows retain browser capture. Explicit native rate requests can affect other apps using that device. The default scheduling lead is 100 ms with a 70 ms receiver budget; this is not measured input-to-ear latency.

## Validation

Title: **Validate and document the player modes integration**

Head: `player-modes/validation-20261026`. Base: `player-modes/host-20261026`.

### Summary

Completes the integration evidence and retirement inventory for all P0–P7 packages, M1–M11 responsibilities and 17 current use cases. Real-media regressions cover captured-video fallback, late viewers and ingest restart continuity. Documentation separates current behavior from preserved historical experiments.

```text
Recovered scope → 213-path disposition inventory
Integrated product → fresh checks and independent reviews
Reviewable stack → intended bases, titles and validation limits
```

### Evidence

- **Before:** the recovery contained native audience experiments, stale exclusions and unfinished software verification.
  **After:** the maintained stack retains native host capture/browser receivers, excludes native audience/Live PCM paths, and records a replacement or retained adapter for every retirement.
- Final validation: 92 separate unit files / 688 tests; 59 Node bundles cover 533 checks after the real AirPlay rerun; zero actionable final spec/standards findings; manual Check and all Package jobs pass.
- Follow-up after Microphone grant: actual signed Mac native stereo capture reaches Linux Chrome as Opus, with ready admission, audience restrictions and Leave/rejoin. The validation receipt records the default-profile relaunch exception and metadata audit.
- Exact final check/review/package receipts: `docs/player-modes-integration-validation.md`.
- Complete stack and proposed descriptions: `docs/player-modes-pr-handoff.md`.

### Merge Danger

**Door:** two-way

**Blast Radius:** Validation

Tests and documentation do not qualify 50 physical receivers or the 100 ms physical input-to-ear target. The validation receipt names the remaining platform and physical checks precisely.

## Submission boundary

The next owner-authorized submission can use `gh stack submit --auto --remote
origin`, then apply the titles and bodies above to each layer. That command creates
PRs and is intentionally left for the subsequent handoff. Register every created
PR with T3's `link_pull_request`; none exists for this assignment yet. Do not merge
or run Release as part of submission.
