# Optional master compression — research and implementation

**Implemented in this working tree**, 2026-10-23, following research against `3e603a5`. Direct uses Web Audio; Sendspin uses one FFmpeg compressor before its Opus/PCM split; native host mpv uses lavfi. The Playback owns the persisted settings and the mixer exposes a switch plus six advanced controls. WebRTC and Live Share, including buffered live sharing, are excluded. Direct keeps its delivery mode. Browser signal tests, real FFmpeg/Sendspin tests and preliminary Xeon measurements are recorded in [performance and verification](master-compressor-performance.md). The target Debian ThinkPad T480 has not been measured; Safari native HLS and a real mpv installation remain unverified. The source analysis and broader acceptance methodology below explain the choices and remaining hardware work.

## Chosen direction

Use built-in processing in each existing playback route: **Web Audio `DynamicsCompressorNode` for Direct, FFmpeg `acompressor` in shared Sendspin audio, and mpv `lavfi` for native host playback**. Direct need not enter a buffered server audio pipeline. Treat this as dynamic-range compression with optional makeup gain, not guaranteed equal loudness across programmes or guaranteed brickwall/true-peak protection. The browser and FFmpeg compressors have different detector/curve/makeup behavior; identical-looking settings will not make them sound identical. Native Safari HLS remains a material compatibility uncertainty. [1][2][8][9]

## Product scope and ownership

Add one **Compressor** switch beside the shared Volume in **Where it plays**, default off, with one gentle preset. An **Advanced** disclosure exposes the controls below; opening it does not change the sound. It belongs to the **Playback**, so the current programme keeps its setting when speakers join or delivery changes. Persist the enabled state and parameters alongside the Playback's queue/trim; a new Playback starts off with the default preset. Each device retains its own volume, mute and delay. A per-device compressor is a different listening preference and would need separate Sendspin processing; it is unnecessary for this shared-master feature. Independent Playbacks must not affect one another.

Couch has no single application-wide PCM master bus: its mixer controls outputs and levels, and its Playbacks can run concurrently. Put compression before listener volume/trim so moving a fader does not change the amount of compression. The existing playback authorization rules must apply to changing the shared effect. See [architecture](architecture.md), [hub volume and delivery logic](../src/server/hub.ts), [Playback persistence](../src/server/store.ts), and [mixer](../src/client/sections/shell/Outputs.tsx).

The useful first promise is **reduce loud passages**, not **make every source equally loud**. Start listening trials around a soft knee, 3:1 ratio, a threshold near −18 to −24 dBFS, 10 ms attack and 250 ms release; the initial defaults use −18 dB and remain subject to listening trials. Tune output gain separately in each engine, especially because Web Audio supplies automatic makeup. Avoid large boosts of quiet material/noise. Add adaptive leveling only if listening tests show this does not address the intended radio/movie use; it is a separate control problem. [1][2][8]

## Advanced controls

Use a flat shadcn disclosure inside the existing mixer, with a slider and editable numeric value for each setting, explicit units, and **Reset to default**. Closing Advanced preserves the current values; disabling compression preserves them for the next enable. Keep disclosure state local to the controller, while Core owns and validates the shared parameters. Do not add a separate global “pro mode” setting or repeat these controls on each device row.

The common controls are **threshold**, **ratio**, **attack**, **release**, **knee**, and **output gain**. Implemented product bounds, deliberately within the engines' supported ranges, are −60…0 dBFS, 1:1…20:1, 0.1…1000 ms, 1…1000 ms, 0…18 dB, and −12…+12 dB respectively. These are initial UI bounds, not final preset values or a claim that every setting sounds the same in every engine. Core rejects non-finite or out-of-range values rather than letting engines silently clamp them differently. [1][2][8]

Store user-facing dB/ms values and translate at the engine: FFmpeg threshold is `10 ** (dB / 20)`, Web Audio attack/release are seconds, and FFmpeg's knee factor is `10 ** (kneeDb / 20)` for the nominal knee width. Its source places the knee edges at threshold divided/multiplied by the square root of that factor. This converts units, not detector or transfer-curve behavior. Output gain is an explicit post-compressor gain, before device volume/trim, and is bypassed with the effect. It is not the main Volume. [2][8]

Label that last control **Output gain**, not “manual makeup”: the browser's built-in automatic makeup cannot be turned off independently, so the slider adjusts its result. Do not offer an Auto makeup switch, detector/sidechain controls, adjustable lookahead, limiter ceiling or dry/wet mix as if every engine supported them. A professional rack with identical algorithms and manual makeup across routes would require a different DSP implementation; these six controls fit the lightweight built-in approach.

Advanced settings are drafts until **Apply**, with a pending indicator and one update of the edited fields. Core merges them into the current settings and validates the result together. This avoids restarting/rebuffering Sendspin for every slider movement and makes editing consistent across controllers. Preserve acknowledged values on failure and refresh the controls from Core after success. Reset fills the default draft; Apply commits it. Parameter changes must use the same smoothing/rebuffer rules as the main toggle. If realtime audition becomes a requirement, verify runtime control and already-buffered audio behavior first.

An optional gain-reduction meter should use actual engine data. Web Audio exposes `reduction`; FFmpeg's current CLI integration does not expose an equivalent reading, and device volume is not a substitute. Defer a universal meter until there is a measured, low-overhead source for each route. Any implemented meter updates only while Advanced is visible, at a modest rate, without rerendering the entire player or adding continuous WebSocket traffic while closed. [8]

## Performance measurement requirement

Performance measurements are part of the feature's acceptance, not an assumed benefit of using native filters. Record before/after results on the actual TV or weakest supported playback device, with the production build, hardware/browser/OS details, commit, helper versions, output/sample rate, codec, source and client count. Follow the reproducible-artifact convention in [preview-performance.md](preview-performance.md); the existing [native player fixture](../tests/player-performance.native.ts) can help measure UI work, but does not exercise Core, Sendspin or the real audio graph by itself.

Compare four states on the same source, position and delivery route: **no effect graph**, **graph attached but bypassed**, **default compression with Advanced closed**, and **compression while Advanced is open/edited**. Include a demanding supported parameter set. For Direct sources needing a CORS relay, repeat the no-graph/bypass/active comparison with the relay held constant; report the extra direct-to-relay traffic/cost separately. Otherwise the result conflates DSP overhead with a transport change. Bypass can retain processing work, so it is not a sufficient disabled-cost baseline on its own.

Use deterministic locally served radio-like audio and a movie fixture for controlled comparisons, followed by representative real-source checks. Warm each steady-state case for 30 seconds, sample for at least 60 seconds, and repeat at least three times in alternating order. Measure cold startup and toggles separately. Run serially without competing builds/tests; keep output device, power settings and hardware acceleration fixed. Do not mute or disconnect the output graph merely to make the test quiet if that lets the engine skip work. A headless run or a phone-sized viewport does not establish physical-device performance.

Collect and retain:

- **CPU:** mean and p95 of fixed-interval samples, in percent of one logical core, and CPU seconds per minute. Include the renderer, Chromium audio/utility processes, Core, FFmpeg and mpv as applicable; Core's CPU alone misses the DSP. Report per-device/process attribution and total incremental cost, avoiding double counting.
- **Memory and transport:** steady/peak resident memory, longer-run growth, bytes transferred and active helper count. In sync, compare two and four receivers, Opus-only and mixed Opus/PCM, and two independent Playbacks; shared DSP should scale with Playbacks, while transmission still scales with receivers.
- **Playback:** startup time, action-to-audible-change time, rebuffer duration, underruns/dropouts where observable, video dropped frames, A/V offset and inter-speaker skew. Distinguish software scheduling counters from measured physical output; use a timestamped impulse/flash and loopback or external recording for physical latency/alignment claims. Do not infer audible gaps from intentional source silence.
- **UI and monitoring overhead:** frame times and long tasks with Advanced closed, open, and changing values; meter collection/rendering separately if implemented. Diagnostic traces run separately from primary CPU samples so profiling overhead does not contaminate the comparison.
- **Signal checks:** offline comparisons of output level/peaks, stereo balance, silence/noise and expected gain reduction, including parameter extremes and bypass. Loudness analysis runs outside the timed performance sample; a faster implementation that clips or stops compressing is not a success.

Write raw JSON/CSV, fixture identity, configuration and run metadata under a task-specific `.artifacts/` directory, then add measured results and reproduction commands to this note. Report absolute deltas and repeat-to-repeat variation; do not turn noisy relative percentages into a speed claim. Set a numerical CPU/memory budget after the first target-device baseline. Acceptance also requires no introduced dropouts or unbounded growth, and latency/alignment results consistent with the chosen engine and toggle behavior. Existing WebRTC/Live Share paths must remain excluded from DSP and show no new processing/helper work.

Scratch Couch runs use their own `COUCH_DATA_DIR` and `COUCH_PORT`, and stop only their recorded PIDs. The owner's installed app and data remain untouched. Development measurements and the remaining target-device work are recorded in [performance and verification](master-compressor-performance.md).

## Where processing goes in this codebase

| Existing route | Proposed processing | Delivery consequence |
| --- | --- | --- |
| Direct ordinary URL media, including one TV | Web Audio in the rendering device | Keep Direct; CORS may require the existing byte relay |
| Ordinary media over Sendspin | One FFmpeg compressor before codec branching | Keep the existing shared clock and device players |
| Host-only native mpv | mpv's own `lavfi` compressor | Keep native playback and its IPC |
| WebRTC / Live Share, including buffered sharing | Bypass | No effect-driven change of route or latency |

**Direct.** [renderer.ts](../src/client/session/renderer.ts) owns a video element and a separate audio element for split sources. Route the audible ordinary-media source through one compressor, then through output gain/mute; avoid doubling split-source audio. Preserve the host's system-volume behavior and existing trim semantics. Resume Web Audio through the existing local “Tap to hear” flow when necessary. Smooth the dry/processed transition; disconnecting the graph is not a valid bypass. Account for the compressor's small processing delay rather than introducing a Sendspin-sized buffer. [8]

Two details make this more than adding one node:

- **CORS:** most current loads set `crossOrigin` to `null`. Extend [pass-through.ts](../src/server/pass-through.ts)'s existing preparation/probing to require a Web-Audio-readable resource when needed. Prefer a CORS-authorized source, otherwise use its signed same-origin byte relay. Cover HLS playlists, segments, keys and redirects, not just the first URL. That relay does not decode, re-encode or create Sendspin scheduling buffers, but adds server bandwidth/network dependence. If audio is multiplexed with video, the required relay may carry both. Enabling on an already loaded non-CORS source can require a reload at the current position; instantaneous toggling is not guaranteed for that first transition. Preserve existing credential-scoping and public-network checks. [8][15]
- **Element lifetime:** the current renderer reuses its video element for WebRTC `srcObject` playback. Creating a media-element source redirects that element's audio into Web Audio; merely disconnecting it cannot restore ordinary output. Cache one source node per element, and use separate/recreated elements when necessary so switching to Live Share actually leaves this processing graph. A dry compressor branch alone is not proof that the fast path remains untouched. [8]

**Sendspin.** [sendspin.ts](../src/server/sendspin.ts) already decodes one source per Playback, producing Opus and/or PCM. It currently constructs output filters separately in `shape()`. Use one common filter graph at the intended stereo/sample-rate format, then split into the two encoders; otherwise the DSP is duplicated per wire. Keep timestamp anchoring and speed handling intact. The official JS players then apply their normal volume/delay, with no second compressor. [client integration](../src/client/session/sendspin.ts)

**Native mpv.** [mpv.ts](../src/server/mpv.ts) already drives the host fallback through JSON IPC. Add a named `lavfi` compressor to that existing player, use the same tuned FFmpeg preset, and control it through mpv's supported filter commands. Verify availability in the linked FFmpeg build. Do not spawn an extra capture/transcoding process. [18]

**Eligibility and transitions.** Use source identity to exclude captured/shared inputs (`liveSourceId`), not the broad `live` flag: normal radios and internet live channels also set `live` and should remain eligible. Conservatively exclude all current live publications, including AirPlay, from the first scope. Keep the saved preference while an excluded item plays, but report the effect as inactive. Direct ↔ Sendspin transitions carry the preference and apply the effect exactly once; muted clock-following pictures must not acquire a second audible path. See [hub.ts](../src/server/hub.ts), [protocol.ts](../src/shared/protocol.ts), and [live-input.ts](../src/shared/live-input.ts).

## Toggling and implementation scope

The smallest coherent change spans shared state/action validation and Playback persistence, the mixer switch and Advanced controls, Direct audio/CORS handling, Sendspin's filter graph, mpv's filter control, and a repeatable performance harness/report. Keep parameter validation, unit conversions, preset constants and enabled/eligible policy shared; let the existing playback modules own their DSP. Do not build a plugin rack or replace Sendspin's player. The pinned SDK's `audioElement` option is not a general effects hook: its Android implementation uses that element for silent keepalive audio while actual sound goes straight to its private Web Audio destination. [17]

Direct can smoothly bypass its already prepared graph locally. mpv has runtime filter commands. Couch's Sendspin helper currently launches with `-nostdin` and ignored stdin, so libavfilter's runtime option support is not yet wired into the app. A small initial implementation can reuse the existing restart/stream-clear path on a toggle, retaining the seekable position and pause state; it will rebuffer, and a live radio can resume later in its programme. A seamless shared toggle is additional work, not a property supplied by adding `acompressor`.

The performance iteration disconnects the unused Direct branch after a finite
crossfade, and suspends the AudioContext while paused/ended. It keeps the 6 ms
alignment and does not increase the context's latency hint. [Web Audio's
suspend contract](https://webaudio.github.io/web-audio-api/#dom-audiocontext-suspend)
explicitly allows releasing processing resources. The benchmark also reads
[AudioPlaybackStats](https://webaudio.github.io/web-audio-api/#AudioPlaybackStats)
when exposed; these are software underrun counters, not a physical output test.

Even a runtime command affects only audio not yet processed. Core can hold roughly eight seconds of decoded output and send chunks up to eight seconds ahead (different queues, not a fixed total latency). Already encoded/scheduled chunks retain the old setting. Decide between an explicit rebuffer and a delayed effective change; test this before promising instant on/off. [sendspin.ts](../src/server/sendspin.ts)

Hardware/browser acceptance checklist (completed and outstanding coverage is listed in the verification report):

- Direct TV/Electron radio and movies, split audio, HLS and native mpv; test Safari/iOS separately rather than inferring compatibility from Chromium.
- CORS-approved and relay-required sources, enabling after playback starts, output volume/mute, autoplay recovery, and ordinary-media → WebRTC → ordinary-media transitions.
- One/many outputs, Direct ↔ Sendspin changes, mixed Opus/PCM receivers, late joins, pause/seek/speed, and independent Playbacks; compression runs once and remains before device gain.
- Known quiet/loud passages, stereo balance, silence/noise, output headroom, toggle artifacts, A/V alignment, and measured CPU on target hardware. A compressor is not hearing protection or a true-peak limiter.

The implementation and mixer behavior are now documented in [docs/design.md](design.md) and [Where it plays](design/where-it-plays.md). [Verification results](master-compressor-performance.md) separate checks completed in this workspace from the remaining target-device and browser validation.

## DSP distinctions and FFmpeg

- **Compression** reduces excursions relative to a threshold; makeup gain can then raise the result. A downward compressor alone does not automatically lift every quiet programme to the same loudness. **AGC/leveling** adapts gain toward a measured level over time. **Loudness normalization** targets a loudness measure such as integrated LUFS; it may use fixed gain after analysis or adaptive processing for streaming. Peak and RMS targets are not interchangeable with EBU R128 loudness. [1][3][4]
- **`acompressor`** processes streaming frames without an algorithmic lookahead buffer in the inspected source. Attack/release describe detector response, not an equivalent fixed audio delay. It supports runtime commands for its documented options, including threshold, ratio, attack, release, makeup and mix. `link=maximum` or `average` derives one detector value across channels and applies a common gain, preserving stereo balance. Defaults are RMS detection and average linking; maximum linking reacts to the louder channel. Threshold/makeup are linear values, attack/release are milliseconds. With `level_in=1`, `mix=0` passes the uncompressed input while the detector continues processing. It has no generic timeline-enable flag; use its documented mix control. Command changes are not a promise of click-free interpolation. [1][2]
- **`alimiter`** adds lookahead equal to its attack setting (default 5 ms) and derives attenuation from the maximum channel peak. Its default `level=1` automatically raises the limited output back toward 0 dBFS: use `level=0` when an explicitly lower sample ceiling should remain lower. `latency=1` compensates delay in the output stream and flushes buffered samples at EOF; it cannot eliminate the need to wait for future samples. This is sample-domain limiting, not a guaranteed true-peak ceiling. FFmpeg recommends 2×/4× upsampling where appropriate. Runtime controls are version-sensitive: inspected upstream supports commands for most options but explicitly excludes `attack`; FFmpeg 8.0 marked attack runtime-capable. Keep lookahead fixed and check the actual packaged binary. Generic bypass skips the filter and therefore does not preserve the same delayed path/state. [1][5]
- **`dynaudnorm`** is adaptive frame-based leveling, peak-based by default with optional target RMS and compression. Channel coupling is enabled by default. It supports runtime commands, but its defaults are 500 ms analysis frames and a 31-frame smoothing window. The source queues at least 31 analysis frames before ordinary output, so buffering is on the order of 15 seconds at defaults, plus frame granularity—not merely the 7.5 seconds one might infer from half the Gaussian window. Smaller settings change the leveling behavior as well as latency. Poor default for a minimal responsive control. [3][6]
- **`loudnorm`** supports single-pass streams and two-pass files, targeting integrated loudness, loudness range and true peak. Dynamic mode runs at 192 kHz and initially consumes 3 seconds of audio before producing output; set the eventual output sample rate explicitly. Linear mode requires suitable measured input statistics and can fall back to dynamic mode. The inspected filter has neither runtime option flags nor a command handler. It is not the lightweight, freely adjustable compressor choice. [4][7]

These four filters are implemented inside libavfilter and their source headers are LGPL-2.1-or-later; they do not individually require an external DSP package. FFmpeg's bundled EBU R128 implementation serves `loudnorm`. The distributed binary's license still depends on its entire build, including optional GPL/nonfree dependencies. Verify `-version`, `-buildconf`, `-filters` and `-h filter=NAME` against Couch's actual helper; upstream availability is not proof of packaged availability. Runtime-settable options appear with `T` in filter help. [2][5][6][7][10][11]

## Changing a shared FFmpeg stage without restart

Keep the filter instantiated and update its parameters; rewriting a subprocess's launch arguments cannot change its running graph. First-class command transports are:

- **libavfilter API:** `avfilter_graph_send_command()` / `avfilter_graph_queue_command()` target an existing named filter instance. This applies when embedding the library, not automatically to an external FFmpeg helper. [12]
- **FFmpeg CLI stdin:** the existing `c`/`C` interactive command path accepts target, time (`-1` for immediate), command and argument. Requires stdin interaction and a separate media-input channel when stdin otherwise carries media. This is a real upstream facility, but process I/O and acknowledgements need integration verification on supported platforms. [13]
- **`azmq`:** documented live request/reply command transport, but requires a build with `--enable-libzmq` and an additional dependency/client. Do not assume it is present. **`asendcmd`** reads a predetermined schedule, including its command file at initialization; editing that file later is not a live settings API. [11][14]

No-restart parameter updates do not imply seamless delay changes. Keep any limiter delay stable across the intended bypass path and retain detector state where practical.

## Direct browser playback

`DynamicsCompressorNode` provides automatable threshold, knee, ratio, attack and release, plus a gain-reduction meter. Parameters are k-rate; threshold/knee use dB and attack/release use seconds. The specification describes **6 ms fixed lookahead**, common gain application, and automatic makeup derived from threshold/knee/ratio, with no exposed makeup control. It supports at most two channels and no external sidechain. There is no loudness-target or true-peak-ceiling API, and ratio is capped at 20. Browser/device output latency is additional; 6 ms is not an end-to-end latency promise. [8]

`MediaElementAudioSourceNode` routes an existing media element through Web Audio while retaining its play/pause/seek/source behavior. The specification **requires silence for a CORS-cross-origin media resource**, even when that resource plays normally in an unwrapped media element. A cross-origin URL fetched without successful CORS authorization cannot be fixed simply by inserting a compressor. Set the media CORS mode before resource selection, with a server response that actually permits it, or use a suitable same-origin resource. Once routed into Web Audio, bypass must retain a connected dry route; merely disconnecting the node does not restore ordinary element output. [8][15]

**Native HLS caveat:** WebKit bug 180696, “createMediaElementSource() not working with Hls stream,” remains open in the tracker as retrieved. Recent reports there also describe failures with MSE/MMS; these are reports, not a verified compatibility matrix. CORS compliance alone therefore does not prove Safari HLS can be processed. HLS.js requires supported MSE/MMS and CORS access to all HLS resources, and is not an unconditional workaround. Validate supported TV/browser/media combinations before promising Direct coverage; a host mpv fallback cannot repair a remote TV browser. [9][16]

The published **SendspinPlayer 5.0.0** declarations expose no supported DSP-insertion option on `SendspinPlayerConfig` or the player instance. Its scheduler is private; the separately exported `AudioScheduler.getAudioContext()` does not supply access to the existing player's output graph. Public lower-level building blocks are not a drop-in processing hook. An all-client proposal would require an upstream hook or a broader player integration; do not assume one exists. [17]

## Host-only mpv and other libraries

mpv officially supports audio `lavfi` graphs, `af` chain changes, and `af-command <label> <command> <argument> [<target>]` for commands to filters inside a named lavfi graph. An instantiated compressor can therefore receive supported libavfilter commands without restarting mpv. Replacing/toggling the whole graph may recreate filters; it does not promise a seamless transition. The available filters depend on mpv's linked FFmpeg build. This is a native host option, not a remote Direct browser solution. [18]

python-sounddevice is a Python binding to PortAudio for device I/O, not a compressor/AGC library. PortAudio exposes devices, streams, formats and timing, with optional sample clipping/dithering; clipping is not dynamics processing. Adding it introduces Python/CFFI/PortAudio packaging without providing the requested DSP. NumPy is optional for raw streams. PortAudio callbacks must meet real-time deadlines and avoid allocation/blocking operations. [19]

Only if existing built-ins cannot fit: **sndfilter** is a small 0BSD C compressor with linked stereo processing, about 6 ms default predelay, persistent state and only standard C/math dependencies for its compressor core. Its API expects blocks divisible by 32; initializer calls reset state, and it is not a ready-made state-preserving parameter-update API or true-peak limiter. Its author explicitly favors clarity over speed. **libebur128** is MIT C loudness/true-peak *measurement*, not a compressor or gain controller. Neither is needed for this hybrid. [20][21]

## Primary sources

FFmpeg implementation references are pinned to upstream `d19f86ff4c41e7cfa5d97b8ac1feb64e49cef053`; manuals describe current upstream behavior, not Couch's bundled version.

1. [FFmpeg acompressor and alimiter manual](https://ffmpeg.org/ffmpeg-filters.html#acompressor)
2. [FFmpeg compressor implementation](https://github.com/FFmpeg/FFmpeg/blob/d19f86ff4c41e7cfa5d97b8ac1feb64e49cef053/libavfilter/af_sidechaincompress.c)
3. [FFmpeg dynaudnorm manual](https://ffmpeg.org/ffmpeg-filters.html#dynaudnorm)
4. [FFmpeg loudnorm manual](https://ffmpeg.org/ffmpeg-filters.html#loudnorm)
5. [FFmpeg limiter implementation](https://github.com/FFmpeg/FFmpeg/blob/d19f86ff4c41e7cfa5d97b8ac1feb64e49cef053/libavfilter/af_alimiter.c), [8.0 version](https://github.com/FFmpeg/FFmpeg/blob/n8.0/libavfilter/af_alimiter.c)
6. [FFmpeg dynaudnorm implementation](https://github.com/FFmpeg/FFmpeg/blob/d19f86ff4c41e7cfa5d97b8ac1feb64e49cef053/libavfilter/af_dynaudnorm.c)
7. [FFmpeg loudnorm implementation](https://github.com/FFmpeg/FFmpeg/blob/d19f86ff4c41e7cfa5d97b8ac1feb64e49cef053/libavfilter/af_loudnorm.c)
8. [Web Audio compressor specification](https://webaudio.github.io/web-audio-api/#DynamicsCompressorNode), [media element source/security](https://webaudio.github.io/web-audio-api/#MediaElementAudioSourceNode)
9. [WebKit HLS/Web Audio bug 180696](https://bugs.webkit.org/show_bug.cgi?id=180696)
10. [FFmpeg license](https://github.com/FFmpeg/FFmpeg/blob/d19f86ff4c41e7cfa5d97b8ac1feb64e49cef053/LICENSE.md), [filter build definitions](https://github.com/FFmpeg/FFmpeg/blob/d19f86ff4c41e7cfa5d97b8ac1feb64e49cef053/libavfilter/Makefile)
11. [FFmpeg runtime commands](https://ffmpeg.org/ffmpeg-filters.html#Changing-options-at-runtime-with-a-command), [azmq](https://ffmpeg.org/ffmpeg-filters.html#zmq_002c-azmq)
12. [libavfilter command API](https://github.com/FFmpeg/FFmpeg/blob/d19f86ff4c41e7cfa5d97b8ac1feb64e49cef053/libavfilter/avfilter.h)
13. [FFmpeg CLI command implementation](https://github.com/FFmpeg/FFmpeg/blob/d19f86ff4c41e7cfa5d97b8ac1feb64e49cef053/fftools/ffmpeg.c), [stdin option](https://ffmpeg.org/ffmpeg-doc.html#stdin-option)
14. [sendcmd initialization/source](https://github.com/FFmpeg/FFmpeg/blob/d19f86ff4c41e7cfa5d97b8ac1feb64e49cef053/libavfilter/f_sendcmd.c)
15. [HTML media resource selection and crossorigin](https://html.spec.whatwg.org/multipage/media.html#attr-media-crossorigin)
16. [HLS.js upstream requirements and compatibility](https://github.com/video-dev/hls.js/blob/master/README.md)
17. [Published Sendspin 5.0.0 package](https://registry.npmjs.org/@sendspin/sendspin-js/-/sendspin-js-5.0.0.tgz): `dist/index.d.ts`, `dist/index.js`, `dist/types.d.ts`, `dist/audio/scheduler.d.ts`, `dist/audio/scheduler.js`
18. [mpv audio-filter manual source](https://github.com/mpv-player/mpv/blob/master/DOCS/man/af.rst), [filter commands](https://github.com/mpv-player/mpv/blob/master/DOCS/man/input.rst)
19. [sounddevice description](https://github.com/spatialaudio/python-sounddevice/blob/master/README.rst), [installation](https://python-sounddevice.readthedocs.io/en/latest/installation.html), [PortAudio overview](https://www.portaudio.com/docs/v19-doxydocs/api_overview.html), [callback contract](https://github.com/PortAudio/portaudio/blob/master/include/portaudio.h)
20. [sndfilter README/license](https://github.com/velipso/sndfilter/tree/1e45029cc5eae2ad12dc7ca1e06c59693482ff90), [compressor API](https://github.com/velipso/sndfilter/blob/1e45029cc5eae2ad12dc7ca1e06c59693482ff90/src/compressor.h), [implementation](https://github.com/velipso/sndfilter/blob/1e45029cc5eae2ad12dc7ca1e06c59693482ff90/src/compressor.c)
21. [libebur128 README/license](https://github.com/jiixyj/libebur128), [measurement API](https://github.com/jiixyj/libebur128/blob/master/ebur128/ebur128.h)
