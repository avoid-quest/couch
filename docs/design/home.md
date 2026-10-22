# Home

Home (`HomePage`) is one large item, the hero, on Home's
[Stage](../design.md#stage), then your own rows as one board of short lists,
then the sources. Narrow screens stack the Stage (`md:`) and the board; the TV
hides the shelves' scrollbars.

## The hero

The Stage at Home's height (`min(39.375vw, 70vh)`): the picture at the right
at its [true shape](browse.md#artwork-shapes), reaching up under the
see-through header and out to the window's edge, dissolving into its own light
and then black; at the bottom left the title at display size (4.5rem, 3.75rem
past 22 characters, 3rem past 44; phones 2.5rem down to 1.75rem), one muted
meta line with its relationship links, how far it got as a slim line beside
what's left, and the verbs. Phones put the picture across the column at the top
and start the copy over its foot, the primary verb growing along the verbs'
one line. Its item is the
first of:

1. **What you control, playing now.** Meta: the station or subtitle, its
   source, a status only when it isn't plain playing or paused, and "on
   {device}" when it plays elsewhere. A slim progress line advances as it plays
   beside "4:27 left, ends 22:01". Verbs: Open player, then the
   [transport](player.md#transport) on the same line. The now-playing bar
   shows too, as on every page.
2. **The first Continue item**: its progress line beside "10:32 left", as
   Details shows it (it isn't playing, so no end time); Resume, From start,
   Details.
3. **The first station on air**: Play.

The hero's picture lights the page's top ([Light](../design.md#light)),
whichever item it shows. An episode leads with its series ("Phony", then "S1 E1, Episodio 1" on the
meta line). Radio and live media show no progress or time. The primary verb
carries `data-page-first`. The hero waits for the data that decides it
(session, history, stations) so it never swaps under the focus, and the rows
wait with it.

## Sections

Continue, For later, Played recently, Up next (off by default), Shared
sources, Radio, Live TV, one per source with a home (Twitch,
StreamingCommunity, RaiPlay, 123MoviesFree, AnimeSaturn, AnimeUnity) and
Sources, in the order and visibility chosen in Settings → Home
([Settings](settings.md)). They are `gap-section` apart. A section shows only
with something in it; one still loading holds its place, so nothing moves
under the focus, and one that fails says "Couldn't load {what}." with Try
again.

Lists and shelves keep their order while Home stays open and never hold the
hero's item: the one that led Home when it opened, nor the one leading it now
(after Stop, the next hero's item leaves Continue).

TV page entry goes to the hero's primary verb, or without a hero to the first
available section's first control, and moves to an earlier section that
finishes loading until the user acts; a shared source that appears meanwhile
doesn't take the focus.

## The board

Your own rows that follow each other in the saved order (Continue, For later,
Played recently, Up next) are one board (`HomeBoard`): short lists of compact
[`MediaRow`s](browse.md#rows-and-tiles) side by side in columns of one width
(`repeat(auto-fill, minmax(min(100%, 20rem), 1fr))`, 3rem apart), whatever
their count, so a few items read as a composed list. Phones stack them; the
TV keeps the columns, and its arrows move down a list and across to the next.

A list holds its first four. Its heading (`ShelfHeading`) is its name, with no
count and no rule under it (Up next adds "until 23:10"); where the rest has a
page it links there with a chevron: Continue and Played recently → Saved's
Played, For later → Saved's For later. Up next ends with "N more", opening Up
next.

A row's press does its main verb: Continue resumes, an Up next entry plays
now, For later and Played recently open Details. Other verbs, and where the
item leads ("Go to Stanford"), are its menu; on Continue its first verb is
Details. Continue's progress is a line along the thumbnail's foot, and its
meta ends with what's left ("YouTube, 4:11 left"). Up next rows read their
length and end time ("4:52, ends 21:47"). Each list takes its items' majority
shape. Without a hero, a remote starts on the board's first row.

## The sources

- **Shared sources**, while devices share screen or sound: a line of chips;
  pressing one plays it, its menu holds Play on, Play next and Queue.
- **Radio**: one shelf of up to twelve stations, yours first (those this
  device played lately, then the saved ones), then Couch's built-in ones, each
  with its current show, never the hero's station. A tile plays; its menu
  holds Details. The heading opens every station
  ([Radio](browse.md#radio-and-live-tv), `/radio`). Stations a device has
  loaded show at once, before their shows; a tile without a show stays level
  with the rest.
- **Live TV**, while a Live TV source has channels: the guide's first twelve.
  A tile plays its channel; the heading opens every channel (`/live-tv`).
- **One shelf per source with a home**: the channels and series saved from
  it, in Saved's order, live channels first. Core asks Twitch which saved
  channels are live as it lists them (one query, at most every 20 s); an
  offline channel stays, its artwork dimmed, reading "Offline". A page's
  section (RaiPlay's "In Diretta", `#block=`) belongs to that page, which the
  heading opens: it stays out of the shelf, and Save isn't offered for one
  (one saved before keeps Saved, to remove it). The heading (the source's
  name) opens the source's own home. A source with nothing saved has no
  shelf.
- **Sources**, always there: every source as one line of `secondary` pill
  chips. A source with a home opens it; YouTube, Bandcamp and SoundCloud scope
  the header's search to themselves. A source whose latest answer here failed
  (its home, a page or a search) is muted over "Couldn't load"; it still
  opens, to try again.

Shelves are plain overflow rows (`data-nav-row`) without paging buttons: a
pointer scrolls them, touch swipes, keyboard and remote move focus, and Up and
Down go shelf to shelf. Each item is one
[`MediaTile`](browse.md#rows-and-tiles) whose press does its main verb: a
station or channel plays, a saved channel or series opens its page. Each shelf
takes its items' majority shape; station art is square and fills its tile.
The tile or row of what plays carries the [level](../design.md#motion).
