# Installed helper preparation

Both clones passed the mounted helper checks after their unchanged installers exited 0. The minimal run retains one earlier harness permission failure. These results use the retained disposable signing key and establish no production, hosted update, GUI, playback or Mac-offline acceptance.

The installed artifact is `Couch_0.1.0-preview.1_amd64.AppImage`, SHA-256 `58ed2f8d8907e19b28dd147c60d70469df6b3a10515b79a5f1435f88f897ed25`. Its signed source revision is `7ff0aeaff2ac41e4a8e068fa0243e42e78df3900`. Later qualification-tool changes do not change that identity.

## Method

[helper-probe.py](helper-probe.py) mounts the installed AppImage with its standard `--appimage-mount` runtime and executes the three packaged helpers as the installation's runtime account. It sets `APPDIR` to that mount and `LD_LIBRARY_PATH` to its `usr/lib`, matching the bundled library directory used by package runtime checks. This independently exercises helper binaries; it does not establish that native application startup passes the right environment to those helpers.

The probe compares helper hashes against installed signed build metadata, records `ldd` output, evaluates `console.log(6*7)` with Deno, prints the yt-dlp version and asks ffprobe to identify a generated one-second silent WAV. The fixture has one channel, an 8,000 Hz sample rate and signed 16-bit little-endian PCM samples. It requires no network source, package additions, source build or AppImage extraction. The probe stops its mount afterward.

The Xfce run first mounted and inspected the packaged launch scripts over SSH, then used that same mount for the saved probe. The copied launch scripts document that inspection. All output remains in the original receipts, including empty stderr and explicit exit codes. The VM clock recorded 2026-09-14 23:08:51 through 23:10:07 UTC, corresponding to September 15 in Europe/Rome.

## Xfce result

VM `C8DD4D22-CDFB-4BEC-AA3B-BE7EE2C21B78` ran the installed `/home/probe/.local/lib/couch/Couch.AppImage` as `probe`, UID 1000. [The summary](xfce/helpers/summary.json) records exact paths, hashes, commands and durations.

| Check | Result |
| --- | --- |
| Standard FUSE mount | Passed, `/tmp/.mount_Couch.FPIiag`. |
| Three helper hashes | Each matched its signed build metadata. |
| Three linkage checks | Exit 0, empty stderr, no missing libraries. |
| Deno evaluation | Exit 0, stdout `42`, empty stderr. |
| yt-dlp version | Exit 0, stdout `2026.08.19`, empty stderr. |
| ffprobe generated WAV | Exit 0, `pcm_s16le`, 8,000 Hz, one channel, duration `1.000000`, empty stderr. |
| Mount cleanup | Mount directory absent and no remaining mount process group. |

The [ffprobe output](xfce/helpers/ffprobe.stdout) and [mount cleanup receipt](xfce/helpers/mount-cleanup.json) support those results. These are functional checks under QEMU x86 emulation. Their durations do not establish native performance or hardware playback support.

## Minimal harness first attempt

The first command exited 2 before Python could open the probe script in `/home/probe/couch-277`. The `couch-tv` runtime account could not traverse the administrator's home directory. [The retained stderr](minimal/helper-harness-first-attempt/driver.stderr) and [attempt summary](minimal/helper-harness-first-attempt/summary.json) record that failure. No AppImage mount or helper command ran in that attempt.

The follow-up places the identical script in `/tmp` for runtime-user access. It changes only fixture placement. Installed bytes, guest permissions, packages and session settings remain unchanged.

## Minimal result

VM `19C197A2-BAE0-49B4-B487-2E5C515747A9` ran the installed `/var/lib/couch/application/Couch.AppImage` as `couch-tv`, UID 102. [The summary](minimal/helpers/summary.json) records exact paths, hashes, commands and durations. The VM clock recorded 2026-09-14 23:14:48 through 23:16:02 UTC, corresponding to September 15 in Europe/Rome.

| Check | Result |
| --- | --- |
| Standard FUSE mount | Passed, `/tmp/.mount_Couch.HJkKMJ`. |
| Three helper hashes | Each matched its signed build metadata. |
| Three linkage checks | Exit 0, empty stderr, no missing libraries. |
| Deno evaluation | Exit 0, stdout `42`, empty stderr. |
| yt-dlp version | Exit 0, stdout `2026.08.19`, empty stderr. |
| ffprobe generated WAV | Exit 0, `pcm_s16le`, 8,000 Hz, one channel, duration `1.000000`, empty stderr. |

The [ffprobe output](minimal/helpers/ffprobe.stdout) supports the media identification result. The [cleanup receipt](minimal/helpers/mount-cleanup.json) confirms the mount directory is absent and no mount process group remains. This checks the helper's metadata parsing, with the same emulation and playback limits as Xfce.
