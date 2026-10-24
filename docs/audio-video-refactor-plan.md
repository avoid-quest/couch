# Full playback refactor: implementation handoff

24 October 2026. Planning only; no implementation has begun. Baseline inspected:
`59ac6cd6a510ca96bf60dfc9a3628cc635be22e1`. This is the execution plan for the
**whole playback architecture**, not just the concert-audio milestone.

Ready to begin a staged refactor once the owner assigns it. Not ready to claim
100 ms, 50 physical receivers or blanket browser support. Those are qualification
outcomes. The complete assignment includes Direct, relaxed A/V, live audio,
control/permission rules, source adapters, cleanup and retirement of superseded
code. Finishing the live sender alone does not complete it.

## Read first and carry the evidence forward

Read this plan, [the user stories](audio-video-use-cases.md) and
[the code/change map](audio-video-refactor-code-map.md) before allocating work.
The [architecture proposal](audio-video-architecture-proposal.md) supplies the
verified current paths. This plan's full-refactor scope supersedes that document's
short audio-first migration outline. The owner's later instructions take precedence.

Load [experiment evidence](audio-video-experiment-evidence.md) when working on
clocks, SDK corrections, scale or old branches. Load
[official-source alternatives](audio-video-alternatives-evidence.md) when choosing
browser interfaces or transport changes. Both independent reviews are linked
from the proposal. The [Moonlight/Sunshine note](audio-video-moonlight-sunshine.md)
is relevant only if reopening future live-video work.

**Workspace transfer:** these research files are currently untracked in
`/home/avoid/.t3/worktrees/couch/t3-73a0194a/docs`. A fresh worktree will not inherit
them. Read them at that absolute location and copy the `audio-video-*.md` files
and `audio-video-costs.html` into the assigned checkout before delegating. Confirm
the files exist there; do not copy experimental source changes into the product.
Use the owner's chosen checkout/base, record its SHA and inspect changes since
the audited baseline. Recheck affected facts, rather than repeating the entire audit.

## Product contract: already settled

| Behavior | Required outcome |
| --- | --- |
| Direct | Any authorized user can play on any permitted single destination: their browser, another connected device or the Couch TV. Independent Playbacks have independent queues. Preserve explicit Play on, ordinary Play's selected mix and queue-preserving handoff. The controller need not render. Ordinary media decodes at the receiver with Core handling queues, resolution and necessary byte relays. |
| Relaxed synchronized | Collaborative programme/queue controls, consented picture/sound selection across devices, shared and individual levels, useful timing adjustments. Includes URL media, live broadcasts, screen/window sharing, audio inputs and AirPlay. More buffering is acceptable. Sound and picture share a timeline. |
| Low-latency synchronized | Live audio first, targeting 50 phone/desktop browser receivers. Initial concert goal: 100 ms input-to-ear; tighter synchronization takes priority over the lowest delay. Stereo Opus is accepted. Initially qualify capture on the Couch computer/desktop app. Admit qualified browser/output combinations and refuse unsupported routes; one bad receiver must not delay everyone. Audience members join/leave and adjust their own listening, with sync status/correction only where useful. No audience programme queue, seek, Next or shared pause. |

Three behaviors do not require three separate engines or a global mode selector.
An audio-only receiver should receive only audio when a suitable rendition exists.
Publisher ownership, self-play consent, private outputs and control of other devices
remain distinct. The publisher does not monitor its own captured output through
Couch. Each receiving device still serves one Playback at a time.

Zones, private mode/browser independence from Core, remote game input and a new
low-latency video renderer are outside this build. Retain the future live-video
story (5–10 screens, desirable 1080p/60) without making it a prerequisite. Existing
relaxed screen sharing is fully inside the refactor. Do not rebuild libraries or
removed source integrations.

## Target design and simplification obligations

Use native media rendering for ordinary Direct playback and a common scheduled
audio module for synchronized playback. Keep the existing relaxed picture
follower, repairing its integration and reporting where required. Input adapters,
byte proxies, codec backends and hardware outputs remain distinct responsibilities.

The implementation needs four clear seams, not a plugin framework:

1. **Playback decisions and authority:** source intent, allowed output assignment,
   programme-control rights and participant rights produce one delivery plan.
   Core authorizes it and rechecks after asynchronous work. Clients render that
   decision; they do not independently infer transport from source names or counts.
2. **Source preparation:** resolve usable tracks/renditions, access requirements,
   capabilities and timeline information. Encoded URL media and timestamped
   capture are the concrete adapters. A live URL is not automatically a qualified
   low-latency capture. Resolving or relaying bytes is not transcoding.
3. **Playback engines:** native client media and scheduled audio own their resources,
   generations, errors and disposal. Shared audio owns clock exchange, bounded
   fanout, receiver preparation and format handling. Keep separate sender policies
   for read-ahead media and fixed-deadline capture. Small buffers alone cannot turn
   today's sender into a live sender.
4. **Receiver/output integration:** picture follows the applicable timeline;
   output volume, latency correction, optional processing and hardware route are
   applied once by their responsible adapter. Expose the actions that actually
   work, and distinguish local A/V alignment from alignment between receivers.

These are responsibilities to consolidate, not instructions to create four
directories or wrap every function. Extract from Hub/renderer only where it makes
these invariants local. The same interface should support the behavior tests.

Required simplification outcomes:

- Ordinary Direct adds no mandatory server codec or group audio processing.
  Sound-only playback selects an available audio rendition instead of loading a
  hidden video plus separate audio. Preserve a muxed fallback when no such
  rendition exists; do not invent a transcoder solely to strip video.
- Shared ordinary audio decodes the source once and encodes each needed format
  once per Playback; receivers decode their own copy. Independent programmes
  remain independent work, rather than a speculative global encoder cache.
- Qualified raw audio capture becomes capture → clock normalization → shared
  Opus encode → fanout → receiver decode/clock correction → hardware. Source and
  receiver correction address different oscillators. Adopt supported SDK fixes,
  not experiment string replacements/private-field mutation.
- Relaxed audio-only capture and decoded AirPlay audio reuse scheduled delivery,
  bypassing their redundant recording/AAC/HLS/audio conversions when replaced.
  AirPlay remains relaxed; its existing ingress delay is not a concert path.
- Retained captured A/V uses one shared buffered ingest per publication where
  applicable, with synchronized sound and picture. Its video-dependent HLS stays
  until an agreed replacement covers those receivers. Avoid two parallel permanent
  implementations of the same responsibility during migration.
- Current WebRTC/TURN and delayed screen-sharing fallback continue serving existing
  users through this refactor. Their long-term retention is conditional on the
  meaningful fast experience/compatibility they provide. The owner has not
  authorized silently losing those capabilities. Replacing all generated HLS or
  removing WebRTC is a separate gate, not an assumed first step.

## Execution sequence

Each package ends with a reviewable change and its behavior evidence. Dependencies
below are intentional; use parallel agents for independent implementations, not
competing edits to Hub, protocol types or the renderer.

### P0 — Lock the contract and establish the baseline

Record the actual base SHA, relevant branch drift and existing failing checks.
Turn the story-to-test table below into the completion checklist. Make a short
decision record for capability representation, delivery planning, timeline units,
generation ownership and audience authorization. State which existing booleans
and decisions each replaces; preserve old wire semantics only where needed during
the migration. Plan optional persisted-field defaults before changing Store.

Sketch the changed journeys using existing UI: Play on/Move here, Where it plays,
Share/source discovery, relaxed controls and a concert listener's minimal controls.
Keep current Share discovery for now; a concert publication must be identifiable
without presenting every user a protocol matrix. Capture publication intent cannot
be inferred solely from whether a microphone or screen is attached.

**Done:** all current-scope stories have an owner, acceptance check and planned
code disposition; shared interfaces are concrete enough for parallel work.
Routine implementation choices belong to the lead. Escalate only a change to the
product contract or loss of an existing capability, with the concrete tradeoff.

### P1 — Consolidate Playback routing, authority and lifecycle

Move duplicated delivery/permission decisions behind one tested interface used
by all entry points: item actions, REST play routes, WebSocket controls, joins,
output toggles, handoff, reconnect and fallback. Separate viewing/controlling a
Playback from receiving it, and source ownership from programme-control rights.
Preserve relaxed collaboration; enforce live audience restrictions server-side,
including legacy actions and remote/hotkey/OS-control entry points.

Route by intent and selected channels, not audio-receiver count alone: one screen
and a separate speaker need a group clock; a qualified live feed keeps fixed
deadlines even when only one receiver remains. Ordinary media can return to the
efficient Direct path when all selected output is on one capable device.

Make transitions atomic with cancellation/generation checks: Direct ↔ group,
join/leave, source replacement, consent revocation, output reassignment and native
fallback. Keep position, queue, pause state, speed, tracks and supported delays
where the source allows them. Fix the explicit-disabled-channel live-join defect.
Maintain newest-tab ownership, held publisher behavior, Stop/Undo and restart
semantics. Live disconnect isolates that receiver; it must not inherit ordinary
playback's pause-on-offline rule and pause the audience.

**Done:** two independent Playbacks and a shared Playback coexist; permitted moves
work from another controller; denied/stale moves leave state intact; receiving a
concert grants no programme-control authority. Source/player/timing resources
have one owner and predictable cleanup.

### P2 — Refactor Direct source selection and client rendering

Use the source-preparation contract to request the tracks actually selected and
formats the destination can play. Keep provider resolution, expiry/retry handling,
signed byte relays, Range and playlist security. All current yt-dlp media uses
Core's protected relay: replacing that access policy is not required for efficient
local decoding. Avoid duplicate extraction/fetches within one load without creating
a global mutable cache of private URLs.

Consolidate renderer loading/disposal for native media, HLS, MPEG-TS and separate
audio. Apply output intent to fetch/decode decisions, not just CSS/muting. Keep
quality changes, progress/history, subtitles, language/track selection, seek/speed,
autoplay recovery, Media Session and optional compression. Ensure fallback and
capability reporting agree; unsupported mpv/group delay controls must not appear
to succeed. Preserve host-only mpv and native output selection.

**Done:** Direct rendering cases in D1–D6 pass (routing/UI gaps complete in P5);
ordinary Direct uses no server transcode or Sendspin; a known
separate-audio fixture produces no video fetch for sound-only playback; returning
picture reselects the right tracks without losing the Playback/queue. Muxed-only
and unsupported-codec outcomes are explicit and remain usable where supported.

### P3 — Refactor relaxed synchronized audio/video

Separate URL decoding/format preparation from scheduled fanout and transport
controls. Keep useful read-ahead and late-join behavior. Connect picture rendering
to explicit timeline metadata rather than incidental audio playback state.
Verify source PTS mapping, seek/rate following, join position and stale/discontinuous
timestamps for ordinary and captured media. Native HLS and MPEG-TS have weaker
clock mapping today; implement a supported mapping where feasible or expose the
limitation. Do not claim frame-accurate display synchronization.

Keep one common lead for related A/V, including TV-picture/phone-sound and captured
screens. Picture-only groups still need a timeline; replace the use of a fabricated
audio track as the clock where the retained implementation permits it. If an
upstream format really requires such a track, localize and document that adapter
constraint rather than building silence generation into group semantics.

Preserve shared queue/transport, mixes, volume/mute and timing settings. Define
consistent delay sign/units and capability handling across native/group/mpv paths;
per-output hardware correction and content A/V offset remain different controls.
Group transitions and format joins must not create duplicate sound or orphan
encoders. A new video renderer is not part of this package.

**Done:** R1–R4 and R7 pass, including picture-only, sound-only and split-device A/V,
joins, pause/seek/Next where applicable, recovery and collapse to one receiver.
Multiple groups share implementation while retaining independent timelines/queues.

### P4 — Productize capture clocks and scheduled live audio

Adapt the experiments' useful mechanisms to the shared audio interface. Choose a
shipping capture adapter on the Couch computer/desktop app with truthful sample
timestamps and stereo semantics. Native ALSA lab capture is evidence for that
adapter, not for browser capture on all platforms. Reuse an existing capture
mechanism only if it can supply the needed timing; prefer a small native adapter
where required. Consult official platform documentation and t3code's desktop/helper
patterns before introducing a helper. Other publishers retain relaxed support.

Specify capture timestamp units/origin, sequence/sample positions, resets, source
drift estimation and bounded resampling. Keep scheduled sending independent of
potentially blocking Hub work through the smallest suitable worker/process seam.
Carry timestamps across that seam; isolation alone does not solve late capture or
network stalls. Choose Opus packet duration/bitrate from the full latency budget,
not today's 60 ms default. Limit source and receiver queues; give late input an
explicit discontinuity/failure policy rather than moving deadlines indefinitely.

Make decoder readiness and receiver clock corrections supported SDK behavior
(upstream release or pinned maintained patch/fork). Preserve relaxed SDK behavior
and codec fallback. Live uses its qualified format: a new incompatible receiver
cannot restart the group or silently select PCM. Output changes require renewed
admission. Publisher lifetime and capture permissions remain explicit even when
capture moves out of the browser renderer.

**Done:** a reproducible product path reaches the receiver using Opus, with tests
for drift, source gaps, resets, queue bounds, decoder readiness and slow-receiver
isolation. Both relaxed and live exercise the shared module; this is not a lab
sender bolted alongside the old engine. Physical timing remains a separate gate.

### P5 — Integrate the complete UX and scalable participation

P1–P4 enable this integration; UI work can start earlier against the frozen contract.
Finish the Direct/relaxed journeys as well as the live audience. Preserve explicit
destination selection and browsing/control context. Close the TV-row handoff gap
so an appropriate move action is reachable with TV navigation as well as pointer
input; retain permission and exclusive-move semantics. Show actionable failures,
autoplay prompts and pending state without protocol/debug controls in normal UI.

Concert listeners see join/leave, their own level/mute and useful status. Remote
controllers may still operate permitted output devices, but joining alone grants
no control of the programme. Relaxed live sources keep their collaborative UX and
queue behavior. Do not give concert audiences an ordinary Stop that affects the
whole Playback. Align page controls, shortcuts, context menus, Remote and OS media
controls with the same allowed actions.

Adapt useful admission/state-fanout/unchanged-volume work from the old drafts.
Bound pairing, setup concurrency, socket queues and retries while allowing the
target audience to join. Preserve abuse limits, recipient-specific permission
filtering and freshness; a global 20 attempts/minute is not the final audience
admission policy. De-duplicate unchanged state without hiding real volume=0,
revocation, errors or generation changes. The hot audio path must not wait on
serializing 50 UI snapshots.

**Done:** L1–L4 plus all existing Direct/relaxed controls work through actual product
entry points; reconnect/join storms remain bounded and do not disrupt healthy
receivers. Synthetic scale evidence is labeled as such.

### P6 — Migrate input adapters and remove redundant audio paths

Route relaxed audio-only capture through the common fixed-deadline sender with
more lead. Route AirPlay's decoded PCM into the same module, preserving its
sender admission, host auto-play, one-sender lifecycle and Linux packaging.
Do not start an HLS encoder merely because a raw audio source has one receiver.

Uncouple publication ownership from WebRTC peer bookkeeping and recorder demand.
Keep current screen/window sharing, selective receiver tracks and buffered
fallback working. Centralize demand and disposal so one publication's ingest is
reused by its consumers and ends only when appropriate. Captured A/V may still
extract group audio from HLS until a coherent replacement carries both tracks'
timestamps. Never combine new fast audio with unrelated delayed video.

Delete superseded audio-only ingestion/branches, old decisions and temporary
compatibility switches after coverage passes. Verify all callers before deleting
shared recorder/HLS code. Record remaining stages and reasons in the code map.

**Done:** R5/R6 pass on the replacement; audio-only paths have no intermediate
HLS/AAC conversion. Retained A/V and fallback still work, and stopping/leaving/
revoking a source leaves no peers, uploads, timers, processes or temporary segments.

### P7 — Finish qualification, retirement accounting and documentation

Run the end-to-end story suite on the integrated result, appropriate browser/native
checks, typecheck and build. Use bounded reproducible scale runs only as needed
for changed behavior; do not revive stopped campaigns or monitor indefinitely.
Report source/browser/output/version, topology, codec, foreground/background state,
run revision and failures. Distinguish capture-to-output timing, cross-device skew,
glitches/recovery, local A/V alignment and screen-to-screen alignment.

Complete the retirement ledger: removed, combined or retained with a capability
reason. Broad deletion of WebRTC/TURN or generated video HLS requires evidence
and an agreed replacement or explicit capability removal. If that decision remains
open, retain the isolated path and say so; do not call it eliminated.

Update built-state architecture, design, live-input, AirPlay and affected ADR docs
with the implementation. Correct the stale optional-yt-dlp-relay prose. Add helper
packaging/license/runtime checks if P4 introduced native code. Follow docs/ci.md:
CI is manual; workflow/packaging edits need act first. Release and installed-app
changes are separate owner actions. Deliver reviewable changes and a final status
for every story, including anything not physically qualified.

**Done:** functional refactor checks pass, old responsibilities have been retired
or justified, and release/support claims match the evidence. A missing physical
measurement can leave live qualification pending without blocking Direct/relaxed
improvements; it cannot be converted into a passing live-support claim.

## Delegation and integration order

The fresh lead owns P0, shared types, Hub integration, migration decisions and the
final report. After P0, use up to three implementation agents at once:

| Agent | Initial ownership | Later ownership |
| --- | --- | --- |
| Direct/source | P2 source preparation and native renderer work | Provider/relay regression and Direct UX integration |
| Shared audio | P3/P4 server scheduling, capture and codec interfaces | P6 AirPlay/audio-only migration |
| Receiver/UX | Receiver SDK integration, picture following and UI against the agreed contract | P5 participation, controls and browser lifecycle |

Split files explicitly before dispatch: Direct owns renderer media loading;
receiver work crosses a small agreed clock/capability seam, or is integrated by
the lead. Shared audio owns server/sendspin; the lead owns Hub/protocol/Store.
Assign each overlapping edit serially or in a separate checkout and integrate
deliberately. Each task prompt includes story IDs, owned paths, dependencies,
tests, forbidden scope and a concrete completion criterion. Return modified paths,
interface changes, checks, evidence limitations and unresolved decisions.

Sequence: P0 → P1 contracts; P2/P3/P4 can then progress in parallel; P5 integrates
their product behavior; P6 completes adapter migration; P7 verifies the whole.
Ship reviewable slices with functioning existing playback between them. A short-lived
migration switch is acceptable only with its removal gate. Avoid three permanently
duplicated playback stacks under new names.

Use independent review after integrated slices to check story coverage and resource/
permission/clock correctness. Ask a reviewer who did not implement the slice;
assign verification work after code lands rather than having it guess interfaces.
The user will assign the fresh lead and subagents; this planning thread starts none.

## Acceptance checklist

| Stories / concern | Observable completion condition | Packages |
| --- | --- | --- |
| D1/D2/D5 independent and remote Direct | Different programmes/queues coexist; Play on targets any permitted device; controller adds no receiver; local decode and necessary relay only; audio-only rendition used when available. | P1/P2/P5 |
| D3/D6 move versus join | Explicit Play on isolates its destination; Move transfers the existing queue/Playback; adding outputs keeps others; private/busy/held destinations enforce consent before and after async resolution. Single-receiver live retains its scheduled contract. | P1/P5 |
| D4 ordinary captured viewing | Existing single and multiple viewers retain screen/audio delivery, local A/V and useful failure behavior; source join is not misrepresented as making a private copy. | P1/P5/P6 |
| R1/R3/R7 shared programmes | Independent groups, queue changes, shared controls, late joins and Direct↔group transitions preserve intent, levels and clock; one source decode/encode per needed format/Playback. | P1/P3/P5 |
| R2 split picture/sound | TV picture and remote sound follow a common timeline; supported per-output correction works; sound-only clients avoid video; content delay does not masquerade as hardware correction. | P2/P3/P5 |
| R4 screen sharing | Captured picture and sound remain aligned on the buffered relaxed path; late viewers and failed direct peers recover without affecting others; no new live-video qualification claim. | P3/P5/P6 |
| R5/R6 audio adapters | AirPlay lifecycle/host takeover and audio capture work with one or many receivers; redundant audio-only HLS stages are removed; fallback for unsupported publishers stays explicit. | P4/P6 |
| L1 concert | Qualified host capture, stereo Opus and common fixed deadlines; 50 is the capacity target, 100 ms the initial total-delay goal; measured evidence names its support envelope. | P4/P5/P7 |
| L2/L4 joins/recovery | Join the present after clock/decoder/output admission; reject incompatible routes; a stale/slow/reconnecting receiver cannot restart, pause or retime healthy listeners. | P1/P4/P5 |
| L3 audience controls | Join/leave and local output controls only; unauthorized queue/transport changes fail at Core, including crafted/legacy messages; owner stop ends source while listener leave does not. | P1/P5 |
| All: lifecycle | Stale loads/SDK callbacks/encoder exits cannot mutate the new generation; newest-tab takeover, consent revocation, source end, disconnect/restart and shutdown cleanly release resources. | P1–P7 |
| All: access/output | Relay destination checks, signed URLs, capture consent, TLS/Sendspin identity and retained TURN admission survive; sink changes, Bluetooth, mute and optional compression remain coherent. | P1/P2/P4/P6 |
| All: build/distribution | Tests exercise public behavior; actual build/packaging checks pass where changed; docs describe shipped behavior and any unqualified/deferred capability accurately. | P7 |

Run existing relevant tests before adding new ones. Extend behavior tests when
the contract changes (for example concert transport differs from the existing
"all media have three transport slots" test). Keep deterministic clock/failure
tests separate from measurements. The code map points to the current suites;
docs/ci.md defines how Bun tests differ from Node integration/native tests.

## Evidence and decisions that remain open

The latest experiment's 350 ms checkpoint used one wired PCM receiver, source
resampling and receiver corrections. Lower passing runs vary by revision and
include later failures. The older 50-browser runs used synthetic source and
virtual outputs. Neither qualifies shipping Opus, 50 physical receivers, phone
Wi-Fi, background playback or video. Dirty experiment changes affect reproducibility;
record the selected mechanism and revision instead of merging its branch wholesale.

Three matters remain distinct from authorizing the refactor:

1. **Live qualification:** numerical audible-skew tolerance, acceptable dropout/
   recovery bounds and the first supported browser/output states are not set.
   Propose a concise acceptance profile from available evidence before calling a
   route qualified. Do not invent a 150 ms product requirement, assume all
   Bluetooth works, or equate browser latency estimates with measured input-to-ear.
   The user has no additional receivers/inputs; continue implementation and
   software checks with honest gaps rather than requiring equipment to proceed.
2. **Fast-path retirement:** the owner accepts a separate faster unsynchronized
   path only for a meaningful advantage. Its advantage and the acceptable loss
   of delayed fallback are not settled. Retain existing coverage while deciding;
   do not make a video rewrite the price of completing the rest of this refactor.
3. **New UX details:** review concrete changes to publication intent, concert
   controls and TV handoff during P0/P5. This is not an invitation to reopen
   Direct destinations, build zones or redesign source discovery wholesale.

Development runs use isolated COUCH_DATA_DIR/COUCH_PORT and owned process cleanup
under AGENTS.md. The installed Couch, physical routing and services stay untouched.
Do not contact/restart stopped experimental agents, merge their PRs or start an
open-ended performance campaign. Missing validation is reported as pending.

## Ready-to-assign brief

Implement the full Couch playback refactor described in this plan and its code
map. Read and carry the linked stories/evidence into your checkout first; they
are currently uncommitted and are not inherited by a new worktree. Verify your
base against the audited SHA. Own all packages P0–P7, including Direct and
relaxed A/V improvements, live audio, input migration and code retirement.
Use subagents with the ownership/dependency rules above. Proceed through the
agreed contract without asking permission for each routine implementation step;
bring concrete capability-removal or contract changes back to the owner. Report
story coverage, verification and remaining physical-qualification gaps. Preserve
the installed Couch and stopped experiments. Produce reviewable code and current
documentation; do not merge, release or start a separate video/zones/private-mode
project. The scope is complete only when every acceptance row and retirement
entry has an explicit, evidence-backed disposition.
