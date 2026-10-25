# Native Live audio candidate

The normal native Mac capture UI, real Couch upload/Core/transport and a separate
scratch native Pulse receiver passed the original 60-second electrical diagnostic
at 45 ms host lead: 55/55 windows per pair, median 46.23 ms, maximum 47.07 ms,
controls zero. The separate waveform diagnostic flagged zero steady-window tiles.
Subsequent filtered Pulse experiments confirmed that a fixed +62.5 ppm playback
trim reduces the measured device-pair drift. A repeat after four minutes of Couch
streaming passed 55/55 windows per pair, maximum 45.498 ms rounded up, and zero
waveform flags in the original fixed interval. The host diagnostic trace hit its
row cap during that longer session; receiver logs and raw witness are retained.
The subsequent automatic-controller trial started without a preset trim and
passed 55/55 windows per pair, maximum 46.150 ms rounded up, with zero waveform
flags. The controller and reused Pulse sink now have maintained source under
`playback/`, with a child-process adapter in `app/native-playback.ts` and a
standalone build script. Desktop selection, SDK/IPC ownership and packaging are
not wired yet. These are uncalibrated sampled results; supported integration and
unrestricted long-session/continuous-fidelity qualification remain open. See
[the measurement report](../../docs/audio-roundtrip-performance.md) for exact
packages and failed controls.

Earlier capture-stage evidence remains separate. Standalone UMC capture at
48 kHz / 256 frames matched the coherent recorder's ADC1/2 for 60 seconds after
its existing S32 conversion. That comparison bypassed Couch transport/playback.
The first normal-desktop R2 upload then delivered 7,036 ordered blocks but its
browser output failed a frontend/frozen-Core format mismatch. Both are retained;
the subsequent native receiver comparison above supplies the full-path result.

Raw capture-stage evidence is in
`.scratch/audio-portaudio-candidate-r1/collected-native-witness-r2/`. Its preceding
r1 is invalid: macOS denied the SSH-owned helper microphone access and supplied
zeros. The capture-only r2 ran under the already-granted Lab executable in Node
mode; it is not itself normal desktop-flow qualification.

`capture.c` reuses PortAudio's CoreAudio implementation and single-producer,
single-consumer ring. The inspected/built dependency is upstream commit
`1ca0eeedb678c3cca80f3306c474d69a7a4b5278`, archive SHA-256
`2602de95236428dcf1329e66f1adb1b603b12d16f8d368e11f909a84ba1ccd83`.
PortAudio's MIT-style `LICENSE.txt` must accompany a distributed helper. Source,
the license, build logs and the M1 build are retained in
`.scratch/audio-portaudio-candidate-r1/`; nothing was installed globally.

The helper takes an exact device name, expected CoreAudio UID, sample rate,
requested callback frames and a 1–300 second experiment bound (0 means the
desktop owner's lifetime). It rejects an ambiguous name, a different opened UID,
or an unsupported rate. Discovery checks native input channels without opening
a stream. Explicit rate selections add `--set-rate`: the helper verifies native
support and writability, then waits for notification and readback. Automatic
keeps the current nominal rate. The rate setter is not physically qualified;
the 44.1 kHz witness decision remains open.
It requests 128/256/512/1024 callback frames through PortAudio. The same-process
HAL property readback and actual callback frame counts are separate observations;
neither is labeled the raw AUHAL callback period. PCM is stereo float32, which is
the processing format, not a claim of 32-bit converter resolution.

Before running it, the desktop owner must authorize microphone capture through
the existing app permission flow. This candidate is not a consent workaround.
Main owns its child handle and abort signal across preparation, upload,
navigation, window close and shutdown. Source integration consumes a fresh local
microphone grant and serializes retirement before another open. Live audio input
selection appends Native devices only when the helper is available. Advanced
settings expose 128/256/512/1024 frames (default 256); sharing controls distinguish
requested frames from the running same-process readback. Deployment and native
permission attribution remain unqualified.

`scripts/build-live-audio.ts` builds the pinned static PortAudio dependency on
the target Mac; `afterPack` includes the helper, license and build receipt before
signing. Full source/scripts/app typechecks, the Node hook loader and a focused
Linux `act` hook/no-op check pass. The maintained script built successfully on
M1; later native guard changes were compiled/tested with the same pinned library.
Native desktop R1/R2 were deployed separately in scratch. R1 exposed a missing
WebSocket Origin header in the Node uploader; R2 adds the local origin, with a
real-Hub regression covering successful upload and revoked-publication rejection.
The dedicated Lab certificate retained the user's microphone grant across that
rebuild. Frozen R4, Core and worker are unchanged. See
`.scratch/audio-native-desktop-r2/` and the roundtrip report for limitations.

Control is line-oriented on stdin: `clock <nonce>`, `start`, `stop`. stderr carries
JSON readiness, readback, native-clock replies and end/error reports. stdout
carries the existing 40-byte Couch PCM v1 header plus interleaved samples. The
helper has no network access or credentials. Native acquisition time remains
PortAudio's **ADC-time estimate**; it is not replaced by pipe arrival time.

`app/native-capture.ts` adapts an already-owned child to the existing local Couch
upload endpoint. Clock requests bracket Core's ordinary clock exchange using
the helper's own clock; the minimum observed roundtrip supplies offset and an
explicit uncertainty bound. PCM timestamps are not rewritten. Core continues
to enforce the publication/owner/upload authorization and ingest checks.

The callback performs bounded copies into eight preallocated slots, with no
allocation, I/O, mutex or wait. Overflow, null/nonfinite input, driver xruns and
invalid/backward/duplicate ADC times abort explicitly. Timestamp-spacing
deviations remain in the PCM timestamps and are counted in the final report;
Core retains its clock-drift validation. The initial two-sample spacing guard
was incorrect: a diagnostic-only PortAudio trace found consecutive native
sample positions through a roughly 0.28 ms CoreAudio host-time adjustment,
with unchanged PortAudio latency offset and no reported xrun. That trace patch
is retained in scratch and is not included in the maintained backend. This
does not prove waveform fidelity or exclude unreported physical loss.
The uploader checks packet boundaries, sequence and sample position and bounds
its parser and WebSocket queue. Stop may discard the unfinished tail of a
deliberately ended publication; no tail is substituted or relabeled continuous.

Verification completed:

- C queue tests on Linux and M1: ordering, ring wrap, exact samples/timestamps,
  full queue, skipped/duplicate time, driver xrun and invalid input.
- Node integration against real `acceptCaptureUpload`: split/coalesced pipe
  reads, unrelated native clock epoch, PCM order, duplicate rejection, Core
  rejection and cancellation before readiness.
- M1 compilation with `-Wall -Wextra -Werror`; app TypeScript check.

The integration fixture is synthetic and does not exercise the real native
device, Hub authentication, scheduler, network receivers or analog output.
No electrical or sustained-fidelity claim follows from these checks. In addition,
the retained near-default Linux receiver currently requires 53 ms against the
47 ms receiver budget. Native host capture alone cannot remove that independent
admission failure.
