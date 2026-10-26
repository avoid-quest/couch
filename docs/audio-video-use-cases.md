> **Historical scope, 24–25 October 2026.** The original document below is
> preserved verbatim from `recovery/player-modes-20261026` (source `8147fc9`).
> Its “current”, baseline, workspace-transfer instructions and completion claims
> describe that historical input. For today’s disposition and pending checks, read
> the [integration ledger](player-modes-integration-ledger.md). Historical links
> to omitted research/validation resolve on the recovery ref; the
> [recovery reference](player-modes-recovery-reference.md) explains retrieval.

# Playback use cases and the current UX

Architecture discussion, 24 October 2026. Verified against main
`59ac6cd6a510ca96bf60dfc9a3628cc635be22e1` using source and documentation, without
running Couch. **Current** describes built behavior; **proposed** is not implemented.
The three behaviors need not become three screens or a global mode selector.
The [full refactor plan](audio-video-refactor-plan.md) maps these stories to
implementation packages and acceptance checks.

Agreed scope: independent playback on **any permitted single device**; relaxed
shared A/V; synchronized **live audio first**, targeting 50 receivers. Initially
qualify audio capture on the Couch computer/desktop app, while phones and desktop
browsers receive. Screen sharing stays in relaxed A/V scope. Low-latency video
is future work: approximately 5–10 screens and desirable 1080p/60 remain aspirations,
not first-release requirements or qualified capabilities. Gaming means
watching/listening; input stays on the publishing computer. Zones are future work.

## 1. Direct: I play something on one permitted device

The destination can be my phone, a shared Couch TV or another connected device
whose outputs I may use. The controlling device need not be the receiving device.

| Use case | Current UX journey | Current behavior and architectural consequence |
| --- | --- | --- |
| **D1. I watch YouTube/a film while someone else listens to music.** | Home, Search or Saved → item → **Play on → my device**. It is marked **This device**. If only one eligible target exists, use Play. | Independent Playbacks and Up next queues already exist. The receiver decodes locally; Core resolves sources and relays web-provider bytes. No group audio processing just because other users are connected. |
| **D2. I listen to radio/music on my phone or headphones.** | Choose the station/track → Play on this device → Volume; open **Up next** for the listening queue. | Same direct engine. Headphones/Bluetooth are outputs of that device, not another Couch receiver. Background capability depends on browser/output; this is not live qualification. Turning picture off does not currently guarantee that unused video stops downloading. |
| **D3. I leave a group and start something else here.** | Find another ordinary item → **Play on → this device**. | Explicit Play on separates that device from a multi-output Playback. The others can keep playing. **Move here is different:** it transfers the group's existing Playback exclusively and can interrupt their listening. |
| **D4. I watch one person's shared screen on my laptop.** | Publisher: **Share → Screen/Window → Play on my laptop → Start sharing**. Or publish without a destination; receiver chooses the source from **Home → Shared sources**. | With one receiver, current delivery is WebRTC. If that source already plays in an accessible Playback, Play/Play on joins it rather than creating a private independent copy. Buffered In sync is also available. A replacement for captured video is outside the first live-audio milestone; the separate faster path remains conditional on a meaningful latency benefit. |
| **D5. I start a film on the shared Couch TV or music on another permitted device.** | Item → **Play on → destination**; use Now Playing or Remote from my controller. | One receiving device still means Direct. The destination must permit use of its selected outputs. The controller does not consume a receiver slot unless it also plays. Remote controls Couch, not the game or host OS. |
| **D6. I move my current listening here or to another permitted device.** | Open **Where it plays → destination's row → Move here**. The label refers to that destination, not necessarily the controlling device. | This transfers the current Playback/queue exclusively to that destination, subject to permissions. The ordinary row shows Move here for devices not already in the Playback; TV rows currently lack this button. Preserve the distinction between moving, starting an item with Play on and adding another output. Moving a shared Playback can affect its other listeners. |

An unsupported IPTV codec can use **mpv on the Couch host**; selecting it does
not grant that codec to phones or groups. That is a compatibility exception,
not a separate mode to choose.

## 2. Relaxed synced: we share a programme and outputs

| Use case | Current UX journey | Current behavior and architectural consequence |
| --- | --- | --- |
| **R1. Music in the living room and kitchen.** | Start music → open **Where it plays** from the player/now-playing bar → enable each device's **Sound**. | Ordinary media spanning devices automatically selects synchronized audio. Each device must consent to others using it. One queue/transport belongs to this Playback; other Playbacks remain independent. |
| **R2. Film on the TV, sound on my phone/headphones.** | Start the film → Where it plays → TV **Picture** on, phone **Sound** on; turn off unwanted channels. | A/V crosses devices even with only one speaker. The group clock is needed. Per-device **… → Sync… / Lip sync…** compensates late outputs; **Playback → Audio delay** is a different, incompletely supported control. |
| **R3. The same video on several screens, controlled together.** | Add **Picture** and optionally Sound on the relevant rows. Use Now Playing and Up next for pause, seek where supported, next and queue edits. | Sound is scheduled; pictures follow its clock with rate/seek corrections. This is existing relaxed synchronization, not proof of frame-locked displays. Per-device volume differs from the Playback's shared Volume. |
| **R4. We watch a shared screen, presentation or game, accepting delay.** | Share Screen/Window, optionally include sound → Start sharing; add receivers → **Where it plays → In sync**. | This already uses recorded/HLS media and buffered synchronization. Default WebRTC sharing does not synchronize receivers. Keep this relaxed A/V capability while live-audio work proceeds; sound and picture need a common delay. The game stays controlled on the publishing computer. A new low-latency video renderer is not required for this story. |
| **R5. Someone sends AirPlay music into the group.** | Admin: **Settings → Sources → Receive AirPlay**. Sender chooses Couch in the OS AirPlay picker. **AirPlay · name** appears in Shared sources; add outputs and enable In sync. | Linux-host audio input only. On arrival it automatically takes the host's speakers from their prior Playback; other outputs/queues survive. One AirPlay sender at a time. It is relaxed input, not a 100 ms concert source. |
| **R6. We listen to a shared microphone, music input or computer audio with more buffering.** | Share Sound only or **Microphone → Choose audio input**, then choose outputs and In sync. | Current capture still traverses recorded/HLS ingestion. Audio-only capture is a candidate for the common scheduled audio path with a larger lead, without waiting for a replacement video path. |
| **R7. Our group plays something while another group plays something else.** | Use separate existing Playbacks and output sets; Play on and Where it plays choose their destinations. | Independent queues/programmes already exist. This does not imply persistent named zones, zone membership or access rules. Each receiver currently serves one Playback at a time; separate programmes require separate source processing, even if the engine is shared. |

**Consent is separate from joining.** A device that wants others to select its
outputs enables **Settings → This device → Let other devices use → Speakers /
Screen**. Self-play/self-join does not require that permission. The host follows
its existing Share on network policy. Sharing an output does not publish a
microphone or screen capture; that requires Share and local capture permission.

## 3. Low-latency synced: live audio first, with a common deadline

The entry points below largely exist, but **none currently selects a qualified
low-latency synchronized implementation**. Current In sync is buffered; its
existence must not be relabeled as a delivered concert feature. Initial concert
goal: **100 ms input-to-ear**, with synchronization taking priority and numerical
speaker-skew tolerance still open. This is a goal, not a current support promise.

Listeners follow the source. They do not get a collaborative programme queue,
seek, Next or group pause. Their useful actions are join/leave, their own listening
level and sync status; expose a small delay correction only where needed. The
publisher controls capture and the programme at its source. This differs from
relaxed playback's shared controls even if the audio machinery is shared.

| Use case | Existing UX to reuse | Missing behavior / proposed change |
| --- | --- | --- |
| **L1. Concert mix to 50 audience phones/headphones/speakers.** | On the Couch computer: **Share → Microphone → Choose audio input** selects the interface. Publish. Guests pair through the existing QR/code flow, choose the source in Shared sources, **Play on → this device**, then Tap to hear if required. | Qualified source-clock capture, fixed deadlines, source/receiver admission and useful join errors. Keep supported receivers together; refuse unsupported live routes rather than shift the group. The existing Microphone label also covers music interfaces; “Audio input” would describe this use better. The speaker-only join defect and burst-pairing limits need correction. |
| **L2. I join a concert already in progress.** | Discover the shared source, choose my permitted listening device and allow audio if prompted. | Join the current source position only after the browser/output route qualifies. Do not restart the programme or move existing listeners' deadlines to admit me. |
| **L3. I adjust my own listening or leave without affecting the audience.** | Reuse device volume/mute and an explicit leave action; show sync status where useful. | Current Playback Stop and shared transport controls are not audience leave controls. Audience membership must not grant programme control. No queue or transport panel is needed for a concert listener. |
| **L4. My connection recovers or I change headphones/output.** | Reconnect or select the local output. | Recheck admission and rejoin the present. A route that cannot keep the deadline is unavailable for live; do not silently give it delayed audio or delay the whole group. Background/locked-phone operation needs its own qualification. |

Returning after Wi-Fi loss or a supported output change should rejoin the present
with a fresh admission check. A listener leaving must not stop the source. A
publisher closing/reloading its page or losing its Core connection currently
ends that capture for everyone. Locked-phone audio is a separate qualification
state; foreground video support does not establish it.

## Future stories to retain, without building them now

- **Zones:** “I enter the named living-room zone, use its permitted outputs and
  participate under its access rules.” Naming, membership, discovery, control
  rights and how a zone relates to a Playback need a separate UX/performance
  discussion. Today's Share publishes a source people can select; it is not an
  agreed zone model. Preserve concurrent Playbacks without introducing zones now.
- **Live game spectators:** “We watch/listen on approximately 5–10 screens,
  with audio on up to 50 receivers, while the game is controlled at the publisher.”
  1080p/60 is desirable; current capture is capped at 30 fps. Common A/V timing
  and synchronization between screens remain unqualified future work. Relaxed
  screen sharing serves the delay-tolerant version now.
- **Live presentation screens:** “Several nearby screens show the same capture
  with little delay, optionally without sound.” Keep picture-only timing and
  audio-only receiver efficiency in the future requirements. Do not implement
  a new video scheduler or artificial silent-audio clock for the audio milestone.

## Common actions: preserve their meanings

| Action / location | What it means today |
| --- | --- |
| **Play / Play on** on a media item | Ordinary Play keeps the selected output mix. Explicit Play on chooses/isolates its destination for ordinary media. Live-source Play normally joins an existing accessible Playback. |
| **Queue / Play next / Up next** | Operate on the viewed Playback, not a single global queue. Queuing a live source does not join it immediately; the source must still exist when reached. Live captures cannot be restored or saved as durable media. |
| **Where it plays → Picture / Sound** | Add/remove channels for this Playback. Turning off the last channel removes that device. Choosing a device busy elsewhere moves it, subject to consent. |
| **Move here** | Move this Playback exclusively to the chosen device, including its queue. It is not “also play here”; private outputs can prevent the move. |
| **Volume / device fader** | Playback Volume scales sound the actor may control. A device's fader changes its own output level. Neither should become a source-clock or buffer control. |
| **Stop** | Stop the selected Playback's reception. It is not a local leave action and does not stop the publisher's capture. |
| **Stop sharing**, on the publisher's capsule | End capture and remove that source from all receivers. Other queued media survives. Other controllers cannot request capture or end someone else's source. |
| **Couch selector / This computer / Another Couch** | Choose the instance. Browser state belongs to that instance; desktop Client mode stops its local Core. This is independent of Play on and outside private-mode design here. |

**Current controls are not automatically the live design.** Today's source join
brings Playback transport/queue controls. The agreed concert audience story
requires separating receiving from programme control. Preserve the collaborative
experience for relaxed playback. Settle stories before choosing new labels,
placement or a mode selector; no new UI design is approved here.

## Verification references

- Item destination labels and actions: [PlayOn.tsx](../src/client/components/PlayOn.tsx).
- Share kinds/quality/targets: [share.ts](../src/client/sections/share/share.ts),
  [ShareDialog.tsx](../src/client/sections/share/ShareDialog.tsx),
  [ShareControl.tsx](../src/client/sections/share/ShareControl.tsx).
- Shared source discovery: [HomeSources.tsx](../src/client/sections/home/HomeSources.tsx).
- Routing controls: [Outputs.tsx](../src/client/sections/shell/Outputs.tsx),
  [where-it-plays.ts](../src/client/session/where-it-plays.ts).
- Consent: [DeviceSharingSettings.tsx](../src/client/sections/settings/this-device/DeviceSharingSettings.tsx).
- Capture's 30 fps limit: [live.ts](../src/client/session/live.ts:18).
- Routing/ownership/permission rules: [hub.ts](../src/server/hub.ts).
- TV control: [RemotePage.tsx](../src/client/sections/remote/RemotePage.tsx),
  [Remote design](design/remote.md).
- AirPlay auto-start and restrictions: [airplay.md](airplay.md).
- Desktop Core lifecycle: [app/main.ts](../app/main.ts:196).

Some older text in live-inputs.md still puts Move here/Mute in a device's “…”
menu; the current Outputs implementation and Where it plays design supersede
that description. This note maps the current UI without changing built-state docs.
