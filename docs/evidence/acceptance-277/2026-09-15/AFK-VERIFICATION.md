# Release and device verification

The owner authorized publication, Actions after local checks, follow-up merging, and the fresh T480 as an installation/runtime consumer. The owner then requested all feasible unattended checks with muted playback. The T480 never built Couch. No separate publication reviewer was added, and the owner deferred the offline signing-key backup.

## Results established so far

| Check | Outcome |
| --- | --- |
| Production A public delivery | Preview `0.1.0-preview.1`, source `3f91c0564bbbeea04eef421977f2e67b17c8fb14`, signed assets and Preview readiness verified. |
| Website | A deployment and enrolled public key were verified. Site files now advertise corrected Preview `0.1.0`, after an independent hosted recheck and a successful website build; the main deployment is checked after merge. |
| Fresh T480 public installation | Passed while the Mac was demonstrably offline. All six release files and the public key arrived over HTTPS; signatures and exact identities passed. |
| First T480 TV startup | **Failed:** WebKit aborted because `libGLESv2.so.2` was absent. This original failure remains acceptance evidence. |
| Diagnosis and fix | Installing only Debian `libgles2` made the same public A AppImage run. The installer fix is merged in PR #291, source `61739ad7ce782da5482067f16a5727306cd65d6a`. |
| Regression | Real APT in clean Debian amd64: original package list failed the GLES loader probe; corrected list passed with only `libgles2` added. The mocked installer fixture also passed. |
| Repaired T480 stability | Same process and zero restarts during a 60-second sample; 54,291,000 ns CPU delta, about 0.0905% of one CPU; service memory 570,839,040 bytes. These are pre-onboarding measurements. |
| Packaged helpers | All three running-mount helper hashes match A. Deno and yt-dlp execute. Packaged ffprobe identifies a silent WAV and an actual HTTPS radio stream. No audio playback was requested. |
| Loaded graphics | Couch and WebKit process mappings show GLES, GL, EGL, Mesa and DRM libraries supplied by Debian. |
| Corrected B on pristine minimal Debian | Public download/signature checks and the unchanged TV installer passed. Session startup remained active with zero restarts; helpers passed. The VM dummy sink did not confirm mute, so audio behavior remains unverified; no playback was requested. |
| Fresh Xfce public installation | Passed using documented desktop installation. Login/session policy remained unchanged. GUI login could not be completed with the available native input controls. |

The physical first-start check used `systemctl start lightdm`; it is not reboot acceptance. The repaired T480 run is not a pristine pass. A remains installed on that machine so its normal hosted update can be tested after first-use setup.

## Release identities

- A AppImage: `d67dab162272ab340d42a6ee70d7a35055696e99be2a8b0cb87edceb60c55ef7`.
- The first final-version B, source `bb03a3a54f5ca2a1664cd6235c61cf39e4fa5a7e`, was never published. Its original bytes and qualification matrix are preserved under `mac-production-b`; it shared the missing GLES prerequisite.
- Corrected B is built separately from source `61739ad7ce782da5482067f16a5727306cd65d6a`, version `0.1.0`. Its AppImage is `dd50813112c9643faddeedee46889e8102965c97f5d77bfd43d45756a20c6a05`. Qualification passed and all six assets were published to Preview at `2026-09-15T01:27:37.909Z`, release `01M2H8T79E8KBGNXZ26640SMK6`. All nine Preview readiness checks passed at `2026-09-15T01:29:22.138Z`; one HTTP 429 was retried after its 60-second delay. Both public archives and every one of the 2,033 actual AppImage inventory entries passed content/hash checks on a case-sensitive Linux filesystem, with zero credential findings.

## Checks needing a working native UI or physical interaction

The Mac native controls repeatedly returned missing-window/timeouts or failed to complete input. The temporary T480 viewer was limited to loopback and SSH, then stopped; its tunnels were removed. A browser attempt to read a temporary local credential was rejected by the browser URL policy and was not bypassed. No native setup state, pairing token, application database or updater acknowledgement was fabricated.

Consequently these remain unrun: visual native first-use, desktop GUI launch, real Couch playback, browser pairing and roles, native remote isolation/recovery, signed hosted A-to-B installation while the Mac is offline, retained user-data/reconnect checks, idle/manual update behavior and physical interruption/recovery scenarios. The component test suites do not substitute for those acceptance runs. Physical reboot, lid/display/audio-route checks and Stable promotion also remain unrun.

The final T480 observation at `01:38:01Z` still showed the same process, zero restarts, its actual sink muted at zero volume, and only SSH listening. Test VMs were shut down while retaining their installed states.

On return, complete native first-use on the T480 with **This computer**, retaining mute. That enables the ordinary local and paired-controller update flows for subsequent testing. The existing `couch-sudo` shell is preserved; reboot has deliberately not consumed that access. Check audible output and physical hardware behavior under direct supervision.

Issues #276 and #277 remain open. The original startup failure and the unrun update/GUI cases prevent a claim that the whole release acceptance gate passed.

## Hosted capacity

The configured Blacksmith workflow built and qualified an earlier production candidate, but GitHub artifact storage quota prevented its artifact handoff and publication. Its first-failure receipts remain under `hosted`. The final signed candidates used the preserved Mac Debian build cache. No further Actions runs or artifact deletions were used to work around that quota. Local `act` verification of the workflow and cache changes remains in the earlier evidence; no hosted cache-hit result is inferred from it.

## Hosted version metadata

The Preview feed offers signed B to A and returns no offer for equal B. When queried with a higher version it still returns B metadata; the locked Tauri client uses a strict newer-version comparator, but installed-client rejection remains unrun. Stable returns 404 because no Stable release has been published. These four small metadata requests did not install an update or fetch another AppImage.
