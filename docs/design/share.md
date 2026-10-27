# Share

Sharing this device's screen or sound starts from the header and stays there
while it runs. Its rules live in
[`src/client/sections/share/share.ts`](../../src/client/sections/share/share.ts),
with a test per rule in `tests/share.test.ts`; capture itself is the live
session's ([Share a live device](../live-inputs.md)).

Everything here is this device's own: it carries `data-tv-local-only` (its toast
the `tv-local-only` class, as sonner takes no attributes), so a
TV's own remote and pointer use it but another device's Remote never reaches
it.

## Share

**Share** sits in the header's right cluster, before the search field (an icon
after it in a phone's top bar), on every device whose browser can capture.
**Show Share in the header** (Settings → This device, saved per device) hides
it; until chosen it is off on a TV and on everywhere else. While it is off, the
same row offers Share screen or sound. It opens one Dialog on desktop and a
bottom Sheet on phones and the TV:

```
Share this device                                  ×
(✓ Screen) (Window) (Sound only) (Audio input) (Live audio)
[picture] [picture] [picture]          screens or windows
Input                        [System default ▾]   Audio input
Input                        [Choose an input ▾]  Live audio
                             Choose audio input
Play on                (Living room TV) (Kitchen)
Include this computer's sound               [on]   Screen and Window
Picture                     [1080p, balanced ▾]   Screen and Window
                              Cancel  [Start sharing]
```

- **What to share** is one row of chips, the chosen one checked
  (`shareKinds`). Each kind says how it captures: Screen and Window are a
  `screen` capture of a screen or a window, Sound only is `system-audio`, and
  Live audio requires an explicit input: its selector starts empty, omits System default, and keeps Start sharing disabled until a device is selected. Ordinary Audio input retains System default.
  Audio input is `microphone`, with the input choice. **Live audio** uses that
  same picker with live intent and appears only on the Couch computer in the
  desktop app. It requires an actual stereo input and timestamped capture;
  unsupported capture fails with a reason. No duplicate mono is advertised as
  stereo. Ordinary sharing keeps its relaxed controls. Live listeners find the
  source in Home or Search, **Join**, adjust their own volume, and **Leave**;
  leaving does not stop sharing or affect another listener.
- **Live input selection** includes devices marked Native on Mac builds with the
  capture helper. Other input IDs use an isolated hidden browser capture page.
  This is an explicit input choice; a failed native input never switches devices.
  Main requests microphone permission before opening the selected native input.
- **Screens and windows** in the desktop app are small pictures with their
  names (`desktopCapturer` thumbnails, 320 × 200), for this computer's own
  Couch only: another Couch's page (Client mode) lists their names alone, as it
  would otherwise see a window's content before the owner allows it. A screen
  is chosen for you; a window waits for your choice. In a browser Screen and
  Window hand off to the browser's own picker, which opens on that surface and
  still offers the rest. Sound only takes the first screen's capture for its
  sound in the desktop app, so Start sharing waits there until it lists one.
- **Play on** lists every other online device that lets others use its screen
  or speakers, as chips. A device that can take nothing of this kind stays in
  place, disabled, and leaves the choice. Without a choice the share waits in
  Home's Shared sources, as it always has.
- **Start sharing** starts the capture, then plays it on the chosen devices in
  order: the first that takes it plays it, then each other joins the same
  playback. Closing the dialog while it starts cancels it, as Cancel does.
- **Disabled keeps its place:** a browser that can't capture a display (a
  phone's) keeps Screen, Window and Sound only, disabled, with today's reason
  under the chips.

## While it runs

The header's Share becomes the **capsule**: a silent picture of what goes out
(the capture's own video track; a white disc with its kind's glyph for sound),
the share's name, how many devices watch, and Stop sharing, its one place. The
name is the one Home, the Stage and the now-playing bar show ("Studio Mac ·
Screen"). It floats on the toasts' surface and shadow,
without the bar's filter, which stays the page's one backdrop filter
([Glass](../design.md#glass)). Below `xl` the name leaves, below 960px the
count too (thumbnail and Stop); on a phone Stop keeps only its icon.

Pressing it opens its panel, a Popover hanging from it on desktop and a bottom
Sheet on phones and the TV:

- The picture, the name, what it is when the name doesn't say it ("Window,
  with this computer's sound") and since when.
- **Who's watching**, one divided row per device the share plays on, from the
  playbacks that play it: its channels and its route, "Picture and sound,
  direct" or "Sound, through the relay" for WebRTC, read every two seconds from the
  publisher's own connection (the selected candidate pair in
  `RTCPeerConnection.getStats()`). Where it plays names only exceptions; this
  panel is the sharer's own, so every row names its route. Behind and "Can't
  play: {reason}" (in red) read as Where it plays says them, and a row whose
  sound plays shows the [level](../design.md#motion), moving only where Where
  it plays' would (online, unmuted, above zero).
- **Picture**, changed live through `applyConstraints` on the captured track,
  without restarting it; **Mute audio input** turns the input's track off
  (`track.enabled`), keeping the capture and its connections. Native input mute
  sends zero samples while preserving the source clock.
- Live sharing reports the delivered rate and channels. Browser input shows its
  first block size; Native shows requested and reported buffer frames separately.
- One line about the relay only when a device is Behind: with no relay, that a
  relay can fix it, linking Devices & network; with one, that it couldn't
  connect even through it.
- **Where it plays**, while this window views the playback that plays the
  share. Stop sharing stays on the capsule.

### Live audio

A [Live audio](../live-audio.md) share's panel is its host's operator view.
Who's watching becomes a summary line and one row per listener, and the
stream's settings follow Mute audio input:

```
3 listening · Lead 100 ms, at its maximum · Full loop ≈ 107 ms
Kitchen   Sets the lead · PCM · latency 97 ms · margin 4 ms · 0 gaps         ⋯
Pixel     Behind by 20 ms · PCM · latency 140 ms · margin -20 ms · 3 gaps    ⋯
Mute audio input                                       [on]
Capture buffer                        [128 frames · 2.7 ms ▾]   native inputs
Codec                                              [PCM ▾]
Bitrate                                       [192 kbps ▾]      Opus
Lead                                         [Automatic ▾]
Maximum              ──────●──────                 100 ms      Automatic
Minimum              ●────────────                   0 ms      Automatic
Raise for the slowest                                  [on]     Automatic
Fixed at             ───●─────────                  60 ms      Fixed
Listener buffer                       [256 frames · 5.3 ms ▾]
```

- A row reads Core's measurements every second while the panel is open
  (`GET /api/live/listeners`): its standing first (Preparing audio…,
  Reconnecting…, Behind by N ms, Sets the lead), then the codec, the latency it
  needs, its worst deadline margin and its gaps, with concealments when there
  are any. Its ⋯ menu has **Remove**, which closes its stream with "Removed by
  the host".
- **Lead** is the shared lead now, and says when it's at Automatic's maximum.
  **Full loop** is an estimate: the lead plus the input latency a native input
  reports. A browser input has none to add.
- A change applies at once to the running share and becomes the next share's
  default. The lead ramps to it; a new codec or capture buffer starts the
  listeners over, and their rows show them preparing again. Fixed starts at
  the lead it replaces. **Listener buffer** is what each listener's browser
  asks for, unless its device chooses its own in
  [Advanced audio](settings.md#advanced-audio).
- Only the host and paired admins can change them or remove a listener.

## When it doesn't work

- Capture refused by the system (macOS's Screen & System Audio Recording, or
  the microphone): the dialog says what to turn on in place of the pictures,
  with Open System Settings, and checks again when the window regains focus.
- Another window of this device already shares: the dialog says so and Start
  sharing waits.
- A receiver that can't play: its row says "Can't play: {reason}" in red.
- The last viewer leaves or goes offline while the capture still runs: one
  toast, "Still sharing {name}, on no screens", with Stop sharing, this
  device's own like the rest. It leaves once a viewer returns or the share
  ends.
- A Play on device that can't take what was captured (Linux captures no system
  audio, so a speakers-only device takes nothing): Core's refusal shows as the
  page's error, and the share keeps playing where it can.

Live audio uses [Couch's timestamped stream](../live-audio.md): 128-frame PCM
or 2.5 ms Opus, with one shared lead and a default maximum of 100 ms. A device's own
browser buffering overrides the host's listener buffer, on the next join. The listener's
player and Where it plays show **Preparing audio…**, **Behind by N ms**,
**Reconnecting…**, and **Removed by the host**. An insecure page shows the HTTPS
address Live needs. Starting sound uses the existing **Tap to hear** prompt. Leaving releases this
listener's audio, socket and wake lock; it never ends capture.

## Not yet

The built-in relay serves only the LAN, and pairing is LAN-only: inviting a
guest outside it needs a rendezvous, a guest identity scoped to one share and
a relay a guest can reach, none of which exist yet.
