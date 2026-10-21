# Player

The player is `/now` (`PlayerPage`). When it opens by itself:
[Shell](shell.md#a-picture-you-start-opens-the-player). On a TV:
[TV](tv.md#the-tv-player).

## The band

The band at the bottom and the now-playing bar share one grid, so nothing
changes side as the bar grows into the band: what plays at the left (empty in
the band, where the title is on the stage or in the top band), Play/Pause,
Stop and Next centred, and the tools at the right in one order: Volume, Where
it plays, Up next, then Playback (a gear opening the Playback Sheet, with
Audio & subtitles and Details) and, on desktop and phones over a picture,
fullscreen. The timeline sits above the row. Narrow phones, without room to
centre the transport, lead with it. Every control is an icon with an
`aria-label` and matching `title`. Up next shows only where it has something
to open; on wide screens audio keeps the queue beside the artwork instead.

### Transport

Play/Pause, Stop and Next, the same ghost icons wherever they appear: the
band, the now-playing bar, Home's hero and Remote (`PlaybackTransport`). Each
keeps its slot: live media that can't pause keeps Pause disabled; Stop is
enabled whenever something is loaded or failed, clears the sequence and offers
Undo. After a failure Play becomes Try again; at the end, Replay.

### Timeline and volume

`PlaybackTimeline` shows only for seekable media, or media with a length:
position and time remaining ("−3:24"). Live media that can't seek shows
nothing. The end time ("ends 21:42", `useEndTime`) is said once, in the top
band or Now playing's metadata. A hovering pointer reads the time under it
above the bar. Volume is a speaker icon opening its slider and Mute in a
Popover; across several devices: [Where it plays](where-it-plays.md#volume).

## Stage

Video fills the viewport and never moves or resizes for a panel: Up next, the
Playback Sheet, Volume and Where it plays lie over it. Up next is a solid
column at the right under the top band, edge to edge between the bands on
phones. Audio and media playing elsewhere show **Now
playing** as Home's hero does: contained artwork, the title, a meta line (the
station, else subtitle, else source, then "on Kitchen +1"), the end time, and
a station's current track. On desktop the queue sits beside it; on phones Up
next replaces the artwork. The band includes the phone's safe-area inset.

### Controls over the picture

Over a video, two bands show and hide together: the bottom band and a top band
with the title (opening Details), its subtitle and relationship links at the
left, and the end time (and, on the TV, the clock) at the right. Both shade the
picture with one eased black scrim (to 60% where text starts, 72% at the edge);
their muted ink is white at 85%. Hidden bands are inert. Subtitles rise above
the band while it shows (`video::-webkit-media-text-track-container`, moved by
`--bottom-bar`; Firefox doesn't expose it). The top band publishes
`--player-top`; toasts sit below it.

Over a playing video the bands hide 4 s after the last key while focus is on
the picture; they stay during recovery and while the keyboard is in them.

### The picture holds the keys

On desktop and phones the player opens focused on its picture
(`data-player-surface`, `tabindex="-1"`, "Player: {title}"), so keys are
shortcuts at once ([Shell](shell.md#keyboard)). A key shows the controls and
leaves focus there. A click on video plays or pauses (on audio, nothing); a
double-click toggles fullscreen; a pointer click in the band returns focus to
the picture unless it opened a panel; Tab enters the controls; on phones a tap
shows or hides them.

### Back on desktop and phones

A pointer has no Back key, so the top band leads with a Back arrow ("Back to
{section}", or "Back to Remote"), returning to the page that opened the
player, as Esc does. The TV has none.

## Status and recovery

One status row above the timeline, only when it says something the transport
doesn't: Loading…, Buffering…, Reconnecting…, Finished, Can't play, Player
unavailable, Offline, with detail (`playbackStatus`). Artwork and title stay
during loading and failure. Unavailable playback offers Choose device (Where
it plays). Next stays available while another entry exists.

## Stop sharing

While this device shares its screen or sound, the top band keeps "Sharing
{screen}" and Stop sharing at its right ([Live inputs](../live-inputs.md)), and
the bands don't hide on their own.

## Up next

`QueuePanel`: a Sheet over the player (its heading row holds the title, the
Autoplay switch and Close), or beside the stage on wide screens.

- **Playing** heads the list only where the player's title is off screen.
- **Upcoming rows** are board lines: the title heavy, the start time light at
  the same size at the row's end, meta with length and "added by {device}"
  when another device queued it. A row is one target that plays it; its "…"
  holds Details, Play next, ordering, Save for later, Open in browser and
  Remove. Removal keeps focus on the adjacent row.
- A status line counts the rows and says when they end ("2 to play · until
  17:05"), with **Save as list**.
- **Autoplay** continues only the current series, album or playlist, after the
  queued rows: "Then from {context}" and up to ten of its upcoming entries as
  quieter, display-only rows whose start times continue the board, or
  "Finding the next item…". The Autoplay switch shows in the heading row only
  while something can continue; Settings → Playback always holds it.
- Empty: "Nothing queued."
- **Played** is collapsed at the end.
