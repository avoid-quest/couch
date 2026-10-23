# Share

Sharing this device's screen or sound starts from the header and stays there
while it runs. Its rules live in
[`src/client/sections/share/share.ts`](../../src/client/sections/share/share.ts),
with a test per rule in `tests/share.test.ts`; capture itself is the live
session's ([Share a live device](../live-inputs.md)).

Everything here is this device's own: it carries `data-tv-local-only`, so a
TV's own remote and pointer use it but another device's Remote never reaches
it.

## Share

**Share** sits in the header's right cluster, before the search field (an icon
after it in a phone's top bar), on every device whose browser can capture.
It opens one Dialog on desktop and a bottom Sheet on phones and the TV:

```
Share this device                                  ×
(✓ Screen) (Window) (Sound only) (Microphone)
[picture] [picture] [picture]          screens or windows
Input                        [System default ▾]   Microphone only
                             Choose audio input
Play on                (Living room TV) (Kitchen)
Include this computer's sound               [on]   Screen and Window
Picture                     [1080p, balanced ▾]   Screen and Window
                              Cancel  [Start sharing]
```

- **What to share** is one row of chips, the chosen one checked
  (`shareKinds`). Each kind says how it captures: Screen and Window are a
  `screen` capture of a screen or a window, Sound only is `system-audio`, and
  Microphone is `microphone`, with today's input choice. Another kind (a
  specific sound card, say) is one more entry there.
- **Screens and windows** in the desktop app are small pictures with their
  names (`desktopCapturer` thumbnails, 320 × 200), for this computer's own
  Couch only: another Couch's page (Client mode) lists their names alone, as it
  would otherwise see a window's content before the owner allows it. A screen
  is chosen for you; a window waits for your choice. In a browser Screen and
  Window hand off to the browser's own picker, which opens on that surface and
  still offers the rest. Sound only takes the first screen's capture for its
  sound in the desktop app.
- **Play on** lists every other online device that lets others use its screen
  or speakers, as chips. A device that can take nothing of this kind stays in
  place, disabled. Without a choice the share waits in Home's Shared sources,
  as it always has.
- **Start sharing** starts the capture, then plays it on the chosen devices in
  order: Play on the first, then each other joins the same playback.
- **Disabled keeps its place:** a browser that can't capture a display (a
  phone's) keeps Screen, Window and Sound only, disabled, with today's reason
  under the chips.

## While it runs

The header's Share becomes the **capsule**: a silent picture of what goes out
(the capture's own video track; a white disc with its kind's glyph for sound),
its title (the chosen screen's or window's name, or the input's), how many
devices watch, and Stop sharing. It floats on the toasts' surface and shadow,
without the bar's filter, which stays the page's one backdrop filter
([Glass](../design.md#glass)). Below `xl` the title leaves, below 960px the
count too (thumbnail and Stop); on a phone it is the picture alone, and Stop
waits in its panel, so a stray tap beside the search never ends sharing for
every receiver.

Pressing it opens its panel, a Popover hanging from it on desktop and a bottom
Sheet on phones and the TV:

- The picture, the title, what it is ("Window, with this computer's sound")
  and since when.
- **Who's watching**, one divided row per device the share plays on, from the
  playbacks that play it: its channels and its route, "Picture and sound,
  direct" or "Sound, through the relay", read every two seconds from the
  publisher's own connection (the selected candidate pair in
  `RTCPeerConnection.getStats()`). Where it plays names only exceptions; this
  panel is the sharer's own, so every row names its route. Behind and "Can't
  play: {reason}" (in red) read as Where it plays says them, and a row whose
  sound plays shows the [level](../design.md#motion).
- **Picture**, changed live through `applyConstraints` on the captured track,
  without restarting it; **Mute microphone** turns the microphone's track off
  (`track.enabled`), keeping the capture and its connections.
- One line about the relay only when a device is Behind: with no relay, that a
  relay can fix it, linking Devices & network; with one, that it couldn't
  connect even through it.
- **Where it plays**, while this window views the playback that plays the
  share, and **Stop sharing**.

## When it doesn't work

- Capture refused by the system (macOS's Screen & System Audio Recording, or
  the microphone): the dialog says what to turn on in place of the pictures,
  with Open System Settings, and checks again when the window regains focus.
- Another window of this device already shares: the dialog says so and Start
  sharing waits.
- A receiver that can't play: its row says "Can't play: {reason}" in red.
- The last viewer leaves while the capture still runs: one toast, "Still
  sharing {title}, on no screens", with Stop sharing.
- A Play on device that can't take what was captured (Linux captures no system
  audio, so a speakers-only device takes nothing): Core's refusal shows as the
  page's error, and the share keeps playing where it can.

## Not yet

The built-in relay serves only the LAN, and pairing is LAN-only: inviting a
guest outside it needs a rendezvous, a guest identity scoped to one share and
a relay a guest can reach, none of which exist yet.
