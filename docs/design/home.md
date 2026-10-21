# Home

Home (`HomePage`) is one large item, the hero, then shelves of tiles. Narrow
screens stack the hero (`md:`); the TV hides the shelves' scrollbars.

## The hero

Contained artwork beside a large title, a muted meta line, relationship links,
the end time when known, then the verbs. Its item is the first of:

1. **What you control, playing now.** Meta: the station or subtitle, a status
   only when it isn't plain playing or paused, and "on {device}" when it plays
   elsewhere. Verbs: Open player, then the [transport](player.md#transport).
   While this hero is on screen the now-playing bar hides; scrolled away, the
   bar returns.
2. **The first Continue item**: Resume, From start, Details.
3. **The first station on air**: Play.

Radio and live media show no time. The primary verb carries
`data-page-first`. The hero waits for the data that decides it (session,
history, stations) so it never swaps under the focus, and the shelves wait
with it.

## Shelves

Continue, For later, Radio, Played recently and Up next (off by default), in
the order and visibility chosen in Settings → Home & Discover. A shelf shows
only with something in it; Radio always has the built-in stations. With
nothing at all, Home says "Find something to play" and offers Discover.

A heading is the shelf's name, with no count (Up next adds "until 23:10"). A
shelf holds up to twelve; where the rest has a page the heading links to it
with a chevron: Continue and Played recently → Saved's Played, For later →
Saved, Radio → Discover's Radio. Up next ends with "N more", opening Up next.

Shelves keep their order while Home stays open and leave out the hero's item.
They are plain overflow rows (`data-nav-row`) without paging buttons: a
pointer scrolls them, touch swipes, keyboard and remote move focus.

## Tiles

Each item is one [`MediaTile`](browse.md#rows-and-tiles) whose press does its
main verb: Continue resumes, a station plays, an Up next entry plays now,
everything else opens Details. Other verbs are its menu. Continue adds a
sibling Details button (44px) so a remote reaches History's verbs without a
held OK. Up next tiles read their length and end time ("4:52, ends 21:47").
Station art is square and fills its tile.
