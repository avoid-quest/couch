# Browse

## Search

The header's palette ([Shell](shell.md#search-field)) submits to
`/search?q=…&kind=…&source=…`; an empty query is Discover. Every source is asked
at once and answers independently. Counts and "still asking" are a
screen-reader status; on screen the header's Spinner and a skeleton in the
results' geometry (a closest match, then a shelf of tiles; one kind's grid when
a kind is chosen) show the wait.

**The scope is the field's token.** A kind and a source live in the URL
(`/search?q=jazz&kind=music&source=Bandcamp`, kind one of
`films|live|radio|music|videos`) and show as the header field's tokens: choosing
one on the page changes the token, and changing the token in the palette
re-scopes the page in place, without asking the sources again. A scope chosen
in the palette applies before any result arrives (its skeleton shows); if it
holds nothing once the sources have answered, the page says "Nothing in Music
on Bandcamp for “jazz”" with "Show all N results", which clears it.

Each source declares the kinds it can return (`sourceKinds` in `search.ts`:
Bandcamp and SoundCloud music, the catalogues films and series, the radio lists
radio, and so on). Under a kind, only those sources are waited on, counted as
still asking, or reported: a failure from a source that never returns the kind
isn't shown. Sources that didn't answer close the page in one muted line,
"StreamingCommunity, AnimeSaturn and AnimeUnity didn't answer. Try again", so
the results lead; their reasons wait on the source's own page. A Details page's
neighbours (More from …) report the same way.

**Filters from the results** (`SearchFilters`). The token already names the
scope, so the page doesn't repeat it as a heading: its two lines are a quiet
index of what was found, for moving sideways (Music to Videos in one press,
which the token can't do) and for the TV, whose header is far from the results.
A combination with nothing in it can't be chosen here.

- **Kinds**: one `text-sm` medium line above the results, All then each kind
  with hits in the shelves' order (Films & series, Radio, Live, Music, Videos),
  each with its count; muted, the chosen kind in white. These are the page's
  only counts: a kind counts every hit of it, the closest match and Channels
  and lists (under Videos) included, and no heading counts again. A kind appears once a
  source returns a hit of it, fading in (200 ms, `motion-safe`) where that
  order puts it; none leaves while the query's sources answer. A kind the
  token chose shows too, while the query found anything.
- **Sources**: once a kind or a source is chosen, a lighter line under it of
  the sources with hits of that kind, each with its count. It shows when there
  are two or more, or one is chosen; pressing one narrows to it (white, with ×)
  and pressing it again shows every source. Its height is held while the kind
  is chosen, so a second source arriving moves nothing.

Choosing a kind keeps the source when it can return that kind and has hits of
it, otherwise every source. On a phone each line scrolls sideways, keeping the
chosen option in view as others arrive before it. On the TV each line is a
`data-nav-row`: Left and Right move, Down goes from the kinds to the sources,
OK chooses and the focus stays; the page still starts on the closest match.

A query word matches the start of a word in a hit. The **closest match** of the
chosen kind leads, laid out like Home's hero at a smaller size: artwork in its
shape's frame at a set height, title, one meta line and its links, then its
verbs (Save as the bookmark toggle) with `data-page-first`, and up to three
lines of description without addresses. On a phone the artwork sits beside the
title at a fifth of the height and the description goes, so the first screen
reaches the shelves. It holds still once shown, per query and kind. With All,
each kind follows as a shelf of twelve (More reveals the rest) under a heading
that opens that kind: Films and series (posters), Radio and Music (squares),
Live now and Videos (frames), Channels and lists (circles). One kind fills the
page as a wrapping grid without its heading or the twelve-tile cap; Videos
keeps Channels and lists as a shelf under it. Every tile captions the same way
([Captions](#rows-and-tiles)): title, one meta line (the byline its links don't
already give, what an openable hit is, its length; never when it would end),
then its links, the channel once. Hits that mention no query word wait behind
"Show N results that don't mention …".
Nothing at all for the query is "Nothing found", with Add a source and no
filters. A pasted link opens here as a page or as direct media ("Choose how to
play" in the palette); Enter in the palette plays it at once.

Twitch results refresh every 20 s while visible and connected.

## Discover

`/discover`: shelves of tiles under linked headings, with no hero and no
visible title. Its sections, in the order and visibility chosen in Settings →
Home & Discover:

- **Shared sources**, while devices share screen or sound: a row of names;
  pressing one plays it, its menu holds Play on, Play next and Queue.
- **Radio**: the stations Home's Radio doesn't hold (Couch's built-in ones you
  haven't played here or saved), each with its current show; with every
  station on Home, or Home's Radio hidden, every station, so the heading stays.
  A tile plays; its menu holds Details. The heading opens `/discover/radio`.
  Stations a device has loaded show at once, before their shows: a tile keeps
  room for its show's line.
- **Live TV**, while a Live TV source has channels: the guide's first twelve.
  A tile plays its channel; the heading opens `/discover/live-tv`.
- **One shelf per source with a home** (Twitch, StreamingCommunity, RaiPlay,
  123MoviesFree, AnimeSaturn, AnimeUnity): the channels and series saved from
  it, in Saved's order, live channels first. Core asks Twitch which saved
  channels are live as it lists them (one query, at most every 20 s); an
  offline channel stays, its artwork dimmed, reading "Offline". A page's
  section (RaiPlay's "In Diretta", `#block=`) belongs to that page, which the
  heading opens: it stays out of the shelf, and Save isn't offered for one
  (one saved before keeps Saved, to remove it). The heading (the source's
  name) opens the source's own home. A source with nothing saved has no shelf;
  with nothing saved anywhere, one line says to save channels or series to see
  them here.
- **Sources**: every source as one row of names. A source with a home opens
  it; YouTube, Bandcamp and SoundCloud scope the header's search to themselves.
  A source whose latest answer here failed (its home, a page or a search) is
  muted over "Couldn't load"; it still opens, to try again.

Shelves load side by side at a fixed height so nothing below moves; one that
fails says "Couldn't load {source}." with Try again. TV page entry goes to the
first available section's first control, and moves to an earlier section that
finishes loading until the user acts. With every section hidden or empty, an
Empty links to Settings (`#customize-discover`).

**Radio** (`/discover/radio`) and **Live TV** (`/discover/live-tv`) are lists
with a breadcrumb to Discover and the filter row: Radio's source choice
(`radioSource`: Built-in, Couch's own station list; Playlists; Directory) and
Filter; Live TV's group (`group`) and Filter, with each channel's now and next
from the XMLTV guide on its meta line. Filters and page live in the URL. A
channel has no page: pressing it plays, its menu holds Play on and Queue. Live
TV shows its filters once the guide answers; with no channels at all, an admin
gets "No channels yet" with Add a playlist (Settings → Sources → Live TV) and
anyone else one line, "No channels yet. An admin can add a playlist."; Radio's
empty Playlists does the same.

Catalogue homes (StreamingCommunity, 123MoviesFree, AnimeSaturn, AnimeUnity)
are poster grids sized by the available width; other source pages are rows.
A cold load draws the rows or posters it becomes, and Filter waits for
something to filter. A source that moved (StreamingCommunity) says so in its
Alert with Set site address for an admin, beside Try again.

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

An item that is gone reads "Item not found" with Search (the header's field)
and Back.

Item pages (`/item`: History, For later, a station, an Up next entry) and
collection pages (`/collection`: a source's home, a series, season, album,
channel, film or episode) have their own URLs, so refresh and Back restore
them with scroll and focus.

They open on `DetailHeader`, laid out like Home's hero. The artwork has one
geometry per shape (`detailArt`, `art-shape.ts`), sized by height so each
carries about the same weight: posters 20rem tall, squares 16rem, circles
14rem, frames 13.5rem (smaller on phones), filling the frame, the width
following the shape and capped at 45% of the row, so the title follows it
(stacked below `md`); a station's logo is contained. The artwork lights the
page around it ([Light](../design.md#light)), from its top edge down, so the
trail's muted links above it stay on black. Then the title, one meta
line, its links (a creator; the collections holding it are already the trail,
so they aren't repeated), a `DurationBar` when the length is known (a video's
"9:07"), one row of verbs, then the synopsis without bare addresses (a line
that only labelled one goes too), three lines until More. A channel's tab
("Stanford - Videos") is titled as the channel, a circle, and its trail stops
before it.

The verbs: Play (Play all; Resume with From start once partly watched), Queue,
Play on while another device can play it, Save as a bookmark that fills once
saved (one fixed-width toggle, `aria-pressed`, named Save), then "…" for the
rest (Remove from Continue, Move up/down, Play next, Open in browser…). The
primary verb carries `data-page-first`. A series names the episode its Play
starts: "Resume S1 E1" while one is part watched, else "Play S1 E2", the next
unwatched episode of the season last played (the first season otherwise); a
series of seasons reads that season's episodes for it, and until it can, Play
plays the first season from its start ("Play S1 E1"). Seasons, episodes and
nearby items follow as divided rows: an episode goes by its name ("Episodio
1", "S1 E1, 36:00" on its meta line), and a link every row shares (its season,
its channel) is left to the header and the trail; an album's tracks are a tracklist of
number, title and time, with nothing the page already says (cover, artist,
album). A page ends with its own content.

**Open in browser** appears in an item's menu when it has an original page
(provider media and collections, History, For later, Up next, stations with a
homepage). It opens on the device you hold (a tab, or the system browser from
the app) and never travels through Remote.

## Saved

`/saved`, one section per `?tab=`: For later, Channels & stations (saved
channels, playlists, albums and series, then favourite stations), Lists and
Played (History, newest first). A rail on wide screens (left rule on the
current entry, no heading, counts only when not zero) and a Select on phones
choose the section; the rail names the page. Without a `?tab=`, Saved opens the
first section that holds something (For later when all are empty), then names
it in the URL; while the counts arrive it draws loading rows, so an empty
section is never opened only to say so, and one known to be empty never shows
loading rows. Every section's rows read alike: one meta
line by the caption rules (Played adds what's left, "4:11 left") and a "…"
holding the row's verbs (Played: Play or Resume, Play on, Queue, Open in
browser); Details holds the rest. Lists shows Save as list at its top once
Up next holds something or a list exists; with neither, only the Empty speaks.
A list keeps its own title and verbs. An empty tab says what goes there and
offers Discover. Removing says "Removed … from Saved." with Undo. Artwork this
page has already shown appears at once on every tab; only a cold load fades.

## Rows and tiles

**`MediaRow` / `MediaList`**: thumbnail, title, meta and length bar as one
target whose press does the main verb (Play for stations, channels and live
hits, else Open or Details), with the row's menu behind an always-visible "…"
at the end of the title's line. A pointer over a row tints all of it, artwork
and "…" too. The thumbnail takes the list's majority shape at about one height
(a compact square is 4rem, a compact frame 7rem wide), and a word every row
shares (RaiPlay's "Programme") is left out, in a row or a shelf. Relationship
links sit under the meta. A row whose page already holds every verb may hide
its "…" (`menuOnPage`) but still opens the menu by right-click, long press or
held OK. A list's own entries keep Remove and a drag handle. A tracklist row
(`number`) is the track's number, its title and its time at the end of the
title's line, without artwork.

**What plays** carries the [level](../design.md#motion) wherever it is listed
(Home, Discover, Search, Saved, Radio, a source's pages): a black square at its
artwork's bottom-left corner with the bars in white, or, in a tracklist, in
place of its number. A row or tile knows it by its addresses (`source`: its
page, or a station's `radio:` source and stream), matched against what the
looked-at Playback plays.

**`MediaTile`**: one Button around `MediaArtwork` at its shelf's shape
(`--tile-art` sets the height: posters 18rem, frames 11rem, or half the column on a
narrow phone, squares 12rem, circles 10rem), a title of up to two lines and
one meta line, plus a `DurationBar` on Continue. A shelf lays its tiles on one
grid (artwork, caption, links, a sibling such as Continue's Details; CSS
subgrid), each row as tall as its tallest tile: captions end level and links
line up, with no room kept for a second title line no tile has, while each
meta line follows its own title. Outside a shelf (a wrapping grid) the caption
keeps the room of two title lines and a meta line. A pointer over a tile draws a hairline round its
artwork and tints its caption ([Hover](../design.md#tokens)); where the press
plays or resumes, the artwork also dims under a white Play disc, for a pointer
or keyboard focus. The "…" sits over the end of the
title's first line; a pointer sees it over or inside the tile, touch always;
on the TV it is always shown and no focus stop unless the press is disabled.

**Captions** read as one line of parts joined by commas ("YouTube, 10:34";
a provider's own "Game · 1,204 viewers" becomes "Game, 1,204 viewers"). An
episode leads with its series ("Phony") and its meta with "S1 E1, Episodio 1",
wherever tiles, rows or the hero show it.

**`Shelf`**: an optional linked heading (a focus stop) over a plain overflow
row (`data-nav-row`), never a Carousel, so spatial navigation and focus scroll
work natively. Search kinds and Discover's shelves use it too.

**`MediaArtwork`** fills its frame when the art matches the frame's shape and
is contained otherwise. Without any it is a cover set in type: the muted fill
with the title large (semibold, 13% of the frame's width, three lines at most)
at its top left, so a poster, a square and a frame each read as the item's own
cover; a frame under 8rem (a row's, the bar's or a suggestion's thumbnail)
holds the title's first letter instead, and a collection a folder. An address
that has loaded once in the page shows at once wherever it appears again (a
tab switch, Back); only a first load fades in.

### Artwork shapes

`artShape` (`src/client/art-shape.ts`) gives each kind of item one shape:
posters (2:3) for films and series from the catalogues, and Twitch's
categories; frames (16:9) for videos, episodes, streams, RaiPlay's programmes
and Live TV; squares for music (Bandcamp, SoundCloud) and stations; circles for
channels and artists (YouTube, Twitch). A shelf or a list takes its majority
shape (`majorityShape`): art of that shape fills it, art of another shape (and
a channel logo) is contained in it, unclipped by a circle it doesn't fill; a
channel's avatar stays a circle, the frame's height, in a frame of another
shape. Artwork still loading holds the muted fill rather than black. Details and Search's closest match draw the
item's own shape ([Details](#details)).

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
  up to 18rem. A cursor-paged source names it "Filter this page". On a
  collection it waits for more than a glance holds: over 20 rows, another
  page, or a filter already set, so one season or eight tracks show none.

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
the collections holding it ("Discover › StreamingCommunity › Series"), then
the h1, which names the page; no separator follows the last crumb. One line of small
muted text; out of room, the longest crumbs truncate first. Esc and the TV's Back
still go back in history, restoring focus.

## Play on in menus

Play on targets are a labelled group inside an item's menu, with wrapping
device names, bounded to the viewport height. What Play on offers:
[Where it plays](where-it-plays.md#play-on).
