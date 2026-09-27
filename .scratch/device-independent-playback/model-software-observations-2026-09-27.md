# Replacement playback: built software observations, 2026-09-27

These are current built-application UI and software-output observations. No speaker
capture or acoustic timing was recorded. They qualify only the paths described here;
[the acceptance matrix](map.md) retains PENDING status for complete capabilities.

| Build and environment | Complete observed path | Limit |
| --- | --- | --- |
| Compiled independent Core, dirty `d2b9c65e`, isolated `/tmp/couch-playback-model-20260927`, port 4414; fresh browser tab 15 | Chose **Set up Couch on this computer** once. The app chose **Mac · Chrome** without a name prompt. Played real Sygma Radio (`https://radio.syg.ma/audio.mp3`) at 19:01:07 UTC. Observed an HTML video media element with `paused=false`, `readyState=3`, `currentTime=12.2259` s and `volume=1`. Opened Devices and navigated without interrupting playback; Stop succeeded. | Media-element state is software output. No audio capture, restart, transfer, second client, traffic or resource measurement. |
| Native debug **Couch Playback.app**, build `06910c8b`, isolated `/tmp/couch-playback-native-20260927` | Fresh **This computer → Allow remotes** selected `mbp` despite virtual interfaces. Played real Sygma Radio; the native UI changed loading → playing, then Stop succeeded. In the connection UI, switched to the independent Core on port 4414 and paired with code `926366` without another name prompt. The new Library stayed idle until Play. | UI state does not prove audible native output. The later bundled-Core shutdown on Library switch is a known lifecycle gap; unbuilt client-lifetimes changes aim to fix it, so independent-Core lifetime acceptance stays pending. |
| Browser and native client on the independent Core, 19:18 UTC | Browser played Sygma Radio while native played Cashmere. Both displayed loading → playing on separate Devices, with separate UI queues and current titles. | No audio recording, progress/track isolation measurement, close/restart, or synchronized delivery check. |

The user is testing the running app. Do not treat these observations as approval of
unbuilt lifecycle fixes or as proof of physical output. Continue the remaining
setup-to-playback, failure, recovery and resource paths in the matrix.

## Mixer build `33390923`

Isolated independent Core on port 4416; Couch Mixer.app connected through saved
pairing as `mbp`; visible T3 browser tab 16 as `Mac · Chrome`. Both device faders
were set to zero for software checks. No acoustic output or synchronization was
measured. The Core's home-network URL was selected through setup despite virtual
Mac interfaces. The native app kept its own bundled Core alive when browsing the
independent Library.

- Shared Sygma Radio used one Core ffmpeg PCM producer and the maintained native
  and browser SDK clients. Both devices retained zero gain. Browser activation
  required the preview to be visible; a hidden automation tab left AudioContext
  activation pending despite a reported click.
- Removing the browser left native audio assigned. Moving the live radio to the
  browser completed by 20:40:54 UTC: HTML media was playing, readyState 3,
  currentTime 2.777 s and volume 0. The old ffmpeg producer exited. This is a live
  edge observation, not a seekable position or acoustic gap measurement.
- At 20:46:08 UTC Move back to native began. By 20:46:14 the browser element had
  paused and released its media (readyState 0); native showed the assigned device
  at volume 0. Stop then succeeded.
- Find → pasted direct HLS URL `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`
  → Play worked in the browser. At 20:50:41 UTC it reported 1920×1080,
  readyState 4, playing at 19.784 s of 634.584 s. An earlier Google-hosted MP4 URL
  returned HTTP 403; it was not a codec qualification result.
- Native explicitly selected that Playback to control it. Quitting the native
  controller left the browser playing at 71.215 s (20:51:33 UTC). Reopening the
  bundle normally retained the name and pairing, with no automatic takeover.
- Browser Pause and 1.5× speed yielded a stable 247.122 s checkpoint. Replacing an
  occupied native destination displayed a contextual confirmation. The attempted
  move refused mismatched track metadata and left the browser paused at that
  exact position and speed. Native HLS exposed five bitrate programs as Audio
  1/3/5/7/9; the pending adapter fix filters duplicate bitrate audio using mpv's
  documented program metadata, preserving named alternatives.
- Native Find → the same direct HLS source → Play ran independently of that
  paused browser Playback. Native Now displayed advancing progress and its own
  volume/track controls. Quitting the renderer did not alter the browser's
  paused 247.122 s / 1.5× state.
- A native Sygma restart remained Loading for several minutes. A process sample
  showed demux TLS reads and audio threads, which do not establish audible output
  or the cause. This remains an observed limitation requiring a fresh build check.
- A single process sample during shared radio showed Core 3.2% CPU / 94 MB RSS,
  native 0.6% / 149 MB and ffmpeg 0.9% / 23 MB. After moving to browser, ffmpeg
  was gone; Core and native were each about 0.1% CPU. These are point observations,
  not performance benchmarks.

Source preparation, idle assignment cleanup, assignment progress, single-device
backend selection, current device gain and HLS program filtering changed after
this build. The next exact-revision gates and built observations must qualify them.
Historical failures and receipts remain retained in `.artifacts` and `/tmp` logs.

## Mixer build eab5768c — restart, video moves and physical phone check

Independent Core :4416 and the normally launched Couch Mixer.app retained their
existing data. Browser/native pairings and names survived restart. Neither saved
video started automatically. Explicit browser Play resumed its 247.122 s checkpoint
at 1.5×. Home's disabled Pause after restart was a real UI defect; the subsequent
change enables resume consistently on Home, the mini player and the full player.

An occupied native checkpoint rejected a paused HLS move at 352.435 s / 1.5×.
The browser stayed paused at that position. Try again retained position but reset
speed to 1×. This is an unresolved failure-path limitation, not a passing transfer.

Live radio moved browser → native successfully. Adding the browser needed a
contextual native Enable audio action; one retry reverted membership, a later
retry succeeded. Requesting HLS while both Devices played radio kept the existing
audio and queue intact. Its generic catalog error was incorrect; subsequent code
returns the specific device-capability message. Removing native returned to direct
browser delivery and HLS Resume worked without changing modes.

Paused HLS browser → available native succeeded: handoff began 21:22:31.002 UTC,
native confirmed 392.1 s / 1.5× with compatible tracks at 21:22:34.435, and Device
assignment committed by 21:22:34.445. Reverse transfer began 21:25:13.694 and
committed to the browser by 21:25:14.393, still paused at 392.1 s / 1.5×. These
are software-state timings. The native window still showed the prior Playback;
subsequent code presents a newly committed native video assignment once. That
presentation change still needs its built-app check.

Rename in Settings → Devices changed the browser to “Mac browser”; refresh retained
one identity and pairing. The user's separate phone playback continued. No ffmpeg
producer remained after the video moves. Resource point samples and the detailed
sequence are retained in `.artifacts/mixer-eab5768c-observations.md`.

The user paired an Android phone through the app and confirmed audible Sygma Radio.
They added mbp from Output, adjusted its fader, and confirmed both devices audible.
They reported a very bad pop from the **phone** when adding the Mac. A subsequent
10 ms first-block fade targets the abrupt start in that direct-to-shared transition;
physical resolution is unverified. This is physical playback evidence, not a
synchronization or acoustic-latency measurement.

Linux core/build/native-unit and built-browser checks passed on eab5768c. Native
smoke reached real libmpv pixels and restart, then failed an obsolete idle-checkpoint
expectation, now aligned with resumable intent. The Mac full gate failed a PCM
readiness race; its existing check now waits for paused decoder readiness before
resuming. Failed receipts remain preserved and are not passing gates.
