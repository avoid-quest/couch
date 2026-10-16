# Player

When the player opens: [Shell](shell.md#a-picture-you-start-opens-the-player).
On a TV: [TV](tv.md#the-tv-player-answers-a-remote).

## The player is one tap away

The now-playing bar opens the player through its
artwork and title ([Shell](shell.md#now-playing-bar)). The bar and the player band hold one control
order: Play/Pause, Stop and Next, the timeline, volume, Where it plays and Up
next, then in the band Playback settings (a
gear; Audio & subtitles lives inside) and fullscreen, whose
timeline takes its own row above. On phones the bar keeps Play/Pause and
Where it plays. Every control there is an icon with an
`aria-label` and a matching `title` tooltip, never visible text.

### Transport

The transport is Play/Pause, Stop and Next wherever it appears: the band, the
now-playing bar, Home's Now row and the Remote. Each keeps its slot for every
kind of media: live media that can't pause keeps Pause, disabled, and Stop is
enabled whenever something is loading, playing, paused, ended or failed.
Stop clears the sequence and offers Undo; it lives in the transport, never
only in a Sheet. The keyboard and the timeline seek.

### Volume and timeline

Volume is a speaker icon that opens its slider and Mute in a Popover. A
timeline shows only where it means something: seekable media, or media with
a length it will seek through once loaded. Live media that can't seek shows
no bar, no position and no total, just "Live" in the timeline's slot.

Volume across several Devices: [Where it plays](where-it-plays.md#band-volume).

### Layout

Audio and remote playback place contained artwork beside a persistent
desktop queue. On phones, Up next replaces the artwork while transport stays
available. Video uses the full viewport until Up next opens beside it; then the picture is letterboxed, never cropped.
Queue navigation survives playback changes; track-specific settings reset.
Transport, volume and tools share one bottom dock across media modes. Keep
unavailable controls in their slots so loading and queue changes preserve
muscle memory (the live timeline is the exception: it gives way to "Live");
adapt the rows to screen width, with content above the dock.

### Controls over the picture

Audio keeps its solid controls visible. Video controls fade over a transparent
black scrim, preserving the picture bounds; the gradient exists only to keep
overlaid text readable without an abrupt edge that resembles cropping. Hidden
controls are inert and let pointer input reach the video. The player fits the
viewport at every interface size. Plain playback glyphs keep artwork central;
Playback settings use Sheets. Stage CSS handles native video bounds
and the responsive queue workspace; controls reuse shadcn components.

## Player header

The ordinary player's fixed-height header uses a compact trail of the same
collection links as [`ContentBreadcrumb`](browse.md#contentbreadcrumb), with single-line, truncated labels and at least `min-w-11`
targets. Its title already appears in the player; Search and the provider remain
in the full browse trail. Without a collection, the player links to Live,
its provider or Search. The Couch switch takes at most two fifths of the header's
content width so a long device name leaves room for the trail. The
[shadcn Breadcrumb](https://ui.shadcn.com/docs/components/radix/breadcrumb)
supports composing links, but its wrapping default overlaps the switch on a
phone; a collapsed menu would add a step to these existing destinations.

The ordinary player's transient Buffering status has its own row above the
transport: keeping it beside two 44px collection links
obscures a link and clips the status at 320px and 130% interface size.
The scoped Remote header keeps its own status arrangement.

## Up next is a deliberate list

Keep Playing separate and Played collapsed.
Compact artwork rows have one menu for Play next, ordering, Save for later
and Remove. Removal leaves focus on an adjacent action menu. Save as list
asks for a name and preserves errors there for retry. Queue-specific rows
keep actions beside titles where MediaRow would stack them; shadcn/Radix
Dropdown Menu supplies keyboard navigation and typeahead.

Autoplay is a
separate preview with a profile switch, continuing only the current series,
album or playlist. Explicit queue entries play first. Stop clears the
sequence; its end never starts recommendations.
