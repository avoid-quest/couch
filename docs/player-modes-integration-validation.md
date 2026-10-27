> Historical record. The 2026-10-27 [upstream Sendspin baseline](live-audio.md)
> supersedes custom Live-engine decisions, SDK patches, admission rules and
> performance gates below. Those historical results do not measure this baseline.

# Player modes integration validation

This is a historical record of the Sendspin Live implementation. Its Live
performance gate and SDK work are superseded by [Live audio](live-audio.md);
the evidence below applies only to the revisions it names.

**Integration completion and PR submission remain pending.** The reopened
[Live performance gate](live-audio.md) requires the corrected
roughly 50 ms reference, and the [Mac host capture comparison](player-modes-host-capture-comparison.md)
is complete with no useful repeatable native advantage established. Available
software/package checks and independent reviews pass; the remaining readiness
blocker is measured Live performance/fidelity, not an unfinished implementation
or concealed test failure. This document records evidence by tested revision.
It makes no current PR-ready verdict.

[The ledger](player-modes-integration-ledger.md) maps P0–P7, M1–M11, all 17 use
cases and retirements. The current recovered-file inventory is **213 unique
paths: 103 retain / 67 adapt / 43 exclude**. Browser-compatible Live PCM is
retained alongside Opus; native audience/output helpers remain excluded.

## Final available checks after resume

Checked source: `394f17ff0589f5cfc92f29439d55a15bc4617b09`, over
`4a194e35cedb30f5ba3e664b4c9734b087051825`. Later result/handoff changes are
only documentation. Core `0ff37ef`, Browser `01f8996`, Host `c42383a` and this
Validation source each independently pass frozen Bun 1.4.2 install, all three
TypeScript projects and production build on their intended parent.

| Available check | Result | Evidence and limit |
| --- | --- | --- |
| Separate Bun unit files | **94 files / 707 tests pass** | `resumed-final-units/results.json`; no module-mock cross-file interference. |
| Node integrations | **63 bundles / 559 distinct checks covered, zero failures or uncovered skips** | `resume-20261026/final-software-summary.json` maps every log and exact rerun. |
| AirPlay real prerequisites | **16/16 pass, zero skips** | Newly restored owned Debiantrixie container with real GStreamer and packaged UxPlay; covers all three bare-host skips. No Apple-device sender qualification. |
| Hidden Live Main/Core lifecycle | **Pass** | Current build, official stereo WAV, 17 named steps/14 destroyed helpers; `resumed-final-native/stereo/events.json`. |
| Hosted Check | **Success** | [40328818886](https://github.com/avoid-quest/couch/actions/runs/40328818886), exact source394f17f. |
| Hosted Package | **Linux, Windows and Mac success** | [40328823313](https://github.com/avoid-quest/couch/actions/runs/40328823313); signed arm64/x64 Mac apps/helpers and resource/floor checks. Build/signature checks do not prove Intel Ventura execution. |
| Independent reviews | **No unresolved actionable findings** | Fixed4a194e3...182d132: spec none; standards one P3 stale-ledger finding, corrected in394f17f. Static review only. |
| Disposition/source union | **213 unique rows:103 retain/67 adapt/43 exclude** | Scope/retirement map retained; native audience output stays excluded. |

Parent roots are `.scratch/player-modes/` for resumed unit/Node/native receipts,
and `.scratch/live-performance/resume-20261026/` for layer checks, exact commands,
software summary, physical analysis, package receipt and review reports. Tests
used Node 24.21.0, Bun 1.4.2, FFmpeg9.0.2, Go 1.27.2 and the verified platform
executable yt-dlp2026.10.21. The first broad pass incorrectly pointed
`COUCH_TEST_YT_DLP` at its package directory; one intermediate retry used an
absent basename. The corrected canonical `yt-dlp_linux` path passes all 55
cases, with unchanged source/assertions. Both errors remain in the evidence.
The old AirPlay image was absent after environment changes; rebuilding the
owned runtime restored real coverage without installing host packages.

The downloaded current Linux installer also launches real packaged Main/Core,
serves HTTP 200 and reports clean revision 394f17f through the authenticated Main
bridge. Of 94 maintained build/dist files, 93 match byte for byte; `dist/sw.js`
differs only in precache entry ordering, with identical entry/revision multiset
and identical surrounding code. Current signed Mac main/preload/audio-worker and
capture HTML are byte-identical to the a30218d base used in the calibrated test.
Package hashes, exact comparison and startup receipts are retained locally.

Workflow/package/resource code is unchanged from the paths already proven by
`act` on `catthehacker/ubuntu:full-latest` at bd25f9a; the exact diff is empty.
Manual Check/Package dispatches produced no PR, merge or release.

The calibrated host comparison is complete, with all four 60 s witnesses valid,
zero witness overloads and gapless ingress. Its higher55 ms diagnostic policy
produces Chromium medians57.833/57.455 ms and native56.647/57.268 ms. All fail the
unchanged50 ms/fidelity gate; native has no useful repeatable advantage established.
The [host result](player-modes-host-capture-comparison.md) records raw identities,
clock/observer/signature limits, source/return levels, bad windows and cleanup.
**These software/package passes do not close Live performance or authorize PR
submission.** Native remains an explicit candidate without automatic preference.

## Reopened source and package evidence

The `bd25f9ad4966271859b9ed67a0840ede3f83e925` software/package/review checkpoint
below remains useful on base `4a194e35cedb30f5ba3e664b4c9734b087051825`.
Later source changes restore PCM and low-lead settings and add bounded signaling;
the earlier 688 unit tests / 533 Node checks and zero actionable review findings
are not final-source receipts.

- Core emits immediate normalized **S16 stereo PCM, at most 240 frames per
  packet**, independently of Opus's **10 ms** packets and FFmpeg lookup. Each
  format has independent bounded fanout; source continuity and Opus remain.
- Host lead choices are **45/50/55/75/95/100/150/250 ms**, default **100 ms** with
  **70 ms** receiver budget. Source reserve is **20 ms through 55 ms**, **25 ms
  below 100 ms**, **30 ms otherwise**; 45 ms therefore allows a strict 25 ms
  receiver budget. PCM capacity is **65,536 bytes**; Opus is **4,096 bytes**.
  Identity, preparation, clock, timing and correction admission remain strict.
- The maintained browser remains **Opus-first and prepares Opus**. Diagnostic PCM
  results do not change the product's codec selection or establish qualification.
- `.scratch/live-performance/integrated-focused-summary.json` retains initial
  `ef7a5c2` failures and green focused reruns after obsolete Opus-only settings
  and scheduled-capture expectations were repaired. These focused results do
  retain their original revision limits; final resumed coverage is reported above.
- Signed source **`a30218d00e8bdfb6116cf10ed61d357f08781988`** has successful manual
  [Check 40309187171](https://github.com/avoid-quest/couch/actions/runs/40309187171)
  and [Package 40309189960](https://github.com/avoid-quest/couch/actions/runs/40309189960):
  Linux, Windows and dual-architecture Mac all passed. Exact logs are
  `.scratch/live-performance/ci-{check,package}-a302.log`. These results apply to
  `a30218d`, before the later signaling/runtime work.
- Package pins: `.scratch/live-performance/package-a302-linux/pins.json` records
  executable SHA-256 `ee9faf5bb9fe78a750cc5099863c85c4459e7f04c387fd1f111c83e4e8c57c97`
  and ASAR `921cdd14bac9ee7b2560f39a8e1ac8b4103c0f0c8872ba0349af16e4f59b482f`.
  `candidate-a302-mac.json` records signed arm64 ZIP SHA-256
  `464f9450e01b0eaac986e0ac703d53567b98bb90dedb6130adde32aa463e79dd`
  and ASAR `91ae354cabf1ef4ce4e3507afe63d7eef4dc46b82ec903293720060457aa206c`.
  Exact resources/signature receipts stay beside those packages.

Older-work carryovers are separately traceable: Browser `421ad77` (parent
`bf2d797`) bounds four unsettled offer operations with 100 ms spacing, retaining
slots until promises settle after cancellation. Core `daeea11` (parent
`3e41052`) carries separately bounded authenticated signaling/pair retry and
permission-safe per-flush level reuse. After the parent's stack movement their
owning heads are Browser `f8dc71c` and Core `7aee1ba`. Core `1420ebe` (integrated at `7aee1ba`) also fixes both Live-input gaps:
unchanged-volume suppression and coalesced publisher peer lists. Their 33 focused
checks pass; the final 56-case Live-output suite passes after `0ff37ef` waits for
the other receiver's asynchronous state before its unchanged exact-membership
assertion. Older-work dispositions are recorded in the child runtime audit. None of these carryovers inherits the `bd25f9a` review verdict.

## Resumed software checkpoint

Owner resumed execution after environment updates. Fixed comparison
`4a194e35cedb30f5ba3e664b4c9734b087051825...182d1329012b49db1e3d75e6da9d27ede4588e0b`
has a fresh static spec review with no actionable findings and a fresh standards
review with one P3 documentation finding: the ledger and this receipt called
landed carryovers absent or underway. These entries now describe the integrated
source and keep pending verification separate. No additional actionable standards
or code-smell finding was established. Reports are retained under parent
`.scratch/live-performance/resume-20261026/review-{spec,standards}-r3.md`.

The retained Live-output regression reproduced in 0.6 s on the resumed checkout.
It read another socket's prior output state immediately after the joining
receiver's load. Core `0ff37ef` adds a bounded wait for that other receiver's
two-output state while preserving the exact membership assertion. No production
behavior changed. The complete 56-case suite passes, zero skips; red and green
receipts remain in `.scratch/player-modes/resume-peer-list/`.

## Physical and diagnostic evidence

All rows retain their original source, route, harness and gain limits. The earlier
Electron receiver runs do not answer the required ordinary-Chromium host A/B.

| Interval | Observed result | Qualification |
| --- | --- | --- |
| Historical browser PCM r15, 45 ms lead | 55/55 windows both channels; median about **48.543 ms**, zero waveform flags | Passing interval; reliability unqualified |
| Historical r16 repeat | 46/55 windows both; 4,747 / 4,727 waveform flags | Failed repeat retained beside r15 |
| Maintained signed `bd25f9a`, Opus / 100 ms | 55/55 both; median **102.4696 ms** | Fails the **50 ms** gate |
| Corrected short-URL SDK PCM / 45 ms | 55/55 both; median **47.070 ms**, **32 waveform flags** | Diagnostic only; unqualified |
| Corrected short-URL SDK Opus / 45 ms, r3 | **45/55 L, 44/55 R**; accepted-window medians **46.424 / 46.439 ms**; many correlation/gain flags | Fails coverage; unqualified |

Receipts are under `.scratch/live-performance/`: `replay-r15/`, `replay-r16/`,
`maintained-r2/evaluation/`, `compare-sdk-short-pcm45-r1/evaluation/` and
`compare-sdk-short-opus45-r3/evaluation/`. The original diagnostic embedded a
roughly **1.75 MB data URL**, causing CDP overhead and harness failure. The URL-only
control restored sustained output without a product change;
`harness-diagnosis/url-control.json` and `independent-review.md` retain causal
and review evidence. Failed harness intervals remain evidence of that setup,
not proof of a product codec failure.

Low signal levels limit interpretation of these codec runs: the retained PCM
source/return peaks were near −33/−68 dBFS. On 26 October the owner accepted
**gain-meter-r1**, a direct analog calibration bypassing Couch: source peaks
−11.84/−11.83 dBFS, return −23.06/−23.13 dBFS, L/R within 0.1 dB, with no clipped
samples or dropped callbacks over the last 100 meter intervals. The owner set
the UMC gains; keep them fixed. This new calibration does not retroactively
qualify earlier waveforms. The prior receiver was **80%, unmuted**; SDK and Linux
Master contributed about −2.91 dB and −12 dB respectively. Check actual source
and return levels through Couch before scoring a new run.

## Parent-owned completion markers

- **G3 — final source:** all available final checks, package proof and fresh
  independent reviews pass at the revisions above. Preserve original failures
  and corrected reruns. The roughly 50 ms/fidelity result remains the readiness blocker.
- **G4 — native adoption:** bounded ordinary-Chrome comparison and confirmation
  pair are complete. Native has not earned a preferred/default role; physical
  performance remains unqualified. Use supported public browser APIs, the fixed Linux
  route, gain preflight, one valid matched pair and at most one confirmation
  pair. Keep actual Core ingress age/jitter/gaps separate from the coherent
  physical witness. Uploader send events are not Core receipt; a diagnostic
  overlay needs its exact diff, hashes and signature limits beside both arms.
  A common diagnostic lead does not waive the roughly 50 ms reference. The
  [host comparison](player-modes-host-capture-comparison.md) owns the latest result.
- **G5 — carryovers/runtime:** all identified source guarantees are integrated,
  with focused red/green evidence. Final accounting and current checks/reviews are reconciled in the ledger;
  there are no known unimplemented Live-input carryovers.
- **Handoff:** final branch/remote heads, ancestry, cleanup and exact remaining
  readiness blockers are recorded in the PR handoff and final push receipt. PR submission, merges and releases remain
  pending. No physical/backend outcome is inferred from this documentation edit.

## Historical software checks at bd25f9a

Runtime: Bun **1.4.2**, Node **24.21.0**, Electron **44.4.5**, FFmpeg **9.0.2**,
Go **1.27.2**; real offline yt-dlp selector **2026.10.21**, downloaded from its
official platform ZIP and verified against GitHub's asset SHA-256.

At that checkpoint, every stack layer separately passed `bun install --frozen-lockfile`,
`bun run typecheck` (all three projects) and `bun run build` on its intended
parent. The checked heads are Core `1b07af3`, Browser `2ccb203`, Host `bc02df3`
and Validation `bd25f9a`. Frontend, Main, Core and audio worker build together.

| Check | Result | Scope and receipt |
| --- | --- | --- |
| Unit files, each in a separate Bun process | **92 files / 688 tests pass** | Entire maintained unit suite; `final-r2-units/results.json`. |
| Node behavior integrations | **59 bundles; 533 distinct checks covered, zero failures** | Routing/consent, Direct isolation/Move, rendition/quality/protected bytes, independent groups, audience/Remote/Stop-Undo, capture/Opus admission/deadlines/continuity/queues/scale, retained A/V/ICE/STUN/TURN, mpv/DSP/output and helper lifecycle; `final-r2-all/results.json`. |
| Real AirPlay prerequisites | **16/16 pass, zero skips** | Final package's UxPlay plus real GStreamer in owned `couch-airplay-test:trixie`; `final-r2-airplay.log`. This covers the three bare-host skips in the 59-bundle run. It is not an Apple-device sender test. |
| Managed helper lifecycle | **38/38 helper updates; 22/22 recovery** | Real worker HTTP requests, concurrent leases, cancellation/failure/close, next-version selection and unresolved acquisition during shutdown. No production URL-admission relaxation. |
| Final hidden Live native check | **Pass** | Real Main/Core/preload/hidden renderer; stereo Chromium WAV input, 17 named steps, 14 destroyed helpers; `final-r2-native/stereo/events.json`. |
| Other desktop native checks | **All four pass** | Renderer status, capture consent, ordinary live-close and app-quit; child receipt below. Ordinary minimize/Close needs a WM; scratch-only extracted Openbox supplied it. |

Parent scratch root, relative to the assigned checkout, is `.scratch/player-modes/`.
`final-r2-summary.json` retains counts; `layer-builds-r2/results.json` retains
commands, exact heads, exit codes and durations. The integration runner bundles
each file with `bun build tests/<name>.integration.ts --target=node --outfile=…`
and runs `node --test <bundle>` in a separate process. Its final invocation uses
`COUCH_TEST_STOP=1`, `COUCH_TEST_YT_DLP=<verified platform executable>`,
`COUCH_TEST_FFMPEG=<verified FFmpeg>` and Go 1.27.2 on PATH. All Couch runs use
owned data directories/ports. The bare-host first pass is explicitly **530 pass /
3 skip**; the real AirPlay rerun covers those three, rather than counting skips
as passes. `final-r2-airplay.log` records the container command's result.

Earlier integrated failures are retained: helper-updates used parent-process
fetch mocks that never observed worker HTTP requests; its replacement reaches
the real boundary and exposes the lease bug. Helper-recovery's response mock
omitted `socket.remoteAddress`; untouched main reproduces that failure. The
test-only fixture repair preserves the original URL-rejection assertion.
Initial TURN testing lacked Go on PATH; the final allocation/revocation run
passes **7/7** with Go available. Initial native live-close under bare Xvfb
lacked window-manager minimize behavior; its Openbox retry passes unchanged
product source. These are resolved failures, not remaining prerequisites.

## Historical browser and packaged paths

- Direct: two actual H264/AAC browser decoders had independent queues; exclusive
  Move retained the Playback ID, two-entry queue and paused **37.240293 s**
  position. Radio subscriptions and eight desktop keyboard checks passed.
  Receipt: `browser-receipts/core-browser.json`, source `9e869de` before final
  review fixes. Fresh policy/routing/renderer regressions cover the final source.
- Captured video: Core `e5063df` preserves publication-relative PTS across ingest
  restart. Final Node real-media checks pass; independent Chrome 156 checks
  decode buffered H264/AAC fallback after deliberately failed RTC, split and
  picture-only reception, an independent late viewer and recovery after
  re-ingest. Existing picture load stays intact and temporary encoders/segments
  are removed. A separate packaged Chrome WebRTC journey decodes **187 real
  320×180 video frames** from generated canvas input (`package-linux/rtc-receipt.json`,
  source `f07fe9f`). Physical screen capture/A/V alignment is not established.
- Final Linux installer: the actual packaged executable launches Main/Core and
  serves the browser. **All 94 packaged build/dist files match the maintained
  build byte for byte**, including Main, preload, Core and audio worker.
  `package-linux-r2/matched-source.json` records every hash.
- That final package's hidden capture obtains actual **2-channel / 44.1 kHz /
  441-frame blocks** from Chromium's official stereo WAV switch. Core delivers
  Opus to an independent Chrome browser as **2-channel / 48 kHz** decoded audio.
  At **250 ms lead**, output admission is ready; the probe sees nonzero audio,
  **8,106 buffers / 3,890,880 frames**, and continues after Leave/rejoin. Core
  refuses audience pause; own volume reaches 35, source survives Leave, and
  Stop sharing removes its helper target. The capture/settings are stopped and
  restored. Receipts: `package-linux-r2/{browser-opus,rejoin,host-capture,capture-cleanup}.json`.
  Generated input and software output do not measure acoustic timing/fidelity.
- Routed-peer security: an actual Docker peer reaches Core only through its
  exact routed IPv4 allowlist; bad Host/Origin, tokenless private APIs, a different
  peer and disabled sharing are refused. Receipts: `routed-peer-*` at `9e869de`;
  final public-network/proxy/access regressions also pass.

The bounded encrypted 50-client fixture proves software fanout/isolation only.
Native HLS/MPEG-TS picture mapping limitations remain visible; no frame-lock or
new low-latency video engine is claimed.

## Historical packaging and manual CI at bd25f9a

Final Linux Package passes in `act` on `catthehacker/ubuntu:full-latest`, from an
owned clone at `bd25f9a`, before the final manual dispatch. Command:

```sh
act workflow_dispatch -W .github/workflows/package.yml -j package --matrix name:linux \
  -P blacksmith-4vcpu-ubuntu-2404=catthehacker/ubuntu:full-latest \
  --container-architecture linux/amd64 --artifact-server-path <owned artifact directory> \
  --local-repository actions/upload-artifact@v7=<owned upload-artifact-v4 clone>
```

`act-package-r2.log` records success and unpublished AppImage/deb artifacts.
The v4 substitution is only act's artifact-server workaround, as documented in
[CI](ci.md). Earlier act Check/Package receipts at `f07fe9f` also pass. An initial
final act start still referenced the pre-rebase scratch clone; it was interrupted
before use, the owned clone was reset to the checked head, and the complete
successful final run uses `bd25f9a`.

Manual dispatches use `--ref player-modes/validation-20261026` at `bd25f9a`:

- [Check 40252513414](https://github.com/avoid-quest/couch/actions/runs/40252513414): **success**.
- [Package 40252515791](https://github.com/avoid-quest/couch/actions/runs/40252515791): **Linux, Windows and Mac all success**.

Mac Package builds **arm64 and x64** together, compiles static PortAudio/capture,
QuickJS and relay for their target architectures, preserves Mac floors and the
combined update feed, and verifies both signed app bundles and capture/QuickJS
helpers. Existing Couch Releases signing identity is retained. Cross-build and
signature checks do not establish Intel Ventura execution or hardware capture.
No release workflow, merge or PR submission was performed.

## Historical independent reviews and causal controls at bd25f9a

The checkpoint's GPT-6.1 Sol xhigh/default independent reviews compared fixed
`4a194e3...bd25f9a`. **Spec: zero actionable findings. Standards: zero actionable
findings.** Standards independently reran two mocked UI checks. Reviews are
source/coverage reviews, not independent full runtime qualification.

Round 1 findings are resolved in their owning layers: Details queue rights
(`2ccb203`), explicit Live input readiness (`bc02df3`), and per-operation managed
FFmpeg ownership (`1b07af3`). The informational RowMenu label-filter concern had
no demonstrated incorrect behavior and did not warrant an action taxonomy.

Meaningful controls fail as expected: removing the R4 timestamp offset resets
PTS; omitting capture's helper release retains the old executable; omitting
fallback URL admission bypasses rejection; broadening the delegated microphone
frame grant gives an unrelated window access; removing Main's Close stop while
withholding the owner notification leaves hidden capture alive. Generated builds
are restored after controls. Earlier scheduler controls also catch late-join,
continuity/prewarm and retained-queue regressions.

Detailed child receipts remain at these assigned child checkouts:

| Concern | Worktree suffix / scratch receipt |
| --- | --- |
| Host helper build/architecture/signatures/C queue | `t3-de182373/.scratch/host/handoff.md` |
| Scheduled correctness and negative controls | `t3-71b70af4/.scratch/player-modes/checks/receipt.json` |
| Real R4 media/browser/negative control | `t3-7e809d6c/.scratch/player-modes/r4/receipt.md` |
| Five native checks / exact WM setup and cleanup / controls | `t3-7f0a2ea8/.scratch/native-lifecycle/handoff.md` |
| Helper leases/recovery/baseline/controls | `t3-6cc64284/.scratch/helper-lifecycle/receipt.json` |
| Final spec review | `t3-ddfb6e11/.scratch/player-modes/review-bd25f9a-spec-r2.md` |
| Final standards review | `t3-5a48c68e/.scratch/player-modes/review-bd25f9a-standards-r2.md` |

All suffixes are below `/home/avoid/.t3/worktrees/couch/`. Tracked historical
documents and the immutable recovery ref retain the source/evidence provenance;
these scratch receipts add checkpoint integration evidence.

## Historical native capture receipts and qualification limits

The available Apple Silicon Mac is macOS **14.8.7**, with UMC404HD input visible
at **48 kHz / 512 HAL frames**. The first signed-app attempts reported
**“Turn on Couch in Microphone.”** After the owner granted access on 26 October,
restarting the same signed app made its permission check pass. Native capture
then opened at **48 kHz / 2 channels**, with **512 requested / 512 reported HAL
frames**, through the maintained Main/preload publication path.

The matched `bd25f9a` signed package delivered this actual native input through
Core's **Opus** stream to independent Linux Chrome over the owned SSH tunnel at
**250 ms lead**. The browser witness recorded **14,436 scheduled buffers /
6,929,280 frames**, 2 channels / 48 kHz, ready admission, playing state and no
reported player error. Core refused audience Pause and accepted the listener's
own volume change. Leave retained the publication; rejoin produced **703 more
buffers**. The input was uncontrolled and near its noise floor (channel peaks
about **0.000032 / 0.000031**); this establishes capture and delivery, not stereo
identity, audibility, fidelity or physical latency.

Stop ended the native helper with exit **0**, `captureError: 0`, **28,820 callbacks /
14,755,840 frames**, 512-frame callbacks and zero observed callback flags. Four
ADC timestamp-deviation events reached **14.726 frames**; these counters are not
a calibrated physical drift/dropout measurement. Owner-page closure also stopped
capture and terminated Main; this CDP action does not establish the normal Mac
title-bar Close/background behavior. Explicit Quit during a fresh prepared native
capture stopped its helper, Main and Core. Final discovery still reported
**48 kHz / 512 HAL frames**. Scratch lead and network sharing returned to their
observed **100 ms / off** values; scratch input preferences returned to defaults.
Receipts are under `.scratch/player-modes/microphone-grant/`: `start.json`,
`browser.json`, `stop.json`, `capture-session.log`, `explicit-quit.json` and
`final-cleanup.log`. Ordinary Close/background behavior retains the separate
five-check desktop lifecycle evidence above.

Final signed Mac Main/Core at **`bd25f9a`** also delivers generated stereo PCM
as decoded stereo Opus to Linux Chrome through an owned SSH tunnel at **250 ms
lead**. The fresh probe records **2,547 buffers / 1,222,560 frames**, nonzero
2-channel / 48 kHz audio, ready admission and restricted audience controls;
`mac-r2-opus.json` retains that result. Its ZIP hash is
`40a9257a383835397e9320a83913213d4bf40ee8576259d8694c464c650c95cd`
on both machines; local Mac strict signatures and device discovery pass. Final Leave/rejoin produces **490 additional decoded buffers**, with source
survival witnessed at Leave; the generated source then ends at its 90-second
bound. `mac-r2-rejoin.json` and `mac-r2-source-cleanup.json` record that result,
**8,999 uploaded packets / zero source errors**, restored settings and shutdown.
Earlier `f07fe9f` receipts also cover Leave/rejoin. This generated-ingress receipt
is separate from the later successful native-input check. The default **100 ms lead / 70 ms
receiver budget** refuses the measured Linux software route requiring **141 ms**
(`mac-opus-default-admission.json`). Defaults remain conservative source policy,
not a promise that every output can meet them; the available larger lead works.

Unqualified: the corrected roughly 50 ms physical input-to-ear capability,
numerical physical skew/dropout/fidelity profile, 50 physical receivers, real Wi-Fi phone/background/locked states,
Bluetooth routes, a real Apple AirPlay sender, native 44.1 kHz hardware capture
and Intel Ventura installation/playback/capture/update. Those need the named
devices and a bounded physical witness with a known stimulus. Software capture coherence,
API readiness, synthetic scale, cross-compilation and historical subjective
listening do not establish these claims. They limit Live support/release
qualification. The reopened Live and Mac host comparison gates, final checks
keeps integration completion and PR submission pending; current software/package
checks and fresh reviews are separately complete.


## Historical handoff cleanup

Owned sources are ended before quitting scratch apps; rate/lead settings used by
software probes are restored. Packaged hidden capture's source/helper disappears
before app shutdown. Native lifecycle receipts assert capture stops before Core
and all recorded PIDs/listeners disappear. Final parent cleanup audits exact owned
scratch process environments, stops the owned Mac Main and SSH tunnel, and closes
owned incognito preview tabs. Original investigation worktrees, recovery archive,
installed app bundle and personal browser profiles are preserved.

The microphone-grant follow-up has one isolation exception. After CDP `Page.close`
terminated the owned app, a plain LaunchServices reopen omitted `COUCH_DATA_DIR`
and `COUCH_PORT`, briefly starting the signed scratch bundle against the default
Couch profile. The verified owned PID **44722** was stopped, and subsequent tests
used the recorded scratch environment. A read-only metadata audit found **85
modified files** during that interval: Chromium state/cache plus `couch.sqlite`,
`renderer-status.json`, `window-state.json`, `logs/couch.log`, `tls/cert.pem` and
`helpers/status.json`. The TLS private key and operating-mode file predate the
incident. No prelaunch snapshot exists, so unchanged database contents cannot be
asserted and no guessed restoration/deletion was performed. The audit is
`microphone-grant/default-data-audit.json`. That follow-up recorded all its
owned app/helper processes, listeners, browser tabs and SSH tunnel stopped. The later
calibrated campaign has a separate current cleanup receipt under
`resume-20261026/`: test resources/signatures restored, device 48 kHz / 512 frames,
all owned Mac/Chrome/Pulse/Xvfb/witness processes stopped.
