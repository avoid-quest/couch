# Inspect and test TV audio outputs

An administrator opens Settings → Sound to inspect the outputs reported by the Ubuntu user audio session. The page shows readable names, the system default, observed output volume/mute and port availability when the server supplies it. System default is not a claim about Couch's current stream route.

Stop playback before testing. A test sends three seconds of stereo PCM, a left 440 Hz tone followed by a right 660 Hz tone, to the explicitly chosen output. The waveform peaks at 12% of full scale and includes short fades. Existing output volume and mute still apply. Muted or unavailable outputs cannot be tested. Legacy PulseAudio flat-volume outputs are also refused because creating a test stream could raise their system volume.

Stop sound test is available while the test starts. The server checks the actual test-stream route rather than treating a launched process as success. A wrong or lost observed route stops the test; the test also stops if playback/maintenance starts or the application shuts down. A fixed three-second deadline remains active if the phone disconnects. The idle-update guard remains held until the test stops. No test resumes media or changes the saved playback route, system default, system volume or Couch volume.

An observed route does not establish audible sound. The user must confirm audibility on the actual output. This increment does not add permanent current/future playback routing, stable saved route identity, system-volume/mute synchronization, audio-delay controls or selected-playback-output-loss handling. Those requirements remain open on [#14](https://github.com/avoid-quest/couch/issues/14).

## Verification

Source tests cover authorization, idle/current-output admission, muted/unavailable output interpretation, route mismatch, interruption, stale stop requests, controlled PCM and phone controls. `tests/linux/sound-run.sh` runs the production service against two PulseAudio null outputs inside the existing Ubuntu Linux test container. It captures actual samples from the requested output's monitor and checks the test deadline, stop/interruption and preservation of default output and volume. Mount the repository read-only at `/source` and a writable evidence directory at `/artifacts`; the test uses only disposable container audio resources.

This synthetic audio-server run does not establish physical HDMI/analog audibility or the installed PipeWire session. Qualified application/session installation and a coordinated user listening window remain necessary. No microphone capture is used: the synthetic test reads only its null output monitor.

## Supported interfaces

Ubuntu 24.04's [pactl](https://manpages.ubuntu.com/manpages/noble/man1/pactl.1.html) provides JSON sink and stream observations. [paplay](https://manpages.ubuntu.com/manpages/noble/man1/pacat.1.html) supports raw PCM, explicit output, stream name and initial stream volume. Both ship in the appliance's existing `pulseaudio-utils` dependency. PipeWire documents [compatibility with these PulseAudio tools](https://docs.pipewire.org/devel/page_module_protocol_pulse.html). No privileged bridge or native-player fork is added.
