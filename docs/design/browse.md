# Browse

## Search

Search is the header's field on every page ([Shell](shell.md#header-and-section-nav)),
and its results are `/search?q=…`. The query stays in the field; the page's
"Search results" heading is for screen readers. It asks every source at once;
one muted line says how many results there are and which sources it is still
asking, while the header's Spinner stays busy. Sources answer in bursts, and
the page takes each burst as one change (a debounced value, TanStack Pacer),
so rows and tiles don't shuffle in step with every source.

Under that line sit two rows of choices (`ChoiceGroup`, scrolling sideways on
phones), each named once at its left as a settings row is: From, the sources
with results and their counts, and Ends by, three clock times ahead on the
half hour, the first at least twenty minutes out (`?until=HH:MM`). The selected
time stays visible and keeps its deadline as the clock advances; an expired
deadline allows no remaining duration. Choices can cross midnight. Each kind's
heading counts what it holds by name ("2 titles", "28 stations"), as Home's
shelves do. A hit fits when it would end by then; live media and radio
always fit, and collections (including albums, series, seasons and programmes) never do. There is no What or Length filter:
the kinds are headings, and a length is read as the clock time it ends.

A word of the query matches a word of a hit, or the start of one, never its
middle ("nts" finds NTS Radio, not Quints). The closest match leads: the first
hit whose title holds every word, from the first kind below that has one, laid
out like Home's hero at a smaller size (artwork, title, meta, when it ends, its
verbs) and carrying `data-page-first`; once every source has answered it holds
still for the query, so nothing moves under the focus. Then each kind in the
shape it reads best in, each a [Shelf](#mediatile) starting with twelve (More
reveals the rest in place) or a
[MediaList](#mediarow--medialist):

- **Films and series**: the catalogues' titles as posters, RaiPlay's programmes
  as frames;
- **Radio** and **Music**: squares;
- **Live now**: frames;
- **Videos**: divided rows under the time ruler, with their length bars;
- **Channels and lists**: divided rows.

Hits that mention no word of the query wait behind one line ("Show N results
that don't mention …"), so "Nothing found" is reachable even when a source
answers anything. A pasted link opens as a webpage or as direct media, with
Open page for a source's own link. The first result starts the page, which
Down from the header's field reaches. An empty query has no results page: it
is Discover.

## Discover

Discover (`/discover`) is Home's sibling: shelves of `MediaTile`s under their
headings, with no hero, since Couch picks nothing for it. Each shelf's heading names
what it samples and is a link that opens the rest ([MediaTile](#mediatile)).
In order, so what's live leads and wide frames break up the catalogues'
posters:

- **Shared sources**, while devices share screen or sound: a compact row of
  names over their input kind, wrapping like Sources.
  Pressing a source plays it; its menu holds Play on, Play next and Queue.
  The first source carries `data-page-first`, so TV focus starts there.
  Sharing's Add source opens Discover directly.
- **Radio**, "On air now": the saved stations, then the built-in ones (Home's
  Radio shelf without its recents, `useOnAir`). A tile reads the station and
  its current show, else where it's from; the heading already says they're on
  air, so a tile doesn't repeat "Live". A show's `expiresAt` is when its data
  refreshes, not when it ends, so there is no "until" time. A tile plays its
  station, and its first carries `data-page-first` when no shared source leads.
  The shelf waits for the shows, so no tile grows a line under the focus, then
  keeps its order while Discover stays open. Its heading opens every station (`/discover/radio`):
  its source choice (`radioSource`), count, Filter (`filter`) and pager
  (`page`), as divided rows.
- **Live TV**, "N channels", only while a Live TV source has some: the
  guide's first twelve channels. A channel has no page, so its tile plays it
  and its menu holds Play on and Queue. Its heading opens every channel
  (`/discover/live-tv`): the guide's channels with what's on now and next,
  by group (`group`), Filter (`filter`) and page (`page`).
- **One shelf per source with a home**: Twitch ("Live now"),
  StreamingCommunity ("Films and series"), RaiPlay ("Programmes"),
  123MoviesFree ("Films"), AnimeSaturn and AnimeUnity ("Films and series").
  Each holds the first twelve of the source's own home, the same query its
  page makes (`ProviderPage`, `url` ""), so opening
  the heading shows them at once. A tile opens its Details; its menu holds its
  search hit's verbs.
- **Sources**: the sources that start from a search, YouTube, Bandcamp and
  SoundCloud, as a compact row of names over a muted line, each opening its
  scoped search (`/collection?provider=…`, an Empty with a search field).

Shelves load side by side and hold about a tile's height meanwhile, so the
ones below don't move under the focus. One that fails says "Couldn't load
{source}." with Try again, as Home does; an empty one is left out. Discover's
own pages carry a breadcrumb to it, and Back returns to the heading that
opened them. As a section root, Discover carries no breadcrumb.

Shared sources is the exception: its row comes and goes with intentional
sharing. TV navigation keeps the same Radio tile focused when sharing starts;
after its focused last source ends, the next arrow reaches Radio's first tile.

Not yet: a programme grid for Live TV, and any Core endpoint it would need;
it waits for a source that needs one.

The film and series catalogue homes (StreamingCommunity, 123MoviesFree,
AnimeSaturn and AnimeUnity) use the same poster-tile grid on TV, desktop
and phone; the available width sets its column count. Titles, seasons,
episodes and tracks keep their divided rows.

## Details

Item pages (`/item`: History, For later, a station, an Up next entry) and
collection pages (`/collection`: a source's home, a series, season, album,
channel, film or episode) open on one header, `DetailHeader`, laid out like
Home's hero: contained artwork at the left at its own aspect ratio (stacked
above it below `md`), the title at display size, one muted meta line, a
`DurationBar` when the length is known ("Resume at …" once partly watched),
the synopsis, then one row of verbs. A page without artwork has no artwork
column. The catalog has no media header and Card breaks Flat, so it is a plain
composition of Button and DropdownMenu, like Home's hero.

The row holds, in order: Play (Play all for a list; Resume, with From start
beside it, once partly watched), Queue (Queue all), Save or Saved, Play on
while another device can play it, then one "…" menu for the rest. Each verb is
one focus stop. The primary verb carries `data-page-first`, so the page starts
on it; while it is disabled, or without one, the first verb you can press does.
A header without verbs, such as a source's home, leaves the page to its first
tile or row, or to the scoped search field where a source has no home page of
its own, never to the breadcrumb. Seasons, episodes, tracks and nearby
items follow as divided MediaRows.

Details holds every verb for everything Home opens, where the item supports
them; a Home tile's menu holds the row of verbs, and reaches Details for the
"…" verbs ([MediaTile](#mediatile)):

- **History:** Resume or Play, From start, Queue, Save and Play on; "…" holds
  Remove from Continue. Save keeps the item's provider page in For later, and
  Saved takes it out; an item without a provider page has no Save.
- **For later:** Play, Queue and Play on; "…" holds Move up, Move down and
  Remove, with Undo. It is already saved, so it has no Save.
- **A station:** Play, Queue, Save or Saved (its favourite, the toggle its
  tiles' menus share) and Play on; "…" holds Open show page.
- **An Up next entry:** Play and Save.
- **A source's page:** Play, Play all or Resume, From start, Queue or Queue
  all, Save and Play on; "…" holds Play next.

## Keep discovery context visible

Opened shows, seasons and albums retain
a contained cover and a short synopsis above their divided rows; a film or
episode shows its synopsis under its title, never an empty About. Episode
rows use their own descriptions when available; a show synopsis stays with
the collection instead of pretending to describe each episode. A partly
watched item's primary verb is Resume, with From start beside it. A series
offers Play or Resume of its next episode, and with one season its episodes
are on its own page. A detail page ends with its own content and never
appends the source's catalogue. Posters and album art stay uncropped. This
extends the existing shadcn Item-based MediaRow; no additional preview panel
or per-result request is needed.

Source results
pair artwork with available synopsis and episode metadata; collection
headers contain their artwork instead of cropping covers. Artwork fades in
once it has loaded ([Motion](../design.md#motion)). Missing artwork
keeps its frame as a hairline on the page's ground, with the title set in
type sized to the frame (a container query) in muted ink, so it keeps a
shelf's rhythm without reading as a picture; a collection shows a folder
there instead.

## Details are destinations

Item details and provider collections have
their own URLs, resolved from stable item IDs or canonical provider URLs.
Refresh loads the same content; Back restores the previous page, filters,
scroll and focus. A provider search result's title opens its details; Play is
a separate, explicit action, including on phones. StreamingCommunity's
collections say Series or Season rather than List. Reuse PageHeader and existing media rows. Dialogs remain
reserved for focused tasks such as pairing and source setup.

## Saved

Saved (`/saved`) holds what you keep, one section per `?tab=`: For later,
Channels & stations (saved channels, playlists, albums and series, then
favourite stations), Lists, and Played. Each is a list you manage in its own
way (an order, Remove with Undo, a list's entries, history), which a shelf
can't hold, and Home already shows For later and Played as shelves, so the
tabs stay. They sit in the section nav Saved shares with Settings, a rail on
wide screens and a Select on phones, where the Select names the tab and its
title is for screen readers: [Settings](settings.md#section-nav).

Played (`?tab=played`) lists History, newest first, as divided MediaRows with
their length bar ("Resume at …" once partly watched). Each row's one verb opens
its History Details, which holds the others and Remove from Continue with Undo;
the rows have no menu.
Removing from For later or Channels & stations says "Removed … from Saved."
An empty tab says what goes there and offers Discover.
Saved channels and collections keep their contained artwork and the same
Channel, List, Album, Series or Season label as Search.

## MediaRow / MediaList

Thumbnail, title, meta and length bar, as one target on every screen: pressing
the row (its artwork too, for a pointer) does its main verb, Play for stations,
channels and live hits, else Open or Details. Search, Saved, Discover's pages, and Up
next's compact rows. Its other verbs (Play, Play on, Play next, Queue, Save,
Move up, Move down, Remove, and Open where a live hit's press plays) are one list, `MediaRow`'s `menu`: the
row's one menu ([Menus](../design.md#menus)), behind a "…" at the end of the
main verb's line on every screen, centred on the row's text.

A row whose page holds every verb in its menu shows no "…" (`menuOnPage`),
though right-click, a long press and a held OK still open the menu from the
row: For later's rows (Details keeps Remove with Undo and Move up/down), Lists'
rows (a list's page holds Play, Play on and Queue) and search hits that open a
collection (whose page holds Save). Every other row keeps its "…": saved
channels and stations (a station's page holds no ordering or Remove), Live TV
(a channel has no page), stations, live hits and videos with Play next among
search hits, shared inputs, and Up next's entries, whose page holds only Play
and Save. A list's own entries have no main verb, so they keep Remove and
their drag handle on the row on every screen.

The menu is shadcn's Dropdown Menu, adjusted to Clock: a hairline border and
no shadow, `text-sm` items at `h-8` (44px under `touch:`) that invert when
highlighted.

A live hit uses Play only while it is enabled; otherwise it retains its
original Open destination, including during a pending Save. Busy actions
keep their existing disabled state.

## MediaTile

One `Button` wrapping `MediaArtwork` (contained; 2:3 for films
and series, 1:1 for stations and albums, 16:9 for videos and episodes), a
title and one meta line, plus a `DurationBar` on Continue. It is one focus
stop whose press does the item's main verb. The catalog has no media tile
and Card breaks Flat, so a tile is the smallest Button composition. `--tile-art`
sets its artwork's height (11rem), so the "…" finds the title's line.

Its other verbs are its one menu ([Menus](../design.md#menus)), behind a "…"
over the end of the title's first line, which leaves it room, with its dots
flush with the text. The "…" can't sit inside the tile's button, so it is a
sibling laid over the caption, the line's height so the tile grows no taller,
and it inverts with the focused caption; on touch a larger hit area makes its
44px target. On the TV it is no focus stop, unless the press is disabled (nothing
can play): then it is the tile's one stop, so its menu stays in reach. A tile's menu holds its Details'
verbs, with Details first where the press plays:

- **Continue** (press resumes): Details, From start, Queue, Play on. Its
  sibling Details button stays, so a remote reaches History's verbs without a
  held OK.
- **Played recently** (press opens Details): Resume or Play, From start,
  Queue, Play on.
- **For later** (press opens Details): Play, Queue, Play on.
- **A station** (Home's and Discover's Radio; press plays): Details, Queue,
  Save or Saved, Play on. A station played from a link may be in no list, so
  its tile is where it can be saved.
- **An Up next entry** (press plays it now): its Up next row's verbs.
- **A source's tile** (Discover's source shelves and a catalogue's posters; press opens it): its search hit's verbs.
- **A Live TV channel** (press plays it): Play on, Queue.

Shelves
(`Shelf`: Home's and Discover's) are plain overflow rows (`data-nav-row`):
Carousel's own arrow handling fights spatial navigation, and focus scrolls a
plain row into view. A shelf's heading can be a link to the rest of what it
samples, with a chevron; it is a focus stop between its shelf and the one
above. Radio's tiles take the shelf's height, so a station
without a show stays level with the rest: a shorter tile's centre sits higher,
and Up from its neighbour would pick it before the tab bar.

## BrowsePagination

Collection and radio lists keep count and Filter in fixed
slots. Remote or multiple-page collections show Previous, "Page N of M" and
Next, disabled when they can't move. A complete local collection on one page
omits the inert pager, including a single season's episodes and a short list
of seasons; its count still identifies the content. The page Select's trigger is
borderless and transparent, in muted ink: it reads as the pager's
"Page N of M" text between two ghost icon buttons, as shadcn Pagination's
links do, and a bordered field there would be a panel inside the pager.

## ContentBreadcrumb

The path above a collection or item: the section the page belongs to (its
tab: [Shell](shell.md#sections)), then the source, then the collection. It replaces a Back control, so its
links are `text-sm`, the controls' size, rather than Mira's `text-xs`
caption size, and each is `min-h-11`, a 44px target on every screen.

## Play on targets in menus

Play on targets sit in a labelled group inside row menus, with device names that can wrap. A nested flyout left too little width on a 320–390px phone at larger interface sizes. Use the menu's standard Group and Label, and bound long menus to the available viewport height so keyboard and touch can reach every target. The separate inline Play on menu uses the same target rows.

What Play on offers and confirms: [Where it plays](where-it-plays.md#play-on).
