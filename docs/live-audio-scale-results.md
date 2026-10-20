# Fifty-browser playback soak

Measured 2026-10-20/21 on commit `16ac4ea3b117afc7fa8a78db14520c02c0389ca4`.
Fifty independent browser receivers completed 30 minutes of production direct
WebRTC playback with an active, separately monitored output for every receiver.
**Event-audio qualification remains incomplete:** concealment occurred, and
reconnecting the full group required Play and exceeded the recovery allocation.
Nothing was merged or deployed for this run.

## Fix exercised

Adding shared speakers to an existing microphone playback incorrectly requested
permission for the receiver's private screen too. The fix omits unavailable
channels from that join request. Its real-hub regression failed before the fix;
all 57 live-output integration tests, typecheck, build and diff checks passed
afterwards. Every receiver in this run joined through that production path.

## Playback and recovery

| Real browser receivers | Steady interval | Active outputs | Reported RTP packet loss | Concealed samples / events, summed across receivers |
| --- | --- | --- | --- | --- |
| 10 | 180.002 seconds | 10/10 | 0 | 0 / 0 |
| 25 | 300.011 seconds | 25/25 | 0 | 1,740 / 3 |
| 50 | 1,800.009 seconds | 50/50 | 0 | 256,168 / 455 |

The 50-receiver stage scored 90,006 one-second output windows. None were silent
under the fixed RMS threshold of 0.001; no nonfinite or clipped output samples,
browser errors, unexpected reloads or peer replacements were detected. These
activity checks do **not** rule out shorter gaps, wrong/repeated audio or renderer
underruns. Window counts follow each monitor's sample stream, not a shared
presentation clock.

All 50 receivers reported some concealment during the long stage. The maximum
per receiver was 6,525 samples. Several increases affected many receivers in the
same five-second observation interval despite zero reported packet loss. The
shared disturbance's cause is unresolved. Concealment counts describe WebRTC's
reported handling; they are not measurements of missing source duration or
audible interruptions. Startup and transitions are outside these steady-state
deltas and remain in the output summaries and observations.

- **Sequential joins:** all 50 admitted and rendered; none excluded. Maximum
  observed request-to-active-output time was 2.028 seconds. This was not a
  simultaneous pairing/admission burst.
- **Reconnect 10 of 50:** all ten acquired new peers and active output within
  4.358 seconds. The other 40 remained connected and active. The following
  30-second playback interval passed, with no new reported loss or concealment.
- **Reconnect all 50:** some returned paused. Play was issued at 7.916 seconds;
  every output was active by 9.607 seconds from the fault request, or 1.692 seconds
  after Play. Automatic recovery and the 5-second total recovery allocation did
  not pass. The following 30-second interval passed activity checks but reported
  another 7,830 concealed samples across 17 events.
- **Stop capture:** the publisher released its tracks and every receiver output
  became silent.

Couch deliberately waits paused when no output remains online. Smaller preflights
also observed mixed pause states after a simultaneous reconnect. These results
preserve that behavior and report the required Play explicitly; they do not
establish unattended recovery from a complete outage. Recovery times include
polling and output-monitor buffering, with a complete active window after a fresh
peer was observed. They are observation bounds, not physical presentation times.

## Worker and measurement limits

One Linux host ran Electron 44.4.5 with separate processes, identities, profiles
and network namespaces; production pairing, capture, WebRTC and rendering were
used. Each receiver had its own 48 kHz mono Pulse sink and monitor. Five private
PulseAudio 17.0 servers served at most ten receivers each. Sink ownership was
checked against the corresponding browser process ancestry. The source was a
looped 30-second two-tone fake microphone, suitable for activity measurements.
It was not a continuously unique waveform fixture.

The test had 16 logical CPUs, a 48,000 MiB summed-RSS cap and a 1,024-process cap.
It stopped for less than 8 GiB host available memory, or CPU above 80% of the
assigned CPUs for over 30 seconds. No such stop occurred. During the 50-receiver
steady stage, task-cgroup CPU use was median 4.027 and maximum 5.258 logical CPUs.
The process count stayed at 468. Summed RSS peaked at 38.778 GiB; the first and
last minute means were 37.960 and 38.331 GiB. Host available memory stayed above
23.878 GiB during that stage. A brief full-reconnect CPU peak reached about 12.82
logical CPUs. Cgroup CPU includes instrumentation/agent activity, and summed RSS
counts shared mappings repeatedly; neither is an isolated Core benchmark.

There was no injected network loss, delay or bandwidth cap. The network fixture
verified bidirectional traffic for all 50 clients. This does not exercise venue
Wi-Fi, physical phones, independent hardware clocks, DAC/acoustic timing or the
In sync/experimental ingress routes. It does not qualify the 60 ms latency or
5 ms skew gates. Three seeded 30-minute runs and the two-hour churn soak in the
[event plan](live-audio-event-plan.md) also remain outstanding.

The warmup was fixed at 15 seconds for each stage. Browser observations were
every five seconds, resource observations every two seconds, and monitor PCM
contributed to contiguous one-second RMS/peak windows. Raw monitor streams lack
independent frame-address timestamps; smaller recording losses are not ruled
out. No exact waveform or physical timing claim follows from output activity.

## Artifacts and cleanup

The [compact per-receiver evidence](live-audio-scale-results.json) retains stage
deltas, output summaries, resource observations, every recovery time, hashes and
cleanup proof. Local raw artifacts and the scratch harness are described in
`/tmp/couch-live-deeper-dTER8CW4/README.md`; the successful run is `soak-scale-3`
with network evidence in `network-scale-3`. The raw observations and output
windows total 48,426,500 bytes. They retain startup, warmup and fault intervals.

Two earlier scale attempts stopped on infrastructure limits: Pulse's default
256-file-descriptor limit, then its fixed 64-native-connection ceiling. The
private test configuration raised the descriptor limit and split audio servers.
The second attempt independently completed a 10-receiver, three-minute stage;
its later infrastructure failure is inconclusive for Couch capacity.

All 107 owned child processes in the completed run exited with code zero.
Browser profiles were removed; no process remained in the test PID namespace.
The owner's installed Couch, its data and default audio session were untouched.
