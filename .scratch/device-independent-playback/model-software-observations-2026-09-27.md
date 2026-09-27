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
