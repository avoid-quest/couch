# Player

The player is `/now` (`PlayerPage`). For when it opens by itself, see
[Shell](shell.md#a-picture-you-start-opens-the-player). For the TV, see
[TV](tv.md#the-tv-player).

Every pattern below follows a reference player, adapted to Couch:

- **YouTube** was observed live.
- **Netflix, Prime Video and Apple TV** come from their help pages and from
  write-ups.

YouTube's web player was observed in October 2026. The other sources are:

- Netflix's [Audio & Subtitles](https://help.netflix.com/en/node/372) and
  [speed](https://help.netflix.com/en/node/116584) help pages
- Apple's [tvOS playback guide](https://support.apple.com/guide/tv/control-video-playback-atvb7944597f/tvos)
  and the HIG's [Playing video](https://developer.apple.com/design/human-interface-guidelines/playing-video)
- Prime Video's "Next up" card, from
  [Amazon's customer Q&A](https://www.amazon.com/ask/questions/Tx2MVM96BJT371B)

The table at the end of this page sums up which reference each pattern
follows.

## Live audio

For a publication started as **Live audio**, the transport is **Join/Leave** and
the volume belongs to this device. Up next, shared pause/Stop/Next, seeking,
speed and programme settings are absent. Leaving uses this receiver even while
it is looking at another device's playback. The publisher ends capture with
**Stop sharing** in the header. Admission errors explain how to retry without
pausing healthy listeners. Ordinary sharing retains its existing controls.
Keyboard shortcuts and Media Session actions follow the same Core-provided rights.

Audio delay appears only for the separate-audio Direct adapter that applies it.
Scheduled hardware correction is a separate setting in Where it plays. A picture
adapter without source timestamp mapping reports that limitation; its video
remains usable, without a claim of synchronized presentation.

## The picture

A video fills the window and never shrinks, moves or resizes. All four
references keep the picture full-bleed and float their controls and panels
over it. Everything that opens lies over the picture:

- the gear's menu, with Subtitles and Audio
- Volume
- Where it plays
- Up next
- the Next card

Over a picture, these surfaces are one translucent black,
`--player-surface` (75%). YouTube's gear menu is 60%. Couch's is a little
darker so that subtitles behind a panel don't fight its text. There is no
blur, no shadow and no hairline.

The bars around a contained picture are lit by the item's artwork, as
YouTube's ambient mode lights its player ([Room](../design.md#room)): its
first colour glows 8rem out of the picture's edges, over a dark haze of its
second. The light lies
behind the video element, so it shows only in the bars, and it is painted
once: nothing reads or redraws the picture while it plays.

The four panels the tools open, Volume, Where it plays, Up next and the gear's
menu, are one family wherever they open, from the band or the now-playing bar:

- one surface: `--player-surface` over a picture, else the popover black
  with a hairline, which a black page needs to hold its edge
- one corner (`rounded-lg`) and one inset: text sits .75rem in
- two widths: 18rem for Volume and the gear's menu, 32rem for Where it plays
  and Up next, except Up next over the room beside artwork: 28rem of glass
  with a shadow ([Up next](#up-next))
- one place: 8px above the band (or the bar), ending at the gutter, the
  tools' right edge, whichever tool opened them (`toolPanel`)
- each grows from the button that opened it

Where it plays' first line doesn't stick over its rows with a second surface:
its rows scroll under it. The mixer on phones and the TV stays a Sheet.

## Controls over the picture

Over a video, there is a bottom band and a top line. They show and hide
together.

**Scrims, not bars.** Each band paints a soft black ramp behind itself and
past its edge (`::before`). It fades from 82% at the screen's edge to 70%
where the controls start (white keeps 7:1 over a white frame), then to nothing
over 4rem. This follows YouTube's
gradient and Netflix's and Apple's floating controls. There is never a solid
band.

- The band's box is only its controls, about 108 px at 1920 wide.
  `--bottom-bar` is its height. Subtitles rise above that height
  while the band shows
  (`video::-webkit-media-text-track-container`; Firefox doesn't expose it),
  and panels clear it.
- The muted ink is white at 85%.
- Hidden bands are inert.

**The top line** follows the fullscreen title of YouTube and Netflix:

- Back, then the title at `text-3xl` semibold (`text-2xl` on phones), up to
  two lines, the whole title on hover. The title opens Details.
- Above the title, the collections holding what plays, after its source
  ("YouTube › Tiny Desk concerts"), as a Stage's trail
  ([Browse](browse.md#breadcrumbs)). Beside artwork it leads the copy the same
  way.
- Under the title, at `text-base`, the relationship links (`MediaContext`): the
  creator, and a show's station. A subtitle that the links or the trail already
  name is not repeated (`mediaSubtitle`).
- At the right, small: the end time ("ends 21:42"), Stop sharing while this
  device shares, and the clock on the TV.
- The top line publishes `--player-top`. Toasts and Up next stay below it.

**The band** has two rows.

The timeline row:
- Position, a thin line, and the time remaining.
- The unplayed part is translucent white.
- As on YouTube, a lighter segment ahead of the playhead shows what this
  device has already loaded (35% white, here and on the now-playing bar's
  line). It shows only while this device plays media that seeks.
- As on YouTube, the line thickens under a pointer and while it is dragged,
  here, beside artwork and on the now-playing bar alike. Over a picture, and
  on the bar, its thumb shows only while a pointer or focus is on it.
- A hovering pointer reads the time under it, on the panel surface. Its preview
  updates independently of the slider, chapters and playback labels; touch and
  disabled timelines do no hover work. Dragging previews locally and sends one
  seek on release. Keyboard seeking keeps its ten-second steps across clock updates.

The control row:
- Play/Pause, Stop and Next in the middle. They stay centred so the
  now-playing bar grows into the band without anything changing side. Apple's
  controls and Prime's centre transport are centred too.
  Play/Pause is the band's one large control (1.3 times the target, a 2rem
  glyph), as Apple's and YouTube's fullscreen transports lead with theirs; the
  bar's smaller one grows into it.
- The tools at the right, exactly the now-playing bar's, sound first, then
  content, then view: **Volume, Where it plays, Up next, the Playback gear**,
  then **the last slot: fullscreen**, bottom right as on every player. The bar
  has Open player in that slot, so each tool sits at the bar's x.
- Fullscreen stays at the bottom right for audio and video, directly under
  **Info** at the top right beside artwork ([Calm and Info](#calm-and-info)).
  Entering fullscreen changes it to Exit fullscreen in the same place. Over a picture on the TV,
  which is always full screen, the slot stays empty rather than holding a fullscreen that can never
  act: Couch's disabled controls keep their slot while their media might allow
  them again, as Next does; this one can't, and an empty slot is no stop for
  the remote.
- Every control is a ghost icon (`icon-lg`), each with an `aria-label` and
  a matching `title`. Its target is 44px and grows with the interface only to
  2.25rem: 54px at 1920 wide, the size of YouTube's fullscreen controls
  (`--player-target`).
- Phones (below `sm`, the bar's breakpoint) leave Volume out and drop the
  gaps. A phone has volume keys, as YouTube's and Netflix's phone players
  assume, and Where it plays leads with the same Volume. A centred transport
  leaves room for only two tools at 320 wide, so on phones the transport leads,
  its glyph under the position as fullscreen's is under the time left, and
  every tool stays: nothing moves into a menu and nothing is dropped. At 320
  wide the seven 44px targets fill the row exactly, touching with no overlap;
  at 390 70px separate the transport from the tools. Anything narrower scrolls
  the row. Beside artwork fullscreen stays in the same slot;
  Info stays at the top right, directly above it.

### The band and the now-playing bar

The band is the now-playing bar grown up ([Shell](shell.md#now-playing-bar)).
They share one set of controls:

- **The same icons, glyphs and targets** at every width: the transport, the
  lucide Volume, Where it plays (SlidersVertical), Up next (ListMusic) and the
  gear (Settings), at `--player-target` with a 1.25rem glyph.
  Filled transport icons fade as a single shape, so their edges stay flat
  instead of forming a brighter contour where fill and stroke overlap.
- **The transport at the same x.** Both centre it in a
  `1fr auto 1fr` grid inside the same gutter.
- **The same tools at the same x, in the same order:** Volume, Where it
  plays, Up next, the gear, then the last slot. The band's is fullscreen (or
  empty); the bar's is **Open player**, a ChevronUp. It is a mini-player's
  expand arrow, as on YouTube Music: an arrow up, into the player. Maximize2's
  diagonal arrows would read as fullscreen, which it isn't. It is the same
  action as the bar's title, "Open player: {title}", so it carries the same
  verb.
- **The bar's gear is the player's.** It opens the same Playback menu for
  whatever plays, here or on another device: Subtitles and Audio where there
  is a picture, Speed, Quality, Audio delay and Details. Each acts on the
  playback, not on this window, so none needs the player open. Details closes
  the menu as it leaves the page.
- **A short fade on entry.** The player appears over 160 ms, and Back fades
  the restored bar in over the same interval. Their controls keep the positions
  above; opacity is the only animated property. There is no shared-element
  snapshot capture on navigation. Reduced motion skips the fade
  ([Design](../design.md#motion)).

The differences are deliberate:

| Where | Bar | Band | Why |
|---|---|---|---|
| Wide screens | Volume, Where it plays, Up next, gear, Open player | the same, then fullscreen at Open player's x | Fullscreen is bottom right on every player. |
| Beside artwork (audio, or playing elsewhere) | Up next opens the player's Up next | Up next opens over the room; Info is at the top right, fullscreen at the bottom right | The bottom row keeps playback tools; Info reveals the show's details. |
| Phones | Play/Pause and Open player, after the title | the transport at the left, then Where it plays, Up next, the gear and fullscreen | A minimized player needs no mixer; the player has it. Open player sits at fullscreen's x. The band has no room to centre the transport beside four tools. |

Over a playing video, the bands hide 4 s after the last key while focus is on
the picture. They show and hide together. They stay up:
- while a panel or menu is open
- during recovery
- while the keyboard is in them
- while this device shares

## Settings

Every setting is in **the Playback gear**, which opens YouTube's menu: a
small menu above the whole band, aligned to the gear (`PlaybackMenu`,
`data-player-menu`). The now-playing bar's gear opens the same menu above the
bar. There is no separate subtitles button, so the band keeps to the transport
and the bar's tools. C still turns subtitles on and
off, as on YouTube.

- Each row is a setting with its current value and "›": Subtitles, Audio,
  Speed, Quality, Chapters and Audio delay. Each shows only where it
  applies. A Details link ends the menu.
- **Subtitles** leads the menu, as YouTube's Subtitles/CC row does, and
  reads "Off" or the chosen track. It shows over video only. Its submenu has:
  - Off and the tracks, the current one checked
  - Save subtitles as default, while there are tracks
  - under a hairline, Add subtitles (SRT or VTT) and the Subtitle delay
    stepper
- **Audio** shows only with more than one audio track, as YouTube's Audio
  track row does. It reads the chosen track. Its submenu has the tracks and
  Save audio language as default.
- Speed offers 0.5× to 2×, with Save as default. YouTube puts speed in the
  gear menu. Netflix has a separate speed button, but on web and mobile only.
- Quality lists Couch's labels.
- Audio delay steps by 0.1 s.
- A row opens its submenu in place, under a Back row (YouTube's submenus).
  Focus lands on the chosen value. The Back row stays while a long list
  (subtitle languages, chapters) scrolls under it.
- Back or Esc in a submenu returns to the menu, on the row that opened it.
  Back or Esc on the menu closes it and returns to the gear.
- Volume and Where it plays open their Popovers above the whole band, so
  nothing covers the timeline.

## Up next

`QueuePanel`. Over a picture, Up next is a panel over it, at the right above
the band, one of the tools' panels: 32rem wide, full width on phones, and as
tall as its rows up to the top line. Netflix's episodes panel works this way.
The rest of the picture stays visible and keeps playing.

With nothing to show (no queued or played row, no Autoplay pick and no
search for one), Up next isn't offered: its button keeps its slot, disabled,
with "Nothing queued" as its tooltip, in the band and the bar.

Beside artwork it is never parked on screen: the artwork has the room, and Up
next is summoned from its button as a panel over the room at the right above
the band (28rem, `rounded-lg`, translucent black glass with a shadow), growing
from its button; a click on the room closes it. It lies over Info, which stays
as it was beneath it. On phones it takes the artwork's place.

- Its heading row stays while the list scrolls under it. The row holds the
  title, the Autoplay switch and Close.
- A click on the picture while Up next is open closes it, without pausing.
- **Playing** heads the list only where the player's title is off screen.
- **Upcoming rows** are board lines:
  - The title is heavy. The start time is light, at the same size, at the
    row's end.
  - The meta line has the length, and "added by {device}" when another
    device queued it.
  - A row is one target that plays it. Its "…" holds Details, Play next,
    ordering, Save for later, Open in browser and Remove.
  - Removing a row keeps focus on the adjacent row.
- A status line counts the rows and says when they end ("2 to play, until
  17:05"), with **Save as list**.
- **Autoplay** continues only the current series, album or playlist, after the
  queued rows:
  - "Then from {context}", then up to ten of its upcoming entries as quieter,
    display-only rows. Their start times continue the board.
  - Or "Finding the next item…".
  - The Autoplay switch shows in the heading row only while something can
    continue, as YouTube's autoplay switch does. Settings → Playback always
    holds it.
- With only played rows: "Nothing queued." above Played.
- **Played** is collapsed at the end.

### Next, near the end

In the last 30 s of an item with a length, a card waits over the picture at
the right above the band (`data-next-up`). It combines Prime Video's "Next up"
card and Netflix's Next Episode.

- It shows what plays next: the next queued row, else Autoplay's first pick.
- It shows its artwork, "Next" and its title.
- It is one target, "Next: {title}", that skips to it now.
- Couch moves on by itself at the end either way, so there is no countdown.
- It hides while a panel or Up next is open.

## The picture holds the keys

On desktop and phones, the player opens focused on its picture
(`data-player-surface`, `tabindex="-1"`, "Player: {title}"), so keys are
shortcuts at once, as on YouTube ([Shell](shell.md#keyboard)): ← and → seek,
↑ and ↓ change the volume, Space or K plays or pauses, J and L skip, F fills
the screen and M mutes. However it opens (the now-playing bar, Play on a page,
a picture that starts), the page's focus recovery leaves it to the picture.

- A key shows the controls and leaves focus where it is.
- A click on video plays or pauses. On audio it does nothing.
- A double-click toggles fullscreen.
- A pointer click in the band returns focus to the picture. What it opened (a
  Popover, Up next) returns focus to the picture when it closes, and so does
  Back from Details opened from the gear's menu.
- A control the pointer left focused hands focus to the picture as the bands
  hide, so the keys never land on the page behind them.
- Tab enters the controls, with the focused control inverted. A control the
  keyboard focused keeps Enter, Space and the arrows (Space and the arrows act
  once: the shortcuts leave a focused control alone), and what the keyboard
  opened returns focus to its control.
- The TV keeps its own: the remote's first key enters the controls.
- On phones, a tap shows or hides the controls.

### Back on desktop and phones

A pointer has no Back key. The top line therefore leads with a Back arrow
("Back to {section}", or "Back to Remote"). It returns to the page that opened
the player, as Esc does. The TV has no Back arrow.

## Status and recovery

The words are `playbackStatus`'s. The plain states are left to the
Play/Pause glyph. Nothing is said in the band.

**Over a picture**, the status is centred on it (`.player-status`):

- **Loading and buffering** show a spinner only. The words are for screen
  readers. This follows YouTube and Apple's HIG.
- **Reconnecting and Offline** add their line under the spinner. Offline says
  "Offline", then only what happens next: "Reconnecting to {Couch}…".
- **Can't play, Player unavailable and Finished** are a short centred line
  with its detail and one remedy:
  - Try again for Can't play
  - Choose device for Player unavailable (Where it plays)
  - nothing for Finished, where the transport says Replay

**Beside artwork**, the same status follows the title. The artwork and title
stay during loading and failure. Next stays available while another entry
exists.

## Audio, live and elsewhere

Audio, and media playing elsewhere, show **Now playing**: one composition in
the artwork's [room](../design.md#room). On wide screens the artwork stands at
the left, whole at its own shape (`--art-ratio`), as tall as the room allows
(up to 36rem and 52% of the width) with its shadow, and the copy beside it
ends level with its foot. Phones and portrait windows stack them, the artwork
as wide as the gutters allow. The copy:

- the title in the display face, sized by its length and set
  whole ([Type](../design.md#type))
- where it plays, when that isn't only this device: "on Kitchen +1", in the
  ink rather than the muted metadata. It leads the line under the title, so it
  reads on from the title. The now-playing bar says it the same way, in the
  same place (`PlaysOn`).
- the relationship links, on the same line. A station's link shows under its
  show; without a show the title is the station, and already opens it.
- "In a separate window" for a channel that plays in mpv's window
- a station's current track
- in Info only ([Calm and Info](#calm-and-info)): the trail above the title,
  the station's tags after its link, a meta line (a show's categories and host,
  "Bass, Breaks, Goldie B", as its tile says them, else a station's tags, else
  the subtitle, else the source), a show's broadcast progress, synopsis and the
  next show ([Radio](browse.md#radio-and-live-tv)), and an item's end time,
  updated independently so clock ticks do not re-render the artwork and
  controls

The room's light pools behind the artwork, never behind the copy, and its
colours cross-fade when the show or item changes. The band and Up next beside
it are open, with no ground of their own, so the room reaches the window's
edges.

**A station's show** is Core's programme for the playback, else the show its
tile lists (`useStationShow`). The rule is the same on the tile, the
now-playing bar, Home's hero and the player, loading or playing: the show's
title and photo while there is a show, else the station's name and logo.

The band sits in the room with no rule, and nothing over a picture. Fullscreen
stays at the bottom right on desktop and phones; Info sits directly above it.
Live media
that can't seek has no timeline, no time and no label, and its Pause stays
disabled. The band includes the phone's safe-area inset.

### Calm and Info

Now playing opens **calm**, on every screen: the artwork, the title, where it
comes from (the station or creator, and where it plays) and the transport, as a
TV's player shows only the picture and what it is. **Info** shows the rest in
place, as a TV's Info button does: the copy grows under the title, in the same
type, with no panel, heading or label, and fades in over 200 ms (none with
reduced motion). Nothing moves to another page and playback is untouched.

- **One control, three ways.** The top-right Info button (`aria-expanded`,
  `aria-controls="player-info"`), the I key, and a Remote's Info key, which
  reaches the TV through `dispatchTvRoute("info")` (open menus close first).
  From any other page the Remote's Info opens the player with Info shown
  (`playerInfo` in the entry's history state); on the player it toggles.
  Over a picture there is no Info: the top line already names what plays, so a
  Remote's Info shows or hides the controls, as a TV's info banner.
- **Back** closes the gear's menu, then Up next, then Info, then (on the TV)
  hides the controls, before it leaves the player. Pressing Info while Up next
  is open closes Up next and shows Info.
- **Focus.** A pointer's click on Info returns focus to the picture, as the
  band's other buttons do; the keyboard and the remote keep it on Info. What
  Info hides takes its focus with it (the trail's links, a synopsis' More), so
  that focus moves to Info's button, else the picture. The station's link stays
  the same element either way.
- **Scope.** Info belongs to the Playback and entry it was opened for: another
  entry or Playback starts calm. A new programme on the same station keeps it
  open, and its metadata, the next show included, follows the broadcast's own
  clock. The hidden part is in the DOM, `hidden`, so its content is always
  current and out of the accessibility tree.
- **Room.** Beside the artwork the copy keeps its foot level with the
  artwork's; when Info is taller than the room it scrolls. Stacked (phones,
  portrait), the artwork shrinks to make room, to no less than 6rem tall, and
  the column scrolls if it still can't fit. Windows up to 500px high keep the
  artwork beside the copy in both modes, with the same 6rem minimum and display
  type; the copy scrolls when needed.
- **Next programme is not Up next.** The station's next show is part of Info
  ("Next programme"); Up next is what Couch will play.

## Stop sharing

While this device shares its screen or sound, the top line keeps "Sharing
{screen}" and Stop sharing at its right ([Live inputs](../live-inputs.md)), and
the bands don't hide on their own.

## Transport

Play/Pause, Stop and Next are the same ghost icons wherever they appear: the
band, the now-playing bar, Home's hero and Remote (`PlaybackTransport`).

- Each control keeps its slot.
- Live media that can't pause keeps Pause disabled.
- Stop is enabled whenever something is loaded or has failed. It clears the
  sequence and offers Undo.
- After a failure, Play becomes Try again. At the end, it becomes Replay.

## Where each pattern comes from

| Pattern | Reference |
|---|---|
| Picture never moves; panels lie over it | All four. Only Apple's PiP shrinks the picture. |
| Gradient scrims, no bars | YouTube's bottom gradient; Netflix's and Apple's floating controls |
| Thin timeline that thickens on hover, thumb on hover, hover time | YouTube |
| Title top-left with Back | YouTube and Netflix fullscreen |
| Fullscreen at the bottom right | Every reference: YouTube, Netflix, Prime Video |
| Open player as an up arrow in the now-playing bar | YouTube Music's mini-player |
| Gear menu with in-place submenus (Subtitles, Audio, Speed, Quality, Chapters, Audio delay) | YouTube, whose gear holds Subtitles/CC and Audio track |
| No separate subtitles button; C toggles subtitles | YouTube's C key; the owner asked for fewer buttons |
| Up next as a panel over the picture from its own button | Netflix's episodes panel |
| Calm Now playing; Info shows more in place, from the remote's Info key | TV guides' and set-top boxes' Info button |
| Autoplay switch | YouTube |
| Next card near the end | Prime Video's "Next up"; Netflix's Next Episode |
| Buffering as a centred spinner | YouTube; Apple's HIG |
| Translucent panel surface | YouTube's gear menu (60%) |
