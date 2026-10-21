# Linux live audio latency measurements

The matched two-minute comparison reduced maximum observed software latency
from 139.458 to 89.396 ms. Matched ten-minute, 50-receiver activity controls
completed, with audio concealment and recovery misses still observed. These
measurements do not qualify the route for an event or physical speakers.

Numeric observations and retained artifact hashes are in
[the sanitized results](live-audio-latency-results.json). Raw recordings and
scratch credentials remain in the private run directories.

## Changes under test

Main requests 128-frame Chromium audio buffers on Linux. An explicit
`--audio-buffer-size` remains authoritative, including `0` to use Chromium's
defaults. The lab workers call the same helper when
`COUCH_LAB_APP_AUDIO_DEFAULTS=1`; their default remains the original Chromium
configuration. Main startup checks exercised default 128, explicit 0 and
explicit 512 through the built application.

After a remote answer, live Opus senders request 64 kb/s for negotiated mono
and 128 kb/s for explicitly negotiated stereo through
`RTCRtpSender.setParameters()`. These are the music bitrate ranges in
[RFC 7587 section 3.1.1](https://www.rfc-editor.org/rfc/rfc7587#section-3.1.1).
An omitted `stereo` parameter means mono, independently of the capture track's
channel count. Other codecs and video retain their existing parameters. Optional tuning errors are ignored, and the sender update promise is not
awaited by ICE signaling. Packet duration remains unchanged.

## Matched two-minute comparison

Two independent Electron receivers used the same seed (20261020), mono JACK
ports at 48 kHz, quantum 512, unimpaired isolated network, 64 kb/s requested
Opus bitrate and unchanged 20 ms packet duration. Audio processes used CPUs
10–11; the remaining lab processes used CPUs 0–9 and 12–15. The only difference
between these two runs was the application buffer policy.

| Configuration | Maximum software latency, receiver 0 / 1 | Markers per output | Recorder / witness xruns |
| --- | --- | --- | --- |
| Original Chromium buffers | 134.458 / 139.458 ms | 1,180 / 1,180 each | 0 / 0 |
| Application 128-frame buffers | 89.396 / 88.958 ms | 1,180 / 1,180 each | 0 / 0 |

The largest observed latency fell by 50.063 ms, approximately 35.9%. All marker
latencies within each output were constant at sample resolution in these runs.
Average observed receiver jitter-buffer duration fell from 60.65 / 60.64 ms to
36.28 / 36.26 ms. RTP payload rates were approximately 63.7 kb/s per receiver;
this excludes network overhead. Neither run reported RTP loss, concealed samples
or concealment events in its before/after observations.

Both recordings passed the corrected reference, capture coverage, marker,
clipping, output-witness and process-exit checks. Heavy scoring ran only after
the audio and browser processes closed. The 0.8 correlation threshold, two-second
analysis warmup, complete output tail and all health gates stayed unchanged.

These measurements concern the named software JACK output boundary. They do not
establish physical presentation timing or uninterrupted audio between markers.
The 60 ms acceptance target is still unmet; the fixed 5 ms alignment target,
source/capture calibration, renderer continuity and headroom gates remain
independent. The smaller observed skew in one pair is not a synchronization
guarantee for WebRTC.

The pair is retained as `/var/tmp/couch-lat2-p64base-2` and
`/var/tmp/couch-lat2-p64buf-1`. Each contains the exact scratch probe source,
requested/read-back bitrate, build/backend hashes, source PCM and both complete
framed recordings. The bitrate was requested by the probe; subsequent runs
exercise its application integration.

## Larger production runs

| Build/configuration | Receivers × duration | Markers | Recorder / witness xruns | Interpretation |
| --- | --- | --- | --- | --- |
| Initial application bitrate selection, 128 kb/s | 10 × 120 s | 11,800 / 11,800 | 0 / 0 | Complete recording; maximum latency 96.625 ms, maximum skew 11.5 ms |
| Corrected negotiated-mono selection, 64 kb/s | 10 × 120 s | 11,796 / 11,800 | 6 / 3 | Invalid timing recording; four missing markers across receivers 1, 4 and 6 |

Both used 128-frame application buffers, q512 and the same CPU split as the
two-receiver comparison. They are retained as `couch-lat2-ten-1` and
`couch-lat2-ten-2`. The healthy 128 kb/s run exceeds the 60 ms latency and 5 ms
alignment targets. The final 64 kb/s run cannot establish timing or isolate a
codec regression because the common capture graph was unhealthy. It was not
repeated unchanged until a passing result appeared.

The final application's short two-receiver integration check,
`couch-lat2-prod2-2`, passed with every marker, zero xruns, and 64 kb/s readbacks
on both senders. A five-second scale preflight, `couch-lat2-scale2-1`, then
covered all 240,000 declared samples per receiver with complete counters, zero
observed concealment and all child processes closed.

The fifty-receiver controls use CPUs 1–11 and 13–15, excluding the
previously observed busy CPU and its sibling. Their declared initial interval
is ten minutes after all receivers are admitted and the fixed warmup completes,
followed by the existing 49- and 50-receiver reconnect controls. They use the
corrected `/2` activity evaluator and private Pulse null sinks, without a JACK
graph. A one-second active output cell does not prove continuous source identity.

The first run, `couch-lat2-fifty-1`, stopped on the publisher's unchanged
15-second RPC timeout. Only about 8.50 million of the required 28.8 million
samples per receiver were observed. The final counter interval is inconclusive;
its last successful intermediate snapshot is not a substitute endpoint. All
107 children closed with exit code zero. The CPU/memory guards did not fire.

A scratch diagnostic, `couch-lat2-fiftydiag-1`, completed the 600-second interval
and both reconnect controls. Every receiver had all 28.8 million samples, no
silent one-second cells, and no clipping or nonfinite samples. The initial RTC
interval nevertheless recorded **113,250 concealed samples in 145 events**,
with zero reported packet loss. Both 15-second post-reconnect intervals had
complete coverage and zero observed concealment. The maximum output-recovery
observations were **7.878 seconds for 49 receivers** and **9.116 seconds for all
50**; the latter included a Play command at 8.245 seconds. Both exceed the fixed
five-second allocation. All 107 children closed with exit code zero.

### Observer correction

The diagnostic caught an 8.7-second publisher-renderer stall while starting a
snapshot across 50 peers: peer starts were spread over 8,698.8 ms and the
250 ms heartbeat was 8,745.6 ms old. The newly added sender readbacks were being
polled on every snapshot. In the pinned Chromium 152.0.7977.130 implementation,
[`GetParameters()` explicitly blocks on the signaling thread](https://github.com/chromium/chromium/blob/152.0.7977.130/third_party/blink/renderer/modules/peerconnection/rtc_rtp_sender_impl.cc#L243),
while [`GetStats()` posts an asynchronous task](https://github.com/chromium/chromium/blob/152.0.7977.130/third_party/blink/renderer/modules/peerconnection/rtc_peer_connection_handler.cc#L1407).
Concealment rose around the stalled interval; this does not isolate every cause
of concealment in that run.

The scale runner now reads sender configuration once before the initial fixed
warmup. Regular snapshots retain asynchronous counters and their measured
observation duration; their `senders` field is null. The initial readbacks do
not establish the configuration of later replacement peers. The five-second
counter cadence, 15-second RPC timeout, recovery limits, activity coverage and
resource guards are unchanged.

The corrected two-receiver preflight, `couch-lat2-readback2-1`, passed with both
64 kb/s readbacks, no parameter reads in measured snapshots, full activity
coverage and zero observed concealment. The maximum snapshot duration was 1 ms.
The corrected 50-receiver run, `couch-lat2-readback50-1`, completed all three
activity stages and counter intervals. Each receiver had all 28.8 million
initial samples, no silent cells, no clipping and no nonfinite samples. The
initial RTC interval recorded **76,816 concealed samples in 163 events**, with
zero reported packet loss; both 15-second post-reconnect intervals reported
zero concealment. The 188 measured publisher snapshots took at most 100.8 ms,
including recovery. No multi-second observer stall or RPC timeout recurred.

Output recovery took at most **7.548 seconds for 49 receivers** and **9.368
seconds for 50**, with Play at 8.245 seconds in the latter. Both missed the
five-second allocation. All 107 children closed with exit code zero. The
observer correction removes repeated blocking calls; these single runs do not
establish how much of the concealment difference it caused.

The original-buffer control, `couch-lat2-original50-1`, used the same corrected
observer and 64 kb/s application bitrate. Its recorded build/worker hashes and
contracts match the smaller-buffer run apart from the buffer-policy flag; all
51 browser switch readbacks confirm the intended configurations.

| Buffer policy | Initial sample coverage per receiver | Concealed samples / events, summed across 50 receivers | Maximum output recovery, 49 / 50 receivers |
| --- | --- | --- | --- |
| Original Chromium buffers | 28,800,000 / 28,800,000 | 1,468,992 / 1,994 | 6.711 / 8.365 s |
| Application 128-frame buffers | 28,800,000 / 28,800,000 | 76,816 / 163 | 7.548 / 9.368 s |

Both runs covered all three activity intervals with no silent one-second cells,
clipping or nonfinite samples. All counter intervals were observed; reported RTP
packet loss was zero, and both post-reconnect intervals reported zero concealment.
The original-buffer run issued Play at 8.081 seconds in its full-outage case.
Its 184 measured publisher snapshots took at most 170.6 ms. All 107 children
closed with exit code zero in each run.

The smaller-buffer run had fewer observed concealed samples and slower observed
recovery. These are single runs on a shared worker, not estimates of typical or
worst-case behavior. They cannot isolate every cause of the interruptions. Both
configurations miss the five-second recovery allocation; activity coverage and
RTC counters do not establish waveform identity or output latency at 50 receivers.

## Codec observation

With original buffers and the default bitrate, a healthy two-minute recording
missed marker 209 on one output (1,179 / 1,180). Its observed payload rate was
32.04 kb/s. Accepted-marker minimum correlations were 0.819 / 0.805; at 64 kb/s
they were 0.867 / 0.879 with all markers detected. The buffer candidate at 64 kb/s
had minima 0.879 / 0.876. These are diagnostics at accepted marker positions,
not a subjective audio-quality score or a continuous waveform qualification.

A separate system-libopus diagnostic had reproduced marker 360 below the fixed
threshold at 32 kb/s (0.794), versus 0.869 at 64 kb/s and 0.872 at 96 kb/s.
That diagnostic used libopus 1.5.2 rather than Chromium's implementation; the
browser measurements above supplied the relevant route evidence.

The pinned WebRTC implementation uses the standard sender maximum as its
application-configured target, bounded by codec/SDP and network constraints:
[ComputeSendBitrate](https://webrtc.googlesource.com/src/+/6f37672d358475cd17544121a12494da454d85fb/media/engine/webrtc_voice_engine.cc).
A readback alone does not prove the transmitted rate, hence the retained RTC
timestamps and byte deltas. Older recordings without timestamps retain unknown
payload rates.

## Retained unsuccessful attempts and controls

| Attempt under `/var/tmp/` | Observation | Verdict |
| --- | --- | --- |
| `couch-lat2-base120-1` | Two outputs, original buffers, q512; all markers, 4 / 2 recorder/witness xruns | Invalid timing comparison |
| `couch-lat2-buffer120-1` | Two outputs, 128-frame buffers, q512; all markers, 10 / 5 xruns | Invalid timing comparison |
| `couch-lat2-cal1024-1` | Five-second known-delay q1024 control, exact 20 / 80 / 150 ms, no xruns | Complete control |
| `couch-lat2-q1024-base120-1` | Original buffers, all markers, 12 / 6 xruns | Invalid timing comparison |
| `couch-lat2-cal1024-long-1` | No browsers, 120 seconds, all markers at exact known delays; 12 / 4 xruns | Invalid control; isolates an instrumentation/environment failure |
| `couch-lat2-pinned-cal120-1` | Same long q1024 control with the CPU split; 1,200 markers/output, exact known delays, no xruns | Complete control |
| `couch-lat2-pinned-cal512-1` | Five-second q512 control with that split; exact known delays, no xruns | Complete control |
| `couch-lat2-pbase-1` | Healthy q512 capture, original buffers/default bitrate; one missing marker | Incomplete recording |
| `couch-lat2-p64base-1` | Probe configured one sender before the second finished negotiation | Aborted before recording; probe corrected |
| `couch-lat2-prod-cal-1` | Repository runner's CPU-split integration, exact known delays, no xruns | Complete control |
| `couch-lat2-prod2-1` | Short application integration; capture channel count selected 128 kb/s despite mono Opus | Complete recording; budget selection corrected before final validation |

Xrun counts include one notification per JACK client; the calibration graph has
three clients and the browser graph has two. They are not loss-duration estimates.
Audio threads were observed on a busy CPU despite other assigned CPUs being
idle. The successful CPU split supports a scheduling explanation; it provides
neither realtime guarantees nor exclusive ownership of those CPUs. No host
scheduler settings or unrelated processes were changed.

## Reproduce the production profile

Use a fresh build and unique private artifact directories. The CPU numbers below
must be available on the worker; keep the same declared allocation across a
comparison. The prefix contains the private prerequisites, not installed audio
configuration.

```sh
node_modules/.bin/bun run build
COUCH_LAB_PREFIX=/path/to/root/usr COUCH_LAB_AUDIO_CPUS=10,11 \
COUCH_LAB_APP_AUDIO_DEFAULTS=1 COUCH_LAB_RECEIVERS=10 \
COUCH_LAB_SECONDS=120 COUCH_LAB_QUANTUM=512 \
xvfb-run -a scripts/live-audio-network.sh run --profile control --clients 10 \
  --duration 900 --cpu-list 0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15 \
  --max-rss-mb 24000 --max-processes 512 \
  --evidence /var/tmp/couch-latency-network-UNIQUE -- \
  "$PWD/node_modules/.bin/bun" tests/live-audio.native.ts direct \
  /var/tmp/couch-latency-UNIQUE
```

Leave `COUCH_LAB_APP_AUDIO_DEFAULTS` unset to test the original Chromium buffer
policy with the current application bitrate policy. Recalibrate changes to the
JACK profile. See [the lab](live-audio-lab.md) for boundary controls and
[the scale runner](live-audio-performance.md) for longer activity tests. These
receivers are separate browser processes, not physical phones or Wi-Fi devices.

The matched ten-minute activity controls use:

```sh
COUCH_LAB_PREFIX=/path/to/root/usr COUCH_LAB_APP_AUDIO_DEFAULTS=1 \
COUCH_SCALE_SECONDS=600 COUCH_SCALE_ROUNDS=1 \
xvfb-run -a scripts/live-audio-network.sh run --profile control --clients 50 \
  --duration 1200 --cpu-list 1,2,3,4,5,6,7,8,9,10,11,13,14,15 \
  --max-rss-mb 48000 --max-processes 1024 \
  --evidence /var/tmp/couch-latency-scale-network-UNIQUE -- \
  "$PWD/node_modules/.bin/bun" tests/live-audio-scale.native.ts \
  /var/tmp/couch-latency-scale-UNIQUE
```

Run sequentially and omit `COUCH_LAB_APP_AUDIO_DEFAULTS` for the original-buffer
control. The declared ten minutes begin after all 50 receivers are admitted and
the fixed 15-second warmup ends. Admission, warmup, reconnects and cleanup add to
the elapsed runtime. Build and offline recording analysis run outside capture.

## Implementation checks

The application change passed 49 live-client tests (98 assertions), project
typechecking and the production build. Built Main startup checks verified the
default 128-frame switch and explicit 0/512 overrides. The observer correction
passed strict targeted TypeScript checking, the two-receiver preflight and both
matched 50-receiver controls. Whitespace checks passed. No acceptance threshold,
warmup interval, RPC timeout or recovery allocation was relaxed.
