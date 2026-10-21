# Where it plays

The mixer for one Couch's devices: where the Playback you control plays,
picture and sound, on one device or dozens. Its rules live in one module
without React,
[`src/client/session/where-it-plays.ts`](../../src/client/session/where-it-plays.ts),
with a unit test per rule in `tests/where-it-plays-rules.test.ts`.

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
Picture 1 · Sound 2
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
- **Counts:** one muted line, zeros left out: Picture n · Sound n · In sync n ·
  Behind n · Can't play n · Offline n, from what Core already sends.
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

**Move here** (Core's `solo`): the Playback plays only on that device, with
its picture when it has one. A device not playing this shows it where the
level would be; a device already playing it never offers it. It isn't offered for the only
output, where it would change nothing, unless a publisher held out for its
own capture would return after it. It is unavailable while another device's
private output plays in the Playback, or such a publisher waits to return.

**What it says,** under the name, only when it matters:

- "This device", muted, on this device's row, joined by " · " to any other;
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

## Fader and Sync

The fader is the device's one volume; 0 takes its sound out.

"Sync … ms earlier" (0–500 ms) plays a late speaker sooner (Sendspin's static
delay). It applies only while the device's sound plays in sync with other
devices. It reads **Lip sync** while another device shows the picture. A row
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

A live input plays directly on each device unless In sync is on
([ADR 0001](../adr/0001-live-inputs-play-over-webrtc-unless-in-sync.md)).
Its switch sits under the Volume while the source plays on several devices,
or while it is on.

## The chooser

A shared source waiting for receivers opens Where it plays only in the window
that pressed Play (from Discover, Search, Play on or Up next). **Ask every
device where a shared source plays**, in Settings → Playback, sends
the request to every window viewing that playback instead. Each new request
reopens it; dismissed, it stays closed through unrelated updates and when the
now-playing bar gives way to Now Playing, since the session remembers the
dismissal.

## On a TV

Each row is one focus stop (a horizontal `role="slider"`): Up and Down move
between rows, Left and Right change its level by 5 at once, with no OK to
take the arrows. OK opens its options: Picture, Sound and Sync…. Back closes the panel with focus back on its button. It opens on the
first row. A revealed Sync line is a stop of its own whose slider Left and
Right move directly.

## Play on

**Play on** in item menus lists this device by name with "This device"
underneath, then the other online devices that share. The group is hidden
with only one eligible online target; the primary Play says "Play on
{name}" while you control another device, and a "Playing on {name}" toast
confirms it. The now-playing bar, the player's summary and Home's hero say
"on {name}" (+N) whenever the controlled Playback plays anywhere but only here.

Its target rows in menus: [Browse](browse.md#play-on-in-menus).

## Switching servers

Switching servers returns to that controller's live output mix, or the
server's own outputs when the previous mix is gone, or this device when
those are offline. Ordinary Play keeps the mix; Where it plays and explicit
Play on choose where it plays. Core decides this
(`tests/server-selection.integration.ts`).
