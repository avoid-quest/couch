# Independent review: simplifying Couch audio/video

24 October 2026. Inspected main at `59ac6cd` (clean), the experiment at `1f02400`
plus its dirty files, the four drafts and the inventory. I did not read the other
review and ran nothing. **Observed** means seen in source or records; **Inference**
is my reasoning from it; **Proposal** is what I recommend.

## Verdict

The draft has the right overall shape: native playback for Direct, Sendspin for
anything synchronized, and removal of the recorder→HLS chain. It still hedges
where it should decide, though, and it places the unresolved work in the wrong
layer. "One timed engine" is true of the wire protocol and the receiver, not of
the sender. The 100 ms evidence comes from a capture path the product doesn't
have. For captured video I lean the other way from the draft.

## The simplest architecture I would agree to

| Need | Method | State |
| --- | --- | --- |
| Direct ordinary media | Media element (+hls.js/mpegts.js) through Core's relay; mpv as the host-only codec backend | Exists; keep unchanged |
| Any synchronized audio | Sendspin wire and receiver. The sender policy follows the **source type**: read-ahead for URL media (today's FFmpeg run), a fixed-deadline live timeline for captures | Read-ahead exists; live timeline is new |
| Synchronized URL video | Existing media-element clock follower | Exists |
| Captured video, small subset | Capture-timestamped encoded chunks → Core forwarding → frame queue on the Sendspin clock | New |
| Capture adapters | Host audio input, desktop screen/system capture, AirPlay PCM → the same live timeline | New or re-plumbed |

For captures, "relaxed" and "low latency" become a lead value on one live sender,
not a second engine or a user mode. In the end state there is no generated HLS
and no MediaRecorder. WebRTC is frozen until one comparison decides it.

## Findings

**1. The receiver is shared, but the sender needs two policies, and the hard part is the SDK.**
*Observed:* when the source falls behind, today's group sender moves the
timeline later ([sendspin.ts:301-305](../src/server/sendspin.ts)), with a 1 s lead
and 8 s send-ahead (`:29-33`). The experiment does the opposite: deadlines never
move, and any receiver outside its budget is retired
([live-stereo.ts:76,102-103](/home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/src/server/live-stereo.ts)).
In the receiver SDK (`sendspin-js@5.0.0`), the defaults are 250/250 ms
(`dist/core/protocol-handler.js:6-7`) and scheduling horizons are 4–20 s on
main-thread timers (`dist/audio/scheduler.js:28-30,568-586`). The passing
low-latency runs needed a string-replacement patch of SDK source
([receiver-clock-correction.ts](/home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/tests/stereo-hardware/receiver-clock-correction.ts))
and a readiness check that relies on SDK internals. Both are lab-only.
*Inference:* the shared part is real: protocol, clock sync, decoding,
levels/delays, consent and Playbacks. A second stack would be wrong. Still, the
draft's "combine relaxed/live scheduling" undersells the work: the two policies
must stay separate, and the receiver fix must be upstreamed or forked before
anything ships. *Proposal:* choose the policy by source type, because prerecorded
media can read ahead and captures can't. That removes a mode instead of adding a
subcategory. Make the upstream-or-fork call before migration step 2.

**2. The 100 ms evidence comes from a capture path the product doesn't have.**
*Observed:* the lab opens raw ALSA `hw:CARD=U192k`
([capture.c:64](/home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/tests/stereo-hardware/capture.c)),
and its source clock consumes ALSA status points
([live-stereo-clock.ts:1-3](/home/avoid/.t3/worktrees/couch/experiment-stereo-clock-discipline/src/server/live-stereo-clock.ts)).
The product captures with getUserMedia/getDisplayMedia on whichever device
publishes ([live.ts:257-265](../src/client/session/live.ts)). On Linux,
PipeWire-Pulse holds the output layer. macOS and Windows hosts have no native
capture counterpart. The older browser ingress (#807) requested mono and
duplicated it. R5's 100/95 ms longs used PCM over Ethernet with one foreground
Electron receiver. Today's Opus uses 60 ms frames
([sendspin.ts:226](../src/server/sendspin.ts)). The SDK adds 100 ms of assumed
output latency on every iOS browser (`dist/audio/platform-output-latency.js:1,10-14`)
and won't use Opus on Firefox (`dist/core/codec-support.js:33-35`).
*Inference:* "timestamped capture" covers three adapters, each observing its clock
differently, and only one has evidence. Add Opus packetization, Wi-Fi and phone
outputs, and nothing shows margin under 100 ms. On iPhones the SDK's own
compensation may make it unreachable. That doesn't justify changing the goal. It
is why decisions 1–2 below must come before building adapters.

**3. For captured video, lean to WebCodecs frames; keep the follower for URL media.**
*Observed:* MediaRecorder's only timing is a `timecode` relative to its first
chunk. It has no capture-clock mapping and no on-demand keyframes
([MediaStream Recording](https://w3c.github.io/mediacapture-record/)). Screen and
system capture come from desktop publishers, and Electron pins a Chromium build
with `VideoEncoder` and `MediaStreamTrackProcessor`. The follower re-reads the
clock every 250 ms and corrects by changing rate or seeking
([picture-clock.ts:18](../src/client/session/picture-clock.ts)).
*Inference:* both video options need a capture-timestamped encoder, which in
practice means WebCodecs or a native encoder at the publisher, not MediaRecorder.
Once the chunks exist, the MSE route adds three layers: an fMP4 muxer, MSE or
ManagedMediaSource buffer policy, and a reactive follower whose large-drift seeks
land in a short live buffer. Decoding the chunks into a frame queue keyed to
`soundClock` drops all three. The module (decoder, keyframe joins, bounded queue,
closing frames, drawing on `requestAnimationFrame`) is new but bounded. "A
substantial renderer" overstates it. Local lip sync and cross-screen sync then
come from the same clock, apart from each display's own latency, which is still
unmeasured. Costs: Firefox Android lacks `VideoDecoder`, so it is refused, and
phone power use is unknown. A WebSocket gives no congestion-adapted bitrate, so
cap video bitrate for the subset. This is a lean, not a proof: the owner accepts
more delay, and more delay shrinks MSE's buffer risk. Neither option is qualified.

**4. Commit to removing generated HLS; freeze WebRTC.**
*Observed:* the recorder/HLS chain (250 ms recorder slices,
[live.ts:164](../src/client/session/live.ts); 1 s keyframed x264/AAC segments,
[live-stream.ts:91-100](../src/server/live-stream.ts)) serves In sync, the
per-receiver fallback and AirPlay. [ADR 0001](adr/0001-live-inputs-play-over-webrtc-unless-in-sync.md)
is today's WebRTC contract.
*Proposal:* a failed WebRTC receiver takes the live timeline at a larger lead,
still marked Behind, and AirPlay PCM enters the same timeline. Then MediaRecorder
upload, live HLS ingestion and AirPlay's AAC/HLS hop are all deleted. The draft
says HLS "cannot be deleted merely because group audio bypasses it". That's true,
but deletion should still be the stated target. What's lost: fallback for
browsers without WebCodecs or Opus decoding.
*WebRTC:* the older lab measured maxima of 89–139 ms (two browsers, JACK). The
timed path measured 95–100 ms medians (native capture, PCM). Different rigs, so
not comparable. *Inference:* any audio latency advantage is probably small. But
WebRTC also provides UDP loss concealment and adaptive video bitrate, which
matter on Wi-Fi. Freeze it: no SFU, no new features. Decide with one
same-publisher, one-receiver Wi-Fi comparison once the live timeline exists, and
include loss behavior, not only median delay. Removing it also removes the
TURN/STUN and peer-admission code.

**5. At 50 receivers the near-term risks are Core's event loop and joins, not codec counts.**
*Observed:* the group sender ticks every 20 ms inside the Hub's process
([hub.ts:131](../src/server/hub.ts), [sendspin.ts:231](../src/server/sendspin.ts)).
Lab run C6 failed after a 90 ms host pause. Pairing shares one global window of
20 attempts per minute ([hub.ts:1446-1447](../src/server/hub.ts)). The
speaker-only join bug is still on main ([hub.ts:1867](../src/server/hub.ts);
fix `c72c2f9`).
*Inference:* with 25 ms receiver margins, one Hub stall like C6's drops
receivers. Fifty first-time phones need at least three pairing windows (about
2–3 minutes) even with correct codes. PCM to 50 phones would need 76.8 Mbit/s of
payload alone, which is implausible on Wi-Fi, so Opus is effectively required.
Firefox receivers can only take PCM.
*Proposal:* run the live sender and its fanout off the main event loop. Treat
#810 (state fanout) and #804 (admission budgets) as prerequisites for 50
receivers, not optimizations.

## The interactive costs page

- The codec-pass badges dominate the page, so "3 → 1" reads as the main win.
  Today's In sync actually waits seconds on buffering (recorder slices, 1 s
  segments, 1 s lead), not on codec passes.
- The Direct explorer leaves out captured Direct (WebRTC), the very path under
  decision.
- The low-latency candidate is drawn as Opus 1E/1D, but the evidence is PCM 0E/0D.
- The page and proposal use Opus at 128 kbit/s (6.4 Mbit/s for 50); the code
  uses 96k, as does the alternatives note (4.8 Mbit/s).
- The relaxed "Simpler candidate" badge stays at 1/2 while its text says
  captures take 1/1.

## What the experiments contribute

- **Worth productizing:** the rate/phase source-clock model (its observation
  input differs per adapter); the fixed-deadline sender with generations and
  per-receiver refusal (rewrite it for Opus, Hub routing and volume); the SDK
  slope fix and readiness check (upstream them); the join fix; unchanged-volume
  suppression; #804; #810.
- **Harness only:** `tests/stereo-hardware`, the qualifiers and R2–R5
  measurement contracts, #805/806/808/811, performance-bench, ALSA ring sizing.
- **Already merged:** #841, #877, #878, #881, #887, #888.
- **Obsolete:** the nominal mapper, mono-duplicated browser ingress, global
  128-frame tuning, the HLS concert route.
- **Unproven:** repeat reliability at 100/95 ms (one long each; the 90 ms long
  never ran), Opus at a low lead, Wi-Fi, phones, multiple physical receivers,
  any video sync.

## Keep, combine, remove

- **Keep unchanged:** Playbacks and queues, Play on, Move here, consent,
  levels/delays, the relay, yt-dlp, mpv, sinks, the compressor (Direct/relaxed
  only) and the URL follower.
- **Combine:** every captured source into one live timeline. Relaxed live is the
  same timeline with a larger lead.
- **Add:** the off-loop live sender, capture adapters and the frame queue.
- **Remove, after replacement:** MediaRecorder upload, live HLS and AirPlay's
  AAC/HLS hop. Remove WebRTC, TURN and STUN later if the comparison doesn't
  justify them. For users: the Behind fallback becomes the timed stream; browsers
  without WebCodecs lose captured video; if WebRTC goes, unsynchronized screen
  sharing gains the live lead.

## Decisions for the owner

1. When some phones can't keep the concert timing, should the whole group play
   later so those phones can join, or keep its timing and turn them away?
   "Prefer tighter sync" doesn't settle this trade between including people and
   keeping latency low.
2. Must low-latency sources work from any device's browser, or is an input on
   the Couch computer (concerts) plus the desktop app (gaming capture) enough?
   Ingress from a browser page is unproven and much harder to time.
