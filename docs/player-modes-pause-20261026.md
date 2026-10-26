# Player modes pause checkpoint

The owner paused execution because of issues on the working computer. The later
request authorizes preservation and pushing, not resuming tests or acquisition.
PR submission, merges and releases remain pending.

## Preserved implementation

Base: `4a194e35cedb30f5ba3e664b4c9734b087051825`.

| Layer | Branch | Implementation head at pause |
| --- | --- | --- |
| Core | `player-modes/integration-20261026` | `7aee1baaa59da349f34e6b2ff5ddb3dd2d6f1d52` |
| Browser | `player-modes/browser-20261026` | `f8dc71c75436c697eecac52e5a358859fb6b13f6` |
| Host | `player-modes/host-20261026` | `3a46696960937f27e64c85b7c70c45365a66b01f` |
| Validation | `player-modes/validation-20261026` | `3279271b007871bc134e50f77671f5435832388f`, followed by this preservation note |

The stack retains Direct/relaxed A/V/Live integration, authority and lifecycle
repairs, immediate bounded browser-compatible PCM alongside Opus, strict
admission, restored low-lead choices and all retirement accounting. Defaults
remain 100 ms lead / 70 ms receiver budget; the browser remains Opus-first.

Latest carryovers are integrated: four unsettled publisher offer operations with
100 ms pacing; separate bounded signaling and pairing retry budgets;
per-flush level caching; unchanged-volume suppression and coalesced publisher
peer lists. Original child commits are `421ad77`, `daeea11` and `1420ebe`.
The older drafts and recovery archive remain untouched.

## Validation at the stop

- Pinned Bun 1.4.2 frozen install, three-project typecheck and full build pass on
  code head `d87a3da`; four focused unit suites pass (69 tests).
- Nine of ten affected Node bundles pass. `live-outputs.integration.ts` has one
  failure out of 56: “Play on the publisher waits in Where it plays, opens it on
  each request, and both receiver entry points join one playback.” The observed
  publisher peer list contains one receiver when two are expected. Investigate
  whether its wait accepts a stale list after asynchronous coalescing; this is
  a hypothesis, not a resolved fixture issue. The follow-up child failed with
  HTTP 429 before a fix. Preserve the failing receipt.
- Earlier 688-unit/533-Node checks, signed packages, runtime receipts and reviews
  retain their original revision limits. New source still needs final integrated
  checks and fresh fixed-head spec/standards reviews. See the validation receipt.

## Physical state and unfinished comparison

The owner accepted `gain-meter-r1` analog calibration. Source peaks were about
−11.84/−11.83 dBFS, return peaks −23.06/−23.13 dBFS; the last 100 intervals had
no clipping or dropped meter callback records. This used direct analog feeds,
bypassing Couch. Keep the analog gains fixed and check actual Couch levels
before scoring. Tones, metering server and playback processes were stopped.

The mandatory Mac Chromium-versus-native HOST comparison has **not run**.
Chrome for Testing 156.0.8078.47 was downloaded into owned scratch and its version
queried; the ordinary receiver was not launched. Existing signed Couch resources
were copied/read for provenance, not modified. A bounded Core-ingress overlay
was prepared and passed ten offline fake-socket checks in child scratch; its
agent was interrupted before final handoff. It was not deployed or runtime
validated. Do not mistake these preparations for actual Core-ingress measurements.

The bound remains one valid matched pair and one confirmation pair through one
unchanged ordinary browser, with fixed Linux settings. Capture timestamp age and
uncertainty must be reported separately from analog roundtrip/fidelity. Native
adoption and the roughly 50 ms usability/reliability gate remain open. The earlier
Electron codec runs and all pass/fail recordings remain preserved with their
gain-staging and observer limits; they do not decide host-backend adoption.

## Recovery locations

Assigned checkout:
`/home/avoid/.t3/worktrees/couch/player-modes-integration-20261026`.
Parent evidence: `.scratch/player-modes/` and `.scratch/live-performance/`.
Current check receipts: `final-g5-unit/`, `final-g5-node/` under the former;
`final-g5-build/` under the latter. Gain receipts are in `gain-meter-r1/`.

Child ingress recipe/overlay:
`/home/avoid/.t3/worktrees/couch/t3-dbefef12/.scratch/host-ab/`.
Older-runtime dispositions and receipts:
`/home/avoid/.t3/worktrees/couch/t3-e08860b6/.scratch/older-runtime-carryovers/`.
Offer-bound receipt: `/tmp/couch-bounded-offers-20261026/README.md`.

The preservation operation also creates a separate
`recovery/player-modes-pause-20261026` snapshot for selected diagnostic source,
measurement records and check receipts. Its manifest identifies included hashes
and omissions; it stays outside the implementation stack. Local profiles,
credentials, installed applications and original investigation worktrees are
excluded. All original local evidence remains in place.

Resume only after the owner's explicit instruction. Check current worktree,
remote ancestry and process ownership first; then resolve the retained Node
failure, establish the bounded physical comparison, finish validation/review and
refresh the PR-ready handoff. Do not dispatch a release or submit PRs on resume
without the separate authorized handoff.
