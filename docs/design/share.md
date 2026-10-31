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
Capture buffer                   [128 frames ▾]   Native Live Audio input
Input channels                  [1/2, Stereo ▾]   Native input with >2 channels
Title                               [Optional]   Live Audio input
Now playing                         [Optional]   Live Audio input
Playback buffer floor (ms)               [150]    Live Audio input
Play on                (Living room TV) (Kitchen)
Include system audio                       [on]   desktop Screen and Window
Picture          [1080p, balanced ▾] [30 FPS ▾]   Screen and Window
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
  Live requires timestamped capture; browser inputs require actual stereo.
  Native inputs with more than two channels also offer individual mono inputs.
  Unsupported capture fails with a reason. Live listeners find the
  source in Home or Search, **Join**, adjust their own volume, and **Leave**;
  leaving does not stop sharing or affect another listener.
- **Live input selection** includes devices marked Native on Mac builds with the
  capture helper. Other input IDs use an isolated hidden browser capture page.
  This is an explicit input choice; a failed native input never switches devices.
  Main requests microphone permission before opening the selected native input.
- **Capture buffer** and **Input channels** are remembered on this desktop.
  Native inputs with more than two channels offer stereo pairs (1/2, 3/4, …)
  and each individual channel as Mono. The initial choice is 1/2; a saved
  choice unavailable on a different input also shows 1/2. Inputs with two or
  fewer channels keep their existing behavior and have no channel selector.
- **Playback buffer floor (ms)**, for Live, is the minimum every listener
  declares; 0 removes the host floor. Each listener can request more for its
  output latency, with a fixed allowance ([Live audio](../live-audio.md#timing)).
  It is the same Couch-wide setting as in the running share's panel.
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
  Refresh screens or Refresh windows reads the choices again without closing
  Share, keeping a selected source while it is still available. The choices
  and Start sharing wait during the read; a failed read keeps Refresh available
  for retry. A disappeared window requires a new choice.
- **Play on** lists every other online device that lets others use its screen
  or speakers, as chips. A device that can take nothing of this kind stays in
  place, disabled, and leaves the choice. Without a choice the share waits in
  Home's Shared sources, as it always has.
- **Start sharing** starts the capture, then plays it on the chosen devices in
  order: the first that takes it plays it, then each other joins the same
  playback. Closing the dialog while it starts cancels it, as Cancel does.
  Live waits for its audio settings to load and finish saving. Invalid buffer
  values prevent starting; settings failures appear inline.
  Dismissing the Dialog or Sheet returns keyboard focus to its Share button while that button remains mounted.
- **Picture** chooses the largest resolution and, beside it, the frame rate:
  30, 60 or 120 FPS, 30 by default. Its tooltip identifies the rate as a target:
  the most frames a second capture asks for. The screen and encoder may deliver fewer. System audio and
  Audio input have no picture, so no Picture row.
- **Disabled keeps its place:** a browser that can't capture a display (a
  phone's) keeps Screen, Window and System audio disabled, with today's reason
  under the chips.

## While it runs

While sharing, the entry slot stays the same size and the **capsule** appears
in its own row below primary navigation and search: a silent picture of what goes out
(the capture's own video track; a white disc with its kind's glyph for sound),
the share's name, how many devices watch (0 included, so a capture that
reaches nobody says so), and **Stop**, its one place (accessible
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
- **Picture**, its resolution and frame rate (30, 60 or 120 FPS, 30 by default)
  side by side, changed live through `applyConstraints` on the captured track,
  without restarting it; the frame rate is the most the picture asks for, which a
  screen or encoder may not reach; **Mute audio input** turns the input's track off
  (`track.enabled`), keeping the capture and its connections. Native input mute
  sends zero samples while preserving the source clock.
- Live sharing reports the delivered rate and channels, and a native input's
  device buffer when it differs from the requested **Capture buffer**.
- One line about the relay only when a device is Behind: with no relay, that a
  relay can fix it, linking Devices & network; with one, that it couldn't
  connect even through it.
- **Where it plays**, while this window views the playback that plays the
  share. Stop sharing stays on the capsule.

### Live audio

A Live share can have a **Title** and a **Now playing** line, each optional and
up to 200 characters. Share sends them with the publication. The running panel
keeps the same flat, labelled inputs and **Save details**; errors appear inline
without discarding the draft. Only the capturing window can edit them. Clearing
the title restores the device/input name; clearing the line removes it.
The capsule, Home, Search and player use the title. The player and minimized bar
show the line beneath it. The panel shows **Live · 1:02:13** from Core's share
start time, unchanged by input restarts, joins or reconnects.

A [Live audio](../live-audio.md) share lists listeners, each with a ⋯ **Remove**
action. Removing a listener leaves focus in the listener list; failures read in
red and are announced. An empty list says **No listeners yet**. The capsule
counts listeners; Live has no Where it plays link in its host panel.
Input mute remains. Native inputs keep **Capture buffer** (128, 256, 512
or 1024 frames), the input's callback size. **Input channels** has the same
stereo pairs and mono choices as the Share dialog on inputs with more than two
channels. Either change restarts capture; listeners resume in a fresh audio
generation and input mute is preserved. **Restarting audio input…** announces
the wait, then the selected size or channels and delivered format update
together. Mono is reported as Mono in the capture format. **Codec** offers
Automatic, PCM and Opus using the SDK's public `codecs`
option; a change reconnects each listener's player. **Playback buffer floor
(ms)** starts at 150 ms; 0 removes the host floor. A larger floor applies at once;
restart sharing to reduce the shared lead. Listeners keep their largest
declaration during a Join and raise it only in 25 ms steps, since each raise
briefly gaps every listener. One muted line shows **Shared lead: 200 ms · set by
Phone**, from Core's actual timeline including static delay. It retains the
Receiver's name after Leave, or says **a previous listener** if that Device is
gone. This is a scheduling lead, not an input-to-ear latency estimate. There are
no gap counters or host polling of listeners.
Settings retain their labelled controls while loading, report errors inline,
and offer Try again after a failed read. Playback buffer accepts whole numbers
from 0 to 5000, saved on blur or Enter; invalid edits show a reason. Controls
wrap onto a second line on narrow screens and disable while disconnected.
Saving or restarting prevents another edit while keeping keyboard focus on
the control that started it.

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
  ends. Live audio says "Still sharing {name}, with no listeners".
- A Play on device that can't take what was captured (Linux captures no system
  audio, so a speakers-only device takes nothing): Core's refusal shows as the
  page's error, and the share keeps playing where it can.

Live audio uses [unmodified Sendspin](../live-audio.md) for browser reception.
While joined, system media controls show the Live title (or Source name) and
Now playing line where supported, as playing;
listeners get no media commands: Play, Pause and Stop do nothing (an
unhandled Pause would pause only the SDK's silent Android keep-alive element
while the sound plays on), and there are no seek or next actions. Leave is in
Couch. Leaving restores ordinary playback's metadata and
controls, or clears them when idle. Replacing the SDK player for a codec change
keeps them.
**Tap to hear** unlocks sound. Leaving releases this listener without ending
capture or interrupting other listeners. Actual source/output errors keep their
reason; the SDK handles receiver timing and recovery.
If enabling sound fails, its reason is shown and Tap to hear remains available
to retry. A late failure after leaving cannot restore the prompt.

## Not yet

The built-in relay serves only the LAN, and pairing is LAN-only: inviting a
guest outside it needs a rendezvous, a guest identity scoped to one share and
a relay a guest can reach, none of which exist yet.
