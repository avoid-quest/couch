# Choose and test TV audio outputs

An administrator opens Settings → Sound to inspect the outputs reported by the Ubuntu user audio session. The page shows readable names, the system default, observed output volume/mute and port availability when the server supplies it. The selected sink name persists in SQLite. Saved selection and the observed playback route are displayed separately. Choosing an output moves the app's open streams to that sink and waits for a matching Pulse stream when one exists before saving. It also makes that sink the system default, which later streams and Ubuntu volume keys follow, and reconciles that default after restart or hotplug. Failed selection moves the streams back and restores the prior system default where possible.

Sound settings and the sound test run on Linux, through `pactl` and `paplay`; on macOS and Windows use the system settings. Stop playback before testing. A test sends three seconds of stereo PCM, a left 440 Hz tone followed by a right 660 Hz tone, to the explicitly chosen output. The waveform peaks at 12% of full scale and includes short fades. Existing output volume and mute still apply. Muted or unavailable outputs cannot be tested. Legacy PulseAudio flat-volume outputs are also refused because creating a test stream could raise their system volume.

ALSA drivers alone do not supply Couch's output routing and volume controls.
The desktop session needs either PulseAudio or PipeWire's `pipewire-pulse`
service, plus `pulseaudio-utils` for `pactl` and `paplay`. PipeWire users do not
need to replace their sound server with PulseAudio. AppImages cannot install
these system packages. Check `pactl info` as the same user running Couch,
without `sudo`; a root session may address a different audio server.

Sound settings distinguishes missing tools from an unreachable audio session.
After repairing the session, Couch retries its subscription every five seconds
and refreshes the output even if the server sends no change event. Playback
stays interrupted until the user resumes it.

FFmpeg is separate from the sound server. Couch downloads and verifies its own
copy when needed; it need not appear on the shell's `PATH`. If a download fails,
inspect `logs/couch.log` under Couch's data directory for `Couch helpers:`.
The [helper lifecycle](architecture.md#helpers) describes the cache and fallback.

Stop sound test is available while the test starts. The server checks the actual test-stream route rather than treating a launched process as success. A wrong or lost observed route stops the test; the test also stops if playback starts or the application shuts down. A fixed three-second deadline remains active if the phone disconnects. No test resumes media or changes the saved playback route, system default, system volume or Couch volume.

Shared playback volume and mute control the selected system sink. Couch holds its native software volume at unity, and reads actual system volume and mute every half second, including changes made with Ubuntu controls or hardware keys. Flat-volume servers are refused to avoid raising the sink level through stream creation. The shared volume is not restored from an old app setting at restart. Settings exposes the saved TV audio delay while idle; it applies to the current item and every subsequent item.

A missing sink, unavailable active port, unexpected route or unreadable audio server interrupts playback. Seekable media pauses; live or still-loading media stops. Late EOF and native error events cannot trigger retries or advance the queue during that interruption. Reconnection or selecting an output never resumes media. Use Resume after the output returns. Core routes the app's own PulseAudio streams (Electron main and its children, among them Chromium's audio service) and moves them with `pactl move-sink-input`.

An observed route does not establish audible sound. The user must confirm audibility on the actual output. Physical HDMI/analog selection, hardware keys, disconnect/reconnect and session restart remain acceptance gates on [Choose an audio output and test TV sound](https://github.com/avoid-quest/couch/issues/14). Settings also lists available output-only card profiles, including inactive analog and HDMI profiles. Profile activation interrupts playback deliberately, waits for the resulting sink and saves both the stable card name and profile. Errors restore the prior profile and route where possible. Restart/hotplug restores a saved profile when its card reappears, while media remains paused or stopped. Microphone and duplex profile choices are not offered.

## Supported interfaces

Ubuntu 24.04's [pactl](https://manpages.ubuntu.com/manpages/noble/man1/pactl.1.html) provides JSON sink and stream observations. [paplay](https://manpages.ubuntu.com/manpages/noble/man1/pacat.1.html) supports raw PCM, explicit output, stream name and initial stream volume. Both ship in the appliance's existing `pulseaudio-utils` dependency. PipeWire documents [compatibility with these PulseAudio tools](https://docs.pipewire.org/devel/page_module_protocol_pulse.html). PulseAudio documents the [PULSE_PROP environment properties](https://wiki.freedesktop.org/www/Software/PulseAudio/Documentation/Developer/Clients/ApplicationProperties/); Ubuntu's WirePlumber 0.4 [linking policy](https://github.com/PipeWire/wireplumber/blob/0.4.17/src/scripts/policy-node.lua) honors `node.dont-reconnect` for explicit targets. Newer [WirePlumber policy](https://pipewire.pages.freedesktop.org/wireplumber/policies/linking.html) also documents `node.dont-fallback`. No privileged audio helper is added.
