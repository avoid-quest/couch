# Playback use cases and capabilities

The product contract for playback, refined with the owner on 27 October 2026.
Source, acquisition environment and playback behavior are separate decisions.

## Live versus relaxed playback

Live audio starts at a configurable playback buffer (initially 150 ms); that
setting is separate from measured input-to-ear delay. The goal is low useful
delay together with quality, continuity and efficiency.

Live and relaxed playback remain distinct in their UX and technical policies.
Relaxed playback can read ahead and buffer a shared programme; Live follows an
ongoing source and ultimately seeks much lower delay. Source preparation,
buffering, delivery and recovery choices should fit the actual mode. Sharing
Sendspin or other components does not require identical pipelines or defaults,
and native/browser acquisition still follows source and runtime capabilities.

For a future mature Live system, roughly 30 ms maximum input-to-ear delay is an
ambition to evaluate, not a feasibility claim or an acceptance gate.
Later improvements should target the lowest useful, stable delay for the mode,
source, environment and devices, with quality and continuity considered together.
A few milliseconds of inter-device skew can be acceptable; sample-perfect output
is not a product requirement. Acoustic travel through a venue is separate from
electronic delay and does not make chasing isolated timing numbers useful.

The [glossary](../GLOSSARY.md) defines the product terms. Built integration details
and verification limits belong in [Live audio](live-audio.md), with user-facing
behavior in [Share](design/share.md). A documented capability and a physically
measured result are separate facts.

## Source, environment and playback behavior

Use three independent decisions:

1. **Source:** an existing media item, an audio input, system/tab sound, a screen
   or window, or an incoming service such as AirPlay. This determines the tracks
   and timing information available.
2. **Environment and capability:** where acquisition runs, its OS, exposed APIs,
   selected device and permission. A desktop app, a page controlling a different
   Couch and a receiving phone have different capabilities. The controller's
   capabilities do not describe the publisher or receiver.
3. **Playback behavior:** Direct, relaxed synchronized playback or Live audience
   participation. This determines delivery and control rights. It does not by
   itself justify a different capture backend or an additional audio engine.

Users select content, inputs and destinations. Native/browser acquisition is
an implementation of that choice, with accurate availability and errors.
Existing explicit input choices remain; a failed selected input must not silently
become another physical device.

### Acquisition matrix

| Source | Desktop app / host service | Browser | Boundary to preserve |
| --- | --- | --- | --- |
| File, URL, radio, IPTV or provider media | Resolve/read the existing media source. | Use the selected media rendition and existing access path. | No microphone or system-output capture. Direct playback keeps its existing decoder; scheduled playback uses the source's audio/timeline. |
| Microphone or line input | Use the selected supported adapter: the browser-based input adapter, owned by Main for Live publication. | Use microphone/input capture where the browser exposes it and permission is granted. | Report actual channels/rate and preserve input identity, mute, ownership and shutdown. Native's performance superiority is not established. |
| System, application or tab sound | Use the OS/Electron capability actually exposed for that source. | Use browser-exposed display/tab audio only where available. | The existence of a microphone API does not imply system-audio capture. Unsupported combinations stay explicit. |
| Screen or window, optionally with sound | Use the desktop source picker and capture bridge. | Use the browser's display picker where available. | Keep captured picture and sound together on the selected Direct/relaxed route; an absent audio track remains absent. |
| AirPlay input | Use the existing host receiver service; current support is Linux-host input. | Receive or control the resulting shared source. | Browser playback is not an AirPlay receiver implementation. Keep existing takeover and source-lifetime behavior. |

This records existing capabilities and selection rules, not authorization to add
new OS capture backends. Live publication is currently exposed only on the local
Couch desktop app, with an explicitly selected input; browser clients remain
receivers and keep their existing ordinary sharing capabilities. Extending Live
publication to another environment is a separate feature, not a consequence of
removing performance gates. Receiving audio never grants capture permission.

### Playback and control matrix

| Behavior | Delivery contract | Controls |
| --- | --- | --- |
| Direct | Ordinary media plays on one permitted destination using its existing renderer. Captured sharing retains its existing direct WebRTC route. A controller may be a different device. | Authorized programme/queue actions and controls the source actually supports. |
| Relaxed synchronized | A shared programme spans permitted outputs; sound and picture follow a common timeline with ordinary buffering. Existing Sendspin audio, picture following and captured A/V paths remain. | Collaborative programme/queue controls, source-dependent seek/speed, output consent and individual levels. |
| Live audio | Follow the ongoing source on a path intended for low-delay listening. It uses the upstream Sendspin player with a configurable playback buffer; the mature Live latency ambition remains future work. | Join/Leave and own volume/mute. Publisher owns capture; host removal remains. Audience membership grants no programme/queue authority. |

Keep routing and authority decisions in the existing
[`playback-policy.ts`](../src/shared/playback-policy.ts) and Core. A single speaker
with picture on another device still needs the common timeline. A live broadcast
URL is not automatically a Live audio-input publication. Different behaviors may
share the same capture and audio modules without sharing control rights.

## Audio format and timing boundary

[Sendspin advertises and negotiates formats](https://github.com/Sendspin/spec/blob/main/roles/player/v1.md):
PCM uses interleaved signed little-endian integers; FLAC uses complete lossless
frames; Opus uses individual packets without an Ogg container. Rate, channels and
bit depth come from the source and receiver capabilities. Stereo 48 kHz PCM16 is
one valid combination, not a universal protocol requirement. Current Live audio
supports PCM and Opus; there is no FLAC producer.

The existing scheduled capture boundary carries timestamped float32 samples from
native or browser acquisition. Float32 is our internal representation, not the
Sendspin PCM wire format. Convert once at the existing source boundary when needed;
use a standard encoder for Opus and established conversion for a real rate/channel
mismatch. Existing encoded media keeps its appropriate preparation path. Avoid
forcing it through a sound-card capture or a universal float32 pipeline. This
does not require a new passthrough engine or changing the capture protocol.

For each retained adapter, name its actual input, output and responsibility.
Sample conversion, encoding and presentation-time assignment are separate jobs.
The Node SDK accepts bytes plus an optional timestamp; its default timestamp is
send time. It cannot recover a sound card's original capture time from the bytes.
A source therefore needs a coherent presentation timeline, while the upstream
browser SDK owns clock synchronization, decoding, output scheduling and recovery.

Preserving capture timestamps through encoding is one integration approach, not
a requirement to build a new clock controller. Retain existing sample-position,
generation and codec-delay correctness only as needed for continuous, correctly
ordered playback. Explain the remaining mapping with input/output and a targeted
correctness check; remove a redundant operation when a public upstream API
already covers it. The implementation's exact SDK/default-buffer choices are documented
once in [Live audio](live-audio.md).

## 1. Direct: I play something on one permitted device

The destination can be my phone, a shared Couch TV or another connected device
whose outputs I may use. The controlling device need not be the receiving device.

| Use case | Journey | Required behavior |
| --- | --- | --- |
| **D1. I watch YouTube/a film while someone else listens to music.** | Home, Search or Saved → item → **Play on → my device**. It is marked **This device**. If only one eligible target exists, use Play. | Independent Playbacks and Up next queues already exist. The receiver decodes locally; Core resolves sources and relays web-provider bytes. No group audio processing just because other users are connected. |
| **D2. I listen to radio/music on my phone or headphones.** | Choose the station/track → Play on this device → Volume; open **Up next** for the listening queue. | Headphones/Bluetooth are outputs of that device, not another Couch receiver. Background capability depends on browser/output. Select a suitable audio-only rendition when available. |
| **D3. I leave a group and start something else here.** | Find another ordinary item → **Play on → this device**. | Explicit Play on separates that device from a multi-output Playback. The others can keep playing. **Move here is different:** it transfers the group's existing Playback exclusively and can interrupt their listening. |
| **D4. I watch one person's shared screen on my laptop.** | Publisher: **Share → Screen/Window → Play on my laptop → Start sharing**. Or publish without a destination; receiver chooses the source from **Home → Shared sources**. | With one receiver, current delivery is WebRTC. If that source already plays in an accessible Playback, Play/Play on joins it rather than creating a private independent copy. Buffered In sync is also available. A replacement for captured video is outside the first live-audio milestone; the separate faster path remains conditional on a meaningful latency benefit. |
| **D5. I start a film on the shared Couch TV or music on another permitted device.** | Item → **Play on → destination**; use Now Playing or Remote from my controller. | One receiving device still means Direct. The destination must permit use of its selected outputs. The controller does not consume a receiver slot unless it also plays. Remote controls Couch, not the game or host OS. |
| **D6. I move my current listening here or to another permitted device.** | Open **Where it plays → destination's row → Move here**. The label refers to that destination, not necessarily the controlling device. | Transfer the current Playback/queue exclusively to that destination, subject to permissions. Preserve the distinction between moving, starting an item with Play on and adding another output. Moving a shared Playback can affect its other listeners. |

An unsupported IPTV codec can use **mpv on the Couch host**; selecting it does
not grant that codec to phones or groups. That is a compatibility exception,
not a separate mode to choose.

## 2. Relaxed synced: we share a programme and outputs

| Use case | Journey | Required behavior |
| --- | --- | --- |
| **R1. Music in the living room and kitchen.** | Start music → open **Where it plays** from the player/now-playing bar → enable each device's **Sound**. | Ordinary media spanning devices automatically selects synchronized audio. Each device must consent to others using it. One queue/transport belongs to this Playback; other Playbacks remain independent. |
| **R2. Film on the TV, sound on my phone/headphones.** | Start the film → Where it plays → TV **Picture** on, phone **Sound** on; turn off unwanted channels. | A/V crosses devices even with only one speaker, so it needs the group clock. Keep supported per-device sync adjustments; expose Playback Audio delay only on routes that implement it. |
| **R3. The same video on several screens, controlled together.** | Add **Picture** and optionally Sound on the relevant rows. Use Now Playing and Up next for pause, seek where supported, next and queue edits. | Sound is scheduled; pictures follow its clock with rate/seek corrections. This is existing relaxed synchronization, not proof of frame-locked displays. Per-device volume differs from the Playback's shared Volume. |
| **R4. We watch a shared screen, presentation or game, accepting delay.** | Share Screen/Window, optionally include sound → Start sharing; add receivers → **Where it plays → In sync**. | This already uses recorded/HLS media and buffered synchronization. Default WebRTC sharing does not synchronize receivers. Keep this relaxed A/V capability while live-audio work proceeds; sound and picture need a common delay. The game stays controlled on the publishing computer. A new low-latency video renderer is not required for this story. |
| **R5. Someone sends AirPlay music into the group.** | Admin: **Settings → Sources → Receive AirPlay**. Sender chooses Couch in the OS AirPlay picker. **AirPlay · name** appears in Shared sources; add outputs and enable In sync. | Existing Linux-host buffered input. On arrival it takes the host's speakers from their prior Playback; other outputs/queues survive. One AirPlay sender at a time. |
| **R6. We listen to a shared microphone, music input or computer audio.** | Share Sound only or **Audio input → Choose audio input**, then choose outputs and In sync. | Keep ordinary collaborative input sharing. Use the existing source adapter appropriate to its tracks and runtime; timestamped audio can use scheduled audio, while captured A/V retains its common picture/sound timeline. |
| **R7. Our group plays something while another group plays something else.** | Use separate existing Playbacks and output sets; Play on and Where it plays choose their destinations. | Independent queues/programmes already exist. This does not imply persistent named zones, zone membership or access rules. Each receiver currently serves one Playback at a time; separate programmes require separate source processing, even if the engine is shared. |

**Consent is separate from joining.** A device that wants others to select its
outputs enables **Settings → This device → Let other devices use → Speakers /
Screen**. Self-play/self-join does not require that permission. The host follows
its existing Share on network policy. Sharing an output does not publish a
microphone or screen capture; that requires Share and local capture permission.

## 3. Live audio: follow the source

The existing local desktop publication feeds the upstream Sendspin browser player.
It is Live's source-following UX and the path for eventual lower delay, with
no latency or capacity guarantee. Relaxed playback keeps
its own UX and buffering policies even where implementation is shared.

Listeners join, leave and set their own volume/mute. The publisher owns capture
and its programme. Ordinary buffering and the SDK's timing/recovery behavior are
acceptable. Output settings use supported upstream APIs. Actual source/output
errors remain visible; guessed deadline budgets do not automatically evict a
listener or withdraw its audio. Upstream recovery can still resynchronize audio;
this contract does not claim interruption-free output without observing it.

| Use case | Journey | Required behavior |
| --- | --- | --- |
| **L1. Share an audio input with an audience.** | On the local Couch desktop app: **Share → Audio input → Playback: Live → choose a device**. Guests use existing pairing, find the source and Join, with Tap to hear when required. | Keep the selected supported capture backend and useful input controls. Deliver PCM or Opus through Sendspin using receiver capabilities. Preserve capture permission and ownership independently of playback authorization. |
| **L2. I join an ongoing source.** | Discover the source, choose a permitted listening device and allow audio if prompted. | Join the ongoing programme with normal buffering; other listeners and independent Playbacks keep working. A join must not restart the captured source. |
| **L3. I adjust my listening or leave.** | Own volume/mute and Leave; host removal remains available. | Leaving releases only this reception. Joining grants no programme pause, queue, seek or Next authority, and no control over another device's level, even one that shares its speaker, including through crafted commands; only the host keeps those. |
| **L4. My connection recovers or I change output.** | Existing reconnect and local output selection. | Let the upstream player handle timing/recovery and rejoin the current source. Keep actual failures visible and isolate a failed peer. The owner heard no clear Pixel artifacts in one screen-off run at 150 ms and reported dropouts at 120 ms; the Pixel was not electrically recorded. Separate Redmi returns contained attenuations at both settings, with coverage stated in the [measurements](live-audio.md#measured-behavior). |

A publisher closing/reloading its page or losing its owning connection ends that
capture for everyone. Stop sharing ends the source; a listener's Leave does not.

## Future stories to retain, without building them now

- **Zones:** “I enter the named living-room zone, use its permitted outputs and
  participate under its access rules.” Naming, membership, discovery, control
  rights and how a zone relates to a Playback need a separate UX/performance
  discussion. Today's Share publishes a source people can select; it is not an
  agreed zone model. Preserve concurrent Playbacks without introducing zones now.
- **Live game spectators:** “We watch/listen while the game is controlled at
  the publisher.” Relaxed screen sharing serves this today. A new live-video
  renderer, frame-rate target or audience-capacity campaign requires a separate
  request.
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

Live audience controls and ordinary collaborative programme controls remain
distinct even when the underlying audio path is shared. Preserve existing
discovery, source selection, output consent and handoff journeys.

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
