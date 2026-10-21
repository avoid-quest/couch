# Home

Home (`HomePage`) is one large item, the hero, then shelves of tiles. Narrow
screens stack the hero (`md:`); the TV hides the shelves' scrollbars.

## The hero

The artwork large at its [true shape](browse.md#artwork-shapes) (a set height,
`min(26rem, 52vh)`, up to 55% of the row for a frame, 50% for a square, 40% for
a poster) beside the title at display size, then one muted meta line with its
relationship links, how far it got, and the verbs. Phones stack it, all at the
text's left edge: a frame takes the column's width, a square or a poster a set
height, and the primary verb grows along the verbs' one line. Its item is the
first of:

1. **What you control, playing now.** Meta: the station or subtitle, its
   source, a status only when it isn't plain playing or paused, and "on
   {device}" when it plays elsewhere. A slim progress line advances as it plays
   over "4:27 left, ends 22:01". Verbs: Open player, then the
   [transport](player.md#transport) on the same line. While this hero is on
   screen the now-playing bar hides; scrolled away, the bar returns.
2. **The first Continue item**: its progress line over "10:32 left", as
   Details shows it (it isn't playing, so no end time); Resume, From start,
   Details.
3. **The first station on air**: Play.

The hero's artwork lights the board's top ([Light](../design.md#light)),
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
pointer scrolls them, touch swipes, keyboard and remote move focus.

## Tiles

Each item is one [`MediaTile`](browse.md#rows-and-tiles) whose press does its
main verb: Continue resumes, a station plays, an Up next entry plays now,
everything else opens Details. Other verbs are its menu. Continue adds a
sibling Details button (44px) so a remote reaches History's verbs without a
held OK. Up next tiles read their length and end time ("4:52, ends 21:47").
Each shelf takes its items' majority shape; station art is square and fills
its tile. The tile of what plays carries the [level](../design.md#motion).
