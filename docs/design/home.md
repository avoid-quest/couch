# Home

Home (`HomePage`) begins with a compact featured item on Home's
[Stage](../design.md#stage), then personal artwork shelves, a compact queue
list, and sources in the device’s chosen order. The TV hides the
shelves’ scrollbars.

## The hero

The feature keeps whole artwork on the left and its title, relationship,
progress and actions together beside it. Its minimum height is `min(24vw,
23rem)` including the header; artwork is capped at 12rem high. Titles step
from 3rem to 2.25rem with length. A phone puts a 7.5rem-wide image beside the
title, then progress and actions across the width, where Resume fills the
action row and From start stays in Details. The feature's
item is the first of:

1. **What you control, playing now.** Meta: the station or subtitle, its
   source, and a status only when it isn't plain playing or paused. When it
   plays elsewhere, "on {device}" leads the links' line, as in the now-playing
   bar and the player ("on Living room  Lyl Radio"). A slim progress line advances as it plays
   beside "4:27 left, ends 22:01". No verbs: the now-playing bar right below
   holds the transport and Open player, so the Stage doesn't repeat them. Its
   title is the one stop (`data-page-first`, "Open player: {title}") and opens
   the player, as its picture does under a pointer.
2. **The first Continue item**: its progress line beside "11 min left", as
   Details shows it (it isn't playing, so no end time); Resume, From start,
   Details.
3. **The first station on air**: Play.

An episode leads with its series ("Phony", then "S1 E1, Episodio 1" on the
meta line). Radio shows broadcast progress and local start/end times only when XMLTV
supplies a current programme window. Other live media show no progress or time. The primary verb,
or the playing title, carries `data-page-first`. The hero waits for the data
that decides it (session, history, stations) so it never swaps under the
focus, and the rows wait with it.
When Play or Resume becomes the playing title, focus moves to that title if
the removed verb lost it, and stays put if the user moved to another control.

## Sections

Continue, For later, Played recently, Up next (off by default), Shared
sources, Radio, Live TV, one per source with a home (Twitch,
StreamingCommunity, RaiPlay, 123MoviesFree, AnimeSaturn, AnimeUnity) and
Sources, in the order and visibility chosen in Settings → Home
([Settings](settings.md)). They are 2.5rem apart. A section shows only
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

## Personal shelves and lists

Continue, For later and Played recently use full-width `MediaTile` shelves,
up to twelve items each. Every shelf uses the same spacing and captions,
regardless of which neighbours Settings enables. Whole artwork shares an
8.5–11.5rem height (11–15rem for all-poster shelves); each tile takes its picture's own width
(a letterboxed frame at 16:9, [Rows and tiles](browse.md#rows-and-tiles)), keeping the
caption and progress aligned with its edges. Continue resumes and carries
progress at the artwork's foot, with rounded minutes or hours left in its
caption. For later and Played recently open Details. Their menus keep
playback, queueing and related destinations; Continue's menu starts with Details.
Captions show episode identity or creator without repeating a provider or hostname.

For later's Home preview omits items already in Continue while Continue is
shown, and the currently playing URL. Saved retains the complete collection.
Up next remains a compact list (`HomeBoard`), at most four entries, with
length and end time. Its heading adds the end time and “N more” opens the queue.

Headings link to the complete Saved list with a chevron. Sections respect
Settings’ visibility and order. Without a hero, the first available personal
item remains the remote’s first focus stop. Loading sections hold their place.

## The sources

- **Shared sources**, while devices share screen or sound: a line of chips;
  pressing one plays it, its menu holds Play on, Play next and Queue.
  Live audio sources say **Join** and have no programme queue actions; leaving
  is in their player. The publisher stays a publisher and never monitors itself.
- **Radio**: one shelf of up to twelve stations, yours first (those this
  device played lately, then the saved ones), then Couch's built-in ones, each
  with its current show and its categories (else the station's tags), never the hero's station. A tile plays; its menu
  holds Details. The heading opens every station
  ([Radio](browse.md#radio-and-live-tv), `/radio`). Stations a device has
  loaded show at once, before their shows; a tile without a show stays level
  with the rest.
- **Live TV**, while a Live TV source has channels: the guide's first twelve.
  A tile plays its channel; the heading opens every channel (`/live-tv`).
- **One shelf per source with a home**: the channels and series saved from
  it, in Saved's order, live channels first. Core asks Twitch which saved
  channels are live as it lists them (a query per 100 channels, at most every
  20 s); an offline channel stays, its artwork dimmed, reading "Offline". A page's
  section (RaiPlay's "In Diretta", `#block=`) belongs to that page, which the
  heading opens: it stays out of the shelf, and Save isn't offered for one
  (one saved before keeps Saved, to remove it). The heading (the source's
  name) opens the source's own home. A source with nothing saved has no
  shelf.
- **Sources**, always there: every source as one line of `secondary` pill
  chips, scrolling in one line on phones. A source with a home opens it; YouTube, Bandcamp and SoundCloud scope
  the header's search to themselves. A source whose latest answer here failed
  (its home, a page or a search) is muted over "Couldn't load"; it still
  opens, to try again.

Shelves are native overflow rows (`data-nav-row`). When content overflows,
fine-pointer screens show Previous and Next buttons beside the heading, moving
one visible width at a time. Each disables at its respective edge and both
disappear when everything fits. Reduced motion makes paging immediate. Touch
swipes and the TV moves focus, without paging buttons; Up and Down go shelf to
shelf. The scrollbar remains available for direct scrolling. Each item is one
[`MediaTile`](browse.md#rows-and-tiles) whose press does its main verb: a
station or channel plays, a saved channel or series opens its page. Station art is contained in square frames; transparent station marks use a
neutral mid-grey ground so both dark and light lettering remain visible. Show
artwork keeps its own ground. Personal shelves use natural image proportions.
The tile or row of what plays carries the [level](../design.md#motion).
