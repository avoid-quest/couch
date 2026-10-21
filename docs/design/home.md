# Home

## Home starts with the media

Home opens on one large item, the hero, then shelves of tiles, the way Apple
TV and Infuse do. Discover is its sibling, built of the same shelves and
tiles ([Browse](browse.md#discover)). The TV, the desktop window and phones render the same tree
(`HomePage`) with the same layout; narrow screens stack the hero (`md:`), and
a pointer gets the shelves' scrollbars, which the TV hides.

## The hero

The hero pairs contained artwork with a large title. Small metadata supplies
context; related content is directly linked below the title. Runtime or Live
follows quietly, then the actions. Artwork stays intact on black, without a
blurred backdrop. A divider separates the hero from the shelves. Its item is the first of:

1. what you control, playing now: its meta reads the station or subtitle (else
   the source, or "Radio" for a station, as the player's does, never a stream's
   hostname), Paused or Loading…, and "on {device}" (+N) as the now-playing
   bar does; its verbs are Open player, then the player's
   [transport](player.md#transport);
2. the first Continue item: Resume, From start and Details (Continue's Details
   stop, below);
3. the first station on air: Play.

Radio and live media read "Live": a station's programme data says when it
expires (about every 15 minutes), not when the show ends, so on air has no
"until" time. Continue leads only while its shelf is shown, and a station only
while Radio is. The primary verb carries `data-page-first`, so page entry lands
on it, and when Resume or From start plays where Home stays open, focus moves
to the playing hero's Open player. Below `md` the hero stacks artwork, text,
then verbs, with the primary verb full-width. It waits for the data that decides it (the session, then
history, then the stations) so it never swaps under the focus while loading,
and the shelves wait with it.

## Shelves

The shelves follow in Settings → Home's per-device order and visibility:
Continue, For later, Radio, Played recently and Up next (off by default; it
stays reachable from the now-playing bar and the player band). Saved
visibility always applies. A shelf appears only with something in it, and Radio
always has the built-in stations, so a fresh Couch opens on something playable.
Home ends with its content; with none at all it says "Find something to play"
and offers Discover.

Each shelf's heading names it, then adds quiet context: "3
unfinished", "On air now", "2 saved", "4 titles", "until 23:10" (Up next ends
then). A shelf holds at most twelve; where the rest has a page, the heading is
a link with a chevron that opens it: Continue and Played recently open
Saved's Played, For later opens Saved, and Radio opens Discover's every
station. It is one focus stop between its shelf and the one above, so Up
from a shelf meets its heading, then the shelf above. Up next's heading has
no link: its shelf ends with "N more" when it holds more than fits, which
opens Up next beside Home.

A shelf takes its order once its data and the hero are known, and keeps it
while Home stays open, so nothing moves under the focus. It leaves out the
item that led Home then, so the hero's item never repeats below it. A station
that starts playing stays where it is, marked Playing, and the hero that
replaces the old one doesn't bring it back; the next visit to Home composes
afresh.

## Tiles everywhere

Every item is one [`MediaTile`](browse.md#mediatile), one primary target on every
screen, and its press does its main verb: Continue resumes, a station plays,
an Up next entry plays now, everything else opens its page, which holds every
verb. Related content has visible sibling links. Its other actions (From start,
Queue, Save, Play on…) are its one
menu, behind the "…" in its caption ([Menus](../design.md#menus)). Continue
alone adds a sibling secondary Details button (at least 44px): Resume's
playback destination lacks its history actions, and a remote reaches it
without a held OK. It opens History Details without playing, even when
Resume is unavailable. Up next tiles read their length and the clock time
each ends ("4:52, ends 21:47").

Shelves are plain overflow rows (`data-nav-row`); a pointer scrolls them by
their thin scrollbar or the Previous/Next controls beside the heading.
Touch swipes and TV focus scrolling use the same native overflow row.
The paging controls are hidden on touch and TV. How the TV walks them: [TV](tv.md#every-journey-step-works-with-a-remote).

Shelf menus share [Open in browser](browse.md#open-in-browser) when the item
has an original page, including Continue, Played recently, For later and Up next.
