# Playback refactor: code ownership and retirement map

Companion to [the execution plan](audio-video-refactor-plan.md), inspected at
`59ac6cd6a510ca96bf60dfc9a3628cc635be22e1`. This is the complete scoped change
surface identified by the audit, not a command to rewrite every listed file.
At kickoff reconcile it with the actual base; at completion record each area's
changed, combined, removed or preserved disposition and supporting checks.

Paths below are relative to the repo. A listed dependency can remain unchanged
when its interface already meets the contract. Find all callers before moving
or deleting an interface. Extend this map for newly discovered dependencies.

Implementation accounting and validation are recorded in the
[disposition ledger](audio-video-refactor-validation.md#final-code-disposition).
The original change map below remains the audited plan. Added implementation
modules are `src/shared/playback-policy.ts`; server `source-preparation.ts`,
`scheduled-audio.ts`, `scheduled-capture.ts`, `audio-worker.ts`, `audio-packets.ts`,
`capture-audio.ts` and `capture-ingest.ts`; client `capture-audio.ts`,
`capture-audio-worker.ts`, `receiver-admission.ts`, `picture-mapping.ts` and
`playback-controls.ts`. The maintained SDK patches and removal gates are in
[`patches/README.md`](../patches/README.md); `scripts/core.ts`, `package.json` and
`bun.lock` own their build/distribution integration.

## M1. Shared contract, Playback state and persistence — P0/P1

**Change surface:** `src/shared/protocol.ts`, `src/shared/live-input.ts`,
`src/shared/media.ts`, `src/shared/capture.ts`, `src/shared/device-sharing.ts`,
`src/shared/playback-default.ts`, `src/server/session.ts`, `src/server/store.ts`,
`src/server/validation.ts`, `src/server/messages.ts`; `src/server/sqlite.ts`
only if a persistence migration needs it.

Separate source identity/capability, Playback intent, output assignments and
actor permissions. Make runtime route/timing status distinguishable from product
intent. A single legacy `inSync` boolean cannot describe a strict live contract
and a listener's control rights. Replace its scattered interpretation without
introducing a giant protocol/quality/mode matrix. Keep control capabilities
specific enough for queue, transport and local participation actions.

Preserve queues, media IDs, history/defaults and ordinary restart behavior. Live
publications and admission are runtime state; never resurrect dead capture URLs
or persist a successful qualification across an unknown output/browser change.
If durable fields change, define old-row defaults and reversible migrations;
otherwise leave the schema alone. Retire old protocol fields only once consumers
and any supported compatibility path have moved.

**Coverage:** `tests/media-shape.test.ts`, `tests/playback-status.test.ts`,
`tests/stop-undo.integration.ts`, `tests/all-consent-restart.integration.ts`,
`tests/history-selection.integration.ts`, plus behavior tests for the new policy.

## M2. Authority, output routing and orchestration — P1

**Change surface:** `src/server/hub.ts` (notably `mediaPlayback`, `authorizePlayback`,
`grouped`, `reconcile`, `sendTo`, `setOutput`, `offline`, state serialization and
command handling), `src/server/devices.ts`, `src/server/remote.ts`,
`src/server/session.ts` integration.

Consolidate route selection and authorization; remove duplicated conditionals
after migration. Preserve controller selection separately from destination and
instance selection. Apply the same policy to REST/media entry points and socket
actions. Validate selected output channels rather than requesting consent for
an explicitly disabled picture channel. Recheck authority after resolution.

Keep shared/private output replacement, held publisher ownership, one Playback
per receiver, remote handoff and per-recipient state filtering. Audience join
authorizes reception, not programme mutation. Online/offline and backend failures
have policy-specific outcomes: a concert receiver cannot pause the group. An
incompatible live join cannot restart formats or retime existing receivers.

**Coverage:** `tests/device-sharing.integration.ts`, `tests/live-outputs.integration.ts`,
`tests/output-controls.integration.ts`, `tests/live-revocation.integration.ts`,
`tests/remote-control.integration.ts`, `tests/remote-queue.integration.ts`,
`tests/server-selection.integration.ts`, `tests/all-consent-edges.integration.ts`.
Add malicious/stale audience-command and source-generation cases through Core's
real command interface; UI-only hiding is insufficient.

## M3. Direct resolution, rendition choice and byte delivery — P2

**Change surface:** `src/server/session.ts` source preparation,
`src/server/web-media.ts`, `src/server/yt-dlp.ts`, `src/server/providers/index.ts`,
`src/shared/providers.ts`, `src/server/sendspin.ts`'s `audioRendition` responsibility,
`src/server/pass-through.ts` and `src/client/session/renderer.ts` load contract.

Carry desired picture/sound and actual destination format capabilities into
resolution. Select existing audio-only renditions for sound-only output. Share
rendition-selection logic where Direct and group decoding currently need the
same decision. Preserve provider-specific quality limits, live/durable source
differences, signed-URL expiry, cancellation and retries. Re-resolve deliberately
on handoff or format change; a source resolved for one receiver need not suit another.

**Preserve unless the interface requires edits:** `src/server/providers/*`,
`radio*.ts`, `iptv.ts`, `iptv-feeds.ts`, provider-specific resolvers,
`public-media-proxy.ts`, `public-network.ts`, `subtitles.ts`, `progress.ts` and
`continuation.ts`. Keep current yt-dlp protected relay policy, public-destination
checks, redirect/header/Range handling and signed media-address scope. HTTP proxies
are connectivity/access modules, not targets for codec-path deletion.

**Coverage:** `tests/web-media.test.ts`, `tests/public-media-relay.test.ts`,
`tests/public-media-proxy.integration.ts`, `tests/public-network.integration.ts`,
`tests/youtube-playback.integration.ts`, `tests/source-journeys.test.ts`,
`tests/provider-resume.integration.ts`, `tests/iptv-routing.integration.ts`,
`tests/source-subtitles.test.ts`. Add an audio-only fetch fixture and quality/
handoff/source-expiry cases where the contract changes.

## M4. Receiver rendering, reports and output processing — P2/P3/P4

**Change surface:** `src/client/session/renderer.ts`, `sendspin.ts`,
`picture-clock.ts`, `playback-clock.ts`, `buffered.ts`, `compressor.ts`,
`src/server/mpv.ts`, `src/shared/protocol.ts` capability/report fields.

Direct load, split audio, native HLS, hls.js and MPEG-TS must share coherent
generation/disposal/reporting behavior. Load only selected tracks when the source
offers them; preserve local A/V on one receiver. Clock-following video needs an
explicit mapping and discontinuity handling. Fix stale callbacks, duplicate
audio and leaked AudioContexts/listeners when switching engines. A following
picture must not report its rate corrections as user speed changes.

Update the Sendspin SDK adapter for supported readiness/output-clock correction
and common receiver lifecycle. Picture-only receivers need a clock but no decoded
audio. Runtime support includes secure context, codec, output and browser state;
an API being present is not physical qualification. Preserve Tap to hear and
newest-tab rendering. Report unsupported controls honestly across adapters.
Manual live timing corrections must stay within the admitted timing contract;
they cannot turn an unsupported physical output into a qualified one.

Optional compression remains opt-in for ordinary Direct/relaxed paths, with one
responsible processing stage. Keep it out of the qualified live capture path
unless explicitly included in its latency/fidelity profile. Normalize volume
ownership so UI, OS output and stream gain do not double-apply attenuation.
Preserve host-only mpv compatibility rather than turning it into a group engine.

**Coverage:** `tests/renderer-hls.test.ts`, `tests/buffered.test.ts`,
`tests/playback-screens.integration.ts`, `tests/live-clock.integration.ts`,
`tests/live-sync.integration.ts`, `tests/iptv-codecs.test.ts`,
`tests/compressor.test.ts`, `tests/compressor-sendspin.integration.ts`,
`tests/compressor-mpv.test.ts`, `tests/screen-wake-lock.test.ts`.
Native/browser checks substantiate the integration; DOM stubs cannot qualify timing.

## M5. Scheduled audio, source clocks and formats — P3/P4

**Change surface:** `src/server/sendspin.ts`, its Hub integration,
`src/client/session/sendspin.ts`, `package.json`, `bun.lock`, and new focused
modules for capture timing/ingest where needed. Worker/helper placement is a P0/P4
implementation decision, not an instruction to import a lab directory.

Separate URL decoding, source normalization, encoding, fanout and state reporting.
Reuse the clock/receiver/fanout implementation with two sender policies. Current
read-ahead rebasing, format-triggered restarts, 60 ms Opus packets and the initial
lead are unsuitable as unchanged live defaults. Preserve useful relaxed PCM
compatibility without admitting it as an unqualified live fallback.

Own fixed source-to-output mapping, resampling bounds, sample continuity, source
reset semantics and finite queues. Share each encoded chunk across receivers;
receiver backpressure must not block capture or everybody else. Include codec
lookahead, packetization, capture buffering and output compensation in the budget.
Provide per-receiver failure/rejoin evidence and source-wide failure handling.
SDK patch/fork choice must be versioned, reproducible and packaged normally.

**Coverage:** `tests/sendspin-ahead.integration.ts`,
`tests/sendspin-logging.integration.ts`, `tests/live-clock.integration.ts`,
`tests/live-latency.integration.ts`, plus deterministic public-interface tests
for rate drift, late source/receiver, decoder readiness and resets. Inspect each
old latency test's measurement meaning; passing it is not an input-to-ear claim.

## M6. Capture, publication and desktop ownership — P4/P6

**Change surface:** `src/client/session/live.ts`, `src/server/live-input.ts`,
`src/server/live-stream.ts`, `src/shared/live-input.ts`, `src/shared/capture.ts`,
`app/capture.ts`, and, where capture moves across the process seam,
`app/main.ts`, `app/preload.ts`, `src/shared/app-bridge.ts`, `src/server/helpers.ts`.

Separate publication lifetime/permissions from peer negotiation and recorder
upload demand. Add timestamped audio ingestion with explicit token, origin,
generation, byte-rate and format validation. Capture from a device requires its
local permission; an arbitrary remote page may not start a host input merely
because Core can open it. Preserve desktop Client-mode consent rules.

Keep screen/window/system-sound/microphone selection, selected input identity,
quality changes, publisher mute and stop. Avoid acquiring a second microphone
or duplicating capture just to serve another playback policy. Production audio
capture must report real channels/rate/timing, never disguise duplicated mono
as stereo. Hosted capture must have an explicit owner and shutdown behavior;
do not accidentally introduce unattended background broadcasting.

**Coverage:** `tests/capture.test.ts`, `tests/capture-consent.native.ts`,
`tests/live-client.test.ts`, `tests/live-input.integration.ts`,
`tests/live-outputs.integration.ts`, `tests/live-tracks.integration.ts`,
`tests/live-close.native.ts`, `tests/live-upload-failure.integration.ts`,
`tests/live-reporter-retry.integration.ts`, `tests/app-quit.native.ts`.

## M7. Screen sharing, buffered video and connectivity — P3/P6

**Change surface:** `src/server/live-stream.ts`, `live-input.ts`, Hub demand/routing,
`src/client/session/live.ts`, `live-route.ts`, `renderer.ts` and `picture-clock.ts`.

Retain existing ordinary WebRTC viewing, including several viewers, and relaxed
captured A/V. Put buffered ingest, PTS mapping and fallback failure isolation
behind their existing capabilities. Keep one source ingest per publication where
possible, selective tracks per receiver and prompt cleanup. Buffering must align
the whole relaxed programme; an audio-only member of that A/V Playback cannot
silently jump ahead to concert timing.

Remove audio-only use of `live-stream.ts` when M5/M6/M8 replace it. Its remaining
video/compatibility responsibilities are explicit retained code. The picture-only
clock no longer conceptually requires a fake audio source; account for any retained
container-specific limitation. There is no new WebCodecs renderer, SFU or
WebTransport project in this refactor.

**Preserve while WebRTC is retained:** `src/server/live-ice.ts`, `live-stun.ts`,
`live-relay.ts`, `src/shared/live-relay.ts`,
`src/client/session/check-live-relay.ts`, relay settings, `native/live-relay`,
`scripts/build-relay.ts` and packaging. Remove this complete dependency chain
only if every consumer is retired after the fast-path/capability decision.

**Coverage:** `tests/live-delivery.integration.ts`, `tests/live-stream.integration.ts`,
`tests/live-channels.integration.ts`, `tests/live-sync.integration.ts`,
`tests/live-upload-failure.integration.ts`, `tests/live-ice.integration.ts`,
`tests/live-stun.integration.ts`, `tests/live-relay.integration.ts` and
`tests/live-relay-check.test.ts` as affected.

## M8. AirPlay and native output routing — P6

**Change surface:** `src/server/airplay-audio.ts`, `airplay.ts`, `live-stream.ts`,
`sendspin.ts`, Hub host-input integration and their source-state reports.

Feed decoded AirPlay PCM into the common audio module; convert its 44.1 kHz
clock/rate appropriately instead of using AAC/HLS as an intermediary. Keep
one-sender admission, automatic host-speaker takeover, sender departure, source
cleanup, disabled-network behavior and helper recovery. Sharing another user's
output still needs consent. AirPlay is input, not an output protocol.

**Preserve/adapt only as required:** `src/server/sound.ts`, `sound-routing.ts`,
`sound-pulse.ts`, `bluetooth.ts`, `bluetooth-linux.ts`, `src/shared/sound.ts`,
`src/shared/bluetooth.ts`, `native/airplay`, `scripts/build-airplay.ts`,
`src/client/sections/settings/couch/SoundSettings.tsx` and `BluetoothSettings.tsx`.
Physical sink/Bluetooth selection is independent of playback transport. An output
change invalidates live admission where its timing is unknown; relaxed/Direct
retain their normal output support. Preserve Linux host system-volume behavior.

**Coverage:** `tests/airplay-audio.test.ts`, `tests/airplay.integration.ts`,
`tests/sound-session.integration.ts`, `tests/device-volume.integration.ts`,
`tests/output-controls.integration.ts`, relevant helper lifecycle tests.

## M9. Complete UX and command consumers — P1/P2/P3/P5

**Change surface:**

- Routing: `src/client/components/PlayOn.tsx`, `MediaContext.tsx`,
  `src/client/session/where-it-plays.ts`, `player-control.ts`,
  `remote-player-session.tsx`, `src/client/sections/shell/Outputs.tsx`,
  `PlaybackDevice.tsx`, `NowPlayingBar.tsx`, `src/client/sections/remote/RemotePage.tsx`.
- Player: `src/client/components/PlaybackTransport.tsx`, `PlaybackSettings.tsx`,
  `DurationBar.tsx`, `DelayControl.tsx`, `CompressorControls.tsx`,
  `src/client/sections/now/{NowPage,PlayerPage,QueuePanel,QueueActions}.tsx`,
  `player-presentation.ts`, `src/client/session/{presentation,media-session,undo}.ts`,
  `src/client/sections/shell/KeyboardShortcuts.tsx`.
- Publishing/discovery: `src/client/sections/share/{share.ts,ShareDialog.tsx,ShareControl.tsx}`,
  `src/client/sections/home/HomeSources.tsx`,
  `src/client/sections/find/useLiveSourceHits.ts`,
  `src/client/sections/shell/LiveSharingStatus.tsx`,
  `src/client/sections/settings/this-device/DeviceSharingSettings.tsx`.

Use common action/capability state across all these entry points. Keep independent
Play on and viewed Playback semantics, queue-preserving moves, shared controls and
channel consent. Add the missing TV handoff action without inventing a separate
TV policy. Concert UI offers receiving/local controls, including a distinct leave;
relaxed sources keep shared controls. Hide unsupported controls rather than send
commands that do nothing. Retain current source discovery and device consent;
zones and new room permissions are not part of this work.

**Coverage:** `tests/play-on.test.tsx`, `tests/where-it-plays-rules.test.ts`,
`tests/where-it-plays.test.tsx`, `tests/playback-transport.test.ts`,
`tests/player-control.test.ts`, `tests/item-menu.test.tsx`, `tests/share.test.ts`,
`tests/home-sources.test.tsx`, `tests/couch-hotkeys.test.ts`,
`tests/remote-navigation.test.ts`, `tests/remote-control.integration.ts`.
Use product browser journeys for phone, desktop and TV presentation after logic tests.

## M10. Connections, capacity, reporting and cleanup — P1/P4/P5/P7

**Change surface:** Hub pairing/broadcast/lifecycle code, `src/server/http.ts`,
`src/server/tv-pairing.ts`,
`src/server/live-input.ts`, `sendspin.ts`, `src/client/session/session.ts`,
`session-context.tsx`, `connection.ts`, `update-batch.ts`, `reply-deadline.ts`,
`src/server/playback-log.ts`, `media-diagnostics.ts`.

Keep device identity, newest-tab authority, selected controller context and
source ownership valid across disconnects. Bound setup, retries, cancellation,
socket backpressure and pending state. Retain a setup slot until underlying async
work settles. Separate successful audience admission from failed pairing abuse
without weakening origin, token or revocation checks. Share common serialization
work within a broadcast, preserving recipient-specific permissions and freshness.

Preserve `src/server/certificate.ts`, `lan-listener.ts`, `lan-name.ts` and
`src/client/session/device-id.ts` identity/connectivity unless a concrete interface
change requires edits. Hosted source activity must remain visible to existing
unattended-update/helper-lifetime decisions in `startup.ts`, `helper-status.ts`,
`helper-updates.ts` and `helpers.ts`.

Use bounded counters/status for selected route, source discontinuity, queue depth,
clock readiness and receiver failure. Timing-sensitive work cannot synchronously
emit per-packet UI snapshots or unbounded logs. A test reports missing evidence as
unknown, not zero skew. Clean resources by ownership, without resetting OS audio
globally or killing unrelated processes.

**Coverage:** `tests/browser-connections.test.ts`, `tests/browser-device-identity.test.ts`,
`tests/device-identity.integration.ts`, `tests/tv-pairing.integration.ts`,
`tests/update-batch.test.ts`, `tests/live-startup.integration.ts`,
`tests/live-revocation.integration.ts`, `tests/playback-logging.integration.ts`,
`tests/media-diagnostics.test.ts`. Adapt scale fixtures only where they answer an
integrated product question; do not import the lab infrastructure wholesale.

## M11. Distribution, dependency cleanup and documentation — P7

**Conditional change surface:** `package.json`, `bun.lock`, `scripts/build.ts`,
`scripts/after-pack.ts`, `scripts/package.ts`, native helper sources/licenses,
`app/main.ts`/`app/preload.ts` lifecycle and relevant `.github/workflows/*`.
Use official SDK/platform interfaces and existing helper patterns. Pin a
maintained SDK correction; package new native capture support on the platforms
actually supported. Cross-compilation does not prove runtime capture/output.
Dependencies and notices are removed only when all consumers are gone.

**Update with code:** `docs/architecture.md`, `docs/design.md`,
`docs/design/{where-it-plays,share,player,home,remote,tv,settings}.md`,
`docs/live-inputs.md`, `docs/airplay.md`, `docs/public-media.md`,
`docs/live-sharing-performance.md`, relevant `docs/adr/*` and `docs/ci.md` where
behavior/build changes. Historical evidence stays historical; current guidance
points to the new implementation and its actual qualification status.

**Coverage:** `tests/package-hooks.test.ts`, relevant preload/capture/native
lifecycle tests, typecheck and build. Follow `docs/ci.md` for Node integrations,
native prerequisites, manual CI and act for workflow/packaging changes. No
release, merge or installed-app changes are authorized by this plan alone.

## Final retirement ledger required from the lead

| Responsibility/path | Planned disposition | Removal condition |
| --- | --- | --- |
| Ordinary direct decoding and provider/byte adapters | Keep; consolidate source selection and renderer lifecycle | Delete only superseded selection/loading code after equivalent source coverage. |
| Audio-only hidden video fetch when a separate rendition exists | Replace | Sound-only fixture fetches only the needed rendition, including handoff/quality changes. |
| Scattered routing, permissions and capability inference | Combine | Every command/REST/UI consumer uses the agreed contract; stale parallel decisions are gone. |
| URL group processing and new capture scheduling | Combine common delivery/receiver machinery; retain two sender policies | Both relaxed and live execute the shared module; remove temporary duplicate senders. |
| Browser/AirPlay audio-only recorder → HLS → group audio | Replace/remove where the new adapter covers the source | R5/R6 lifecycle and source/output coverage pass; unsupported publishing remains explicit. |
| Captured A/V HLS and delayed fallback | Retain and isolate for existing screen-sharing capabilities | Replace coherently or obtain explicit capability-removal agreement before deleting. |
| WebRTC peers, ICE and TURN | Retain existing behavior pending the conditional fast-path decision | Same-source latency/compatibility evidence plus agreement; retire the whole dependency chain if removed. |
| mpv, hardware routing/Bluetooth, optional DSP | Keep focused adapters; unify capability/output handling | Remove only truly unused code, preserving their stated user capabilities. |
| Lab hacks, global buffer tuning, duplicate mono, test-owned capture, unbounded monitors | Exclude from product | Translate only justified mechanisms into supported modules with tests. |

For each retained stage report its input/output, clock owner, codec pass and
resource owner. For each deletion identify the replacing behavior test and search
for remaining consumers. The full refactor is assessed by these outcomes and the
story checklist, not a file-count target or a new directory structure.
