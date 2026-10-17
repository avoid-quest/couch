# Player

When the player opens: [Shell](shell.md#a-picture-you-start-opens-the-player).
On a TV: [TV](tv.md#the-tv-player-answers-a-remote).

## The player is one tap away

The now-playing bar opens the player through its
artwork and title ([Shell](shell.md#now-playing-bar)). The bar and the player band hold one control
order: Play/Pause, Stop and Next, the timeline, volume, Where it plays and Up
next, then in the band Playback settings (a
gear; Audio & subtitles lives inside) and, on desktop and phones, fullscreen,
which their window can leave and the TV's never does; the band's
timeline takes its own row above. On phones the bar keeps Play/Pause and
Where it plays. Every control there is an icon with an
`aria-label` and a matching `title` tooltip, never visible text.

### Transport

The transport is Play/Pause, Stop and Next wherever it appears: the band, the
now-playing bar, Home's hero and the Remote. Each keeps its slot for every
kind of media: live media that can't pause keeps Pause, disabled, and Stop is
enabled whenever something is loading, playing, paused, ended or failed.
Stop clears the sequence and offers Undo; it lives in the transport, never
only in a Sheet. The keyboard and the timeline seek.

### Volume and timeline

Volume is a speaker icon that opens its slider and Mute in a Popover. A
timeline shows only where it means something: seekable media, or media with
a length it will seek through once loaded. Live media that can't seek shows
no bar, no position and no total, just "Live" in the timeline's slot.

The player says when it ends once on screen: the top band over a video, or
Now playing's departures line, reads "ends 21:42" (or "Live", with no end
time), so the band's timeline keeps only its position and the time remaining
("−3:24"), and live media leaves its slot empty. `useEndTime` is that line,
in clock time.

Volume across several Devices: [Where it plays](where-it-plays.md#volume).

### Layout

Audio and remote playback place contained artwork beside a persistent
desktop queue. On phones, Up next replaces the artwork while transport stays
available. Video uses the full viewport until Up next opens beside it; then the picture is letterboxed, never cropped.
On phones, Up next replaces the picture too. The top band publishes its
height as `--player-top`, and toasts sit below it. Opened over a video, Up
next and the picture start below it too, as it turns solid.
Queue navigation survives playback changes; track-specific settings reset.
Transport, volume and tools share one bottom dock across media modes. Keep
unavailable controls in their slots so loading and queue changes preserve
muscle memory (the live timeline is the exception: it gives way to "Live",
which the player says in its top band or Now playing);
adapt the rows to screen width, with content above the dock.

### Now playing echoes Home's hero

Audio (and media playing elsewhere) shows Now playing as
[Home's hero](home.md#the-hero) does, stacked: the artwork contained at its own
aspect ratio on black, set down on the copy below it (the box hugs the image up
to a square, and short screens shrink it whole, never cropping it); the title
at display size; one muted meta line, which reads the show's station, else the
subtitle, else the source ("Radio" for a station), then Paused, Finished or
where it plays ("on Kitchen +1"); then the departures line ("ends 21:42" or
"Live") in tabular figures, the largest text after the title. A station's
current track follows in muted ink.

### Controls over the picture

Audio keeps its solid controls visible. Over a video, two bands show and hide
together, like a media centre's on-screen display: the band at the bottom, and
a top band. The top band holds, at the left, the title (wrapping to two lines
before it truncates) and the subtitle (series, episode, channel or source) in
muted ink, and at the right the clock and the end time, with no collection
trail, Couch switch or Details button: Details is in the Playback sheet. Each
of its two rows sizes itself, so a narrow screen gives the title all but the
clock. Paused shows a large Pause glyph and "Paused" over the picture, which
reads from the sofa.

Both bands are an overlay on the picture: one transparent black scrim,
mirrored, eased so it has no edge that reads as a crop. It rises over `--fade`
(2.5rem, 1.25rem on short screens) to 55% where their text starts, enough for
white text on a white picture, and to 72% at the screen's edge, so the picture
shows through the whole band. Their muted ink is the white ink made
translucent: the same #a3a3a3 over black, lighter over a bright picture. The
scrim preserves the picture bounds. Hidden bands are inert and
let pointer input reach the video. The player fits the
viewport at every interface size. Plain playback glyphs keep artwork central;
Playback settings use Sheets. Stage CSS handles native video bounds
and the responsive queue workspace; controls reuse shadcn components.

Subtitles, the video's own text tracks, rise clear of the band while it shows
and settle back as it hides, moving in step with its 0.2 s fade (at once with
reduced motion). CSS moves the cue box
(`video::-webkit-media-text-track-container`) up by the band's height,
`--bottom-bar`, while the band is `data-player-band="shown"`; the cues keep the
places their file gives them. Chromium (the TV and desktop apps) and WebKit
expose that box; Firefox doesn't, so there subtitles stay put under the band.
A cue placed at the top moves up too, where the top band would cover it
anyway.

### The picture holds the keys

On desktop and phones the player opens focused on its picture, as YouTube's
does, so a key is a shortcut at once
([Shell](shell.md#keyboard-control-stays-inside-couch)). The picture is one
focus target covering the stage (`data-player-surface`, `tabindex="-1"`,
named "Player: {title}"), for video and for audio Now playing alike. Focus
returns to it whenever the player opens: from the now-playing bar, Home, the
P key or a picture that starts; Back from Details still restores its opener,
Playback. A key on the picture shows the controls for a while and leaves focus
where it is; over a playing video they hide after 4 s while focus is on the
picture, and stay up while the keyboard is in them or on a toast's action,
which Back leaves for the control it came from.

- **A click** on a video plays or pauses; on audio Now playing it does
  nothing, so a stray click never stops the music. **A double-click**
  toggles fullscreen and leaves play as it was.
- **A pointer click in the band** does its job, then returns focus to the
  picture, so the next key is a shortcut again; a click that opens something
  (Volume, Where it plays, Playback, Up next) leaves focus there. A keyboard's
  Enter or Space keeps focus where the keyboard put it.
- **Tab** from the picture shows the controls and enters them in their order:
  the top band's Back, then the timeline and the band. Escape behaves as
  [Back on desktop and phones](#back-on-desktop-and-phones) says.
- **On phones**, a tap shows or hides the controls; it never plays or pauses.

The TV's player opens on the transport instead, for its remote
([TV](tv.md#the-tv-player-answers-a-remote)).

## Back on desktop and phones

A pointer has no Back key, so desktop and phones lead the top band with a Back
arrow ("Back to {section}", or "Back to Remote" for a Remote's player): before
the title over a video, and leading the band over artwork, where the TV
shows no top band unless this device shares. It returns to the page that
opened the player, as Escape and a remote's Back do. A Remote's player keeps
its TV's status beside it.

The player's transient Buffering status has its own row above the transport.

## Stop sharing stays on screen

While this device shares its screen or sound, the player's top band keeps
"Sharing {screen}" and Stop sharing at its right, as the header does while
browsing ([Live inputs](../live-inputs.md)): just before the clock over a
video, and at the end of the band's row over artwork, where the TV then shows
a top band too. Phones keep only Stop sharing, as in the header. While it
shares, the bands don't hide on their own; a TV's Back still hides them, and
OK shows them again.

## Up next is a deliberate list

Keep Playing separate and Played collapsed.
Compact artwork rows are one target that plays the entry, with one menu for
Details, Play next, ordering, Save for later and Remove: the row's context menu
on desktop and phones, and on the TV a "…" beside the title, since an entry's
page holds only Play and Save ([Browse](browse.md#mediarow--medialist)).
Removal leaves focus on the adjacent row, so a keyboard keeps editing: on its
"…" on the TV, else on the row itself. Save as list asks for a name and
preserves errors there for retry. shadcn/Radix menus supply keyboard
navigation and typeahead.

Autoplay is a
separate preview with a profile switch, continuing only the current series,
album or playlist. Explicit queue entries play first. Stop clears the
sequence; its end never starts recommendations.
