# Finish the entire player modes integration

## Outcome and authority

Complete the recovered playback refactor, integrate it with current `origin/main`, retire superseded paths and leave a validated, pushed set of reviewable `gh stack` branches with proposed PR titles/bodies. This assignment covers the work required before opening PRs. Leave PR submission, merging and release publication for the subsequent handoff.

The owner is AFK. Resolve routine implementation, conflict, test and stack decisions autonomously. Use existing credentials and grants; record unavailable external prerequisites and continue all independent work. An audit or plan is an intermediate checkpoint: completion requires integrated code, cleanup, validation and the pushed stack. Preserve existing capabilities when a product decision would otherwise require the owner's input.

## Read the contract before assigning implementation

Recovery ref: `recovery/player-modes-20261026`. Its preserved source commit is `8147fc98fbeda5b415c3351a10a98c7cab816d4a`; its evidence commit is `f2af19fa24c8c60ed5909639dc6945c42773e87e`. The original refactor ends at `27e580cc3d0b3fc7b4925100777af38324f2b5e3`. Main at handoff is `4a194e35cedb30f5ba3e664b4c9734b087051825`; fetch and record the actual integration base.

When a referenced file is absent from your new checkout, read it with `git show recovery/player-modes-20261026:<path>` without switching worktrees. The old plan's notes about untracked planning files and its original baseline are historical; the recovery ref now preserves those documents and the implementation.

Read these documents completely before allocating implementation work:

- `docs/audio-video-refactor-plan.md`: all P0–P7, acceptance rows and simplification obligations.
- `docs/audio-video-refactor-code-map.md`: all M1–M11 and the retirement ledger.
- `docs/audio-video-use-cases.md`: D1–D6, R1–R7 and L1–L4, including Play on versus Move.
- `docs/adr/0002-playback-delivery-and-authority.md`: delivery and authority semantics.
- `docs/playback-recovery/2026-10-26/README.md` and `history-audit.md`: recovery boundaries and where useful later fixes live.

Consult `docs/audio-video-refactor-validation.md` when selecting regressions and interpreting historical coverage. Consult the recovery `evidence-index.json`, `source-checkpoints.json` and checkpoint manifests when reconstructing a particular fix; extract the relevant evidence members rather than loading the archive indiscriminately. Consult the plan's official-source/evidence references when an API or architecture choice needs verification.

## Product boundaries

- **Direct:** any permitted single destination; independent Playbacks/queues; preserve Play on, ordinary Play's selected output mix and queue-preserving Move. Receivers decode ordinary media; Core resolves and relays as needed.
- **Relaxed A/V:** collaborative queue/transport, consented shared or split picture/sound, local/shared volume and meaningful correction. Preserve ordinary media, screen/window sharing, audio inputs, AirPlay and independent concurrent programmes.
- **Live audio:** the desktop host owns native sound-card capture, device/rate/buffer controls, clocks and server processing. Browser receivers use browser APIs assisted by Couch Core. Audience controls are Join/Leave/own listening level; Core enforces programme authority. One slow receiver cannot move healthy listeners' deadlines.

Reuse the existing UI and capabilities. Preserve WebRTC/TURN, buffered captured-video fallback, mpv and existing native/Bluetooth output routing. Keep zones, private mode, remote game input and a new low-latency video engine outside this integration. Remove the newly introduced native audience receiver/output implementation while retaining native host capture and generic correctness fixes it exposed.

Usability and reliable synchronization govern defaults. The 100 ms input-to-ear goal and 50-receiver target require evidence; they are not permission to restart an open-ended latency experiment. Browser latency hints describe browser preferences; native device controls report actual requests/readback. A host capture improvement alone does not establish browser playback qualification.

## Execution and gates

### 1. Account for the whole recovered change

In your assigned worktree, record the base, branch drift and existing failing checks. Build one concise integration ledger mapping every P package, M responsibility and use case to its implementation, acceptance check and remaining work. Account for every recovered changed file/subsystem as retain, adapt or exclude, with the replacement/reason for excluded responsibilities.

Use the original refactor plus all later source as recovery input. In particular, preserve browser rate correction, routed-peer access, Chrome output-clock validation, useful audio settings, native host capture/upload, output-clock unit fixes, late-join lead, relaxed PCM queue bounds and lifecycle/capture continuity fixes. The audit contains the exact provenance. Timestamp cutoffs alone cannot separate host and client work because their development overlapped.

**Gate:** all P0–P7, M1–M11 and 17 current use cases have an explicit owner, implementation disposition and check; useful later fixes and intentionally excluded native-client paths are individually accounted for. Proceed to implementation with this ledger as the completion tracker.

### 2. Create the stack and integrate into its owning layers

Read the `gh-stack` skill and stack-design reference. Plan dependency-ordered concerns and initialize the stack from current main before product edits. Import recovered source directly into the layer that owns each concern, preserving current-main fixes and resolving conflicts there. Use the recovery branch as read-only source/evidence: keep its large archival commit and experimental ancestry outside the eventual implementation PR stack.

Consolidate delivery decisions, authority, source preparation, common scheduled audio, native host lifecycle and browser output integration according to the contract. Complete missing UX/command consumers and migrations; retire replaced engines, adapters, dependencies, experimental hooks and dead tests when their replacements pass. Keep clean-install SDK patches pinned and justified. Build the frontend, Core/worker and desktop helper from the same maintained source so mixed PCM/Opus lab artifacts cannot mask incompatibility.

Use native host capture through the packaged app without user-installed lab helpers or manual launch steps. Retain browser publishers' supported browser capture path. Verify supported host-platform behavior and make actual platform limitations explicit. Inspect the official APIs and t3code's native-resource/desktop packaging precedent before changing the shell or packaging design.

**Gate:** every ledger gap has an integrated implementation or a concrete external prerequisite; no in-scope behavior is silently dropped, and every retirement has a working replacement or retained compatibility adapter. Each branch represents one reviewable concern and builds on its intended parent.

### 3. Validate the integrated product and review it

Run fresh frozen-install, typecheck, build and relevant behavior/integration checks using the repository's scripts and `docs/ci.md`; derive commands from the current environment. Test the changed public behavior and meaningful regressions. Include Direct isolation/handoff, relaxed shared and split A/V, real captured-video fallback, Live speaker-only joins/leave/rejoin, audience authorization, consent/revocation, route changes, source replacement and shutdown. Verify bounded fanout and the available scale fixture without claiming 50 physical receivers from simulated load.

Exercise actual packaged Main/Core and actual browser receivers where automation permits, including the continuing Mac-host → Linux-browser setup and available Wi-Fi browsers. Read the recovery manifests to distinguish browser R4 from native-host R4; the owner's last-seen R4 recollection is uncertain. Historical harness/native-client passes are reference evidence, not fresh browser validation. Prefer conservative working defaults over another search for minimum latency.

For workflow or packaging changes, prove the changed path with `act` using `catthehacker/ubuntu:full-latest` before any manual CI dispatch. Dispatch relevant checks explicitly as `docs/ci.md` requires, with the intended pushed branch/ref; preserve commands, commit IDs, results, skips and any unavailable platform prerequisites. Update architecture, design and validation docs to describe the integrated result.

Obtain fresh independent spec and standards reviews against a fixed base/head, using the same requested model below. Resolve actionable findings and rerun the checks justified by those fixes.

**Gate:** available required checks pass on the final source; independent findings are resolved; each use case/retirement row links implementation and evidence. Unavailable physical/platform qualification remains specifically named, with its impact on readiness and the smallest remaining check. An environment prerequisite must not hide unfinished software work.

### 4. Leave a concrete PR-ready handoff

Commit and push every stack layer; verify remote heads, ancestry and `gh stack view --json`. Prepare plain-sentence titles and self-contained PR bodies with the `pr` skill, intended bases, validation and material limitations. Keep the recovery archive outside implementation diffs. Register any existing PR you actually work on through T3's PR-linking tool.

Finish with the branch/commit chain, whole-scope coverage, review results, check receipts and an explicit verdict: ready to open PRs, or the precise remaining blockers. Push useful progress even when a physical check is unavailable. Leave a clean worktree and stop all test processes you own. Use no Co-Authored-By trailers or AI attribution.

## Subagents: exact model and bounded ownership

Use T3-owned subagents via `delegate_task`, since model options are required. Discover the live catalog and request `providerInstanceId: "codex"`, `model: "gpt-6.1-sol"`, `options: {"reasoningEffort":"xhigh"}`; preserve the inherited service tier. Verify the returned provider/model/options for every child. The lead must also remain GPT-6.1 Sol xhigh.

Start with independent whole-scope/retirement and native-host/browser integration assessments while you map the code. Use implementation subagents for disjoint owned concerns after shared interfaces and the layer plan are concrete. Keep at most three children active; serialize shared Hub/protocol/renderer edits and shared stack mutations. For separate child checkouts use T3's `isolation:"worktree"`; commit inputs first because uncommitted files are not copied. Review rounds should be fresh delegated tasks with the fixed comparison and prior findings/responses supplied. Include the contract, owned files, requested output and completion criterion in every child brief; children do not inherit this conversation.

## AFK operation and workspace ownership

Edit only the new T3-assigned checkout and explicitly delegated child worktrees. Original investigation checkouts, recovery refs and frozen evidence remain intact. Follow `AGENTS.md`; scratch Couch instances get unique `COUCH_DATA_DIR` and `COUCH_PORT` and are stopped by owned PID. Preserve the owner's installed Couch, personal data/profiles and unrelated processes.

Use existing authorized SSH access and consent grants for the Mac; keep credentials out of logs and Git. Restore device settings changed by owned tests. A locked desktop, unavailable device, missing permission or disconnected phone gets one preflight and one actionable retry, then a recorded prerequisite while other work continues. Complete automated fixtures, packaging, review and stack preparation without waiting for the owner to click, listen, reconnect hardware, enter a secret or approve routine work. Keep capability claims limited to what was actually verified.
