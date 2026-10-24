# Playback refactor validation and retirement

Implementation starts from `59ac6cd6a510ca96bf60dfc9a3628cc635be22e1`, exactly the audited baseline, on `refactor/couch-playback`. The checkout was clean. Planning documents were copied from the assigned research worktree before delegation; experimental source changes were not copied.

Current assembly status: **software suites pass; physical startup qualification
failed and its cause is under bounded software diagnosis**.
Implementation commit: `5a18b8c4ebb80a8fa64e864ba533afae49b64e08`. The final candidate
(`Hub 86e813c8…`) passes typecheck/build and R6's 39 scoped routing cases. Its
55-suite integration evidence has 491 tests: 488 pass and three AirPlay prerequisite
skips, after rerunning the corrected 56-case live-output suite. Causal tracing
attributes the earlier startup failure to the
fixture's PCM-only encoder starting without a connected PCM receiver; the prior
bundle's apparent pass had no audio packets. The corrected fixture connects its
receiver before format selection and requires real packets as well as playing
state. R7 independently clears that correction, including real late PCM and Opus
admission and a failing consent-bypass control. Hub is unchanged. The updated Linux
package and extracted-ASAR worker checks pass. A 31.088-second partial physical
recording is preserved; no subsequent physical stages ran. No merge or release
has occurred.

## Baseline before product edits

Pinned Bun 1.4.2 (`node_modules/.bin/bun`), Node 24.21.0, Linux x64. Frozen install, typecheck and build passed. Each of the 75 Bun test files passed in a separate process. A combined `bun test` run had 422 passes, 15 failures and 12 errors from cross-file module mocks; it is not the reliable test invocation for this repository.

Thirty-one affected Node integration suites were bundled against the unchanged source. The first run had 28 successful suite exits, two failures and one helper-download timeout. Some suites skipped real media because FFmpeg was absent from PATH. After isolating the test-downloaded helper and adding FFmpeg 9.0.2 to the test PATH, the frozen device-sharing, live-input and live-delivery bundles passed all 51 tests. Frozen live-clock, live-stream, sendspin-ahead and compressor-sendspin passed all 14 tests without skips, including Opus and PCM. These are software/fixture checks, not physical timing measurements. Other native/helper prerequisite skips remain gaps until rerun.

Raw baseline commands, per-suite logs and machine-readable results are retained in `.scratch/playback-baseline` in the implementation checkout. Scratch helpers and data are isolated there or in test-owned temporary directories; the installed Couch and its data were not used.

## Story coverage

Implementation and verification are separate. The matrix records current software
evidence; the remaining review and physical checks are listed below.

| Stories / acceptance | Implemented behavior | Evidence / disposition |
| --- | --- | --- |
| D1/D2/D5 independent and remote Direct | Independent queues and permitted destinations; controller need not receive; select rendition before relay/probing and avoid unused video. | Device-sharing, remote-queue, server-selection, history and output suites; source/renderer tests, real Hub request counters and 55 real offline yt-dlp tests. Actual hls.js preserves Italian and its menu with zero sound-only video requests. |
| D3/D6 move versus join | Play on isolates its destination; Move here transfers the existing Playback/queue and rechecks consent after preparation; adding outputs retains the others. | Consent/routing/handoff tests; real TV keyboard menu moved Playback with queue, position 10 and speed 1.5 intact. Fixture destination is a socket, not a physical TV. One live listener remains scheduled. |
| D4 captured viewing | WebRTC, selective tracks and isolated buffered fallback remain. | Live input/delivery/outputs/channels/ICE/STUN/provisioning and consent suites. Buffered browser re-entry passes; this refactor has no new actual WebRTC-decoder receiving evidence. |
| R1/R3/R7 shared programmes | Shared clock for outputs spanning devices; one URL decode per Playback and encode per required wire; independent groups and collaborative controls. | Opus/PCM clocks, send-ahead, compressor, handoff and controls tests. Selected HLS language survives Direct/group takeover, seek/rate restart, collapse and Next isolation; actual decoded tone checks cover VOD, broadcast and muxed input. |
| R2 split picture/sound | Common timeline, picture-only timer and sound-only selection; hardware correction remains distinct from content offset. | Split routing, timeline, delay and renderer checks. Native HLS/MPEG-TS follows play/pause/rate and reports unavailable source mapping; those decoder boundaries are stubbed in tests. No physical presentation-alignment claim. |
| R4 relaxed screen sharing | Retain shared recorder HLS, mapped picture follower and isolated fallback. | Upload, stream, clock and six real-media live-latency checks pass. Actual captured WebM upload → rolling HLS → browser hls.js/group clock passes pause/resume, buffered re-entry and cleanup with 119 new nonzero software PCM packets. RTC fallback decoding, independent late third viewer, absolute position continuity across re-ingest and physical A/V alignment remain unverified. |
| R5/R6 AirPlay and relaxed capture | Timestamped PCM enters scheduled module at every listener count; redundant audio-only HLS removed for supported adapters. | Capture upload/lifecycle checks; AirPlay has 13 passes and 3 explicit missing GStreamer/UxPlay prerequisite skips; unavailable-host takeover regression repaired. Unsupported relaxed publishers retain compatibility. |
| L1 capture → Opus → receiver | Timestamped stereo host capture, bounded source normalization, 10 ms Opus and fixed deadlines. | Source drift/gap/reset tests and real encoder/worker tests pass. Native fake-file capture → production upload → prepared browser decoded 49,440 stereo frames, with no MediaRecorder or reported errors. Actual Mac/Behringer startup qualification failed; sparse electrical matches do not qualify the complete physical path. |
| L2/L4 joins and recovery | Decoder/clock/output admission; fixed format and deadlines; incompatible receiver isolated; route changes re-admit. | 50 encrypted software clients receive shared Opus; PCM-only and one-byte-buffer clients refuse independently. A 100 ms Hub stall preserves the deadline grid but causes late network packets (1–8 in recorded runs). Receiver readiness regressions pass. These are not 50 browser decoders or physical outputs. |
| L3 audience authority | Join/Leave and own volume; programme/queue/seek/speed/delays denied, including crafted/legacy/REST. | Real Hub audience tests and UI entry-point tests; phone Join/Leave/volume journey. Publisher source end remains separate. |
| All: lifecycle | Load/publication generations, source ownership, newest tab, consent, Stop/Undo, restart and disposal. | Lifecycle/consent suites, native close/reopen and packaged worker cleanup pass. Stale preparation success and failure share the same guard; its reproduced overlap regression passes. Final scoped independent reviews are clear. |
| All: access/output | Protected relays, Range, source authorization, Sendspin identity and isolation, native preflight, local volume and optional URL compression remain. | Relay/proxy, capture consent, audience/isolation, volume and compressor suites; real TURN allocation/revocation 7/7. Physical Bluetooth and hardware route changes remain unqualified. |
| All: distribution/docs | Bundled audio worker and maintained pinned client/server SDK patches; no new native capture helper. | Frozen install, typecheck/build, final Linux act Package and extracted-ASAR worker lifecycle pass against the frozen product hashes below. Built-state docs and M1–M11 accounting are updated. |

## Validation receipts

The unchanged baseline is described above. Integrated checks use pinned Bun 1.4.2,
Node 24.21.0 and isolated data/ports; one Bun file per process.

- Final independent-process Bun sweep: 83 files, 592 cases pass, zero failures.
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
- The current 55-suite evidence totals 491 tests: 488 pass, zero failures or
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
  comments per bundle. This final run includes stale-preparation isolation,
  compressor edits, pending transport/Next preservation and replacement of retired
  cached preparations. Local artifact SHA-256:
  `13ed80143d0d88c5973b55841cb502da2caff5e96b79e4e2d507879e12d68ae8`.

Detailed logs and reproducible fixture scripts are in `.scratch/playback-refactor`;
UI screenshots and journey notes are in `ui-browser`. These local receipts are
not shipped product assets. Native cleanup events are in
`native-release-candidate-live-close/events.json` and
`native-final-capture-consent-fixed/events.json`; product stereo decoding is in
`product-audio/final/result.json`. Final packaging receipts are
`act-package-final.log`, `package-inputs-final.json`, `packaged-final-receipt.json`,
`packaged-final-asar.json`, `packaged-final-worker-result.json` and
`packaged-final-build-comparison.json`. Typecheck/build logs are
`typecheck-final.log` and `build-final.log`.

The fake-input browser and native lifecycle receipts precede the last ordinary
URL group-preparation corrections. Their capture, renderer and worker modules are
unchanged; those receipts are not a rerun of every native journey on the final Hub.
The extracted-package worker check uses the final Hub/package identities below.

The final package's source manifest has SHA-256
`ba8da54d73c7cb4ff1c5205dc5ea20597741c607b7b47850dd964dbbd989239c`;
it inventories 784 inputs. Its Hub source is
`86e813c825ff6fd35192cef0b97cb1532e2057932a034a8417747caf493bf06f`.
Later ledger or test-only edits do not change the packaged product inputs.
Final staging removed one trailing newline from `src/server/audio-packets.ts`.
Rebuilding with the same release identity produces byte-identical Core and audio
worker bundles; the package manifest retains its original source hash. Both source
hashes and the unchanged runtime hashes are in `final-source-whitespace.json`.

## Remaining qualification and verification

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
are software results; this revision has not yet been packaged or physically tested.

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
Mac/Behringer protocol prospectively specifies 60 s startup, 60 s leave/rejoin and
610 s sustained acquisitions (600 s stimulus), with the unchanged 100 ms sender
lead and existing evaluator. These diagnostics do not themselves establish a
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
