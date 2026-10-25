# Linux audio: near-default settings for Couch

25 October 2026. Read-only upstream investigation; no audio runs, package installs,
settings changes or commits. PulseAudio findings are pinned to **17.0**. Chromium
source illustrates its buffer policy; it does not establish the exact behavior of
the installed Electron build. Recommendations below are not applied changes.

## Recommendation

Prefer the normal client/server negotiation and focus further work on **Couch
stability**, not more aggressive Linux tuning:

- Remove the experimental **`PULSE_LATENCY_MSEC`** from Couch's launch environment
  and **`--audio-buffer-size=256`** from the experimental browser invocation.
  Let Chromium make its own stream request. These overrides operate at different
  layers and do not specify end-to-end latency. [1][2][7]
- Remove **`avoid-resampling=yes`** from the private experimental daemon config;
  Pulse 17 defaults to false. Keep **`flat-volumes=no`**: it already matches Pulse
  17's default and avoids coupling the device volume to the loudest stream. [3][4]
- Keep **timer scheduling (`tsched=1`)** and the normal adaptive latency behavior.
  Leave the existing negotiated **48 kHz, S32 stereo** format alone for this
  minimal rollback; there is no reason here to force another format or shrink
  the ALSA allocation. [4][5][6]

Scope this to the experimental launch/private daemon. Preserve personal mixer
levels, mute state, selected profiles/routes and saved stream volumes. Do not
replace user/system Pulse configuration, reset state databases, switch audio
servers, or change kernel, IRQ, CPU governor, PAM limits or service privileges.
This is a small rollback recommendation, not a tuning matrix or system rebuild.
Removing overrides may increase reported latency and expose Couch's admission
limit; it is **not a promise of sub-50 ms operation**. Couch must handle actual
latency and sustainable scheduling rather than require the old experimental
number. [1]

## Requests, queued audio and ALSA allocation are different

Pulse's upstream client guidance says latency requests are **hints**: use measured
latency, allow it to change, and choose the highest latency compatible with the
application's needs. Needlessly low requests increase CPU work and dropout risk.
With `PA_STREAM_ADJUST_LATENCY`, a playback `tlength` request includes device
buffering; it is not a physical capture-to-speaker measurement. [1]

Pulse 17's `patch_buffer_attr()` shows that `PULSE_LATENCY_MSEC` replaces playback
`tlength` and recording `fragsize`, resets other buffer attributes, and enables
`PA_STREAM_ADJUST_LATENCY`. Thus 1/4/8 ms are stream targets, not hardware-period
settings. The variable affects libpulse streams in processes that inherit it;
it is not intrinsically limited to one Couch output. [2]

The reported **96,000-frame ring / 48,000-frame period at 48 kHz** describe two
seconds of allocated capacity and a one-second ALSA period. Pulse 17's timer-mode
default allocation is two seconds. Its active playback depth is adjusted
separately, and the ALSA setup attempts to disable period wakeups when supported.
Those allocation numbers therefore do **not** establish two seconds of latency,
one-second callbacks, or a need for a tiny IRQ ring. [5][6]

Chromium calls `audio-buffer-size` a debugging switch. The inspected Pulse backend
uses it to override stream frames per buffer, including capture; its ordinary
preferred output starts at 512 frames and can vary with input parameters. Playback
then requests `tlength = 3 × buffer bytes` and `minreq = buffer bytes / 2` with
`PA_STREAM_ADJUST_LATENCY`. A 256-frame block is 5.333 ms at 48 kHz, **not** a
5.333 ms output guarantee; libpulse's environment override can replace those
attributes again. Do not substitute a hard-coded 512 switch for the 256 one. [2][7]

## Timer scheduling, formats and scheduling privileges

**Timer mode:** `tsched` defaults to enabled. The daemon's four fragments of 25 ms
are legacy/interrupt-mode defaults; the manpage says timer-based drivers ignore
these options. `tsched=0` is a workaround for inaccurate device timing, not a
general recommendation for an older codec. On underruns, timer mode can increase
its watermark and minimum latency. Leave `fixed_latency_range` at false so this
protection remains available. Nothing reviewed establishes an ALC892-specific
need to override it. [4][5][8]

**Rate and depth:** Pulse 17 ships with 16-bit, stereo, 44.1 kHz defaults and a
48 kHz alternate rate. Default/alternate switching already exists without
`avoid-resampling=yes`; that option additionally tries to follow stream rates
when reconfiguration is possible and no other stream is active. It is not a
universal bypass of resampling or mixing. Matching this 48 kHz pipeline can avoid
a rate conversion at that boundary, but cannot eliminate independent capture and
playback clock drift. [3][4]

S32 identifies a signed 32-bit PCM format, not 32 bits of effective analog
resolution. Wider output can preserve more precision from processed samples;
it cannot recover detail already lost in a 16-bit source. Neither S32 nor a higher
sample rate fixes packet lateness, proves bit-perfect delivery through volume
and mixing, or establishes audible benefit on this ALC892. These are signal-path
inferences, not codec measurements. Keep the default resampler policy rather than
selecting a costly “highest quality” mode: upstream defaults to `speex-float-1`
and explicitly notes that Soxr modes can add substantial delay. [4][9]

**Scheduling:** upstream defaults already request `high-priority=yes` (nice −11)
and `realtime-scheduling=yes` (I/O priority 5). These are requests, not granted
privileges. Pulse supports obtaining real-time scheduling through **rtkit**;
its source also uses rtkit as a fallback for negative nice levels. [3][4][10]
The reported privilege failures mean those attempts did not succeed in the
private environment. They can reduce scheduling headroom but do not prove the
cause of Couch's late packets. Leave the normal distro-managed policy intact;
do not grant root/capabilities or broaden limits to rescue 1 ms requests.

## What the evidence does and does not establish

The supplied experiment context reports underruns, latency growth and admission
failure at 1 ms. At 8 ms, output preparation stayed near 10.667 ms and physical
delay near 48.8 ms, but late-packet bursts persisted, including a run without
Pulse underruns. These are reported observations, not independently remeasured
here; see the [experiment record](audio-roundtrip-performance.md).

The 1 ms behavior is consistent with upstream's adaptive underrun protection.
The clean-Pulse run means a Pulse underrun is not necessary for the observed
packet-lateness symptom. It does not identify the remaining cause: Couch's
transport, event-loop stalls, receiver scheduling and admission accounting still
need evidence. An output-preparation estimate, a requested latency, an allocated
ring, or an accepted physical-delay statistic cannot establish continuous
fidelity, complete coverage or reliable admission. Removing overrides provides
a sensible baseline; it does not itself validate latency or audio quality.

## Primary sources

1. [PulseAudio upstream: Latency Control](https://www.freedesktop.org/wiki/Software/PulseAudio/Documentation/Developer/Clients/LatencyControl/) — hints, measured latency, adaptive behavior and avoiding unnecessarily low requests.
2. [PulseAudio 17 `stream.c`, `patch_buffer_attr()`](https://gitlab.freedesktop.org/pulseaudio/pulseaudio/-/blob/v17.0/src/pulse/stream.c#L997) — `PULSE_LATENCY_MSEC` semantics.
3. [PulseAudio 17 `daemon.conf.in`](https://gitlab.freedesktop.org/pulseaudio/pulseaudio/-/blob/v17.0/src/daemon/daemon.conf.in) — shipped defaults, including flat volumes and resampling avoidance.
4. [PulseAudio 17 `pulse-daemon.conf(5)`](https://gitlab.freedesktop.org/pulseaudio/pulseaudio/-/blob/v17.0/man/pulse-daemon.conf.5.xml.in) — option meanings, rate switching, scheduling, fragments and resampler tradeoffs.
5. [PulseAudio 17 `alsa-sink.c`](https://gitlab.freedesktop.org/pulseaudio/pulseaudio/-/blob/v17.0/src/modules/alsa/alsa-sink.c) — `DEFAULT_TSCHED_BUFFER_USEC`, `increase_watermark()`, `pa_alsa_sink_new()` defaults.
6. [PulseAudio 17 `alsa-util.c`, `pa_alsa_set_hw_params()`](https://gitlab.freedesktop.org/pulseaudio/pulseaudio/-/blob/v17.0/src/modules/alsa/alsa-util.c#L201) — timer-mode allocation and period-wakeup negotiation.
7. Chromium revision `45b62aeefa0666795f695d4dceb7f554ffff15a3`: [debug switch](https://chromium.googlesource.com/chromium/src/+/45b62aeefa0666795f695d4dceb7f554ffff15a3/media/base/media_switches.cc#53), [Pulse stream parameters](https://chromium.googlesource.com/chromium/src/+/45b62aeefa0666795f695d4dceb7f554ffff15a3/media/audio/pulse/audio_manager_pulse.cc#217), [playback buffer attributes](https://chromium.googlesource.com/chromium/src/+/45b62aeefa0666795f695d4dceb7f554ffff15a3/media/audio/pulse/pulse_util.cc#601).
8. [PulseAudio upstream: Modules](https://www.freedesktop.org/wiki/Software/PulseAudio/Documentation/User/Modules/) — ALSA `tsched`, fragments and `fixed_latency_range`.
9. [PulseAudio upstream: Supported Audio Formats](https://www.freedesktop.org/wiki/Software/PulseAudio/Documentation/User/SupportedAudioFormats/) — PCM representations and distinction from passthrough.
10. PulseAudio 17 [`pulseaudio(1)`](https://gitlab.freedesktop.org/pulseaudio/pulseaudio/-/blob/v17.0/man/pulseaudio.1.xml.in#L431) and [`core-util.c`](https://gitlab.freedesktop.org/pulseaudio/pulseaudio/-/blob/v17.0/src/pulsecore/core-util.c#L710) — real-time privilege requirements and rtkit paths.
