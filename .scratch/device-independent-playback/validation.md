## Current boundary continuation — 2026-09-27

[Boundary qualification](boundaries-2026-09-27.md) supersedes the missing actual
browser/group, provisioned external-peer, trusted HTTPS browser and decoder/client
cost checks below. It records source revisions, the final exact gate path, test
environment fixes, and external blockers with next actions. Earlier receipts remain
historical evidence for their stated revisions and scopes.

## Previous client-first integration — 2026-09-27

Integrated Sendspin host/client revision `07f91ecf`: typecheck and production build
pass. Full suite: 1,804 core tests and three clock tests pass, ten core tests skip,
zero failures. A real compiled arm64 macOS Core enrolled and connected the official
SDK over AES-GCM; all 58 embedded assets matched `dist` byte for byte. Receipts:
`.artifacts/sendspin-integrated-build`. This does not qualify Linux packaging.

Linux exact-revision `bun run verify --remote` at clean `07f91ecf` also passes with
an eligible receipt: 1,810 core tests plus three clock tests pass, four opt-in/platform
tests skip, production build passes and 25 compiled WebKit browser checks pass.
Receipt/logs/screenshots: `.artifacts/sendspin-integrated-verify`. The standard
`test:linux --built-remote` journey separately passed at that revision. An initial
verify-wrapper attempt incorrectly exported TV presentation before tests, causing
two expected-mode failures; its ineligible receipt remains as `fixture-env-failure.*`.
The corrected environment passed without application changes. This is compiled
browser qualification, not physical speakers or new native-platform qualification.

The active implementation uses `@sonn-audio/node-sendspin` 0.6.2 inside Bun and
official `@sendspin/sendspin-js` 5.0.0 in the client. Four real protocol/PCM tests,
five hub enrollment tests and five identity-store tests cover admission, durable
PSKs, ownership, revocation, sharing disable, command routing and sustained PCM.
Actual browser qualification caught and fixed integer microsecond timestamps and
the enrollment payload; existing clock tests caught and fixed context churn.

Two actual official SDK Web Audio graphs passed 15 seconds of sustained playback,
pause, seek to 30 seconds at 1.25× and Stop. Separate interruption receipts show
pause/stop graph silence within 53 ms, socket-loss drain within 511 ms and active
Leave closing its AudioContext in 0.2 ms. Sampling was at 10 ms with a 2,048-frame
analysis window. These are software observations, not physical output or speaker
drift measurements. Portable fixture: `tests/linux/sendspin.ts`; receipts:
`.artifacts/sendspin-webaudio`, including `portable-results.json`.

The integrated UI passed This Couch enrollment/Join, direct-renderer withdrawal,
first-member selection, group playback, pause/resume, local volume/mute and Leave.
Leave also worked after Core stopped; restoring the direct endpoint was observed.
Receipt: `ui-results.json` in the same directory. The preview screenshot was stale,
so it is not visual evidence. External-server PIN pairing is implemented through
the SDK but was not independently exercised against another server here.

The production registry/session and real Sendspin host transferred a queue from a
simulated browser endpoint at 32 seconds/1.25× to two actual SDK Web Audio outputs,
then back at 51.3851 seconds after 15 seconds of playback. Queue/speed/checkpoint
were retained, old group observations could not overwrite progress, and both audio
graphs measured zero RMS after return. Receipt: `registry-handoff-results.json`.
This qualifies the measured software group, not actual direct-browser handoff or
physical speakers; the browser edge in this fixture was simulated explicitly.

During the portable fixture's 15.005-second steady-play interval, the Core process
used 1.74% of one CPU core and RSS rose from 115.31 to 120.80 MB. This excludes the
FFmpeg child, browser decoding/scheduling and hardware costs. Group network output
scales with receivers; 48 kHz stereo signed-16 PCM is 192 kB/s per receiver before
protocol overhead. Direct playback keeps media transfer/decoding on the client.

Independent-session layer: `052094a2`, PR #629. Typecheck passed; full core suite
1,771 pass / ten skip / zero fail. Focused real-hub/native/external tests 136 pass,
1,597 assertions. Browser receipts: `.artifacts/independent-browser-proof` and
`.artifacts/browser-manifest-proof`. Performance receipt:
`.artifacts/independent-sessions-performance-final/report.json` (simulated renderers,
actual network/control traffic, not media decoder CPU).

Python Sendspin PR #628 is closed and removed from active code. Its receipts below
are historical experiments, not the selected implementation. Both optional
Sendspin roles are implemented in the existing TypeScript stack, PRs #631 and #632.

> Scope correction, 2026-09-27: historical Jellyfin browser relay/adaptation results
> below are archived evidence. That work is abandoned by user instruction. Current
> direction and active completion criteria are in map.md and the issue files.

# Browser / TV iteration validation — 2026-09-27

Implemented in this worktree. The native observations below are simulated, not a
claim of libmpv/TV hardware validation or audible synchronization.

## Working behavior

- One stable household session, connection-owned browser endpoints and the native
  stdio endpoint. Endpoint/group distinction is explicit; no multiroom backend added.
- Shared shadcn output menu is separate from server selection. A registered browser
  creates no media element until selected and sent a private load command.
- One connection-owned HTML media element persists across React route navigation.
- Handoff prepares paused, matches supported track choices semantically, requests a
  fresh paused source checkpoint, seeks, changes playback attempt, confirms the
  destination, and releases the source. Queue occurrences and session identity persist.
- Native checkpoint requests use the existing ordered `observe` stdio message;
  this matters because the native worker suppresses unchanged paused observations.
- Commands are rejected during transfer. Retired attempts/connections cannot write
  progress. Autoplay refusal keeps the destination paused with a local Play here button.
- Destination loudness stays local. A disconnected browser leaves a resumable session;
  Couch does not automatically start the TV.

## Actual shared-browser checks

Used the T3 collaborative Chromium preview at `http://localhost:1420`, the actual
shared React application and Bun hub, and the small native peer in
[runtime/server.ts](runtime/server.ts). That peer follows the command/observation
pattern in `tests/linux/built-remote.ts`, in process on macOS. It exercises routing,
not the Rust worker, libmpv, Linux packaging or physical TV output.

1. **Real provider:** selected This browser, then clicked **Play Sygma Radio** on
   Couch Home. Existing radio lookup resolved `radio:4a80fd10-0064-8227-ab1c-34521192ed92`
   to `https://radio.syg.ma/audio.mp3`. The HTML player reported playing, readyState 3,
   advancing time and no media error. Navigation to Settings left the same stream
   playing at 32.727 seconds. No Couch relay or encoder was introduced.
2. **Seekable video:** an H.264/AAC 90-second fixture was served by a separate HTTP
   origin, `http://127.0.0.1:4118/seekable.mp4`, with byte ranges. This tests real
   browser decoding/network/seek behavior, but is not qualification of an authenticated
   movie provider, manifests, expiring URLs, or all codecs.
3. **Paused round trip:** browser → simulated TV → browser observed positions
   **22.25 → 22.25 → 22.25 seconds** (zero measured position error), speed
   **1.5 → 1.5 → 1.5**, volume **31 → 80 → 31**, all paused. Queue and session ID
   unchanged; playback attempt changed each way. Command-to-confirmation time was
   **35.1 ms outbound / 39.7 ms return** with a warm local fixture and simulated TV.
   These are development-machine observations, not hardware latency guarantees.
4. **Playing round trip:** route navigation Home → Find kept the same element and
   advanced its time 35.745 → 36.107 seconds. Browser → TV completed in 22.5 ms;
   destination checkpoint 36.10881 was 0.00149 seconds beyond the immediately
   preceding browser read (the older controller clock was 35.774393). TV → browser
   completed in 48.3 ms at **54.10881 seconds on both sides**, playing at 1.5×.
5. **Control only:** a second browser showed the shared queue/timeline with **zero
   audio/video elements**. After moving playback to TV, the source browser had no
   `src` attribute and `networkState = NETWORK_EMPTY (0)`. Closing the second browser
   left TV playback running. This establishes absence of a browser media pipeline;
   CPU/heap/power profiles were not measured.
6. **Renderer disconnect:** closing the browser rendering the second queue occurrence
   at 40 seconds left the same queue/current occurrence unavailable and resumable.
   Another browser still had zero media elements. Choosing Move playback here recovered
   that occurrence **paused at 40 seconds**, without automatically starting TV audio.
7. Browser decoding exposed and led to a fix for `load()` resetting playbackRate;
   the speed round trip above was repeated after that fix. Seeking reports loading
   until the media element finishes the seek, rather than confirming from requested time.

## Automated checks

`bun run typecheck` passes. Focused regressions:

```sh
bun test --isolate \
  src/server/playback-targets.test.ts src/server/hub.test.ts \
  src/server/session.test.ts src/server/session-continuity.test.ts \
  src/server/session-quality.test.ts src/server/session-autoplay.test.ts \
  src/server/progress.test.ts src/server/subtitles.test.ts \
  src/server/validation.test.ts src/client/session/session.test.tsx \
  src/client/session/playback-clock.test.tsx \
  src/client/sections/now/PlayerPage.test.tsx \
  src/client/sections/shell/PlaybackStatus.test.tsx \
  src/client/sections/shell/AppShell.test.tsx \
  src/client/sections/shell/MiniPlayer.test.tsx
```

333 passed, 0 failed, 2550 assertions. Log: `.artifacts/device-independent-playback/regressions.log`.
New tests cover round trips, destination volume, final checkpoint freshness, late
observations, connection ownership/private delivery, refusals, incompatible tracks,
concurrent commands, source/destination disconnect, shutdown, autoplay refusal,
pending Play intent and native suppression of unchanged paused snapshots.
Autoplay refusal is injected in a regression test; no claim that Chromium blocked
this particular interactive browser session.

## Limits and next useful work

- Direct progressive formats supported by the destination browser; the later DASH
  increment below adds public `.mpd` VOD. No managed HLS player, relay, conversion,
  local-library browser delivery or Jellyfin browser profile yet.
  Header-dependent sources, split audio/video, segments and external subtitle loads
  fail explicitly. Native delivery remains intact. Browser audio switching uses
  actual `audioTracks` metadata where available; subtitles remain off. Unknown audio
  metadata allows a sole source audio track on a best-effort basis, but cannot prove
  a selection among multiple tracks. Known incompatibilities prevent handoff.
  Browser delay/replay-gain/subtitle upload requests fail explicitly.
- TV is simulated. Run the same paused/playing transfer on actual libmpv hardware,
  especially native audio-output routing and provider behavior with concurrent access.
- No sample-accurate or gapless transfer, background-phone guarantee or multiroom claim.
- Follow issue 02 for source-specific access/format needs discovered from real media.
  Start with scoped access and existing compatible renditions, not blanket transcoding.
- No workflow or packaging changes were made; no CI dispatch or `act` run was needed.

## Review fixes — 2026-09-27

- Idle browser volume is retained, persisted and reported before a media element
  exists, then applied to its first load. Registration reports saved target volume.
- Handoff commits the newly resolved delivery's private expiry/recovery context;
  rollback restores the previous context, including an already-consumed retry.
  Recovery callbacks never enter the renderer command payload.
- Browser observations report available audio metadata instead of inventing an
  audio track on video-only media. `audioTracksKnown` distinguishes unavailable
  metadata from a known-empty list. The compatibility policy above preserves the
  common TV-to-browser path without claiming verification of unknown tracks.
- Autoplay uses a structured `requiresGesture` observation instead of parsing the
  user-facing error message.

After these fixes, the parent independently ran the 15-file command above plus
`src/client/session/browser-renderer.test.ts`: **347 passed, 0 failed, 2582
assertions across 16 files**. `bun run typecheck` and `git diff --check` pass.
New regressions exercise idle volume, delivery recovery/rollback, video-only media,
unknown versus empty audio metadata, multiple-track refusal and autoplay state.
These fixes were exercised with simulated endpoint peers and happy-dom. The earlier
real-browser playback observations above predate the fixes; no new physical TV or
audible multiroom qualification is claimed. A supplementary Chromium module check
could not run through preview evaluation; a subsequent read confirmed zero media
elements and unchanged saved volume. It is not counted as playback validation.

## Core-only iteration — 2026-09-27

The branch now includes main at `3bd72c7d`, including the desktop remote-reachability
fix. Its one overlapping session-hook conflict was resolved retaining both upstream
connection/sharing behavior and browser renderer controls. No new window model or
navigation was introduced; the agreed constraints live in `docs/architecture.md`.

- Core-only startup omits the native command channel/target and publishes capabilities.
  Browser registration is idle until explicit output selection. Native startup retains
  its target and marks it connected on observation. HTTP/WebSocket tests cover both.
- A control-only browser connection still accepts commands without registering a
  renderer. Enabled and legacy capability responses register once after the baseline.
- Browser buffering reports loading and resets between sources. Registering or losing
  another target during a handoff no longer clears the handoff-in-progress state.
- Disconnect → handoff → expiry recovery has regression coverage. Previously fixed
  idle volume, audio metadata, structured autoplay and delivery rollback still pass.
- Before output selection, both commands and the existing shell prompt say
  “Choose a playback output.” rather than implying Core needs a desktop player.

`bun run typecheck` passes. The earlier 15-file regression command plus
`src/server/session-handoff.test.ts`, `src/client/session/browser-renderer.test.ts`
and `src/client/session/native-selection.test.tsx` passed **364 tests, 0 failures,
2676 assertions across 18 files**. Log:
`.artifacts/device-independent-playback/core-only-regressions.log`.
After the final shell-copy change, typecheck and all **15 AppShell tests** passed
again (`core-only-shell.log`). `git diff --check` passes.

A fresh Core-only Bun hub on port 4117, using the isolated existing fixture database,
and Vite on 1420 were checked through the collaborative Chromium preview. The UI
retained Home/Find/Saved/Settings. Discovery returned browser playback enabled and
native playback disabled; the output menu contained browser targets only. No media
element existed before or immediately after selecting “This browser.” Playing Sygma
Radio loaded `https://radio.syg.ma/audio.mp3` directly, reported `readyState = 3`,
`paused = false`, advancing time and no media error. Home → Find retained the same
element and advanced 25.284 → 25.657 seconds. Stop released the source. This checks
real remote browser playback and navigation, not audible output or native hardware.

Independent packaged service lifecycle, receiver enrollment and multiroom remain
unfinished. The native/TV handoff evidence remains simulated as described above.

## Reproduce the browser fixture

```sh
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i testsrc2=size=640x360:rate=24 \
  -f lavfi -i sine=frequency=440:sample_rate=48000 -t 90 \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart \
  .scratch/device-independent-playback/runtime/seekable.mp4
bun .scratch/device-independent-playback/runtime/server.ts
# In another terminal:
COUCH_PORT=4117 bun run client:dev
```

Pair at localhost:1420 with code 123456, select the browser output and play a radio
station. The video fixture can be enqueued through the authenticated household queue
as the direct HTTP source above. The runtime database/media are ignored artifacts;
the fixture is explicitly a local development service with a simulated native peer.

Implementation references: [HTMLMediaElement](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement),
[play() promise / autoplay handling](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play),
[shadcn menu catalog](https://ui.shadcn.com/docs/components/radix/dropdown-menu).
The output picker reuses Couch's existing shadcn components; no custom menu framework
or card container was introduced.

## Direct DASH VOD increment — 2026-09-27

Current main was fetched and remained `3bd72c7d`, already integrated. Existing tracked
and untracked work was retained. This increment changes the browser renderer and adds
Shaka Player 5.2.12; no UI, window/navigation/player layout, shared protocol, Core
authority, packaging or workflow changes were needed.

### Demonstrated gap and result

The public Angel One manifest from Shaka's official basic-usage example,
`https://storage.googleapis.com/shaka-demo-assets/angel-one/dash.mpd`, failed native
Chromium media loading with error **4**, readyState **0**. The public hls.js example
loaded natively on this Chromium, so HLS was not claimed as the demonstrated failure.

The renderer now lazily loads Shaka only for HTTP(S) URLs whose pathname ends in
`.mpd` (query strings supported). Provider manifest/audio/video resources stay direct,
including the manifest's separately hosted audio/video streams. Existing progressive
and native-HLS behavior stays intact. Header-dependent delivery and separately supplied
`audioSource` remain rejected. Shaka retains adaptive renditions under `maxVideoHeight`.

Paused preparation, seeking, speed, output-local volume and the existing autoplay
flow are retained. DASH observations report intended speed while Shaka may temporarily
set the effective element rate to zero for buffering. Critical errors report only a
code and destroy the adapter. Replacement waits for asynchronous detach/destroy before
reusing the element; stop during pending import and previous progressive-source cleanup
are covered. Unknown DASH audio metadata is explicit; subtitles are disabled.

### Actual shared-app browser evidence

Used the existing Core-only hub on 4117, shared React app/Vite on 1420, isolated
fixture database and two real collaborative Chromium tabs. No simulated native target
was involved in these new browser-to-browser checks.

- Angel One played through Couch: readyState **4**, duration **60 seconds**, advancing
  position, no media error. Network entries showed provider-hosted `.mpd`, VP9 video
  and AAC audio resources; no Couch relay or encoder was introduced.
- Home → Find retained the same media element; observed time **17.565798 → 24.238965**.
- Pause, seek and speed commands reached **22.25 seconds**, paused at **1.5×**.
- A newly opened controller had **zero audio/video elements and zero Shaka/Angel One
  resource requests** before selection.
- Paused handoff to the second browser preserved **22.25 seconds, 1.5×**, queue
  occurrence and session identity. The first browser had no `src`, no `srcObject`,
  and `networkState = 0`. Resuming and handing back succeeded while playing at **1.5×**.
  No precise playing-handoff latency or drift was measured.
- Reloading the rendering tab after pausing/seeking to **32 seconds** left the same
  occurrence unavailable at that checkpoint. Selecting the other browser recovered
  it **paused at 32 seconds, 1.5×**. Stop left Core idle and released the media source.

### Additional real renderer checks

These used the actual renderer module in Chromium, independently of the Core command
path; distinguish them from the shared-app checks above.

- A **240p** cap selected only the 240p video resources and rendered **300×240**,
  paused at the requested **10 seconds**.
- A missing public manifest produced sanitized DASH error **1001**, status **error**,
  and released its MediaSource (`srcObject = null`, networkState **0**). No provider
  URL or response body was exposed in the reported error.
- After the final progressive-source cleanup fix, the capped paused load and Stop
  were repeated successfully. Evidence: `.artifacts/device-independent-playback/
  dash-browser-check.json`. Auxiliary renderer instances were closed.

### Final automated checks

`bun run typecheck` and `git diff --check` pass. The earlier regression command plus
`session-handoff.test.ts`, `browser-renderer.test.ts`, `native-selection.test.tsx` and
`web-media.test.ts` passed **396 tests, 0 failures, 2899 assertions across 19 files**.
Log: `.artifacts/device-independent-playback/dash-complete-regressions.log`.

The **15 renderer tests** include delayed import/attach/destruction, stop/close,
progressive replacement, sanitized fatal failure, zero effective buffering rate,
speed restoration and cap/paused-start configuration. Test doubles cover library
lifecycle behavior; the browser checks above establish actual decoding/network use.

`bunx vite build --outDir ../../.artifacts/device-independent-playback/dash-verified-dist`
succeeds, including PWA generation. Shaka is a separate dynamic chunk (about **815 kB**,
**269 kB gzip**); Vite reports its standard large-chunk advisory. The generated worker
precaches it with the existing shell policy; this is not a stream fetch or active
media pipeline. This frontend build is not packaged desktop qualification. Log:
`.artifacts/device-independent-playback/dash-verified-build.log`. No CI dispatch or
workflow/packaging change occurred, so no `act` run was required.

### Remaining qualification

Public DASH VOD is supported; this sample does not establish an authenticated provider
account. Header/cookie-dependent media, opaque/extensionless manifest URLs, explicit
DASH audio switching/subtitles, DRM, live/DVR timeline behavior, expiring URLs and
Jellyfin browser negotiation remain issue 02 work. Safari/native HLS was not tested.
The new adapter has no physical TV/libmpv qualification; previous native evidence is
still simulated. Independent Core/native receiver lifecycle and real synchronized
groups remain issues 05 and 03, with their resolved issue-01 blockers reconciled.

Implementation references: [Shaka basic usage](https://shaka-project.github.io/shaka-player/docs/api/tutorial-basic-usage.html),
[Shaka Player API](https://shaka-project.github.io/shaka-player/docs/api/shaka.Player.html),
[Shaka restrictions](https://shaka-project.github.io/shaka-player/docs/api/shaka.extern.html#.Restrictions).

## Target-aware controls — 2026-09-27

Core sound-output queries/choices and links now require native assignment; browser
volume still controls the selected renderer. Unavailable names handle both known
disconnected targets and removed browser descriptors. Host/admin source-management
visibility follows authenticated authority. No layout/window/navigation changes.

Typecheck and 68 tests across PlaybackStatus, AppShell, PlayerPage and SettingsPage
pass. Log: `.artifacts/device-independent-playback/target-controls-tests.log`.
The bottom Core PR was independently checked in a detached worktree at `7a18b833`: typecheck
and 229 server tests passed; 7 LAN tests skipped because no LAN interface was selectable.
These results are not physical audio-output validation or an exact-revision merge gate.

## Jellyfin browser delivery — 2026-09-27

- Typecheck and diff whitespace checks pass. Focused regressions: **313 pass, 0 fail,
  2411 assertions in 15 files**. Log: `.artifacts/device-independent-playback/jellyfin-final-tests.log`.
- Media relay tests use a real Bun upstream to verify Range/HEAD/304/416, private
  headers, redirect rejection, authorization, expiry and active-body cancellation.
- Six actual-hub/fake-Jellyfin tests cover destination profiles, private commands,
  revoke/stop/disconnect, incompatible native→browser preparation, successful
  transfer, and post-commit rollback without prematurely stopping the old provider
  attempt. Native observations in these tests are simulated.
- Disposable official Jellyfin **10.11.11**, isolated Core **4127**, Vite **1421**,
  collaborative Chromium tabs 8 and 9: H.264/AAC MP4 loaded with readyState 4,
  duration 90 seconds and advancing position. Media URL contains a scoped UUID,
  not the Jellyfin credential. Jellyfin Sessions reported **DirectPlay**, no
  transcoding, and `docker top` showed no encoder process.
- Pause/seek reached **31.5 seconds at 1.5×**. Range `bytes=0-1023` returned **206**,
  `Content-Range: bytes 0-1023/9248291`, exactly 1024 bytes.
- A second browser remained idle (zero media elements) until selected. Paused
  handoff retained **31.5 seconds, 1.5×**, while source stopped. Its old grant then
  returned **404**. Stop released destination media (`src=null`, networkState 0)
  and its grant returned **404**.
- Credentials and disposable service files live only under ignored `.artifacts`;
  credential JSON is mode 600. No packaging/workflow changes or CI dispatch.

Limits: conservative direct play only; no claim of multi-audio, external captions,
Jellyfin transcoding, physical TV playback or packaged exact-revision qualification.

## Explicit HTTPS proxy admission — 2026-09-27

- Typecheck and diff whitespace checks pass. Classifier + real-hub tests: **17 pass,
  0 fail, 130 assertions**. Tests reject spoofed/ambiguous forwarding metadata,
  untrusted transport peers, wrong origins and external private-host-token access.
  Explicit pairing, discovery, controller HTTP/WSS semantics, renderer registration,
  revocation and sharing-off behavior pass (test transport itself uses loopback WS).
- Existing hub/controller/media-relay/Jellyfin-browser plus classifier tests: **139
  pass, 0 fail, 1745 assertions** in 5 files. The classifier's six tests overlap
  the 17 above; combined unique test count is **150**. Log:
  `.artifacts/device-independent-playback/remote-access-regressions.log`.
- Official Caddy **2.11.4**, isolated container, TLS internal CA, no global trust
  installation: HTTPS discovery returns only `https://localhost:8443`. The actual
  Docker Desktop connection's raw Core peer is `127.0.0.1`; it is explicitly trusted.
- Collaborative Chromium rejects the fixture's private certificate and navigates
  to `chrome-error://chromewebdata/`. No available preview tool grants per-origin
  certificate trust. This is recorded as a browser qualification gap, not a pass.
- No production packaging/workflow changes or hosted dispatch occurred.

Actual TLS/WSS qualification with explicit fixture CA also passed: shared React page
200, canonical discovery, real Jellyfin range delivery (206, 1024 bytes), paused
handoff at 5 seconds/1.25× between **two simulated renderers**, resume and stop. Old
and stopped grants returned 404. Script and sanitized evidence are in
`.artifacts/device-independent-playback/https-proxy/{qualify.ts,qualification.json}`.
This is real Caddy/Jellyfin network transport, not browser decoding; external host
authority is covered by hub tests, not this script (host token intentionally absent).

The preceding Jellyfin review additionally found and fixed a timeout after resolution:
its owned timer now clears when resolution finishes, leaving explicit handoff cleanup
in charge. Both focused handoff tests passed, including survival past the 15-second
resolution deadline. The fix is included in Jellyfin PR #618.

## Native receiver enrollment — 2026-09-27 (qualification in progress)

- `cargo check --lib` passes; **75 Rust library tests** pass with the build-only
  `TAURI_CONFIG={"bundle":{"externalBin":[]}}` override because this macOS source
  check did not build a packaged sidecar. Tests include challenge deadlines, stale
  generations and persisted opt-in state.
- **78 UI tests** pass for the output picker, device choice, native selection and
  player page. **198 server/session/renderer regressions** pass (1899 assertions,
  seven files). Log: `.artifacts/device-independent-playback/native-increment-tests.log`.
- **Nine receiver tests / 39 assertions** exercise real Core HTTP/WebSockets with
  simulated receiver observations and deterministic monotonic-fence checks.
- Combined targeted receiver/client/UI run: **138 pass, 0 fail, 683 assertions**,
  eight files (overlaps the groups above; do not add these counts). Log:
  `.artifacts/device-independent-playback/native-targeted-tests.log`.
- Linux exploratory qualification builds a copied dirty snapshot in an isolated
  Docker container/target volume; it is not the final clean-revision merge receipt.
  No physical display/speaker, macOS or Windows receiver qualification is claimed.

### Exploratory real native journey

Linux arm64, actual Tauri/libmpv, Xvfb and null PulseAudio: explicit enrollment,
Core-selected playback, native video pixels, pause/seek/resume and audio-stream
presence all passed. Suspending only the independent Core (`SIGSTOP`) caused
native audio-stream removal after **8295 ms**. Resuming Core, reconnect under the
same receiver ID without autoplay, explicit resume, disable and app close all
passed; Core remained reachable. Evidence is under
`.artifacts/device-independent-playback/native-qualification/journey`.

The exploratory build is deliberately marked dirty (base `a634fad1`); a copied
snapshot and cached rebuild were used while integrating this layer. It does not
replace a final clean-revision receipt. Physical speaker/display timing and native
macOS/Windows journeys remain untested.

A tightened second native run also passed after explicitly observing the disconnected
target before reconnect: silence after **8348 ms**, same-ID reconnect without autoplay,
explicit resume, disable, and independent Core survival. The retained regression is
`tests/linux/native-receiver.ts`; its targeted TypeScript check passes. The final
source commit still needs the clean build/journey receipt before merge readiness.

### Clean native receiver qualification

Final receiver revision `51677c8e1cd28d0caa9e54c3a4b52d337e3462b2` passed
`bun run verify --native` with clean before/after identity: core 1675 passed/4 skipped,
three real-clock IPTV tests, native 71 passed/1 ignored plus two integrations and
startup buffering. All steps exit zero. The separate packaged-browser journey
passed 25 checks; actual native enrollment/playback/reconnect/disable/app-close
journey passed, with watchdog audio removal at 8380 ms. Evidence:
`.artifacts/device-independent-playback/native-qualification/exact-touchfix/`.
The earlier exact run exposed a narrow phone output button; its owning renderer
layer now uses the existing 44px minimum touch width. All final gates were rerun.

## Core checkpoint recovery — 2026-09-27

Disk-reopen tests cover graceful close/quiesce, periodic crash checkpoints, no
autoplay/native-idle interference, stale queue identity, failed destination recovery,
fresh paused browser/native delivery, original history ownership, profile/history
mutation guards, Stop/EOF clearing and persistence failure. Focused regressions and
typecheck pass; logs: `.artifacts/device-independent-playback/checkpoint-*.log`.

Actual Chromium with Jellyfin 10.11.11: play/pause/seek 37.25 seconds at 1.5×;
graceful Core restart restored the occurrence with no media element. Existing output
picker "Move playback here" fetched fresh delivery and reached readyState 4 paused
at 37.25/1.5×. Old grant returned 404. Explicit resume advanced to 66.71 seconds;
Stop returned idle and persisted a null checkpoint. Evidence:
`.artifacts/device-independent-playback/checkpoint-browser.json`. The first fixture
attempt reconfigured Jellyfin on startup, correctly stopping playback; the fixture
now skips reconfiguration when already connected. This is actual browser decode,
not a native checkpoint journey or abrupt-process-kill browser qualification.

## Snapcast output — 2026-09-27

- `bun run check`: **1717 core passed, 10 skipped, 0 failed**, **3 clock passed**;
  typecheck passed. Log: `.artifacts/device-independent-playback/snapcast-check-aac.log`.
- Actual Snapcast 0.35.0 plus two snapclients and Pulse null sinks: **18 checks**
  passed for play/pause/seek/Stop, member volume/removal/rejoin, complete member loss
  and backend loss/recovery without autoplay. Evidence: `snapcast-integration/run6`
  under `.artifacts/device-independent-playback`. This run used dirty source before
  the final AAC partial-chunk fix; final exact-revision qualification is pending.
- Actual Jellyfin 10.11.11 private-header H.264/AAC source and Chromium: transfer
  paused at 25 seconds/1.25×, group resume with 193128 captured PCM bytes (RMS 1978),
  return through the existing picker paused at 48.175 seconds/1.25×, then Stop.
  Group capture after return: 192000 PCM bytes, RMS 0. Browser source attribute was
  removed and readyState 0 while the group owned playback; currentSrc retained the
  former URL despite cleanup. Evidence: `snapcast-browser.json`, `snapcast-jellyfin.pcm`
  and `snapcast-jellyfin-stopped.pcm` in the same artifact directory.
- The real-media run exposed Bun stdout buffering and partial TCP chunk busy-loop
  behavior. The producer now uses a bounded private TCP decoder pipe, consumes
  partial bytes without spinning and preserves backpressure. Real long WAV and AAC
  regressions run with an external watchdog. The hung exploratory Core was killed;
  restart restored 25 seconds/1.25× without autoplay before explicit group selection.
- Group dialog DOM/actions have focused UI coverage. The preview's saved screenshot
  was stale, so no new screenshot-based visual qualification is claimed. No physical
  speaker synchronization, hardware silence or distributed TV lip-sync is qualified.

### Clean Snapcast qualification

Exact `52e09f469542cceeb645c06ee7f9163c0ce63a2b`: the actual 18-check Snapcast
journey passed with clean source before/after. Linux `verify --remote` produced an
eligible receipt: typecheck, 1717 core tests, three clock tests, production build
and 25 compiled-browser checks passed. Ten core tests skipped for their recorded
environment conditions. Evidence: `.artifacts/device-independent-playback/`
`snapcast-integration/exact-52e09f4/` (receipt, logs, PCM and source hashes).
