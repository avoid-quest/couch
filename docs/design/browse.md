# Browse

## Search

Search keeps its submitted query and filters while the next page loads. Leaving
it never starts an empty search across the sources or flashes unfiltered results
(`tests/search-navigation.browser.tsx`).

The header's palette ([Shell](shell.md#search-field)) submits to
`/search?q=…&kind=…&source=…`; an empty query is Home. Eligible sources are asked
at once and answers independently. Counts and "still asking" are a
screen-reader status; on screen the header's Spinner and a skeleton in the
results' geometry (a closest match, then a shelf of tiles; one kind's grid when
a kind is chosen) show the wait.

**The scope is the field's token.** A kind and a source live in the URL
(`/search?q=jazz&kind=music&source=Bandcamp`, kind one of
`films|live|radio|music|videos|audio`) and show as the header field's tokens: choosing
one on the page changes the token, and changing the token in the palette
re-scopes the page in place, reusing answers already held. A scope chosen
in the palette applies before any result arrives (its skeleton shows); if it
holds nothing once the sources have answered, the page says "Nothing in Music
on Bandcamp for “jazz”" with "Show all N results", which clears it.

Each source declares the kinds it can return (`sourceKinds` in `search.ts`:
Bandcamp and SoundCloud music, the catalogues films and series, the radio lists
radio, and so on). Audio searches YouTube, Bandcamp and SoundCloud together,
including music videos, while skipping film, series, TV and radio catalogue
requests and any results held from them. Recognized songs open this scope.
Under a kind, only those sources are waited on, counted as still asking, or
reported: a failure from a source that never returns the kind
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
shape's frame at a set height (14rem), the title at 2.25rem, one meta line and its links, then its
verbs (Save as the bookmark toggle) with `data-page-first`, and up to three
lines of description without addresses. On a phone the artwork sits beside the
title at a fifth of the height and the description goes, so the first screen
reaches the shelves. It holds still once shown, per query and kind. With All,
each kind follows as a shelf of twelve (More reveals the rest) under a heading
that opens that kind: Films and series (posters), Radio and Music (squares),
Live now and Videos (frames), Channels and lists (circles). One kind fills the
page as a wrapping grid without its heading or the twelve-tile cap; Videos
keeps Channels and lists as a shelf under it. Every tile captions the same way
([Captions](#rows-and-tiles)): title, one meta line (the byline, what an
openable hit is, its length, then its source; never when it would end); its
links are its menu's "Go to …". Hits that mention no query word wait behind
"Show N results that don't mention …".
Nothing at all for the query is "Nothing found", with Add a source and no
filters. A pasted link opens here as a page or as direct media ("Choose how to
play" in the palette); Enter in the palette plays it at once.

Twitch results refresh every 20 s while visible and connected.

## Radio and Live TV

Home's sources ([Home](home.md#the-sources)) sample what Couch can play; two
of their headings open pages of their own. **Radio** (`/radio`) and **Live
TV** (`/live-tv`) are lists with a breadcrumb to Home and the filter row:
Radio's source choice (`radioSource`: Built-in, Couch's own station list;
Playlists; Directory), Genre (`genre`, the station tags and show categories the
list holds) and Filter (station, show, host, tag or category); Live TV's group (`group`) and Filter, with
each channel's now and next from the XMLTV guide on its meta line. Filters and
page live in the URL. A channel has no page: pressing it plays, its menu holds
Play on and Queue. Live TV shows its filters once the guide answers; with no
channels at all, an admin gets "No channels yet" with Add a playlist
(Settings → Sources → Live TV) and anyone else one line, "No channels yet. An
admin can add a playlist."; Radio's empty Playlists does the same.

Radio keeps a station's **tags** apart from its current show's **categories**.
Categories come from XMLTV and fresh live enrichment; playlist group
names remain source labels. Labels fold whitespace, Unicode form and case
without guessing genres or splitting compound labels. Neither is labelled on
screen; where a line sits says what it describes:

- **A row or tile** says what it plays: the show and its categories ("Early
  Bird, Jazz, Experimental"), else the station's tags and group. A row adds the
  next show as a schedule line, its start time light, as Live TV's guide says
  it ("22:12 Afternoon selections"). The station's tags wait on its Details.
- **Details and Home's hero** follow the Stage: the show's title, its
  categories and host, then the station with its tags ("NTS Radio, Community,
  Talk"; a link on Home), the progress line, the verbs, the synopsis. The
  player keeps its own order: the station's link and tags under the title, then
  categories and host. A host the show is named after ("DJ Alé" by DJ Alé)
  isn't said twice: the title already names them (`radioHost`).
- **Progress** is the Stage's line, with what's left and the local window
  beside it ("30 min left, 21:12–22:12", Couch's 24-hour clock). Only a real
  broadcast window gives it; it never seeks.
- **The next show** (`RadioNext`) closes Details' copy and the player's: its
  schedule line, its own categories and end ("Ambient, until 23:12", a weekday
  when it isn't today), its picture when it has one and two lines of synopsis.

Global Search matches the current show's host and a station's tags even when
the caption leaves them out. Upcoming shows don't supply search matches.

Radio playlists discover a single XMLTV URL from `x-tvg-url` on the M3U header.
Automatic discovery and its redirects stay on that playlist origin; an admin
can set an explicit HTTP(S) Guide URL in Sources for another host. Adding the
same playlist again updates this override; leaving it blank restores discovery.
Station identity and favourites stay stable. Guide channel IDs match exactly
within each source. Missing guides, gaps and channel-only guides keep stations
playable. Invalid optional categories or artwork do not discard valid programmes.
Guides refresh every 15 minutes, with bounded reads and failure
backoff (including Retry-After), retaining usable cached transmissions.

When titles match, schedule fields win and fresh live enrichment fills missing
fields if its sample falls inside that transmission. If the fresh live title
differs, its title, artwork and other fields show together, without borrowing the
schedule slot's description, categories or times. This preserves individual live
shows inside broad schedule slots. Live metadata expires at its freshness deadline
or the next known broadcast boundary. Upcoming entries never inherit live metadata.
In a gap, enrichment from an ended transmission is dropped; independently fresh
live-only information may still show. JSON freshness
times never supply programme boundaries. Browsing, Home, Details, Now Playing,
the window title and Media Session retire metadata at its expiry or broadcast
boundary. Each simultaneous Playback tracks its own station; downloads are shared.

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
Home's saved shelves are not filtered. Settings → Sources → Hidden lists
the rules with Remove, under a "Hide a word" field.

## Details

An item that is gone, or whose address names none, reads "Item not found"
(a collection, "Collection not found")
with Search (the header's field) and Back. A Details or collection page reads
its own route's search (`useOwnSearch`), so while Play opens the player it
stays itself (`tests/details-pending.browser.tsx`).

Item pages (`/item`: History, For later, a station, an Up next entry) and
collection pages (`/collection`: a source's home, a series, season, album,
channel, film or episode) have their own URLs, so refresh and Back restore
them with scroll and focus.

They open on `DetailHeader`, a [Stage](../design.md#stage) as Home's hero
is, shorter (`min(33vw, 60vh)`), in its picture's room: every picture whole at
the right as an object (a video's 16:9 frame, a poster, an album, a station's
logo, a channel's circle) or a mark (a logo on nothing), so a thumbnail's own
lettering never ghosts beside the title; without one, the room alone. At the
bottom left: the trail, the title in the display face, sized by its length
and set whole ([Type](../design.md#type)); one meta line ending in its links,
"YouTube, Blender" (a creator; the collections holding it are already the
trail, so they aren't repeated), with the length ("0:30") until it's started;
once started, Home's progress line, the bar with "5:00 left" beside it; one row
of verbs; then the synopsis without bare addresses (a line that only labelled
one goes too), three lines until More. A
YouTube channel's tab ("Stanford - Videos") is titled as the channel, a circle,
and its trail stops before it.

The verbs: Play (Play all; Resume with From start once partly watched), Queue,
Play on while another device can play it, Save as a bookmark that fills once
saved (one fixed-width toggle, `aria-pressed`, named Save), then "…" for the
rest (Remove from Continue, Move up/down, Play next, Open in browser…). The
primary verb carries `data-page-first`. A video's Play and Queue use its
displayed canonical item; Resume keeps the selected containing list and
occurrence while resuming its saved position (From start resets it). History
keeps the original media identity when its public page uses a canonical alias,
including youtu.be and Shorts; choosing another playlist or occurrence preserves
that history and uses the selected list for continuation. A series
names the episode its Play
starts: "Resume S1 E1" while one is part watched, else "Play S1 E2", the next
unwatched episode of the season last played (the first season otherwise); a
series of seasons reads that season's episodes for it, and until it can, Play
plays the first season from its start ("Play S1 E1"). Seasons, episodes and
nearby items follow as divided rows: an episode goes by its name ("Episodio
1", "S1 E1, 36:00" on its meta line), and a link every row shares (its season,
its channel) is left to the header and the trail; an album's tracks are a tracklist of
number, title and time, with nothing the page already says (cover, artist,
album). Nearby items follow the selected occurrence when a list repeats a
video, retaining the source's indices across unavailable entries. A YouTube
video in no list is followed by "More from" its channel:
the channel's Videos tab, as its own page reads it. A page ends with its own
content; a page with nothing under its header (a single track) is its header,
filling the window above the bar with its copy and picture centred in it.

**Open in browser** appears in an item's menu when it has an original page
(provider media and collections, History, For later, Up next, stations with a
homepage). It opens on the device you hold (a tab, or the system browser from
the app) and never travels through Remote.

## Saved

`/saved`, one section per `?tab=`: For later, Channels & stations (saved
channels, playlists, albums and series, then favourite stations), Lists and
Played (History, newest first), and Identified songs (completed radio lookups,
newest first). A saved YouTube channel's Play, Play on and
Queue read its Videos section, with the same 500-video limit as other lists.
Channel Details use the canonical address when available; opening an older
saved alias keeps its Saved/Remove state and merges an already saved canonical
channel. Playlist Queue all retains each occurrence's list and position.
A rail on wide screens (white ink on a
`secondary` capsule for the current entry; a pointer only brings another
entry's ink up; no heading; counts only when not zero) and a Select on phones
choose the section; the rail names the page. Without a `?tab=`, Saved opens the
first section that holds something (For later when all are empty), then names
it in the URL; while the counts arrive it draws loading rows, so an empty
section is never opened only to say so, and one known to be empty never shows
loading rows. Every section's rows read alike: one meta
line by the caption rules (Played adds what's left, "4:11 left") and a "…"
holding the row's verbs (Played: Play or Resume, Play on, Queue, Open in
browser); Details holds the rest. Lists shows Save as list at its top once
Up next holds something or a list exists; with neither, only the Empty speaks.
Save as list and Update from Up next require upcoming entries, excluding the
current item and Played. Their count and saved items follow the current item,
or the saved queue cursor after Stop; Autoplay's suggestions are not included.
Replace becomes unavailable if Up next empties while its confirmation is open.
Closing it returns focus to Lists when Update from Up next is unavailable.
A list keeps its own title and verbs. An empty tab says what goes there and
offers Search, which focuses the header's field. Removing says "Removed …
from Saved." with Undo. Artwork this page has already shown appears at once on
every tab; only a cold load fades.

Identified songs uses the same small artwork/link item as the player. Each
row shows the song title, artist and album when known, radio, programme when
known, date/time and requesting device's saved name. A matched song links
directly to Couch Search with its artist and title in the Audio scope (YouTube,
Bandcamp and SoundCloud); no modal or external recognition-service link
intervenes. A no-match observation
is plain text. These observations are kept automatically by Couch, shared
across paired devices and retained across restarts; a station rename,
programme change or device rename does not rewrite an earlier lookup.
Clearing a result in the player leaves it here. Its empty state directs people
to Identify song in a radio player.

## Rows and tiles

**`MediaRow` / `MediaList`**: thumbnail, title, meta and length bar as one
target whose press does the main verb (Play for stations, channels and live
hits, else Open or Details), with the row's menu behind a "…" at the end of the
title's line, which a pointer sees while over the row or focus is in it (touch
and the TV always see it). A row is never tinted: hovered, its thumbnail lights
up as a tile's does ([Hover](../design.md#tokens)). Rows are dense (`py-2`),
the title `text-body` over a `text-meta` line, both wrapped whole rather than
ellipsed. The thumbnail (`rounded-sm`)
takes the list's majority shape at about one height (a compact square is
3.5rem, a compact frame 6rem wide; a regular frame 5rem, 6rem from `@md`), and a word every row shares (RaiPlay's "Programme") is left
out, in a row or a shelf. Where a row leads (its source, creator, series,
station: `related`) is the last verbs of its menu, "Go to Phony", never links
under it; Search names a hit's source in its meta line instead. A row whose
page already holds every verb may hide its "…" (`menuOnPage`) but still opens
the menu by right-click, long press or held OK. A list's own entries keep
Remove and a drag handle. A tracklist row (`number`) is the track's number, its
title and its time at the end of the title's line, without artwork.

**What plays** carries the [level](../design.md#motion) wherever it is listed
(Home, Search, Saved, Radio, a source's pages): a black square at its
artwork's bottom-left corner with the bars in white while sound comes out
(paused, the chip goes, since its flat bars read as a "…"), or, in a tracklist, in
place of its number. A row or tile knows it by its addresses (`source`: its
page, or a station's `radio:` source and stream), matched against what the
looked-at Playback plays.

**`MediaTile`**: a picture with a caption, never a box. One Button around
`MediaArtwork` at its shelf's shape (`--tile-art` sets the height: posters
15rem, frames 9rem or half the column on a narrow phone, squares 10.5rem,
circles 9rem; the picture `rounded-md`), then its title (`text-body`) and its
meta line (`text-meta`), both wrapped whole at the picture's width (a shelf's
tiles keep their own heights, their captions starting level), and nothing else: no fill,
outline or links. How far it got is a white line along the artwork's foot,
with what's left in the meta line ("YouTube, 4:11 left"). Where it leads (`related`: its series, season, channel, station,
source) is the last verbs of its menu ("Go to Stanford"), and Details, where
the press plays, the first. Hovered or focused, the picture lights up in its
own colour and the meta line comes up to white; focus adds a white ring, which
the TV thickens and lifts ([Hover](../design.md#tokens)). The "…" sits over the
end of the title's first line; a pointer sees it over or inside the tile, touch
always; on the TV it is always shown and no focus stop unless the press is
disabled.

**Captions** read as one line of parts joined by commas ("YouTube, 10:34";
a provider's own "Game · 1,204 viewers" becomes "Game, 1,204 viewers"). An
episode leads with its series ("Phony") and its meta with "S1 E1, Episodio 1",
wherever tiles, rows or the hero show it.

**`Shelf`**: an optional linked heading (a focus stop) over a plain overflow
row (`data-nav-row`), never a Carousel, so spatial navigation and focus scroll
work natively. The row runs out to the window's edges, so a long shelf runs off
the right of the screen, and its padding holds a lit tile's glow and the TV's
lifted tile. Its heading, `ShelfHeading` (`text-heading`), also heads Home's
board lists. Search kinds and Home's sources use it too.

**`MediaArtwork`** fills its frame when the art matches the frame's shape and
is contained otherwise. Without any it is a cover set in type: a deep tone of
its own, hashed from the title (OKLCH lightness .3, so white keeps 7:1, and an
item keeps its tone everywhere), with the title large (semibold, 12% of the
frame's width, four lines at most) at its bottom left, so a shelf of missing
artwork isn't a row of grey squares; a frame under 8rem (a row's, the bar's or
a suggestion's thumbnail) or a round one (a channel's) holds the title's first
letter instead, since a circle would cut its words, and a collection a folder. An address that has loaded once in the page shows at once
wherever it appears again (a tab switch, Back); only a first load fades in.

### Artwork shapes

`artShape` (`src/client/art-shape.ts`) gives each kind of item one shape:
posters (2:3) for films and series from the catalogues, and Twitch's
categories; frames (16:9) for videos, episodes, streams, RaiPlay's programmes
and Live TV; squares for music (Bandcamp, SoundCloud) and stations; circles for
channels and artists (YouTube, Twitch). A shelf or a list takes its majority
shape (`majorityShape`): art of that shape fills it, art of another shape (and
a channel logo) is contained in it, unclipped by a circle it doesn't fill; a
channel's avatar (or its cover, without one) stays a circle, as large as the
frame's shorter side and centred, in a frame of another shape. Artwork still loading holds the muted fill rather than black. Details and Search's closest match draw the
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

`ContentBreadcrumb` (shadcn's Breadcrumb) is a sub-page's real path, above its
h1 (on a Details page, inside the Stage's copy, over the title), each crumb a
link: the section it opened in, Radio or the source's home, then the collections
holding it ("Home › StreamingCommunity › Series"). The h1 names the page, so the
trail ends at its parent, with no separator after the last crumb. It is a way to
reach content, not only a way back, so every page shows it, a Details page that
opened in its tab too ("Home").

- **One line, every name capped.** Small muted text. Each crumb's name is at
  most 20ch (about 24 letters, 160px at `text-sm`, where a title's first words
  already name it: "Tiny Desk Concerts: the…"), truncated with its whole name in
  a tooltip on hover and focus, so one long name never crowds out the short ones.
  A Stage's 46rem copy column holds the section, the source and two capped
  collections whole. Only when the capped crumbs still don't fit do the middle
  ones collapse into "…" (`BreadcrumbEllipsis`), nearest the first first, a menu
  listing them whole, shadcn's collapsed breadcrumb: the first crumb and the
  last ancestors stay ("Home › … › Tiny Desk Concerts: the…" on a phone). They
  come back once the line has room. Past that, names shrink, never below six
  characters.
- **What's in a crumb.** Where a crumb's page is already loaded (a series, a
  channel, cached by visiting it), a chevron after it opens a menu of the
  collections in it (its seasons, its playlists), the one on the path marked:
  shadcn's breadcrumb with a dropdown. Nothing is fetched for it.
- **The player** shows what holds what plays, the source and its collections
  ("YouTube › Tiny Desk concerts"), above its title, only when a collection
  holds it ([Player](player.md#controls-over-the-picture)). Its links open as
  Details do, so Back returns to the player.
- Every crumb, "…" and chevron is a focus stop for Tab and the TV's remote.

Esc and the TV's Back still go back in history, restoring focus.
That is the exact opener in the page or bar, including when both have an
identical link and the page's one appears later. If the opener disappears
(such as a stopped now-playing bar), the returning page's first control or
heading holds focus. For up to 15 seconds, the exact opener takes precedence
if it returns; a key, pointer press, focus choice or navigation cancels that
handoff. An identical link in another scope never substitutes for the opener.
Check with `tests/home-focus.browser.ts` and `tests/focus-recovery.browser.ts`
on an empty Vite fixture at `?tv=0` and `?tv=1`.

## Play on in menus

Play on targets are a labelled group inside an item's menu, with wrapping
device names, bounded to the viewport height. What Play on offers:
[Where it plays](where-it-plays.md#play-on).
