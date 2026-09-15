# T480 signed update acceptance

The real T480 completed a signed hosted update from production A to corrected B while the Mac was offline. The initial update failure was reproducible with Stable selected. Changing the channel to Preview through Couch's supported settings API restored release discovery. Compatible isolated recovery and a full isolated idle update passed; a corrupt-candidate error-reporting gap and remaining acceptance checks are unresolved, so issues #276 and #277 remain open.

## Tested builds

| Build | Version | Source revision | AppImage SHA-256 |
| --- | --- | --- | --- |
| A | `0.1.0-preview.1` | `3f91c0564bbbeea04eef421977f2e67b17c8fb14` | `d67dab162272ab340d42a6ee70d7a35055696e99be2a8b0cb87edceb60c55ef7` |
| B | `0.1.0` | `61739ad7ce782da5482067f16a5727306cd65d6a` | `dd50813112c9643faddeedee46889e8102965c97f5d77bfd43d45756a20c6a05` |

[Initial build](initial/build.json), [initial installed hash](initial/appimage-sha256.json), [running B](hosted/after-install-build.json) and [installed B hash](hosted/installed-sha256.json) retain both identities. B is the corrected Preview release `01M2H8T79E8KBGNXZ26640SMK6`. The target consumed published packages and did not build Couch.

## Reproduced failure and correction

The [initial update state](initial/updates.json) records Stable, Manual, failed status, no successful check, no candidate and no installation transaction. Its complete error is:

> Could not fetch a valid release JSON from the remote

The owner confirmed the same error and selected settings on the original paired phone. Automated reproduction used a separate normally paired LAN verifier. Its [Controller access received HTTP 403](red/controller-rejection.json); after authorized promotion, its [identity was Administrator](red/administrator.json). [The repeated check](red/check.json) ended in [the same error](red/after.json). The local [initial identity capture](initial/identity.json) has host authority and is not a phone-role receipt.

Couch's native updater constructs `https://cdn.crabnebula.app/update/avoid-quest/couch/linux-x86_64-appimage/0.1.0-preview.1`. Stable uses that URL without a channel query; Preview adds `?channel=preview`. See `src-tauri/src/appimage_update.rs`, `update_url()` and `check()`, and `src/server/updates.ts`, the authorized check/channel handlers.

Independent requests made on the T480 established:

| Channel | HTTP | Response | TLS / redirects / retries | Receipt |
| --- | --- | --- | --- | --- |
| Stable | 404 | `application/json`, empty body | Verification succeeded, zero redirects, zero retries | [Request](provider/stable-request.json), [headers](provider/stable-headers.json), [body](provider/stable-body.json) |
| Preview | 200 | `application/json`, 1,025 bytes, B metadata | Verification succeeded, zero redirects, zero retries | [Request](provider/preview-request.json), [headers](provider/preview-headers.json), [body](provider/preview-body.json) |

No Stable release had been published. The empty 404 explains the selected feed's failure to provide release metadata. These are independent T480 curl probes, not decrypted captures of Tauri's HTTPS exchange. The source-derived endpoint, repeated installed-client failure and successful check after the channel correction support the diagnosis. The probes provide no evidence that TLS, redirects or rate limiting caused this reproduced failure.

The channel correction used `/api/updates/channel`, the same supported API used by Settings. It preserved setup and pairing. The [channel correction returned HTTP 202](green/channel-fix.json) and launched a check. The same Python reproduction command polled until [the result was available with a current successful check](green/after.json), so its final success assertion passed. Its extra [explicit check POST returned HTTP 409](green/check.json) because the channel-triggered check was already running. This is not an accepted second check request. [The green timestamp](green/time.json) is 08:27:32.391643 UTC. The coordinator retains the unchanged `repro.py` command source separately; the red and green state receipts establish failure before correction and success afterward. This was a configuration correction, with no binary or source patch. The original failure remains retained separately.

## Signed hosted outcome with Mac offline

[The Mac observer](offline/events.json) records Wi-Fi off and no selected default-route interface from `08:37:30.717470Z` to `08:47:30.786852Z`. Public probes at the interval boundaries failed with curl 6 / HTTP 000. After restoration at `08:47:36.183576Z`, the public probe returned 200. The Mac stayed powered on. A later [clock sample](offline/clock-offset.json) estimated the target ahead by 0.276 seconds, with 0.166 seconds of timing uncertainty. It was measured after the update and does not retroactively establish a pre-run offset.

The independent T480 collector ran inside that interval:

| UTC event | Outcome |
| --- | --- |
| 08:37:58.170 | Signed hosted download requested |
| 08:38:07.217 | Download verified and ready |
| 08:38:13.818 | Manual install requested while playback remained active |
| 08:38:16 | Request failed safely, requiring playback-interruption confirmation |
| 08:38:18.318 | After playback stopped, installation requested |
| 08:38:22 onward | Verifier observed temporary loss of connection during replacement/restart |
| 08:38:40 | Terminal transaction became `succeeded` on expected B |
| 08:38:44.309 | Collector completed post-update checks |

[Target events](hosted/events.json) retain download progression and reconnect attempts. [The terminal receipt](hosted/terminal.json) records request `97670d2d6c9e40f195b717fdeacc3ef0`, B's revision/version and no error. This establishes actual replacement and healthy expected running build, rather than an accepted request or staged file alone.

[Retention results](hosted/retention.json) compare 42 database tables: 41 match exactly, including settings, pairing, sources, queue and viewing progress. Only diagnostic history differs. No database contents were exported. [Controller summaries](hosted/after-install-controllers.json) retain roles/counts, and [settings summaries](hosted/after-install-settings.json) record equality without exposing the installation name. [Before](hosted/before-install-session.json) and [after](hosted/after-install-session.json) retain a three-entry queue with the player idle and volume zero. The verifier reconnected using its existing pairing. This automated reconnect receipt is distinct from a physical observation on the owner's phone.

## Coverage at this checkpoint

| Check | Status | Exact build and evidence / limit |
| --- | --- | --- |
| Native setup persistence | Passed within recorded state | A to B; [before](hosted/before-install-session.json), [after](hosted/after-install-session.json), administrator claimed and saved setup step retained. `setupStep: general` is not a completed-wizard claim |
| Native audio-fixture and video playback | Passed decoding/advancing-player observation | A [audio-fixture samples](playback/playback-play-1789461151892.json) advance to 33.1 seconds; B [selected video track](video-playback/playing.json) playing at 0.292 seconds. Physical media-image/audible output unconfirmed; HDMI Couch UI confirmed |
| Packaged helpers | Passed A and B execution | [Prior A](../t480-gles/helpers-runtime-user/summary.json), [B runtime execution](helpers-b/runtime.json), [B helper hashes](helpers-b/hashes.json); Deno, yt-dlp and ffprobe all exit 0 |
| Original update error reproduced | Passed | A; [red state](red/after.json) reproduces exact Stable failure |
| Original Stable check | Failed | A; no published Stable metadata; original failure preserved |
| Original phone Updates UI after reboot | Passed owner observation | B; [owner confirmation](final-hardware/owner-phone-updates-confirmation.json): version 0.1.0, Preview, Manual and no release-JSON error |
| Supported Preview correction | Passed | A discovers B; [green check](green/after.json) |
| Controller rejection / Administrator access | Passed | A and B; [A identity](red/administrator.json), [B guard matrix](controller-guards/verdict.json), GET updates and POST check/policy/channel/stage/install all 403 while Controller |
| Signed hosted update, Mac offline | Passed | A to B; [observer](offline/events.json), [target events](hosted/events.json), [terminal receipt](hosted/terminal.json) |
| Manual playback safety | Passed | A; [failed busy request](hosted/busy-terminal.json), [continued session](hosted/after-busy-session.json). Failure required confirmation before interruption |
| Paused playback defers idle installation | Passed | A; [idle state](hosted/idle-paused.json) explicitly waits for playback to stop |
| Ten continuous idle minutes, activity reset and automatic installation | Passed in isolated native desktop run | A to B; [events](idle-interruption/events.json), [terminal success](idle-interruption/terminal.json), [health](idle-interruption/health.json). Xvfb and seeded local mode; no physical/first-use claim |
| Interrupted download | Passed in isolated native desktop run | A preserved at 511 downloaded bytes; [progress](idle-interruption/interrupted-progress.json), [restart](idle-interruption/restarted-after-interruption.json), [unchanged installed hash](idle-interruption/candidate-after-interruption.json) |
| Pending import and native loading idle guards | Passed in isolated native desktop test | A with B staged; [real import](activity/import-guard.json), [native loading](activity/loading-guard.json) defer installation |
| Real library scan idle guard | Passed in isolated native test | [Scanning source and update wait](scan-guard/guard.json), [completed scan](scan-guard/scan-completed.json), [cleanup](scan-guard/cleanup.json) |
| Radio reconnect activity | Unrun; fixture precondition failed | [Mute timeout](radio-reconnect/FAILURE.json) prevented playback; [standard null-sink alternative](radio-reconnect/null-sink-attempt.json) also remained unmuted at 100% |
| Late admission input and recordings | Unrun | Idle reset, imports, loading and scans do not prove these distinct cases |
| State retained and no autoplay | Passed | A to B; [41 equal tables](hosted/retention.json), [idle post-update session](hosted/after-install-session.json) |
| Corrupt staged candidate safety | Passed in isolated native desktop tests | [Restart/check rejection](corrupt-candidate/case1-check.json), [pre-acceptance install rejection](corrupt-candidate/case2-http-rejection.json); current A preserved |
| Useful corrupt-candidate error | Failed | [HTTP 400](corrupt-candidate/case2-http-rejection.json) hides native verification cause behind a generic request error; follow-up required |
| Insufficient storage native preflight | Passed in isolated native desktop test | [Inputs](storage/preflight-inputs.json), [safe terminal rejection](storage/transaction.json), [cleanup result](storage/RESULT.json); original harness failure preserved |
| Equal-version installed check | Passed | B; [successful check with no candidate](equal-check-state.json) |
| Lower/skipped releases and Preview-to-Stable behavior | Unrun | Prior metadata observations do not prove these installed-client journeys |
| Native reboot and hardware settings persistence | Passed API/service evidence | B; [final boot](final-hardware/attempts.json), [HDMI](final-hardware/display.json), [C39S](final-hardware/bluetooth.json), [muted selection](final-hardware/sound.json), [existing verifier check](final-hardware/updates.json). Owner confirmed TV visible and original phone reconnects without repair |
| Physical HDMI display | Passed owner observation | B; [HDMI-2 selected](physical/hdmi-connected.json), 1920×1080 at 74.99 Hz; owner confirmed Couch visible |
| C39S Bluetooth pairing and muted playback routing | Passed | [Paired/trusted/connected](physical/c39s-pairing.json), [observed route matches selected C39S](physical/c39s-route-active.json), [actual Pulse stream](physical/c39s-pulse-active.json); volume zero, no audible test |
| Lid closure and phone control | Passed owner observation | B; [closed-lid service](physical/lid-closed-service.json), owner closed lid for ten seconds/reopened and confirmed TV and phone kept working |
| HDMI disconnect/reconnect | Passed | B; [observed transitions](physical/hdmi-reconnect-transitions.json), owner confirmed Couch returned and phone worked |
| Audible output | Unrun under mute constraint | Selected/observed C39S route verified silently; no unmute performed |
| Compatible local recovery, missing binary, bad retained checksum/signature | Passed in isolated desktop installation | Signed B to A; [recovery result](recovery/RESULT.txt), [compatible restore](recovery/compatible-B-to-A.log), [missing binary](recovery/missing-binary.log). Production B untouched; no GUI recovery claim |
| Incompatible-current-metadata guard | Passed simulation | [Rejection](recovery/incompatible-current-metadata.log); A/B both read format 1, so no genuinely incompatible signed binary tested |
| Actual replacement interruption and failed-start recovery | Passed in isolated native desktop tests | [Partial replacement](fault-replacement/interrupted.json), [failed trial](fault-startup/interrupted.json), retained local recovery and no autoplay; original harness failures retained below |
| Failed-candidate automatic retry suppression | Passed in bounded isolated observation | [Replacement](fault-replacement/suppression.json), [startup](fault-startup/suppression.json), restored transactions and explicit suppressed status; no long-duration observation claimed |
| Fresh pristine T480 installation | Failed original run | A originally required a separate libgles2 repair. This update does not relabel that run pristine |
| Native own update with unreachable saved remote | Passed in isolated seeded remote-mode test | A to B; [terminal success](remote-own-update/terminal-success.json), [corrected verification](remote-own-update/corrected-verdict.json), observed IPv4 loopback maintenance and no media database |
| Full desktop profile and native remote GUI acceptance | Unrun here | Prior Xfce GUI and interactive remote selection/pairing/privilege-isolation gaps remain |
| Missing hosted artifact / wrong target / unmet new host prerequisites | Unrun in installed update path | Stable metadata 404 and original GLES installation failure do not cover these download/preflight cases |
| Genuinely incompatible signed recovery app | Unrun | A/B both use format 1; only the isolated incompatible-current-metadata guard was simulated |
| Local native update controls and remote target privilege isolation | Unrun as complete UI journeys | API authority and seeded own-update maintenance isolation are covered; interactive selection/pairing, remote-page privilege isolation and local GUI control need separate acceptance |
| Personal/shared mode and address behavior | Unrun as complete matrix | Phone pairing is exercised; sharing-off, IP/custom-domain changes and native remote isolation are not established by this run |
| Public signed assets, complete inventory and readiness | Passed earlier for A/B | [A readiness](../mac-production-a/hosted-release/readiness-preview.json), [B readiness](../mac-production-b-gles/hosted-release/readiness-preview.json), prior inventory/signature receipts; no new release published here |
| Stable promotion | Unrun | No unchanged-byte promotion or Stable readiness receipt here |

[Player-only playback receipts](playback/) retain status, position, duration and volume samples without titles or source paths. They can support advancing-player observations when paired with the coordinator's test description, but do not establish audible output or identify an external source by themselves.

Safari subsequently rendered the pairing page after loading. Its earlier blank view was temporary; no browser defect was diagnosed. This does not by itself prove a paired Safari update journey.

## Isolated recovery and launcher limitation

A separate locked account received ordinary signed B setup. [The first setup attempt](recovery/desktop-setup.log) ran from an SSH environment declaring a tty and rejected the missing X11 session. The harness then provided X11/Xvfb and [the unchanged desktop setup passed](recovery/desktop-setup-x11.log). The initial rejection is a harness precondition result, not a product installation failure or a pristine graphical desktop qualification.

The real retained recovery command, run for that isolated account, rejected [a bad checksum](recovery/checksum.log), [a bad signature](recovery/signature.log) and [simulated incompatible current metadata](recovery/incompatible-current-metadata.log). It restored signed A from B [normally](recovery/compatible-B-to-A.log) and [with the installed binary missing](recovery/missing-binary.log). The [result](recovery/RESULT.txt), [fixture hashes](recovery/data-before.sha256), [compatible data check](recovery/compatible-data.log) and [missing-binary data check](recovery/missing-binary-data.log) retain evidence that newer fixture file and SQLite bytes survived. No production database contents were used or exported. Both real A and B use data format 1; altering isolated current metadata tests the guard, not a genuinely incompatible signed binary. Recovery used local retained bytes, but these receipts do not independently show expired provider assets.

A separate isolated desktop update reached [trial](recovery/launcher-interruption/transaction.json). The coordinator traced its relaunch interruption to the test's transient systemd unit using the default `KillMode=control-group`, which killed the relaunched child when its parent exited. Manual launch of B completed [the same transaction successfully](recovery/launcher-interruption/resumed-terminal.json). This preserves the original interrupted trial and repaired result. It does not pass normal desktop automatic relaunch, intentional interruption during actual replacement, or full failed-start recovery. The subsequent successful idle run used a corrected test launcher, described below.


## Completed isolated idle run

The isolated desktop installation used the real signed A and B AppImages, Xvfb and seeded local mode. It does not establish graphical first-use, a physical display, an ordinary user's desktop profile or phone reconnection. [The source identity](idle-interruption/source-identity.json) records the coordinator's retained test script hash.

At `09:00:33.155588Z`, the test stopped the native app after 511 of 289,110,520 download bytes. [The original progress](idle-interruption/interrupted-progress.json) remains retained. Restarted A [offered the candidate again](idle-interruption/restarted-after-interruption.json), without treating partial bytes as verified/ready. [The installed hash](idle-interruption/candidate-after-interruption.json) still matched A. The subsequent download completed normally.

At `09:01:00.512540Z`, activity reset the idle wait. [Before](idle-interruption/before-activity.json) and [after](idle-interruption/after-activity.json) receipts and [five-second observations](idle-interruption/events.json) record the real ten-minute wait. The native updater then installed B automatically, reconnected and received its native frontend health acknowledgement. [The terminal receipt](idle-interruption/terminal.json) records success at `09:11:18Z`, request `279c0dda3d464d83aca55295b59b931b`. [Running build](idle-interruption/build.json) matches B and [health](idle-interruption/health.json) reports an idle player. The collector completed at `09:11:21.032300Z`.

The corrected persistent fixture launcher retained the relaunched child using `RemainAfterExit` and `KillMode=process`. This successful native relaunch is scoped to that isolated launcher, separately from the earlier control-group interference. The production TV installation remained on B throughout these tests.

After the production reboot, [the initial provider request failed](reboot/reboot-updates-initial.json) during network startup. A later [current successful check](reboot/reboot-check-final.json) has no error, no candidate and the retained successful B transaction. The transient check failure did not prevent native service startup. These receipts establish API recovery, not a physical phone observation.


## Actual replacement and startup faults

Two later isolated tests exercised actual native update phases, separately from the earlier accidental launcher interference. Production B remained untouched.

- Replacement test `735a47e3ca2a4e78bd730ae5fc87d63e` stopped and killed the updater during `installing`. [The installed path contained only 52,789,248 bytes](fault-replacement/interrupted.json), below complete B's 289,110,520 bytes. [No native process remained](fault-replacement/native-after-fault.json). The real [local recovery command](fault-replacement/offline-native-backup-recovery.log) used its retained native backup and [restored A](fault-replacement/restored.json).
- Startup test `1f5cab2ad91041d681102f525a346fbb` removed the fixture display during [trial](fault-startup/interrupted.json), leaving [no native process](fault-startup/native-after-fault.json). The real command [restored retained A](fault-startup/restored.json) while preserving the newer isolated database write.

Both recovered applications returned healthy idle state with no autoplay: [replacement](fault-replacement/health.json), [startup](fault-startup/health.json). With idle policy selected, both reported that the candidate already had an automatic attempt and required operator review/manual action: [replacement suppression](fault-replacement/suppression.json), [startup suppression](fault-startup/suppression.json). The check was bounded to the observed interval; it is not a long-duration retry test.

Original harness failures remain separate. [The replacement assertion](fault-harness/couch-277-replacement-fault.log) accepted only one valid suppression wording, despite the captured result correctly suppressing reinstallation. [The corrected verdict](fault-replacement/corrected-verdict.json) records the broader valid assertion and retained newer write. [The first startup restoration attempt](fault-harness/couch-277-startup-fault.log) could not restart the already-removed transient Xvfb unit. Recreating that fixture as a persistent unit allowed [the supplemental verification](fault-startup/corrected-verdict.json) to pass. These corrections did not change Couch's production code or repair its updater logic.

The recovery commands consumed local native backups while Couch was unavailable. This establishes local recovery without fetching an old AppImage; it does not establish actual provider expiration. Newer-write hashes are retained in [replacement](fault-replacement/newer-data-before.json) and [startup](fault-startup/newer-data-before.json), with post-recovery verification recorded by the test verdicts/events. No fixture SQLite contents are exported.

## Production service sample

B's service stayed active with PID 1027 and zero restarts between [09:03:57](fault-harness/couch-277-idle-b-before.txt) and [09:09:51](fault-harness/couch-277-idle-b-after.txt), a 354-second interval. Recorded CPU usage rose by 45,945,582,000 ns, about 13.0% of one CPU over the interval. Cgroup memory rose from 1,750,679,552 to 1,797,148,672 bytes. These are actual service observations during the acceptance session, not minimum hardware requirements. The two service receipts alone do not independently establish all application activity was idle.


## Storage preflight and final check regression

An isolated tmpfs application directory had 784,613,376 available bytes against the native updater's required 1,136,204,334 bytes. [The inputs](storage/preflight-inputs.json) retain signed A's installed hash, B's size and live process identities. Request `848d82e1d38d4e99ae0b4dde6b432f50` reached [a terminal failed result](storage/transaction.json) with a specific storage error before shutdown. [The subsequent update state](storage/after-updates.json) still identifies running A. [The result](storage/RESULT.json) records the original application restored, isolated service stopped and production untouched. [The cleanup receipt](storage/cleanup.json) at 09:23:49Z shows the application path on the underlying ext4 root filesystem, with the original A hash restored, confirming the temporary application mount was removed.

The [original harness failure](storage/original-harness-failure.json) came from resetting an inactive/absent transient unit. [The first failure receipt](storage/FAILURE.json) remains separate from the resumed preflight pass. It was a fixture-control failure, not the updater's storage verdict.

Finally, the retained [public regression command](check-updater.py) ran against the existing paired LAN Administrator on actual B. [Stable failed](final-regression/final-check-red.json) with the original exact release-JSON error; [Preview passed](final-regression/final-check-green.json) with a current successful equal-version check and no candidate. Both explicit check requests returned HTTP 202 in this run. This final repeat removes the earlier green run's extra-request 409 ambiguity while preserving that earlier receipt unchanged.


## Final Controller and physical state

On actual B, the separate LAN verifier was temporarily demoted to [Controller](controller-guards/identity.json). [Read](controller-guards/read.json), [check](controller-guards/check.json), [policy](controller-guards/policy.json), [channel](controller-guards/channel.json), [stage](controller-guards/stage.json) and [install](controller-guards/install.json) all returned HTTP 403. The coordinator then [restored Administrator](controller-guards/administrator-restored.json). [The matrix passed](controller-guards/verdict.json) at `09:21:41.329904Z`; the owner's phone role was untouched.

[The display summary](physical/display-summary.json) records the built-in eDP display at 1920×1080, with HDMI and DisplayPort outputs disconnected. [The current structured audio receipt](physical/mute-current.json) verifies one built-in analog sink muted, with both front channels at zero, at `09:23:03Z`. This earlier snapshot predates the HDMI connection below. The later lid check passed; audible output remains unrun under the mute constraint.


## B packaged helpers

All three helpers executed successfully under `couch-tv` with [the actual running sidecar environment](helpers-b/runtime.json). Deno reported 2.9.6, yt-dlp reported 2026.08.19, and ffprobe inspected a 180-second PCM WAV fixture. [Each observed helper hash](helpers-b/hashes.json) matches the corresponding B build identity. Media paths and dynamic mount names are omitted from the export.

The coordinator's first direct-shell ffprobe launch lacked the AppImage runtime `LD_LIBRARY_PATH` and failed to locate libavdevice. Its retained stdout provided the helper hashes and other version outputs, but did not capture that stderr. The later actual-environment run passed without a source or package fix. The initial shell-environment failure is not relabeled as successful helper execution or a Couch packaging defect.


## Import and loading activity guards

A fresh isolated profile copied only saved local operating mode, then ran [native A](activity/build.json) under the [dedicated Xvfb fixture](activity/unit.json) with signed B staged. It did not copy the production database or exercise physical first-use.

A real pending radio import produced [the import guard](activity/import-guard.json), with the verified candidate still ready and installation waiting for the request to finish. A native player in loading state produced [the playback guard](activity/loading-guard.json), waiting for playback to stop. [The test passed](activity/RESULT.json). [Cleanup](activity/cleanup.json) restored Manual, removed the fixture queue entry and playlist, and stopped the dedicated service. [The coordinator's script identity](activity/source-identity.json) is retained without exporting application credentials.

These checks cover pending imports and loading playback. They do not establish recording, reconnect activity or an input arriving during admission closure. A later actual library scan test is recorded below.


## Owner HDMI confirmation and C39S configuration

The owner connected the TV and confirmed, "Yes, Couch is visible". [The new display state](physical/hdmi-connected.json) selects HDMI-2 at 1920×1080, 74.99 Hz. This is direct physical display confirmation on B, distinct from the earlier disconnected snapshot.

The supported Bluetooth flow [paired, trusted and connected C39S](physical/c39s-pairing.json). Couch then [selected C39S as the default output](physical/c39s-selected-no-stream.json). [The 09:27:39Z Pulse snapshot](physical/c39s-mute-no-stream.json) shows both built-in and C39S sinks muted with every channel at zero.

That snapshot has no sink input and no observed playback output. The coordinator's first silent-play request reused an existing queue identifier and was rejected with "That queue entry already exists". [The original rejection](physical/duplicate-entry-rejection.json) remains retained and does not pass actual playback routing. The subsequent supported play-existing-entry action produced [an observed C39S route matching the selected output](physical/c39s-route-active.json), with mute true and volume zero. [The 09:29:06Z Pulse capture](physical/c39s-pulse-active.json) independently maps the actual stream to C39S and retains muted sink/channel state. The stream itself has unity volume and is not muted; the actual C39S output sink is muted with zero channel volume, so the capture does not show audible output. This repaired run passes muted routing, without erasing the earlier rejected command. No audible test or unmute was performed. [The 09:29:49Z lid-closed observation](physical/lid-closed-service.json) retains the same post-reboot boot ID and PID 1027, active service, zero restarts and both sinks muted at zero. The coordinator could still use the API. The owner then confirmed the ten-second lid closure/reopen: "TV and phone both keep working". This passes the physical lid and phone-control check on B. HDMI disconnect/reconnect subsequently passed as recorded below.


## Corrupt candidate safety and diagnostic gap

Two further isolated native A checks used real signed B bytes with deliberate changes to the retained staged file. [Corruption before startup](corrupt-candidate/corruption-before-start.json) followed by [restart/check](corrupt-candidate/case1-check.json) left the candidate available but unready, rather than trusting the damaged file. After restoring and verifying the original bytes, [corruption after ready](corrupt-candidate/corruption-after-ready.json) caused an installation request to fail before acceptance.

[The observed HTTP result](corrupt-candidate/case2-http-rejection.json) was 400 with "The update request did not finish. Refresh status before retrying." No installation transaction was accepted, so this is not a terminal failed transaction. The [executed collector](corrupt-candidate/collector.py) asserts unchanged installed A bytes, native process identities and running build, plus no accepted transaction. It also checks SQLite integrity with `PRAGMA quick_check`, not database byte equality. [The safety verdict](corrupt-candidate/RESULT.json) passed; separate before/after hash or PID comparison files were not retained for this case. [Cleanup](corrupt-candidate/cleanup.json) restored original candidate bytes, restored Manual and stopped the isolated activity service.

The useful-error acceptance criterion fails here. Source inspection finds the native explanation "The saved download failed verification. Download it again.", but the HTTP handler obscured it. That native wording was not observed through the API and must not be substituted for the actual generic error. A follow-up must preserve a useful verification failure through the authorized API and verify the same corrupted-ready-file boundary before and after the fix. [The test script identity](corrupt-candidate/source-identity.json) is retained; no candidate AppImage was exported.


## HDMI cable recovery

The owner disconnected and reconnected HDMI, then confirmed, "Couch returns and phone works". [The independent 90-sample observer](physical/hdmi-reconnect-transitions.json) recorded HDMI-2 connected at 09:30:52, disconnected at 09:32:11 and connected again at 09:32:29. [The final display snapshot](physical/hdmi-reconnect-after.json) retains HDMI-2 and its mode. [The audio follow-up](physical/sound-hdmi-reconnect-after.json) retains the selected C39S output, mute true and volume zero. This passes display reconnection and owner-observed phone continuity on B; it does not claim audible output.


## Real library scan guard

[The isolated fixture](scan-guard/fixture.json) contained 500 ordinary video paths, one independent file copy and 499 hardlinks. The supported source and scan APIs started a real packaged scan on [native A](scan-guard/build.json), with B staged. [The guard receipt](scan-guard/guard.json) observes the source still scanning, advancing from 51 to 52 items, while the updater waits for the library scan to finish and has no installation transaction. [The scan completed](scan-guard/scan-completed.json), and [the result passed](scan-guard/RESULT.json).

[Cleanup](scan-guard/cleanup.json) restored Manual, deleted only the added source through the API, retained fixture files and stopped the isolated activity service. No database contents were exported. This is actual scan deferral, not an injected busy flag. Recording and late-admission/reconnect cases remain distinct and unrun.


## Final cleanup and hardware reboot

After retaining update-state comparisons, the coordinator [removed only three test queue entries and one test source through supported APIs](final-hardware/production-fixture-cleanup.json). The queue returned from three entries to zero; other queue identifiers were preserved and the fixture media file retained. The coordinator compared this with the initial empty queue before removal. This deliberate cleanup is separate from the earlier successful retention comparison, which still records the three test entries surviving the update.

The isolated account's lingering and test services/Xvfb were disabled or stopped before the final reboot, according to the coordinator. [Before reboot](final-hardware/before.json), both production outputs were muted at zero. [The final reboot observations](final-hardware/attempts.json) record temporary SSH loss, then boot `bbf735a7-2a78-4e8e-8a84-635eed47b303` at `09:35:47Z`, PID 1039, active service and zero restarts. Both outputs were still muted at zero.

[HDMI remained selected](final-hardware/display.json). [C39S remained paired, trusted and connected](final-hardware/bluetooth.json), and [the selected audio output stayed C39S with mute true and volume zero](final-hardware/sound.json). [The existing paired verifier's check](final-hardware/updates.json) ended with a current successful check on actual B; the initial post-boot provider request failure remains in the same receipt. The owner confirmed, "TV visible and phone reconnects", using the original phone without re-pairing or repair. No audible test or unmute occurred.


## Final checkpoint

At [09:37:11Z](final-hardware/installed-final.json), the production installed AppImage still matched B's exact hash and revision, and both outputs were muted at zero. [The temporary acceptance verifier was deleted](final-hardware/verifier-cleanup.json) through the API; deletion returned 200 and the revoked credential then returned 401. The original phone was not modified. [The final host runtime snapshot](final-hardware/runtime-final.json) confirms B, healthy idle playback, Preview/Manual with a current successful check and no error, and one remaining Administrator controller. Test installations and their local evidence remain isolated; no further production mutation is planned for this checkpoint.

After the merged baseline checkpoint, [the owner checked Updates on the original paired phone](final-hardware/owner-phone-updates-confirmation.json) and replied, "All four are correct", confirming version `0.1.0`, Preview, Manual and no release-JSON error. The observation was recorded at `09:45:02.337432Z`. This completes the original phone UI confirmation separately from the automated verifier checks.

The current release acceptance gate remains open. The concrete product gap is the generic corrupted-candidate HTTP error described above. Remaining unrun criteria include lower/skipped releases and Stable switching/promotion, recordings, reconnect activity, late admission input, new host-prerequisite and wrong-target checks, missing hosted artifacts, genuine incompatible signed recovery, remaining interactive native remote-mode behavior and pristine desktop qualification. Audible output was deliberately not exercised because playback stayed muted. Earlier pristine-startup failures remain separate from repaired runtime passes.

Only A and B are currently production-qualified/published versions in the retained evidence. A third higher signed version is required to prove a skipped release; a populated lower Stable channel is required for the proposed newer-Preview-to-Stable downgrade refusal. Those checks cannot be inferred from an arbitrary `current_version` provider query or edited build metadata.


## Follow-up radio reconnect attempt

The isolated radio reconnect test stopped before playback because it could not verify a muted default output. [The failure](radio-reconnect/FAILURE.json) is a timeout waiting for that prerequisite. [The result](radio-reconnect/RESULT.json) has `passed: false`; its original audio-description string named the intended fixture and must not be read as successful mute or routing verification. [Cleanup](radio-reconnect/cleanup.json) restored Manual, removed the fixture queue entry and stopped the radio activity service.

The coordinator also attempted PipeWire's standard `module-null-sink`, after the automatic dummy sink failed the same prerequisite. PipeWire documents [loading its built-in Pulse modules](https://docs.pipewire.org/page_pulse_modules.html) and [the null sink module](https://docs.pipewire.org/page_pulse_module_null_sink.html). These references establish the supported mechanism, not a successful test. [The alternative sink observation](radio-reconnect/null-sink-attempt.json) still reported unmuted channels at 100% after requested mute/zero volume.

No audio played, and the mute requirement was not relaxed. The production C39S and speaker mute settings were unchanged. Radio reconnect deferral remains unrun; this fixture precondition failure is not evidence that Couch's radio reconnect behavior failed.


## Follow-up native own update in remote mode

A final isolated test seeded remote mode with a saved loopback target that refused connections. [The fixture](remote-own-update/fixture.json) explicitly does not claim GUI selection, target pairing or remote-page privilege qualification. Native A kept its maintenance coordinator on [observed IPv4 loopback listeners](remote-own-update/maintenance-listeners.json), without creating a media database, and completed its own real signed hosted update despite the unreachable target. The collector inspected `/proc/PID/net/tcp`; these receipts do not establish absence of IPv6 listeners.

[The terminal receipt](remote-own-update/terminal-success.json) records request `7d084d68e81a47398b8f34a6bc116163` succeeded at `09:51:23Z` on B. The real native frontend acknowledged health; the collector did not post an acknowledgement. [Supplemental verification](remote-own-update/corrected-verdict.json) confirms B's exact archive hash and version/revision, changed native process, retained saved mode/fixture, absent media database, continued target refusal and retained known-good A recovery.

The initial [result](remote-own-update/RESULT.json) is false because [the collector](remote-own-update/collector.py) compared the entire running-build dictionary against only version/revision. B legitimately included `dataFormat`, so that assertion failed after terminal success. [The original failure](remote-own-update/FAILURE.json) remains unchanged. [The supplemental validator](remote-own-update/verify-corrected.py) checked the required fields and the remaining preservation assertions, producing the separate passing verdict. This corrects the harness assertion, not Couch or the original receipt.

[Final cleanup](remote-own-update/final-isolated-cleanup.json) at `09:52:47Z` records the test user manager inactive and lingering disabled. Production remained active with PID 1039, zero restarts and both sinks muted at zero. One final finite video check followed, recorded below.


## Final finite video playback check

Production [native B](video-playback/build.json) decoded the repository fixture `tests/fixtures/subtitles/replacement.mkv`, served through a temporary local HTTP fixture. [Player samples](video-playback/samples.json) reached [playing state at 0.292 seconds with a selected video track](video-playback/playing.json). This establishes native video decoding and advancing playback through Couch, not a separate owner observation of the media image on the TV.

[Before](video-playback/sound-before.json) and [during playback](video-playback/sound-playing.json), the selected output remained muted at zero. No audible test or unmute occurred. [The result](video-playback/RESULT.json) retains the fixture hash and confirms the temporary queue entry was removed and the HTTP fixture stopped. [The collector source identity](video-playback/source-identity.json) is retained. [The final read-only runtime snapshot](final-hardware/runtime-after-followup.json) confirms B healthy and idle, Preview/Manual, a current successful check with no error, one Administrator controller, and both C39S and built-in outputs muted at zero. No further T480 tests or mutations are planned after this check.

## Retention and scope

[Source map](source-map.json) lists each private source's SHA-256 and its sanitized output hash. JSON was normalized; controller names/identifiers were removed; controller and settings files became summaries; session/playback files retain player summaries only; curl output retains public request/status/TLS fields; private IPs were omitted. No credentials, SQLite files, raw settings, browser profiles or private snapshots were copied. Original local sources remain intact. [SHA256SUMS](SHA256SUMS) covers this report and retained evidence.

The [issue 277 checklist](https://github.com/avoid-quest/couch/issues/277), [hosted contract](https://github.com/avoid-quest/couch/issues/266#issuecomment-5669079411) and [dependency policy](https://github.com/avoid-quest/couch/issues/265#issuecomment-5668666047) define the remaining gate. This checkpoint passes the physical machine's hosted update journey while leaving unresolved acceptance checks explicit.
