# Player modes PR handoff

**Integration completion and PR submission remain pending.** The four proposed
bodies below describe the maintained changes and their revision-scoped evidence.
The [Live gate](player-modes-live-performance.md) remains open after the bounded
[Mac host comparison](player-modes-host-capture-comparison.md). All available
software/check/package/review work is complete: **707 unit tests**, **559 distinct
Node checks** including real AirPlay prerequisites, current hidden-Live native
lifecycle, and per-layer frozen install/typecheck/build pass. Fresh static spec
review has no actionable findings; the one P3 standards stale-ledger finding is
corrected. Exact checked source is `394f17f`; later reconciliation is docs only.

[Check 40328818886](https://github.com/avoid-quest/couch/actions/runs/40328818886)
and [Package 40328823313](https://github.com/avoid-quest/couch/actions/runs/40328823313)
pass on394f17f for Linux, Windows and signed dual-architecture Mac. Earlier
bd25f9a/a30218d receipts stay revision-scoped in
[validation](player-modes-integration-validation.md).

| Layer | Branch | Intended base | Validated source head |
| --- | --- | --- | --- |
| Core | `player-modes/integration-20261026` | `main` | `0ff37ef84fd4422cc4cd3d6d927af2a249b3d7fc` |
| Browser | `player-modes/browser-20261026` | `player-modes/integration-20261026` | `01f899627bd4a8385259fcb85bed6eb74ba55be2` |
| Host | `player-modes/host-20261026` | `player-modes/browser-20261026` | `c42383a4e7bebd7ba29ba60e1964baf1af2aeec4` |
| Validation | `player-modes/validation-20261026` | `player-modes/host-20261026` | `394f17ff0589f5cfc92f29439d55a15bc4617b09`, plus later docs-only results |

Base is `4a194e35cedb30f5ba3e664b4c9734b087051825`. Final tip/remote equality and
linear ancestry are verified after the last documentation commit and push; exact
receipts stay in parent scratch. Recovery branches/archive remain outside all
implementation diffs. All 213 paths have dispositions:103 retain/67 adapt/43 exclude,
covering P0–P7, M1–M11, all 17usecases and every retirement. Existing WebRTC/TURN,
buffered captured A/V, mpv and OS routing remain. Native audience/output is excluded.
All identified older runtime guarantees are integrated and their source/evidence
dispositions are explicit in the ledger.

**Readiness: hold PR submission.** The calibrated ordinary-browser comparison used
55 mslead/35msbudget and measured Chromium57.833/57.455 ms versus native56.647/57.268 ms,
with persistent waveform flags. The strict45/25 ms preflight refused the29 ms
receiver requirement. No roughly 50 ms/fidelity qualification or useful repeatable
native advantage was established. Chromium stays the reference host path; the
explicit native option is preserved without automatic preference. No further
physical campaign was started beyond the agreed two pairs. The exact remaining
performance check and broader platform limits are in the host result/validation.
Merges and releases remain owner actions.

## Core

Title: **Unify playback delivery and programme authority in Core**

Head: `player-modes/integration-20261026`. Base: `main`.

### Change

#### Summary

Core chooses delivery and programme authority for Direct, relaxed A/V and Live.
Play on isolates a destination; Move transfers outputs while preserving the queue.
Live capture emits immediate stereo S16 PCM in packets of at most 240 frames,
independently of 10 ms Opus packetization and FFmpeg lookup. Healthy receivers
keep their fixed deadlines when another receiver is slow.

```text
Hub policy and consent
  source preparation → receiver decode (Direct)
  scheduled worker → shared sound and picture clock (Relaxed)
  timestamped capture → independent bounded PCM/Opus fanout (Live)
```

#### Evidence

- **Before:** late joins could receive insufficient lead, ingest restart reset
  source PTS, and the integrated Live path had lost browser-compatible PCM.
  **After:** checkpoint late-join/continuity/real-media regressions pass; focused
  restoration checks exercise immediate PCM, independent fanout and strict
  admission at PCM's 65,536-byte and Opus's 4,096-byte capacity floors.
- Per-operation FFmpeg leases release on completion, cancellation and failure.
  Authenticated signaling/pair retry have separate bounds; per-flush level reads
  preserve permission checks. All identified carryovers and their focused red/green checks are integrated; final whole-stack coverage is559 Node checks/707 units.
- `docs/player-modes-integration-validation.md` on the top layer records the
  tested revisions, focused reruns, resolved reviews and remaining physical gates.

#### Merge Danger

**Door:** two-way

**Blast Radius:** Playback

Routing, source preparation and scheduled delivery affect every mode. Browser
and Host layers complete the consumers; existing output and video adapters remain.

### Checks

- Checkpoint and focused receipts are revision-scoped in the top-layer validation
  document; whole-stack checks and independent reviews pass at the revisions above.
- The restored transport alone does not qualify roughly 50 ms physical playback.

### Release

PR submission, merge and release publication remain pending. No release is authorized.

## Browser

Title: **Integrate browser playback and Live audience controls**

Head: `player-modes/browser-20261026`. Base: `player-modes/integration-20261026`.

### Change

#### Summary

Browser receivers use the Core-selected rendition and actor controls. Live
listeners Join, Leave and set their own level; permitted Direct and relaxed
queue/transport actions remain. The maintained browser stays Opus-first and
prepares Opus. Clock validation and bounded rate correction govern readiness.

```text
Core instruction
  media renderer → selected picture/sound rendition
  Sendspin browser player → Opus preparation and scheduled sound
  actor controls → menus, hotkeys, Remote and Media Session
  browser publisher → four unsettled offers, 100 ms spacing
```

#### Evidence

- **Before:** audience surfaces exposed programme actions, clock uncertainty used
  the wrong millisecond boundary, and publisher setup could accumulate offers.
  **After:** checkpoint audience/clock regressions pass with finite 0–10 ms clock
  uncertainty; bounded offers retain slots through cancellation until promises
  settle. The final integrated review remains pending.
- Actual checkpoint browsers decoded independent programmes; Move preserved
  Playback identity, queue and paused position. Details queue actions respect
  audience rights, including initial focus.
- Diagnostic SDK PCM/45 ms has 55/55 accepted windows at 47.070 ms median but 32
  waveform flags. Opus/45 ms r3 accepts 45/55 L and 44/55 R, with accepted-window
  medians 46.424/46.439 ms and many correlation/gain flags. Both are unqualified;
  neither changes the maintained codec policy.

#### Merge Danger

**Door:** two-way

**Blast Radius:** Receivers

Pinned SDK patches affect scheduling/preparation. Diagnostic Electron results
are separate from ordinary Chrome, Wi-Fi/background and Bluetooth qualification.

### Checks

- Browser checkpoint and offer-bound evidence are revision-scoped in
  `docs/player-modes-integration-validation.md`; current checks/reviews pass at394f17f.
- Ordinary Chrome maintained-client setup and exactly two Mac host pairs are
  complete; their physical/fidelity limitations remain explicit.

### Release

PR submission, merge and release publication remain pending. No release is authorized.

## Host

Title: **Add native host audio capture and input settings**

Head: `player-modes/host-20261026`. Base: `player-modes/browser-20261026`.

### Change

#### Summary

The packaged Mac app offers native stereo input through Main and the existing
Chromium capture selection, uploading timestamped PCM to Core. Browser receivers
remain Opus-first. Input rate/buffer controls show requests and readback. Each
publication freezes its lead/reserve; native adoption requires the matched host
comparison below.

```text
Main permission and publication owner
  native CoreAudio helper (Mac) or hidden Chromium input
  authenticated local upload → scheduled PCM/Opus worker → browser receiver
```

#### Evidence

- **Before:** native capture depended on recovered lab wiring and its builder
  rejected the second Mac architecture.
  **After:** maintained packaging builds static PortAudio/capture for arm64/x64,
  preserving Intel Ventura floors, QuickJS and the combined Mac update feed.
- Signed `a30218d` Check and Linux/Windows/dual-architecture Mac Package pass.
  Earlier `bd25f9a` signed Mac capture reached Linux Chrome as stereo Opus at
  250 ms lead with Leave/rejoin and cleanup; this proves delivery on that source,
  not physical qualification or useful native benefit.
- Restored leads are 45/50/55/75/95/100/150/250 ms, default 100/70 ms. Source
  reserves are 20 ms through 55, 25 ms below 100, 30 ms otherwise; admission stays
  strict. Request/readback is separate from measured input-to-ear delay.
- The owner accepted analog calibration `gain-meter-r1`. Required native versus
  Chromium Mac-host runs through an unchanged ordinary Chromium maintained client,
  actual Core ingress diagnostics and a separate physical witness completed one matched pair and one confirmation pair. No useful repeatable native advantage was established; the50 ms/fidelity gate remains open.

#### Merge Danger

**Door:** two-way

**Blast Radius:** Desktop

Native input is Mac-only; Linux/Windows retain browser capture. Native rate
requests can affect other apps using the device. Preserve both host paths while
the measured result provides no basis for an automatic native preference.

### Checks

- Exact package hashes/signatures and earlier runtime receipts are in
  `docs/player-modes-integration-validation.md` on the top layer.
- Gain preflight, a fixed Linux route and at most two matched pairs are required;
  the two pairs are complete; the recorded verdict does not prefer native, and affected software checks pass.

### Release

PR submission, merge and release publication remain pending. No release is authorized.

## Validation

Title: **Validate and document the player modes integration**

Head: `player-modes/validation-20261026`. Base: `player-modes/host-20261026`.

### Change

#### Summary

Records scope, retirements, real-media regressions and revision-scoped integration
evidence. Shared browser-compatible Live PCM remains in scope; native audience
helpers remain excluded. Historical passes, corrected diagnostic runs and current
pending gates have separate receipts.

```text
Recovered scope → 213 paths: 103 retain / 67 adapt / 43 exclude
bd25f9a → 688 unit tests / 533 covered Node checks / independent reviews
a30218d → successful Check / Linux, Windows and dual-architecture Mac Package
394f17f → 707 units / 559 Node checks / signed all-platform Package / resolved reviews
Host A/B → complete; no native preference; 50 ms/fidelity gate open
```

#### Evidence

- **Before:** handoff text excluded Live PCM and presented old checks/reviews as
  final after source changes.
  **After:** scope retains immediate PCM/low leads and the documents name the
  exact revisions and remaining parent-owned completion gates.
- Historical r15 passes around 48.543 ms; bad r16 remains. Maintained `bd25f9a`
  Opus/100 ms measures 102.4696 ms median and fails the corrected 50 ms gate.
  Short-URL SDK PCM/Opus diagnostics remain unqualified with waveform/coverage
  defects and low-level gain caveats; URL-only harness repair made no product change.
- Real-media checkpoint regressions cover captured-video fallback, late viewers
  and ingest restart continuity. Current inventory covers all P0–P7, M1–M11 and
  17 use cases; older runtime/carryover accounting and final available checks are complete.

#### Merge Danger

**Door:** two-way

**Blast Radius:** Validation

Recorded software/packaging results do not qualify the roughly 50 ms physical
capability, native adoption or 50 physical receivers. The reopened gates keep
completion and PR submission pending.

### Checks

- `docs/player-modes-integration-validation.md` contains revision-scoped commands,
  failures, reruns, package pins and the historical isolation exception.
- Final integrated checks/spec and standards reviews, host A/B, final remote-head
  verification and cleanup remain parent-owned.

### Release

PR submission, merge and release publication remain pending. No release is authorized.

## Submission boundary

After the parent reconciles the final source/evidence and records a readiness
verdict, a subsequent authorized submission can use
`gh stack submit --auto --remote origin` and apply these titles/bodies to the
intended bases. Refresh
bodies and check results first. Register every created PR with T3's
`link_pull_request`; no PR has been submitted for this integration. Submission
does not authorize merge or Release.
