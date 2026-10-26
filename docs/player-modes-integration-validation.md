# Player modes integration validation

Software integration, retirement and review are complete and ready for PR
submission. Physical Live qualification remains open. This receipt covers checked
code/tests head `bd25f9ad4966271859b9ed67a0840ede3f83e925` over current-main base
`4a194e35cedb30f5ba3e664b4c9734b087051825`; subsequent handoff edits are documentation
only. [The ledger](player-modes-integration-ledger.md) maps every P0–P7 package,
M1–M11 responsibility, all 17 use cases and each retirement to this evidence.

## Fresh software checks

Runtime: Bun **1.4.2**, Node **24.21.0**, Electron **44.4.5**, FFmpeg **9.0.2**,
Go **1.27.2**; real offline yt-dlp selector **2026.10.21**, downloaded from its
official platform ZIP and verified against GitHub's asset SHA-256.

Every stack layer separately passes `bun install --frozen-lockfile`,
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
| Source inventory and retirement | **213 exact unique paths; 103 retain / 65 adapt / 45 exclude** | Original 131-path set union later 112-path set, 30 overlaps. All excluded paths absent. No native audience/output or playback-helper dependency remains. |

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

## Real browser and packaged paths

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

## Packaging and manual CI

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

## Independent reviews and causal controls

Fresh GPT-6.1 Sol xhigh/default independent reviews compare fixed
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
these scratch receipts add fresh integration evidence.

## Exact qualification limits

The available Apple Silicon Mac is macOS **14.8.7**, with UMC404HD input visible
at **48 kHz / 512 HAL frames**. The signed app's native input attempt reports
**“Turn on Couch in Microphone.”** Preflight and actionable retry are recorded;
capture never opens, and settings are restored. Native PortAudio capture through
the packaged app therefore cannot be qualified without that OS microphone grant.
The smallest remaining check is granting this same signed app access, selecting
the existing interface and verifying actual stereo capture, rate/buffer readback,
upload/Stop/Close/Quit and browser Opus on the matched package.

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
Earlier `f07fe9f` receipts also cover Leave/rejoin. Generated ingress does not substitute
for the denied native input. The default **100 ms lead / 70 ms
receiver budget** refuses the measured Linux software route requiring **141 ms**
(`mac-opus-default-admission.json`). Defaults remain conservative source policy,
not a promise that every output can meet them; the available larger lead works.

Unqualified: ≤100 ms physical input-to-ear, numerical physical skew/dropout/
fidelity profile, 50 physical receivers, real Wi-Fi phone/background/locked states,
Bluetooth routes, a real Apple AirPlay sender, native 44.1 kHz hardware capture
and Intel Ventura installation/playback/capture/update. Those need the named
device/permission and a bounded physical witness. Software capture coherence,
API readiness, synthetic scale, cross-compilation and historical subjective
listening do not establish these claims. They limit Live support/release
qualification; they do not block opening the reviewable integration PRs.


## Handoff cleanup

Owned sources are ended before quitting scratch apps; rate/lead settings used by
software probes are restored. Packaged hidden capture's source/helper disappears
before app shutdown. Native lifecycle receipts assert capture stops before Core
and all recorded PIDs/listeners disappear. Final parent cleanup audits exact owned
scratch process environments, stops the owned Mac Main and SSH tunnel, and closes
owned incognito preview tabs. The installed Couch, its data, personal browser
profiles, original investigation worktrees and recovery archive are preserved.
