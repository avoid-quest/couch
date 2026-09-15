# Corrected release on fresh minimal Debian

The public `0.1.0` Preview release installed successfully on a new clone of minimal Debian 13.7. The installed native service ran without restarting during the recorded three-minute observation, and its bundled helpers passed. Virtual audio mute verification failed. No playback was requested.

## Exact candidate and environment

- Source: `61739ad7ce782da5482067f16a5727306cd65d6a`.
- Published Preview release: `01M2H8T79E8KBGNXZ26640SMK6`.
- AppImage SHA-256: `dd50813112c9643faddeedee46889e8102965c97f5d77bfd43d45756a20c6a05`.
- Fresh clone: `1A01E320-8A02-4C8C-850F-48C539F6FCF1`, cloned from retained pristine minimal Debian `21D3726B-624A-484F-A87E-39CDE695F095`.
- Inherited settings: x86_64 Q35 emulation, default CPU configuration, 4 GiB RAM. These are test settings, not minimum hardware requirements.

The [baseline](baseline-summary.json) contains 321 packages, no failed system units and an empty dpkg audit. Couch, its runtime account and display-manager policy were absent. No compiler, Bun, Node, ffprobe or yt-dlp command was present. The baseline includes authentication and session-policy hashes, package versions, devices, security state and memory.

## Public installation

Only the trusted manifest and collector were staged from the Mac. The guest used its existing Wget to download the enrolled site key and all six public release assets over HTTPS. All sizes, hashes and three decoded Minisign signatures matched [the manifest](public-install/expected-manifest.json) before the unchanged signed installer ran with `--tv`. The bootstrap package operation installed only the documented `minisign` and `jq` verifiers.

The [installer receipt](public-install/installer-status.txt) records exit 0, from `01:30:16Z` to `01:34:33Z`. The installed AppImage matches the public artifact byte for byte. Its identity and hash are retained in [installed-build.json](public-install/installed-build.json) and [installed-appimage.sha256](public-install/installed-appimage.sha256). The corrected declared package set includes `libgles2`.

The resulting package list has 578 entries. No full desktop metapackage was installed. The four session entrypoints have mode `0755`, the runtime account is locked, and SSH/sudo policy hashes stayed unchanged. Package and policy receipts retain both sides of the operation. No repair or repeat installer execution was needed.

## First session and audio

After installation, the collector requested `systemctl start lightdm` once. It did not reboot the guest or operate a GUI. The native service became active at `01:35:05Z`; the final observation at `01:38:12Z` records the same PID `8355`, `NRestarts=0`, and active/running state. The final cgroup memory observation was 559,075,328 bytes. This is one startup observation, not a five-minute idle or hardware performance result.

The only sink was PipeWire's suspended `auto_null` sink. The immediate [mute receipt](public-install/audio-mute.txt) reported `Mute: no` after the set request. A separate [bounded confirmation](first-session/mute-confirmation.stdout) still reported `Mute: no` in ten one-second polls and exited 1. The final observation also reported unmuted. Zero volume was not measured. The VM had no physical audio device, and neither the session collector nor helper probe requested playback. This evidence does not establish working mute behavior.

## Installed helpers

The runtime user mounted the installed AppImage through its standard FUSE runtime. [Helper receipts](helpers/summary.json) record actual mounted paths, SHA-256 matches against the installed signed build, and successful `ldd` checks. Deno evaluated `6*7` as `42`; yt-dlp reported `2026.08.19`; bundled ffprobe identified a generated one-second, mono, 8 kHz PCM s16le silent WAV. All six commands exited 0. The fixture was inspected, never played. The [mount cleanup receipt](helpers/mount-cleanup.json) confirms its removal.

## Cleanup and limits

The [guest shutdown](final-shutdown.json) exited 0. [UTM's final state](final-vm-state.txt) confirms the fresh minimal clone stopped with its installed state preserved. The separate Xfce VM remained under the parent task's control.

This run does not qualify native GUI interaction, local setup, pairing, external playback, updates, a host reboot, Mac-offline operation, physical graphics/audio or minimum hardware. The virtual mute failure remains unresolved and must not be counted as a pass.

[Source-to-retained hashes](source-retained-hashes.json) identify each copied receipt and whether redaction changed it. Private IPs, MAC addresses, cookie/authorization values and non-channel URL queries are redacted. `secret-scan.json` records the export scan; `SHA256SUMS` covers this retained folder.
