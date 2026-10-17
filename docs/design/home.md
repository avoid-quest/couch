# Home

## Home is a departures board

Home opens on one large item, the hero, then shelves of tiles, the way Apple
TV and Infuse do. The TV, the desktop window and phones render the same tree
(`HomePage`); they differ in layout (`tv:` classes, and `md:` where narrow
screens stack), not in which components they render.

## The hero

The board's top line, and the one place Home spends boldness. In order:
contained artwork at its own aspect ratio on black, never blurred, stretched or
cropped into a backdrop; the title at display size; one muted meta line; the
time it ends in tabular figures, the largest text after the title ("ends
21:42", or "Live"); then its verbs. Its item is the first of:

1. what you control, playing now: its meta reads the station or subtitle (else
   the source), Paused or Loading…, and "on {device}" (+N) as the now-playing
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
Home ends with its content.

Each shelf's heading names it, then, in muted ink, the time it matters at: "3
unfinished", "On air now", "2 saved", "4 titles", "until 23:10" (Up next ends
then). Its action (Edit for Up next, Browse for Radio, Open Library for For
later) sits at the heading's right on desktop and phones. The TV hides it: its
tab bar reaches Live and Library and its now-playing bar Up next, so Up from a
shelf meets only the shelves above it.

A shelf takes its order once its data and the hero are known, and keeps it
while Home stays open, so nothing moves under the focus. It leaves out the
item that led Home then, so the hero's item never repeats below it. A station
that starts playing stays where it is, marked Playing, and the hero that
replaces the old one doesn't bring it back; the next visit to Home composes
afresh.

## Tiles everywhere

Every item is one [`MediaTile`](browse.md#mediatile), one focus stop on every
screen, and its press does its main verb: Continue resumes, a station plays,
an Up next entry plays now, everything else opens its page, which holds the
other verbs (Play on, Queue, Save, Remove). Continue alone adds a sibling
secondary Details button (at least 44px): Resume's playback destination lacks
its history actions. It opens History Details without playing, even when
Resume is unavailable. Up next tiles read their length and the clock time
each ends ("4:52, ends 21:47").

Shelves are plain overflow rows (`data-nav-row`); the TV hides their
scrollbar. How the TV walks them: [TV](tv.md#every-journey-step-works-with-a-remote).
