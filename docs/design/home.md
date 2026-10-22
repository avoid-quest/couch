# Home

Home (`HomePage`) is one large item, the hero, on Home's
[Stage](../design.md#stage), then shelves of tiles. Narrow screens stack the
Stage (`md:`); the TV hides the shelves' scrollbars.

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
   [transport](player.md#transport) on the same line. While this hero is on
   screen the now-playing bar hides; scrolled away, the bar returns.
2. **The first Continue item**: its progress line beside "10:32 left", as
   Details shows it (it isn't playing, so no end time); Resume, From start,
   Details.
3. **The first station on air**: Play.

The hero's picture lights the board's top ([Light](../design.md#light)),
whichever item it shows. An episode leads with its series ("Phony", then "S1 E1, Episodio 1" on the
meta line). Radio and live media show no progress or time. The primary verb
carries `data-page-first`. The hero waits for the data that decides it
(session, history, stations) so it never swaps under the focus, and the shelves
wait with it.

## Shelves

Continue, For later, Radio, Played recently and Up next (off by default), in
the order and visibility chosen in Settings → Home & Discover. A shelf shows
only with something in it. Radio holds your stations: those this device played
lately, then the saved ones; Couch's built-in stations are Discover's
([Discover](browse.md#discover)), so no station is on both. With nothing at
all, Home says "Find something to play" and offers Discover.

A heading is the shelf's name, with no count (Up next adds "until 23:10"). A
shelf holds up to twelve; where the rest has a page the heading links to it
with a chevron: Continue and Played recently → Saved's Played, For later →
Saved, Radio → Discover's Radio. Up next ends with "N more", opening Up next.

Shelves keep their order while Home stays open and never hold the hero's item:
the one that led Home when it opened, nor the one leading it now (after Stop,
the next hero's item leaves Continue).
They are plain overflow rows (`data-nav-row`) without paging buttons: a
pointer scrolls them, touch swipes, keyboard and remote move focus. From `md`
up a shelf of one or two tiles takes only their width (`sparse`), so short
shelves share rows as one board ("Continue", "For later" and "Radio" on one
line, "Played recently" on the next) rather than stacking a column of lone
tiles; a full shelf takes the line. Phones and the TV keep one shelf per row,
so Up and Down still go shelf to shelf.

## Tiles

Each item is one [`MediaTile`](browse.md#rows-and-tiles) whose press does its
main verb: Continue resumes, a station plays, an Up next entry plays now,
everything else opens Details. Other verbs, and where the item leads ("Go to
Stanford"), are its menu; on Continue its first verb is Details, which a remote
reaches with a held OK. Continue's progress is a line on the artwork's foot,
its meta ends with what's left ("YouTube, 4:11 left"). Up next tiles read their
length and end time ("4:52, ends 21:47").
Each shelf takes its items' majority shape; station art is square and fills
its tile. The tile of what plays carries the [level](../design.md#motion).
