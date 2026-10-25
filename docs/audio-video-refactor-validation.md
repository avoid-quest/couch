# Playback refactor validation and retirement

Implementation starts from `59ac6cd6a510ca96bf60dfc9a3628cc635be22e1`, exactly the audited baseline, on `refactor/couch-playback`. The checkout was clean. Planning documents were copied from the assigned research worktree before delegation; experimental source changes were not copied.

Current assembly status: **the reviewed product at
`cf267a2f61f24a43949d6fb7d2788e37d1da9ef3` passes typecheck, production build,
the integrated Node sweep and Linux packaging**. Physical qualification remains
failed. With the independently reviewed collector correction, separate diagnostics
completed 60-second startup and leave/rejoin recordings and one 610-second
sustained recording through the actual Mac headphones. Sampled correspondence
and coverage gates passed; affine timing gates failed. Sustained median electrical
lag was approximately 101.34 ms, separate from the unchanged 100 ms sender lead.
Continuous fidelity, calibrated SNR/isolation and per-packet deadlines remain
unknown. All owned processes and audio streams are closed. No overall physical
pass, merge or release has occurred.

## Current software and package evidence

The fresh cf267 sweep covers **59 Node suites: 518 tests, 515 pass, zero failures
or cancellations, three known GStreamer/UxPlay prerequisite skips**. All three
TypeScript projects and the production build pass. Inputs remained unchanged;
all owned process groups were stopped. The prior e7dad run's **84 separate Bun
suites / 611 passes** remain separate evidence: only Hub and
`device-sharing.integration.ts` changed afterward, as recorded in the input
comparison. There was no fresh cf267 Bun sweep.

The actual Linux Package workflow passed under act with
`catthehacker/ubuntu:full-latest` and the recorded local upload-artifact v4
substitution. The deb was extracted, never installed. The packaged Electron
executable started its actual ASAR audio worker, received timeline-only state
and closed with exit 0. Package Core/worker executable text matches the local
build apart from 12 dependency-location comments in each bundle.

| Frozen cf267 input or artifact | SHA-256 |
| --- | --- |
| Hub source | `71842e08ce2de407f3a684357687e9237a89845b8bf120a2df2b9977b91fae4c` |
| 790-input package manifest | `ee102f49437c2755d389c939af0a0250273918bb21097f537444050a93e9a6cf` |
| Linux archive | `d5ec392524296a18c3f5413e4636218c248e90d72f85762fd696f66b59da34e2` |
| ASAR | `bd96680ad20ed492d59dacdcc7bb64e58b44de5f1b743a0c18df5b267b36aabb` |
| Packaged Core | `73ae2b5360ab6a567e3a320b71a36b7b9fe2b3794567f79345948facc0250c79` |
| Packaged audio worker | `f806c3cdd226fe0aaef585c8519cb6eb13e1f64a3aedf40dfa481bd18ba42d77` |

The actual package is retained in
`.scratch/playback-refactor/packaged-physical-fix-r2-root/opt/Couch`; the archive
is in `package-artifacts-physical-fix-r2/1/couch-linux/couch-linux.zip` under
the same scratch root. Exact commands, source comparisons, counts and cleanup
are in `physical-fix-root-checks-r2`, `physical-fix-integrations-r2`,
`physical-fix-r2-software-complete.json`, `physical-fix-r2-package-handoff.json`,
`package-run-physical-fix-r2` and `packaged-physical-fix-r2-*.json`.
The local worker hash `6521ef2b…` is not the shipped worker identity.
Older packages and failed receipts remain unchanged.

## Earlier candidates and correction evidence

Prior implementation commit: `5a18b8c4ebb80a8fa64e864ba533afae49b64e08`. That frozen
candidate (`Hub 86e813c8…`) passed typecheck/build and R6's 39 scoped routing cases. Its
55-suite integration evidence has 491 tests: 488 pass and three AirPlay prerequisite
skips, after rerunning the corrected 56-case live-output suite. Causal tracing
attributes the earlier startup failure to the
fixture's PCM-only encoder starting without a connected PCM receiver; the prior
bundle's apparent pass had no audio packets. The corrected fixture connects its
receiver before format selection and requires real packets as well as playing
state. R7 independently clears that correction, including real late PCM and Opus
admission and a failing consent-bypass control. No Hub change was needed for that
fixture correction. Its Linux package and extracted-ASAR worker checks pass. A
31.088-second partial physical
recording is preserved; no subsequent physical stages ran. No merge or release
has occurred.

The preceding clean candidate `e7dad73e921ba9ab94a7291083efab8e01f51298` passes
frozen install, all three TypeScript projects and production build. Its 84 separate
Bun suites pass all 611 cases. The 59 Node suites contain 509 tests: 505 pass,
one fails, three skip for the known AirPlay prerequisites. The failure is the
first setup assertion in device-sharing's private-picture case: an output exposes
“Playback outputs changed while preparing this source. Try again.” before the
unauthorized control attempt. The unchanged case reproduces 3/3. Public traces
show a persistent same-item preparation error and zero delivered loads. Restoring
only the old output-error projection makes the original assertion pass while
playback remains failed with zero loads: it hides a real initial-preparation race.
A narrow Hub correction now retries only retired output preparation for the same
current, non-moving item. Original assertions and genuine error precedence remain
unchanged. Seven new deterministic public regressions cover real scheduled playback
and encrypted PCM on both receivers, cancellation, current consent and genuine
source failures. The affected owner suites pass 101/101 (device-sharing 18, routing
18, admission 9, live outputs 56), with three-project typecheck/diff checks passing
and 107 recorded process identities gone. The correction is frozen at Hub
`7d873a157551f6e830a3cbd6e4819a810d305b7ad6b1d92961e7baf38916d0ec`;
its independent review passed 21 unchanged-product checks but found one P2:
withdrawing picture consent during held HLS preparation can retain the original
picture master instead of selecting its available audio rendition. The standalone
sound-only control passes, and a scratch current-selection correction passes both
cases. Core has corrected the distinction between resolution coverage and current
channel selection, preserving prospective moves' saved intent. The revised Hub
`71842e08ce2de407f3a684357687e9237a89845b8bf120a2df2b9977b91fae4c`
passes 53 affected cases and three-project typecheck. Fresh R2 is clear with
28 focused checks, including prospective Move selection, repeated preparation
and cancellation. Prior-selection and wrong-Move-selection controls fail at the
expected rendition assertion; all 37 sampled identities and 19 groups are stopped.
Its retained routing-runner failure came from scratch TMPDIR inheriting ESM;
the identical test bundle passes after an explicit scratch CommonJS boundary.
No product assertion or source changed for that environment correction. Original red/green and cleanup receipts remain in
`core-integrated-output-error`; the independent report and probes are in
`review-initial-preparation-r1.md` and `initial-preparation-review-r1`. All suite
inputs stayed unchanged and owned process groups are empty. Receipts are in
`physical-fix-root-checks`, `physical-fix-units` and `physical-fix-integrations`.
The subsequent cf267 integration and package results are recorded above.

Post-physical corrections are tracked separately from those frozen receipts:

- `bc40d15` bounds the existing capture encoder's input packets; its independent
  review is clear. The original failed physical package remains unchanged.
- Explicit preparing/ready/failed state now separates output warmup from a
  terminal admission failure, with atomic SDK timing reports and current-tab
  authority. All timing and capacity gates remain unchanged. That reviewed admission snapshot used Hub
  `ed065d279815b69c9b32b37e51db8e8b69f69ee82d43c66a9b06018f31f41ee0`;
  later source-preparation corrections are recorded above.
- Audio's 31 focused checks and isolated frozen-install SDK 2/2 pass. Core's
  admission 8/8, routing 18/18 and audience 7/7 pass; UI's 33 affected checks pass.
  These are separate owner receipts, not a new integrated suite total. The three
  TypeScript projects and diff checks pass. Independent audio review reran all
  31 focused checks and found one P2: a relaxed receiver's refusal remains cached
  after membership removal. Its public regression fails on the current worker
  and passes against `bc40d15`. Routing/UI review independently passes 71 checks
  and finds a second P2: a terminal receiver error can hide a genuine scheduled
  group failure. Its public-state/component reproduction fails and a scratch
  projection correction passes. Both corrections are now frozen: Audio's 11
  targeted checks pass with group-owned receiver errors; Core's expanded 9-case
  public suite and 15-case audience UI suite pass with genuine group errors ahead
  of terminal receiver errors. Both original reviews and failed cases remain
  retained. Core/UI R2 is clear with 25 checks and an expected failing prior-
  projection control. Audio R2 is clear with 17 checks; the original-worker
  control reproduces all three expected failures. Frozen inputs are unchanged
  and both reviewers verified their processes stopped. These bounded verdicts
  precede the successful cf267 integrated build, suite sweep and package.
- The continuous Live-source transfer case uses two authorized publisher tabs
  so both sources coexist. It failed before the final acquisition-order fix and
  passes with the same listener token, no transient Leave instruction and real
  encrypted audio from B without another preparation report. Earlier trials on
  one publisher socket intentionally ended A and were invalid continuity probes;
  their logs remain preserved.

Exact new receipts are in `encoder-packetization-fix`,
`output-admission-audio`, `core-output-admission` and `ui-output-admission` under
`.scratch/playback-refactor`. The encoder review's original root scratch directory
was moved byte-for-byte into that directory; `encoder-review-relocation.json`
records the old and current locations and all hashes. None of these software
checks qualifies the actual Mac's output or resolves its unrecorded refusal
predicate retroactively.

## Baseline before product edits

Pinned Bun 1.4.2 (`node_modules/.bin/bun`), Node 24.21.0, Linux x64. Frozen install, typecheck and build passed. Each of the 75 Bun test files passed in a separate process. A combined `bun test` run had 422 passes, 15 failures and 12 errors from cross-file module mocks; it is not the reliable test invocation for this repository.

Thirty-one affected Node integration suites were bundled against the unchanged source. The first run had 28 successful suite exits, two failures and one helper-download timeout. Some suites skipped real media because FFmpeg was absent from PATH. After isolating the test-downloaded helper and adding FFmpeg 9.0.2 to the test PATH, the frozen device-sharing, live-input and live-delivery bundles passed all 51 tests. Frozen live-clock, live-stream, sendspin-ahead and compressor-sendspin passed all 14 tests without skips, including Opus and PCM. These are software/fixture checks, not physical timing measurements. Other native/helper prerequisite skips remain gaps until rerun.

Raw baseline commands, per-suite logs and machine-readable results are retained in `.scratch/playback-baseline` in the implementation checkout. Scratch helpers and data are isolated there or in test-owned temporary directories; the installed Couch and its data were not used.

## Story coverage

Implementation and verification are separate. The matrix records current software
evidence; remaining physical qualification gaps are listed below.

| Stories / acceptance | Implemented behavior | Evidence / disposition |
| --- | --- | --- |
| D1/D2/D5 independent and remote Direct | Independent queues and permitted destinations; controller need not receive; select rendition before relay/probing and avoid unused video. | Device-sharing, remote-queue, server-selection, history and output suites; source/renderer tests, real Hub request counters and 55 real offline yt-dlp tests. Actual hls.js preserves Italian and its menu with zero sound-only video requests. |
| D3/D6 move versus join | Play on isolates its destination; Move here transfers the existing Playback/queue and rechecks consent after preparation; adding outputs retains the others. | Consent/routing/handoff tests; real TV keyboard menu moved Playback with queue, position 10 and speed 1.5 intact. Fixture destination is a socket, not a physical TV. One live listener remains scheduled. |
| D4 captured viewing | WebRTC, selective tracks and isolated buffered fallback remain. | Live input/delivery/outputs/channels/ICE/STUN/provisioning and consent suites. Buffered browser re-entry passes; this refactor has no new actual WebRTC-decoder receiving evidence. |
| R1/R3/R7 shared programmes | Shared clock for outputs spanning devices; one URL decode per Playback and encode per required wire; independent groups and collaborative controls. | Opus/PCM clocks, send-ahead, compressor, handoff and controls tests. Selected HLS language survives Direct/group takeover, seek/rate restart, collapse and Next isolation; actual decoded tone checks cover VOD, broadcast and muxed input. |
| R2 split picture/sound | Common timeline, picture-only timer and sound-only selection; hardware correction remains distinct from content offset. | Split routing, timeline, delay and renderer checks. Native HLS/MPEG-TS follows play/pause/rate and reports unavailable source mapping; those decoder boundaries are stubbed in tests. No physical presentation-alignment claim. |
| R4 relaxed screen sharing | Retain shared recorder HLS, mapped picture follower and isolated fallback. | Upload, stream, clock and six real-media live-latency checks pass. Actual captured WebM upload → rolling HLS → browser hls.js/group clock passes pause/resume, buffered re-entry and cleanup with 119 new nonzero software PCM packets. RTC fallback decoding, independent late third viewer, absolute position continuity across re-ingest and physical A/V alignment remain unverified. |
| R5/R6 AirPlay and relaxed capture | Timestamped PCM enters scheduled module at every listener count; redundant audio-only HLS removed for supported adapters. | Capture upload/lifecycle checks; AirPlay has 13 passes and 3 explicit missing GStreamer/UxPlay prerequisite skips; unavailable-host takeover regression repaired. Unsupported relaxed publishers retain compatibility. |
| L1 capture → Opus → receiver | Timestamped stereo host capture, bounded source normalization, 10 ms Opus and fixed deadlines. | Source drift/gap/reset tests and real encoder/worker tests pass. Native fake-file capture → production upload → prepared browser decoded 49,440 stereo frames, with no MediaRecorder or reported errors. The cf267-w2 startup/rejoin and cf267-s1 sustained Mac runs completed with public Opus readiness and sampled correspondence on both headphone channels. Coverage gates pass; electrical/affine qualifications fail and continuous/per-packet completion remains unknown. |
| L2/L4 joins and recovery | Decoder/clock/output admission; fixed format and deadlines; incompatible receiver isolated; route changes re-admit. | 50 encrypted software clients receive shared Opus; PCM-only and one-byte-buffer clients refuse independently. A 100 ms Hub stall preserves the deadline grid but causes late network packets (1–8 in recorded runs). Receiver readiness regressions pass. These are not 50 browser decoders or physical outputs. |
| L3 audience authority | Join/Leave and own volume; programme/queue/seek/speed/delays denied, including crafted/legacy/REST. | Real Hub audience tests and UI entry-point tests; phone Join/Leave/volume journey. Publisher source end remains separate. |
| All: lifecycle | Load/publication generations, source ownership, newest tab, consent, Stop/Undo, restart and disposal. | Lifecycle/consent suites, native close/reopen and packaged worker cleanup pass. Stale preparation success and failure share the same guard; its reproduced overlap regression passes. Final scoped independent reviews are clear. |
| All: access/output | Protected relays, Range, source authorization, Sendspin identity and isolation, native preflight, local volume and optional URL compression remain. | Relay/proxy, capture consent, audience/isolation, volume and compressor suites; real TURN allocation/revocation 7/7. Physical Bluetooth and hardware route changes remain unqualified. |
| All: distribution/docs | Bundled audio worker and maintained pinned client/server SDK patches; no new native capture helper. | Frozen install, typecheck/build, cf267 Linux act Package and extracted-ASAR worker lifecycle pass against the current package hashes above. Built-state docs and M1–M11 accounting are updated. |

## Earlier validation receipts

The unchanged baseline is described above. Integrated checks use pinned Bun 1.4.2,
Node 24.21.0 and isolated data/ports; one Bun file per process.

- The earlier independent-process Bun sweep: 83 files, 592 cases pass, zero failures.
  Source preparation now has 26 tests plus two public Hub Direct-language cases, and
  renderer fallback coverage includes 25 tests; SDK fallback has 4, receiver
  route retention 4, and admission 5. Logs/results are in `final-units`.
- The preceding 55-suite Node sweep ran 489 tests: 486 passed, no failures and three
  GStreamer/UxPlay prerequisites skipped. The earlier sweep exposed a consent-test
  snapshot race: SDK volume delivery preceded Core's timing-admission snapshot.
  The assertion now waits for both admitted outputs before comparing them in
  full. Its original failure, deterministic red/green ordering probe and bounded
  reruns are retained in `core-consent-restart-fix`; the final sweep includes it.
  The expanded routing suite also covers stale preparations, compressor edits,
  pending transport commands and Next resetting source-specific intent.
- The earlier 55-suite evidence totals 491 tests: 488 pass, zero failures or
  cancellations, three GStreamer/UxPlay prerequisite skips. This combines 54
  unchanged passing suites with the entire corrected 56-case `live-outputs`
  rerun. Its PCM-only fixture now connects the receiver before format selection
  and requires encrypted audio plus playing state before testing private-output
  consent. Six focused reruns also pass. The original failed sweep, four repeated
  failures, prior stale-state passes, diagnostic traces and stronger prior-bundle
  failure remain in `cached-preparation-candidate-full-sweep` and
  `core-live-output-startup-fix`. No product change was made for this diagnosis.
- Typecheck and production build pass. A fresh scratch frozen install applies the
  maintained SDK patches and resolves their declared dependencies.
- Remote Stop/Undo opt-in checks were rerun with `COUCH_TEST_STOP=1`: all 11
  remote-control cases pass without skips.
- 55 yt-dlp offline extraction tests use real yt-dlp 2026.10.21, no skips.
- Real FFmpeg 9.0.2: retained Opus/PCM clocks, stream generation, send-ahead,
  compression and live-HLS latency pass. Six live-latency cases retain the old
  buffered source-age bound; these measure fixture timestamps, not sound in air.
- TURN helper built with Go 1.27.2. All 7 real allocation/revocation/lifecycle tests
  pass; the owner's relay was not used.
- The broader Node pass exposed worker-log observer changes and missing explicit
  speaker fixtures; logging tests now observe the process boundary. It also found
  an actual AirPlay native-preflight regression, repaired before acceptance.
- Browser journeys: desktop 1440×900 native H264, seek and 1.5× rate; phone 390×844
  live own-volume/mute/leave with no overflow; TV 1920×1080 keyboard Move here.
  Host Share used a synthetic preload bridge against real scratch Core authority.
  The source on the phone UI fixture sent no samples, so this is not audio
  admission evidence; a rejected retry displayed an actionable error.
- Electron 44.4.5 / Chromium 152 fake-file capture: true stereo 44.1 kHz AudioData,
  441 frames/chunk, page-relative timestamps. This proves API/format availability
  for the fake source only. The integrated product probe then decoded 49,440
  stereo frames through the maintained SDK, with muted output and no recorder;
  the post-language-fix repeat gives the same frame count. Main's native renderer-status lifecycle check also passes.
- Direct HLS language journey uses actual production renderer/hls.js 1.7.3 in
  Chrome 154 against real Hub/Session and FFmpeg 9 AAC/H264. Italian and both
  language choices survive initial sound-only, picture off/on and menu changes;
  sound-only loads decode audio with zero video bytes/requests. Playback, queue
  and paused position 13.213901 s survive restoration. Output was forced to zero;
  this proves media selection/decoding, not audible timing. See
  `source-language/browser/result.json` and `source-interface.md`.
- Retained captured A/V runs actual authorized WebM upload, rolling H264/AAC HLS,
  production renderer/hls.js and the group clock in Chrome 154. It decodes a
  320×180 picture, pauses/resumes, recreates buffered playback after picture
  re-entry, and revokes the old playlist on Stop. A software receiver records
  119 new nonzero PCM packets. The scratch page imports product modules; it is
  not the complete Share UI/capture journey. Picture leave selects WebRTC, which
  that receiver cannot decode, so uninterrupted sound across fallback is not
  proved. No independent third late viewer, absolute position continuity across
  re-ingest, native/WebKit HLS or MPEG-TS decode was checked. Captured rate changes
  are unavailable (`controls.speed=false`); two dropped frames do not establish
  a performance profile. See `buffered-av-browser/README.md` and its receipts.
- Native capture cleanup passes through actual Main/preload/Core/PCM capture on
  Electron 44.4.5 Linux. The fixture invokes product `startLive` under a user gesture
  and observes real tracks/worker lifetime: minimize retains sharing; Close ends
  sharing once, revokes capture, leaves hosting alive; reopening works; closing
  during prepare or microphone admission cancels. An isolated Xvfb plus extracted
  Openbox provides real minimize events. Bare Xvfb cannot supply that event and its
  failed attempt is retained. A separate settled-startup native run also clicks
  Share → Audio input → Start sharing through the real preload bridge before the
  same cleanup checks (`native-share-settled`). These fixtures use Chromium's fake
  input and do not qualify physical input/output.
- Final native Quit and live Close/reopen checks pass. Client-mode capture consent
  also passes after correcting a pre-existing test assumption: Linux has no system
  loopback capture, so it must neither prompt nor grant that unsupported request.
  Microphone/screen permission, user activation and stale/cancelled responses are
  still exercised through actual Main/preload. Supported macOS/Windows assertions
  remain in the test but were not run on those platforms.
- Linux Package ran successfully under act 0.2.89 with the required
  `catthehacker/ubuntu:full-latest` image and local upload-artifact v4 substitution.
  The deb was extracted, never installed. Its ASAR includes Core, audio worker,
  Main and preload; TURN/UxPlay resources and notices are present. The packaged
  Electron executable started the ASAR worker, received timeline-only group state
  and closed with exit 0. Product inputs match the frozen source; package and local
  Core/worker executable text match, differing only in 12 dependency-location
  comments per bundle. That run includes stale-preparation isolation,
  compressor edits, pending transport/Next preservation and replacement of retired
  cached preparations. Local artifact SHA-256:
  `13ed80143d0d88c5973b55841cb502da2caff5e96b79e4e2d507879e12d68ae8`.

Detailed logs and reproducible fixture scripts are in `.scratch/playback-refactor`;
UI screenshots and journey notes are in `ui-browser`. These local receipts are
not shipped product assets. Native cleanup events are in
`native-release-candidate-live-close/events.json` and
`native-final-capture-consent-fixed/events.json`; product stereo decoding is in
`product-audio/final/result.json`. That package's receipts are
`act-package-final.log`, `package-inputs-final.json`, `packaged-final-receipt.json`,
`packaged-final-asar.json`, `packaged-final-worker-result.json` and
`packaged-final-build-comparison.json`. Typecheck/build logs are
`typecheck-final.log` and `build-final.log`.

The fake-input browser and native lifecycle receipts precede the later encoder,
admission and ordinary URL preparation corrections. They are not a rerun of every
native journey on cf267. The latest actual package and physical route are recorded
separately; the following manifest belongs to the earlier package.

The earlier package's source manifest has SHA-256
`ba8da54d73c7cb4ff1c5205dc5ea20597741c607b7b47850dd964dbbd989239c`;
it inventories 784 inputs. Its Hub source is
`86e813c825ff6fd35192cef0b97cb1532e2057932a034a8417747caf493bf06f`.
Later ledger or test-only edits do not change the packaged product inputs.
Final staging removed one trailing newline from `src/server/audio-packets.ts`.
Rebuilding with the same release identity produces byte-identical Core and audio
worker bundles; the package manifest retains its original source hash. Both source
hashes and the unchanged runtime hashes are in `final-source-whitespace.json`.

## Remaining qualification and verification

### Latest cf267-s1 diagnostic: sustained recording complete

Exactly one **610-sample-second four-channel acquisition**, with the original
600-second stimulus, completed through the frozen cf267 packaged Main/preload
capture/upload, scheduled Opus worker and actual wired Mac product receiver and
headphone output. The reviewed collector, package, input guard, evaluator,
stimuli, 100 ms sender lead and admission thresholds were unchanged. Prior w2
short runs remain separate evidence, with no fresh-session startup/rejoin credit.

The raw file contains **468,480,000 bytes / 29,280,000 frames**, with 53,777
contiguous blocks. Witness and generator both exited 0. Full-record integrity
passed with no clips or unexplained all-channel digital-zero intervals. Peaks
on ADC1–4 were −33.005, −32.864, −57.136 and −57.025 dBFS. Prospectively fixed
intervals were startup [0,30), steady [30,590) and tail [590,610); no interval was
trimmed or shifted.

| Fixed steady metric, [30,590)s | Left ADC1→3 | Right ADC2→4 |
| --- | --- | --- |
| Identified pilots | 1107/1120 | 1113/1120 |
| Coverage, ≥95% gate | 98.8393% | 99.3750% |
| Unknown pilots / longest consecutive unknown | 13 / 1 | 7 / 1 |
| Maximum identified-center gap | 1 s | 1 s |
| Median electrical lag | 101.339039 ms | 101.337865 ms |
| p95 electrical lag | 101.475196 ms | 101.477313 ms |
| Maximum affine residual, ≤1-sample gate | **29.870465 samples — fail** | **29.780547 samples — fail** |
| Diagnostic affine slope | 0.382905 ppm | 0.381462 ppm |

Intended stereo correspondence and sampled coverage are demonstrated. Both
unchanged affine residual gates fail, so the small fitted slopes do not qualify
drift. The measured electrical lag is in common ADC sample coordinates; the
configured 100 ms sender lead is not subtracted. Absolute uncertainty remains
uncalibrated and the 100 ms physical latency goal is not qualified.

The detector samples 10 ms every 500 ms, at most 2% of the waveform. Unknown
pilots are unidentified sampled windows, not confirmed dropouts; continuous
fidelity and dropout freedom remain unknown. Calibrated ≥30 dB SNR/isolation,
numerical recovery and per-packet encode/decode/schedule/completion/deadline
metrics also remain unknown. **No overall physical qualification pass follows.**

Public worker logs show preparing → ready, Opus, epoch 2, capacity 5,875,200 bytes,
required lead 37 ms, minimum buffer 25 ms and static delay 0. The Mac reached
running/synced/ready with failures 0, clock error 1 µs and output-latency estimate
26 ms. Three preparation notifications include one coalesced report, with no
dropped events, replay or reported preparation/admission/output failure. These
are bounded control observations, not continuous packet journals or analog
latency measurements.

Native acquisition ran from 00:27:06.580047 to 00:37:16.586986 UTC on
25 October 2026. Its receipt wall span was 610.006939 s, while first-to-last block
receipt span was 608.109656 s. PA backlog means receipt times and UI frame bounds
are not ADC timestamps. The generator-start receipt upper bound was 95,744
frames, within the unchanged 96,000-frame limit. Exact application onset/recovery
cannot be derived from those bounds. All startup/tail and unknown coordinates
remain retained.

The exact frozen input-selection guard succeeded once without modification.
Routine certificate, launch and cleanup controller errors and their versioned
corrections remain in the report. Neither failed launcher opened a native
acquisition or published audio; only the successful controller recorded. Normal
origin-specific certificate Continue followed a matching public fingerprint.
No new pairing-code exposure, lifecycle restart, product change, timing change
or acquisition retry occurred. The earlier w2 selection-timeout cause remains
unknown.

Cleanup verified native writers, controllers, observers, Main and actual Core,
owned Linux groups, dedicated Mac browser/helpers and keepawake absent. Dedicated
ports and UMC streams/PCM file descriptors are closed; the owned ledger is empty.
Only after full cleanup did the unchanged evaluator and extractor each run once,
single-thread, with exit 0. Analysis helpers also stopped. All 532 preparation/
product pins, 20 evaluator files, six stimuli and four anchors stayed unchanged;
220 regular-file Linux mappings were hashed and unavailable mappings disclosed.
Mac binary/framework hashes matched after cleanup. No further activation is
authorized.

Immutable evidence under `physical-mac/cf267-s1`:

- `reports/REPORT.md`: `122bce63d6947316d2905847e27529670d0d2f377365b672f7c1f067c21dc2d2`.
- `reports/result.json`: `f64f3ba1bb430718c0595e915db07d49c82ef4c95c7dfc7a7c09e6274faa22aa`.
- `reports/evidence-index.json` (178 files): `cf2f78a137fd62cee6ed0a866719b59bd9a5f0ade124e21c82a5646821d0b47c`.
- `reports/final-receipt.json`: `7b819ea7e5105c5810d4733cfca350c3786c87b4b7f2592eb9f825bb1d21abbb`.
- `runs/sustained/capture.s32le`: `872b8bd9648e77b329ae2fff0459ee919c29e41823885fc81e6d23ec17f8aef5`.
- `activation/cleanup-complete.json`: `7504462bbb1c2be84b586481443beead722aaab26c1cb8b6d17305e3bb7a6f34`.

Root independently rehashed the final receipt and all 179 unique referenced
files, including all 178 indexed files and the raw recording, before this update.
No evaluator rerun or hardware action was needed.

### Earlier cf267-w2 diagnostic: short runs complete, sustained not started in this attempt

The collector correction uses `pa_mainloop_get_retval()` after a completed loop
instead of iterating it again. The guard preserves failure when no quit occurred.
Thirty hardware-free owner controls and 13 independent controls pass, including
expected original aborts, non-quit errors and injected file-close failures. Only
that status read and its comment changed; sampling, buffering and all product,
stimulus and evaluator bytes stayed fixed. Original failed acquisitions remain
failed. Review and exact provenance are in `witness-shutdown-diagnosis.md` and
`review-witness-shutdown-r1.md` under `.scratch/playback-refactor`.

The separate `physical-mac/cf267-w2` attempt used the same actual cf267 package,
Main/preload capture/upload, scheduled Opus worker and paired Mac product UI,
with the reviewed witness `bb0a6784…`. Direct wired LAN HTTPS, the explicit
stereo ADC1/2 remap and coherent four-channel reference/headphone witness were
retained. Headphones stayed at 48 kHz/100%/unmuted with Wi-Fi off. The configured
sender lead stayed **100 ms**, separate from measured electrical lag. Root's
prospective diagnostic-only disposition allowed the bounded stages when all
measurable usability/control gates passed, while keeping unsupported calibrated
SNR, stereo isolation and continuous/per-packet metrics UNKNOWN. It did not
authorize an overall qualification pass or change any numeric threshold.

Both recordings contain exactly **2,880,000 frames / 60 sample seconds**;
witness and generator exited 0, files closed normally, and frame receipts are
contiguous. Full-record peaks stayed below −6 dBFS with no clipping or unexplained
simultaneous all-channel digital-zero intervals. Fixed intervals and all raw
startup/tail observations were retained.

| Stage and fixed steady interval | Identified pilots L/R | Median lag L/R | p95 lag L/R | Maximum affine residual L/R |
| --- | --- | --- | --- | --- |
| Startup, [20,48)s | 55/56 / 56/56 | 100.320 / 100.321 ms | 100.700 / 100.708 ms | 15.601 / 15.975 samples |
| Leave/rejoin, [30,43)s | 26/26 / 26/26 | 100.552 / 100.551 ms | 100.718 / 100.721 ms | 9.697 / 9.690 samples |

Both intended channel pairs pass the fixed sampled correspondence/coverage
criteria. Startup's one unidentified left pilot is not a proven dropout. Both
stages fail the ≤1-sample affine residual criterion; fitted slopes cannot qualify
drift. Measured steady lag exceeds 100 ms, and absolute route uncertainty remains
uncalibrated. Sender lead is not subtracted. Pilot sampling covers at most 2% of
the waveform and cannot establish continuous fidelity or stereo isolation.

Normal Leave/Join/Leave completed; accepted correspondence disappeared and
reappeared around those controls. Public worker records show preparing → ready
for initial Join and rejoin, with Opus, capacity 5,875,200, required lead 37 ms,
minimum buffer 25 ms and static delay 0. No refusal or parser gap was observed.
Client readiness/26 ms output estimate and observer completeness are control
evidence, not per-packet decode/schedule/completion evidence. Calibrated ≥40 dB
leave suppression and exact ≤5 s recovery remain unknown.

UI frame-size observations are receipt bounds, not ADC timestamps. Startup has
60 sample seconds but a 59.133837-second wrapper wall span; generator-start upper
receipt bound is 57,088 frames, versus 512 for rejoin. Initial PA buffering and
receipt timing prevent exact physical startup/recovery timing from those values.
Matched-pilot lag remains directly measured in common four-channel sample
coordinates. Input enumeration preceded recording; this was fresh publication
and Join, not cold application startup.

The sustained stage **never started in w2**. After normal Stop sharing and Share →
Live audio, the exact input-option locator timed out after 7 seconds. Its
optional discovery-visibility result and contemporaneous option list were not
captured, so the cause remains unknown. A hardware-free fixture using unchanged
ShareDialog/Select confirms that the exact label works when present; missing or
unlabeled input, deliberately skipped discovery and dialog dismissal each yield
the same timeout. It did not reproduce a product defect or visibility race.
Its guarded selection checks explicit discovery completion, one exact option and
selection state; the subsequent s1 guard succeeded once, without establishing
the historical cause.
Proof, substitutions and cleanup are in `input-selector-diagnosis.md`.

The report also discloses a setup-body snapshot that exposed a pairing code in
tool output. The value is not repeated. Closing setup does not revoke that
process-lifetime capability; before any publication/acquisition, one explicitly
authorized restart retired the owned Main/Core process. The same package/data/
port/settings restarted, and the Mac reconnected through persisted identity.
The new code was never inspected or printed. Original logs/evidence were retained;
this lifecycle mitigation is not mathematical proof of random-code noncollision.

All owned processes, helpers, ports and UMC streams were verified closed at
**23:39:09 UTC on 24 October 2026**. No recording retry followed. All 450 frozen
product/preparation pins, 20 evaluator files and six stimuli remain unchanged.
No sustained drift/deadline conclusion follows from these two short runs.
Immutable evidence under `physical-mac/cf267-w2/reports/final`:

- `REPORT.md`: `caa6d4e2dec10782639130b58718e7af0a1ae0ca45b02be788a6b4d1d7fd6845`.
- `result.json`: `dc471d421bc4f4529689bcee0db9f381f6784a01fd629aa46dab7877c4300675`.
- `evidence-index.json`: `50dca1922361ece962009da6fa5d2a26f8c190c6000e15e8a462750760fe6b04`.
- `final-receipt.json`: `9777912cc020d43d9a7e5879b7fe24eebe4b894fc0ba9f54e391edd7246939f7`.

### Earlier cf267 physical attempt: acquisition failed

The actual extracted cf267 package ran Main/preload Share → Live audio with the
explicit UMC stereo remap, normal capture/upload and the scheduled Opus worker.
The paired Mac's actual product UI joined over direct wired LAN HTTPS. The
Mac remained on headphones at 48 kHz, volume 100%, unmuted, with Wi-Fi off.
Its freshly observed versions were macOS 14.8.7 and Helium/Chromium
156.0.8078.47. One private PulseAudio instance owned the four-channel ADC;
a no-remix ADC1/2 remap fed normal product capture and ADC3/4 witnessed the Mac
headphones. Generator DAC3/4 supplied the electrical source reference.

These are disclosed audio-stack substitutions: product capture was 48 kHz S16LE
stereo, the witness 48 kHz S32LE four-channel, and the remap S32LE stereo,
with unity/unmuted copy streams and no resampler. Observed PA source latency
was about 5.1–5.2 ms; this is not a complete input-latency bound. Witness
fragsize was 1,536,000 bytes and maxlength 4,194,304 bytes, without a buffer
override. No lab PCM sender, SDK transform, experimental runtime or timing
override replaced the product path. The **100 ms sender lead and all admission
gates stayed unchanged**. Physical controls/cabling stayed as recorded; software
cannot independently establish knob positions.

Before activation, the operator froze a display-only rebind to Xvfb :108 because
:99–107 had unowned socket/lock paths, which were left untouched. The actual
product origin remained `https://10.10.10.11:48376`. The documented per-site
certificate Continue flow used the dedicated profile after the served
fingerprint matched Couch's generated certificate. There was no global TLS
bypass, OS trust import or HTTP fallback. SSH carried browser control only.

Only the prospectively specified startup stage ran: **60 seconds,
2,880,000 four-channel frames, 46,080,000 bytes**. The witness began before
publication and Join; capture input selection/preparation had already occurred.
Main Start sharing was bracketed at 22:39:57.842–57.987 UTC and Mac Join at
22:39:58.052–58.317 UTC on 24 October 2026. Receipt/frame brackets do not
establish exact DAC onset or completely cold device-startup timing.
The journal ended with `reason=complete, exit=0`, but the process then aborted
with **SIGABRT / exit −6**, reporting `m->state == STATE_PASSIVE` in
`pa_mainloop_prepare()`. The generator exited 0. The process-exit gate therefore
**failed acquisition**, despite the complete raw file. No leave/rejoin,
610-second sustained recording, retry or tuning followed.

After all owned services were stopped, the unchanged trusted evaluator analyzed
the complete recording and the prospectively fixed steady interval **[20,48)s**.
All 20 evaluator files and six stimulus files remained unchanged.

| Fixed steady metric | Left, ADC1→ADC3 | Right, ADC2→ADC4 | Interpretation |
| --- | --- | --- | --- |
| Identified pilots | 56/56 | 56/56 | Intended-pair electrical correspondence; 10 ms pilots every 500 ms sample only 2% of the waveform. |
| Median electrical lag | 100.232956 ms | 100.233392 ms | Sender lead is not subtracted. No fresh absolute uncertainty bound or ≤100 ms qualification. |
| p95 electrical lag | 100.553220 ms | 100.552199 ms | Descriptive observations on this route. |
| Maximum affine residual | 12.453211 samples | 12.453801 samples | Both fail the ≤1-sample gate. |
| Diagnostic affine slope | 3.271977 ppm | 3.266258 ppm | Invalid global fit; no long-run drift qualification. |
| Maximum detrended adjacent jump | 0.396318 ms | 0.399290 ms | Passing this individual threshold does not repair the failed fit. |

Across the full 60 seconds the detector identified 72/120 left and 74/120 right
pilots. Planned quiet, isolation and tail intervals explain some unknowns;
the remainder cannot be counted as either confirmed dropouts or confirmed
delivery. Zero missed steady pilots does not establish continuous fidelity:
retained synthetic sensitivity controls miss some inter-pilot defects, including
100 ms gaps. Leave suppression, recovery and sustained deadlines were not tested.
Both intended channel pairs match, but the separate ≥30 dB stereo-isolation
criterion remains unmeasured. Peaks on ADC1–4 were −33.09, −32.86, −57.44 and
−57.10 dBFS, with no clips. Steady/baseline ratios of 56.33, 55.94, 31.81 and
31.78 dB are descriptive, not calibrated SNR. Historical ADC calibration does
not supply absolute uncertainty for this PA/Opus route.

Public client preparation reached running/synced and ready at epoch 2, with
failures 0 and an estimated output latency of 26 ms. Normal worker logs recorded
preparing → ready, wire Opus, capacity 5,875,200, required lead 37 ms,
minimum buffer 25 ms and static delay 0; no refusal or parser gap was observed.
Unknown/nonfinite fields and the coalesced preparing report remain explicit.
These fields show control/admission behavior. Alongside matched headphone
samples they support limited downstream completion on the actual route, but
do not independently enumerate upload bytes, encoded/decoded packets, scheduled
buffers or completions. They cannot fill the historical evaluator's unavailable
runtime journals or qualify every stage of the requested path.

Cleanup completed at **22:44:00 UTC**, before analysis: owned ledger and
process-group survivors empty, acquisition PIDs gone, UMC streams closed,
Mac CDP and Linux product/control ports closed. The installed app, personal
profiles and unrelated processes remained untouched. All analysis workloads
also ended. A separate hardware-free witness diagnosis cannot amend this failed
run; any corrected collector requires a distinct freeze and new attempt.

Immutable evidence under `.scratch/playback-refactor/physical-mac/post-fix-cf267`:

- `physical-report.md`: `7ab5dc1dd839940f34879bf88d2dbba17e05858472257d4319cf72a55c546b5e`.
- `result.json`: `3aaa9a60698af0561d12bdd4965fab8ed5296cf3e58cf1623cc2bb61f83d85b3`.
- `evidence-index.json`: `931f012f1b469b07881407249fa0d08451d640dc83613f344e91a066d58c9b6f`.
- `runs/startup/capture.s32le`: `153d17e1e632bdf03b7facf0cfe86052eb8c08982758bb81ffa62fa8f6b8794a`.
- `activation/cleanup-complete.json` and `reports/analysis-command-receipt.json`
  retain exact cleanup and evaluator commands.

### Earlier routing and physical evidence

Round five's cached full-A/V preparation
replacement passes R6's 39 scoped cases and five negative controls. The refreshed
full sweep exposed the PCM-only fixture setup described above. Its correction
passes all 56 live-output cases. R7 independently passes the corrected consent
case and two real-media late-admission cases; removing the post-resolution consent
check fails as expected. It reports no remaining finding in that bounded review.
All reviewer-owned processes are stopped. Exact comparison and causal receipts are in
`core-live-output-startup-fix`.
The preceding package and 486-pass sweep remain archived. Round four's
compressor-preparation and subsequent pending transport/Next defects are corrected.
The actual buffered captured-A/V browser check has passed.

The authorized physical attempt used one wired MacBook Air, macOS 14.8.7,
Helium/Chromium 156.0.8078.47, headphones at 48 kHz/100%/unmuted, Ethernet and
Wi-Fi off, plus the Behringer UMC404HD. The first activation stopped before
acquisition on a locked desktop/Keychain startup problem; its receipt remains in
`physical-mac/activation/result.json`. After the owner's intervention, normal
LaunchServices launch restored the dedicated browser. No consent bypass or
physical setting change was applied; the personal browser remained untouched.

The actual packaged Main/preload UI selected Share → Live audio and the real
stereo input, and the actual Mac product UI paired and joined. Direct LAN access
redirected to HTTPS, frozen in new manifests before recording; SSH carried only
browser control. All 136 preparation pins matched. Private PulseAudio was the
sole four-channel 48 kHz S32_LE hardware capture owner; a no-remix stereo remap
fed Couch's normal 48 kHz S16_LE capture. Its observed 42.67 ms capture latency
and the witness's default 2000 ms buffering are disclosed stack substitutions,
not corrections subtracted from electrical measurements. Linux used an isolated
display; no fake source, experimental PCM sender, SDK transform or timing override
was used. The sender lead stayed **100 ms**.

The planned 60-second startup qualification **failed**. At 20:18:44.830 UTC on
24 October 2026, the Mac UI reported that its output could not meet Live audio's
Opus deadline. The operator stopped the attempt and retained all 31.088 seconds
(1,492,224 four-channel frames). The exact refusal predicate is unknown: standard
browser latency/capacity/timing values were not captured. Public state alternated
504 loading and 501 playing observations, and later showed “Waiting for audio”.
The owner independently saw rapid Play/Buffering flicker on the Mac during the
run, confirming that the state churn reached the visible UI. These observations
do not establish permanent hardware incompatibility.

| Measurement | Recorded observation | Disposition |
| --- | --- | --- |
| Electrical source-to-headphone correspondence | Accepted local pilots span 100.184–100.672 ms left and 100.184–100.673 ms right; no sender lead or ADC/DAC estimate subtracted. | Only 9/63 left and 6/63 right pilots identified. No 100 ms qualification; current analog uncertainty is uncalibrated. |
| Stereo identity | Four trusted generator→ADC pilots support source channel identity; sparse corresponding headphone activity exists on both channels. | Output stereo separation and sustained stereo delivery remain unqualified. Output was not uniformly silent. |
| Drift | Maximum affine residuals 11.54 samples left and 5.47 right exceed the one-sample gate. | Sparse fits are not an established drift measurement. |
| Dropouts and recovery | Intermittent output and low coverage; no validated continuous-fidelity or dropout count. | Leave/rejoin and the 610-second sustained check were not run. No recovery or deadline-margin qualification. |
| Acquisition | Complete raw prefix retained; the original 60-second evaluator rejects the missing tail. Final block journal line was truncated by stopping; 11,152 raw frames lack a complete final receipt record. | Failed prospective run. Separate prefix diagnostics do not replace its verdict. |

The unchanged trusted evaluator produced the original incomplete-run failure.
Only afterward, its unchanged trajectory functions described the recorded prefix
with the same matching thresholds; that is diagnostic evidence, not a shortened
acceptance run. Historical calibration and unavailable native/source/receiver
journals do not transfer to this Opus/Pulse path. Actual stereo capture/publication
is observed, but upload packet counts, encoder output, decoder completion and
per-packet scheduling were not independently recorded. Sparse correlated analog
output does not qualify the full requested chain.

The immutable report is `physical-mac/continuation-1/physical-report.md` (SHA-256
`7c423cd318cf326e66876891ea050237fc716523ce27722017fa1feb0c8301fd`);
`result.json` pins retained evidence. Raw recording SHA-256 is
`a1c08e367f822e945834d5d7de338fe24701c33416195143b3f25c5e0d6fb95c`.
Verified cleanup at 20:20:07 UTC found no owned processes, open UMC streams or
dedicated ports. No retry or later stage ran. The stopped experiment and its
latency search remain stopped; historical measurements are not this refactor's
evidence.

The bounded offline diagnosis subsequently reproduced a software defect twice:
FFmpeg 9.0.2's raw-float demuxer reads 4096 frames at once (85.33 ms at 48 kHz),
consuming most of the fixed 100 ms budget before encoding. Regular 10 ms input
then loses scheduled intervals and produces recurring loading/playing transitions.
A scratch substitution using documented streaming WAV input with 3840-byte
packets removes the recurring gaps at declared input ages of 0, 20 and 40 ms,
without changing lead, clocks or admission gates. This reproduces the observed
class of failure; it does not prove the physical source's exact age or sole cause.
The product now writes a streaming float WAV header directly to the existing
encoder and bounds its input packets to 3840 bytes. All timing, clock, resampling,
Opus and admission policies remain unchanged. The correction passes 23 affected
checks and typecheck; independent review found no actionable issue. Its three
frozen regression cases pass, while the original raw input and WAV without the
packet bound each fail both continuity controls. Additional review checks cover
fragmented input, generation cancellation and relaxed PCM compatibility. These
are software results; the subsequent cf267 package and physical attempt are
recorded above and do not retroactively qualify the original run.

A separate public-logic probe confirms that pending decoder/clock preparation can
temporarily produce the same incompatibility warning, then recover automatically.
The actual Mac refusal branch remains unknown. The diagnosis also verifies that
state churn alone does not reset the receiver in its isolated test. Exact red,
repeat and scratch-correction receipts and official FFmpeg references are in
`physical-startup-diagnosis.md` and its evidence directory. No physical retry or
runtime timing adjustment was performed during diagnosis.

Earlier routing/renderer/source findings and selected-language transitions pass
independent review. Audio round three verified 65 invalid encrypted cases isolate
the offender and eight valid cases remain compatible while healthy Opus continues.
Audio round four clears the language/engine changes with 87 passing checks and no
actionable finding. Its license-note wording was corrected. Reports and reproduction
receipts remain in `.scratch/playback-refactor/review-{routing-ui,audio}*.md`.

Linux is the only package/native platform exercised for this refactor. macOS and
Windows installers and runtime paths have not been rerun; existing packaging and
platform adapters remain in place.

No 100 ms physical input-to-ear, numerical audible skew/dropout profile, 50 physical
receivers, Wi-Fi phone load, Bluetooth route, background/locked mobile playback,
physical macOS/Windows capture or Apple sender test has been qualified. Runtime
readiness and latency estimates cannot establish those properties. The authorized
Mac/Behringer protocol's 60 s startup, 60 s leave/rejoin and 610 s sustained
acquisitions (600 s stimulus) are now recorded across w2 and s1, with the unchanged
100 ms sender lead and existing evaluator. These diagnostics do not establish a
supported live profile; unavailable evaluator inputs remain unknown. Existing
future live-video/zones/private-mode scope remains out.

## Final code disposition

These dispositions cover M1–M11 of the assigned code map. Research documents remain
historical evidence; the built-state architecture/design docs describe this revision.

| Responsibility | Disposition and owner | Replacement/retention evidence |
| --- | --- | --- |
| Ordinary Direct decoding and provider/byte adapters (M3/M4) | Keep native/HLS/MPEG-TS/mpv adapters; combine channel selection in `source-preparation.ts` and cancellable loading in renderer. No mandatory server codec. | `source-preparation`, `renderer-hls`, `playback-policy`, real offline `youtube-playback`, public relay/proxy and mpv lifecycle tests. |
| Hidden video for sound-only with a suitable rendition (M3/M4) | Replace. Source selection precedes relay probing; renderer assigns only audio. Restoring picture re-resolves while preserving Playback/queue. Muxed-only remains a usable fallback. | Real Hub manifest/request counters in `playback-policy.integration.ts`; renderer unused-URL and picture restore cases. |
| Scattered delivery/authority inference (M1/M2/M9) | Combine in `playback-policy.ts`, actor controls and Hub authorization; preserve `inSync` only for relaxed capture compatibility. No durable audience/admission state. | Policy, audience, remote, consent, handoff, newest-tab, Stop/Undo and REST tests. UI consumers gate shortcuts/Media Session/queues too. |
| URL and capture scheduled sound (M5/M10) | Shared worker, transport, identity, receiver preparation and bounded fanout. Keep two necessary sender policies: read-ahead URL and fixed-deadline capture. `sendspin.ts` is a lifecycle facade; its former engine moved to `scheduled-audio.ts`. | Existing Opus/PCM clock/ahead/compressor tests plus capture drift/reset/upload/admission/fanout tests. Worker errors retain bounded, redacted parent logging. |
| Audio-only recorder/AAC/HLS (M6/M8) | Remove from timestamp-capable audio-only publishers and AirPlay. Delete live-stream PCM `write()`/S16BE conversion branch. Unsupported relaxed publishers explicitly retain recorder/WebRTC compatibility. | Capture and AirPlay lifecycle suites assert scheduled delivery and no HLS. Remaining `liveStreams.start` consumer is the recorder compatibility branch in Hub. |
| Captured A/V HLS and delayed fallback (M7) | Retain one shared buffered ingest per publication for existing screens/unsupported relaxed audio. Keep picture-only `anullsrc` inside this adapter: its AAC PTS supplies the retained captured-video timeline. Ordinary picture-only groups use a timer, with no fabricated track. | Live delivery/upload/reporter/stream/clock/latency suites; scheduled picture-only timeline test; actual captured WebM/HLS browser decoding, pause/resume, buffered re-entry and cleanup. No alternative captured-video replacement was authorized. |
| WebRTC peers, ICE and TURN (M7) | Retain end to end. Fast-path retirement still requires same-source evidence and product agreement. No new video renderer or SFU. | Existing live-client, ICE/STUN/provisioning, consent/fallback and real TURN allocation/revocation tests. |
| mpv, native/Bluetooth routing, optional compression (M4/M8) | Keep. mpv honors output intent and pending-load cancellation. Native receiving output still preflights; capture-only host does not require speakers. Content delay is exposed only where implemented. Existing URL compression remains before device volume. | mpv lifecycle/compressor, source/renderer controls, sound/native policy, AirPlay takeover and compressor integrations. Bluetooth hardware/sink switching remains unmeasured. |
| Experiment hacks (M11) | Exclude. No revived experiment, ALSA lab helper, private SDK-field mutation, runtime string replacement, or invented stereo capture. Maintain pinned Bun patches for public preparation/invalidation and connection-level protocol isolation, each with an upstream removal gate. | Frozen clean install, SDK regression/isolation tests and package artifact inspection. Relaxed mono may upmix for its wire; Live refuses mono. |

### Retained stages and cost

| Stage | Input → output and clock | Codec passes | Resource owner |
| --- | --- | --- | --- |
| Direct URL | Selected encoded tracks → receiver media elements; native media position | Receiver decodes; Core only resolves/relays | Core load capability; renderer generation |
| Ordinary shared URL | Encoded audio → normalized 48 kHz → Opus/PCM with shared server deadlines; muted picture follows media/source PTS where mapped | One source decode and one encode per required wire per Playback | Audio worker group and FFmpeg child; renderer picture generation |
| Timestamped capture | Actual AudioData rate/channels/sample positions → server clock normalization/resampling → stereo Opus; fixed 100 ms Live / 1 s relaxed sender lead | One shared 10 ms Opus encode per publication; relaxed PCM compatibility; receiver decode | Publisher track/readable/upload worker; Core publication; audio worker source |
| AirPlay | UxPlay-decoded RTP L16 → bounded ingress → timestamped PCM → relaxed scheduled sound | AirPlay decode in UxPlay; shared Opus encode or PCM; no AAC/HLS | Core's authenticated UxPlay generation and ingress; audio worker publication |
| Buffered captured A/V | Recorder bytes → rolling video/AAC HLS; source PTS retained → shared sound and muted pictures | Recorder encode; FFmpeg video/audio adaptation; group audio decode/encode; receiver decode | Publisher recorder; Core publication's single live-stream encoder/temp files; audio worker group |
| Buffered single-viewer fallback | Same retained HLS → native/HLS receiver media | Shared recording/adaptation plus receiver decode; no extra group encoder | Publication HLS and receiver load |
| WebRTC capture | Original captured tracks → peers; each receiver's local A/V clock | Publisher/browser codec per peer; receiver decode | Publisher/receiver peer generation, Core signaling consent, retained TURN helper |
| mpv | Encoded selected channels → native output and media position | mpv decode; optional existing processing | Host-only mpv generation/helper lease |

Core still forwards authenticated sockets to the audio worker. CPU-heavy encode,
clock and crypto work is isolated; a blocked Core can still delay socket bytes.
The 100 ms stall fixture demonstrated this boundary with 1–8 late packets per run and no
retimed audience deadline. That limitation is not a physical latency result.
