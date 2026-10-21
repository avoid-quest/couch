# Direct playback performance experiments

`tests/live-audio-scale.native.ts` runs independent production Electron receivers
in the existing rootless network fixture. Each browser has its own profile,
identity, network namespace and monitored mono Pulse sink. Ten receivers share
one private Pulse server, avoiding its native-protocol connection limit. No host
audio defaults, installed Couch data or host interfaces are changed.

Build with the repository's pinned Bun and Electron. Linux prerequisites are
described in [the audio lab](live-audio-lab.md); this activity benchmark needs
PulseAudio and its utilities but does not use JACK. A private unpacked Debian
17.0 Pulse prefix can be selected using `COUCH_LAB_PREFIX`. The prefix must also
contain its modules and dependent libraries. The runner never installs packages.

Use fresh, short artifact directory names (Pulse uses Unix-domain socket paths):

```sh
node_modules/.bin/bun run build
COUCH_SCALE_SECONDS=60 COUCH_SCALE_ROUNDS=3 \
xvfb-run -a scripts/live-audio-network.sh run --profile control --clients 50 \
  --duration 1200 --cpu-list 0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15 \
  --max-rss-mb 48000 --max-processes 1024 \
  --evidence /var/tmp/couch-perf-network-UNIQUE -- \
  "$PWD/node_modules/.bin/bun" tests/live-audio-scale.native.ts \
  /var/tmp/couch-perf-UNIQUE
```

Preflight with two clients and five steady seconds before scaling. For a soak,
set `COUCH_SCALE_SECONDS=1800` and increase the wrapper's wall limit to include
sequential admission, warmup, faults and cleanup. Runs must remain sequential.
`COUCH_LAB_APP_AUDIO_DEFAULTS=1` applies the same Linux buffer policy as Main
and records each browser's effective switch. Leave it unset for the original
Chromium defaults. The fake microphone has its own capture timing, so this
comparison cannot establish the application's real input latency.
Alternatively, `COUCH_SCALE_TAIL_SECONDS=1800` keeps the same initial comparison
and reconnect rounds, then adds a 15-second warmup and a 30-minute soak on those
receivers before stopping capture. This tests sustained playback after churn;
it does not replace a fresh-start soak. Include it in the wrapper's wall limit.
The wrapper independently caps processes, summed RSS and duration. The benchmark
also stops below 8 GiB host available memory or after 30 seconds above 80% of the
assigned logical CPUs. Summed RSS double-counts shared mappings; process CPU
includes the isolated test's instrumentation and namespace infrastructure.

After sequential admission and a fixed 15-second warmup, score every receiver
for the requested steady interval. The default fault sequence reconnects all
but one receiver, then all receivers, three times each. Override with
`COUCH_SCALE_FAULTS=10,49,50` and `COUCH_SCALE_ROUNDS=1` when needed; record the
contract and compare only identical configurations. The full-outage case sends
Play at eight seconds if recovery is still incomplete. This explicitly preserves
Couch's last-output-offline pause policy. The report separates automatic recovery
from recovery requiring Play. A 45-second hard timeout does not relax the fixed
five-second recovery allocation.

`result.json` retains per-receiver control, media and output recovery observations,
fault dispatch spread, admission times, resource samples, runtime/build hashes,
and direct child closure records. `observations.jsonl` retains browser events and
raw [WebRTC statistics](https://www.w3.org/TR/webrtc-stats/). Events include offer
and answer operations, socket events, peer connection changes and incoming
control message types. Each browser caps pending events at 10,000; any omission
invalidates measurement. Publisher CPU profiles cover fault intervals; Core's
Node CPU profile covers its process lifetime. These are diagnostic runs with
instrumentation overhead, not uninstrumented capacity qualification.

Output activity uses contiguous 48,000-sample cells at 48 kHz, with RMS above
0.001. `output-windows.jsonl` retains every cell, including startup and faults.
Recovery requires a new connected peer with received media and an active complete
cell after observing that peer. Browser snapshots occur every five seconds when
steady, and at least every 250 ms plus observation cost during recovery. Reported
times are upper observation bounds. Monitor delivery is not a calibrated source
or presentation clock. The looped two-tone microphone fixture cannot detect
wrong or repeated content or rule out subsecond gaps. Concealment, insertion and
removal counters are observations, never inferred durations of missing source.

Steady stages now freeze a per-receiver sample interval after the initial
snapshot and require every one of its `seconds * 48000` frames. A shared
1.5-second drain can deliver pending bytes, but later browser snapshot delays
cannot extend it. Each cell is scored within that interval; silent cells cannot
be replaced by later active output. Missing frames, invalid samples and clipping
remain explicit. A failed stage is exported before the runner exits. These are
delivered PCM intervals, not proof of wall-clock presentation coverage: `parec`
does not supply source sample addresses or independent capture timestamps.

Counter deltas require one unambiguous inbound audio stream with the same peer,
stats ID and SSRC, and an advancing stats timestamp. Unsupported, nonfinite,
malformed or reset counters stay null, including the aggregate if any receiver
is unknown. `telemetryComplete` is separate from the activity verdict. Per the
[WebRTC statistics specification](https://www.w3.org/TR/webrtc-stats/#dom-rtcreceivedrtpstreamstats-packetslost),
`packetsLost` is a signed estimate and may legitimately decrease or be negative;
the other reported counters must not regress. Duration/recovery observations
use the harness's monotonic clock. The first resource sample establishes a CPU
baseline and reports unknown CPU instead of zero.

`qualified` stays false. Physical devices, venue Wi-Fi, independent clocks,
latency/skew, waveform identity and the In sync route require separate evidence.
Keep raw directories private: Core logs and temporary browser configurations
contain test credentials. Browser profiles/configurations are removed on normal
cleanup; forced termination may leave them. Share sanitized results, not the
entire directory. Retain unsuccessful attempts as well as passing measurements.
