# TV sound outputs

On Linux, an admin chooses and tests outputs in **Settings → Sound**, through
`pactl` and `paplay`; on macOS and Windows use the system settings.

- The desktop session needs PulseAudio or PipeWire's `pipewire-pulse`, plus
  `pulseaudio-utils`. ALSA alone doesn't provide routing and volume controls, and
  AppImages can't install these packages. Check `pactl info` as the user running
  Couch, without `sudo`: root may reach a different audio server.
- Choosing an output moves the app's streams with `pactl move-sink-input`, makes
  that sink the system default and saves it in SQLite. Failure moves them back.
- Shared volume and mute control the selected system sink; Couch keeps its own
  stream at unity and follows the system level from Pulse events (polling every
  five seconds as a fallback). Legacy PulseAudio
  flat-volume outputs are refused, because creating a stream could raise them.
- A missing sink or unexpected route interrupts playback (seekable media pauses,
  live media stops); nothing resumes on its own.
- The sound test plays a left 440 Hz then right 660 Hz tone at 12% of full scale
  to the chosen output, and checks the actual stream route. An observed route
  doesn't prove audible sound: listen.
- Output-only card profiles (analog, HDMI) can be activated; Couch saves the card
  and profile and restores them when the card reappears.

FFmpeg is separate from the sound server; Couch downloads its own
([helpers](architecture.md#helpers)).
