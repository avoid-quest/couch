# First-run phone setup qualification

The source for [Complete first-run TV setup from a phone](https://github.com/avoid-quest/couch/issues/23) passed a disposable Linux ARM64 native journey on 2026-09-08. Installed T480 acceptance remains open.

The tested build is the clean combined revision `59623d339d378ba55ea1094e698a3b76ee86cd91`: merged Sound/main `c2053b0dfb89bc5d8519aa9ef7ef5572a2f5cb00`, Search `f5d8fd37acfa836a905902528188b0018d4d40fd`, and onboarding source through `487db909e82f8137cb6389b029d579cc7bc14a35`. General Settings tests, Sound store fields and General restart tests were retained when joining. Test-file naming and later fixture-only corrections do not change the compiled application.

| Artifact | SHA-256 |
| --- | --- |
| Native Couch | `67edd6f22cdbf001e05da476584beb512e3f8f366c1c35ecd8cde9ff2a02b48a` |
| Bun sidecar | `9c659d1182249e94a73e706d63df2a4195556b34f467a346ed1997071f57b090` |

The build reused private copies of the released Sound Rust caches. Compilation was capped at 5 GiB, then runtime at 4 GiB. The Ubuntu 24.04 fixture used Xvfb/Openbox at 1600 × 1000, PipeWire/WirePlumber, a Pulse-compatible null sink, official Tauri/WebKit WebDriver, and one real HTTP phone browser at 390 CSS pixels. It used no production automation endpoint.

## Passed behavior

The final journey passed 41 named checkpoints plus responsive layout, captured audio and native video-pixel assertions:

- Fresh TV welcome displays its address QR and distinct pairing/administrator codes. The paired phone automatically opens the claim step, claims once and saves the shared name.
- The TV follows the phone's saved step. Native/coordinator restart at Screen and a phone browser refresh resume there without repeating the claim.
- Existing Display Settings performs a real X11 preview and confirmation. Existing Sound Settings selects a virtual output and runs the actual three-second test; its monitor captures non-silent PCM.
- The optional sources step reuses Folder/Jellyfin controls and can finish without adding a source. The entire journey also passed with the disposable container disconnected from every Docker network, no network route, and only loopback communication between the local TV and test phone. This explicitly verifies completion without Internet access.
- Normal Folder Settings registers and scans a generated local video after completion. The phone plays it through native mpv, blue video pixels are observed on the virtual screen, and the phone stops playback.
- A second native/coordinator restart retains the pairing, TV name, completed state and normal home without autoplay. Ordinary Settings remains available.

Source validation passed 115 focused tests and 977 assertions in the joined tree, including controller/store behavior, real authenticated HTTP/WebSocket updates and restart, General and onboarding Settings, Sound routing and Search. Ordinary source typecheck passed. The native fixture was also checked with an explicit TypeScript include because the normal project configuration excludes `tests/linux`. The onboarding-only delivery was then rebased onto merged main `d77af244cf6d1f6aab872e2fee0a11897284815f`. Its 109 focused tests and 863 assertions passed with typecheck. Adding back the separately owned Search source delta reproduced every byte under `src` and `src-tauri`, plus `package.json` and `bun.lock`, from the qualified joined revision. The only newer scripts were the already merged recovery qualification fixtures; build scripts were unchanged. Both existing General Settings tests and onboarding tests remain present.

## Fixture corrections and retained evidence

No production correction was needed during native qualification. Early wrapper attempts lacked the standard session packages/runtime directories required by WirePlumber, then the X11 session flag and `xrandr` needed by display selection. The application retained its setup step and displayed the display error. Later fixture corrections awaited the build-identified WebSocket URL and used the actual `Stop playback` accessibility label. Test failures and their logs were retained separately from the passing receipt.

The private evidence directory is `/tmp/couch-onboarding-search-qualification-20260908-artifacts`. It contains `source.bundle`, build metadata, binary hashes and copies, `run.sh`, `journeys.sh`, dependency logs, failed attempts, an online passing run, empty-network/route receipts for the final offline run, the final `onboarding-acceptance.json`, captured tone PCM, a native video screenshot and completed phone Settings screenshot.

The other native entrypoints explicitly seed configured fixture state before their existing playback/claim tests. Package fixtures also start configured. This does not count as onboarding acceptance, does not change controller roles and provides no production setup bypass.

## Remaining target acceptance

This run does not qualify an installed x86_64 AppImage or the T480's physical screen, audible sound, local-item playback and machine reboot. Those observations remain required before closing the issue. No installed target or existing user data was changed.
