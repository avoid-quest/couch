# Playback backlog and acceptance

[The active product contract](../../docs/playback-product.md) defines the replacement
model. [Architecture](../../docs/architecture.md) records current seams. The
[original brief](brief.md), [issues 01–08](issues/) and
[2026-09-27 map](map-2026-09-27.md) record earlier decisions and observations;
resolved labels there do not close this matrix. Preserve their receipts and archives.

Library pairing grants control of playback in that Library; administrator access is
separate. A window must explicitly select another Playback, and neither selecting nor
opening it changes device assignment. The paired-device UI should disclose shared
control. Legacy `household`/`personal` selectors are storage/migration aliases,
not active user workflows. The old global Sendspin group and Listen together dialog
are superseded by assigning audio Devices to an individual Playback.

## Built-app acceptance matrix

A row is **PARTIAL** when a built-app journey covers some of it; it stays open until
the complete capability has been observed. A test, simulated peer or screenshot alone
does not complete a row. The [software observations](model-software-observations-2026-09-27.md)
record the earlier setup paths and their limitations.
Record build revision, source, client/Device, steps, observed media/state, failure
and recovery, and measured timing/resources where relevant. Separate actual device
observations, software-output results and unavailable physical checks.

| Capability | Journey to observe | Status |
| --- | --- | --- |
| Fresh and migrated Library | First setup/pairing through the app; reopen and migrate existing queue, progress, checkpoint, name and credentials without duplicate identity. | PARTIAL — fresh setup and saved pairing/name reopen observed; full legacy checkpoint migration remains open. |
| Runtime placement | Standalone desktop; independent Core with TV window closed; browser and additional native client connected once. Select a usable home-network address on a Mac with virtual interfaces. Verify hardware and maintenance target the named machine. | PARTIAL — independent Core, browser and paired native client observed; standalone/Linux and hardware targeting remain open. |
| Library and permissions | Browse/manage sources and authorized settings across browser/desktop/TV; pair a second device and confirm shared-control disclosure and admin separation. | PARTIAL — shared browsing and Find used; full administration/revocation coverage remains open. |
| Control only | Open/navigate/select another Playback while its renderer continues; no media fetch, local decoder, screen navigation or implicit takeover. Close controller and confirm remote playback. | PARTIAL — native selected browser HLS, then Quit; browser continued at 71 s. Traffic audit remains open. |
| Concurrent Playback | Two people/devices play different media, queues, progress and tracks; create another Playback without changing either existing queue. | PARTIAL — independent browser/native radio earlier; browser HLS and native HLS have separate timelines. Track/progress persistence remains open. |
| Audio devices | Add/remove two compatible audio Devices on one timeline, then run two independent Playbacks with separate synchronized delivery. Check membership, reconnect, per-device/shared loudness and the optional external audio-server setting. | PARTIAL — native/browser shared radio, removal and software producer cleanup observed; two shared Playbacks and physical checks remain open. |
| Identity and scope | Rename once; check one Device entry across pairing, direct rendering and synchronized audio, plus restart and browser origin/profile limits. Verify each visible transport/queue/volume control names its Playback or Device. | PARTIAL — same names and pairing survived reopen; Rename, mobile origins and full control-scope review remain open. |
| Audio/video Move | Move ongoing audio and video both directions; verify queue occurrence, position/live distance, pause intent, speed and compatible tracks. Confirm destination readiness before source retirement. | PARTIAL — live radio moved both directions; paused HLS move exposed native rendition/track mismatch, source preserved. Video acceptance remains open. |
| Occupation and failure | Replace an occupied Device explicitly; refuse incompatible combinations contextually; recover preparation, autoplay gesture, disconnect and uncertain-silence failures without duplicate playback. | PARTIAL — occupied Replace shown and failed HLS move kept browser paused at 247.122 s / 1.5×. Broader failures remain open. |
| Lifecycle | Navigate, close renderer/controller, revoke access and restart Core; reconnect with accurate resumable state, no stale command or unexpected autoplay. | PARTIAL — controller Quit/reopen preserved browser playback; Core restart recovery and revocation need final-build checks. |
| Sources and efficiency | Real supported native/provider/direct browser/HLS/DASH/live-DVR sources, audio/subtitle tracks and quality limits, with actionable capability failures; measure startup, seek, Move, cleanup, decoders and traffic. | PARTIAL — Sygma and Mux HLS observed, shared producer exited after Move. One native radio reopen stayed Loading; DASH/provider/track/quality coverage remains open. |
| Physical audio | Measure speaker timing and output behavior on actual available devices. Software PCM/SDK evidence remains labeled separately. | PENDING |

Implementation is in progress on the playback-model stack layer. Current code has a
Playback catalog/default pointer and per-Playback Sendspin producers, with assignment
behind `createPlaybackDevices`. The observations above are from build `33390923` and earlier recorded builds;
subsequent fixes require a new built-app check. Migration, failure behavior, complete
source coverage and physical measurements still require acceptance evidence. Follow
[`docs/ci.md`](../../docs/ci.md) for relevant checks and `act` before dispatching
workflow or packaging changes; do not merge or release here.
