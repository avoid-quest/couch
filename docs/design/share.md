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
Input                        [System default ▾]   Audio input and Live audio
                             Choose audio input
Play on                (Living room TV) (Kitchen)
Include this computer's sound               [on]   Screen and Window
Picture                     [1080p, balanced ▾]   Screen and Window
                              Cancel  [Start sharing]
```

- **What to share** is one row of chips, the chosen one checked
  (`shareKinds`). Each kind says how it captures: Screen and Window are a
  `screen` capture of a screen or a window, Sound only is `system-audio`, and
  Audio input is `microphone`, with the input choice. **Live audio** uses that
  same picker with live intent and appears only on the Couch computer in the
  desktop app. It requires an actual stereo input and timestamped capture;
  unsupported capture fails with a reason. No duplicate mono is advertised as
  stereo. Ordinary sharing keeps its relaxed controls. Live listeners find the
  source in Home or Search, **Join**, adjust their own volume, and **Leave**;
  leaving does not stop sharing or affect another listener.
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
  (`track.enabled`), keeping the capture and its connections.
- One line about the relay only when a device is Behind: with no relay, that a
  relay can fix it, linking Devices & network; with one, that it couldn't
  connect even through it.
- **Where it plays**, while this window views the playback that plays the
  share. Stop sharing stays on the capsule.

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

Live audio defaults to a 95 ms sender deadline and 5 ms Opus packets after runtime
decoder/clock/output checks. Runtime admission is not a measured promise of 100 ms input-to-ear or
synchronization on every output. While those checks run, the listener sees
**Preparing audio…**. An incompatible output reports its reason on that listener;
changing the output requires fresh admission. Normal preparation and recovery
do not require leaving and joining again. Live uses the saved browser output
buffering preference; preparation and admission still use the actual reported output
latency if the browser chooses another value. Startup checks timestamp rate over
at least 200 ms, keeping checks for stale timestamps and backward jumps on every
observation, so short timestamp variation need not prevent preparation. See the
[validation ledger](../audio-video-refactor-validation.md) and
[roundtrip measurements](../audio-roundtrip-performance.md).

Live corrects small playback-clock drift with bounded playback-rate changes,
preserving decoded buffers instead of inserting or deleting samples. Relaxed
playback retains its existing correction policy. This implementation still needs
electrical and continuous-fidelity validation; it is not an artifact-free guarantee.

## Not yet

The built-in relay serves only the LAN, and pairing is LAN-only: inviting a
guest outside it needs a rendezvous, a guest identity scoped to one share and
a relay a guest can reach, none of which exist yet.

Advanced Live audio settings are in [Settings](settings.md#advanced-audio).
New publications snapshot the saved host lead; existing publications keep their
deadlines and admission budget. The receiver reads its browser buffer preference
on the next join, without interrupting ongoing sound when the setting is saved.
On Mac builds with the native helper, Live audio input selection also offers
devices marked Native. The share panel shows requested and reported native
buffer frames, distinct from the first delivered block shown for browser input.
Native capture uses the same authorized Couch upload and network path; it still
needs physical qualification.
