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
- Prime Video's top-right player icons, from
  [Online Tech Tips](https://www.online-tech-tips.com/fix-prime-video-subtitles-not-working/)

The table at the end of this page sums up which reference each pattern
follows.

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
blur and no shadow.

## Controls over the picture

Over a video, there is a bottom band and a top line. They show and hide
together.

**Scrims, not bars.** Each band paints a soft black ramp behind itself and
past its edge (`::before`). It fades from 70% at the screen's edge to 50%
where the controls start, then to nothing over 4rem. This follows YouTube's
gradient and Netflix's and Apple's floating controls. There is never a solid
band.

- The band's box is only its controls, about 108 px at 1920 wide, down
  from 186. `--bottom-bar` is its height. Subtitles rise above that height
  while the band shows
  (`video::-webkit-media-text-track-container`; Firefox doesn't expose it),
  and panels clear it.
- The muted ink is white at 85%.
- Hidden bands are inert.

**The top line** follows the fullscreen title of YouTube and Netflix:

- Back, then the title at `text-lg` semibold. The title opens Details.
- Under the title, the relationship links (`MediaContext`). A subtitle that
  the links already name is not repeated (`mediaSubtitle`).
- At the right, small: the end time ("ends 21:42"), Stop sharing while this
  device shares, and the clock on the TV.
- After them, at the right edge: **the Playback gear and fullscreen**. Prime
  Video keeps its settings and fullscreen at the top right, and YouTube's
  fullscreen title line is where Couch's sits. They act on the picture, so the
  band keeps only the now-playing bar's tools. Each sits straight above one of
  the band's last two tools: the gear over Up next, fullscreen over Where it
  plays. The TV has no fullscreen, so its gear takes the corner.
- Phones move the end time to the end of the line under the title, so the
  title keeps its room beside the gear and fullscreen.
- The top line publishes `--player-top`. Toasts and Up next stay below it.

**The band** has two rows.

The timeline row:
- Position, a thin line, and the time remaining.
- The unplayed part is translucent white.
- As on YouTube, the line thickens under a pointer, and its thumb shows only
  while a pointer or focus is on it.
- A hovering pointer reads the time under it, on the panel surface.

The control row:
- Play/Pause, Stop and Next in the middle, at every width. They stay centred
  so the now-playing bar grows into the band without anything changing side.
  Apple's controls and Prime's centre transport are centred too.
- The tools at the right: Volume, Up next and Where it plays, exactly the
  now-playing bar's. **Where it plays ends both rows everywhere**, so it is the
  one control that never moves.
- Every control is a ghost icon (`icon-lg`), each with an `aria-label` and
  a matching `title`. Its target is 44px and grows with the interface only to
  2.25rem: 54px at 1920 wide, the size of YouTube's fullscreen controls
  (`--player-target`).
- Phones (below `sm`, the bar's breakpoint) leave Volume out and drop the
  gaps. A phone has volume keys, as YouTube's and Netflix's phone players
  assume, and Where it plays leads with the same Volume. The transport stays
  centred: at 390 wide 35px separate Next from Up next; at 320 wide they touch,
  44px targets side by side with no overlap. Anything narrower scrolls the row.

### The band and the now-playing bar

The band is the now-playing bar grown up ([Shell](shell.md#now-playing-bar)).
They share one set of controls:

- **The same icons, glyphs and targets** at every width: the transport, the
  lucide Volume, Where it plays (SlidersVertical) and Up next (ListMusic), at
  `--player-target` with a 1.25rem glyph.
- **The transport at the same x.** Both centre it in a
  `1fr auto 1fr` grid inside the same gutter.
- **The same tools at the same x, in the same order:** Volume, Up next, Where
  it plays, with Where it plays last. The gear and fullscreen, which only mean
  something over the picture, are the top line's, so nothing else shares the
  band's row.
- **They move, not cross-fade.** Each shared control has its own view
  transition name (`couch-play`, `couch-stop`, `couch-next`, `couch-volume`,
  `couch-where`, `couch-queue`), so it glides from its place in the bar to its
  place in the band while the band itself grows (`couch-player-band`).

The differences are deliberate:

| Where | Bar | Band | Why |
|---|---|---|---|
| Wide screens | Volume, Up next, Where it plays | the same, at the same x; the gear and fullscreen are above, in the top line | The gear's settings and fullscreen apply to the picture. |
| Beside artwork (audio, or playing elsewhere), from 960px | Up next opens the player's Up next | Up next takes focus into the list beside the artwork, and Close returns | The list is already on screen; the button keeps its place. |
| Phones | Play/Pause right beside Where it plays, after the title | the centred transport, then Up next and Where it plays | The bar's left is what plays. Its Play/Pause sits where the band's Up next does, so both right ends read as two targets ending on Where it plays. |

Over a playing video, the bands hide 4 s after the last key while focus is on
the picture. They show and hide together, so the gear's menu, which drops from
the top line, keeps both up. They stay up:
- while a panel or menu is open
- during recovery
- while the keyboard is in them
- while this device shares

## Settings

Every setting is in **the Playback gear** at the top line's right, which
opens YouTube's menu: a small menu that drops from the gear, aligned to its
right edge and stopping short of the band (`PlaybackMenu`,
`data-player-menu`). There is no separate subtitles button, so the band keeps
to the transport and the bar's three tools. C still turns subtitles on and
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
the band. It is 28rem wide, full width on phones, and as tall as its rows up to
the top line. Netflix's episodes panel works this way. The rest of the
picture stays visible and keeps playing.

- Its heading row stays while the list scrolls under it. The row holds the
  title, the Autoplay switch and Close.
- A click on the picture while Up next is open closes it, without pausing.
- Beside artwork, on wide screens, Up next stays on screen, and the band's Up
  next takes focus into it, with Close to return. On phones it replaces the
  artwork.
- **Playing** heads the list only where the player's title is off screen.
- **Upcoming rows** are board lines:
  - The title is heavy. The start time is light, at the same size, at the
    row's end.
  - The meta line has the length, and "added by {device}" when another
    device queued it.
  - A row is one target that plays it. Its "…" holds Details, Play next,
    ordering, Save for later, Open in browser and Remove.
  - Removing a row keeps focus on the adjacent row.
- A status line counts the rows and says when they end ("2 to play · until
  17:05"), with **Save as list**.
- **Autoplay** continues only the current series, album or playlist, after the
  queued rows:
  - "Then from {context}", then up to ten of its upcoming entries as quieter,
    display-only rows. Their start times continue the board.
  - Or "Finding the next item…".
  - The Autoplay switch shows in the heading row only while something can
    continue, as YouTube's autoplay switch does. Settings → Playback always
    holds it.
- Empty: "Nothing queued."
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
shortcuts at once ([Shell](shell.md#keyboard)).

- A key shows the controls and leaves focus where it is.
- A click on video plays or pauses. On audio it does nothing.
- A double-click toggles fullscreen.
- A pointer click in the band returns focus to the picture, unless the click
  opened something.
- Tab enters the controls.
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
- **Reconnecting and Offline** add their line under the spinner.
- **Can't play, Player unavailable and Finished** are a short centred line
  with its detail and one remedy:
  - Try again for Can't play
  - Choose device for Player unavailable (Where it plays)
  - nothing for Finished, where the transport says Replay

**Beside artwork**, the same status follows the title. The artwork and title
stay during loading and failure. Next stays available while another entry
exists.

## Audio, live and elsewhere

Audio, and media playing elsewhere, show **Now playing** as Home's hero does:

- contained artwork
- the title
- where it plays, when that isn't only this device: "on Kitchen +1", in the
  ink rather than the muted metadata. It leads the line under the title, so it
  reads on from the title. The now-playing bar says it the same way, in the
  same place (`PlaysOn`).
- the relationship links, on the same line
- a meta line: the station, else the subtitle, else the source, then "in a
  separate window" for a channel that plays in mpv's window
- the end time
- a station's current programme or track

The band sits on black with no rule, and nothing over a picture. The top line
keeps Back and, at its right, the gear; there is nothing to fill, so there is
no fullscreen (a window already in fullscreen keeps its Exit fullscreen). Live media
that can't seek has no timeline, no time and no label, and its Pause stays
disabled. On wide screens, the queue sits beside the stage. The band includes
the phone's safe-area inset.

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
| Gear and fullscreen at the top right, over the band's last two tools | Prime Video's top-right icons; YouTube's fullscreen top line |
| Gear menu with in-place submenus (Subtitles, Audio, Speed, Quality, Chapters, Audio delay) | YouTube, whose gear holds Subtitles/CC and Audio track |
| No separate subtitles button; C toggles subtitles | YouTube's C key; the owner asked for fewer buttons |
| Up next as a panel over the picture from its own button | Netflix's episodes panel |
| Autoplay switch | YouTube |
| Next card near the end | Prime Video's "Next up"; Netflix's Next Episode |
| Buffering as a centred spinner | YouTube; Apple's HIG |
| Translucent panel surface | YouTube's gear menu (60%) |
