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

**Share** is a compact icon immediately before the header's search field, in its own 44px
slot, on every device whose browser can capture. An open or populated phone
search uses that space for typing (and Cancel while open); the active sharing
row stays available.
**Show Share in the header** (Settings → This device, saved per device) hides
it; until chosen it is off on a TV and on everywhere else. While it is off, the
same row offers Share screen or sound. It opens one Dialog on desktop and a
bottom Sheet on phones and the TV:

```
Share this device                                  ×
(✓ Screen) (Window) (System audio) (Audio input)
Share an entire display.
[picture] [picture] [picture]          screens or windows
Playback                     (✓ Relaxed) (Live)    local desktop Audio input
Device                       [System default ▾]   relaxed Audio input
Device                       [Choose an input ▾]  Live Audio input
                             Find audio inputs
Playback buffer (ms)                     [250]    Live Audio input
Play on                (Living room TV) (Kitchen)
Include system audio                       [on]   desktop Screen and Window
Picture                     [1080p, balanced ▾]   Screen and Window
                              Cancel  [Start sharing]
```

- **What to share** is one row of four source choices, the chosen one checked
  (`shareKinds`): **Screen**, **Window**, **System audio** and **Audio input**.
  A short description explains the selected source. Screen shares an entire
  display; Window shares one app window. System audio shares sound without
  video; in a browser it asks for a tab or screen with audio enabled in the
  browser's picker. Audio input includes microphones, line inputs and audio
  interfaces, with a neutral cable icon. The internal `microphone` capture kind
  retains its protocol and permission meaning.
- **Playback** is a separate **Relaxed / Live** choice for Audio input on the
  Couch computer in the desktop app. Relaxed keeps collaborative playback
  controls and System default as an input choice. Live listeners control their
  own listening; it requires an explicit input, so its selector starts empty,
  omits System default and keeps Start sharing disabled until a device is selected.
  Live requires an actual stereo input and timestamped capture;
  unsupported capture fails with a reason. No duplicate mono is advertised as
  stereo. Live listeners find the
  source in Home or Search, **Join**, adjust their own volume, and **Leave**;
  leaving does not stop sharing or affect another listener.
- **Live input selection** opens the chosen input in an isolated hidden browser
  capture page. This is an explicit input choice; a failed input never switches
  devices.
- **Playback buffer (ms)**, for Live, is each listener's Sendspin buffer; more
  rides out Wi-Fi and phone hiccups. Measured delay follows it closely but is a
  separate observation ([Live audio](../live-audio.md#measured-behavior)). It is
  the same Couch-wide setting as in the running share's panel.
- **Screens and windows** in the desktop app are small pictures with their
  names (`desktopCapturer` thumbnails, 320 × 200), for this computer's own
  Couch only: another Couch's page (Client mode) lists their names alone, as it
  would otherwise see a window's content before the owner allows it. A screen
  is chosen for you; a window waits for your choice. In a browser Screen and
  Window hand off to the browser's own picker, which opens on that surface and
  still offers the rest. System audio takes the first screen's capture for its
  sound in the desktop app, so Start sharing waits there until it lists one.
  Choices keep their whole thumbnail and name in narrow windows too; their
  height grows with the picture instead of using a fixed touch-button height.
  Screen and Window offer **Include system audio** on desktop, explaining that
  it includes everything the computer plays. Browsers say **Include audio** and
  ask the person to enable it in the browser's picker when offered.
- **Play on** lists every other online device that lets others use its screen
  or speakers, as chips. A device that can take nothing of this kind stays in
  place, disabled, and leaves the choice. Without a choice the share waits in
  Home's Shared sources, as it always has.
- **Start sharing** starts the capture, then plays it on the chosen devices in
  order: the first that takes it plays it, then each other joins the same
  playback. Closing the dialog while it starts cancels it, as Cancel does.
  Dismissing the Dialog or Sheet returns keyboard focus to its Share button while that button remains mounted.
- **Disabled keeps its place:** a browser that can't capture a display (a
  phone's) keeps Screen, Window and System audio disabled, with today's reason
  under the chips.

## While it runs

While sharing, the entry slot stays the same size and the **capsule** appears
in its own row below primary navigation and search: a silent picture of what goes out
(the capture's own video track; a white disc with its kind's glyph for sound),
the share's name, how many devices watch, and **Stop**, its one place (accessible
name: Stop sharing). The
name is the one Home, the Stage and the now-playing bar show ("Studio Mac ·
Screen"). It floats on the toasts' surface and shadow,
without the bar's filter, which stays the page's one backdrop filter
([Glass](../design.md#glass)). Its name truncates within the available width,
up to 20rem; preview, viewer count and the readable Stop action keep their
space on phones too. The full name remains in its hover title, accessible name
and panel. Sharing state, names, viewer counts and interface size never push
search onto another row. Search keeps its mounted field, query and focus while
sharing starts or stops. The measured header includes the capsule, keeping page
content, focus and the scrollbar track below it. When idle there is no capsule
row or reserved vertical space.
On desktop it stays left of the search palette, so suggestions never cover Stop.
Home and Search also omit a source’s type caption when its name already ends with that type.

Pressing it opens its panel, a Popover hanging from it on desktop and a bottom
Sheet on phones and the TV:

- The picture, the name, what it is when the name doesn't say it ("Window,
  with this computer's sound") and since when.
- **Who's watching**, one divided row per device the share plays on, from the
  playbacks that play it: its channels and its route, "Picture and sound,
  direct" or "Sound, through the relay" for WebRTC, read every two seconds from the
  publisher's own connection (the selected candidate pair in
  `RTCPeerConnection.getStats()`). PCM shares use Core's listener state without
  polling WebRTC routes. Where it plays names only exceptions; this
  panel is the sharer's own, so every row names its route. Behind and "Can't
  play: {reason}" (in red) read as Where it plays says them, and a row whose
  sound plays shows the [level](../design.md#motion), moving only where Where
  it plays' would (online, unmuted, above zero).
- **Picture**, changed live through `applyConstraints` on the captured track,
  without restarting it; **Mute audio input** turns the input's track off
  (`track.enabled`), keeping the capture and its connections.
- Live sharing reports the delivered rate and channels.
- One line about the relay only when a device is Behind: with no relay, that a
  relay can fix it, linking Devices & network; with one, that it couldn't
  connect even through it.
- **Where it plays**, while this window views the playback that plays the
  share. Stop sharing stays on the capsule.

### Live audio

A [Live audio](../live-audio.md) share lists listeners, each with a ⋯ **Remove**
action. Input mute remains. **Codec** offers Automatic, PCM and Opus using the SDK's public `codecs`
option; a change reconnects each listener's player. **Playback buffer (ms)** is
the SDK's `minBufferMs`, initially 200 ms. A larger buffer applies to the running
share at once; a smaller one applies when sharing restarts, which the panel says.
There are no latency estimates, gap counters or listener polling.

## When it doesn't work

- Capture refused by the system (macOS's Screen & System Audio Recording, or
  the microphone): the dialog says what to turn on in place of the pictures,
  with Open System Settings, and checks again when the window regains focus.
- Another window of this device already shares: the dialog says so and Start
  sharing waits.
- A receiver that can't play: its row says "Can't play: {reason}" in red.
- A timestamped input (Live audio, or relaxed Audio input) that stops
  delivering ends the share, with a toast saying why; listeners see the
  ordinary "{name} stopped sharing".
- The last viewer leaves or goes offline while the capture still runs: one
  toast, "Still sharing {name}, on no screens", with Stop sharing, this
  device's own like the rest. It leaves once a viewer returns or the share
  ends.
- A Play on device that can't take what was captured (Linux captures no system
  audio, so a speakers-only device takes nothing): Core's refusal shows as the
  page's error, and the share keeps playing where it can.

Live audio uses [unmodified Sendspin](../live-audio.md) for browser reception.
**Tap to hear** unlocks sound. Leaving releases this listener without ending
capture or interrupting other listeners. Actual source/output errors keep their
reason; the SDK handles receiver timing and recovery.

## Not yet

The built-in relay serves only the LAN, and pairing is LAN-only: inviting a
guest outside it needs a rendezvous, a guest identity scoped to one share and
a relay a guest can reach, none of which exist yet.
