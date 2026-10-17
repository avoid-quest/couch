# Where it plays

One surface: the picker, a Sheet for the Playback you control, and the one
place to choose where it plays. Its rules live in one module without React,
[`src/client/session/where-it-plays.ts`](../../src/client/session/where-it-plays.ts),
with a unit test per rule in `tests/where-it-plays-rules.test.ts`. On a TV its
faders take the arrows only after OK: [TV](tv.md#every-journey-step-works-with-a-remote).

## Principles

People never wonder whether a word names a device, a group or a place.

- **Only devices have names.** A Playback has no name: Couch shows it by its
  artwork and title, and text refers to it by its title ("Playing avoid
  radio"). Couch never asks anyone to name or group anything, and Where it
  plays never says zone, group, room, speaker or Playback.
- **One device, one row.** The picker lists every paired device once, since
  Core lets a device serve one Playback at a time.
- **This device keeps its name.** Its status line starts with "This device".
- **The host is just a device.** The Couch and its host share one name, which
  appears only where you choose which Couch to use (the Couch switch and Couch
  connection), never in Where it plays.
- **Hardware is not a device.** An HDMI display, a sound card or a Bluetooth
  speaker is part of its device, chosen in Settings → The Couch → Hardware and
  never listed beside devices.
- **One level for the whole Playback.** The band's Volume and the picker's top
  fader are one control, with each device's fader below it. No hidden level
  silences sound ([Volume](#volume)).
- **Show what you can't change.** A device you can't change stays listed and
  dimmed, its check disabled, with a one-word status. No explanatory
  paragraphs: the picker has at most one hint line.

## The picker

**Where it plays** is one icon button in the band and the now-playing bar, a
mixer (`SlidersVertical`) with no device name or DeviceIcon, so it can't be
mistaken for the header's Couch switch. It opens a bottom Sheet:

```
[art] Montalbano
      Playing
[mute] ──────────────●──  72
─────────────────────────────────────
◉ ▣ Living room TV       ───●───  40  …
    Picture and sound
    Sync 40 ms earlier   ──●─────
◉ ▣ Francesco's phone    ──────●  60  …
    This device · Sound
─────────────────────────────────────

Other devices
─────────────────────────────────────
○ ▣ Kitchen laptop
    Playing avoid radio
○ ▣ Garden
    Not playing
○ ▣ Anna's tablet
    Offline
─────────────────────────────────────
```

- **Its header** is the Playback's artwork, title and status ("Choose where
  it plays" while a shared source waits for receivers).
- **Its levels:** the [Volume](#volume), then [In sync](#in-sync) where it
  applies. On the TV the fader hint, "Press OK to adjust a level, then OK or
  Back to finish.", follows them, where the faders start; it is the Sheet's
  one hint line, and elsewhere it has none.
- **The devices it plays on,** each with its fader and "…", and
  [Sync](#fader-and-sync) under the fader where it means something.
- **Other devices,** under that one heading, each saying what it plays now
  ("Playing avoid radio", "Not playing", "Offline"), offline ones last. The
  heading shows only beside devices it plays on, so a long list still shows
  where the faders end; a shared source waiting for receivers lists every
  device without it.

Core lets a window act only on the Playback it controls (`control` targets
only TVs), so a check always means "in this playback": checking a device
that plays something else moves it here, which its status names before you
press.

It replaced an overview page, `/where-it-plays`, that grouped every device
under the Playback it played. Its address now opens Home, for bookmarks. The
picker kept its Sync, in each in-sync row; the rest was left out:

- each other Playback's artwork and end time, since a row's status already
  names what that device plays;
- a link to Settings → This device → Sharing, since each device gives its
  own consent on itself, and this device needs none to play here;
- the list while nothing plays, since there is then no Playback to add a
  device to, and no now-playing bar to open it from.

`deviceRow` in `sections/shell/Outputs.tsx` renders each row, and the picker
is called without hooks, so the integration tests find its controls by label
without a DOM.

## Volume

The first row is the band's Volume (`PlaybackVolume`, Mute and its fader):
one level for the whole Playback, with each device's fader below it, its
number in the same column and read the same way, without "%". It acts on the
Playback's sound that you may control: it shows the loudest level that sound
plays at and moves it so the loudest reaches the new level, keeping their
proportion. Another device's private sound neither moves nor counts, so it
never holds the Volume above where you set it; with only private sound, the
Volume shows its level and can't change it. At 0 each device's fader reads 0,
and the Volume remembers their proportion, so raising it again restores it
rather than levelling them. Its Mute mutes them all and reads muted when they
all are, and so does M.

Couch had two group levels: this Volume, which scaled device levels, and
All, a stored trim that kept them. The Volume stays because it needs fewer
exceptions: on a TV it is the system volume the remote's keys move, and with
one device it is that device's level, where a trim could never go above it.
All's trim survives only from older clients and saved Playbacks, so it is
never a hidden level: the Volume shows the level sound plays at with the trim
included, and moving it folds the trim into the device levels you may
control (from a trim at 0, keeping their proportion). Another device's
private sound keeps its own attenuation, as All always left it.

## Device rows

Every device is listed once: the Playback's devices first, then the others
under Other devices, offline ones last. A row is a check (in or out), the
DeviceIcon, the device's name and a one-line status; while the device is in,
its fader with its number and a "…" menu follow, with Sync under the fader
where it means something. The check is a filled circle with a check
while the device is in and its empty outline while it is out, so a row reads
as a device you can add, as AirPlay's list does; a focused row inverts like
every control, checked or not.

**The check.** Pressing the row adds the device with picture and sound, as
its consent and the media allow: picture only where it shares its screen and
the media has one, sound only where it shares its speakers and the media has
it, at its own level (50 if that is 0, since 0 would leave its sound out). A
device busy elsewhere moves here. Pressing it again takes out each channel it
plays here. This device needs no consent to add itself.

**What it says,** in this order:

- "Offline", or "Sharing this source" for a shared source's publisher, which
  never plays its own capture;
- in: "Can't play" when its buffered stream failed, "Private" when you may
  not take one of its channels out, "Buffered", or what it plays here:
  "Picture and sound", "Sound", "Picture", "Muted", "Picture, muted", or "No
  picture" for a picture output on media without one. A channel the media
  lacks plays nothing: on a live input without sound, a device that chose
  sound reads "Picture", or "No sound" without a picture, its fader at 0;
- out: "Can't play this channel" while only the host can play it, "Private"
  when it shares no channel the media uses or plays privately elsewhere, the
  other Playback's status and title ("Playing Montalbano", "Not playing" once
  it has stopped), or "Not playing".

This device's starts "This device · ". Statuses describe playback and
consent, never whether sound can be heard; a busy device names what it plays
before you press, because moving it interrupts that.

**Consent.** Every refusal Core makes shows as a disabled control with its
reason: the check by its status, a menu item by a word at its end
("Private", "Offline", "No picture", "No sound", "Sharing this source"). A
private picture disables Picture for other devices, and its shared sound
still takes the fader and Mute. This device keeps its own controls while
viewing another Playback.

## Fader and Sync

The fader is the device's one volume while its sound is in, else 0 (its
number reads "–"): 0 takes its sound out and raising it puts it in.

"Sync … ms earlier" plays a late speaker sooner (Sendspin's static delay).
It applies only while the device's sound plays in sync with other devices,
and few people touch it, so a row shows its Sync line only while its delay
isn't 0. Otherwise **Sync…** in the row's "…", there while Sync applies,
reveals the line and moves focus to its slider; Back or Esc on the slider,
or closing the Sheet, hides it again while the delay is still 0. That
reveal is the open Sheet's own state, not Core's. The line is part of the
row's own grid (CSS subgrid): its words under the status, its slider under
the fader and as long, so the row still reads as one device. On phones it
takes its own line, words then slider.
"Delay" read as the opposite, and "Sync" keeps it apart from Playback's
audio delay against the picture.

## The "…" menu

**Picture**, **Mute** and **Only here**, each a checked item, then
**Sync…** while Sync applies ([Fader and Sync](#fader-and-sync)). Only here
(formerly Solo) keeps the Playback only on that device, with its picture
when the Playback has one. It is unavailable while another device's private
output plays in it, or a publisher's private output waits to return after
its source, since that output would stay. Pressed again it still commits, so
a publisher held out for its source stays out.

## In sync

A live input plays directly on each device unless In sync is on
([ADR 0001](../adr/0001-live-inputs-play-over-webrtc-unless-in-sync.md)).
Its switch sits under the Volume while the source plays on several devices,
or while it is on.

## The chooser

A shared source waiting for receivers opens Where it plays for each request
to choose; dismissed, it stays closed through unrelated updates and when the
now-playing bar gives way to Now Playing, since the session, not the Sheet,
remembers the dismissal. Play on a source's publisher while the source plays
opens it only in the window that asked.

## On a TV and on phones

On a TV a row's check is its focus stop; Up and Down move between rows,
past the Other devices heading. Right reaches the fader, which takes the
arrows only after OK, then "…"; Down from the fader reaches its Sync line
when it shows. Sync… in "…" puts focus on that line's slider, a fader like
the others: OK hands it the arrows and Back ends that; Back again hides a
line still at 0, with focus back on "…". The Sheet opens on the first device
you can choose, Up from the first row reaches the Volume, and Back closes it
with focus back on its button.

On phones the fader and number take a line below the name, with "…" beside
the name. Names and titles wrap without ellipses, and the Sheet scrolls. Its
controls and slider tracks have at least a 44px target at the base scale.

The check is a shadcn `Button` with `role="checkbox"` and lucide's
`CircleCheck` or `Circle`, not the catalog's `Checkbox`: that is a 16px box,
and the TV needs the whole name and status as one focus stop that inverts
like every other. The menu's checked items are
the catalog's `DropdownMenuCheckboxItem`.

## Play on

**Play on** in item menus offers This device and the other online devices
that share, hidden while this is the only one; the primary Play says "Play on
{name}" while you control another device, and a "Playing on {name}" toast
confirms it. The now-playing bar, the player's summary and Home's hero say
"on {name}" (+N) whenever the controlled Playback plays anywhere but only here.

Its target rows in menus: [Browse](browse.md#play-on-targets-in-menus).

## Switching servers

Switching servers returns to that controller's live output mix, or the
server's own outputs when the previous mix is gone, or this device when
those are offline. Ordinary Play keeps the mix; Where it plays and explicit
Play on choose where it plays. Core decides this
(`tests/server-selection.integration.ts`).

## DeviceIcon

The lucide icon beside every device's name in Where it plays' rows, familiar
like Spotify's device picker. Device icons stand only for devices: Where it
plays' opener is a mixer icon and the "on {name}" status line is plain text.
Picture and sound: `MonitorSpeaker`; picture: `Monitor`; sound: `Volume`,
`Volume1` or `Volume2` by its volume (0, up to 50, above); muted: `VolumeX`.
Media without a picture shows no picture, and without sound, no sound. Idle,
a plain `Monitor` in muted ink; offline, dimmer still. `aria-hidden`. It
replaced a custom two-cell glyph that people couldn't read.
