# Simplify Couch playback

Proposal for agreement, 24 October 2026. Main and this checkout were inspected at
`59ac6cd6a510ca96bf60dfc9a3628cc635be22e1`. Research only: no implementation,
services, hardware, benchmark, CI or release work.

For implementation scope and sequencing, use the
[full refactor handoff](audio-video-refactor-plan.md) and its code map. They cover
Direct, relaxed A/V and live audio together; the short migration outline below
is architectural context, not the complete assignment.

**Current scope, following the owner's clarification:** Direct targets **any
permitted single device**, including another connected device or the shared TV;
the controller need not receive. Relaxed keeps collaborative A/V, including
screen sharing. Prioritize **low-latency audio**; defer new low-latency video work.
Zones are future work, not an implemented model or a prerequisite.

**Recommendation for discussion:** preserve independent Playbacks and main's
Play on behavior. Receivers decode ordinary media locally; the selected Couch
supplies queues, source resolution and needed byte relays. Share scheduled audio
infrastructure between relaxed and live playback, with distinct sender policies
and controls. Bypass repeated HLS conversions for audio-only capture. Retain
relaxed screen sharing's current video delivery until a replacement is agreed.
A separate faster, unsynchronized capture path remains conditional on a
meaningful latency advantage. Implementation still waits for agreement.

**Agreed product direction:** synchronization takes priority over minimum delay;
50 audio receivers; phone and desktop browsers;
qualify browser/output combinations and refuse unsupported synchronized-live
receivers, without silently delayed fallback. Stereo Opus is accepted. Concerts
initially target 100 ms input-to-ear. Gaming should be as low as practical but
may take longer; the remembered 200–300 ms WebRTC experience is unverified
context. Speaker skew, video skew and local A/V error remain open acceptance
criteria. Server-assisted Direct is sufficient; independence from the instance
belongs to the planned private-mode work.
For the first live release, qualify audio input on the Couch computer/desktop
app; phone-browser publishing need not meet the live target.
Phones remain receivers. Other publishing routes can remain relaxed.
Future low-latency video targets approximately **5–10 screens**; **1080p/60 is
desired**, not a proven capability or an agreed hard minimum. Receivers watch/listen;
game input stays on the publishing computer. This video scope is explicitly
deferred by the owner's latest priority, not silently excluded from the product.
Concert listeners follow the source with their own listening controls and sync
status, not shared queue/transport controls. Relaxed keeps collaborative controls.
The [use-case and current-UX map](audio-video-use-cases.md) gives concrete journeys
for every behavior and separates existing controls from proposed additions.
The owner accepts a separate faster unsynchronized path **if** that advantage
justifies it; existing WebRTC code is not evidence that it does. The
[interactive cost diagrams](audio-video-costs.html) compare stages, scaling and
the limits of the device-count evidence.

**Everyday behavior to preserve**

Main runs **many independent Playbacks**, each with its own queue, current item,
transport and outputs. Several users choosing different media on permitted
single destinations does not select Sendspin. Grouping is decided per Playback.

- **Play on** explicitly chooses a device. For ordinary media, choosing a device
  in a group separates it into a Playback; the other outputs can continue.
  Ordinary Play keeps the selected mix. Queue/Play next act on the viewed Playback.
- **Move here** transfers the existing Playback exclusively; it does not copy it.
  **Where it plays** assigns picture and sound with device consent. Each device
  currently serves one Playback at a time. Mix means routing and levels, not
  summing several sources into one waveform.
- **Move here refers to the destination's row**, not necessarily the controller.
  The ordinary Where it plays row offers it for a device outside the Playback,
  so remote queue-preserving handoff already exists. TV rows currently lack this
  button. Keep this distinction from item-level Play on and adding an output.
- **Sharing a capture** publishes a source. Selecting that source normally joins
  its existing Playback and controls. Publishing, controlling and receiving are
  separate responsibilities. The publisher is excluded from its own capture.
- A browser depends on its selected Core. Desktop **This computer** runs its own
  Core; **Another Couch** stops it and loads the other instance's UI. Simultaneous
  local-Core playback and remote-instance use is not main's desktop model.
  Private-output consent does not establish private browsing/history.
- Independent Playbacks do not establish named **zones**, membership or zone
  access rules. Share publishes a source; it is not an approved zone abstraction.
  Keep zones out of this implementation scope and explore their UX separately.

Verified in [Hub](../src/server/hub.ts), [Session](../src/server/session.ts),
[Where it plays](design/where-it-plays.md) and [desktop lifecycle](../app/main.ts).

**Verified playback map**

Codec counts exclude the provider's original encoding and final OS/device
conversion. Forwarding, demuxing and playlist rewriting are not codec passes.

| Entry | Delivery, clock and processing | User-visible consequence |
| --- | --- | --- |
| Ordinary media on one device | Core resolves provider/yt-dlp, radio, IPTV or HTTP media → direct HTTP or byte relay → native media element, hls.js/mpegts.js as needed → OS output. One receiver decode per track; no server codec pass. Separate audio follows video locally. | Independent playback. Optional compression adds client Web Audio DSP. **Resolved web/yt-dlp media always uses Core's protected relay**, even with working CORS. |
| Ordinary media spanning devices | FFmpeg decodes audio, normalizes to 48 kHz stereo and encodes each requested wire format once per Playback → encrypted Sendspin timestamp fanout → scheduled output. Opus: one server decode/encode and one receiver decode; PCM avoids the lossy encode/decode. Screens fetch muted video and follow the group clock. | Existing relaxed synchronization. A screen and speaker on different devices need this clock even with only one audio receiver. |
| Screen/system sound/microphone/audio input | Browser capture → one WebRTC peer per receiver → browser jitter buffer, decode and media element. One encode/decode per track/path; encoder sharing is not guaranteed. ICE selects direct connectivity or TURN. | Local A/V alignment; no interreceiver deadline. Publisher upload grows with viewers. Consent filters tracks. |
| Failed WebRTC receiver | On demand, MediaRecorder → upload → FFmpeg H.264/AAC HLS → receiver. Capture encode, server decode/re-encode, receiver decode. | Delayed independent viewing marked Behind; healthy peers continue. Fallback selection persists for the publication. |
| Captured source, In sync across devices | The same recorded-upload/HLS stage → another FFmpeg audio decode → Sendspin; muted HLS video follows the clock. | Audio through Opus: three encodes/three decodes; PCM after HLS: two each. Video: two each. Picture-only input synthesizes silence for the current clock. |
| AirPlay input | Linux UxPlay/GStreamer decode → framed RTP/PCM → Core pacing → AAC/HLS → ordinary player or another decode/Sendspin conversion. | Audio input only, no AirPlay output/video/multiroom. Its 250 ms ingress prebuffer already prevents a 100 ms concert promise. |
| Unsupported IPTV codec | Host mpv → native decode/A/V/output. One receiver decode. | Other outputs leave this Playback. Useful host-only compatibility, with narrower track/delay controls. |

Sources: [renderer](../src/client/session/renderer.ts),
[web resolution](../src/server/web-media.ts), [pass-through](../src/server/pass-through.ts),
[live capture](../src/client/session/live.ts), [live ownership](../src/server/live-input.ts),
[HLS ingestion](../src/server/live-stream.ts), [Sendspin](../src/server/sendspin.ts),
[picture clock](../src/client/session/picture-clock.ts), [AirPlay](../src/server/airplay-audio.ts),
[IPTV](../src/server/iptv.ts), [mpv](../src/server/mpv.ts).

Local files/library/Jellyfin no longer play. Desktop system-sound capture supports
Windows/macOS 14.2+, not Linux; browser input capture does not guarantee stereo.
Electron hosts the same renderer. Media Session provides OS controls; native
sound-test tones are diagnostics.

**Corrections and limitations that affect the design**

- **Direct is client rendering, not necessarily direct network access.** Current
  web-media policy relays every media/HLS child and checks destinations and
  redirects. Older relay-only-on-failure prose is stale. Retain this byte relay
  unless replacing its responsibilities; it adds bandwidth, not transcoding.
  [Current policy](public-media.md).
- **Sound-only selection does not guarantee sound-only fetching.** The ordinary
  direct loader attaches the main URL and separate audio URL. Prefer an existing
  audio-only rendition when appropriate; avoid adding a transcode just to strip
  video. Hidden-video decoding cost is browser-dependent and unmeasured.
- **Relaxed video is a clock follower.** Rate changes/seeks use a 250 ms clock
  refresh, not frame deadlines. hls.js maps HLS timestamps; native HLS lacks that
  mapping, and MPEG-TS has an unanchored offset. No physical display-skew bound
  has been demonstrated.
- **Delay controls differ.** Speaker Sync delay advances Sendspin scheduling.
  Content audio delay delays separate URL audio, but does not affect muxed audio;
  current group/mpv adapters do not apply it. mpv also lacks Couch's
  track/subtitle-delay handling.
- **Background support is route-specific.** Sendspin has 1 s initial lead,
  60 ms Opus/100 ms PCM packets and up to 8 s send-ahead, not an eight-second
  latency floor. Live sources cannot supply future audio. Reported locked-phone
  success on Chrome/iPad and Android does not qualify live deadlines. Losing
  Core's control socket currently stops playback.
- **Speaker-only live joining still has a defect:** explicit `picture:false`
  passes through a permission check even for the disabled channel. The earlier
  failure remains apparent in source; toggling sound is a different entry point.

**Simplest recommended architecture**

Keep multiple Playbacks and a timeline for each scheduled Playback. The minimal
candidate has native media playback for ordinary Direct use and one timed engine
for relaxed/live groups. Captured media can use that timed engine with one
receiver too. WebRTC is a conditional additional delivery path, justified only
by a meaningful faster unsynchronized experience. Sharing a renderer does not
by itself justify keeping its signaling, peers, TURN or fallback machinery.
mpv remains a narrow codec backend, not another product mode.

Share the receiver, format preparation, clock exchange and fanout, with **two
sender policies**. Sources that can read ahead prepare buffered media; live
capture keeps fixed capture-to-output deadlines. Current Sendspin can move its
timeline when starved and restart when a joining receiver needs another format;
live must instead reject incompatible joins and isolate late receivers. Captured
relaxed/live playback shares that fixed timeline with different lead. A URL alone
does not imply read-ahead: upstream live broadcasts have their own buffering and
do not automatically qualify for the concert goal.

| Product behavior | Recommendation |
| --- | --- |
| Direct | Independent client playback on any permitted single device, with server assistance. No mandatory FFmpeg, Sendspin or Web Audio processing for ordinary solo media. The controller can be elsewhere; handoff respects permissions. Capture delivery remains a separate source-dependent question, not a restriction to the controller's own device. |
| Relaxed synced | Shared queue/transport and consented picture/sound outputs. Sendspin audio and the existing picture follower, with ample buffering. Keep buffered screen sharing. Audio-only raw capture can bypass recording/HLS; captured A/V keeps a common lead covering video. |
| Low-latency synced, first milestone | Audio only: timestamped stereo capture, bounded source-clock normalization, small Opus packets and common presentation deadlines. Receivers either keep the contract or stop/rejoin the present. Audience controls affect only their own participation/output; no collaborative programme queue or transport. |

Live sound becomes **capture → clock normalization/resampling → one shared Opus
encode → fanout → receiver decode/output-clock correction → hardware**. Source
and receiver corrections address different oscillators. Browser/OS conversions
remain platform-dependent. AirPlay's decoded PCM enters the same engine with
relaxed timing, including when it has only one receiver.

For the initial qualified capture adapters, prefer **PCM into Core, source-clock
normalization there, then one Opus encode**. Remote capture adds one raw-audio
uplink (1.536 Mbit/s at 48 kHz/16-bit stereo), not one per receiver. Native ALSA
observations do not establish equivalent clocks on other capture platforms.
The lab's receiver clock fix and preparation must become supported SDK behavior
(upstream or a maintained patch/fork), not shipping string replacements or private
field mutations.

**Deferred video decision:** both candidates start with timestamped capture and
one encode, preserving source timestamps for a shared presentation mapping.
**MSE fragments → media-element follower** reuses platform rendering but needs a
muxer, append-buffer management and timeline corrections. **WebCodecs decode →
timed frame queue** skips that muxing/follower but owns frame lifetime, dropping,
drawing and browser/power compatibility. Both need bounded queues, keyframe joins
and recovery; neither has qualified Couch results. The independent reviewers
disagree about which is less work. Do not assume that reusing MSE is simpler, or
that a custom renderer is small merely because its central loop is small. Keep
URL video on its existing follower; neither candidate is a prerequisite for
live audio. Retain the current captured-video path in relaxed playback meanwhile.

**Local A/V alignment and synchronization across receivers are separate.** Map
both tracks into the group clock, compensate output latency and use a common
lead covering admitted outputs. Relaxed screen sharing must delay audio to match
buffered video; the concert's audio lead alongside delayed picture would break
this story. Future gaming may need more lead than concerts. Slow
joins must not move healthy receivers' deadlines. Video-only sources should use
the clock without synthetic audio; send video only to screens.

Buffering makes frames available, not automatically aligned. Neither option
guarantees physical display deadlines. WebRTC's jitter-buffer target is a hint;
a MediaStream cannot follow a clock by seeking/changing rate. An SFU solves
fanout, not synchronization; 50 audio receivers alone justifies neither an SFU
nor WebTransport. [Official-source assessment](audio-video-alternatives-evidence.md).

**Keep, combine, replace or remove**

- **Keep** concurrent queues, Play on, picture/sound consent, volume/mute/delays,
  optional compression and publisher ownership. Shared programme controls belong
  to Direct/relaxed Playbacks; a concert listener joins/leaves and adjusts their
  own output. Stop playback differs from Stop sharing and from leaving. Rejoining
  live returns to the present, without DVR. Newest-tab ownership, reconnect and
  stale-generation cleanup must survive; one departing receiver must not stop others.
- **Keep** useful yt-dlp/provider adapters, HTTP proxies and physical output
  routing. They resolve sources, carry bytes or choose
  sinks; they are not competing playback engines. Removing mpv loses host codec
  compatibility; removing AirPlay loses an input; removing Bluetooth/PulseAudio/
  PipeWire routing loses sink selection. TURN/STUN stay only if a justified
  WebRTC path needs them.
- **Combine** relaxed/live audio scheduling and normalize captured sound once.
  Remove generated HLS from audio-only capture and AirPlay when their replacement
  is ready. **Keep the generated HLS still serving relaxed screen sharing and
  delayed compatibility until those capabilities have an agreed replacement.**
  Audio-first narrows the immediate work; it does not by itself eliminate that
  video pipeline. Keep upstream HLS support. Compression remains optional and
  off for shared live capture; Direct need not traverse group processing for it.
- **Make WebRTC conditional**, rather than automatically retain or remove it.
  Its current native capture/decode path may beat the timed engine's delay,
  but this comparison is unproven. Keep it only if that benefit matters enough
  to pay for an additional path. No automatic synced/unsynced mode matrix.
- **Refuse delayed fallback within synchronized live.** For ordinary WebRTC
  sharing, delayed compatibility remains a product choice. If retained, the
  replacement relaxed path might eventually serve it, but that coverage is
  unproven. Reuse the relaxed timeline for agreed delayed compatibility where it
  works; delete HLS after covering those capabilities or explicitly dropping
  them. This is a removal target, not a reason to preserve another pipeline forever.

**What the experiments contribute**

The [evidence audit](audio-video-experiment-evidence.md) records exact commits,
material uncommitted changes, report hashes, failures and the full draft chain.

- **Latest:** useful source-rate estimation, stateful stereo resampling, fixed
  deadlines and bounded receiver queues. At 350 ms, two shorts and a 12-minute
  checkpoint passed on one wired stereo receiver with fresh initialization and
  receiver corrections. R5 passed 100/95 ms longs and 90 ms shorts; its 90 ms long
  never started. Earlier revisions contain passing 90 ms and one 85 ms long,
  alongside later confirmation failures. These do not establish repeat reliability.
  Hardcoded routing/volume, SDK substitutions and test-owned acquisition are not
  an integration plan. Continuous fidelity and arbitrary-idle recovery remain open.
- **Older:** all seven PRs remain open drafts; the supplied checkout includes
  later `t3/live-audio/latency` work. Consider admission, speaker-only joins,
  shared state preparation and unchanged-volume suppression separately. Keep
  measurement/coverage corrections in evidence tooling. Reject mono duplicated
  into stereo and global desktop buffer tuning as the phone solution.
- **Already merged:** Sendspin send-ahead/late joins, later sharing/helper
  lifecycle, UI performance and compressor improvements. Neither experimental
  live sender is integrated. Fifty-browser runs used real decoders with synthetic
  capture and virtual outputs; corrected controls still concealed samples and
  missed recovery gates. They prove neither 50 physical receivers nor video sync.

**Capacity and support risks**

At 50 receivers, 48 kHz/16-bit stereo PCM needs **76.8 Mbit/s** payload;
current main's 96 kbit/s Opus setting needs **4.8 Mbit/s**; 128 kbit/s would need
**6.4 Mbit/s**, before overhead. The future live bitrate is not yet chosen. Video adds
bitrate × screens. This is arithmetic, not capacity evidence. Opus lookahead and
packetization need their own latency qualification; PCM results do not qualify it.

Encode-once does not remove Wi-Fi airtime, TCP stalls, receiver costs or join
bursts. Qualification must name browser, codec, output and foreground/locked
state. SDK mobile/Apple latency behavior, Firefox codec restrictions and output
changes prevent blanket support claims. Missing physical measurements limit
claims, not this architecture discussion; no equipment is demanded. Synchronized
speakers also remain delayed relative to direct concert sound from the stage.

Current sending runs on Core's event loop; separate timing/fanout from potentially
blocking Hub work in the live design. The lab's 90 ms ingestion pause demonstrates
sensitivity, not the exact cause of a production Hub stall. Pairing's global
20-attempt/minute window impedes a burst of 50 new devices; it is not a playback
capacity limit. Adapt admission/state-fanout fixes to main rather than declaring
the old PRs mandatory wholesale. SDK 5.0.0 uses a 100 ms Apple output-latency
heuristic and excludes Firefox Opus; neither is a measured universal hardware
limit. These need an explicit support policy, not silent PCM/late fallback.

**Migration after agreement**

1. Agree on the corrected stories: any permitted single destination and handoff;
   collaborative relaxed A/V; receiving-only concert audiences. Keep zones and
   private mode separate. Preserve relaxed screen sharing during audio work.
2. Establish supported receiver-SDK fixes, qualified audio capture clocks and
   separate sender policies. Add audio ingestion and isolate timing from Hub
   work. Verify consent, joins, levels, publisher lifetime and recovery.
3. Qualify the new audio path against the concert timing goal and the 50-receiver
   target, naming supported browsers/outputs and background states. Existing
   lab passes do not qualify a new application build. No campaign starts during
   this architecture discussion.
4. Reuse the audio path for relaxed audio-only capture/AirPlay where appropriate;
   delete only their superseded stages. Video-dependent HLS remains. A later
   video project can resolve capture scheduling, A/V alignment, screen skew and
   the optional faster path before replacing remaining video/compatibility code.

**Decisions still needed**

Agree on **server-assisted independent playback plus one scheduled group engine**.
The optional fast unsynchronized capture path must earn its place through a
meaningful latency advantage; that advantage is currently unknown. Its delayed
fallback is not automatically preserved with it. Prefer reuse of an agreed
relaxed path over retaining another capture/transcode pipeline, if compatibility
coverage permits. Synchronized live always refuses receivers outside its contract.

[Sol's independent review](audio-video-independent-review-sol.md) and
[Opus's independent review](audio-video-independent-review-opus.md) support the
broad direction, but neither qualifies the live implementation. Opus's question
about delaying the group for unsupported phones is already settled: refuse them.
Different-rig latency results do not establish WebRTC's advantage or lack of one.

Audio skew limits and the exact first supported browser/output combinations
remain to be settled. Video implementation is deferred and is no longer a gate
for the audio milestone. **100 ms is the concert goal; 150 ms is not a product
requirement.** Zone design and any change to Share's model need their own
discussion; neither is approved by these stories. Implementation waits for agreement.

Starting records: [inventory](/home/avoid/.t3/worktrees/couch/t3-50ab3999/docs/audio-video-system-inventory.md)
and [discussion](t3-thread://v1/e40db049-6c73-412f-a4fe-914be5f54d7c).
