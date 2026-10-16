# Where it plays

On a TV its faders take the arrows only after OK: [TV](tv.md#every-journey-step-works-with-a-remote).

## The Sheet

**Where it plays** is one icon button in the band and the mini player, a
mixer (`SlidersVertical`) with no Device name or DeviceIcon, so it can't be
mistaken for the header's Couch switch. It opens a bottom Sheet of divided
rows (`Item`).

## All

The first row, set off by a rule like a console's master
fader, is All: its fader trims only the selected speakers you may control from
100 (the Device levels) to 0 (silent), and the Playback keeps it across restarts.
Private speakers keep their own attenuation; new private sound and revoked
foreign influence return to their own level. Sharing audio again joins All. It
shows its own trim, preserves Device levels and mute, and keeps outputs
selected at zero so raising it restores their sound; it has no Picture, Only here
or Mute. Its label is "Selected sound you can control": shared sound and this
Device's own private sound.

## Device rows

Then one row per Device:
the Playback's Devices first (offline ones
dimmed, their controls disabled), then this Device and the other online
Devices that share audio or video, dimmed but operable when a move would not
replace a private channel. This Device is listed even when it shares neither,
so it can add itself here as well as with Play on → This device; another
Device that shares neither is listed only while it is an output. A row reads
the Device's icon, name and what it is doing, then Picture (pressed toggles
invert, because Toggle's muted pressed state barely shows on black), the
fader with its number, Mute and Only here (pressed, they invert too).

What a
Device is doing includes another Playback, with its status ("Paused
{title}"): moving a Device that is busy elsewhere interrupts that Playback,
so the row says so before you press. Joined outputs keep the current
Playback's factual status too; unused devices say "Not playing here".
Private picture/sound names the consent boundary and disables changes to
that channel for other devices; shared sound can still be muted beside a
private picture. This Device retains local controls even while viewing
another Playback; Only here still requires consent to replace the destination's
whole output. These statuses describe playback and consent, never whether
sound can be heard.

On phones controls wrap below name/status and Only here. Names and busy titles
wrap without ellipses; the Sheet scrolls vertically. On wider screens the
name/status, Picture, horizontal fader, number, Mute and Only here align in a row.
Its controls and slider tracks have at least a 44px target at the base scale.

## Fader and Sync

The fader is the Device's one volume while its sound is in, else 0: 0 turns
its sound off and raising it turns it on. Rows show saved levels
independently of All's trim. A row's "Sync … ms earlier" slider, shown under
its fader while its sound plays in sync with other devices, plays a late
speaker sooner (Sendspin's static delay); "Delay" read as the opposite, and
"Sync" keeps it apart from Playback's audio delay against the picture. With
one receiver there is nothing to align, so the row shows the saved value and
when it applies instead of a control that would do nothing.

## Only here

Only here
(formerly Solo) keeps the Playback only on that Device,
with its picture when the Playback has one, so moving a Playback is one
press. It is unavailable while another device's private output plays in it,
or a publisher's private output waits to return after its source, since that
output would stay; that row says Private.

A shared source waiting for
receivers opens Where it plays for each request to choose; dismissed, it
stays closed through unrelated updates and when the mini player gives way to
Now Playing, since the session, not the Sheet, remembers the dismissal. A pressed
Only here still commits, so a publisher held out for its source stays out.

## Band volume

The band and mini player volume shows the loudest in-sound Device's,
or 0 while All is at 0, and moves them all together (from All's 0, raising it
only brings All back to 100 and lowering it does nothing); their Mute mutes
them all, and so does M.

## Play on

**Play on** in item menus offers This device and the other online Devices
that share, hidden while this is the only one; the primary Play says "Play on
{name}" while you control another Device, and a "Playing on {name}" toast
confirms it. The mini player, the player's summary and Home's Now row say
"on {name}" (+N) whenever the controlled Playback plays anywhere but only here.

Its target rows in menus: [Browse](browse.md#play-on-targets-in-menus).

## Switching servers

Switching servers returns to that controller's live output mix, or the
server's own outputs when the previous mix is gone, or this Device when
those are offline. Ordinary Play keeps the
mix; Where it plays and explicit Play on choose where it plays.

## DeviceIcon

The lucide icon beside every Device's name in Where it plays'
rows, familiar like Spotify's device picker. Device icons stand only for Devices: Where it plays' opener is a mixer
icon and the "on {name}" status line is plain text. Picture and
sound: `MonitorSpeaker`; picture: `Monitor`; sound: `Volume`, `Volume1` or
`Volume2` by its volume (0, up to 50, above); muted: `VolumeX`. Idle, a plain
`Monitor` in muted ink; offline, dimmer still. `aria-hidden`. It replaced a
custom two-cell glyph that people couldn't read.
