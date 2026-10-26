# Where it plays

The mixer for one Couch's devices: where the Playback you control plays,
picture and sound, on one device or dozens. Its rules live in one module
without React,
[`src/client/session/where-it-plays.ts`](../../src/client/session/where-it-plays.ts),
with a unit test per rule in `tests/where-it-plays-rules.test.ts`.
Core remains the authority for delivery, consent and programme controls; the
picker presents its permitted actions. The [integration ledger](../player-modes-integration-ledger.md)
records validation status separately from these built behavior rules.

Rows are devices, one each (a device serves one Playback at a time); the host
is a device like the others, and its hardware (a display, a sound card, a
Bluetooth speaker) is chosen in Settings, not listed. The mixer has no header:
the bar or band it opens from already shows what plays. A row is quiet while
all is well and names only an exception. A control Core would refuse stays
visible, disabled, with its reason as its tooltip or at the end of its menu
item.

## The panel

**Where it plays** is its own icon button (`SlidersVertical`) in the
now-playing bar and the band, beside the separate Volume button. On
desktop it opens a Popover above the button, so the bar and the transport stay
usable, while the list fits (10 rows); a longer list opens a right-side Sheet
from the same button. Phones and the TV open a bottom Sheet sized to its
content. The kind is chosen as it opens and kept until it closes. A Sheet's
Close sits at the end of its first line. From the band or the bar its Popover
opens above the whole row, clear of the timeline, 32rem wide and ending at the
gutter, one of the tools' panels: over a picture on the player's translucent
surface, as the player's own menus are. Its rows scroll under the first line;
a Sheet's first line sticks on the Sheet's ground. Its Sheet is unchanged
([Player](player.md#the-picture)).

```
[mute] ──────────────●──  72
Picture 1, Sound 2
Compressor                  Advanced  ○
Living room TV      ▣  ♪  ───●───  40  …
Francesco's phone   ▢  ♪  ──────●  60  …
This device
─────────────────────────────────────
Kitchen laptop      ▢  ♪        Move here
Playing avoid radio
Offline: Garden, Anna's tablet
```

- **First line:** the Playback's [Volume](#volume), always. A shared source
  waiting for receivers says "Choose where {title} plays" instead.
- **[In sync](#in-sync)** where it applies.
- **Counts:** one muted line, zeros left out: Picture n, Sound n, In sync n,
  Behind n, Can't play n, Offline n, from what Core already sends.
- **Compressor:** the Playback's switch and Advanced disclosure, before its
  device rows, in the scrollable part of the panel.
- **Rows:** the devices playing this, then the rest after a plain hairline.
  Offline devices outside the Playback fold into one muted line that names
  each once, counting devices that share a name ("Offline: A, Living room
  TV ×4").
- **Many devices:** past 8 rows the counts become a filter (shadcn
  `ToggleGroup`, one at a time, pressed again to clear) and a search field,
  "Find a device", appears. Both stay at the top while the list scrolls.
  Filtering never reorders.

Rows keep their order while the panel is open: a device that joins or leaves
stays where it was, and a new device is appended. The order is taken afresh
the next time it opens.

`Mixer` in `sections/shell/Outputs.tsx` renders the content without hooks,
so the tests find its controls by label without a DOM; `WhereItPlays` holds
the open state, the order and the filters.

## Device rows

The same at every scale: the device's name, with the
[level](../design.md#motion) beside it while its sound is in the Playback
(moving while sound comes out of it, flat while paused, muted, behind, failing
or offline), then its **Picture** and
**Sound** toggles (`Monitor`/`MonitorOff`, `Volume2`/`VolumeOff`), its level
fader and number while its sound is on, and "…". On phones the fader takes a
second line under the name. A device is in the Playback while either channel
is on. While it is the only device sounding (and its fader would move), the
Volume above is its level, so its row has no fader of its own and the panel
doesn't say the same number twice (`soleSound`). The TV's rows keep theirs,
since each row is its own slider.

**Picture and Sound.** Each turns its own channel on or off. Picture is
enabled only when the media has a picture and the device shares its screen;
Sound when the media has sound and the device shares its speakers, and it
joins at the device's own level (50 if that is 0, since 0 would leave it
out). Turning off a device's last channel takes it out: each channel it plays
here goes, so each needs its consent. A device busy elsewhere moves here.
This device needs no consent.

**Move here** (Core's `solo`) transfers this Playback **and its queue exclusively**
to the row's destination, retaining position, pause state and speed where the
source supports them. Other outputs leave that Playback. On pointer layouts a
device outside the Playback shows the button where its fader would be; a playing
row's “…” keeps only Sync. On the TV, OK exposes Move here for any row where the
move changes the output set, including a device already in the Playback. The
sole output has no move unless a held publisher would otherwise return. Another
device's private output, including a held publisher's, can block the exclusive
move. Core rechecks consent and generation after asynchronous preparation.

**What it says,** under the name, only when it matters:

- "This device", muted, on this device's row, joined by a comma to any other;
- "Behind" while a live input reaches it through Couch's buffered stream;
- "Can't play: {Core's reason}" in destructive red when that stream failed;
- "Muted" while its sound plays here muted (muted elsewhere: turning its
  Sound on or moving its fader unmutes it);
- "Private" where its consent leaves you nothing to change;
- "Playing {title}" while it plays another Playback, which moving it
  interrupts;
- "Sharing this source" for a shared source's publisher, which never plays
  its own capture; "Can't play this channel" while only the host can; "Offline"
  for an offline device still in the Playback.

**Consent.** Every refusal Core makes shows as a disabled control with its
reason ("Private", "Offline", "No picture", "No sound", "Sharing this
source"). A private picture disables Picture for other devices, while its
shared sound keeps its Sound and fader. This device keeps its own
controls while viewing another Playback.

## Live audio

A Live audio audience sees its own volume and **Join/Leave** instead of the shared
mixer, compressor or programme controls. A failed listener shows its own error;
leaving never pauses other listeners or ends the source. Core rejects audience
queue, seek, Next, Stop and shared-pause commands through socket, REST and legacy
entry points. The publisher owns capture and **Stop sharing**; selecting or
joining its source grants reception only. Local device controls and a permitted
remote output remain separate from programme authority. Relaxed sources keep
collaborative controls.
While the listener's output gets ready, **Preparing audio…** appears as status.
Once ready, **Listening** follows actual playback and **Waiting for audio…**
remains visible when the source is buffering. Source and output failures keep
their reasons; no blanket leave-and-rejoin instruction is appended.

## Fader and Sync

The fader is the device's one volume; 0 takes its sound out.

"Sync … ms earlier" (0–500 ms) plays a late speaker sooner (Sendspin's static
delay). It applies while the device receives scheduled sound, including a
single listener of relaxed timestamped capture or AirPlay. It reads **Lip sync** while another device shows the picture. A row
shows its line only while it isn't 0; **Sync…** (or **Lip sync…**) in "…"
reveals it and moves focus to its slider; Back or Esc there, or closing the
panel, hides a line still at 0.

## The "…" menu

It holds only **Sync…** (or **Lip sync…**), so a row shows "…" only while Sync
applies. A row has no Mute: its Sound and fader are its sound, the Volume mutes.

## Volume

The first line is the band's Volume (`PlaybackVolume`, Mute and its fader):
one level for the whole Playback, its number in line with the rows'. It acts
on the sound you may control: it shows the loudest level that sound plays at
and moves it so the loudest reaches the new level, keeping their proportion.
Another device's private sound neither moves nor counts. At 0 the Volume
remembers the proportion, so raising it restores it. Its Mute mutes them all.
A legacy trim from older clients is folded into the device levels the first
time it moves.

## In sync

A relaxed captured screen, or an audio publisher without timestamped capture,
plays directly on each device unless In sync is on
([ADR 0001](../adr/0001-live-inputs-play-over-webrtc-unless-in-sync.md)).
Its switch sits under the Volume while the source plays on several devices,
or while it is on. Timestamped audio inputs and AirPlay always use scheduled
sound, including a single listener, so they have no In sync switch. Ordinary
picture-only groups retain a shared timeline without generating silent audio.

## The chooser

A shared source waiting for receivers opens Where it plays only in the window
that pressed Play (from Home, Search, Play on or Up next). **Ask every
device where a shared source plays**, in Settings → Playback, sends
the request to every window viewing that playback instead. Each new request
reopens it; dismissed, it stays closed through unrelated updates and when the
now-playing bar gives way to Now Playing, since the session remembers the
dismissal.

## On a TV

Each row is one focus stop (a horizontal `role="slider"`): Up and Down move
between rows, Left and Right change its level by 5 at once, with no OK to
take the arrows. OK opens its options: Picture, Sound, **Move here** where
permitted (including a playing row when other outputs would leave), and Sync….
Back closes the panel with focus back on its button. It opens on the first row.
A revealed Sync line is a stop of its own whose slider Left and Right move directly.

## Play on

**Play on** in item menus lists this device by name with "This device"
underneath, then the other online devices that share. The group is hidden
with only one eligible online target; the primary Play says "Play on
{name}" while you control another device, and a "Playing on {name}" toast
confirms it. The now-playing bar, the player's summary and Home's hero say
"on {name}" (+N) whenever the controlled Playback plays anywhere but only here.

Ordinary **Play** retains the selected output mix. Explicit **Play on** starts the
chosen item on that destination and separates it from other listeners, whose
Playback and queue continue. It does not transfer the group's queue. **Move here**
transfers the existing Playback exclusively; Picture/Sound toggles add or remove
channels in the existing Playback. The controller can stay separate from all
receivers.

For a captured source already playing in an accessible Playback, Play/Play on
joins that Playback; it does not make an independent capture. Choosing its
publisher opens the chooser because the publisher never monitors its own capture.
Joining Live audio retains its source authority and fixed scheduled delivery even
with one listener. Core chooses delivery from intent and channel assignments;
a TV picture and a separate speaker share a timeline even with only one speaker.

Its target rows in menus: [Browse](browse.md#play-on-in-menus).

## Switching servers

Switching servers returns to that controller's live output mix, or the
server's own outputs when the previous mix is gone, or this device when
those are offline. Ordinary Play keeps the mix; Where it plays and explicit
Play on choose where it plays. Core decides this
(`tests/server-selection.integration.ts`).

## Compressor

One **Compressor** switch, off by default, applies to ordinary media in this
Playback. It stays with the queue across restarts and output changes. It works
on a single Direct device, including Couch's Electron TV, and on In sync
sound. Device volume/mute remain after compression. Independent Playbacks keep
independent settings. Live Share and WebRTC are excluded, including buffered
live sharing; their switch is disabled with a reason. Disconnected controllers
and private Playbacks also show a disabled control. A playback error leaves
the switch available so disabling compression can retry the item.

**Advanced** is a flat shadcn Collapsible: Threshold (dB), Ratio (:1), Attack
(ms), Release (ms), Knee (dB), and Output gain (dB), each with a slider and
numeric input. Opening it sends nothing. Edits remain drafts until **Apply**
sends one patch; **Reset to default** fills the draft without changing the
switch. Invalid values disable Apply. A pending command disables edits, and a
failed command preserves the draft and shows an inline error. Closing the
mixer discards unapplied drafts. The TV remote can adjust sliders with
Left/Right and move between rows with Up/Down.

Defaults: −18 dB threshold, 3:1 ratio, 10 ms attack, 250 ms release, 9 dB knee,
0 dB output gain. This reduces dynamic range; it is not automatic loudness
normalization or a peak limiter. Browser automatic makeup cannot be disabled,
so Output gain trims its result. Browser and server compressors sound different
at identical settings.

Direct uses Web Audio without joining Sendspin. Enabling it for the first time
reloads the source at its current position/pause state with CORS-readable
URLs. A source that doesn't permit CORS uses Couch's signed byte relay, without
transcoding or Sendspin buffering. Further edits crossfade in the existing
graph. Turning it off crossfades to an aligned dry path, then disconnects the
compressor; enabling it disconnects the unused dry path after the crossfade.
Paused or ended playback suspends the audio context, and the next load with
compression off needs no audio graph. In sync changes clear buffered audio and restart
its existing FFmpeg at the current position (a brief rebuffer); Apply batches
edits to avoid restarting on every slider movement. mpv replaces its named
lavfi filter. There is no continuously polled meter.

[Research and implementation notes](../master-compressor-research.md) describe
the DSP, browser constraints and [performance measurements](../master-compressor-performance.md).
