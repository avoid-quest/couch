# Browse

## Search

The header's field ([Shell](shell.md#search-field)) submits to `/search?q=…`;
an empty query is Discover. Every source is asked at once and answers
independently; failures, with Try again, sit above the results. Counts and
"still asking" are a screen-reader status; on screen the header's Spinner and
skeleton rows show the wait.

Search narrows its results with filters made from them (`SearchFilters`),
never a fixed list: a combination with nothing in it can't be chosen.

- **Kinds**: one line of type above the results, All then each kind with
  hits in the shelves' order (Films & series, Radio, Live, Music, Videos):
  `text-lg` medium, muted, the chosen kind in white. A kind appears once a
  source returns a hit of it, fading in (200 ms, `motion-safe`) where that
  order puts it; none leaves while the query's sources answer.
- **Sources**: only once a kind is chosen, a lighter `text-sm` line under it
  of the sources with hits of that kind, each with its count. It shows only
  when there are two or more; pressing one narrows to it (white, with ×) and
  pressing it again shows every source. Its height is held while the kind is
  chosen, so a second source arriving moves nothing.

Choosing a kind keeps the source when it has hits of that kind, otherwise
every source. Both live in the URL
(`/search?q=jazz&kind=music&source=Bandcamp`, kind one of
`films|live|radio|music|videos`), and a new query from the header keeps them.
A kind or source the URL asks for applies while sources answer (its skeleton
shows) and, if it has nothing once they have, the results show everything; a
source from an artist link shows pressed under All. On a phone each line
scrolls sideways, keeping the chosen option in view. On the TV each line is a
`data-nav-row`: Left and Right move, Down goes from the kinds to the sources,
OK chooses and the focus stays; the page still starts on the closest match.

A query word matches the start of a word in a hit. The **closest match** of the
chosen kind leads, laid out like Home's hero at a smaller size with its verbs
(Save among them) and `data-page-first`; it holds still once shown, per query
and kind. With All, each kind follows as a shelf of twelve (More reveals the
rest) or a list, its heading opening that kind: Films and series (posters),
Radio and Music (squares), Live now (frames), Videos and Channels and lists
(rows). One kind fills the page without its heading or the twelve-tile cap, as
a wrapping grid or, for Videos, a list with Channels and lists under it. Hits
that mention no query word wait behind "Show N results that don't mention …".
The only empty state is nothing at all for the query: "Nothing found", with
Add a source. A pasted link opens as a page or as direct media.

Twitch results refresh every 20 s while visible and connected.

## Discover

`/discover`: shelves of tiles under linked headings, with no hero and no
visible title. Its sections, in the order and visibility chosen in Settings →
Home & Discover:

- **Shared sources**, while devices share screen or sound: a row of names;
  pressing one plays it, its menu holds Play on, Play next and Queue.
- **Radio**: saved stations, then the built-in ones, each with its current
  show. A tile plays; its menu holds Details. The heading opens
  `/discover/radio`.
- **Live TV**, while a Live TV source has channels: the guide's first twelve.
  A tile plays its channel; the heading opens `/discover/live-tv`.
- **One shelf per source with a home** (Twitch, StreamingCommunity, RaiPlay,
  123MoviesFree, AnimeSaturn, AnimeUnity): the channels and series saved from
  it, in Saved's order. The heading (the source's name) opens the source's own
  home. A source with nothing saved has no shelf; with nothing saved anywhere,
  one line says to save channels or series to see them here.
- **Sources**: every source as one row of names. A source with a home opens
  it; YouTube, Bandcamp and SoundCloud scope the header's search to themselves.

Shelves load side by side at a fixed height so nothing below moves; one that
fails says "Couldn't load {source}." with Try again. TV page entry goes to the
first available section's first control, and moves to an earlier section that
finishes loading until the user acts. With every section hidden or empty, an
Empty links to Settings (`#customize-discover`).

**Radio** (`/discover/radio`) and **Live TV** (`/discover/live-tv`) are lists
with a breadcrumb to Discover and the filter row: Radio's source choice
(`radioSource`) and Filter; Live TV's group (`group`) and Filter, with each
channel's now and next from the XMLTV guide on its meta line. Filters and page
live in the URL. A channel has no page: pressing it plays, its menu holds
Play on and Queue.

Catalogue homes (StreamingCommunity, 123MoviesFree, AnimeSaturn, AnimeUnity)
are poster grids sized by the available width.

## Hide

A provider item's menu (a search hit, a source page's row or poster) ends with
**Hide**: it hides that item at once, with Undo, on every device. Core keeps
the rules (`/api/hidden`, `src/server/hidden.ts`) as an item (source and
address) or a word matched in the title, subtitle, creator or collection.
Rules apply where provider items become hits (`SearchOnlineResults`), so
Search and source pages drop them; radio stations, Live TV channels and
Discover's saved shelves are not filtered. Settings → Sources → Hidden lists
the rules with Remove, under a "Hide a word" field.

## Details

Item pages (`/item`: History, For later, a station, an Up next entry) and
collection pages (`/collection`: a source's home, a series, season, album,
channel, film or episode) have their own URLs, so refresh and Back restore
them with scroll and focus.

They open on `DetailHeader`, laid out like Home's hero: contained artwork at
its own aspect ratio (stacked below `md`), the title, one meta line, a
`DurationBar` when the length is known, one row of verbs, then the synopsis.
The verbs: Play (Play all; Resume with From start once partly watched), Queue,
Save / Saved, Play on while another device can play it, then "…" for the rest
(Remove from Continue, Move up/down, Play next, Open in browser…). The primary
verb carries `data-page-first`. Seasons, episodes, tracks and nearby items
follow as divided rows; a page ends with its own content.

**Open in browser** appears in an item's menu when it has an original page
(provider media and collections, History, For later, Up next, stations with a
homepage). It opens on the device you hold (a tab, or the system browser from
the app) and never travels through Remote.

## Saved

`/saved`, one section per `?tab=`: For later, Channels & stations (saved
channels, playlists, albums and series, then favourite stations), Lists and
Played (History, newest first). A rail on wide screens (left rule on the
current entry, no heading, counts only when not zero) and a Select on phones
choose the section; the rail names the page. Lists keeps Save as list at its top; a list keeps its own
title and verbs. An empty tab says what goes there and offers Discover.
Removing says "Removed … from Saved." with Undo.

## Rows and tiles

**`MediaRow` / `MediaList`**: thumbnail, title, meta and length bar as one
target whose press does the main verb (Play for stations, channels and live
hits, else Open or Details), with the row's menu behind an always-visible "…"
at the end of the title's line. Relationship links sit under the meta. A row
whose page already holds every verb shows no "…" (`menuOnPage`: For later's
and a list's rows) but still opens the menu by right-click, long press or held
OK. A list's own entries keep Remove and a drag handle.

**`MediaTile`**: one Button around `MediaArtwork` (2:3 films and series, 1:1
stations and albums, 16:9 videos and episodes; `--tile-art` sets the height),
a title and one meta line, plus a `DurationBar` on Continue. The "…" sits over
the end of the title's first line; on the TV it is no focus stop unless the
press is disabled.

**`Shelf`**: an optional linked heading (a focus stop) over a plain overflow
row (`data-nav-row`), never a Carousel, so spatial navigation and focus scroll
work natively. Search kinds and Discover's shelves use it too.

**`MediaArtwork`** keeps artwork contained; without any it draws a hairline
frame with the title set in muted type (a folder for collections).

Every named relationship with a known destination (channel, artist, album,
series, station, source) is an internal link (`ContentLink`, `MediaContext`),
deduplicated, never guessed from text. Bandcamp and SoundCloud artists use the
source-scoped search.

## Filters and pages

Radio, Live TV and source pages share one row (`ContentFilters`):
`FilterBar` with the choices first, then the text field, wrapping on phones.
Nothing is labelled on screen (each control has an aria-label) and no count
sits between the filters and the results. Search has its own
([Search](#search)).

- `FilterChoice`: a few choices (Radio's sources) as an underlined Toggle
  Group; Left and Right move along it and past its ends. On a phone it stays
  one line that scrolls sideways.
- `FilterSelect`: many choices (Live TV's groups) as a compact Select whose
  value names it.
- `FilterInput`: a search glyph, "Filter", and Clear only while it holds text;
  up to 18rem. A cursor-paged source names it "Filter this page".

Filters live in the URL; changing one keeps focus where it is. Local filters
use cached items; Live TV debounces by 200 ms and dims the old channels
meanwhile.

`BrowsePagination` sits under the list, only with more than one page:
Previous, "Page N of M" (a borderless Select) and Next. Cursor-paged sources
show it while there is a page before or after and never invent a last page.
Turning a page moves focus to the list's top.

## Breadcrumbs

`ContentBreadcrumb` (shadcn's Breadcrumb) puts a sub-page's ancestors above its
h1, each a link: the section it opened in, Radio or the source's home, then
the collections holding it ("Discover › StreamingCommunity › Series ›"), the
last separator leading into the h1, which names the page. One line of small
muted text; out of room, the longest crumbs truncate first. Esc and the TV's Back
still go back in history, restoring focus.

## Play on in menus

Play on targets are a labelled group inside an item's menu, with wrapping
device names, bounded to the viewport height. What Play on offers:
[Where it plays](where-it-plays.md#play-on).
