# Live audio testing without phones

Researched 2026-10-20. Planning only; no implementation, accounts or purchases. Scope: 50–100 browser listeners, ≤100 ms capture-to-sound latency, and tight speaker synchronization.

Useful progress needs no paid service. Linux can establish software-path latency, recovery and server capacity, and expose designs that already exceed 100 ms before hardware output. It cannot certify 50–100 phone speakers on event Wi-Fi. A device lab adds compatibility evidence; final acoustic and radio validation still needs access to physical equipment, whether borrowed, rented or provided by a specialist lab.

The [implementation plan](live-audio-event-plan.md) owns the acceptance gates and N0–N7 test profiles. The profiles and short exploratory sweeps below are research options, not a second qualification contract.

## Define the evidence before testing

- Measure latency from a known signal entering capture to its appearance at each receiver's recorded output. Label a virtual input/output result **software-path latency**, excluding physical ADC/DAC, speaker and acoustic propagation delays.
- For each repeated marker, report per-receiver latency p50/p95/p99/max, and simultaneous output spread `max(t_i) - min(t_i)`, plus missing markers, silence/dropouts and recovery time. Do not hide one slow listener in fleet averages.
- “Tight” needs a numerical tolerance from the parent plan. Until then, report exceedances of 1, 2 and 5 ms; do not invent a speaker-sync pass. A p99 ≤100 ms result also does not establish an absolute ≤100 ms ceiling.
- Distinguish **100 protocol clients**, **100 actively decoding/rendering browsers**, and **100 physical phones** in every result. Connections and successful packet delivery alone prove neither decoding nor sound.
- Save versions, CPU/RAM/network utilization, actual active renderer count, PCM evidence, qdisc counters, impairment seeds and selected transport. A saturated load generator makes the capacity conclusion inconclusive.

## Free baseline: existing native runner plus recorded browser audio

Reuse the isolated Electron/Chromium probe pattern in [live-close.native.ts](../tests/live-close.native.ts) and [capture-consent.native.ts](../tests/capture-consent.native.ts): real Main/preload/renderer/Core, synthetic capture, temporary app/data and evidence files. These are lifecycle/permission checks, not an existing latency benchmark. Follow [CI's native display instructions](ci.md) (`xvfb-run` when needed). Give each scratch Couch its own `COUCH_DATA_DIR` and `COUCH_PORT`, and stop owned processes by PID.

Proposed measurement arrangement:

1. Generate a deterministic broadband marker sequence into a dedicated virtual capture source; preserve an upstream reference channel. Exercise the actual encode/transport/decode/playback path, not just a generated receiver oscillator.
2. Route each measured browser's live audio output to a separate null sink/monitor. Record the reference and receiver outputs with a common capture timeline, preferably as channels in one graph/recording. Independent file start times are not synchronized measurements.
3. Cross-correlate markers to measure arrival and missing audio. Calibrate with a direct software loopback, account for graph/recorder buffering and scheduling uncertainty, and retain raw measurements alongside any correction. The measurement error must be smaller than the sync tolerance.
4. Keep output actively rendering, with explicit user activation where required; verify non-silent PCM on every claimed receiver. Do not mute or replace output with an offline graph. Use separate browser instances/process groups where needed for independent sink routing; many tabs can share an audio service.

[PulseAudio's modules documentation][pulse] explicitly says the null sink is clocked by system time and has a monitor source. [PipeWire's null sink][pipe-null], [loopback module][pipe-loop] and [`pw-record`/`pw-cat`][pipe-record] provide corresponding routing and recording building blocks. Select one installed audio stack; do not build two harnesses initially. Use dedicated test routes without changing the owner's default sink or installed Couch.

Browser `currentTime`, scheduled playback time, packet timestamps and WebRTC statistics are diagnostics, not independent observations of sound. [Web Audio][webaudio] defines `outputLatency` as an estimate and `getOutputTimestamp()` as a mapping of stream position to estimated performance time; `baseLatency` excludes additional hardware-path latency. Record these alongside PCM to explain failures, not instead of it. A virtual sink can render ahead into buffers: PCM must be interpreted against the calibrated graph timeline, not the recorder callback's arrival time.

All local virtual sinks share host timing; they do not reproduce independent phone oscillator drift. Add explicitly synthetic clock offset/skew and receiver resampling scenarios (for example ±50/100 ppm over 30 minutes) to test the correction algorithm. Label these injected conditions; they are not evidence of actual hardware clock behavior.

## Network emulation that covers the actual media

[Network namespaces][netns] isolate routes/interfaces; [netem][netem] applies packet delay, jitter, loss, duplication, reordering and rate limits. It acts on packets, so a correctly placed qdisc covers UDP media and TCP/WebSocket traffic; browser HTTP throttling alone does not establish this coverage.

- Put scratch server and receivers behind a dedicated namespace/veth router. Apply separate qdiscs on router egress toward each receiving side, shaping **both directions**, including feedback, ACKs and clock exchanges. For per-client impairment, use separate client namespaces/veth links or explicit flow classification. Never alter the owner's physical-interface qdisc.
- Netem defaults to egress. Its manual specifically recommends receiver-ingress placement for realistic TCP results because of TCP Small Queues. Router egress immediately before the receiver supplies that placement; IFB ingress redirection is another option. Do not just add delay to the TCP sender's root qdisc and assume equivalence.
- Verify routes, selected WebRTC ICE candidate pairs and `tc -s` counters: no localhost, IPv6, direct ICE, TURN or alternate interface may silently bypass the intended path. Test UDP and forced TCP/TURN fallback separately when the transport supports them.
- Use reproducible seeds, explicit queue limits and measured delivered rates. `delay … distribution normal`, `loss random`, `loss gemodel`, `rate` and `slot` cover jitter, independent/burst loss and constrained/bursty service. Netem warns that timer granularity can create artificial packet compression; `slot` is only a crude Wi-Fi-like approximation.

Start with three declared engineering profiles, not claims about typical Wi-Fi:

1. Clean: no artificial impairment; establishes host/codec/graph floor.
2. Moderate: 10 ms one-way delay with 3 ms jitter, 0.1% independent loss, asymmetric uplink/downlink shaping. Log the rate relative to measured media demand.
3. Stress: 20 ms one-way delay with 10 ms jitter, correlated loss bursts, a 100 ms outage, and a shared bottleneck stepped from 2× to 1.2× to 0.8× aggregate offered load. State the burst model parameters and realized loss. Outage/overload phases test failure and bounded recovery, not continuous ≤100 ms success.

Include a small delay-asymmetry sweep because RTT/2 clock estimation can be biased even when round-trip latency looks acceptable. Shared bottleneck and independent per-client faults answer different questions; exercise both.

Netem cannot create 50 competing Wi-Fi radios, CSMA contention, hidden nodes, airtime fairness, RF interference, power saving or the venue AP's queue behavior. It also cannot reproduce mobile thermal throttling or phone audio hardware. These are explicit untested conditions, not defects in the baseline.

## A bounded first experiment

1. Validate recording and timing with one receiver and a direct loopback. Stop to fix the measurement if its uncertainty exceeds the proposed sync tolerance.
2. Run protocol-only fanout at 1/10/50/100 clients for two minutes per step; measure server resource use and delivery/backpressure. This is the cheap capacity screen.
3. Run real decoders/renderers at 1/4/16/50/100 for five minutes per step while resources permit. Record all output channels needed for the claimed sync result. Stop at the host ceiling; report the largest demonstrated population. Split across already available hosts only if necessary, and then account for separate clock domains.
4. At the highest sustainable real-renderer count, run moderate and stress profiles for ten minutes each with three fixed seeds, then a 30-minute drift/join/leave/reconnect run. Keep background/suspend behavior as a separate scenario rather than silently disabling throttling.
5. Produce a compact evidence report separating transport capacity, software audio latency/sync, compatibility and untested physical behavior. If the clean software path already exceeds 100 ms, fix that before spending on a lab.

This bounds the initial sweep to roughly two hours of playback after harness setup, subject to host capacity. Harness work is separate. One machine is not guaranteed to sustain 100 browsers; a result at 16 browsers plus 100 protocol clients must retain both numbers.

## Emulators and browser engines

- **Android Emulator:** useful for Android Chrome functional behavior, permissions and lifecycle checks. Google's [networking documentation][android] calls its Wi-Fi AP simulated. Host CPU, virtual audio and virtual networking cannot establish phone speaker latency, independent hardware drift or crowded RF behavior.
- **iOS Simulator:** useful for Safari behavior if a Mac/Xcode is already available; not a Linux substitute or a reason to buy hardware now. Apple's [archived Simulator guide][ios] explicitly warns that host CPU/memory/network performance differs from a device and describes testing web apps in Simulator Safari. The guide is retired: do not treat its old unsupported-feature list as current. Physical output timing remains unmeasured.
- **Playwright WebKit:** a useful extra compatibility screen. [Playwright documents][playwright] that its patched WebKit is built from upstream sources and does not automate branded Safari. An iPhone viewport/device descriptor is not shipped iOS Safari, a phone decoder, or mobile hardware.

## Optional paid tier: a small real-device compatibility sample

Start with one or two available iPhones/Safari and Android/Chrome devices, sequentially if necessary. Test joining, user-gesture playback through the lab's documented capture path, supported codec/transport, interruptions, reconnects and browser statistics. A captured playback stream does not independently verify physical speaker emission. No paid tier is required before the free baseline produces useful findings.

- **BrowserStack Live:** [audio streaming docs][bs-audio] explicitly support streaming website audio from listed Android devices and iOS devices using ReplayKit to the tester's speakers. This proves an observable playback path, subject to that device/browser support list. It does not document synchronized raw PCM exports or calibrated source-to-speaker timing. [Audio injection][bs-injection] feeds a simulated microphone and is a different feature, not evidence of output capture.
- **Sauce Labs:** [Audio Capture][sauce-audio] documents live streaming and audio in test video artifacts on real Android/iOS devices, with the explicit limitation **“Website testing is not yet available on Android.”** Native-app support must not be sold as Android browser audio coverage. Confirm the exact iOS browser workflow before booking; emulators/simulators are excluded from this capture feature. Its live listening feed uses Twilio WebRTC, which is the lab's monitoring transport, not proof that Couch's WebRTC path works.
- **Local access/WebRTC:** [BrowserStack Local][bs-network] documents a TCP-level proxy for HTTPS/WebSockets; [Sauce Connect 5][sauce-network] uses a forwarding proxy and HTTP/2 tunnel. A page loading through either tunnel does not establish private UDP ICE/STUN/TURN reachability. First verify actual candidate pairs and media flow; a reachable public relay or explicitly supported tunnel configuration may be needed. Forced TURN/TCP tests a different route, and cloud WAN/tunnel latency is not venue-LAN latency.
- **Concurrency:** both [BrowserStack][bs-concurrency] and [Sauce][sauce-concurrency] enforce account/team concurrency allowances; queued tests are not simultaneous listeners. Confirm available real devices and overlapping sessions, rather than assuming a catalog of 100 models means 100 concurrently usable phones. A small sequential compatibility matrix is sufficient for this tier.

**Synchronized acoustic measurement:** none of the reviewed official service pages documents calibrated microphones, a shared sample clock/trigger, known speaker-to-microphone geometry, or coordinated acoustic capture across phones. No reviewed page establishes that selected farm devices share one Wi-Fi/AP. Thus neither service is a verified offering for the target acoustic experiment; availability of a custom service remains unknown. Video/audio session recordings and remote listening are debugging artifacts, not metrology.

A later physical gate needs a source reference and simultaneous multichannel microphone recording near the phone speakers, calibrated channel/propagation delays, and the target AP with 50–100 active radios. Borrowed/rented devices or a specialist lab can supply this without ownership. Until that gate, report “software baseline passed” and the exact real-device compatibility sample, never “100 phones meet ≤100 ms and speaker sync.”

[pulse]: https://wiki.freedesktop.org/www/Software/PulseAudio/Documentation/User/Modules/
[pipe-null]: https://docs.pipewire.org/page_pulse_module_null_sink.html
[pipe-loop]: https://docs.pipewire.org/page_module_loopback.html
[pipe-record]: https://docs.pipewire.org/page_man_pw-cat_1.html
[webaudio]: https://www.w3.org/TR/webaudio/#dom-audiocontext-getoutputtimestamp
[netns]: https://man7.org/linux/man-pages/man8/ip-netns.8.html
[netem]: https://man7.org/linux/man-pages/man8/tc-netem.8.html
[android]: https://developer.android.com/studio/run/emulator-networking
[ios]: https://developer.apple.com/library/archive/documentation/IDEs/Conceptual/iOS_Simulator_Guide/TestingontheiOSSimulator/TestingontheiOSSimulator.html
[playwright]: https://playwright.dev/docs/browsers
[bs-audio]: https://www.browserstack.com/docs/live/media/audio-streaming
[bs-injection]: https://www.browserstack.com/docs/automate/selenium/audio-injection
[sauce-audio]: https://docs.saucelabs.com/mobile-apps/features/audio-capture/
[bs-network]: https://www.browserstack.com/docs/local-testing/network-and-architecture
[sauce-network]: https://docs.saucelabs.com/secure-connections/sauce-connect-5/architecture/
[bs-concurrency]: https://www.browserstack.com/docs/automate/selenium/troubleshooting/parallel-test
[sauce-concurrency]: https://docs.saucelabs.com/basics/acct-team-mgmt/concurrency/managing-concurrency/
