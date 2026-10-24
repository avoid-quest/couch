# Audio/video architecture alternatives: evidence

Research only, 2026-10-24. Inspected the clean main checkout at
`/home/avoid/Code/avoid-quest/couch`, commit
`59ac6cd6a510ca96bf60dfc9a3628cc635be22e1`, and the
[architecture inventory](/home/avoid/.t3/worktrees/couch/t3-50ab3999/docs/audio-video-system-inventory.md).
No implementation, services, physical tests or capacity tests were run.

**Latest scope clarification:** Direct means any permitted single destination,
including a shared TV or another connected device. Prioritize low-latency
**audio first**; keep screen sharing in relaxed A/V and defer new live-video
work. The video comparisons below are future options, not prerequisites. Audio
improvements alone do not replace the HLS path still serving buffered screen
sharing. Zones remain a separate future UX/access-model discussion. See the
[current stories](audio-video-use-cases.md) for the agreed controls and scope.

The updated brief prioritizes cross-device synchronization: **50 audio receivers,
video on a smaller subset; phone and desktop browsers; qualification and refusal
of unsupported configurations; no delayed fallback within synchronized live.** Concert input-to-ear
latency initially targets **100 ms**. Gaming can tolerate more delay. The recalled
200–300 ms WebRTC latency is not measured evidence. Audio skew, video skew and lip
sync tolerances remain undecided. The owner subsequently accepted stereo Opus
and clarified that Direct includes many independent users/Playbacks: client
decoding with server-assisted queues, resolution and byte relays is sufficient.
Main's Play on semantics stay; independence from the instance is separate
private-mode work. See the [updated proposal](audio-video-architecture-proposal.md).

After the independent reviews, first-release live publishing is scoped to
qualified Couch-computer audio input and desktop-app capture. Browser phones
remain receivers. The earlier MSE-first recommendation below is now provisional:
Sol favors trying it first; Opus favors a WebCodecs frame queue for captured video.
Both require source timestamps and qualification. The comparison is complete
muxing/buffer/follower work versus frame-lifetime/rendering/support work, not a
count of familiar technology names. Shared audio also requires distinct
read-ahead and fixed-deadline sender policies, not just different buffer sizes.

## Practical recommendation

Use **two delivery families**, with different source adapters:

1. **Independent playback:** browser/platform media playback for each solo Playback;
   native mpv only where its codec/output capabilities justify an installed
   backend. Neither needs group transcoding. The owner accepts a separate faster
   unsynchronized capture path only if its latency advantage is meaningful.
   WebRTC is therefore conditional, not an automatic keeper because it shares
   the media-element renderer. The common timed engine could also serve a
   captured source with one receiver; the actual latency comparison is unproven.
2. **Scheduled group media:** one audio clock/scheduler for relaxed and live
   sources. Sendspin is a credible foundation because it specifies output
   deadlines and clock correction, not because Couch already uses it. For the
   smaller gaming video subset, **first consider the existing group-clock
   media-element follower over seekable encoded media**, with a larger common
   A/V lead if acceptable. Short-fragment MSE or reduced-delay HLS is a feasible
   candidate, not a demonstrated result. Reusing the renderer does not require
   retaining the existing MediaRecorder → HLS → audio-transcode chain.

The one material video alternative is **explicit WebCodecs decoded-frame
scheduling**: greater ownership of frame deadlines and dropping, but a substantial
new rendering module. It is premature to require that module before video-skew
and gaming-latency tolerances are set. An SFU becomes material for large WebRTC
fanout; it is not required merely because there are 50 scheduled-audio listeners.

No reviewed browser API guarantees physical interreceiver playout. Qualification
can establish an operating envelope, not turn a browser into a hard real-time
system. Undefined skew tolerances prevent an honest claim that either video
proposal meets the product requirement.

## What the current implementation establishes

- Ordinary URL playback uses media elements, hls.js/mpegts.js and pass-through;
  mpv is a separate host-only player. A media element's normal decode/render path
  is the simplest single-receiver choice. The mpv IPC adapter does not implement
  shared absolute presentation. [C1], [C2]
- **Correction:** resolved web/yt-dlp media always uses Core's protected byte
  relay, even when browser CORS works. Configured direct/radio/IPTV sources can
  take a different route. This adds network forwarding, not a server codec pass.
  See [current policy](public-media.md) and
  [the `publicNetwork` route](../src/server/pass-through.ts).
- Live publishing creates a separate `RTCPeerConnection` and sender tracks per
  receiver. The server forwards signaling; there is no SFU. [C3]
- Live “In sync” currently traverses MediaRecorder, FFmpeg H.264/AAC HLS, then
  another audio decode/encode path into Sendspin. Recording uses nominal 250 ms
  timeslices; HLS requests 1 s segments. These settings do not constitute a
  measured latency, but this pipeline does not provide the proposed 100 ms
  direct scheduled ingestion. [C3], [C4], [C5]
- Group audio has a 1 s initial lead, 8 s send/queue horizons, 60 ms Opus packets
  or 100 ms PCM chunks. Queue capacity is not a fixed delay to add to every
  sample. Muted URL video follows an extrapolated audio position through
  rate/seek corrections refreshed every 250 ms. This is not frame-deadline
  presentation. [C5], [C6]

The current delayed fallback cannot satisfy the synchronized-live acceptance
rule. Its value for ordinary WebRTC sharing remains a product choice; the rule
does not automatically authorize removing that compatibility capability.
Relaxed playback can still buffer; an admitted synchronized-live receiver must
meet its chosen group contract or cease participating.

## Audio: one scheduling model, different budgets

Sendspin's normative clock exchange estimates offset **and drift**. Player audio
timestamps mean when the **first sample should be output**, in server clock
time. Players map that into local time and compensate for output delay. Live
source timestamps instead describe **capture** time; the server must establish
the capture-to-playout mapping. The source section explicitly recommends
estimating effective sample rate and resampling clock drift rather than treating
every chunk timestamp as an independent cut point. [S1]

Use the same model for both source classes:

- **Relaxed:** decode ahead, fill bounded queues and tolerate a larger group
  lead. A seekable video follower may remain sufficient only if its eventual
  video-skew tolerance permits it.
- **Live:** ingest timestamped capture directly, discipline its sample clock,
  then fan out one PCM stream or one encoded stream per required format. Avoid
  MediaRecorder/HLS as audio intermediaries. Set one presentation mapping for all
  admitted outputs. A slow receiver must not independently slide its timeline.

A useful model is `presentation = mapped capture time + group latency`.
Latency must cover capture/packet accumulation, codec work, transport variation,
receiver processing and physical output. It is not just a network buffer. Output
compensation submits samples **before** that deadline; it cannot remove actual
hardware latency. Relaxed send-ahead, live latency, output compensation and clock
error are different quantities. [S1], [WA]

Sendspin's screen roles cover metadata, JPEG/PNG artwork, color and audio
visualization. Artwork permits late display/crossfades and at most one pending
image per channel. It supplies neither compressed-video transport nor a video
frame scheduler; either video option below is Couch-owned functionality. [S1]

For 50 listeners, compressed audio has a material airtime advantage:
48 kHz × 2 × 16-bit PCM is **1.536 Mbit/s per listener, 76.8 Mbit/s for 50**;
96 kbit/s Opus is **4.8 Mbit/s for 50**, before all transport/Wi-Fi overhead.
These are payload calculations, not capacity results. Opus adds codec delay;
20 ms packets are a plausible candidate, not an established optimum. The current
Sendspin spec recommends player chunks of at least 15 ms and caps them at 150 ms;
Opus supports multiple frame durations and nonzero lookahead. [S1], [OP]

**Protocol capability is not installed SDK capability.** Couch pins
`sendspin-js@5.0.0` and `node-sendspin@0.6.2`. Inspected package source shows:

- The JS player schedules `AudioBufferSourceNode.start()`, corrects rate/samples
  and estimates output latency. Its advertised startup/ongoing defaults are
  250/250 ms; those are not two additive fixed pipeline delays.
- It adds a **100 ms Apple-output compensation heuristic** and excludes Opus
  for Firefox due to documented decoder glitches. Neither establishes a
  hardware latency minimum or a universal browser limitation. Both matter when
  qualifying this exact implementation for the concert target.
- The pinned server README says encrypted `source@v1` cannot yet be used because
  pairing/trust support is incomplete. Direct capture ingestion therefore needs
  a verified compatible SDK or an authenticated Couch source adapter. [SERVER]
- The current spec has a **13-byte player-audio header**, including `send_ahead`;
  the installed JS decoder reads a **9-byte header**. Do not combine moving spec
  features with these packages as if wire compatibility were established. [S2]

The current spec's ±1 ms accuracy requirement is relative to the client's
**estimated** clock mapping. It is not proof of ±1 ms physical alignment between
Couch devices, nor a 100 ms latency guarantee. The inventory's retained 90/95/100
ms experiments do not establish 50-device phone/browser qualification. [S1]

## Browser API findings

Compatibility below is the retrieved browser-compat-data snapshot, checked
against specifications and vendor source. API presence does not qualify a codec,
device, output or background state. [BCD]

| API | Supported capability and architectural limit |
| --- | --- |
| `RTCRtpReceiver.jitterBufferTarget` | Standardized buffering **target in milliseconds**, range 0–4000; browser constraints may change/clamp it, and actual delay converges over time. Locally synchronized A/V should use the larger track target. No absolute presentation-time setter. BCD: Chrome 124+, Firefox 115+, Safari 27+. [RTC] |
| `playoutDelayHint` | Legacy Chromium extension, still in current Blink source; passed to its minimum jitter-buffer delay in **seconds**. It is not a second independent scheduling mechanism or portable API. Current WebRTC and WebKit receiver IDL use `jitterBufferTarget`. [BLINK], [WK] |
| `requestVideoFrameCallback` | Called when a frame is submitted for composition. `expectedDisplayTime` is an estimate; callbacks can be a vsync late or miss frames. `captureTime` is a best-effort capture estimate, not a shared deadline; `rtpTimestamp` identifies RTP media time, not UTC/group time. Both are optional metadata, even when the callback is supported. Chrome 83+, Firefox 132+, Safari 15.4+. Vendor IDLs declare the fields, which does not prove they are populated for every path. [RVFC], [VENDOR] |
| `VideoDecoder` / `VideoEncoder` / `VideoFrame` | Explicit encoded chunks, decoded frames, timestamps and codec queues; **no automatic presentation clock or A/V synchronizer**. Timestamp origins need not be common across tracks. Decode/encode support: Chrome 94+, desktop Firefox 130+, Safari 16.4+; BCD reports no Firefox Android decoder/encoder. Require secure context and exact `isConfigSupported()` checks. Codec hardware, profile and throughput remain device-dependent. [WC], [BCD] |
| `AudioDecoder` + Web Audio | `AudioDecoder` produces samples, not audible output. Web Audio schedules them on its own audio timeline; `AudioWorklet` can implement a continuous PCM sink. `getOutputTimestamp()` maps output position to local performance time; `outputLatency` is an estimate that can change. `latencyHint` is discretionary. AudioDecoder: Chrome 94+, desktop Firefox 130+, Safari 26+; Firefox Android absent in BCD. PCM or a separately qualified software decoder need not depend on AudioDecoder. [WA], [BCD] |
| `MediaStreamTrackProcessor` | Raw **video** extraction is standardized; audio extraction has no working-group consensus. Spec exposes a dedicated-worker interface; Chromium implements a Window variant, Safari a worker variant, Firefox is absent in BCD. These are real integration differences. A received frame's presentation timestamp must not be assumed to equal source capture time. [MSTP], [EXT], [BCD] |
| `VideoFrame.metadata()` | The registry/extensions specify capture/receive/RTP metadata, but broad implementation is not established. BCD records metadata() only in Chrome 145+; inspected Blink metadata IDL contains RTP timestamp behind a runtime feature, not the whole registry. Therefore a design cannot assume portable raw-frame capture metadata. [META], [EXT], [BCD] |
| MSE / Managed Media Source | Append encoded media to a **seekable media-element timeline**; `timestampOffset` maps media timestamps and `setLiveSeekableRange()` declares a live seekable window. Neither specifies wall-clock presentation. Standard MSE is broadly available on desktop/Android; BCD records iOS MSE as iPad-only, with ManagedMediaSource available on iPhone from iOS 17.1. WebKit documents an AirPlay alternative or disabled remote playback as an MMS condition. Feature/codec checks and buffer-management behavior still matter. [MSE], [MMS], [BCD] |

WebRTC aligns tracks **within a receiver** using RTP/RTCP synchronization
information. Each receiver still controls its own jitter buffer and rendering.
Equal RTP timestamps, equal `jitterBufferTarget` values, or an SFU forwarding the
same packet do not impose equal physical presentation times. [RTP], [RTC]

Also, media elements playing a `MediaStream` are not seekable: assignments to
`currentTime` and `playbackRate` are ignored. Couch's URL-video follower cannot
simply be attached to a WebRTC stream. `requestVideoFrameCallback` observes that
pipeline; it does not take ownership of its playout. [MC], [RVFC]

## Video decision: timeline following versus frame scheduling

| Candidate | Why it is material | What it does not establish |
| --- | --- | --- |
| **Group-clock media-element following**, using buffered MSE fragments or HLS | Reuses Couch's renderer and timingsrc; browser owns decode, buffering and display. Greater common buffering can accommodate gaming video readiness. Existing relaxed URL following establishes the integration seam. | No physical deadline setter; live-edge corrections, seeks, stalls and display queues affect visual skew. No measured gaming bound exists. |
| **Explicit decoded-frame scheduling** with WebCodecs | Owns which decoded frame is submitted for each group deadline, late-frame policy and queue depth. Avoids relying on media-element rate/seek correction. | A new substantial renderer, not an existing Couch feature; canvas/compositor/display remain best effort. Greater control does not automatically mean better measured sync. |

**The smaller-scope candidate is meaningful.** MSE attaches encoded media to an
ordinary media element, whose `currentTime` and `playbackRate` can be controlled;
it does not inherit the no-seeking restriction of a WebRTC `MediaStream`.
The specification explicitly supports live seekable ranges and timestamped media
segments. Its ISO-BMFF format requires initialization data and movie fragments,
not arbitrary elementary H.264 chunks. Short fragments can expose media earlier
without changing the browser decoder. They add packaging/append work, not
necessarily another encode. The specs provide no universal minimum buffering or
guaranteed physical skew. [MSE], [BMFF], [HTML]

The existing follower is more than “start every device at once”: it continually
corrects a media timeline against a TimingObject derived from group sound.
Couch refreshes that clock every 250 ms; timingsrc extrapolates and applies its
own correction loop. Neither 250 ms nor the library's 25 ms correction tolerance
is a measured physical-skew bound. The pinned library chooses stepwise updates
on Safari and gradual rate corrections elsewhere, an implementation constraint
to qualify rather than a timeless assertion about Safari. [C6], [TIMING]

**Reduced-delay HLS is another packaging choice within that same candidate.**
FFmpeg's `hls_time` is a target: cuts occur on the next keyframe. Merely reducing
it does not eliminate capture/encoding/probing delay. hls.js documents live-edge
holdback, warns that reducing it increases stalls, and supports LL-HLS partial
segments when the playlist supplies them. `lowLatencyMode` alone does not turn
ordinary completed-segment HLS into LL-HLS. Its independent live-edge seek/stall
policies must not silently override the shared group timeline. [FF], [HLS]

Gaming may choose a larger **common audio and video delay** so each participating
screen has the target media buffered. That is an intentional group budget, not
the prohibited per-receiver delayed fallback. More buffering makes frames more
likely to be ready; it does not by itself tighten physical display alignment.
Conversely, lack of an absolute playout setter does **not** prove media-element
following cannot meet a practical bounded visual tolerance. Set the tolerances
before selecting the larger renderer. The current recorder/transcode/HLS chain
remains a deletion candidate regardless of which renderer wins.

**If explicit frame control is justified**, the smallest plausible path for a
small screen subset is encode once → bounded WebSocket fanout → WebCodecs decoder
→ timed frame queue. No SFU or Core video decoder is inherently needed.
A qualified desktop/Electron `VideoEncoder` publisher or native capture/encoder
can produce that input. Audio/video capture timestamps must be mapped into the
same clock; message arrival and independent API timestamp origins are not that
mapping. WebCodecs preserves supplied timestamps but leaves rendering to the
application, as Chrome's example explicitly demonstrates. [WC], [CHROME]

This new module must own codec configuration, keyframe joins, bounded queues,
frame lifetime, late presentation and resynchronization. Missing presentation
does not always permit dropping a compressed reference frame before decoding.
H.264 is a candidate subject to codec/profile checks; its WebCodecs registration
requires complete access units and the appropriate parameter sets. Raw native
encoder bytes need preserved packet boundaries and PTS; arbitrary stdout reads
are not timed video frames. [AVC]

WebSocket is the initial transport candidate, not a latency promise. TCP recovery
can stall later frames; queued bytes cannot simply be unsent, and `bufferedAmount`
excludes OS/network buffering. Separate audio/video queues/connections avoid
serializing large video messages ahead of audio on one connection, but still
share network capacity. **Do not automatically add WebTransport.** Its datagrams
and independent streams become material only if TCP stalls defeat the accepted
budget; they add server and loss/framing responsibilities without scheduling
output. [WS], [WT]

**WebRTC extraction is a plumbing variant, not a third recommended video mode.**
Receiving WebRTC video then scheduling raw decoded frames could retain congestion
control and browser decoding, without WebCodecs decoding or an SFU for a small
subset. It still needs the new frame scheduler; frames inherit receive/decode
latency already incurred, and processor realm/metadata support is uneven.
Copying `<video>` in `requestVideoFrameCallback` observes already-scheduled
composition and may miss frames. These are weaker foundations for portable frame
identity/deadline control than explicitly timestamped encoded input. [MSTP], [META], [RVFC]

Neither candidate controls physical scanout. A 60 Hz display has a 16.7 ms refresh
period; 30 fps source frames are 33.3 ms apart. Independent refresh phases,
compositors and panel processing remain even with perfect clocks. These are
cadences, **not guaranteed skew bounds**; WebCodecs does not remove them.

Native shared-clock rendering is technically stronger where browsers fail:
GStreamer documents network clocks, common base time, clock-slaved audio and RTP
`ntp-sync` for multiple machines. It still needs sink/display calibration and does
not imply hardware genlock. **A native-only receiver architecture fails the phone
and desktop browser requirement**; it is not the default alternative here. Native
capture feeding the same browser chunk protocol remains compatible. [GST]

## SFU versus publisher-to-each-peer

For the originally requested **50 full-A/V WebRTC receivers**, a forwarding SFU
is materially better than Couch's current publisher fanout: one publisher upload
per track/encoding rather than 50 peer uploads; server egress and 50 endpoint
decodes remain. Simulcast adds encodings; an SFU does not magically transcode one
codec into another. Mediasoup's own architecture forwards RTP without decoding
or transcoding. Its published capacity examples are not a Couch benchmark. [C3], [SFU]

Illustratively, 4 Mbit/s video + 96 kbit/s audio to 50 endpoints is 204.8 Mbit/s
payload egress. An SFU moves that fanout off the publisher; it does not remove
receiver/Wi-Fi airtime or establish common output deadlines. For the corrected
scope, scheduled-audio fanout plus video to `V` receivers is approximately
`50 × audio bitrate + V × video bitrate`. Add an SFU only if the WebRTC alternative
and its actual video fanout justify it. **SFU alone cannot satisfy synchronized
video.** [SFU], [RTC]

## Codec and rate-conversion stages

Counts start from raw live capture or an already-encoded URL. `E`/`D` count
compressed encodes/decodes **along one receiver's path**, separately for audio
and video; PCM packing/unpacking is not a compressed-codec stage. Shared server
work is not repeated per receiver unless noted. OS/driver/Bluetooth work is extra.

| Path | Compressed codec stages | Audio rate conversion/correction |
| --- | --- | --- |
| Direct URL via browser or mpv | Audio 0E/1D; video 0E/1D. Core 0E/0D. | No Couch source resampler; player/OS may convert to output rate. |
| Direct WebRTC or forwarding SFU | Audio 1E/1D; video 1E/1D. SFU 0E/0D. | Browser capture/render/codec processing is implementation-dependent; zero resamplers cannot be asserted. |
| Current buffered live HLS | Audio 2E/2D; video 2E/2D: recorder encode → Core decode/encode → endpoint decode. | Core forces audio to 48 kHz once; receiver/OS may convert again. |
| Current HLS → Sendspin Opus group | Audio **3E/3D**: recorder → AAC → Opus. Video 2E/2D. PCM wire instead gives audio 2E/2D plus PCM conversion. | HLS and group FFmpeg each specify 48 kHz; the second is normally rate-identical, not necessarily a second actual resample. Receiver drift/output conversion remains. |
| Encoded URL → scheduled group audio | Opus wire 1E/2D; PCM wire 0E/1D. | Source normalization to 48 kHz if needed; receiver clock correction/output-rate conversion. With two FFmpeg output mappings, normalization may be per wire unless explicitly shared. |
| Proposed raw live → scheduled audio | PCM 0E/0D; Opus 1E/1D with one shared encoder. | **Two clock-adaptation responsibilities:** capture-clock discipline and receiver output-clock discipline. Fixed rate conversion can be combined with these; additional browser/OS conversions are not known from architecture alone. |
| Proposed encoded video forwarding | Video **1E/1D**, Core 0E/0D. | Audio is the independent scheduled path above; video has no audio resampler. |
| Proposed encode-once video → MSE/HLS follower | Video **1E/1D** if repackaged/forwarded without transcoding; muxing fragments adds **0E/0D**. | Same independent scheduled audio; no need to preserve the existing AAC/HLS audio intermediate. |

At 50 full-A/V peers, the current code constructs **50 logical audio senders and
50 video senders**, with 50 audio/video decoders across receivers. Do not claim
exactly 50 distinct physical encoders: browser sharing is implementation-dependent
and is not promised by this code. An SFU or chunk-forwarding design requests one
encode per selected stream/layer and one decode per receiving endpoint.
Resampling, sample insertion/removal, playback-rate interpolation and codec
transcoding are different operations. [C3], [C4], [C5], [S2], [WA], [SFU]

## Qualification boundaries and unresolved decisions

- **100 ms concert latency is a target, not demonstrated support.** Every admitted
  output needs enough remaining budget after its actual capture/codec/output
  costs. Gaming can choose a larger **common** budget. A receiver that needs more
  than the selected budget is refused, not moved to HLS or independently delayed.
- **Background/mobile:** hidden-page rendering and timers may be throttled;
  frozen pages cannot reliably execute callbacks. Active audio/WebRTC can affect
  lifecycle heuristics but is not a portable exemption. Lock-screen audio and
  foreground video are separate qualification states. Workers and Media Session
  do not guarantee survival. AudioWorklet helps audio-thread execution; it cannot
  keep a suspended AudioContext or discarded document alive. [LIFE], [WA]
- **Autoplay/output:** gesture requirements remain; audio output switching is
  not uniform (`AudioContext.setSinkId` is Chromium-only in this BCD snapshot).
  Route changes invalidate previous output timing assumptions. Browser-reported
  latency is an estimate, not microphone/photodiode evidence. [WA], [BCD], [IOS]
- **Bluetooth:** codec/transport buffering, DSP and route changes lie beyond
  Couch's packet scheduler. Calibration can compensate predictable delay only
  when enough common lead exists. A Bluetooth route whose physical delay exceeds
  100 ms cannot meet a 100 ms input-to-ear target; do not infer that every Bluetooth
  route does, or that any unspecified route qualifies. [WA]
- **Still needed from product:** maximum audio skew, video-to-video skew, A/V
  offset, and permitted dropout/resynchronization behavior, including when to
  remove an output. No new measurement campaign is authorized by this note.

## Sources

[C1]: https://github.com/avoid-quest/couch/blob/59ac6cd6a510ca96bf60dfc9a3628cc635be22e1/src/client/session/renderer.ts
[C2]: https://github.com/avoid-quest/couch/blob/59ac6cd6a510ca96bf60dfc9a3628cc635be22e1/src/server/mpv.ts
[C3]: https://github.com/avoid-quest/couch/blob/59ac6cd6a510ca96bf60dfc9a3628cc635be22e1/src/client/session/live.ts
[C4]: https://github.com/avoid-quest/couch/blob/59ac6cd6a510ca96bf60dfc9a3628cc635be22e1/src/server/live-stream.ts
[C5]: https://github.com/avoid-quest/couch/blob/59ac6cd6a510ca96bf60dfc9a3628cc635be22e1/src/server/sendspin.ts
[C6]: https://github.com/avoid-quest/couch/blob/59ac6cd6a510ca96bf60dfc9a3628cc635be22e1/src/client/session/picture-clock.ts
[S1]: https://github.com/Sendspin/spec/blob/aaa18a4b0b34fc9135ce8fdf3c3229018c633aab/README.md
[S2]: https://registry.npmjs.org/@sendspin/sendspin-js/-/sendspin-js-5.0.0.tgz
[SERVER]: https://registry.npmjs.org/@sonn-audio/node-sendspin/-/node-sendspin-0.6.2.tgz
[OP]: https://www.rfc-editor.org/rfc/rfc6716#section-2.1
[RTC]: https://w3c.github.io/webrtc-pc/#dom-rtcrtpreceiver-jitterbuffertarget
[BLINK]: https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/peerconnection/rtc_rtp_receiver.cc
[WK]: https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/mediastream/RTCRtpReceiver.idl
[RVFC]: https://wicg.github.io/video-rvfc/
[VENDOR]: https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/video_rvfc/video_frame_callback_metadata.idl
[WC]: https://w3c.github.io/webcodecs/
[CHROME]: https://developer.chrome.com/docs/web-platform/best-practices/webcodecs#decoding
[AVC]: https://w3c.github.io/webcodecs/avc_codec_registration.html
[WA]: https://www.w3.org/TR/webaudio-1.1/
[MSTP]: https://www.w3.org/TR/mediacapture-transform/
[EXT]: https://w3c.github.io/mediacapture-extensions/#videoframemetadata
[META]: https://w3c.github.io/webcodecs/video_frame_metadata_registry.html
[BCD]: https://github.com/mdn/browser-compat-data/tree/8371d582c202efe1f21622ab8cfac6ab00a7b209/api
[RTP]: https://www.rfc-editor.org/rfc/rfc8834#section-4.1
[MC]: https://w3c.github.io/mediacapture-main/#mediastreams-in-media-elements
[WS]: https://websockets.spec.whatwg.org/#dom-websocket-bufferedamount
[WT]: https://www.w3.org/TR/webtransport/
[GST]: https://gstreamer.freedesktop.org/documentation/rtpmanager/rtpbin.html#rtpbin:ntp-sync
[SFU]: https://mediasoup.org/documentation/v3/scalability/
[LIFE]: https://developer.chrome.com/docs/web-platform/page-lifecycle-api
[IOS]: https://webkit.org/blog/6784/new-video-policies-for-ios/
[MSE]: https://w3c.github.io/media-source/
[BMFF]: https://www.w3.org/TR/mse-byte-stream-format-isobmff/
[HTML]: https://html.spec.whatwg.org/multipage/media.html#media-elements
[MMS]: https://webkit.org/blog/14445/webkit-features-in-safari-17-0/#managed-media-source
[TIMING]: https://registry.npmjs.org/timingsrc/-/timingsrc-1.4.37.tgz
[FF]: https://ffmpeg.org/ffmpeg-formats.html#hls
[HLS]: https://github.com/video-dev/hls.js/blob/master/docs/API.md#livesyncdurationcount

Additional primary-source details: [pinned server package](https://registry.npmjs.org/@sonn-audio/node-sendspin/-/node-sendspin-0.6.2.tgz)
(`README.md`, encrypted source limitation); installed JS package
`dist/audio/{scheduler,decoder,platform-output-latency}.js` and
`dist/core/codec-support.js`; [Blink raw-frame metadata](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/webcodecs/video_frame_metadata.idl);
[Firefox callback metadata](https://github.com/mozilla-firefox/firefox/blob/main/dom/webidl/HTMLVideoElement.webidl);
[WebKit callback metadata](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/VideoFrameMetadata.idl);
[GStreamer clock/base-time model](https://gstreamer.freedesktop.org/documentation/application-development/advanced/clocks.html),
[network clock](https://gstreamer.freedesktop.org/documentation/net/gstnetclientclock.html),
[audio clock-slaving methods](https://gstreamer.freedesktop.org/documentation/audio/gstaudiobasesink.html#GstAudioBaseSinkSlaveMethod).
