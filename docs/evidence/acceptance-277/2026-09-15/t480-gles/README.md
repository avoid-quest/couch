# T480 native launch: missing GLES dependency

The first native session after [public installation](../t480-public-a/README.md) failed because the host lacked `libGLESv2.so.2`. The installer had completed successfully, but the application aborted during startup. After a separate diagnostic installation of Debian's `libgles2` package, the service reached `active` at 2026-09-15 01:00:14 UTC.

The green observation is a repaired-host result. It does not turn the original fresh installation into a successful native-launch acceptance run.

## Preserved sequence

| Stage | Evidence | Result |
| --- | --- | --- |
| First session | [Initial status](first-session/couch-status.txt), [journal](first-session/runtime-journal.txt) | AppImage process killed by `ABRT`; service repeatedly restarting |
| Failure confirmation, 00:54:30 UTC | [Result](launch-red/result.txt), [symptom](launch-red/symptom.txt) | `libGLESv2.so.2` missing, state `activating`, no main PID, probe exit 1 |
| Diagnostic repair | [APT log](repair/repair.log), [package manifests](repair/packages-after.tsv) | Only `libgles2:amd64 1.7.0-1+b2` added; repair exit 0 |
| Launch after repair, 01:00:14 UTC | [Result](launch-green/result.txt), [journal](launch-green/journal.txt) | State `active`, main PID 12208, probe exit 0; captured failure-symptom file empty |

Journal timestamps use local CEST; collector timestamps ending in `Z` use UTC. The first-session collector itself exited 0 because it collected status successfully. That exit code does not override the failed application status in its receipts.

The repair downloaded 17.3 kB and added 109 kB of package data according to APT. [Loader caches before](repair/loader-before.txt) and [after](repair/loader-after.txt) retain the added library's registration. The application remained production Preview `0.1.0-preview.1` from source `3f91c0564bbbeea04eef421977f2e67b17c8fb14`. The independently collected [post-repair AppImage checksum](stability/installed-sha256.txt) is `d67dab162272ab340d42a6ee70d7a35055696e99be2a8b0cb87edceb60c55ef7`, matching the exact public production A bytes. The original signed installation identity is retained in the public-install evidence.

The [clean Debian regression](../host-gles-regression/README.md) independently reproduces the missing library using the declared host package list and verifies that adding `libgles2` makes it loadable.

## Short stability sample after repair

From 01:08:26 to 01:09:26 UTC, [process samples](stability/process-samples.txt) retain the same application PID 12208. The service was active before and after, with `NRestarts=0` and `MemoryCurrent=570839040` bytes at both endpoints. Its cumulative CPU time increased from 2,484,514,000 to 2,538,805,000 nanoseconds: 54,291,000 nanoseconds over 60 seconds, approximately 0.0905% of one CPU. The [derived summary](stability/summary.json) records the arithmetic. This is a short service-accounting observation, not a playback performance test, a minimum-memory requirement or sustained acceptance.

The diagnostic VNC viewer was stopped before collection. The [listener receipt](stability/listeners.txt) shows only SSH and no VNC listener. The first process sample still lists `x11vnc` with zero RSS; it is absent from the later samples. That entry is retained rather than claiming complete process absence throughout. Audio was [verified muted](stability/mute.txt). These observations do not establish a visible native UI.

## Packaged helpers and loaded host graphics libraries

The corrected [helper collector](helper-scripts/helper-probe-user.sh) completed at 01:15:01 UTC as the `couch-tv` runtime user. It reads helpers from the application's existing FUSE mount. All three [measured helper hashes](helpers-runtime-user/helper-sha256.txt) match production A's installed build metadata. Executed version commands report Deno `2.9.6` and yt-dlp `2026.08.19`. Packaged ffprobe parsed a silent one-second WAV fixture as 8,000 Hz mono `pcm_s16le`, with empty stderr. See the [probe output](helpers-runtime-user/ffprobe.json) and [verified summary](helpers-runtime-user/summary.json). This inspected audio metadata; it played no audio. The sink remained [muted](helpers-runtime-user/mute.txt).

The [first collector](helper-scripts/helper-probe.sh) attempted to check the runtime user's FUSE mount as root and stopped before any helper ran. Its [original receipts](helpers-first-attempt) contain only the discovered mount and empty collector output. Correcting those access checks to run as `couch-tv` changed the collector only. This first failure was a collector access mistake, not an application failure or a helper repair.

The running [main process](helpers-runtime-user/graphics-12208.txt) and [WebKit web process](helpers-runtime-user/graphics-12269.txt) map GLESv2, GL, EGL, Mesa and DRM libraries from `/usr/lib/x86_64-linux-gnu/` on the Debian host. These are observed runtime mappings after the diagnostic `libgles2` repair. They confirm that the running processes load the host graphics libraries; they do not establish visible rendering, accelerated playback or GUI acceptance.

The same packaged ffprobe also completed a [bounded HTTPS stream probe](external-helper/collector.sh) against `https://radio.syg.ma/audio.mp3`, a station in the bundled playlist. It ran from 01:16:05 to 01:16:09 UTC, exited 0 with empty stderr, and reported [MP3 audio at 44,100 Hz with two channels](external-helper/ffprobe-stream.json). Mute checks passed [before](external-helper/mute-before.txt) and [after](external-helper/mute-after.txt). No audio-output or playback command ran. This proves that the packaged network helper could inspect that external stream at that time; it is not Couch playback acceptance.

## Limits and retention

This was a first LightDM session start and later service observation, not a host reboot. These files do not establish visible UI, playback, hardware acceleration, sustained service health, an A-to-B signed update or recovery. The earlier public installation occurred while the Mac was offline; this later diagnostic repair is not part of that offline interval.

Original first-session receipts remain in `.artifacts/acceptance-277/t480/first-session-original/receipts`. Original failure, repair and green receipts remain in `.artifacts/acceptance-277/t480/gles-original/receipts`; the later checksum and stability originals remain in `.artifacts/acceptance-277/t480/stability-original/receipts`. Helper originals remain in `.artifacts/acceptance-277/t480/helper-probe-original`, `helper-probe-user-original` and `external-probe-original`. Evidence retention only archived and read those directories; it did not alter the runtime, viewer or session.

[Retention metadata](retention.json) records original and retained SHA-256 values. All 65 retained source files are byte-identical to their originals. Actual credential-value and private-identifier scans found no material requiring redaction. [SHA256SUMS](SHA256SUMS) covers this directory. No private transport helper, credentials or app data are included.
