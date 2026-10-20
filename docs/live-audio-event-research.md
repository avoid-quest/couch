# Live audio to 50–100 phones at an event

Research date: 2026-10-20. Scope: dedicated venue Wi-Fi, sound-card live inputs or music playback, phone speakers and headphones. This is primary-source research and a code audit, **not a phone benchmark or a capacity guarantee**. No application code or installed data was changed, and no Couch instance was started. See the [current code audit](#couch-code-audit-at-1dcfb69), [live synchronization](live-sync-research.md) and [prior performance evidence](live-sharing-performance.md).

## Feasibility and the three different targets

**50+ audio receivers is a plausible engineering target on a managed WLAN; ≤100 ms capture-to-speaker on every arbitrary phone is not defensible without qualifying devices and measuring them.** An audio-only WebRTC path with a wired local SFU is the strongest initial investigation for live private listening. Speakers playing aloud additionally require synchronized physical output and an acoustic assessment. Neither WebRTC nor an SFU guarantees that synchronization.

- **End-to-end latency:** physical input/capture → capture buffering and processing → frame accumulation/codec → transport → receiver buffering/decoding → OS/device → sound emitted. Network transit, ping, and browser buffer statistics measure only parts of it.
- **Inter-phone skew:** the difference between phones' emission times for the *same source sample*. All phones could be 500 ms late and tightly aligned, or each below 100 ms but badly misaligned. A shared sample timestamp alone does not align their clocks or output pipelines.
- **Listener arrival time:** emission time plus distance/speed of sound. This matters even with perfectly synchronized devices.

For **live sound-card input**, investigate both low delay and skew. For **music already available ahead of playback**, prebuffering and a shared future start time can buy synchronization reliability without delaying a live source; startup and control responsiveness become separate requirements. Headphones reduce the need for group alignment, but Bluetooth output must be tested separately from built-in or wired output.

As an **illustrative allocation, not a prediction**, a 100 ms live budget might allow 10 ms capture, 20 ms frame accumulation, 10 ms codec/processing, 10 ms transport, 20 ms receiver buffering and 30 ms output. There is no spare margin. Any slower component breaks that budget; frame accumulation must not be counted again as a second codec frame delay. Android explicitly documents substantial device/build variation in input/output latency. [Android latency definitions and measurement](https://developer.android.com/ndk/guides/audio/audio-latency).

## WebRTC controls and synchronized playout

`RTCRtpReceiver.jitterBufferTarget` accepts **0–4000 ms**, or `null` for no application preference. It requests buffer occupancy, not a maximum capture-to-output delay or a group playback time. The browser can clamp it to changing internal limits; reading it back returns the requested value even when the actual target differs. Locally synchronized A/V receivers should use the larger target. Setting zero therefore does not eliminate buffering. [WebRTC specification](https://w3c.github.io/webrtc-pc/#dom-rtcrtpreceiver-jitterbuffertarget).

This control shipped in [Chrome 124](https://developer.chrome.com/release-notes/124#media); [Safari 27.0 release notes](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/#webrtc) announce its addition. Older Safari populations cannot be assumed to expose it. Feature-detect on actual phones, record engine/version, and verify behavior rather than treating property assignment as success.

Measure actual average buffer residence over intervals as `ΔjitterBufferDelay / ΔjitterBufferEmittedCount`. Where implemented, target/minimum delay counters, concealment and sample insertion/removal help explain buffering and drift correction. These are diagnostics, not acoustic latency measurements. [WebRTC Stats](https://w3c.github.io/webrtc-stats/#dom-rtcinboundrtpstreamstats-jitterbufferdelay).

Synchronized output requires a shared clock mapping, scheduled samples, drift correction, enough lead for the slowest admitted receiver, and output-delay accounting. A live `MediaStream` media element ignores attempts to seek or set playback rate, so ordinary media-element controls cannot implement this clock follower. [Media Capture specification](https://w3c.github.io/mediacapture-main/#mediastreams-in-media-elements). Investigate the existing scheduled playback path for this requirement; do not infer synchronization from independent low-latency WebRTC receivers.

## Opus: short frames help, with real tradeoffs

Opus supports **2.5, 5, 10, 20, 40 and 60 ms frames**, with packets containing up to **120 ms** of audio. SILK uses 10–60 ms frames and 5 ms lookahead, with possible resampling delay; CELT supports 2.5–20 ms frames with **2.5 ms lookahead**. The headline **5 ms minimum algorithmic delay** is a codec operating point, not browser capture-to-speaker latency. Frames below 10 ms exclude SILK/hybrid modes. Actual codec delay depends on configuration/implementation; native libopus provides `OPUS_GET_LOOKAHEAD` rather than recommending a hard-coded value. [RFC 6716 §§2–2.1.4](https://www.rfc-editor.org/rfc/rfc6716.html#section-2), [encoder API](https://opus-codec.org/docs/opus_api-1.5/group__opus__encoder.html), [lookahead API](https://opus-codec.org/docs/opus_api-1.5/group__opus__encoderctls.html).

**20 ms is a sensible baseline to measure; compare 10 ms if the latency budget needs it.** Halving packet duration doubles packet rate at the same payload bitrate. The codec's supported frame sizes do not establish what a particular browser sender will actually emit: verify negotiated parameters and packet timing. In-band FEC recovers an earlier packet from the following packet, so that recovery needs the next packet to arrive before the playout deadline. Shorter buffering trades recovery opportunity for delay. [RFC 7587 §§3.3, 4.2, 5](https://www.rfc-editor.org/rfc/rfc7587.html#section-3.3).

## Web Audio and native output limits

`AudioContext({latencyHint: "interactive"})` is a preference. `baseLatency` covers handing audio from the destination node to the audio subsystem; it excludes graph processing and subsequent hardware latency. `outputLatency` estimates device output delay and can change with the route. `getOutputTimestamp()` maps context sample time to an estimated local performance-clock output time; it does not synchronize remote clocks. These enable scheduling and calibration, not a universal timing guarantee. A 128-frame render quantum at 48 kHz is 2.67 ms, **not** the whole output delay. Creating an unrelated low-latency context does not configure an ordinary WebRTC media element's pipeline. [Web Audio specification](https://webaudio.github.io/web-audio-api/#AudioContext).

Native clients offer more control, still subject to hardware and OS behavior. Android recommends Oboe/AAudio low-latency mode, appropriate sample rate, callbacks and tuned buffers; exclusive access is a request. Its published example reports **20 ms local round-trip** with recommendations followed, explicitly warning that results vary greatly between devices. This is Google's example, not a Couch/network result. Apple's preferred I/O buffer duration is also a hint; query actual settings after activation. [Android guide](https://developer.android.com/games/sdk/oboe/low-latency-audio), [Apple QA1631](https://developer.apple.com/library/archive/qa/qa1631/_index.html). A qualified native receiver fleet is an opportunity if browser output control proves insufficient, not a guarantee for arbitrary phones.

## Fanout, packet rate and venue Wi-Fi

An SFU can receive one compatible encoded stream and forward it to many receivers without transcoding. This removes the need for N source encodings/uplinks; per-receiver RTP/SRTP, feedback and egress remain. It does not align speakers. Mediasoup is one concrete reference architecture, not a dependency recommendation. [No transcoding](https://mediasoup.org/faq/#does-mediasoup-transcode), [producer/consumer negotiation](https://mediasoup.org/documentation/v3/mediasoup/rtp-parameters-and-capabilities/).

**Calculated example:** continuous 64–128 kbit/s Opus, one 20 ms packet, no DTX: each stream is **50 packets/s**, about **160–320 payload bytes/packet**.

- **50 receivers:** 2,500 packets/s, **3.2–6.4 Mbit/s payload**; **4.0–7.2 Mbit/s** after only the base 40-byte IPv4/UDP/RTP headers.
- **100 receivers:** 5,000 packets/s, **6.4–12.8 Mbit/s payload**; **8.0–14.4 Mbit/s** after those same headers.

Header calculation: 20-byte IPv4 + 8-byte UDP + 12-byte RTP; no options/CSRCs. These figures exclude SRTP authentication, RTP extensions, RTCP/ICE, IPv6's larger header, Wi-Fi MAC/security headers, PHY preambles, acknowledgements, contention, retries and aggregation effects. They are **not WLAN capacity estimates**. [IPv4](https://www.rfc-editor.org/rfc/rfc791.html#section-3.1), [UDP](https://www.rfc-editor.org/rfc/rfc768), [RTP](https://www.rfc-editor.org/rfc/rfc3550.html#section-5.1).

Topology matters: a wired sender/SFU needs one wireless downlink transmission per recipient. Direct per-recipient fanout from a Wi-Fi source through the same AP/channel needs **two wireless hops per copy**, approximately 2N media transmissions before retries. A Wi-Fi publisher sending **one** stream to a wired SFU instead needs one source uplink plus N downlinks. Multiple wired APs on planned channels can distribute load; “100 associated clients” and advertised Mbps do not establish real-time capacity. Lower rates occupy airtime longer, and power-saving/aggregation can delay even unicast delivery. [RFC 9119 §§3.1.2–3.1.4](https://www.rfc-editor.org/rfc/rfc9119.html#section-3.1.2).

IP multicast is not a portable browser escape hatch: WebRTC expects unicast endpoints and does not require multicast group support. Direct Sockets' multicast API is restricted to isolated contexts, not ordinary cross-browser pages. Native multicast would still face Wi-Fi basic-rate, reliability and power-save problems; AP multicast-to-unicast conversion restores per-recipient airtime. [RFC 8834 §5.1](https://www.rfc-editor.org/rfc/rfc8834.html#section-5.1), [Direct Sockets draft](https://wicg.github.io/direct-sockets/), [RFC 9119 §§3–4](https://www.rfc-editor.org/rfc/rfc9119.html#section-3).

## Mobile lifecycle and room acoustics

Plan for an explicit **Join / start audio** gesture on each listener, checking playback/resume success. Chrome restricts audible autoplay and Web Audio startup; Safari's documented MediaStream exceptions include already capturing or already playing audio. Receiving audio should not depend on unnecessarily opening the listener's microphone. [Chrome policy](https://developer.chrome.com/blog/autoplay/), [WebKit policy](https://webkit.org/blog/7763/a-closer-look-into-webrtc/#media-capture-and-autoplay-video).

Screen lock, backgrounding, calls, route changes and resource pressure belong in the device matrix. Chrome normally protects active audio/WebRTC from discard, but documents exceptions under extreme resource pressure. WebKit has had background AudioContext regressions, including [261554, now resolved](https://bugs.webkit.org/show_bug.cgi?id=261554); this is historical evidence for regression testing, **not a claim that current Safari always stops audio**. [Chrome lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api).

Sound travels approximately **343 m/s at 20°C**: **2.9 ms per metre**, or **29 ms across 10 m**. Identical emission times therefore do not create identical arrival times throughout a room. Multiple copies can produce comb filtering or audible echoes; no single per-phone delay aligns them at every audience position. If the original live sound is audible, include its arrival separately. [NASA's sound-speed relationship](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/speed-of-sound-interactive/); numerical calculation uses room-temperature air.

An open live microphone creates a feedback loop when it captures the phones' amplified output. Browser echo cancellation attempts to cancel specified playback references; it is not a distributed feedback controller for 50 independently delayed loudspeakers. Distinguish a clean music/line feed from a microphone mix, assess placement/gain and room behavior, and investigate headphones or deliberate speaker zones where needed. [Media Capture echo cancellation](https://w3c.github.io/mediacapture-main/#dom-mediatrackconstraintset-echocancellation), [Shure feedback guidance](https://www.shure.com/en-US/insights/how-to-control-feedback-in-a-sound-system).

## Measurement that can establish an operating envelope

1. **Define acceptance:** capture-to-acoustic-output ≤100 ms at a specified percentile *per phone*, plus worst observed delay, dropout rate and a separate group-skew target. A 2–5 ms skew target could guide an initial speaker experiment; it is not a universal perceptual threshold. A finite run cannot prove an all-time maximum.
2. **Measure acoustically:** inject a repeatable click/chirp into the actual sound-card input and record a simultaneous reference plus close-mic phone outputs on a common multichannel recording clock. Cross-correlate, account for microphone distances and recorder/interface delay. Browser timestamps or RTT/2 cannot replace this. For an all-phone skew claim, instrument all outputs simultaneously; a sampled subset only supports a subset claim. Test listener-position room sound separately.
3. **Scale the real population:** 1, 10, 25, 50, then 75/100 active phones; mixed current/older iOS and Android models, built-in speakers first, wired/Bluetooth routes separately. Run continuous speech and music, joins/rejoins and at least 30–60 minutes of drift/thermal testing. Keep the full network load active while instrumenting subsets if equipment is limited.
4. **Correlate diagnostics:** per-phone latency/skew distributions, p50/p95/p99 and observed maxima; concealment/underruns; actual packet duration, jitter-buffer counters, negotiated codec and selected ICE path; publisher/SFU CPU and egress; AP airtime, retries, rates, channel utilization and per-radio client counts. RTT is not one-way acoustic latency. Test weak-signal clients, concurrent venue traffic, background/lock/resume, calls and output-route changes.
5. **Compare opportunities separately:** direct WebRTC versus wired local SFU for live headphones; scheduled playback with measured output compensation for speakers; prebuffered scheduled music; native receivers only if a demonstrated browser limitation warrants them. Record the maximum population meeting the chosen tail-latency and glitch criteria on the tested equipment. Do not extrapolate localhost or synthetic clients into a phone benchmark.

## Couch code audit at `1dcfb69`

The user clarified that this is dedicated venue Wi-Fi, live sound-card inputs or
music playback, with both private listening and phones playing aloud together.
This is a source audit, not a new load or acoustic benchmark. No application
code was changed and no installed Couch instance was started.

### Concrete constraints in today's implementation

1. **Synchronized live ingestion already exceeds the budget.** Browser capture
   uses `MediaRecorder.start(250)`, uploads a continuous recording, and Core
   produces one-second HLS segments with AAC before the Sendspin decoder
   encodes Opus/PCM. The synchronized sender then schedules one second ahead.
   Reducing only the final buffer cannot make that pipeline sub-100 ms.
   [Capture/upload](../src/client/session/live.ts#L133),
   [HLS/transcoding](../src/server/live-stream.ts#L83),
   [scheduler lead](../src/server/sendspin.ts#L25).
   The eight-second decoded queue is a backpressure ceiling, not a mandatory
   additional eight seconds of latency.

2. **Direct live delivery scales work at the publisher.** Every receiver gets
   a separate `RTCPeerConnection`, track sender and negotiation; Couch has no
   encode-once packet-forwarding layer on this path. The ADR explicitly
   describes per-receiver encoding. Audio is much cheaper than video, so this
   is a scaling risk to measure, not proof that 50 audio receivers overload
   the publisher. There is no explicit receiver-count ceiling in the audited
   routing path.
   [Publisher loop](../src/client/session/live.ts#L84),
   [routing](../src/server/live-input.ts#L88),
   [ADR 0001](adr/0001-live-inputs-play-over-webrtc-unless-in-sync.md).
   Direct playback attaches a MediaStream to the media element; there is no
   shared physical presentation deadline, per-device output compensation, or
   WebRTC statistics collection in that path.
   [Renderer](../src/client/session/renderer.ts#L235).

3. **Joining 50 people has control-plane limits before media capacity.**
   `POST /api/pair` permits only **20 attempts per server-wide 60-second
   window**, including successful attempts. This limits onboarding rate,
   not simultaneous playback; pairing in advance avoids it.
   [Pairing handler](../src/server/hub.ts#L1366).
   Each control socket is also closed after **60 messages in one second**,
   before WebRTC signals are classified. All the publisher's offers,
   candidates, end-of-candidates messages and other commands share this
   allowance. The publisher starts all requested peers without pacing.
   A burst of 50 negotiations can exceed it; the exact burst timing needs a
   browser test. Closing the publisher socket ends its publication.
   [Rate limit and signal dispatch](../src/server/hub.ts#L1660),
   [publisher signals](../src/client/session/live.ts#L52),
   [publication teardown](../src/server/live-input.ts#L139).
   Opportunity: explicit bounded event admission and separately budgeted,
   authenticated signaling, retaining abuse protection.

4. **The grouped sender is already economical, but its chunks are large.**
   It decodes once per playback and encodes once per required wire format,
   then sends identical scheduled chunks to each member. Opus is **96 kbps,
   60 ms packets**; PCM is **48 kHz, 16-bit stereo, 100 ms chunks**. The send
   loop ticks every **20 ms**. Shorter live chunks and a tighter scheduler
   would be necessary; shorter packets also raise packet rate.
   [Encoder and tick](../src/server/sendspin.ts#L195),
   [fanout](../src/server/sendspin.ts#L274).
   PCM is 1.536 Mbps per receiver, versus 0.096 Mbps Opus: **16 times**
   the audio payload. All-PCM groups would be 76.8 Mbps for 50 receivers and
   153.6 Mbps for 100, before transport overhead.
   The pinned browser player excludes Opus on Firefox and some non-WebCodecs
   configurations; Couch does not offer FLAC, so those clients select PCM.
   This is an actual compatibility-dependent scaling cliff, not a statement
   that every phone uses PCM.
   [Format choice](../src/server/sendspin.ts#L29),
   [pinned player package, `dist/core/codec-support.js`](https://registry.npmjs.org/@sendspin/sendspin-js/-/sendspin-js-5.0.0.tgz).

5. **A bounded live deadline needs different congestion behavior.**
   In pinned server SDK 0.6.2, `sendPcmAudioFrame` sees a 512 KiB queued
   socket threshold, waits 5 ms, then sends anyway if the stream still exists.
   `sendBinary` drops on overload only when explicitly passed
   `allowDrop:true`, which audio does not pass. This is not an effective
   maximum audio-age policy or hard queued-byte cap. Couch's 4 MiB guard on
   its separate control socket does not protect the Sendspin media socket.
   At 96 kbps, 512 KiB is roughly 44 seconds of payload, illustrating why
   a byte threshold sized this way cannot enforce a 100 ms deadline.
   This identifies a code-level risk; no congested-client memory or latency
   failure was reproduced here.
   [Pinned server package, `dist/server/session.js`](https://registry.npmjs.org/@sonn-audio/node-sendspin/-/node-sendspin-0.6.2.tgz).
   Sendspin uses WebSocket/TCP, and the bundled TURN URL uses TCP to the relay;
   loss can block later bytes behind retransmission. Prefer a healthy local
   UDP WebRTC route for interactive delivery and measure the selected
   candidate/transport. TURN solves connectivity; it is not an SFU.
   [Relay URL](../src/server/live-relay.ts#L38),
   [Pion TURN helper](../native/live-relay/main.go#L80).

6. **The browser scheduler needs verification at much shorter lead times.**
   The pinned JS player reports `requiredLeadTimeMs:250` and
   `minBufferMs:250`; Couch supplies neither explicitly and does not use
   the server SDK's `getPlayerTiming()` in its scheduling budget. These
   reports are not two mandatory delays to add to the one-second lead.
   The player batches queue processing with a 15 ms timeout, accounts for
   reported output latency, and also applies a **100 ms Apple/iOS output
   compensation heuristic**. That heuristic schedules earlier; it is not
   a measured extra buffer or a universal iPhone hardware minimum. Its
   interaction with an under-100 ms source-to-output target must be checked
   on real devices; simply lowering the server lead is unsafe.
   [Couch player configuration](../src/client/session/sendspin.ts#L28),
   [pinned player package, README and `dist/audio/{scheduler,platform-output-latency,output-latency-tracker}.js`](https://registry.npmjs.org/@sendspin/sendspin-js/-/sendspin-js-5.0.0.tgz).

7. **Failure fallback violates the event's latency requirement.** Failed
   direct negotiation, or a ten-second connection timeout, moves that
   receiver to buffered HLS. Keeping it playing seconds late may suit
   ordinary playback but is unsuitable for a room of phone speakers.
   An event policy should expose the route and reject/mute or explicitly
   separate receivers that cannot meet the live deadline.
   [Receiver timeout](../src/client/session/live.ts#L206),
   [fallback routing](../src/server/live-input.ts#L101).

### Additional scaling opportunities to profile

- Core broadcasts full device/output/playback state to control sockets.
  Several paths repeatedly scan members/sockets; Sendspin's per-frame
  member loop calls a membership scan for each member. These are avoidable
  superlinear costs, but there is no profile showing they dominate at 50.
  Measure join/reconnect bursts and state traffic before changing them.
  [Broadcast](../src/server/hub.ts#L960),
  [member lookup and fanout](../src/server/sendspin.ts#L141).
- A late joining receiver that needs a previously unused codec restarts the
  grouped encoder, affecting existing listeners. Test mixed-browser late
  joins before an event.
  [`begin()`](../src/server/sendspin.ts#L163).
- The venue flow currently inherits home-device pairing, certificate trust,
  output consent and autoplay unlock. A participant joining a playback can
  gain group transport/queue control under the existing model; an audience
  role needs deliberate design for a public event.
  [Device authority](architecture.md),
  [browser trust/wake lock](browser-client.md).
- Input capture already offers an exact microphone/audio-interface device
  selection and asks to disable echo cancellation, noise suppression and
  automatic gain control. It does not request a particular audio latency,
  sample rate or channel count; check actual track settings and interface
  driver latency. A live microphone audible through nearby phones also
  creates an acoustic feedback path.
  [Capture constraints](../src/client/session/live.ts#L248).

### Best next investigation

Start with the same 2–5 real phones on Ethernet-connected source/Core and
dedicated Wi-Fi. Establish acoustic latency, output skew and jitter for each
route before adding more clients. If the small group already cannot fit
100 ms, scaling the server will not solve that floor.

For **live private listening**, measure current audio-only WebRTC fanout and
compare a proven local SFU if publisher encoding/negotiation is the bottleneck.
An SFU receives one encoded source and forwards it, while retaining separate
network/encryption work per receiver. It does not synchronize speaker output.

For **live phones playing aloud**, the promising seam is direct timestamped
audio ingestion into Couch's existing common clock and scheduling machinery,
bypassing MediaRecorder/HLS/AAC and evaluating shorter Opus frames, deadline
handling, drift correction and output compensation. First test whether the
existing browser scheduler and TCP transport can meet the target on the venue
network; change transport/rendering only for a measured gap. The pinned
server SDK explicitly says encrypted `source@v1` ingestion is unsupported,
so this is not an available one-line configuration change.
[Server SDK limitation](https://registry.npmjs.org/@sonn-audio/node-sendspin/-/node-sendspin-0.6.2.tgz).

For **music known in advance**, use native Couch playback and its synchronized
fanout/prebuffering rather than capturing another application's output.
Startup/control responsiveness and speaker skew remain relevant; there is no
unpredictable live input to transport. External DJ/mixer output remains a live
input even when the content is recorded music.

Scale through 10, 25, 50 and 100 real receivers, with mixed codecs, bulk joins,
rejoins and at least a sustained event-length soak. Measure per-device
capture-to-acoustic-output distributions, worst observed delay, inter-device
skew, lost/concealed samples, underruns, disconnects, CPU, socket backlog,
AP airtime/retries and output route changes. Pre-recorded-file playback,
sound-card loopback capture and microphone input need separate cases.

The capacity claim should be the largest **tested** group meeting both
latency/skew and dropout criteria, for a stated phone/browser/AP mix.
A 50–100-phone design target on controlled Wi-Fi is reasonable to investigate;
it is not a supported-capacity claim. Under a hard live deadline, stale
audio must be dropped/concealed or an outlying receiver excluded rather than
letting its queue grow or delaying every healthy listener.

### Existing measurements and their limits

[Prior local work](live-sharing-performance.md) reports about two seconds of
capture age at scheduled playback for buffered live audio, and a historical
200-client localhost PCM delivery experiment. The latter did not involve
phones, Wi-Fi, audio decoding or acoustic output. Direct-path measurements
there are video/frame-age experiments, not phone audio latency measurements.
The current live latency test checks two Node receivers and accepts less than
three seconds at first scheduled playback.
[Test and exclusions](../tests/live-latency.integration.ts#L70).
There is presently no evidence here establishing 50+ phones below 100 ms.
