# What Couch should copy from Moonlight and Sunshine

Primary-source review, 24 October 2026. Sources below pin inspected revisions.
The [proposal](audio-video-architecture-proposal.md) and
[alternatives](audio-video-alternatives-evidence.md) are context, not evidence of
working capabilities. Gaming here means watching/listening while the publisher
controls play. No new measurements or implementation.

**Verdict:** copy their short capture-to-output pipeline, hardware integration
and bounded queues; do not adopt the whole system as Couch's playback engine.
This reinforces the two-family candidate: independent native-URL playback, plus
shared scheduled audio with captured video using MSE or WebCodecs. It does not
settle that video choice or justify another unsynchronized path. Couch values
shared presentation timing over the lowest individual delay.

**What explains low latency.** Sunshine supports native capture, including
Windows Desktop Duplication and Linux NvFBC directly into GPU memory. Its
Windows GPU path shares textures with the encoder; this avoids requiring CPU
readback, not every copy. NVENC explicitly selects ultra-low-latency tuning,
disables lookahead, sets no B-frame reordering, and normally uses a single-frame
VBV budget. These settings trade compression efficiency for prompt frames.
They describe a particular backend, not every supported configuration. [CAP]
[GPU] [ENC]

Sunshine encodes captured audio directly to 48 kHz Opus using restricted-low-delay
mode. Moonlight normally requests 5 ms packets, with 10 ms in selected
slow-device/network cases. Moonlight Qt prioritizes hardware video decoding and
rendering without CPU copyback, sets low-delay decoding, and bounds its pacing
queues. Its SDL audio renderer drops incoming samples when Moonlight's backlog
exceeds 30 ms and limits additional SDL queueing. Fast decoding helps, but avoiding
accumulated buffering throughout the path is equally material. These thresholds
are implementation policies, not input-to-ear guarantees. [AUD] [SDP] [DEC]
[PACE] [SDL]

**Transport, loss and clocks.** Sunshine sends audio/video over UDP to each
session's peer, with RTP-style framing, Reed–Solomon FEC and video packet pacing.
FEC consumes extra bandwidth. Unrecoverable video frames can be discarded, with
reference invalidation/IDR recovery; missing audio can invoke Opus concealment.
This favors recovery near the present over reliably delivering every old packet.
It does not eliminate loss or jitter. [NET] [LOSS] [PLC]

Do not attribute WebRTC-style adaptive congestion control to upstream: Moonlight's
SDP generator explicitly fixes the requested bitrate because dynamic scaling
does not work properly; Sunshine adjusts the initial budget for overhead and
FEC. Packet pacing is not adaptive bandwidth estimation. Copy bounded queues and
recovery discipline, without assuming UDP or these defaults solve Couch's network
capacity. [SDP] [RATE]

The inspected APIs expose **stream-relative video presentation timestamps**,
while the audio playback callback carries bytes without a presentation deadline.
Qt video pacing follows the local display; audio buffering follows the local
sink. I found no shared absolute receiver presentation-deadline contract in these
paths. Local A/V proximity from short pipelines is not an explicit common
audio/video output clock, and neither establishes multi-device synchronization.
Couch still needs capture-clock mapping, receiver output-clock correction, common
lead and refusal/removal of receivers that cannot meet it. [TIME] [PACE] [SDL]

**Multiple clients cost more.** Sunshine shares capture in relevant paths but
creates a video encoder session per streaming session; audio likewise creates
an Opus encoder per session. Packets target individual peers. This is evidence
of per-client encoding and unicast, not encode-once fanout or multicast. [VIDEO]
[AUD] [NET]

The old `channels = 1` setting is stale: upstream removed its configurable
concurrent-session limit on **25 October 2024**. The current release also uses a
growing session set. Removing that cap establishes neither unlimited encoder
capacity nor Couch's 50-audio/5–10-video target. Sender encoding work and payload
egress grow with clients; shared capture does not remove them. [LIMIT] [SESSIONS]

**Native clients and separately checked forks.** Moonlight's official FAQ says
there is no pure web client because GameStream requires raw TCP/UDP sockets.
The old ChromeOS client depends on deprecated NaCl; it is not an ordinary browser
receiver. Native decoder/display optimizations cannot be assumed available on
Couch's phone and desktop browsers. [FAQ] [CHROME]

Apollo adds virtual displays and client permissions; its README identifies
Artemis as Android-only. Those features do not establish browser playback or
shared output deadlines. Separately, `MrCreativ3001/moonlight-web-stream` bridges
GameStream to browser WebRTC; its video path repacketizes encoded frames, so a
gateway need not add a transcode. [APOLLO] [WEB]

`linckosz/moonlight-web` supplies browser transports, WebCodecs rendering and a
native host. Its shared-feed implementation is conditional and Windows-only,
with separate encoders in other cases. Its frame pacer derives deadlines from
each receiver's own arrival-time baseline and adaptive reserve. That is useful
browser engineering evidence, not proof of shared absolute presentation times;
its capabilities must not be attributed to upstream Sunshine. [FORK] [SHARE]
[FPACE]

**Fit and work consequences.** Whole-system reuse would replace browser access
with native clients or add a gateway and still require Couch's timing layer. It
also captures a desktop rather than preserving independent URL playback. Keep
server-assisted queues, yt-dlp resolution and byte relays for Direct.

A Sunshine-derived capture/encoder backend is plausible for the first qualified
Couch-computer/desktop-app publisher, but is not a drop-in scheduler: it needs an
encoded-frame/timestamp interface, audio/video clock mapping, shared encoding and
browser delivery. Upstream's session-coupled interfaces show why extraction is
real maintenance work. Prefer its design lessons unless that native backend
solves a concrete capture/encoding gap. [VIDEO] [AUD]

For captured media, preserve timestamps through one encode, fan out only needed
tracks, and bound queues against common deadlines. Either MSE packaging or
WebCodecs decoding can consume that architecture; Moonlight proves neither meets
Couch's browser synchronization requirements. Keep the 100 ms concert goal and
desired 1080p60 explicitly unproven. A larger common gaming lead is acceptable;
silently late receivers are not. Retain a faster unsynchronized path only when a
meaningful advantage is established; this research establishes none.

[CAP]: https://github.com/LizardByte/Sunshine/blob/d0b4a88ef727f8dabf80cc970a14739b55c885de/docs/configuration.md#capture
[GPU]: https://github.com/LizardByte/Sunshine/blob/d0b4a88ef727f8dabf80cc970a14739b55c885de/src/platform/windows/display_vram.cpp#L2005-L2012
[ENC]: https://github.com/LizardByte/Sunshine/blob/d0b4a88ef727f8dabf80cc970a14739b55c885de/src/nvenc/nvenc_base.cpp
[AUD]: https://github.com/LizardByte/Sunshine/blob/d0b4a88ef727f8dabf80cc970a14739b55c885de/src/audio.cpp#L110-L151
[SDP]: https://github.com/moonlight-stream/moonlight-common-c/blob/421bd74e0184a5cfd760efbf84433134c6f6e00b/src/SdpGenerator.c
[DEC]: https://github.com/moonlight-stream/moonlight-qt/blob/781b26fd1ca245cc241ded27da252452533fa3b0/app/streaming/video/ffmpeg.cpp
[PACE]: https://github.com/moonlight-stream/moonlight-qt/blob/781b26fd1ca245cc241ded27da252452533fa3b0/app/streaming/video/ffmpeg-renderers/pacer/pacer.cpp#L209-L268
[SDL]: https://github.com/moonlight-stream/moonlight-qt/blob/781b26fd1ca245cc241ded27da252452533fa3b0/app/streaming/audio/renderers/sdlaud.cpp#L103-L125
[NET]: https://github.com/LizardByte/Sunshine/blob/d0b4a88ef727f8dabf80cc970a14739b55c885de/src/stream.cpp
[LOSS]: https://github.com/moonlight-stream/moonlight-common-c/blob/421bd74e0184a5cfd760efbf84433134c6f6e00b/src/RtpVideoQueue.c#L590-L667
[PLC]: https://github.com/moonlight-stream/moonlight-common-c/blob/421bd74e0184a5cfd760efbf84433134c6f6e00b/src/AudioStream.c#L162-L168
[RATE]: https://github.com/LizardByte/Sunshine/blob/d0b4a88ef727f8dabf80cc970a14739b55c885de/src/rtsp.cpp#L1202-L1225
[TIME]: https://github.com/moonlight-stream/moonlight-common-c/blob/421bd74e0184a5cfd760efbf84433134c6f6e00b/src/Limelight.h
[VIDEO]: https://github.com/LizardByte/Sunshine/blob/d0b4a88ef727f8dabf80cc970a14739b55c885de/src/video.cpp
[LIMIT]: https://github.com/LizardByte/Sunshine/commit/73d777fa0b2e9d6f8242bb71201ba53a9f9e973c
[SESSIONS]: https://github.com/LizardByte/Sunshine/blob/v2026.914.233613/src/rtsp.cpp#L696-L731
[FAQ]: https://github.com/moonlight-stream/moonlight-docs/blob/ecc0e4d66a15e0af2553a1c9defef0de47d9ff85/wiki/Frequently-Asked-Questions.md#is-there-a-moonlight-web-client
[CHROME]: https://github.com/moonlight-stream/moonlight-chrome/blob/1371ccc76679c5e6cbc74677690c4b1e26e9ec94/README.md#deprecation
[APOLLO]: https://github.com/ClassicOldSong/Apollo/blob/adc5c5a0bd80831ce495434bb16aee2cd4175fb8/README.md
[WEB]: https://github.com/MrCreativ3001/moonlight-web-stream/blob/60dcd33aaad9865aaddd82b4e52962e30a678fcc/src/api/stream/webrtc/video.rs#L189-L245
[FORK]: https://github.com/linckosz/moonlight-web/blob/ac6d705bd2a298e8517cf64cb31e7174cf85b8c1/docs/wiki/02-Architecture.md
[SHARE]: https://github.com/linckosz/moonlight-web/blob/ac6d705bd2a298e8517cf64cb31e7174cf85b8c1/backend/src/streaming/SharedFeed.cpp#L48-L100
[FPACE]: https://github.com/linckosz/moonlight-web/blob/ac6d705bd2a298e8517cf64cb31e7174cf85b8c1/frontend/js/stream/FramePacer.js#L140-L204
